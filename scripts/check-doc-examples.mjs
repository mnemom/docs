#!/usr/bin/env node
/**
 * check-doc-examples.mjs — Doc-as-spec static walker.
 *
 * Extracts every `curl https://api.mnemom.ai/v1/...` invocation from
 * fenced bash code blocks in customer-facing MDX pages and asserts:
 *
 *   1. The URL path corresponds to a real path in the live OpenAPI spec
 *      (loaded via `_load-spec.mjs` from `https://api.mnemom.ai/openapi.json`
 *      per ADR-055, after normalizing shell-var, all-caps, and example-ID
 *      placeholders to the spec's `{param}` slots).
 *   2. The HTTP method on that path is declared in the spec.
 *   3. (T5-1.2) The `-d '{...}'` JSON body, when present, validates against
 *      the spec's `requestBody.content['application/json'].schema` via Ajv
 *      after internal $ref dereferencing.
 *   4. (T5-1.5) Each curl whose matched operation declares a non-empty
 *      security requirement carries at least one header matching a
 *      declared scheme (BearerAuth → Authorization: Bearer, ApiKeyAuth →
 *      X-Mnemom-Api-Key, AgentAuth → X-Mnemom-Agent-Proof).
 *
 * This is the docs-side of Track 5's doc-as-spec CI, complement to the
 * four-layer leading-teams contract-drift defense built out by Track 4
 * (spec inheritance + static walker + runtime enforce + OTel-derived
 * auto-patcher in mnemom-api). The runtime guarantees openapi.json is
 * exhaustive and enforced; this walker guarantees every documented
 * endpoint and example body matches.
 *
 * Out of scope (deliberate follow-ons):
 *  - Live execution against staging (needs credential handling, idempotency
 *    discipline, cleanup; deferred to T5-1.3).
 *  - gateway.mnemom.ai/* URLs (passthrough, no first-party spec).
 *  - Non-curl examples — JSON-only / YAML / Python / TypeScript fenced
 *    blocks. Spec-page YAML/JSON parsing through the production validator
 *    is T5-3's territory; SDK examples are deferred until SDK contract
 *    tests stabilize.
 *
 * Exits 0 when every extracted call + body matches the spec.
 * Exits 1 with a per-file report on any drift.
 *
 * Flags:
 *   --scope <dirs>   Comma-separated list of dirs/files to walk.
 *                    Default: introduction.mdx + changelog.mdx +
 *                    quickstart,guides,concepts,specifications,
 *                    protocols,gateway,for-agents,migration,pricing.
 *   --verbose        Also list the calls that passed (audit aid).
 *   --no-bodies      Skip body validation (path+method only — equivalent
 *                    to the T5-1 layer-1 behavior pre-2026-05-14).
 *   --no-auth        Skip auth-header validation (path+method+body only).
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { argv, exit } from "node:process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  resolveScope,
  extractFencedBlocks,
  pairBashWithResponseJson,
  extractCurls,
  parseCurl,
  pathSegmentsFromUrl,
  buildSpecIndex,
  matchSpecPath,
  templatePathMatchesSegments,
} from "./lib/doc-examples-extract.mjs";

// ── Staff / internal surface (ADR-054) ─────────────────────────────────────
//
// The served customer-facing openapi.json deliberately EXCLUDES staff/internal
// endpoints (`buildCustomerFacingSpec` in mnemom-api `openapi/customer-facing.ts`).
// So a doc that shows a curl against a staff path will never match the customer
// spec — that's by design, not drift. Skip those examples instead of failing
// (and instead of papering over them with per-path KNOWN_DRIFT entries that go
// stale every time the staff surface shifts). Mirror of
// `mnemom-api openapi/customer-facing.ts::{STAFF_PREFIXES,STAFF_PATHS}`; keep in
// sync when a new internal namespace is added there. Note: doc paths are
// normalized with the `/v1` base stripped, so `/internal/` already covers the
// `/v1/internal/` variant.
const STAFF_PREFIXES = ["/admin/", "/arena/", "/internal/", "/v1/internal/", "/sonar/", "/rb2b/"];
const STAFF_PATHS = new Set([
  "/auth/send-email-hook",
  "/billing/webhooks/stripe",
  "/contact/notify",
  "/on-chain/anchor-root",
  "/on-chain/publish-scores",
  "/health",
]);
function isStaffPath(normalizedPath) {
  if (STAFF_PATHS.has(normalizedPath)) return true;
  return STAFF_PREFIXES.some((pre) => normalizedPath.startsWith(pre));
}

// ── CLI parsing ──────────────────────────────────────────────────────────
const SELFTEST = process.argv.includes("--self-test");
const args = argv.slice(2);
// Default scope = all customer-facing tabs from docs.json plus the
// repo-root MDX files (introduction, changelog), api-reference/endpoint,
// and the es/fr locale directories. api-reference/endpoint/ pages are
// included despite the directory's auto-generated Mintlify display: each
// page can contain hand-authored curl examples that reference the live API
// and can drift from the spec. The Mintlify-rendered spec display
// (path/method schema) trivially round-trips from openapi.json; the
// hand-written prose and example blocks in api-reference/endpoint/ do not
// (issue-319). es/ and fr/ locale pages mirror English content and must
// stay in sync with the same endpoints (issue-333). Each locale's
// mcp-clients.mdx contains a curl against api.mnemom.ai/mcp — that call
// is walked but skipped by the path filter (not /v1/*), producing zero
// findings. Each locale's safe-house-protection.mdx contains 6
// api.mnemom.ai/v1/ curl invocations mirroring the English page.
const DEFAULT_SCOPE = "introduction.mdx,changelog.mdx,quickstart,guides,concepts,specifications,protocols,gateway,for-agents,migration,pricing,api-reference/endpoint,es,fr";
let scope = DEFAULT_SCOPE;
let verbose = false;
let checkBodies = true;
let checkResponses = true;
let checkAuth = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--scope") scope = args[++i];
  else if (args[i] === "--verbose") verbose = true;
  else if (args[i] === "--no-bodies") checkBodies = false;
  else if (args[i] === "--no-responses") checkResponses = false;
  else if (args[i] === "--no-auth") checkAuth = false;
  else if (args[i] === "--self-test") { /* handled above */ }
  else if (args[i] === "--help" || args[i] === "-h") {
    console.log("Usage: check-doc-examples.mjs [--scope dir1,dir2] [--verbose] [--no-bodies] [--no-responses] [--no-auth] [--self-test]");
    exit(0);
  } else {
    console.error(`Unknown flag: ${args[i]}`);
    exit(2);
  }
}
// ── Known-drift allowlist ────────────────────────────────────────────────
//
// T5-1 ships green by allowlisting drift findings whose remediation belongs
// to a different T5 sub-track (concept-page audit T5-2, guide audit T5-4,
// or an upstream spec gap to address in mnemom-api). Each entry is a
// (file, method, normalized-path) tuple. Matching entries are still
// reported as "known drift" but do NOT fail the build. Removing an entry
// is the signal that the underlying doc has been fixed.
//
// As T5-2/T5-4 PRs land, every removed entry tightens this CI gate by
// one finding. The end state for T5 is an empty list.
//
// Normalized path = the path the walker computes (no /v1 prefix, trailing
// slash trimmed, percent-decoded segments). See pathSegmentsFromUrl.
const KNOWN_DRIFT = [
  // (closed 2026-05-15 by T5-4 PR 5: quickstart/safe-house-protection
  // .mdx rewritten onto the real protection-card endpoint + org-scoped
  // safe-house endpoints. The legacy per-agent /safe-house/* shape
  // never existed; the rewrite teaches PUT /agents/{id}/protection-card
  // + GET /safe-house/stats + GET /safe-house/quarantine/{id} + POST
  // /safe-house/quarantine/{id}/release + DELETE /safe-house/quarantine/{id}.)
  // (closed 2026-05-15 by T5-2: guides/api-versioning.mdx + concepts/
  // agent-identity.mdx /card references rewritten onto /alignment-card
  // per ADR-039.)
  // (closed 2026-05-15 by T5-4 PR 5: gateway/org-card-templates.mdx
  // rewritten onto the section-specific /exemptions surface — the
  // whole-card org_card_exempt flag was retired in UC-4 2026-04-15.)

  // (closed 2026-05-15 by T5-4 PR 2: quickstart/gateway.mdx,
  // gateway/enforcement.mdx, guides/multi-agent-setup.mdx all rewritten
  // onto the alignment-card master-switch pattern. The legacy
  // PUT /v1/agents/{id}/enforcement was retired by mnemom-api #409.)

  // (closed 2026-05-20 by mnemom-api cards-phase-4-w1.2b: the canonical
  // `/v1/<resource>/<scope>/<scope_id>` surface — including
  // PUT /alignment/agent/{agent_id} — is now in api.mnemom.ai/openapi.json,
  // so the concepts/cards-as-resources.mdx worked example validates
  // against the live spec.)

  // (closed 2026-05-24 by api.mnemom.ai redeploy: the 4 cards-as-primitive
  // Phase 5 endpoints — POST /admin/signing-keys/rotate, GET /agents/{id}/
  // stream, POST /agents/{id}/notifications/webhook, DELETE /agents/{id}/
  // notifications/{subscription_id} — are now in openapi.json, so the
  // concepts/aap-attestation.mdx + guides/observability-setup.mdx worked
  // examples validate against the live spec. Substrate landed in
  // mnemom-api #522 / #526 / #527 / #529 and mnemom-platform #306.)

  // (closed 2026-05-25 by api.mnemom.ai redeploy: /v1/trust/iocs from
  // AEGIS-13 mig 239 + src/trust/iocs.ts is now in openapi.json, so
  // guides/ioc-feed-consumption.mdx curl examples validate against the
  // live spec.)
];

