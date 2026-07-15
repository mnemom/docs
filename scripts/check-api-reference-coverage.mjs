#!/usr/bin/env node
/**
 * check-api-reference-coverage.mjs — api-reference page <-> spec reconciliation.
 *
 * `generate-api-reference.mjs` projects the committed customer-facing OpenAPI
 * slice (api-reference/openapi.json) into Mintlify endpoint pages, but it only
 * ever ADDS/REFRESHES pages for ops that currently exist in the spec. It never
 * RECONCILES the two directions, so two kinds of drift can ship silently:
 *
 *   Direction 1 — ORPHAN pages (page -> spec). An endpoint page can carry an
 *     `openapi: "METHOD /path"` directive that resolves to NO operation in the
 *     committed spec (e.g. the four get/post/put/delete-admin-security-advisories
 *     pages pointing at the staff-only /admin/security/advisories path). Mintlify
 *     renders such a directive as a broken/empty reference page.
 *   Direction 2 — UNCOVERED ops (spec -> page). A spec op can have NO page at
 *     all. Some absences are deliberate (deprecated / HELD / NON_API /
 *     dashboard-session CookieAuth-only); others are accidental gaps. Without a
 *     machine-checkable distinction a genuinely-missing customer endpoint reads
 *     the same as a deliberate exclusion.
 *
 * This auditor reconciles both directions against the SAME committed spec the
 * pages were generated from, mirroring the generator's directive / exclusion
 * conventions exactly (see the "keep in sync" note below).
 *
 * BLOCKING BY DEFAULT. The live tree is already reconciled (the four orphan pages
 * were removed by MNE-982/PR#265; the two GDPR hand-written pages are
 * allowlisted), so this gate can be strict from day one: exit 1 on ANY orphan,
 * gap, or stale-allowlist entry. `--self-test` runs throwaway-fixture assertions
 * for both directions.
 *
 * Sibling to check-deprecation-coverage.mjs / check-nav-coverage.mjs; same
 * contract: exits 0 clean, 1 on any finding OR a read/parse/empty-spec error,
 * 2 on bad CLI usage. Node built-ins only (no deps). OFFLINE — reads
 * api-reference/openapi.json + api-reference/endpoint/ from disk, no network.
 *
 * NOTE (CI wiring): the one-line hook (`npm run check:api-reference-coverage`
 * in .github/workflows/mintlify-ci.yml) is intentionally NOT added here — that
 * NEVER-AUTO path lands separately in the consolidated operator PR.
 */

import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { argv, exit } from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Shared vocabulary — keep in sync with generate-api-reference.mjs ──────────
// The generator executes its main logic side-effectfully at import time (no
// main() guard) and refactoring it is out of scope for this item, so these
// constants/helpers are MIRRORED (not imported) from generate-api-reference.mjs.
// The duplication is surfaced, not silent (MNE-440). Follow-up: once the
// generator exposes these without executing, extract to
// scripts/lib/api-reference-exclusions.mjs and have both consume it.
const METHODS = ["get", "post", "put", "patch", "delete"];

// Endpoints intentionally NOT published (tracked in Linear). Keys are "METHOD /path".
const HELD = new Set([
  "POST /safe-house/ingest-pattern", // MNE-122
  "POST /safe-house/patterns", // MNE-122
]);

// Not part of the programmatic product API — the web app / website surface.
const NON_API = new Set([
  "POST /contact/submit", // marketing site contact form
  "POST /auth/sessions/revoke-via-email", // email-link account-security flow (website, not API)
]);

// Leading `openapi:` frontmatter directive — matches the generator's parse in
// directiveByFile: capture the METHOD and the bare path.
const DIRECTIVE_RE = /^openapi:\s*"([A-Z]+)\s+([^"]+)"/m;

// Security-scheme summary string for an op — identical to the generator's.
export function securityString(op, spec) {
  return (op.security || spec.security || []).map((o) => Object.keys(o).join("+")).join("|") || "none";
}

