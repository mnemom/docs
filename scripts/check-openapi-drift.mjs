#!/usr/bin/env node
/**
 * check-openapi-drift.mjs
 *
 * Two guards:
 *
 *  1. Staff-surface leak guard. Customer-facing docs (api-reference/
 *     openapi.json and all MDX/docs.json) must not reference any path
 *     under the staff/internal prefix set — `/admin/*`, `/arena/*`,
 *     `/internal/*`, `/v1/internal/*`, `/sonar/*`, `/rb2b/*` — nor any
 *     of the specific staff endpoints (Stripe webhook receiver, internal
 *     email hook, contact-form notify, on-chain anchor/publish ops,
 *     `/health`). The customer org-admin surface lives under
 *     `/v1/orgs/{org_id}/*`. See STAFF_PREFIXES / STAFF_PATHS below for
 *     the canonical list; this is the docs-side defense-in-depth gate
 *     that complements mnemom-api's own `x-internal` filtering (filed as
 *     a follow-up against mnemom-api per the audit linked from
 *     safe-house-hardening).
 *
 *  2. Manifest sync guard. Customer-facing paths in mnemom-api/openapi.json
 *     and api-reference/openapi.json must match. Pre-2026-05-15 this was
 *     a byte-equivalence check that conflated path-surface drift with
 *     operation-shape drift; that broke under mnemom-api's manifest
 *     generator leaking staff paths into the source-of-truth file. The
 *     guard now compares the *path sets* after filtering staff prefixes
 *     on both sides. Operation-shape drift is covered by the T5-1
 *     doc-as-spec walker (`check-doc-examples.mjs`), which validates
 *     every documented endpoint's body/response schemas in customer
 *     MDX against the spec.
 *
 * Usage:
 *   node scripts/check-openapi-drift.mjs <path-to-mnemom-api-openapi-json>
 *
 *   In CI: workflow checks out mnemom-api at ref=main and passes
 *   mnemom-api/openapi.json. Locally: pass the path to your working copy
 *   of mnemom-api's openapi.json.
 *
 * Exits 0 on clean. Exits 1 with a report on any leak or drift.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const sourceOfTruthPath = argv[2];
if (!sourceOfTruthPath) {
  console.error(
    "Usage: check-openapi-drift.mjs <path-to-mnemom-api-openapi-json>",
  );
  console.error(
    "  e.g. node scripts/check-openapi-drift.mjs ../mnemom-api/openapi.json",
  );
  exit(2);
}

// ── Read both specs ──────────────────────────────────────────────────────
const docsRaw = readFileSync("api-reference/openapi.json", "utf8");
const sotRaw = readFileSync(sourceOfTruthPath, "utf8");

const docsSpec = JSON.parse(docsRaw);
const sotSpec = JSON.parse(sotRaw);

// ── Staff / internal surface definition ──────────────────────────────────
//
// Any openapi.json path that starts with one of these prefixes is
// staff-only — must not appear in api-reference/openapi.json, must not
// be referenced as `/v1/<prefix>` in customer MDX, and is filtered out
// before the Guard 2 path-set comparison so drift only flags the
// genuine customer-facing surface.
//
// Adding to this list is the right move when mnemom-api adds a new
// internal namespace. The long-term fix is for mnemom-api to mark these
// `x-internal: true` and exclude them from the openapi.json generator;
// until that lands, this docs-side filter keeps the gate sound. See
// safe-house-hardening audit/openapi-drift-root-cause-2026-05-14.md.
const STAFF_PREFIXES = [
  "/admin/",
  "/arena/",
  "/internal/",
  "/v1/internal/", // anomalous /v1/ prefix on some internal routes
  "/sonar/",
  "/rb2b/",
];

// Single-path staff endpoints (not prefix-namespaced).
const STAFF_PATHS = new Set([
  "/auth/send-email-hook",
  "/billing/webhooks/stripe",
  "/contact/notify",
  "/on-chain/anchor-root",
  "/on-chain/publish-scores",
  "/health",
]);

function isStaffPath(p) {
  if (STAFF_PATHS.has(p)) return true;
  return STAFF_PREFIXES.some((pre) => p.startsWith(pre));
}

// ── Guard 1 — staff-surface leak check ──────────────────────────────────
//
// Customer-facing artifacts must not declare or reference any staff path.
const staffPathsInSpec = Object.keys(docsSpec.paths ?? {}).filter(isStaffPath);

const CONTENT_EXTENSIONS = [".mdx", ".md", ".json"];
const SCAN_EXCLUDE_DIRS = new Set([
  ".git",
  ".github",
  ".claude",
  "node_modules",
  "scripts",
  "fonts",
  "images",
  "logo",
  // External repos checked out by the CI workflow for the manifest sync
  // guard (Guard 2). Their openapi.json files document the FULL surface
  // including /admin/ paths and must not be walked as if they were
  // customer docs.
  "mnemom-api",
  "mnemom-reputation",
  "mnemom-risk",
]);

function walkContent(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SCAN_EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walkContent(full, acc);
    else if (CONTENT_EXTENSIONS.some((e) => entry.endsWith(e))) acc.push(full);
  }
  return acc;
}

// Build the customer-doc leak pattern from STAFF_PREFIXES + STAFF_PATHS.
// Patterns target the `/v1/<staff>` form because customer MDX references
// the API surface via the versioned `/v1/` URL prefix (the spec strips it
// into `servers[].url`).
// Standard regex-meta escape (MDN-recommended set). Our inputs today are
// path strings with `/` and `-`, but a future addition could carry any
// metachar; escape the whole set so the gate stays sound.
function escapeRegex(s) {
  return s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}
const staffRefPatterns = [
  ...STAFF_PREFIXES.map((pre) => new RegExp(`/v1${escapeRegex(pre)}`)),
  ...[...STAFF_PATHS].map((p) => new RegExp(`/v1${escapeRegex(p)}\\b`)),
];
// Files where historical references to retired staff paths are
// legitimate. Changelogs document path removals; the references are
// archival, not present-tense routes for the customer to call.
const STAFF_LEAK_ALLOWLIST = new Set(["changelog.mdx"]);

const mdxLeaks = [];
for (const file of walkContent(".")) {
  if (file === "api-reference/openapi.json") continue;
  if (STAFF_LEAK_ALLOWLIST.has(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const re of staffRefPatterns) {
    if (re.test(content)) {
      mdxLeaks.push(file);
      break;
    }
  }
}

if (staffPathsInSpec.length > 0 || mdxLeaks.length > 0) {
  console.log("❌ Staff-only surface leaked into customer docs.");
  console.log();
  console.log("   The following prefixes/paths are Mnemom-staff-only and must");
  console.log("   not appear in customer-facing docs. The customer org-admin");
  console.log("   surface lives under /v1/orgs/{org_id}/*.");
  console.log();
  console.log(`   Staff prefixes: ${STAFF_PREFIXES.join(", ")}`);
  console.log(`   Staff paths: ${[...STAFF_PATHS].join(", ")}`);
  console.log();
  if (staffPathsInSpec.length > 0) {
    console.log(`   openapi.json paths (${staffPathsInSpec.length}):`);
    for (const p of staffPathsInSpec) console.log(`     - ${p}`);
    console.log();
  }
  if (mdxLeaks.length > 0) {
    console.log(`   Files referencing a staff prefix/path (${mdxLeaks.length}):`);
    for (const f of mdxLeaks) console.log(`     - ${f}`);
    console.log();
  }
  exit(1);
}

// ── Guard 2 — customer-facing path-set sync ─────────────────────────────
//
// Compare the path SETS of docs/api-reference/openapi.json and
// mnemom-api/openapi.json after filtering out staff/internal paths on
// both sides. Operation-level drift (request/response body shape) is
// covered by the T5-1 doc-as-spec walker, not here — this guard is the
// surface-area gate (every customer-facing endpoint that exists in the
// runtime is documented, and nothing the runtime doesn't expose is
// documented).
const docsPaths = new Set(
  Object.keys(docsSpec.paths ?? {}).filter((p) => !isStaffPath(p)),
);
const sotPaths = new Set(
  Object.keys(sotSpec.paths ?? {}).filter((p) => !isStaffPath(p)),
);
const onlyDocs = [...docsPaths].filter((p) => !sotPaths.has(p)).sort();
const onlySot = [...sotPaths].filter((p) => !docsPaths.has(p)).sort();

if (onlyDocs.length === 0 && onlySot.length === 0) {
  console.log(
    `✓ Customer-facing path set matches mnemom-api (${docsPaths.size} paths; ${Object.keys(sotSpec.paths ?? {}).length - sotPaths.size} staff paths filtered).`,
  );
  exit(0);
}

console.log("❌ Customer-facing path set drifts between docs and mnemom-api.");
console.log();
console.log("   docs/api-reference/openapi.json should declare exactly the");
console.log("   customer-facing paths that mnemom-api exposes. Staff prefixes");
console.log("   are filtered before comparison (Guard 1 enforces no leak).");
console.log();

if (onlyDocs.length > 0) {
  console.log(`   Paths in docs but not in mnemom-api source-of-truth (${onlyDocs.length}):`);
  console.log("   (likely: endpoint retired in mnemom-api; remove from docs)");
  for (const p of onlyDocs) console.log(`     - ${p}`);
  console.log();
}
if (onlySot.length > 0) {
  console.log(`   Paths in mnemom-api source-of-truth but not in docs (${onlySot.length}):`);
  console.log("   (likely: new customer endpoint; sync the operation into docs)");
  console.log("   (if staff-only: add to STAFF_PREFIXES / STAFF_PATHS)");
  for (const p of onlySot) console.log(`     + ${p}`);
  console.log();
}

exit(1);