// KNOWN_DRIFT entries use templated paths (e.g., `/agents/{agent_id}/card`)
// so a single entry covers every example variant (`$AGENT_ID`,
// `mnm-550e8...`, `smolt-...`). `templatePathMatchesSegments` from the
// shared lib applies the same template-match semantics that the executor
// uses for fixture-resolution.
function knownDriftEntry(file, method, segments) {
  return KNOWN_DRIFT.find(
    (e) =>
      e.file === file &&
      e.method === method &&
      templatePathMatchesSegments(e.path, segments),
  );
}

// ── Known body-drift allowlist ───────────────────────────────────────────
//
// Same shape as KNOWN_DRIFT but for body-schema findings. Entry matches a
// (file, method, templated-path, body-error-keyword) tuple. The keyword
// is Ajv's error keyword (`required`, `additionalProperties`, `enum`,
// `type`, etc.) plus an optional schemaPath suffix to disambiguate
// multiple errors on the same body. As T5-2 / T5-4 close, entries get
// removed.
const KNOWN_BODY_DRIFT = [
  // (closed 2026-05-21 by mnemom/mnemom-api#475 — webhook event_types
  // enum in the runtime OpenAPI spec expanded from 8 → 47 to match
  // WEBHOOK_EVENT_TYPES + the schemas/webhooks/ catalog, via a generated
  // import from src/webhooks/types.ts. The four-way coherence lint in
  // mnemom-api/scripts/validate-webhook-schemas.ts now pins the spec
  // ↔ runtime ↔ catalog ↔ schemas relationship at PR-time. The MDX
  // examples in improving-reputation.mdx, safe-house-webhooks.mdx,
  // trust-recovery.mdx, webhooks.mdx now validate against the live
  // spec with zero NEW body-schema drift findings.)
  //
  // (closed 2026-05-15 by T5-4 PR 7: docs/api-reference/openapi.json's
  // event_types enum expanded from 8 → 47 to match the canonical
  // mnemom-api/schemas/webhooks/ taxonomy, plus doc-side prefix fixes:
  // safe_house.* → sh.* and drift.detected → sideband.drift.fired in
  // guides/safe-house-webhooks.mdx, guides/webhooks.mdx. The upstream
  // spec fix in mnemom-api/openapi.json (which also has the stale
  // 8-event enum in openapi/tags/webhook-notifications.ts source) was
  // a separate cross-repo follow-up — flagged in
  // safe-house-hardening/audit/t5-4-allowlist-empty-2026-05-15.md and
  // closed 2026-05-21 by mnemom/mnemom-api#475.)

  // (closed 2026-05-15 by T5-4 PR 6 — 11 body-drift entries spanning
  // /policies/evaluate (added the `policy` field), alignment-card
  // (added `autonomy.escalation_triggers` + `audit.queryable`),
  // POST /agents (full-length hash_proof on multi-agent-setup +
  // for-agents), /teams/{id}/card (values.declared as objects, not
  // strings), and POST /agents/{id}/trust-edges (`to_agent` not
  // `target_agent_id`).)
];