// Deliberate-exclusion predicate — a faithful copy of the generator's
// exclusionReason(): deprecated -> "deprecated"; CookieAuth-only ->
// "dashboard-session"; NON_API -> "non-api"; else null. HELD is NOT covered here
// — it is handled as its own bucket by the caller (as the generator does), so
// the direction-2 loop MUST check HELD before calling this (see analyzeCoverage).
export function exclusionReason(key, op, secStr) {
  if (op.deprecated) return "deprecated";
  if (/CookieAuth/.test(secStr) && !/ApiKeyAuth|BearerAuth|LicenseJwtAuth|AgentAuth/.test(secStr)) return "dashboard-session";
  if (NON_API.has(key)) return "non-api";
  return null;
}

// ── fs: read the endpoint pages ──────────────────────────────────────────────
// Reads ONLY the top-level *.mdx files in api-reference/endpoint/ (non-recursive
// readdirSync, matching the generator's own assumption — Mintlify places every
// endpoint page at one depth; no draft/snippets subdirs are scanned). For each
// page, parse its leading `openapi:` directive (if any). Pages with no directive
// (the hand-written GDPR narratives) have hasDirective:false.
export function readPages(endpointDir) {
  return readdirSync(endpointDir)
    .filter((f) => f.endsWith(".mdx"))
    .map((file) => {
      const m = readFileSync(join(endpointDir, file), "utf8").match(DIRECTIVE_RE);
      return m
        ? { file, hasDirective: true, method: m[1], path: m[2] }
        : { file, hasDirective: false, method: null, path: null };
    });
}

// ── Pure analysis (no fs) ────────────────────────────────────────────────────
// Reconcile pages against the committed spec in both directions.
//   openapi   — parsed OpenAPI object.
//   pages     — from readPages(): [{ file, hasDirective, method, path }].
//   allowlist — existence-resolved entries [{ key, file, exists }] (the fs
//               wrapper resolves `exists`; kept out of this pure fn).
// Returns { orphans, gaps, staleAllowlist, excludedByReason, coveredCount,
//           totalOps, pageCount }.
export function analyzeCoverage(openapi, pages, allowlist) {
  const paths = (openapi && openapi.paths) || {};

  // Direction 1 — orphans (page -> spec): a directive-bearing page whose
  // directive resolves to no op in the committed spec.
  const orphans = [];
  for (const p of pages) {
    if (!p.hasDirective) continue; // hand-written narratives don't participate
    const op = paths[p.path] && paths[p.path][p.method.toLowerCase()];
    if (!op) orphans.push({ file: p.file, method: p.method, path: p.path });
  }

  // Coverage sources for direction 2.
  const pageKeys = new Set(pages.filter((p) => p.hasDirective).map((p) => `${p.method} ${p.path}`));
  const allowlistKeys = new Set(allowlist.filter((e) => e.exists).map((e) => e.key));

  // Direction 2 — classify every spec op into EXACTLY ONE bucket. Ordering is
  // load-bearing (advisory MNE-414): HELD is not covered by exclusionReason(),
  // so it MUST be checked first — otherwise a HELD op returns null from
  // exclusionReason() and falls through to `gap`. Order: held -> excluded ->
  // covered -> gap.
  const gaps = [];
  const excludedByReason = { deprecated: [], "dashboard-session": [], "non-api": [], held: [] };
  let coveredCount = 0;
  let totalOps = 0;
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const m of METHODS) {
      const op = item[m];
      if (!op || typeof op !== "object") continue;
      totalOps++;
      const key = `${m.toUpperCase()} ${path}`;
      if (HELD.has(key)) {
        excludedByReason.held.push(key);
        continue;
      }
      const reason = exclusionReason(key, op, securityString(op, openapi));
      if (reason) {
        excludedByReason[reason].push(key);
        continue;
      }
      if (pageKeys.has(key) || allowlistKeys.has(key)) {
        coveredCount++;
        continue;
      }
      gaps.push(key);
    }
  }

  // Allowlist hygiene — a dead/misleading entry is itself a failure (MNE-440):
  // the key must be a real spec op AND the mapped file must exist.
  const staleAllowlist = [];
  for (const e of allowlist) {
    const [method, path] = [e.key.split(" ")[0], e.key.split(" ").slice(1).join(" ")];
    const op = paths[path] && paths[path][String(method).toLowerCase()];
    if (!op) staleAllowlist.push({ key: e.key, file: e.file, reason: "no such op in spec" });
    else if (!e.exists) staleAllowlist.push({ key: e.key, file: e.file, reason: "mapped file does not exist" });
  }

  return {
    orphans,
    gaps: gaps.sort(),
    staleAllowlist,
    excludedByReason,
    coveredCount,
    totalOps,
    pageCount: pages.length,
  };
}

