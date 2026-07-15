#!/usr/bin/env node
/**
 * run-doc-examples.mjs — T5-1.3 live staging executor.
 *
 * Re-uses the extraction primitives from `lib/doc-examples-extract.mjs`
 * to find every `curl https://api.mnemom.ai/v1/*` invocation in docs,
 * filters to the subset that's safe to execute live, substitutes
 * placeholders from `scripts/staging-fixtures.json`, retargets the URL
 * at staging, and executes the request. Reports per-example status.
 *
 * Safety profile (v1):
 *   - GET requests only by default. Writes (POST/PUT/PATCH/DELETE) are
 *     skipped unless --include-writes is passed AND the example's spec
 *     path is in WRITE_ALLOWLIST. v1 ships with WRITE_ALLOWLIST = []
 *     (no live writes from CI; this gate exists so writes are an
 *     intentional, per-example opt-in, not a default).
 *   - Examples whose path requires unresolvable placeholders are
 *     skipped with reason "unresolved placeholder: $X".
 *   - --dry-run prints the planned executions without sending them.
 *
 * Coverage (issue #380):
 *   Every run reports "executor coverage" — the share of DISCOVERED examples
 *   that are executable (not skipped for fixtures/writes/placeholders) — to
 *   `$GITHUB_STEP_SUMMARY` (or stdout under --verbose). `--min-executed-pct N`
 *   turns that report into a gate: coverage below N exits non-zero. The floor
 *   is CLI-only (never an env var); it defaults to 0 (report-only).
 *
 * Auth:
 *   The MNEMOM_STAGING_TOKEN env var (CI: secret of the same name)
 *   carries a staging-scoped service-account token. The executor
 *   replaces any `Authorization: Bearer <placeholder>` header with the
 *   staging token. Examples without an Authorization header get one
 *   added. If the token is unset and --dry-run is not passed, the
 *   script exits 0 with a "skipped: no staging token" notice — that's
 *   the workflow's "secret not configured" branch.
 *
 * Exit codes:
 *   0  — no executed call returned a status outside the example's
 *        documented surface (verdict per assertExpectedStatus).
 *   1  — at least one executed call failed assertion.
 *   2  — usage / configuration error.
 */

import { readFileSync, appendFileSync } from "node:fs";
import { argv, env, exit } from "node:process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  resolveScope,
  extractBashBlocks,
  extractCurls,
  parseCurl,
  pathSegmentsFromUrl,
  buildSpecIndex,
  matchSpecPath,
} from "./lib/doc-examples-extract.mjs";
import {
  parseMinExecutedPct,
  computeExecutorCoverage,
  coverageFloorMet,
  summarizeSkipReasons,
  renderCoverageSummary,
} from "./lib/executor-coverage.mjs";

// ── Ajv (mirrors the walker; needed for actual-response validation) ──────
const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