function knownBodyDriftEntry(file, method, segments, keyword, schemaPath) {
  return KNOWN_BODY_DRIFT.find(
    (e) =>
      e.file === file &&
      e.method === method &&
      templatePathMatchesSegments(e.path, segments) &&
      e.keyword === keyword &&
      (!e.schemaPath || e.schemaPath === schemaPath),
  );
}

// ── Known response-drift allowlist (T5-1.4) ──────────────────────────────
//
// Parallel to KNOWN_DRIFT / KNOWN_BODY_DRIFT but for response-example
// findings. Same tuple shape: (file, method, templated-path, keyword,
// schemaPath?). Populated by the first full-repo run after T5-1.4 lands.
const KNOWN_RESPONSE_DRIFT = [
  // (closed 2026-05-15 by T5-4 PR 8 — three response-drift fixes:
  //   - guides/gdpr-data-subject-rights.mdx: DELETE /agents/{id} 202
  //     response status changed from "received" to "tombstoned"
  //     (canonical initial state per the closed enum).
  //   - guides/operating-governance-signals.mdx: governance/coverage
  //     example aligned with canonical schema (org_id, window_days,
  //     totals {fired, open}, by_source {fired/open per source},
  //     by_severity {integer per severity}).
  //   - guides/upgrading-to-0-5.mdx: trust-edges example aligned with
  //     canonical schema (agent_id, direction, count, edges[] with
  //     from_agent / to_agent fields).)
];

function knownResponseDriftEntry(file, method, segments, keyword, schemaPath) {
  return KNOWN_RESPONSE_DRIFT.find(
    (e) =>
      e.file === file &&
      e.method === method &&
      templatePathMatchesSegments(e.path, segments) &&
      e.keyword === keyword &&
      (!e.schemaPath || e.schemaPath === schemaPath),
  );
}

// ── Known auth-drift allowlist (T5-1.5) ──────────────────────────────────
//
// Each entry is a (file, method, templated-path) tuple — same shape as
// KNOWN_DRIFT. A matching entry means the curl is known to carry no header
// for any of the operation's declared schemes; it is still reported as
// "known auth drift" but does NOT fail the build. Remove entries as the
// underlying doc curl examples are corrected to carry the right header.
const KNOWN_AUTH_DRIFT = [
  // Empty — all current curl examples carry correct auth or target public
  // endpoints. Populate only if the first CI run surfaces pre-existing
  // drift that cannot be fixed in this same PR.
];

function knownAuthDriftEntry(file, method, segments) {
  return KNOWN_AUTH_DRIFT.find(
    (e) =>
      e.file === file &&
      e.method === method &&
      templatePathMatchesSegments(e.path, segments),
  );
}

// ── Self-test (exit before spec network call) ─────────────────────────────
//
// Verifies scope-resolution logic only — no spec loading required.
// Run with: node scripts/check-doc-examples.mjs --self-test
if (SELFTEST) {
  let pass = 0;
  const total = 4;

  // Resolve once; all filter predicates share this result.
  const allFiles = resolveScope(DEFAULT_SCOPE);

  // assertion 1: api-reference/endpoint is in the default scope
  const endpointFiles = allFiles.filter((f) =>
    f.includes("api-reference/endpoint"),
  );
  const endpointOk = endpointFiles.length > 0;
  console.log(
    `  ${endpointOk ? "✓" : "✗"} default scope includes api-reference/endpoint (${endpointFiles.length} file(s))`,
  );
  if (endpointOk) pass++;

  // assertion 2: at least one reputation endpoint page is in scope.
  // /(^|-)reputation(-|\.)/ covers both internal positions like
  // get-reputation-agent-id.mdx AND terminal positions like
  // get-teams-team-id-reputation.mdx (issue-319 advisory nit).
  const hasReputation = endpointFiles.some((p) =>
    /(^|-)reputation(-|\.)/.test(basename(p)),
  );
  console.log(
    `  ${hasReputation ? "✓" : "✗"} api-reference/endpoint scope includes reputation endpoint pages`,
  );
  if (hasReputation) pass++;

  // assertion 3: es locale files are in the default scope (issue-333).
  const esFiles = allFiles.filter((f) => f.startsWith("es/"));
  const esOk = esFiles.length > 0;
  console.log(
    `  ${esOk ? "✓" : "✗"} default scope includes es locale files (${esFiles.length} file(s))`,
  );
  if (esOk) pass++;

  // assertion 4: fr locale files are in the default scope (issue-333).
  const frFiles = allFiles.filter((f) => f.startsWith("fr/"));
  const frOk = frFiles.length > 0;
  console.log(
    `  ${frOk ? "✓" : "✗"} default scope includes fr locale files (${frFiles.length} file(s))`,
  );
  if (frOk) pass++;

  console.log(`\nself-test: ${pass}/${total} passed`);
  exit(pass === total ? 0 : 1);
}

// ── Load spec ────────────────────────────────────────────────────────────
// ADR-054: spec loaded from the live URL (or OPENAPI_SPEC_PATH override).
import { loadSpec } from "./_load-spec.mjs";
const spec = await loadSpec();