// ── fs wrapper ───────────────────────────────────────────────────────────────
// Read + parse the spec, the endpoint pages, and the allowlist, resolve each
// allowlist entry's file existence, then analyze. Throws on read/parse error and
// on an empty (zero-path) spec — see the fail-closed guard.
export function checkApiReferenceCoverage(openapiPath, endpointDir, allowlistPath) {
  const openapi = JSON.parse(readFileSync(openapiPath, "utf8"));

  // Fail-closed guard (MNE-442): an empty / cold-start / mis-fetched spec with
  // zero paths must be an ERROR, never a vacuously-clean pass that greens the
  // gate with nothing to reconcile.
  const pathCount = openapi && openapi.paths && typeof openapi.paths === "object" ? Object.keys(openapi.paths).length : 0;
  if (pathCount === 0) {
    throw new Error(`spec at ${openapiPath} has zero paths — empty/cold-start/mis-fetched spec, refusing to pass vacuously`);
  }

  const pages = readPages(endpointDir);

  const allowlistRaw = JSON.parse(readFileSync(allowlistPath, "utf8"));
  const allow = (allowlistRaw && allowlistRaw.allow) || {};
  // Resolve each entry's file relative to the repo root (absolute paths — e.g.
  // self-test temp fixtures — pass through resolve() unchanged).
  const allowlist = Object.entries(allow).map(([key, file]) => ({
    key,
    file,
    exists: existsSync(resolve(ROOT, file)),
  }));

  return analyzeCoverage(openapi, pages, allowlist);
}

