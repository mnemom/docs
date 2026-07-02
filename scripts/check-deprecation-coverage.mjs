#!/usr/bin/env node
/**
 * check-deprecation-coverage.mjs — deprecated-spec-op ↔ changelog coverage auditor.
 *
 * When an operation is marked `deprecated: true` in api-reference/openapi.json,
 * two things SHOULD accompany it so a customer isn't left stranded:
 *
 *   (a) a CHANGELOG mention — the deprecation is announced in changelog.mdx so
 *       readers browsing "what changed" learn the path is on its way out; and
 *   (b) a REPLACEMENT hint in the op's own prose — an `x-sunset`/`x-deprecation`
 *       extension, or description text that says where to go instead
 *       ("redirects to `/v1/…`", "use `/v2/…` instead", a `Sunset:` date, …).
 *
 * Nothing in the toolchain checks either today. A path can be flipped to
 * `deprecated: true` and ship with no changelog note and no forwarding hint —
 * silently, no build error. This script closes that gap: it enumerates every
 * deprecated op, checks both coverage axes, and prints a table
 * (op | changelog-mention | replacement-hint).
 *
 * ADVISORY BY DEFAULT. On the current tree several deprecated paths are not yet
 * covered (they predate this gate), so a hard failure would red the build on
 * main. The default run therefore ALWAYS exits 0 — it is a report, and the gaps
 * it surfaces ARE the point. Pass `--strict` to make any uncovered deprecated op
 * a failure (exit 1); that is the intended promotion once the backlog is burned
 * down. `--self-test` runs in-memory-fixture assertions.
 *
 * Sibling to check-redirects.mjs / check-nav-coverage.mjs / check-internal-refs.mjs;
 * same contract: exits 0 on clean/advisory, 1 on failure (--strict only) or a
 * read/parse error, 2 on bad CLI usage. Node built-ins only (no deps). OFFLINE —
 * reads openapi.json + changelog.mdx from disk, no network.
 */

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

// HTTP methods that carry an OpenAPI Operation Object (per the 3.x spec). Any
// other key under a path item (parameters, $ref, servers, summary…) is NOT an
// operation and must not be scanned for `deprecated`.
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

// ── Coverage detectors ───────────────────────────────────────────────────────

// The prose we scan for a replacement hint: description first, summary as a
// fallback. (Params/responses aren't forwarding hints, so we don't scan them.)
const opProse = (op) => `${op.description ?? ""}\n${op.summary ?? ""}`;

// Replacement-hint rules, each labelled for --verbose output. An op is
// considered to carry a replacement hint if ANY rule matches. The first two are
// the structured OpenAPI signals (`x-sunset` / `x-deprecation` extensions); the
// rest are prose patterns that name where a caller should go instead. Kept as a
// transparent, ordered list so the "why" is auditable and the set is easy to
// tighten when this gate is promoted to --strict.
const HINT_RULES = [
  ["x-sunset extension", (op) => op["x-sunset"] != null && op["x-sunset"] !== ""],
  ["x-deprecation extension", (op) => op["x-deprecation"] != null && op["x-deprecation"] !== ""],
  ["x-deprecat*/x-sunset* extension", (op) => Object.keys(op).some((k) => /^x-(sunset|deprecat)/i.test(k))],
  ["redirects to <path>", (op) => /\bredirects?\b[\s\S]{0,80}?\bto\b\s*`?\/?[a-z0-9{}._/-]+/i.test(opProse(op))],
  ["use/consume/prefer … instead", (op) => /\b(use|consume|adopt|call|prefer|switch to)\b[\s\S]{0,140}?\binstead\b/i.test(opProse(op))],
  ["Sunset date / sunsetting", (op) => /\bsunset(?:ting|s|:)?\b/i.test(opProse(op))],
  ["replaced by / superseded by", (op) => /\b(replaced?|superseded)\b[\s\S]{0,40}?\bby\b/i.test(opProse(op))],
  ["migrate to", (op) => /\bmigrate\b[\s\S]{0,40}?\bto\b/i.test(opProse(op))],
  ["see <replacement>", (op) => /\bsee\b\s+[`\[]?[a-z_][a-z0-9_./{}-]{2,}/i.test(opProse(op))],
];