// ── Spec leakage gate (AC2) ───────────────────────────────────────────────
//
// Assert the served spec contains NO path from the staff list. The server-side
// filter (`buildCustomerFacingSpec` in mnemom-api openapi/customer-facing.ts)
// should strip all staff paths before serving; if one leaks through, catch it
// here and refuse to proceed. Covers all STAFF_PREFIXES (prefix-based) AND all
// STAFF_PATHS (exact-path) — both dimensions of the staff surface.
//
// Known limitation: sync-openapi.mjs has an equivalent pre-write leakage gate
// but it is regex-only and covers only prefix-based staff paths (consistent
// with current practice). This assertion is the stronger gate; it is the
// canonical check that satisfies AC2.
const staffLeakedFromSpec = Object.keys(spec.paths || {}).filter(isStaffPath);
if (staffLeakedFromSpec.length) {
  process.stderr.write(
    `check-doc-examples: refusing — staff/internal path(s) present in the served spec (server filter gap, ADR-054): ${staffLeakedFromSpec.join(", ")}\n`,
  );
  exit(2);
}

// ── Ajv + dereferencer ───────────────────────────────────────────────────
//
// OpenAPI 3.1.0 uses JSON Schema 2020-12; we use Ajv2020 with strict=false
// (OpenAPI tolerates a handful of extension keywords that strict mode
// rejects: discriminator, xml, example, externalDocs, etc.).
const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

// Manual deref. The OpenAPI spec has ~107 component schemas with
// zero cycles (verified at T5-1.2 design time), so full inline expansion
// terminates. We deref each requestBody schema lazily — once per unique
// (path, method) — and cache the compiled validator.
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

// Validator cache keyed by `${method}|${specPath}`.
const validatorCache = new Map();
function getBodyValidator(specPath, method) {
  const key = `${method}|${specPath}`;
  if (validatorCache.has(key)) return validatorCache.get(key);
  const op = spec.paths[specPath]?.[method];
  const schema = op?.requestBody?.content?.["application/json"]?.schema;
  if (!schema) {
    validatorCache.set(key, null);
    return null;
  }
  let validator;
  try {
    const dereffed = deref(schema, spec);
    validator = ajv.compile(dereffed);
  } catch (err) {
    validator = { __compileError: err.message };
  }
  validatorCache.set(key, validator);
  return validator;
}

// Response-validator cache keyed by `${method}|${specPath}|${status}`.
const responseValidatorCache = new Map();
function getResponseValidator(specPath, method, status) {
  const key = `${method}|${specPath}|${status}`;
  if (responseValidatorCache.has(key)) return responseValidatorCache.get(key);
  const op = spec.paths[specPath]?.[method];
  const schema =
    op?.responses?.[String(status)]?.content?.["application/json"]?.schema;
  if (!schema) {
    responseValidatorCache.set(key, null);
    return null;
  }
  let validator;
  try {
    const dereffed = deref(schema, spec);
    validator = ajv.compile(dereffed);
  } catch (err) {
    validator = { __compileError: err.message };
  }
  responseValidatorCache.set(key, validator);
  return validator;
}

// Pick the response status to validate the doc's example against. The
// doc rarely shows the status explicitly; we infer:
//   GET / PUT / PATCH / DELETE → 200 (fall through to first 2xx in spec)
//   POST                       → 201 if documented, else 200, else first 2xx
function inferResponseStatus(specPath, method) {
  const op = spec.paths[specPath]?.[method];
  const responses = op?.responses ?? {};
  if (method === "post") {
    if (responses["201"]) return "201";
    if (responses["200"]) return "200";
  } else {
    if (responses["200"]) return "200";
    if (responses["201"]) return "201";
  }
  // Fall through to the first 2xx documented.
  const twoxx = Object.keys(responses).find((k) => /^2\d\d$/.test(k));
  return twoxx ?? null;
}

// ── Auth-header check helpers (T5-1.5) ───────────────────────────────────

// Returns the effective security requirement for an operation:
// - operation-level `security` if the field is present (even if [])
// - spec-level `security` otherwise
// Returns [] for public endpoints (security: []).
function effectiveOpSecurity(specPath, method) {
  const op = spec.paths[specPath]?.[method];
  if (!op) return [];
  if (Object.prototype.hasOwnProperty.call(op, "security")) return op.security;
  return spec.security ?? [];
}

// Returns true if `headers` (array of raw "-H" strings) carry a header
// satisfying `schemeName` as defined in `spec.components.securitySchemes`.
// Handles http/bearer (BearerAuth) and apiKey/header (ApiKeyAuth, AgentAuth).
function headerSatisfiesScheme(headers, schemeName) {
  const def = spec.components?.securitySchemes?.[schemeName];
  if (!def) return false;
  if (def.type === "http" && def.scheme === "bearer") {
    return headers.some((h) => /^authorization\s*:\s*bearer\s+\S/i.test(h));
  }
  if (def.type === "apiKey" && def.in === "header" && def.name) {
    const name = def.name.toLowerCase();
    return headers.some((h) => {
      const colon = h.indexOf(":");
      if (colon === -1) return false;
      return (
        h.slice(0, colon).trim().toLowerCase() === name &&
        h.slice(colon + 1).trim().length > 0
      );
    });
  }
  return false;
}

// Sentinel string that replaces placeholder values during validation.
// Any Ajv error whose data == this sentinel is suppressed (the doc author
// is using a shell-substituted runtime value the static walker can't see;
// fail-by-static-checker on a placeholder shape would be a false positive).
const PLACEHOLDER_SENTINEL = "__MNEMOM_DOC_PLACEHOLDER__";

