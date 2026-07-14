/**
 * generate-api-reference.test.mjs — regression suite for the api-reference drift
 * gate: the pure core (`scripts/lib/api-reference-drift.mjs`) plus the CLI's
 * `--check` exit-code contract (`scripts/generate-api-reference.mjs`).
 *
 * The unit tests drive `computeDrift` with small IN-MEMORY fixtures (no disk,
 * no network) — one per drift class the gate must catch. The subprocess tests
 * exercise the real CLI: a smoke test that the committed tree passes `--check`
 * with exit 0, and the fail-closed edge cases (missing/unparseable spec, empty
 * endpoint dir, missing/malformed docs.json) that must exit NON-ZERO rather than
 * report a false "no drift".
 *
 * All fixtures use obvious placeholders (MNE-339) — no credential-shaped values.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { computeDrift, stubBody } from "./lib/api-reference-drift.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "generate-api-reference.mjs");
const LIB = join(HERE, "lib", "api-reference-drift.mjs");

// ── In-memory fixture helpers ─────────────────────────────────────────────

// A minimal docs.json shell with an "API Reference" tab holding the given groups.
const docsWith = (groups) => ({ navigation: { tabs: [{ tab: "API Reference", groups }] } });

// Drive computeDrift with a page map (filename -> contents) as the reader.
const run = ({ spec, pages = {}, docs }) =>
  computeDrift({
    spec,
    existingFiles: Object.keys(pages),
    readEndpoint: (f) => pages[f],
    docs,
  });

// A public-product op (ApiKeyAuth) tagged "Tools" -> nav group "Tools".
const widgetOp = (summary = "List widgets") => ({
  summary, tags: ["Tools"], security: [{ ApiKeyAuth: [] }],
});

// ── computeDrift: drift classes ───────────────────────────────────────────

test("clean tree: every op has a matching stub + nav entry → all counts 0, no orphans", () => {
  const op = widgetOp();
  const r = run({
    spec: { paths: { "/widgets": { get: op } } },
    pages: { "get-widgets.mdx": stubBody("List widgets", "get", "/widgets", op) },
    docs: docsWith([{ group: "Tools", pages: ["api-reference/endpoint/get-widgets"] }]),
  });
  assert.equal(r.written, 0);
  assert.equal(r.refreshed, 0);
  assert.equal(r.added, 0);
  assert.equal(r.deduped, 0);
  assert.equal(r.orphans.length, 0);
});

test("spec op with no committed page → written === 1 (and a nav entry added)", () => {
  const r = run({
    spec: { paths: { "/widgets": { get: widgetOp() } } },
    pages: {},
    docs: docsWith([{ group: "Tools", pages: [] }]),
  });
  assert.equal(r.written, 1);
  assert.equal(r.toGen[0].file, "get-widgets.mdx");
  assert.equal(r.added, 1);
  assert.equal(r.refreshed, 0);
  assert.equal(r.orphans.length, 0);
});

test("committed stub whose title drifted from the spec → refreshed === 1", () => {
  const oldOp = widgetOp("List widgets");
  const newOp = widgetOp("List widgets (v2)");
  const r = run({
    spec: { paths: { "/widgets": { get: newOp } } },
    pages: { "get-widgets.mdx": stubBody("List widgets", "get", "/widgets", oldOp) },
    docs: docsWith([{ group: "Tools", pages: ["api-reference/endpoint/get-widgets"] }]),
  });
  assert.equal(r.refreshed, 1);
  assert.equal(r.written, 0); // page exists (directive resolves) — never re-generated
});

test("hand-written (non-stub) page with the same slug is never overwritten → refreshed === 0", () => {
  const handWritten =
    '---\ntitle: "List widgets"\nopenapi: "GET /widgets"\n---\n\nA hand-written narrative body that must be preserved.\n';
  const r = run({
    spec: { paths: { "/widgets": { get: widgetOp("List widgets (v2)") } } },
    pages: { "get-widgets.mdx": handWritten },
    docs: docsWith([{ group: "Tools", pages: ["api-reference/endpoint/get-widgets"] }]),
  });
  assert.equal(r.refreshed, 0);
  assert.equal(r.written, 0);
});

test("endpoint page whose openapi: directive is absent from the spec → orphans.length === 1", () => {
  const r = run({
    spec: { paths: {} },
    pages: { "get-ghosts.mdx": stubBody("Ghost op", "get", "/ghosts", { summary: "Ghost op" }) },
    docs: docsWith([{ group: "Tools", pages: ["api-reference/endpoint/get-ghosts"] }]),
  });
  assert.equal(r.orphans.length, 1);
  assert.equal(r.orphans[0], "get-ghosts.mdx: GET /ghosts");
});

test("a page double-listed across two nav groups → deduped >= 1", () => {
  const op = widgetOp();
  const r = run({
    spec: { paths: { "/widgets": { get: op } } },
    pages: { "get-widgets.mdx": stubBody("List widgets", "get", "/widgets", op) },
    docs: docsWith([
      { group: "Tools", pages: ["api-reference/endpoint/get-widgets"] },
      { group: "Catalog", pages: ["api-reference/endpoint/get-widgets"] },
    ]),
  });
  assert.ok(r.deduped >= 1, `expected deduped >= 1, got ${r.deduped}`);
});

test("HELD / deprecated / dashboard-session / non-api ops are excluded, never counted as written", () => {
  const spec = {
    paths: {
      "/safe-house/patterns": { post: { summary: "Held op", tags: ["Safe House"], security: [{ ApiKeyAuth: [] }] } },
      "/legacy-thing": { get: { summary: "Old op", deprecated: true, tags: ["Tools"], security: [{ ApiKeyAuth: [] }] } },
      "/auth/password": { post: { summary: "Set password", tags: ["Auth"], security: [{ CookieAuth: [] }] } },
      "/contact/submit": { post: { summary: "Contact form", tags: ["Tools"], security: [{ ApiKeyAuth: [] }] } },
    },
  };
  const r = run({ spec, pages: {}, docs: docsWith([]) });
  assert.equal(r.written, 0, "no excluded op should be generated");
  assert.ok(r.excluded.held.includes("POST /safe-house/patterns"));
  assert.ok(r.excluded.deprecated.includes("GET /legacy-thing"));
  assert.ok(r.excluded["dashboard-session"].includes("POST /auth/password"));
  assert.ok(r.excluded["non-api"].includes("POST /contact/submit"));
});

test("counter correctness: each drift class increments only its own counter", () => {
  // One brand-new op (write + nav add), one drifted stub, one orphan, one dup.
  const newOp = widgetOp("Create widget"); // POST /widgets → new page
  const drifted = widgetOp("List widgets (v2)"); // GET /widgets → stub title drifted
  const spec = {
    paths: {
      "/widgets": { get: drifted, post: newOp },
      // /ghosts intentionally absent → the committed ghost page is an orphan.
    },
  };
  const pages = {
    "get-widgets.mdx": stubBody("List widgets", "get", "/widgets", widgetOp("List widgets")),
    "get-ghosts.mdx": stubBody("Ghost op", "get", "/ghosts", { summary: "Ghost op" }),
  };
  const docs = docsWith([
    { group: "Tools", pages: ["api-reference/endpoint/get-widgets", "api-reference/endpoint/get-ghosts"] },
    { group: "Catalog", pages: ["api-reference/endpoint/get-widgets"] }, // duplicate listing
  ]);
  const r = run({ spec, pages, docs });
  assert.equal(r.written, 1, "exactly one new page");
  assert.equal(r.refreshed, 1, "exactly one drifted stub");
  assert.equal(r.orphans.length, 1, "exactly one orphan directive");
  assert.ok(r.deduped >= 1, "the duplicate get-widgets listing is pruned");
});

// ── CLI --check: smoke test against the real committed tree ────────────────

test("smoke: `--check` exits 0 on the committed tree (no drift)", () => {
  const r = spawnSync(process.execPath, [CLI, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  assert.match(r.stderr, /✓ no drift/);
});

test("`--check` exits non-zero and prints the remediation line when the tree has drifted", () => {
  // /widgets has no committed page → the generator WOULD write it.
  const spec = JSON.stringify({
    paths: {
      "/widgets": { get: widgetOp() },
      "/gadgets": { get: widgetOp("List gadgets") },
    },
  });
  const docs = JSON.stringify(docsWith([{ group: "Tools", pages: ["api-reference/endpoint/get-gadgets"] }]));
  const pages = { "get-gadgets.mdx": stubBody("List gadgets", "get", "/gadgets", widgetOp("List gadgets")) };
  const root = makeTree({ openapi: spec, docs, pages });
  try {
    const r = checkIn(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /drift detected/);
    assert.match(r.stderr, /would write 1 page\(s\)/);
    assert.match(r.stderr, /Run 'node scripts\/generate-api-reference\.mjs' and commit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── CLI --check: fail-closed edge cases (MNE-442) ──────────────────────────

// Build a throwaway repo-shaped tree (scripts/ + api-reference/ + docs.json) and
// copy the real CLI + helper into it so ROOT resolves to the fixture. Returns the
// tree root; caller cleans up.
function makeTree({ openapi, docs, pages } = {}) {
  const root = mkdtempSync(join(tmpdir(), "apiref-drift-"));
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  mkdirSync(join(root, "api-reference", "endpoint"), { recursive: true });
  copyFileSync(CLI, join(root, "scripts", "generate-api-reference.mjs"));
  copyFileSync(LIB, join(root, "scripts", "lib", "api-reference-drift.mjs"));
  if (openapi !== undefined) writeFileSync(join(root, "api-reference", "openapi.json"), openapi);
  if (docs !== undefined) writeFileSync(join(root, "docs.json"), docs);
  for (const [name, content] of Object.entries(pages || {})) {
    writeFileSync(join(root, "api-reference", "endpoint", name), content);
  }
  return root;
}

const checkIn = (root) =>
  spawnSync(process.execPath, [join(root, "scripts", "generate-api-reference.mjs"), "--check"], { encoding: "utf8" });

const VALID_OPENAPI = JSON.stringify({ paths: { "/widgets": { get: widgetOp() } } });
const VALID_DOCS = JSON.stringify(docsWith([{ group: "Tools", pages: ["api-reference/endpoint/get-widgets"] }]));
const VALID_PAGE = { "get-widgets.mdx": stubBody("List widgets", "get", "/widgets", widgetOp()) };

test("fail-closed: missing openapi.json → exit non-zero with a clear error", () => {
  const root = makeTree({ docs: VALID_DOCS, pages: VALID_PAGE }); // no openapi.json
  try {
    const r = checkIn(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /openapi\.json is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fail-closed: unparseable openapi.json → exit non-zero with a clear error", () => {
  const root = makeTree({ openapi: "{ this is not json", docs: VALID_DOCS, pages: VALID_PAGE });
  try {
    const r = checkIn(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /openapi\.json is not valid JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fail-closed: empty endpoint/ dir → exit non-zero, never a false ✓", () => {
  const root = makeTree({ openapi: VALID_OPENAPI, docs: VALID_DOCS }); // no pages
  try {
    const r = checkIn(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no \.mdx pages/);
    assert.doesNotMatch(r.stderr, /✓ no drift/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fail-closed: missing docs.json → exit non-zero with a clear error", () => {
  const root = makeTree({ openapi: VALID_OPENAPI, pages: VALID_PAGE }); // no docs.json
  try {
    const r = checkIn(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /docs\.json is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fail-closed: malformed docs.json → exit non-zero with a clear error", () => {
  const root = makeTree({ openapi: VALID_OPENAPI, docs: "{{{ not json", pages: VALID_PAGE });
  try {
    const r = checkIn(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /docs\.json is not valid JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