// ── Reporting ────────────────────────────────────────────────────────────────
function printReport(result) {
  const { orphans, gaps, staleAllowlist, excludedByReason: ex } = result;

  if (orphans.length) {
    console.error(`\nOrphan pages (directive resolves to no spec op) — ${orphans.length}:`);
    for (const o of orphans.slice().sort((a, b) => a.file.localeCompare(b.file))) {
      console.error(`  ✗ ${o.file} → ${o.method} ${o.path} (no such op in spec)`);
    }
  }
  if (gaps.length) {
    console.error(`\nUncovered ops (no page, not excluded, not allowlisted) — ${gaps.length}:`);
    for (const g of gaps) console.error(`  ✗ ${g} (no page, not excluded, not allowlisted)`);
  }
  if (staleAllowlist.length) {
    console.error(`\nStale allowlist entries — ${staleAllowlist.length}:`);
    for (const s of staleAllowlist) console.error(`  ✗ ${s.key} → ${s.file} (${s.reason})`);
  }

  console.log(
    `\n${result.totalOps} ops: ${result.coveredCount} covered, ` +
      `${ex.deprecated.length + ex["dashboard-session"].length + ex["non-api"].length + ex.held.length} excluded ` +
      `{deprecated:${ex.deprecated.length}, dashboard-session:${ex["dashboard-session"].length}, ` +
      `non-api:${ex["non-api"].length}, held:${ex.held.length}}, ` +
      `${gaps.length} gaps; ${result.pageCount} pages, ${orphans.length} orphans` +
      (staleAllowlist.length ? `, ${staleAllowlist.length} stale-allowlist` : ""),
  );
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Writes throwaway spec + endpoint/ + allowlist fixtures to a temp dir and
// asserts BOTH reconciliation directions (AC4). Fixture hygiene (MNE-339): only
// short opaque placeholder values — no JWT/API-key/PEM-shaped strings.
function selfTest() {
  let pass = 0;
  let fail = 0;
  const assert = (name, cond) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}`); }
  };

  const root = mkdtempSync(join(tmpdir(), "api-reference-coverage-selftest-"));
  const endpointDir = join(root, "endpoint");
  mkdirSync(endpointDir, { recursive: true });
  const openapiPath = join(root, "openapi.json");
  const allowlistPath = join(root, "allowlist.json");

  const page = (title, directive) =>
    `---\ntitle: ${JSON.stringify(title)}\nopenapi: ${JSON.stringify(directive)}\n---\n`;
  const write = (name, body) => writeFileSync(join(endpointDir, name), body);

  // Direction 1 — the canonical four orphan pages: directives point at
  // /admin/security/advisories, which the fixture spec does NOT define.
  for (const m of ["get", "post", "put", "delete"]) {
    write(`${m}-admin-security-advisories.mdx`, page("Admin advisories", `${m.toUpperCase()} /admin/security/advisories`));
  }
  // Coverage positive — a generated page with a valid directive covers its op.
  write("get-widgets-covered.mdx", page("Get covered widget", "GET /widgets-covered"));
  // Allowlisted hand-written page (no directive) whose FILE EXISTS covers its op.
  write("delete-agents-agent-id.mdx", "---\ntitle: Erase agent\n---\n\nHand-written GDPR narrative for `agt-test-1`.\n");

  const fixtureSpec = {
    openapi: "3.1.0",
    security: [{ ApiKeyAuth: [] }],
    paths: {
      // Covered by a directive page.
      "/widgets-covered": { get: { operationId: "getCovered", summary: "Get covered widget" } },
      // Covered by the allowlisted hand-written page.
      "/agents/{agent_id}": { delete: { operationId: "eraseAgent", summary: "Erase agent" } },
      // Direction 2 gap — plain ApiKeyAuth op, no page, not allowlisted.
      "/widgets": { get: { operationId: "getWidgets", summary: "List widgets" } },
      // Exclusion positives (must NOT be gaps), each with NO page:
      "/legacy-thing": { get: { operationId: "getLegacy", summary: "Legacy", deprecated: true } },
      "/safe-house/patterns": { post: { operationId: "addPattern", summary: "Held" } }, // HELD
      "/contact/submit": { post: { operationId: "contact", summary: "Non-API" } }, // NON_API
      "/dashboard-only": { get: { operationId: "dash", summary: "Dashboard", security: [{ CookieAuth: [] }] } }, // dashboard-session
    },
  };
  writeFileSync(openapiPath, JSON.stringify(fixtureSpec, null, 2));

  // Allowlist: the present hand-written page (valid). Absolute temp path so it
  // resolves regardless of cwd.
  writeFileSync(
    allowlistPath,
    JSON.stringify({ allow: { "DELETE /agents/{agent_id}": join(endpointDir, "delete-agents-agent-id.mdx") } }, null, 2),
  );

  const r = checkApiReferenceCoverage(openapiPath, endpointDir, allowlistPath);

  // Direction 1 — orphans: the four /admin/security/advisories pages trip it.
  const orphanKeys = new Set(r.orphans.map((o) => `${o.method} ${o.path}`));
  for (const m of ["GET", "POST", "PUT", "DELETE"]) {
    assert(`orphan: ${m} /admin/security/advisories detected`, orphanKeys.has(`${m} /admin/security/advisories`));
  }
  assert("orphan: exactly the four admin-advisories orphans (no false positives)", r.orphans.length === 4);
  assert("orphan: hand-written directive-less page is NOT an orphan", !r.orphans.some((o) => o.file === "delete-agents-agent-id.mdx"));

  // Direction 2 — gap.
  assert("gap: GET /widgets (plain op, no page) is a gap", r.gaps.includes("GET /widgets"));
  assert("gap: exactly one gap", r.gaps.length === 1);

  // Exclusion positives — each lands in the correct bucket and is NOT a gap.
  assert("excluded: deprecated op bucketed", r.excludedByReason.deprecated.includes("GET /legacy-thing"));
  assert("excluded: HELD op bucketed (not a gap)", r.excludedByReason.held.includes("POST /safe-house/patterns"));
  assert("excluded: HELD op is NOT a gap", !r.gaps.includes("POST /safe-house/patterns"));
  assert("excluded: NON_API op bucketed", r.excludedByReason["non-api"].includes("POST /contact/submit"));
  assert("excluded: CookieAuth-only op bucketed as dashboard-session", r.excludedByReason["dashboard-session"].includes("GET /dashboard-only"));
  for (const key of ["GET /legacy-thing", "POST /contact/submit", "GET /dashboard-only"]) {
    assert(`excluded op is NOT a gap: ${key}`, !r.gaps.includes(key));
  }

  // Coverage positives.
  assert("covered: directive page + allowlisted page (2 covered)", r.coveredCount === 2);
  assert("covered: GET /widgets-covered has no orphan/gap", !orphanKeys.has("GET /widgets-covered") && !r.gaps.includes("GET /widgets-covered"));

  // The above fixture must FAIL overall (has orphans + a gap).
  assert("overall: fixture with orphans+gap has findings", r.orphans.length + r.gaps.length + r.staleAllowlist.length > 0);

  // Allowlist hygiene — mapped file ABSENT → staleAllowlist.
  writeFileSync(allowlistPath, JSON.stringify({ allow: { "DELETE /agents/{agent_id}": join(endpointDir, "does-not-exist.mdx") } }, null, 2));
  const rMissing = checkApiReferenceCoverage(openapiPath, endpointDir, allowlistPath);
  assert("stale: allowlist entry whose file is absent is flagged", rMissing.staleAllowlist.some((s) => s.key === "DELETE /agents/{agent_id}"));
  // With the allowlist file gone, the op is now an uncovered gap too.
  assert("stale: de-allowlisted op becomes a gap", rMissing.gaps.includes("DELETE /agents/{agent_id}"));

  // Allowlist hygiene — key is not a real spec op → staleAllowlist.
  writeFileSync(allowlistPath, JSON.stringify({ allow: { "GET /no-such-op": join(endpointDir, "delete-agents-agent-id.mdx") } }, null, 2));
  const rDeadKey = checkApiReferenceCoverage(openapiPath, endpointDir, allowlistPath);
  assert("stale: allowlist entry for a non-existent spec op is flagged", rDeadKey.staleAllowlist.some((s) => s.key === "GET /no-such-op"));

  // Clean fixture — every op covered or excluded, every directive resolves,
  // allowlist entries present → zero findings.
  const cleanDir = join(root, "clean-endpoint");
  mkdirSync(cleanDir, { recursive: true });
  writeFileSync(join(cleanDir, "get-widgets-covered.mdx"), page("Get covered widget", "GET /widgets-covered"));
  writeFileSync(join(cleanDir, "get-widgets.mdx"), page("List widgets", "GET /widgets"));
  writeFileSync(join(cleanDir, "delete-agents-agent-id.mdx"), "---\ntitle: Erase agent\n---\n\nHand-written narrative.\n");
  const cleanAllowlist = join(root, "clean-allowlist.json");
  writeFileSync(cleanAllowlist, JSON.stringify({ allow: { "DELETE /agents/{agent_id}": join(cleanDir, "delete-agents-agent-id.mdx") } }, null, 2));
  const rClean = checkApiReferenceCoverage(openapiPath, cleanDir, cleanAllowlist);
  assert("clean: fully-reconciled fixture has zero orphans", rClean.orphans.length === 0);
  assert("clean: fully-reconciled fixture has zero gaps", rClean.gaps.length === 0);
  assert("clean: fully-reconciled fixture has zero stale-allowlist", rClean.staleAllowlist.length === 0);

  // Fail-closed — an empty (zero-path) spec must throw, not pass vacuously.
  const emptySpec = join(root, "empty.json");
  writeFileSync(emptySpec, JSON.stringify({ openapi: "3.1.0", paths: {} }));
  let threwOnEmpty = false;
  try { checkApiReferenceCoverage(emptySpec, cleanDir, cleanAllowlist); } catch { threwOnEmpty = true; }
  assert("fail-closed: empty (zero-path) spec throws (no vacuous pass)", threwOnEmpty);

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const args = argv.slice(2);
  let verbose = false;
  let openapiPath = join(ROOT, "api-reference", "openapi.json");
  let endpointDir = join(ROOT, "api-reference", "endpoint");
  let allowlistPath = join(ROOT, "scripts", "api-reference-coverage-allowlist.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verbose") verbose = true;
    else if (args[i] === "--self-test") {
      exit(selfTest() ? 0 : 1);
    } else if (args[i] === "--openapi") {
      if (i + 1 >= args.length) { console.error("--openapi requires a path argument"); exit(2); }
      openapiPath = args[++i];
    } else if (args[i] === "--endpoint-dir") {
      if (i + 1 >= args.length) { console.error("--endpoint-dir requires a path argument"); exit(2); }
      endpointDir = args[++i];
    } else if (args[i] === "--allowlist") {
      if (i + 1 >= args.length) { console.error("--allowlist requires a path argument"); exit(2); }
      allowlistPath = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(
        "Usage: check-api-reference-coverage.mjs [--openapi path] [--endpoint-dir path] [--allowlist path] [--verbose] [--self-test]\n" +
          "\n" +
          "  Reconciles api-reference/endpoint/*.mdx pages against the committed\n" +
          "  api-reference/openapi.json in BOTH directions: every page's openapi:\n" +
          "  directive must resolve to a spec op (no orphans), and every\n" +
          "  non-excluded spec op must have a directive page or an allowlisted\n" +
          "  hand-written page (no gaps). Blocking: exits 1 on any orphan, gap, or\n" +
          "  stale-allowlist entry; 0 clean; 2 on bad usage. --self-test runs\n" +
          "  fixture assertions for both directions.",
      );
      exit(0);
    } else {
      console.error(`Unknown flag: ${args[i]}`);
      exit(2);
    }
  }

  let result;
  try {
    result = checkApiReferenceCoverage(openapiPath, endpointDir, allowlistPath);
  } catch (err) {
    console.error(`✗ check-api-reference-coverage: ${err.message}`);
    exit(1);
  }

  printReport(result);

  if (verbose) {
    for (const [reason, keys] of Object.entries(result.excludedByReason)) {
      if (keys.length) console.log(`    excluded (${reason}): ${keys.slice().sort().join(", ")}`);
    }
  }

  const findings = result.orphans.length + result.gaps.length + result.staleAllowlist.length;
  if (findings === 0) {
    console.log("✓ check-api-reference-coverage: every page directive resolves and every non-excluded op is covered.");
    exit(0);
  }
  console.error(
    `\n✗ check-api-reference-coverage: ${result.orphans.length} orphan(s), ${result.gaps.length} gap(s), ` +
      `${result.staleAllowlist.length} stale-allowlist entr(y/ies). ` +
      "Remove the orphan page(s), add the missing endpoint page(s), or fix the allowlist.",
  );
  exit(1);
}

main();