function shellVarSubstitute(jsonish) {
  // The doc grammar embeds shell substitutions inside JSON string positions:
  //   "new_key_hash": "$NEW_HASH"    "url": "${WEBHOOK_URL}"
  //   "token": "<your-token>"        "id": "YOUR_AGENT_ID"
  // At runtime shell expands `$VAR` / `${VAR}`; the actual body satisfies
  // the schema. The static walker can't see those substitutions, so it
  // substitutes the sentinel here, and the post-validate filter drops
  // errors whose `data` equals the sentinel. This preserves real-drift
  // detection on fields the doc author *did* put a literal value for.
  return jsonish
    .replace(/\$\{[A-Z_][A-Z0-9_]*\}/g, PLACEHOLDER_SENTINEL)
    .replace(/\$[A-Z_][A-Z0-9_]+/g, PLACEHOLDER_SENTINEL)
    .replace(/<[a-z][a-z0-9-]*(?:-[a-z0-9]+)*>/gi, PLACEHOLDER_SENTINEL);
}

function parseBody(raw) {
  // `curl -d @filename.yaml` is curl's "read body from file" syntax —
  // semantically the doc is saying "edit this file, then curl with -d @-".
  // The actual body content lives in a separate YAML/JSON fenced block
  // earlier in the page. The walker can't validate the in-doc grammar
  // for these without cross-block correlation; flag as "external body"
  // and skip validation. T5-1.2 follow-on can stitch these blocks
  // together if it turns out to be high-yield.
  if (raw.startsWith("@")) {
    return { external: true, ref: raw.slice(1) };
  }
  // The body grammar in our docs is single-quoted JSON: `-d '{...}'`. The
  // shell tokenizer already strips the surrounding quotes. Whitespace
  // including newlines is valid inside JSON. Try parse; report the
  // failure precisely if it doesn't round-trip.
  try {
    return { ok: true, value: JSON.parse(shellVarSubstitute(raw)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Spec index + file scope (both via shared lib) ────────────────────────
const specIndex = buildSpecIndex(spec);
const files = resolveScope(scope);

// matchSpecPath in this file always uses the local specIndex; wrap to
// match the lib's signature.
const matchSpecPathLocal = (segments) => matchSpecPath(segments, specIndex);

// ── Walk + validate ──────────────────────────────────────────────────────
const failures = [];
const knownDrift = [];
const bodyFailures = [];
const knownBodyDrift = [];
const bodyParseWarns = [];
const responseFailures = [];
const knownResponseDrift = [];
const responseParseWarns = [];
const authFailures = [];
const knownAuthDrift = [];
const passes = [];
const staffSkipped = [];
let totalCurls = 0;
let totalBodies = 0;
let bodiesValidated = 0;
let totalResponses = 0;
let responsesValidated = 0;
let authChecked = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const fencedBlocks = extractFencedBlocks(source);
  const bashBlocks = fencedBlocks.filter((b) => b.type === "bash");
  const responsePairing = pairBashWithResponseJson(fencedBlocks, source);
  const responsesValidatedInThisFile = new Set();
  for (let bIdx = 0; bIdx < bashBlocks.length; bIdx++) {
    const block = bashBlocks[bIdx];
    const responseBlock = responsePairing.get(bIdx);
    for (const curl of extractCurls(block.body)) {
      const parsed = parseCurl(curl);
      if (!parsed) continue;
      totalCurls++;
      const { method, url } = parsed;
      const norm = pathSegmentsFromUrl(url);
      if (norm.skip) {
        // Out-of-scope host (gateway.*, localhost, etc.) — silently skip.
        // The four-layer T4 defense covers api.mnemom.ai/v1; gateway has
        // no first-party spec and is a passthrough.
        continue;
      }
      const normalizedPath = "/" + norm.segments.join("/");
      if (isStaffPath(normalizedPath)) {
        // Staff/internal endpoint — intentionally absent from the served
        // customer spec (ADR-054). Validating it against that spec is a
        // category error, not drift; skip (logged below, not silent).
        staffSkipped.push({ file, line: block.line, method, path: normalizedPath });
        continue;
      }
      const matched = matchSpecPathLocal(norm.segments);
      if (!matched) {
        const allow = knownDriftEntry(file, method, norm.segments);
        const entry = { file, line: block.line, method, path: normalizedPath, curl: clip(curl), reason: `no spec path matches ${method} /v1${normalizedPath}`, allowKey: allow ? `${allow.file}|${allow.method}|${allow.path}` : null, owner: allow?.owner };
        if (allow) knownDrift.push(entry);
        else failures.push(entry);
        continue;
      }
      const m = method.toLowerCase();
      if (!matched.methods.includes(m)) {
        const allow = knownDriftEntry(file, method, norm.segments);
        const entry = { file, line: block.line, method, path: matched.raw, curl: clip(curl), reason: `method ${method} not declared on ${matched.raw} (spec has: ${matched.methods.map((x) => x.toUpperCase()).join(", ") || "none"})`, allowKey: allow ? `${allow.file}|${allow.method}|${allow.path}` : null, owner: allow?.owner };
        if (allow) knownDrift.push(entry);
        else failures.push(entry);
        continue;
      }
      passes.push({ file, line: block.line, method, path: matched.raw });

      // Auth-header check — T5-1.5.
      //
      // Skip when `--no-auth` is set. Also skip if the operation declares
      // no security requirement (security: [] — public endpoint). For all
      // other operations, at least one declared scheme must be satisfied.
      if (checkAuth) {
        const opSecurity = effectiveOpSecurity(matched.raw, m);
        // security: [{}] means "public access allowed as an alternative"
        // (empty object in the OR list = no scheme required). Skip, same as security: [].
        const hasPublicAlternative = opSecurity.some((obj) => Object.keys(obj).length === 0);
        if (opSecurity.length > 0 && !hasPublicAlternative) {
          authChecked++;
          // Collect distinct scheme names (OR semantics: any one satisfies).
          const declaredSchemes = [...new Set(opSecurity.flatMap((obj) => Object.keys(obj)))];
          const satisfied = declaredSchemes.some((sn) =>
            headerSatisfiesScheme(parsed.headers, sn),
          );
          if (!satisfied) {
            const schemeHints = declaredSchemes.map((sn) => {
              const def = spec.components?.securitySchemes?.[sn];
              if (!def) return sn;
              if (def.type === "http" && def.scheme === "bearer")
                return `Authorization: Bearer $TOKEN`;
              if (def.type === "apiKey" && def.in === "header" && def.name)
                return `${def.name}: $KEY`;
              return sn;
            });
            const allow = knownAuthDriftEntry(file, method, norm.segments);
            const entry = {
              file,
              line: block.line,
              method,
              path: matched.raw,
              declaredSchemes,
              hint: schemeHints.join(" or "),
              curl: clip(curl),
              allowKey: allow
                ? `${allow.file}|${allow.method}|${allow.path}`
                : null,
              owner: allow?.owner,
            };
            if (allow) knownAuthDrift.push(entry);
            else authFailures.push(entry);
          }
        }
      }

      // Response-example validation — T5-1.4.
      //
      // The "next JSON fenced block in the same bash→json pair" is the
      // doc's response example for this curl. Validate against
      // `responses[status].content['application/json'].schema` where
      // status is inferred (201 for POST when documented, else 200).
      // Skip if we've already validated THIS response block for any
      // earlier curl in the same bash block — the schema doesn't depend
      // on the request-side specifics here, only on (specPath, method).
      if (checkResponses && responseBlock) {
        const respKey = `${responseBlock.line}|${matched.raw}|${m}`;
        if (!responsesValidatedInThisFile.has(respKey)) {
          responsesValidatedInThisFile.add(respKey);
          totalResponses++;
          const status = inferResponseStatus(matched.raw, m);
          if (status) {
            const respValidator = getResponseValidator(matched.raw, m, status);
            if (respValidator && !respValidator.__compileError) {
              let parsedResp;
              try {
                parsedResp = JSON.parse(responseBlock.body);
              } catch (err) {
                responseParseWarns.push({ file, line: responseBlock.line, method, path: matched.raw, status, error: err.message, body: clip(responseBlock.body) });
              }
              if (parsedResp !== undefined) {
                responsesValidated++;
                const ok = respValidator(parsedResp);
                if (!ok) {
                  for (const e of respValidator.errors ?? []) {
                    const allow = knownResponseDriftEntry(file, method, norm.segments, e.keyword, e.schemaPath);
                    const entry = {
                      file,
                      line: responseBlock.line,
                      method,
                      path: matched.raw,
                      status,
                      keyword: e.keyword,
                      instancePath: e.instancePath || "(root)",
                      schemaPath: e.schemaPath,
                      reason: formatAjvError(e),
                      allowKey: allow ? `${allow.file}|${allow.method}|${allow.path}|${allow.keyword}|${allow.schemaPath ?? ""}` : null,
                      owner: allow?.owner,
                    };
                    if (allow) knownResponseDrift.push(entry);
                    else responseFailures.push(entry);
                  }
                }
              }
            }
          }
        }
      }

      // Body validation — T5-1.2.
      if (!checkBodies || parsed.body == null) continue;
      totalBodies++;
      const parsedBody = parseBody(parsed.body);
      if (parsedBody.external) {
        // `-d @file` — body lives in a separate fenced block; v1 doesn't
        // cross-correlate. Silent skip.
        continue;
      }
      if (!parsedBody.ok) {
        // Unparseable body: warn (likely an illustrative example with
        // intentionally non-JSON content like a comment or trailing
        // ellipsis). Doesn't fail the build. T5-2 / T5-4 should normalize
        // these as they audit pages.
        bodyParseWarns.push({ file, line: block.line, method, path: matched.raw, error: parsedBody.error, body: clip(parsed.body) });
        continue;
      }
      const validator = getBodyValidator(matched.raw, m);
      if (!validator) {
        // Spec has no requestBody schema for this op — no contract to
        // assert against. Silent; this is "spec gap" territory, handled
        // by Track 4, not T5.
        continue;
      }
      if (validator.__compileError) {
        bodyParseWarns.push({ file, line: block.line, method, path: matched.raw, error: `Ajv compile error: ${validator.__compileError}`, body: clip(parsed.body) });
        continue;
      }
      bodiesValidated++;
      const ok = validator(parsedBody.value);
      if (!ok) {
        const errs = (validator.errors ?? []).filter((e) => {
          // Suppress findings on placeholder values — the doc relies on
          // shell substitution; the static walker can't see the actual
          // value, so pattern/format/length checks are noise here. Real
          // drift on a placeholder field (e.g., a removed required field)
          // still surfaces because `required` errors don't carry `e.data`.
          if (e.keyword === "required") return true;
          // Pull the actual value at the error's instancePath. Ajv's
          // `e.data` isn't always populated for pattern/format errors, so
          // resolve from the parsed body directly.
          let cur = parsedBody.value;
          for (const seg of (e.instancePath || "").split("/").filter(Boolean)) {
            const key = seg.replace(/~1/g, "/").replace(/~0/g, "~");
            if (cur == null) break;
            cur = cur[key];
          }
          if (typeof cur === "string" && cur === PLACEHOLDER_SENTINEL) return false;
          return true;
        });
        if (errs.length === 0) continue;
        for (const e of errs) {
          const keyword = e.keyword;
          const schemaPath = e.schemaPath;
          const instancePath = e.instancePath || "(root)";
          const detail = formatAjvError(e);
          const allow = knownBodyDriftEntry(file, method, norm.segments, keyword, schemaPath);
          const entry = {
            file,
            line: block.line,
            method,
            path: matched.raw,
            keyword,
            instancePath,
            schemaPath,
            reason: detail,
            curl: clip(curl),
            allowKey: allow ? `${allow.file}|${allow.method}|${allow.path}|${allow.keyword}|${allow.schemaPath ?? ""}` : null,
            owner: allow?.owner,
          };
          if (allow) knownBodyDrift.push(entry);
          else bodyFailures.push(entry);
        }
      }
    }
  }
}

function clip(s) {
  return s.length > 140 ? s.slice(0, 137) + "..." : s;
}

function formatAjvError(e) {
  const where = e.instancePath || "(root)";
  switch (e.keyword) {
    case "required":
      return `${where}: missing required property '${e.params.missingProperty}'`;
    case "additionalProperties":
      return `${where}: unknown property '${e.params.additionalProperty}'`;
    case "enum":
      return `${where}: value not in enum ${JSON.stringify(e.params.allowedValues).slice(0, 80)}`;
    case "type":
      return `${where}: expected ${e.params.type}, got ${typeof e.data ?? "?"}`;
    case "const":
      return `${where}: expected const ${JSON.stringify(e.params.allowedValue)}`;
    case "format":
      return `${where}: ${e.message ?? "format violation"} (expected ${e.params.format})`;
    case "pattern":
      return `${where}: pattern mismatch (${e.params.pattern})`;
    case "minLength":
    case "maxLength":
    case "minimum":
    case "maximum":
    case "minItems":
    case "maxItems":
      return `${where}: ${e.message}`;
    default:
      return `${where}: ${e.keyword}${e.message ? ` — ${e.message}` : ""}`;
  }
}

// ── Report ───────────────────────────────────────────────────────────────
const fileCount = files.length;
console.log(`Scanned ${fileCount} MDX file(s) across [${scope}].`);
console.log(`Extracted ${totalCurls} curl invocation(s) targeting api.mnemom.ai/v1/*.`);
if (staffSkipped.length) {
  console.log(
    `Skipped ${staffSkipped.length} staff/internal-path example(s) (excluded from the customer spec by design, ADR-054): ` +
      staffSkipped.map((s) => `${s.method} ${s.path} (${s.file}:${s.line})`).join(", "),
  );
}
if (checkBodies) {
  console.log(`Body validation: ${bodiesValidated} body(ies) validated against requestBody schemas (${totalBodies - bodiesValidated} skipped: no schema, parse-error, or compile-error).`);
}
if (checkResponses) {
  console.log(`Response validation: ${responsesValidated} response example(s) validated against responses[code] schemas (${totalResponses - responsesValidated} skipped: no schema, parse-error, or compile-error).`);
}
if (checkAuth) {
  console.log(`Auth validation: ${authChecked} curl(s) with non-public security checked; ${authFailures.length} auth-header failure(s), ${knownAuthDrift.length} known auth-drift.`);
}

if (verbose) {
  for (const p of passes) {
    console.log(`  ✓ ${p.method.padEnd(6)} ${p.path}   (${p.file}:${p.line})`);
  }
}

if (knownDrift.length > 0) {
  console.log();
  console.log(`Known drift (allowlisted; tracked under T5-2 / T5-4): ${knownDrift.length}`);
  const byFile = new Map();
  for (const f of knownDrift) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.method} ${f.path}  [${f.owner ?? "?"}]`);
    }
  }
}

if (knownBodyDrift.length > 0) {
  console.log();
  console.log(`Known body drift (allowlisted; tracked under T5-2 / T5-4): ${knownBodyDrift.length}`);
  const byFile = new Map();
  for (const f of knownBodyDrift) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.method} ${f.path}  body.${f.keyword}: ${f.reason}  [${f.owner ?? "?"}]`);
    }
  }
}