// Which hint rules fire for an op (labels). Empty array ⇒ no replacement hint.
export function replacementHintReasons(op) {
  return HINT_RULES.filter(([, test]) => test(op)).map(([label]) => label);
}

// Normalize a path template so param-name differences don't cause misses:
// `/agents/{agent_id}/x` and `/agents/{id}/x` both → `/agents/{}/x`. Also
// lowercases and drops any trailing slash. Handles both `{param}` and `:param`.
export function normalizePath(p) {
  return String(p)
    .toLowerCase()
    .replace(/\{[^}]*\}/g, "{}")
    .replace(/:[a-z0-9_]+/gi, "{}")
    .replace(/\/+$/, "");
}

// Does the changelog reference this path? We match the param-normalized path as
// a whole path token — bounded so a shorter path is NOT counted as "mentioned"
// merely because a LONGER path that contains it appears (e.g. mentioning
// `/x/{}/card/preview-compose` must not credit `/x/{}/card`). The boundary
// requires the char before the match to be a non-path char (start, whitespace,
// backtick, quote, paren, `(`…) and the char after to not continue the path
// (`/`, `-`, word char). The changelog is normalized the same way so its
// `{id}` placeholders line up with the spec's `{agent_id}`.
export function changelogMentionsPath(normChangelog, path) {
  const norm = normalizePath(path);
  if (!norm) return false;
  const esc = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\w/-])${esc}(?![\\w/-])`);
  return re.test(normChangelog);
}

// ── Pure analysis (no fs) ─────────────────────────────────────────────────────
// Given a parsed OpenAPI object and the raw changelog text, enumerate every
// deprecated operation and evaluate both coverage axes. Returns:
//   { rows, deprecatedOps, uniquePaths, coveredOps, warnOps,
//     opsMissingChangelog, opsMissingHint, pathsMissingChangelog }
// where each row is
//   { path, method, operationId, hasChangelogMention, hasReplacementHint,
//     hintReasons, covered }.
// An op is "covered" iff it has BOTH a changelog mention AND a replacement hint;
// any op that is not covered is a WARN row.
export function analyzeDeprecationCoverage(openapi, changelogText) {
  const normChangelog = normalizePath(String(changelogText ?? ""));
  const paths = (openapi && openapi.paths) || {};

  const rows = [];
  for (const path of Object.keys(paths).sort()) {
    const item = paths[path];
    if (!item || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op !== "object" || op.deprecated !== true) continue;

      const hasChangelogMention = changelogMentionsPath(normChangelog, path);
      const hintReasons = replacementHintReasons(op);
      const hasReplacementHint = hintReasons.length > 0;
      rows.push({
        path,
        method: method.toUpperCase(),
        operationId: op.operationId ?? "",
        hasChangelogMention,
        hasReplacementHint,
        hintReasons,
        covered: hasChangelogMention && hasReplacementHint,
      });
    }
  }

  const uniquePaths = new Set(rows.map((r) => r.path));
  const pathsMissingChangelog = new Set(
    rows.filter((r) => !r.hasChangelogMention).map((r) => r.path),
  );
  return {
    rows,
    deprecatedOps: rows.length,
    uniquePaths: uniquePaths.size,
    coveredOps: rows.filter((r) => r.covered).length,
    warnOps: rows.filter((r) => !r.covered).length,
    opsMissingChangelog: rows.filter((r) => !r.hasChangelogMention).length,
    opsMissingHint: rows.filter((r) => !r.hasReplacementHint).length,
    pathsMissingChangelog: pathsMissingChangelog.size,
  };
}

// ── fs wrapper ─────────────────────────────────────────────────────────────────
// Reads + parses the OpenAPI spec and the changelog from disk, then analyzes.
export function checkDeprecationCoverage(openapiPath, changelogPath) {
  const openapi = JSON.parse(readFileSync(openapiPath, "utf8"));
  const changelogText = readFileSync(changelogPath, "utf8");
  return analyzeDeprecationCoverage(openapi, changelogText);
}

// ── Reporting ──────────────────────────────────────────────────────────────────
const yn = (b) => (b ? "yes" : "NO");

function printTable(rows) {
  if (rows.length === 0) {
    console.log("  (no deprecated operations found)");
    return;
  }
  const header = { op: "OP", cl: "CHANGELOG", hint: "REPLACEMENT-HINT" };
  const cell = (r) => ({ op: `${r.method} ${r.path}`, cl: yn(r.hasChangelogMention), hint: yn(r.hasReplacementHint) });
  const cells = rows.map(cell);
  const opW = Math.max(header.op.length, ...cells.map((c) => c.op.length));
  const clW = Math.max(header.cl.length, ...cells.map((c) => c.cl.length));
  const pad = (s, w) => s + " ".repeat(w - s.length);
  console.log(`  ${pad(header.op, opW)}  ${pad(header.cl, clW)}  ${header.hint}`);
  console.log(`  ${"-".repeat(opW)}  ${"-".repeat(clW)}  ${"-".repeat(header.hint.length)}`);
  for (let i = 0; i < rows.length; i++) {
    const c = cells[i];
    const mark = rows[i].covered ? " " : "!";
    console.log(`${mark} ${pad(c.op, opW)}  ${pad(c.cl, clW)}  ${c.hint}`);
  }
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Writes throwaway openapi.json + changelog.mdx fixtures to a temp dir and
// asserts: a deprecated op with no changelog mention and no replacement hint is
// a WARN row; a deprecated op that is both changelog-mentioned and carries a
// "use … instead" hint is clean/covered; a non-deprecated op is ignored; and the
// path-boundary guard prevents a shorter path from being credited by a longer
// path's mention.
function selfTest() {
  let pass = 0;
  let fail = 0;
  const assert = (name, cond) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}`); }
  };

  const root = mkdtempSync(join(tmpdir(), "deprecation-coverage-selftest-"));
  const openapiPath = join(root, "openapi.json");
  const changelogPath = join(root, "changelog.mdx");
  mkdirSync(root, { recursive: true });

  const fixture = {
    openapi: "3.1.0",
    paths: {
      // Deprecated, no changelog mention, no replacement hint → WARN (both NO).
      "/foo": {
        get: { operationId: "getFooLegacy", deprecated: true, description: "The old foo listing." },
      },
      // Deprecated, changelog-mentioned + "use … instead" hint → covered/clean.
      "/bar": {
        get: { operationId: "getBar", deprecated: true, description: "Legacy bar. Use `/v2/bar` instead." },
      },
      // NOT deprecated → must be excluded from the table entirely.
      "/baz": {
        get: { operationId: "getBaz", description: "A perfectly current endpoint." },
      },
      // Deprecated, no hint; changelog only mentions the LONGER `/qux/extra`
      // path → the boundary guard must NOT credit `/qux` with a mention.
      "/qux": {
        get: { operationId: "getQux", deprecated: true, description: "Legacy qux." },
      },
    },
  };
  writeFileSync(openapiPath, JSON.stringify(fixture, null, 2));
  writeFileSync(
    changelogPath,
    [
      "---", "title: Changelog", "---", "",
      "## Bar v2",
      "The `/bar` endpoint is deprecated; migrate to `/v2/bar`.", "",
      "## Qux nesting",
      "Only the nested `/qux/extra` path changed here.", "",
    ].join("\n"),
  );

  const r = checkDeprecationCoverage(openapiPath, changelogPath);

  assert("only deprecated ops appear in the table (3 rows, /baz excluded)", r.deprecatedOps === 3);
  assert("no current (non-deprecated) op leaks in", !r.rows.some((x) => x.operationId === "getBaz"));

  const foo = r.rows.find((x) => x.path === "/foo");
  assert("/foo: no changelog mention", foo && foo.hasChangelogMention === false);
  assert("/foo: no replacement hint", foo && foo.hasReplacementHint === false);
  assert("/foo: is a WARN row (not covered)", foo && foo.covered === false);

  const bar = r.rows.find((x) => x.path === "/bar");
  assert("/bar: changelog mention detected", bar && bar.hasChangelogMention === true);
  assert("/bar: replacement hint detected", bar && bar.hasReplacementHint === true);
  assert("/bar: covered (clean)", bar && bar.covered === true);

  const qux = r.rows.find((x) => x.path === "/qux");
  assert("/qux: boundary guard — longer path mention does NOT credit /qux", qux && qux.hasChangelogMention === false);
  assert("/qux: is a WARN row", qux && qux.covered === false);

  assert("aggregate: 1 covered op", r.coveredOps === 1);
  assert("aggregate: 2 WARN ops", r.warnOps === 2);
  assert("aggregate: 2 ops missing changelog mention", r.opsMissingChangelog === 2);
  assert("aggregate: 2 ops missing replacement hint", r.opsMissingHint === 2);

  // Detector unit checks (pure fns, no fixtures).
  assert("normalizePath collapses param names", normalizePath("/a/{agent_id}/b") === normalizePath("/a/{id}/b"));
  assert("changelogMentionsPath matches param-normalized path", changelogMentionsPath(normalizePath("see `/a/{id}/b` now"), "/a/{agent_id}/b"));
  assert("changelogMentionsPath rejects a longer-path-only mention", !changelogMentionsPath(normalizePath("only `/a/{id}/b/c`"), "/a/{id}/b"));
  assert("replacementHintReasons detects a redirect-to hint", replacementHintReasons({ description: "Permanently redirects (HTTP 308) to `/v1/x`." }).length > 0);
  assert("replacementHintReasons detects an x-sunset extension", replacementHintReasons({ "x-sunset": "2027-01-15" }).length > 0);
  assert("replacementHintReasons empty for plain prose", replacementHintReasons({ description: "Get a single evaluation." }).length === 0);

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const args = argv.slice(2);
  let verbose = false;
  let strict = false;
  let openapiPath = fileURLToPath(new URL("../api-reference/openapi.json", import.meta.url));
  let changelogPath = fileURLToPath(new URL("../changelog.mdx", import.meta.url));
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verbose") verbose = true;
    else if (args[i] === "--strict") strict = true;
    else if (args[i] === "--self-test") {
      exit(selfTest() ? 0 : 1);
    } else if (args[i] === "--openapi") {
      if (i + 1 >= args.length) { console.error("--openapi requires a path argument"); exit(2); }
      openapiPath = args[++i];
    } else if (args[i] === "--changelog") {
      if (i + 1 >= args.length) { console.error("--changelog requires a path argument"); exit(2); }
      changelogPath = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(
        "Usage: check-deprecation-coverage.mjs [--openapi path] [--changelog path] [--strict] [--verbose] [--self-test]\n" +
          "\n" +
          "  Audits every `deprecated: true` operation in the OpenAPI spec for two\n" +
          "  coverage axes: a mention in changelog.mdx, and a replacement hint in the\n" +
          "  op's own prose (x-sunset/x-deprecation extension or 'redirects to'/'use …\n" +
          "  instead'/'Sunset:' text). Advisory by default (always exits 0). --strict\n" +
          "  makes any uncovered deprecated op a failure (exit 1).",
      );
      exit(0);
    } else {
      console.error(`Unknown flag: ${args[i]}`);
      exit(2);
    }
  }

  let result;
  try {
    result = checkDeprecationCoverage(openapiPath, changelogPath);
  } catch (err) {
    console.error(`✗ Could not read/parse inputs: ${err.message}`);
    exit(1);
  }

  console.log(
    `\nDeprecation coverage — ${result.deprecatedOps} deprecated operation(s) across ${result.uniquePaths} path(s):\n`,
  );
  printTable(result.rows);

  if (verbose) {
    for (const r of result.rows) {
      if (r.hintReasons.length) console.log(`    · ${r.method} ${r.path} hint: ${r.hintReasons.join(", ")}`);
    }
  }

  console.log(
    `\nSummary: ${result.coveredOps}/${result.deprecatedOps} op(s) fully covered; ` +
      `${result.opsMissingChangelog} lack a changelog mention ` +
      `(${result.pathsMissingChangelog}/${result.uniquePaths} unique path(s)); ` +
      `${result.opsMissingHint} lack a replacement hint.`,
  );

  if (result.warnOps === 0) {
    console.log(`✓ check-deprecation-coverage: every deprecated op is changelog-mentioned and carries a replacement hint.`);
    exit(0);
  }

  if (strict) {
    console.error(
      `\n✗ check-deprecation-coverage (--strict): ${result.warnOps} deprecated op(s) are not fully covered ` +
        `(need a changelog mention AND a replacement hint).`,
    );
    exit(1);
  }

  console.warn(
    `\n⚠ check-deprecation-coverage: ${result.warnOps} deprecated op(s) are not fully covered ` +
      `(advisory — announce them in changelog.mdx and add a replacement hint to the spec op). ` +
      `Run with --strict to make this blocking.`,
  );
  exit(0);
}

main();