function derefRef(refStr, root) {
  if (!refStr.startsWith("#/")) return null;
  const segs = refStr.slice(2).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = root;
  for (const s of segs) {
    if (cur == null) return null;
    cur = cur[s];
  }
  return cur ?? null;
}
function deref(node, root) {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => deref(n, root));
  if (typeof node.$ref === "string") {
    const target = derefRef(node.$ref, root);
    return target == null ? node : deref(target, root);
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(v, root);
  return out;
}
const responseValidatorCache = new Map();
function getResponseValidator(spec, specPath, method, status) {
  const key = `${method}|${specPath}|${status}`;
  if (responseValidatorCache.has(key)) return responseValidatorCache.get(key);
  const op = spec.paths[specPath]?.[method];
  const schema = op?.responses?.[String(status)]?.content?.["application/json"]?.schema;
  if (!schema) {
    responseValidatorCache.set(key, null);
    return null;
  }
  try {
    const dereffed = deref(schema, spec);
    const v = ajv.compile(dereffed);
    responseValidatorCache.set(key, v);
    return v;
  } catch (err) {
    responseValidatorCache.set(key, { __compileError: err.message });
    return null;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────
const args = argv.slice(2);
let scope = "introduction.mdx,changelog.mdx,quickstart,guides,concepts,specifications,protocols,gateway,for-agents,migration,pricing";
let dryRun = false;
let includeWrites = false;
let verbose = false;
let stagingBase = env.MNEMOM_STAGING_BASE_URL ?? "https://api-staging.mnemom.ai/v1";
let minExecutedPctArg;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--scope") scope = args[++i];
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--include-writes") includeWrites = true;
  else if (a === "--verbose") verbose = true;
  else if (a === "--staging-base") stagingBase = args[++i];
  else if (a === "--min-executed-pct") minExecutedPctArg = args[++i];
  else if (a === "--help" || a === "-h") {
    console.log("Usage: run-doc-examples.mjs [--scope dirs] [--dry-run] [--include-writes] [--staging-base url] [--min-executed-pct N] [--verbose]");
    exit(0);
  } else {
    console.error(`Unknown flag: ${a}`);
    exit(2);
  }
}

// Resolve the executor-coverage floor from the CLI (issue #380). The floor is
// a CLI-ONLY policy — never read from the environment. A `--min-executed-pct`
// with no trailing value leaves minExecutedPctArg === undefined; because
// `undefined ?? null` would otherwise fall through to the report-only default,
// we reject the no-value form here as a usage error (design-review advisory).
if (args.includes("--min-executed-pct") && minExecutedPctArg === undefined) {
  console.error("--min-executed-pct requires a value");
  exit(2);
}
let minExecutedPct;
try {
  minExecutedPct = parseMinExecutedPct(minExecutedPctArg ?? null);
} catch (err) {
  console.error(err.message);
  exit(2);
}

// ── Fixtures + auth ──────────────────────────────────────────────────────
let fixtures = {};
try {
  const raw = JSON.parse(readFileSync("scripts/staging-fixtures.json", "utf8"));
  fixtures = raw?.values ?? {};
} catch (err) {
  if (err.code !== "ENOENT") {
    console.error("staging-fixtures.json is malformed:", err.message);
    exit(2);
  }
  // Missing fixture file is fine in v1 (empty fixtures). Most examples
  // will skip with "unresolved placeholder" until the file gets populated.
}

const stagingToken = env.MNEMOM_STAGING_TOKEN ?? null;
if (!stagingToken && !dryRun) {
  console.log("MNEMOM_STAGING_TOKEN is not set. Live execution requires a staging-scoped token.");
  console.log("Pass --dry-run to parse + filter examples without executing them.");
  console.log("Exiting 0 (skipped — workflow's 'secret not configured' branch).");
  exit(0);
}

// ── Spec ─────────────────────────────────────────────────────────────────
// ADR-054: spec loaded from the live URL (or OPENAPI_SPEC_PATH override).
import { loadSpec } from "./_load-spec.mjs";
const spec = await loadSpec();
const specIndex = buildSpecIndex(spec);

// Write allowlist. Each entry: { method, path } templated. Adding to
// this list is an intentional opt-in that says: "this write op is safe
// to run live against staging from CI, including cleanup." Most writes
// have side effects (create agent, register webhook) that require an
// idempotency-key + cleanup pass.
//
// Per T5-1.3 v2: the first entry sends a test webhook to the fixture
// endpoint. Idempotent — the receiver is a known test sink, every test
// delivery is independent, no cleanup needed.
const WRITE_ALLOWLIST = [
  {
    method: "POST",
    path: "/orgs/{org_id}/webhooks/{endpoint_id}/test",
    rationale: "Sends a test webhook to the doc-fixtures endpoint (T5-1.3 v2); idempotent, no cleanup.",
  },
];

function isWriteAllowed(method, specPath) {
  return WRITE_ALLOWLIST.some((e) => e.method === method && e.path === specPath);
}

// ── Doc-grammar placeholders that need fixtures ──────────────────────────
//
// Some doc URLs use literal `{agent_id}` placeholders in the path (shape-
// only; not runnable). Others use well-known illustrative example IDs
// (`mnm-550e8400-e29b-41d4-a716-446655440000`, `agent-xyz`, `team-abc123`,
// `agent_abc123`) that don't exist in staging. The executor treats these
// as "needs fixture" — same skip class as `$VAR`-style placeholders.
const TEMPLATE_RE = /^\{[a-z_][a-z0-9_]*\}$/i;
const EXAMPLE_ID_PATTERNS = [
  /^mnm-[0-9a-f-]{8,}/i,
  /^agent-[a-z0-9]+$/i,
  /^agent_[a-z0-9]+$/i,
  /^team-[a-z0-9]+$/i,
  /^team_[a-z0-9]+$/i,
  /^org-[a-z0-9]+$/i,
  /^org_[a-z0-9]+$/i,
  /^smolt-[a-z0-9]+$/i,
  /^qr_[A-Z0-9]+$/,
  /^mk-[a-z0-9]+$/i,
];

function pathSegmentsNeedingFixture(segments) {
  const needs = [];
  for (const seg of segments) {
    const decoded = seg;
    if (TEMPLATE_RE.test(decoded)) {
      // {template} slot: skip only if the fixture for the upper-cased
      // slot name is unset. If fixtures has ORG_ID for {org_id}, we'll
      // substitute it in resolvePlaceholders and the URL becomes runnable.
      const name = decoded.slice(1, -1).toUpperCase();
      if (fixtures[name] === undefined) needs.push(decoded);
      continue;
    }
    for (const re of EXAMPLE_ID_PATTERNS) {
      if (re.test(decoded)) {
        // Literal example ID like mnm-550e8400-... or agent-xyz. Always
        // needs a fixture (we can't tell which {param} it corresponds
        // to without ambiguity).
        needs.push(decoded);
        break;
      }
    }
  }
  return needs;
}

// ── Placeholder resolution ───────────────────────────────────────────────
//
// Replace `$VAR` and `${VAR}` in a URL or body string with fixtures values.
// Returns { ok, resolved } or { ok: false, missing: ["VAR", ...] }.
function resolvePlaceholders(str) {
  const missing = new Set();
  // ${VAR} form
  let out = str.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => {
    const v = fixtures[name];
    if (v === undefined) {
      missing.add(name);
      return `\${${name}}`;
    }
    return String(v);
  });
  // $VAR form
  out = out.replace(/\$([A-Z_][A-Z0-9_]*)/g, (m, name) => {
    const v = fixtures[name];
    if (v === undefined) {
      missing.add(name);
      return m;
    }
    return String(v);
  });
  // <placeholder> form
  out = out.replace(/<([a-z][a-z0-9-]*(?:-[a-z0-9]+)*)>/gi, (m, name) => {
    const key = name.toUpperCase().replace(/-/g, "_");
    const v = fixtures[key] ?? fixtures[name];
    if (v === undefined) {
      missing.add(name);
      return m;
    }
    return String(v);
  });
  // {template_name} form — OpenAPI-style URL parameter slots. Match
  // fixture keys by upper-cased slot name (e.g., {org_id} → ORG_ID).
  out = out.replace(/\{([a-z][a-z0-9_]*)\}/g, (m, name) => {
    const key = name.toUpperCase();
    const v = fixtures[key];
    if (v === undefined) {
      missing.add(name);
      return m;
    }
    return String(v);
  });
  return missing.size === 0
    ? { ok: true, resolved: out }
    : { ok: false, missing: [...missing] };
}