if (bodyParseWarns.length > 0) {
  console.log();
  console.log(`⚠ ${bodyParseWarns.length} body(ies) could not be JSON-parsed (non-blocking; T5-2 / T5-4 should normalize these):`);
  for (const w of bodyParseWarns) {
    console.log(`  ${w.file}:${w.line}  ${w.method} ${w.path} — ${w.error}`);
  }
}

if (knownResponseDrift.length > 0) {
  console.log();
  console.log(`Known response drift (allowlisted; tracked under T5-2 / T5-4): ${knownResponseDrift.length}`);
  const byFile = new Map();
  for (const f of knownResponseDrift) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.method} ${f.path} [${f.status}]  resp.${f.keyword}: ${f.reason}  [${f.owner ?? "?"}]`);
    }
  }
}

if (responseParseWarns.length > 0) {
  console.log();
  console.log(`⚠ ${responseParseWarns.length} response example(s) could not be JSON-parsed (non-blocking):`);
  for (const w of responseParseWarns) {
    console.log(`  ${w.file}:${w.line}  ${w.method} ${w.path} — ${w.error}`);
  }
}

if (knownAuthDrift.length > 0) {
  console.log();
  console.log(`Known auth-header drift (allowlisted; tracked under T5-1.5): ${knownAuthDrift.length}`);
  const byFile = new Map();
  for (const f of knownAuthDrift) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.method} ${f.path}  [${f.owner ?? "?"}]`);
    }
  }
}

