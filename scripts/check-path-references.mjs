#!/usr/bin/env node
/**
 * check-path-references.mjs — stale-API-path reference detector.
 *
 * Customer-facing docs cite concrete REST paths (e.g. `POST /v1/exemptions`,
 * `GET /v1/agents/{agent_id}/alignment-card`). When an endpoint is removed or
 * deprecated in the OpenAPI spec, the prose that still tells a reader to call
 * it becomes a lie that `mint broken-links` cannot catch — it only validates
 * in-content LINKS, never API-path TOKENS embedded in prose/code samples.
 * This script closes that gap.
 *
 * It:
 *   1. Loads the OpenAPI document from disk (OFFLINE — never fetches) and
 *      builds a set of path TEMPLATES (`/agents/{agent_id}/claim`) plus a flag
 *      for each on whether every operation on that path is `deprecated: true`.
 *   2. Greps the customer-facing MDX/MD surface (guides/, concepts/,
 *      specifications/, quickstart/, gateway/, protocols/ + introduction &
 *      changelog) for API-path-shaped tokens — both `/v1/<path>` and bare
 *      `/<resource>/<...>` forms — and NORMALIZES them:
 *        · Full URLs are host-scoped: only `https://api.mnemom.ai/...` paths
 *          are considered API references. URLs to any OTHER host
 *          (gateway.mnemom.ai proxying Anthropic, trust.mnemom.ai public
 *          pages, www.mnemom.ai, example.com, npm, …) are dropped — they are
 *          not this API's surface.
 *        · The `/v1` server-prefix is stripped so tokens align with spec
 *          paths (whose server base is `https://api.mnemom.ai/v1`).
 *        · Bare `/<seg>/…` tokens are only treated as API references when the
 *          first segment is an actual spec resource — this excludes internal
 *          doc links (`/concepts/…`, `/guides/…`, `/specifications/…`).
 *        · Prose/glob/garbage tokens are rejected (trailing-slash prefixes,
 *          `*` globs, malformed `{`/`}`, ellipses, source-file paths ending in
 *          `.ts`/`.py`/…).
 *   3. Classifies each reference against the spec by STRUCTURAL match (a spec
 *      `{param}` — or a doc `{id}`/`:id`/example-id — matches any segment):
 *        · matches an active op            → OK (silent)
 *        · matches only deprecated op(s)   → WARN
 *        · matches NO op at all            → would-be FAIL (removed/unknown)
 *      References whose normalized key is in the curated allowlist
 *      (path-references-allowlist.json — intentionally-illustrative paths and
 *      public non-API surfaces) are excluded.
 *
 * ADVISORY BY DEFAULT: the docs legitimately reference many example and
 * out-of-REST-spec paths, so a plain run REPORTS the WARN/would-be-FAIL counts
 * and exits 0. Pass `--strict` to exit 1 when any un-allowlisted reference
 * matches NO op (the "removed endpoint still documented" failure). Deprecated
 * references are always warnings, never a failure.
 *
 * Sibling to check-redirects.mjs / check-nav-pages.mjs; same contract:
 *   Exits 0 on clean/advisory. Exits 1 on strict failure, a spec read error,
 *   or a failed self-test. Exits 2 on bad CLI usage.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { argv, env, exit } from "node:process";

// ── Configuration ────────────────────────────────────────────────────────────
// The one host that IS this API's surface. A `/v1/...` path only counts as an
// API reference when it is bare/relative or rooted at this host; paths inside a
// URL to any other host are a different surface (the Anthropic gateway proxy,
// the public trust site, marketing links, npm, …) and are ignored.
const API_HOST = "api.mnemom.ai";

// Directories + standalone files that make up the customer-facing doc surface
// this gate scans. Resolved relative to the docs root.
const SCOPE_DIRS = [
  "guides",
  "concepts",
  "specifications",
  "quickstart",
  "gateway",
  "protocols",
];
const SCOPE_FILES = ["introduction.mdx", "changelog.mdx"];

// HTTP methods whose presence on a path item makes it an operation.
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"];

// A last segment ending in one of these is a source/content file path, not an
// API path. `.json` and `.svg` are intentionally EXCLUDED from this list —
// real API paths end in them (`.well-known/jwks.json`, `/reputation/{id}/badge.svg`).
const CODE_FILE_EXT =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|sh|bash|zsh|md|mdx|css|scss|sass|less|html|htm|xml|yaml|yml|toml|ini|lock|txt|env|sql|proto|graphql)$/i;

// ── Spec index ───────────────────────────────────────────────────────────────
// Reads the OpenAPI doc from disk and returns { templates, resourceSet }.
//   templates: [{ segs: string[], deprecated: boolean }]
//   resourceSet: Set<string> of first path segments (spec resources)
export function buildSpecIndex(specPath) {
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const paths = spec.paths ?? {};
  const templates = [];
  const resourceSet = new Set();
  for (const [p, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    const segs = p.replace(/^\/+/, "").split("/").filter(Boolean);
    if (segs.length === 0) continue;
    resourceSet.add(segs[0]);
    let anyOp = false;
    let allDeprecated = true;
    for (const m of HTTP_METHODS) {
      if (item[m] && typeof item[m] === "object") {
        anyOp = true;
        if (item[m].deprecated !== true) allDeprecated = false;
      }
    }
    // A path is "deprecated" if the path item itself is flagged, or it has
    // operations and every one of them is deprecated.
    const deprecated = item.deprecated === true || (anyOp && allDeprecated);
    templates.push({ segs, deprecated });
  }
  return { templates, resourceSet };
}

// ── Reference extraction ─────────────────────────────────────────────────────
const isParamSeg = (s) => /^\{[^/{}]+\}$/.test(s) || /^:[A-Za-z_]/.test(s);
const hasAlnum = (s) => /[A-Za-z0-9]/.test(s);

// Normalized dedup/allowlist key: params collapse to `{}`, everything else
// literal. `/agents/{id}/x`, `/agents/{agent_id}/x`, `/agents/:id/x` all key to
// `/agents/{}/x`.
export const keyOf = (segs) =>
  "/" + segs.map((s) => (isParamSeg(s) ? "{}" : s)).join("/");

// Pull candidate API-path references out of one document's text.
// Returns an array of segment arrays (already `/v1`-stripped, cleaned).
export function extractRefs(text, resourceSet) {
  // 1) Neutralize full URLs: an api.mnemom.ai URL is reduced to its bare path
  //    (so it is scanned like a relative reference); every other-host URL is
  //    dropped to whitespace so its path can't be mistaken for this API.
  const scan = text.replace(
    /https?:\/\/([^/\s)"'`\]>]+)([^\s)"'`\]>]*)/g,
    (_m, host, path) => (host === API_HOST && path ? ` ${path} ` : " "),
  );

  const refs = [];
  // Token: optional /v1 prefix, then a path whose first segment starts with a
  // letter (so `//`, `/{`, `/-`, relative `/./` are not starts), optional
  // trailing slash (captured so we can reject prose prefixes).
  const re = /\/(?:v1\/)?[A-Za-z][A-Za-z0-9_.:{}\-]*(?:\/[A-Za-z0-9_.:{}\-]+)*\/?/g;
  for (const m of scan.matchAll(re)) {
    const raw = m[0];
    if (raw.endsWith("/")) continue; // trailing-slash = prefix/glob prose
    if (raw.includes("*")) continue; // wildcard glob

    const isV1 = raw.startsWith("/v1/");
    let core = isV1 ? raw.slice(3) : raw; // strip the /v1 server prefix
    core = core.split(/[#?]/)[0].replace(/[.,;:!)]+$/, ""); // drop #frag/?query + trailing punct
    const segs = core.replace(/^\/+/, "").split("/").filter(Boolean);
    if (segs.length === 0) continue;

    // Reject garbage: a segment with no alphanumerics (`...`), or a malformed
    // brace segment (`{orgs`, `alignment}`) — a clean `{param}` is allowed.
    if (segs.some((s) => !hasAlnum(s))) continue;
    if (
      segs.some(
        (s) => (s.includes("{") || s.includes("}")) && !/^\{[^/{}]+\}$/.test(s),
      )
    )
      continue;
    // Source/content file path, not an API path.
    if (CODE_FILE_EXT.test(segs[segs.length - 1])) continue;

    if (!isV1) {
      // Bare/relative: require ≥2 segments AND a real spec resource up front,
      // else it's an internal doc link (/concepts/…) or ordinary prose.
      if (segs.length < 2) continue;
      if (!resourceSet.has(segs[0])) continue;
    }
    refs.push(segs);
  }
  return refs;
}

// ── Classification ───────────────────────────────────────────────────────────
// A doc segment matches a spec segment when either side is a parameter, or the
// literals are equal. Returns "ok" | "deprecated" | "unknown".
export function classifyRef(segs, templates) {
  let matched = false;
  let deprecated = false;
  for (const t of templates) {
    if (t.segs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const d = segs[i];
      const s = t.segs[i];
      if (isParamSeg(s) || isParamSeg(d) || d === s) continue;
      ok = false;
      break;
    }
    if (!ok) continue;
    matched = true;
    if (t.deprecated) {
      deprecated = true;
    } else {
      // An active op wins outright — the reference is fine.
      return "ok";
    }
  }
  if (!matched) return "unknown";
  return deprecated ? "deprecated" : "ok";
}

// ── Allowlist ────────────────────────────────────────────────────────────────
// JSON of the shape { "allow": [{ "path": "/trust/slos", "reason": "…" }, …] }.
// A missing file is tolerated (empty allowlist). Params in an allow entry may
// be written as `{}` or a named `{param}` — both normalize to the same key.
export function loadAllowlist(allowlistPath) {
  if (!allowlistPath || !existsSync(allowlistPath)) return new Set();
  const raw = JSON.parse(readFileSync(allowlistPath, "utf8"));
  const entries = Array.isArray(raw) ? raw : (raw.allow ?? []);
  const set = new Set();
  for (const e of entries) {
    const p = typeof e === "string" ? e : e?.path;
    if (typeof p !== "string" || p === "") continue;
    const noV1 = p.startsWith("/v1/") ? p.slice(3) : p;
    const segs = noV1.split(/[#?]/)[0].replace(/^\/+/, "").split("/").filter(Boolean);
    if (segs.length) set.add(keyOf(segs));
  }
  return set;
}

// ── Core check (exported for --self-test) ────────────────────────────────────
// Scans the docs root and returns a structured result. Pure of process.exit /
// console so it can be exercised against throwaway fixtures.
export function checkPathReferences({ docsRoot, specPath, allowlistPath }) {
  const { templates, resourceSet } = buildSpecIndex(specPath);
  const allow = loadAllowlist(allowlistPath);

  // Collect the in-scope MD/MDX files.
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith(".mdx") || entry.endsWith(".md")) files.push(p);
    }
  };
  for (const d of SCOPE_DIRS) walk(resolve(docsRoot, d));
  for (const f of SCOPE_FILES) {
    const p = resolve(docsRoot, f);
    if (existsSync(p)) files.push(p);
  }

  const deprecated = new Map(); // key → Set<relFile>
  const unknown = new Map();
  const allowlisted = new Map();
  let okCount = 0;

  for (const file of files) {
    const rel = file.slice(docsRoot.length).replace(/^[/\\]+/, "");
    const text = readFileSync(file, "utf8");
    for (const segs of extractRefs(text, resourceSet)) {
      const cls = classifyRef(segs, templates);
      if (cls === "ok") {
        okCount++;
        continue;
      }
      const key = keyOf(segs);
      const bucket = allow.has(key)
        ? allowlisted
        : cls === "deprecated"
          ? deprecated
          : unknown;
      if (!bucket.has(key)) bucket.set(key, new Set());
      bucket.get(key).add(rel);
    }
  }

  const finalize = (map) =>
    [...map.entries()]
      .map(([path, fileSet]) => ({ path, files: [...fileSet].sort() }))
      .sort((a, b) => b.files.length - a.files.length || a.path.localeCompare(b.path));

  return {
    scanned: files.length,
    ok: okCount,
    deprecated: finalize(deprecated),
    unknown: finalize(unknown),
    allowlisted: finalize(allowlisted),
  };
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Builds a throwaway spec + docs + allowlist in a temp dir and asserts the gate
// classifies each reference class correctly.
function selfTest() {
  let pass = 0;
  let fail = 0;
  const assert = (name, cond) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.error(`  ✗ ${name}`);
    }
  };

  const root = mkdtempSync(join(tmpdir(), "path-refs-selftest-"));

  // Minimal spec: one active op, one path that is deprecated on every method.
  const spec = {
    openapi: "3.1.0",
    servers: [{ url: "https://api.mnemom.ai/v1" }],
    paths: {
      "/agents/{agent_id}/claim": { post: {} },
      "/agents/{agent_id}/alignment-card": {
        get: { deprecated: true },
        put: { deprecated: true },
      },
      "/reputation/{agent_id}/badge.svg": { get: {} },
      // Makes `trust` a spec resource so a bare `/trust/slos` reference is
      // extracted (and then allowlist-suppressed); there is deliberately no
      // `/trust/slos` op, so it classifies as unknown before the allowlist.
      "/trust/iocs": { get: {} },
    },
  };
  const specPath = join(root, "openapi.json");
  writeFileSync(specPath, JSON.stringify(spec));

  const allowlistPath = join(root, "allow.json");
  writeFileSync(
    allowlistPath,
    JSON.stringify({ allow: [{ path: "/trust/slos", reason: "public page, not an API op" }] }),
  );

  const mkdoc = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };

  // guides/mix.mdx exercises every class in one file.
  mkdoc(
    "guides/mix.mdx",
    [
      "Claim it: `POST /v1/agents/agent-xyz/claim` — an active op (example id).", // OK (wildcard match)
      "Legacy: `GET /v1/agents/{agent_id}/alignment-card` is deprecated.", // WARN (deprecated)
      "Removed: call `POST /v1/exemptions` to grant one.", // FAIL (no op)
      "Badge: https://api.mnemom.ai/v1/reputation/agent-1/badge.svg renders it.", // OK (api-host URL)
      "Proxy: POST https://gateway.mnemom.ai/anthropic/v1/messages (Anthropic).", // ignored (foreign host)
      "SLOs published at [`/trust/slos`](https://trust.mnemom.ai/slos).", // allowlisted
      "See [the concepts page](/concepts/agent-cards) for the model.", // ignored (doc slug, not a resource)
      "Under `/v1/agents/{agent_id}/*` live the sub-resources.", // ignored (glob)
      "Source lives in `/agents/preview-surface.ts` for the curious.", // ignored (code file)
    ].join("\n\n"),
  );

  const r = checkPathReferences({ docsRoot: root, specPath, allowlistPath });

  const hasUnknown = (p) => r.unknown.some((u) => u.path === p);
  const hasDeprecated = (p) => r.deprecated.some((d) => d.path === p);
  const hasAllow = (p) => r.allowlisted.some((a) => a.path === p);

  assert("scanned the one in-scope file", r.scanned === 1);
  assert("active op reference → OK (>=2 counted: claim + badge)", r.ok >= 2);
  assert("removed path /exemptions → would-be FAIL", hasUnknown("/exemptions"));
  assert(
    "deprecated alignment-card → WARN",
    hasDeprecated("/agents/{}/alignment-card"),
  );
  assert(
    "deprecated ref is NOT reported as unknown",
    !hasUnknown("/agents/{}/alignment-card"),
  );
  assert("allowlisted /trust/slos is suppressed from findings", !hasUnknown("/trust/slos"));
  assert("allowlisted /trust/slos is bucketed as allowlisted", hasAllow("/trust/slos"));
  assert(
    "foreign-host gateway/Anthropic path is ignored",
    !hasUnknown("/messages") && !hasUnknown("/anthropic/v1/messages"),
  );
  assert(
    "internal doc slug /concepts/agent-cards is ignored",
    !hasUnknown("/concepts/agent-cards"),
  );
  assert("glob /agents/{}/* is ignored", !hasUnknown("/agents/{}"));
  assert(
    "code-file path /agents/preview-surface.ts is ignored",
    !hasUnknown("/agents/preview-surface.ts"),
  );

  // Clean doc: only active-op references → nothing flagged.
  const cleanRoot = mkdtempSync(join(tmpdir(), "path-refs-clean-"));
  writeFileSync(join(cleanRoot, "openapi.json"), JSON.stringify(spec));
  const cleanDocAbs = join(cleanRoot, "guides", "clean.mdx");
  mkdirSync(dirname(cleanDocAbs), { recursive: true });
  writeFileSync(
    cleanDocAbs,
    "Only good refs: `POST /v1/agents/a-1/claim` and `/v1/reputation/a-1/badge.svg`.",
  );
  const rc = checkPathReferences({
    docsRoot: cleanRoot,
    specPath: join(cleanRoot, "openapi.json"),
    allowlistPath: null, // tolerate a missing allowlist
  });
  assert("clean docs → 0 unknown, 0 deprecated", rc.unknown.length === 0 && rc.deprecated.length === 0);
  assert("clean docs → active refs counted as OK", rc.ok >= 2);
  assert("missing allowlist file is tolerated (empty)", rc.allowlisted.length === 0);

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(
    [
      "Usage: check-path-references.mjs [options]",
      "",
      "Detects customer-facing MDX/MD that references API paths which are",
      "deprecated (WARN) or absent from the OpenAPI spec (would-be FAIL).",
      "",
      "Options:",
      "  --root <dir>        Docs root (default: repo root, resolved from scripts/).",
      "  --docs <dir>        Alias for --root.",
      "  --spec <path>       OpenAPI JSON path (default: <root>/api-reference/openapi.json;",
      "                      overridable via OPENAPI_SPEC_PATH env).",
      "  --allowlist <path>  Allowlist JSON (default: scripts/path-references-allowlist.json).",
      "  --strict            Exit 1 when any un-allowlisted reference matches NO op.",
      "                      (Deprecated references are always warnings, never a failure.)",
      "  --verbose           Also list allowlisted references and per-file locations.",
      "  --self-test         Run built-in fixtures and exit.",
      "  --help, -h          Show this help.",
      "",
      "ADVISORY BY DEFAULT: without --strict the script reports counts and exits 0.",
    ].join("\n"),
  );
}

function main() {
  const args = argv.slice(2);
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultRoot = resolve(scriptDir, "..");
  let root = defaultRoot;
  let specPath = null;
  let allowlistPath = null;
  let strict = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const need = (flag) => {
      if (i + 1 >= args.length) {
        console.error(`${flag} requires a path argument`);
        exit(2);
      }
      return args[++i];
    };
    if (a === "--self-test") exit(selfTest() ? 0 : 1);
    else if (a === "--strict") strict = true;
    else if (a === "--verbose") verbose = true;
    else if (a === "--root" || a === "--docs") root = resolve(need(a));
    else if (a === "--spec") specPath = resolve(need(a));
    else if (a === "--allowlist") allowlistPath = resolve(need(a));
    else if (a === "--help" || a === "-h") {
      printHelp();
      exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      exit(2);
    }
  }

  if (!specPath) {
    specPath = env.OPENAPI_SPEC_PATH
      ? resolve(env.OPENAPI_SPEC_PATH)
      : resolve(root, "api-reference/openapi.json");
  }
  if (!allowlistPath) {
    allowlistPath = resolve(scriptDir, "path-references-allowlist.json");
  }

  if (!existsSync(specPath)) {
    console.error(
      `✗ OpenAPI spec not found at ${specPath} (set --spec or OPENAPI_SPEC_PATH).`,
    );
    exit(1);
  }

  let result;
  try {
    result = checkPathReferences({ docsRoot: root, specPath, allowlistPath });
  } catch (err) {
    console.error(`✗ check-path-references failed: ${err.message}`);
    exit(1);
  }

  const { scanned, ok, deprecated, unknown, allowlisted } = result;

  if (deprecated.length > 0) {
    console.log(
      `\n⚠ ${deprecated.length} reference(s) to DEPRECATED API path(s):`,
    );
    for (const d of deprecated)
      console.log(`  - ${d.path}  (${d.files.length} file(s)${verbose ? `: ${d.files.join(", ")}` : ""})`);
  }
  if (unknown.length > 0) {
    const label = strict ? "FAIL" : "would-be FAIL";
    console.log(
      `\n${strict ? "✗" : "⚠"} ${unknown.length} reference(s) to path(s) matching NO op — removed/unknown (${label}):`,
    );
    for (const u of unknown)
      console.log(`  - ${u.path}  (${u.files.length} file(s)${verbose ? `: ${u.files.join(", ")}` : ""})`);
  }
  if (verbose && allowlisted.length > 0) {
    console.log(`\n· ${allowlisted.length} allowlisted reference(s) (suppressed):`);
    for (const a of allowlisted)
      console.log(`  - ${a.path}  (${a.files.length} file(s): ${a.files.join(", ")})`);
  }

  console.log(
    `\nscanned ${scanned} doc(s); ${ok} OK ref(s), ${deprecated.length} deprecated, ${unknown.length} unknown, ${allowlisted.length} allowlisted.`,
  );

  if (strict && unknown.length > 0) {
    console.error(
      `\n✗ check-path-references (--strict): ${unknown.length} reference(s) point at a removed/unknown API path.`,
    );
    exit(1);
  }
  console.log(
    strict
      ? "✓ check-path-references: no references to removed/unknown API paths."
      : "✓ check-path-references: advisory run (exit 0). Use --strict to enforce.",
  );
  exit(0);
}

// Run the CLI only when executed directly (`node check-path-references.mjs …`),
// not when imported — so the exported core functions can be unit-exercised.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