// ── Status-code assertion ────────────────────────────────────────────────
//
// "Pass" = the response status is documented as a `responses` key on the
// operation, OR is 2xx (common-case for docs that show only the success
// path). 4xx returned where the spec documents the same 4xx is a pass too
// (e.g., "GET /agents/{id} returns 200 with body | 404 if not found" — a
// 404 against a fixture-not-found target is still "documented behavior").
function assertExpectedStatus(specPath, method, status) {
  const op = spec.paths[specPath]?.[method];
  const docs = op?.responses ?? {};
  if (status >= 200 && status < 300) return { ok: true, why: "2xx" };
  if (String(status) in docs) return { ok: true, why: `documented (${status})` };
  // 401 / 403 commonly aren't in `responses` but are runtime auth gates;
  // we always treat them as "documented behavior" for now since they
  // mean the executor's auth is wrong, not the doc. This is a CI
  // operational concern, not a drift signal.
  if (status === 401 || status === 403) return { ok: true, why: `auth (${status}) — staging token issue, not doc drift` };
  return { ok: false, why: `undocumented status ${status}` };
}

// ── Build the executable plan ────────────────────────────────────────────
const files = resolveScope(scope);
const plan = [];
const skipped = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const block of extractBashBlocks(source)) {
    for (const curl of extractCurls(block.body)) {
      const parsed = parseCurl(curl);
      if (!parsed) continue;
      const { method, url, body, headers } = parsed;

      const norm = pathSegmentsFromUrl(url);
      if (norm.skip) continue; // out-of-scope host
      const matched = matchSpecPath(norm.segments, specIndex);
      if (!matched) {
        skipped.push({ file, line: block.line, method, url, reason: "spec path not matched (T5-1.1 should have caught this)" });
        continue;
      }
      if (method !== "GET" && !(includeWrites && isWriteAllowed(method, matched.raw))) {
        skipped.push({ file, line: block.line, method, url, reason: method === "GET" ? "?" : "write op — opt-in via --include-writes + WRITE_ALLOWLIST" });
        continue;
      }

      // Literal `{template}` or example-ID segments in the URL need
      // staging fixtures — without them every request 404s.
      const needsFixture = pathSegmentsNeedingFixture(norm.segments);
      if (needsFixture.length > 0) {
        skipped.push({ file, line: block.line, method, url, reason: `needs fixture for path segment(s): ${needsFixture.join(", ")}` });
        continue;
      }

      const urlResolved = resolvePlaceholders(url);
      if (!urlResolved.ok) {
        skipped.push({ file, line: block.line, method, url, reason: `unresolved placeholder${urlResolved.missing.length > 1 ? "s" : ""}: ${urlResolved.missing.join(", ")}` });
        continue;
      }

      // Rewrite host: api.mnemom.ai/v1/<path> → ${stagingBase}/<path>.
      const final = new URL(urlResolved.resolved);
      const pathOnly = final.pathname.replace(/^\/v1\//, "/");
      const stagingURL = stagingBase.replace(/\/$/, "") + pathOnly + final.search;

      // Inject auth header. The header choice depends on the token shape:
      // `mnm_*` / `mnemom_*` are Mnemom API keys and MUST go via
      // `X-Mnemom-Api-Key` (per guides/api-keys.mdx — Authorization: Bearer
      // for these keys is deprecated and rejected by `getAuthUser`-gated
      // routes like /v1/safe-house/*). Supabase user JWTs (header starts
      // with `eyJ`) go via Authorization: Bearer. Anything else falls back
      // to Authorization: Bearer so a misshapen token still hits the
      // server (where it 401s honestly rather than skipping silently here).
      const filteredHeaders = headers.filter((h) => !/^authorization\s*:/i.test(h) && !/^x-mnemom-api-key\s*:/i.test(h));
      const tokenValue = stagingToken ?? "DRY_RUN_TOKEN";
      if (/^mnm_|^mnemom_/.test(tokenValue)) {
        filteredHeaders.push(`X-Mnemom-Api-Key: ${tokenValue}`);
      } else {
        filteredHeaders.push(`Authorization: Bearer ${tokenValue}`);
      }

      plan.push({
        file,
        line: block.line,
        method,
        specPath: matched.raw,
        url: stagingURL,
        body: body ?? null,
        headers: filteredHeaders,
      });
    }
  }
}

