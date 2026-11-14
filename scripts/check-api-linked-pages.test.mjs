// Tests for the api-linked pages gate (scripts/lib/api-linked-pages.mjs, MNE-10095).
// Run: npm run test:api-linked-pages
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ApiLinkedPagesError,
  SOURCES,
  buildList,
  checkPages,
  diffLists,
  extractSlugs,
  serializeList,
  validateList,
} from "./lib/api-linked-pages.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIST_PATH = join(ROOT, "scripts", "api-linked-pages.json");
const LIST = JSON.parse(readFileSync(LIST_PATH, "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

const run = (script, args = [], env = {}) =>
  spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", ...env },
  });

/** A throwaway docs root holding docs.json and the given page files. */
function tree(files, redirects = []) {
  const root = mkdtempSync(join(tmpdir(), "api-linked-pages-"));
  writeFileSync(join(root, "docs.json"), JSON.stringify({ redirects }));
  for (const rel of files) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), "---\ntitle: fixture\n---\n");
  }
  return root;
}

const list = (...slugs) => ({
  ...clone(LIST),
  pages: Object.fromEntries(slugs.map((s) => [s, { linked_from: ["src/org-scan/row-builder/fix-table.ts"] }])),
});

const check = (l, files, redirects = []) => {
  const root = tree(files, redirects);
  try {
    return checkPages(l, { redirects }, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("every page in the committed list resolves in the committed tree", () => {
  const r = run("check-api-linked-pages.mjs");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /page\(s\) linked by mnemom\/mnemom-api@\S+ resolve/);
});

test("the committed list is valid and holds the two pages the Org Scan report links", () => {
  validateList(LIST);
  assert.deepEqual(LIST.sources, [...SOURCES].sort());
  for (const slug of ["gateway/agent", "gateway/agent-savings"]) assert.ok(LIST.pages[slug], slug);
});

test("a page file in any of the four forms resolves", () => {
  assert.deepEqual(check(list("a", "b", "c", "d"), ["a.mdx", "b.md", "c/index.mdx", "d/index.md"]), []);
});

test("a removed page with no redirect fails and names the api file that links it", () => {
  const problems = check(list("gateway/agent", "gateway/agent-savings"), ["gateway/agent-savings.mdx"]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^\/gateway\/agent: it has no page file and no redirect/);
  assert.match(problems[0], /src\/org-scan\/row-builder\/fix-table\.ts/);
});

test("a renamed page passes once it ships with a redirect to a page that exists", () => {
  const moved = ["gateway/mnemom-agent.mdx"];
  assert.equal(check(list("gateway/agent"), moved).length, 1);
  assert.deepEqual(check(list("gateway/agent"), moved, [{ source: "/gateway/agent", destination: "/gateway/mnemom-agent#flags" }]), []);
});

test("a redirect chain is followed to its end", () => {
  const redirects = [
    { source: "/a", destination: "/b" },
    { source: "/b", destination: "/c" },
  ];
  assert.deepEqual(check(list("a"), ["c.mdx"], redirects), []);
  assert.match(check(list("a"), [], redirects)[0], /its redirect ends at \/c, which has no page file/);
});

test("a redirect that loops, leaves the site, or is a wildcard does not count", () => {
  const loop = [
    { source: "/a", destination: "/b" },
    { source: "/b", destination: "/a" },
  ];
  assert.match(check(list("a"), [], loop)[0], /its redirect loops/);
  assert.match(check(list("a"), [], [{ source: "/a", destination: "https://example.com/a" }])[0], /leaves the docs site/);
  assert.match(check(list("old/a"), ["new/a.mdx"], [{ source: "/old/:path*", destination: "/new/:path*" }])[0], /no page file and no redirect/);
});

test("the CLI exits 1 on a removed page and 2 on a malformed list", () => {
  const root = tree([]);
  const bad = join(root, "list.json");
  try {
    const r = run("check-api-linked-pages.mjs", [], { API_LINKED_PAGES_ROOT: root });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /::error::\/gateway\/agent: it has no page file and no redirect/);
    writeFileSync(bad, JSON.stringify({ ...LIST, pages: {} }));
    const m = run("check-api-linked-pages.mjs", [], { API_LINKED_PAGES_LIST: bad });
    assert.equal(m.status, 2, m.stderr);
    assert.match(m.stderr, /pages must list at least one page/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractSlugs keeps docs.mnemom.ai pages only and drops anchors, queries and trailing punctuation", () => {
  const text = [
    'const A = "https://docs.mnemom.ai/gateway/agent";',
    " * see https://docs.mnemom.ai/gateway/agent-savings.",
    "`Source: https://docs.mnemom.ai/gateway/agent-savings`",
    '"https://docs.mnemom.ai/guides/x/#anchor" "https://docs.mnemom.ai/guides/y?z=1"',
    '"https://www.mnemom.ai/pricing" "https://docs.mnemom.ai.evil.example/x" "https://docs.mnemom.ai/"',
  ].join("\n");
  assert.deepEqual(extractSlugs(text), ["gateway/agent", "gateway/agent-savings", "guides/x", "guides/y"]);
});

test("buildList records which file links each page, and refuses a source set with no link", () => {
  const built = buildList(
    [
      { path: "src/b.ts", text: "https://docs.mnemom.ai/gateway/agent https://docs.mnemom.ai/a" },
      { path: "src/a.ts", text: "https://docs.mnemom.ai/gateway/agent" },
    ],
    "abc123",
  );
  validateList(built);
  assert.equal(built.ref, "abc123");
  assert.deepEqual(Object.keys(built.pages), ["a", "gateway/agent"]);
  assert.deepEqual(built.pages["gateway/agent"].linked_from, ["src/a.ts", "src/b.ts"]);
  assert.throws(() => buildList([{ path: "src/a.ts", text: "no links" }], "x"), ApiLinkedPagesError);
});

test("diffLists reports a page the api added, dropped, or links from a new file", () => {
  assert.deepEqual(diffLists(LIST, clone(LIST)), []);
  const live = clone(LIST);
  live.pages["guides/new"] = { linked_from: ["src/org-scan/row-builder/fix-table.ts"] };
  delete live.pages["gateway/agent"];
  live.pages["gateway/agent-savings"].linked_from = ["src/org-scan/row-builder/targets.ts"];
  const drift = diffLists(LIST, live);
  assert.equal(drift.length, 3);
  assert.match(drift[0], /now links \/guides\/new/);
  assert.match(drift[1], /no longer links \/gateway\/agent,/);
  assert.match(drift[2], /\/gateway\/agent-savings is now linked from/);
});

test("sync builds the committed list from a local checkout, and --check sees drift without a token", () => {
  const api = mkdtempSync(join(tmpdir(), "api-linked-pages-api-"));
  const out = join(api, "list.json");
  const write = (extra = "") => {
    for (const path of SOURCES) {
      const links = Object.entries(LIST.pages)
        .filter(([, p]) => p.linked_from.includes(path))
        .map(([slug]) => `export const X = "https://docs.mnemom.ai/${slug}";`);
      mkdirSync(dirname(join(api, path)), { recursive: true });
      writeFileSync(join(api, path), `${links.join("\n")}\n${extra}`);
    }
  };
  try {
    write();
    const env = { API_LINKED_PAGES_LIST: out };
    const w = run("sync-api-linked-pages.mjs", ["--api-dir", api, "--ref", LIST.ref], env);
    assert.equal(w.status, 0, w.stderr);
    assert.equal(readFileSync(out, "utf8"), serializeList(LIST));
    assert.equal(run("sync-api-linked-pages.mjs", ["--check", "--api-dir", api, "--ref", "x"], env).status, 0);
    write('export const Y = "https://docs.mnemom.ai/guides/brand-new";\n');
    const d = run("sync-api-linked-pages.mjs", ["--check", "--api-dir", api, "--ref", "x"], env);
    assert.equal(d.status, 1, d.stderr);
    assert.match(d.stderr, /now links \/guides\/brand-new/);
    assert.equal(run("sync-api-linked-pages.mjs", ["--api-dir", api], env).status, 2);
    assert.equal(run("sync-api-linked-pages.mjs", [], env).status, 2);
  } finally {
    rmSync(api, { recursive: true, force: true });
  }
});