// Detect stale KNOWN_DRIFT entries — present in the allowlist but no
// longer matched by any extracted example. These should be removed.
const seenTuples = new Set(knownDrift.map((d) => d.allowKey).filter(Boolean));
const stale = KNOWN_DRIFT.filter(
  (e) => !seenTuples.has(`${e.file}|${e.method}|${e.path}`),
);
const seenBodyTuples = new Set(knownBodyDrift.map((d) => d.allowKey).filter(Boolean));
const staleBody = KNOWN_BODY_DRIFT.filter(
  (e) => !seenBodyTuples.has(`${e.file}|${e.method}|${e.path}|${e.keyword}|${e.schemaPath ?? ""}`),
);
const seenRespTuples = new Set(knownResponseDrift.map((d) => d.allowKey).filter(Boolean));
const staleResp = KNOWN_RESPONSE_DRIFT.filter(
  (e) => !seenRespTuples.has(`${e.file}|${e.method}|${e.path}|${e.keyword}|${e.schemaPath ?? ""}`),
);
const seenAuthTuples = new Set(knownAuthDrift.map((d) => d.allowKey).filter(Boolean));
const staleAuth = KNOWN_AUTH_DRIFT.filter(
  (e) => !seenAuthTuples.has(`${e.file}|${e.method}|${e.path}`),
);