// ── Report planned + skipped ─────────────────────────────────────────────
console.log(`Scanned ${files.length} MDX file(s) across [${scope.split(",").map((s) => s.trim()).slice(0, 4).join(", ")}…]`);
console.log(`Plan: ${plan.length} executable example(s); ${skipped.length} skipped.`);
if (verbose) {
  for (const p of plan) {
    console.log(`  → ${p.method.padEnd(6)} ${p.url}   (${p.file}:${p.line})`);
  }
  for (const s of skipped) {
    console.log(`  ⏭ ${s.method.padEnd(6)} ${s.url}   ${s.reason}   (${s.file}:${s.line})`);
  }
}

// ── Executor coverage (issue #380) ─────────────────────────────────────────
// Coverage = the share of DISCOVERED examples that are executable (not
// skipped). It is a plan-time property, so it is reported (and gated) in every
// mode, including --dry-run — a fast, token-free PR gate is
// `--dry-run --min-executed-pct N`.
const coverage = computeExecutorCoverage({
  executed: plan.length,
  skipped: skipped.length,
});
const floorMet = coverageFloorMet(coverage.pct, minExecutedPct);
const summary = renderCoverageSummary({
  ...coverage,
  floor: minExecutedPct,
  floorMet,
  skippedItems: skipped,
});
// env.GITHUB_STEP_SUMMARY is the OUTPUT DESTINATION (a file path GitHub
// Actions provides), NOT the floor policy — the floor comes only from
// --min-executed-pct. Appending here is the standard Actions step-summary
// pattern (see link-health-report.mjs), not a forbidden env-driven threshold.
const summaryPath = env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  try {
    appendFileSync(summaryPath, summary + "\n");
  } catch (err) {
    console.error(`Could not write $GITHUB_STEP_SUMMARY: ${err.message}`);
  }
} else if (verbose) {
  console.log(summary);
}
console.log(
  `Executor coverage: ${coverage.executed}/${coverage.discovered} discovered example(s) executable (${coverage.pct}%); floor ${minExecutedPct}%.`,
);
const reasons = summarizeSkipReasons(skipped);
for (const { category, count } of reasons) {
  console.log(`  Skipped by reason: ${count} (${category})`);
}
if (!floorMet) {
  console.warn(
    `::warning::Executor coverage ${coverage.pct}% is below the --min-executed-pct floor (${minExecutedPct}%). (warn only — near-100%-skip is the expected current baseline)`,
  );
}