if (
  failures.length === 0 &&
  bodyFailures.length === 0 &&
  responseFailures.length === 0 &&
  authFailures.length === 0 &&
  stale.length === 0 &&
  staleBody.length === 0 &&
  staleResp.length === 0 &&
  staleAuth.length === 0
) {
  console.log();
  console.log(`✓ ${passes.length} curl example(s) match a documented endpoint; ${knownDrift.length} known path-drift + ${knownBodyDrift.length} known body-drift + ${knownResponseDrift.length} known response-drift allowlisted; ${bodiesValidated} body(ies) + ${responsesValidated} response(s) validated; ${authChecked} auth-header(s) checked; ${knownAuthDrift.length} known auth-drift allowlisted.`);
  exit(0);
}

if (failures.length > 0) {
  console.log();
  console.log(`❌ ${failures.length} NEW doc example(s) drift from the live OpenAPI spec (https://api.mnemom.ai/openapi.json):\n`);
  const byFile = new Map();
  for (const f of failures) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.reason}`);
      console.log(`      ${f.curl}`);
    }
    console.log();
  }
  console.log("Each failure is one of:");
  console.log("  - the doc references an endpoint that doesn't exist in the spec");
  console.log("    (likely a rename or removal — fix the doc to match openapi.json),");
  console.log("  - the doc uses a method the spec doesn't declare on that path");
  console.log("    (likely a method-not-allowed drift — fix the doc),");
  console.log("  - the spec is missing an endpoint that should be there");
  console.log("    (rare after T4-4; if real, fix mnemom-api/openapi.json first).");
  console.log();
  console.log("If this finding is the same drift as an existing KNOWN_DRIFT");
  console.log("entry, the existing entry's normalized path may not match — recheck");
  console.log("file/method/path against the extracted form shown above.");
}

if (bodyFailures.length > 0) {
  console.log();
  console.log(`❌ ${bodyFailures.length} NEW body-schema drift finding(s):\n`);
  const byFile = new Map();
  for (const f of bodyFailures) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.method} ${f.path}`);
      console.log(`      ${f.keyword}: ${f.reason}`);
      console.log(`      schemaPath=${f.schemaPath}`);
    }
    console.log();
  }
  console.log("Body failures mean a doc example's JSON payload doesn't satisfy");
  console.log("the spec's requestBody schema. Most likely:");
  console.log("  - the doc uses a field that was renamed / removed,");
  console.log("  - the doc omits a now-required field,");
  console.log("  - the doc uses an enum value the spec no longer allows.");
  console.log("Fix the doc to match the spec, or — if the spec is wrong —");
  console.log("fix mnemom-api/openapi.json first.");
}

if (stale.length > 0) {
  console.log();
  console.log(`⚠ ${stale.length} stale KNOWN_DRIFT entr${stale.length === 1 ? "y" : "ies"} — remove from scripts/check-doc-examples.mjs:`);
  for (const e of stale) {
    console.log(`  - ${e.file}: ${e.method} ${e.path}  [${e.owner}]`);
  }
  console.log();
  console.log("A stale entry means the underlying doc drift is resolved.");
  console.log("Removing the entry tightens the gate.");
}

if (staleBody.length > 0) {
  console.log();
  console.log(`⚠ ${staleBody.length} stale KNOWN_BODY_DRIFT entr${staleBody.length === 1 ? "y" : "ies"} — remove from scripts/check-doc-examples.mjs:`);
  for (const e of staleBody) {
    console.log(`  - ${e.file}: ${e.method} ${e.path}  body.${e.keyword}  [${e.owner ?? "?"}]`);
  }
}

if (responseFailures.length > 0) {
  console.log();
  console.log(`❌ ${responseFailures.length} NEW response-schema drift finding(s):\n`);
  const byFile = new Map();
  for (const f of responseFailures) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.method} ${f.path} [${f.status}]`);
      console.log(`      ${f.keyword}: ${f.reason}`);
      console.log(`      schemaPath=${f.schemaPath}`);
    }
    console.log();
  }
  console.log("Response failures mean a doc example's response JSON doesn't");
  console.log("satisfy the spec's `responses[code]` schema. Most likely:");
  console.log("  - the doc shows fields the spec no longer documents,");
  console.log("  - the doc omits fields the spec now requires,");
  console.log("  - the doc uses an enum value the spec no longer allows.");
  console.log("Fix the doc to match the spec, or — if the spec is wrong —");
  console.log("fix mnemom-api/openapi.json first.");
}

if (staleResp.length > 0) {
  console.log();
  console.log(`⚠ ${staleResp.length} stale KNOWN_RESPONSE_DRIFT entr${staleResp.length === 1 ? "y" : "ies"} — remove from scripts/check-doc-examples.mjs:`);
  for (const e of staleResp) {
    console.log(`  - ${e.file}: ${e.method} ${e.path}  resp.${e.keyword}  [${e.owner ?? "?"}]`);
  }
}

if (authFailures.length > 0) {
  console.log();
  console.log(`❌ ${authFailures.length} NEW auth-header drift finding(s) (T5-1.5):\n`);
  const byFile = new Map();
  for (const f of authFailures) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.method} ${f.path}`);
      console.log(`      declared schemes: ${f.declaredSchemes.join(", ")}`);
      console.log(`      fix: add -H "${f.hint}" to the curl example`);
      console.log(`      ${f.curl}`);
    }
    console.log();
  }
  console.log("Auth failures mean a curl example is missing the Authorization");
  console.log("header required by the operation's declared security scheme.");
  console.log("Add the appropriate -H flag to the curl in the doc.");
}

if (staleAuth.length > 0) {
  console.log();
  console.log(`⚠ ${staleAuth.length} stale KNOWN_AUTH_DRIFT entr${staleAuth.length === 1 ? "y" : "ies"} — remove from scripts/check-doc-examples.mjs:`);
  for (const e of staleAuth) {
    console.log(`  - ${e.file}: ${e.method} ${e.path}  [${e.owner ?? "?"}]`);
  }
}

exit(1);