if (dryRun) {
  console.log("Dry run — no requests executed.");
  exit(0);
}

if (plan.length === 0) {
  console.log("Nothing to execute. Populate scripts/staging-fixtures.json to unlock examples.");
  exit(0);
}

// ── Execute ──────────────────────────────────────────────────────────────
const results = [];
for (const p of plan) {
  const headers = new Headers();
  for (const h of p.headers) {
    const idx = h.indexOf(":");
    if (idx === -1) continue;
    headers.set(h.slice(0, idx).trim(), h.slice(idx + 1).trim());
  }
  if (p.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let res;
  let resBody;
  let resBodyText;
  let resRequestId;
  try {
    res = await fetch(p.url, { method: p.method, headers, body: p.body ?? undefined });
    resRequestId = res.headers.get("x-request-id") ?? res.headers.get("cf-ray") ?? null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      resBodyText = await res.text();
      try {
        resBody = JSON.parse(resBodyText);
      } catch {
        resBody = undefined;
      }
    } else {
      resBodyText = await res.text().catch(() => "");
    }
  } catch (err) {
    results.push({ ...p, error: err.message });
    continue;
  }
  const verdict = assertExpectedStatus(p.specPath, p.method.toLowerCase(), res.status);

  // T5-1.4 — validate the actual response body against the spec's
  // responses[status] schema. Skip on auth-related statuses (the body
  // is an error envelope, not the documented success shape).
  let respVerdict = null;
  if (verdict.ok && resBody !== undefined && res.status >= 200 && res.status < 300) {
    const respValidator = getResponseValidator(spec, p.specPath, p.method.toLowerCase(), res.status);
    if (respValidator && !respValidator.__compileError) {
      const ok = respValidator(resBody);
      if (!ok) {
        respVerdict = { ok: false, errors: respValidator.errors ?? [] };
      } else {
        respVerdict = { ok: true };
      }
    }
  }
  results.push({ ...p, status: res.status, verdict, respVerdict, resBodyText, resRequestId });
}

// ── Final report ─────────────────────────────────────────────────────────
const failed = results.filter(
  (r) => r.error || r.verdict?.ok === false || r.respVerdict?.ok === false,
);
const passed = results.filter(
  (r) => !r.error && r.verdict?.ok && r.respVerdict?.ok !== false,
);

console.log();
console.log(`Executed ${results.length} example(s): ${passed.length} ✓ / ${failed.length} ✗`);
for (const r of passed) {
  const respNote = r.respVerdict?.ok ? "; resp schema ✓" : "";
  console.log(`  ✓ ${r.method.padEnd(6)} ${r.specPath}  ${r.status} (${r.verdict.why}${respNote})   (${r.file}:${r.line})`);
}
for (const r of failed) {
  if (r.error) {
    console.log(`  ✗ ${r.method.padEnd(6)} ${r.specPath}  ERROR: ${r.error}   (${r.file}:${r.line})`);
  } else if (r.verdict?.ok === false) {
    console.log(`  ✗ ${r.method.padEnd(6)} ${r.specPath}  ${r.status} (${r.verdict.why})   (${r.file}:${r.line})`);
    if (r.resRequestId) console.log(`      x-request-id: ${r.resRequestId}`);
    if (r.resBodyText) console.log(`      body: ${r.resBodyText.slice(0, 800)}`);
  } else if (r.respVerdict?.ok === false) {
    console.log(`  ✗ ${r.method.padEnd(6)} ${r.specPath}  ${r.status} (status ${r.verdict.why}; resp schema FAIL)   (${r.file}:${r.line})`);
    for (const e of r.respVerdict.errors.slice(0, 5)) {
      console.log(`      resp.${e.keyword}: ${e.instancePath || "(root)"} — ${e.message ?? ""}`);
    }
  }
}

exit(failed.length === 0 ? 0 : 1);
