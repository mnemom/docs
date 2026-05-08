#!/usr/bin/env node
/**
 * check-openapi-drift.mjs
 *
 * Two guards:
 *
 *  1. Staff-surface leak guard. /v1/admin/* is permanently Mnemom-staff-only
 *     and must never appear in customer docs. Fails if any /admin/ path is
 *     in api-reference/openapi.json, or any /v1/admin/ reference appears in
 *     customer-facing MDX / docs.json. The customer org-admin surface lives
 *     under /v1/orgs/{org_id}/*.
 *
 *  2. Manifest sync guard. Asserts api-reference/openapi.json equals
 *     mnemom-api/openapi.json (the manifest-generated source of truth).
 *     This replaced the previous regex-based route extractor on
 *     2026-05-08 — see mnemom-api PR #360 for the architectural shift to
 *     manifest-driven OpenAPI generation. The regex extractor had a bug
 *     (matched only single-quoted route strings, while mnemom-api uses
 *     double quotes) that silently zero'd out coverage of the entire
 *     mnemom-api source; see commit message of this script's prior
 *     revision for the full forensics.
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

// ── Guard 1 — staff-surface leak check ──────────────────────────────────
//
// /v1/admin/* is permanently Mnemom-staff-only and must not surface in
// customer docs. Fails if openapi.json declares a path under /admin/ or
// any customer-docs MDX / docs.json references /v1/admin/.
//
// openapi.json paths don't carry the /v1 prefix (it's in `servers`), so a
// leak shows up as a top-level path that begins with /admin/.
const staffPathsInSpec = Object.keys(docsSpec.paths ?? {}).filter((p) =>
  p.startsWith("/admin/"),
);

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

const STAFF_PREFIX_IN_TEXT = /\/v1\/admin\//;
const mdxLeaks = [];
for (const file of walkContent(".")) {
  if (file === "api-reference/openapi.json") continue;
  const content = readFileSync(file, "utf8");
  if (STAFF_PREFIX_IN_TEXT.test(content)) mdxLeaks.push(file);
}

if (staffPathsInSpec.length > 0 || mdxLeaks.length > 0) {
  console.log("❌ Staff-only surface leaked into customer docs.");
  console.log();
  console.log("   /v1/admin/* is permanently Mnemom-staff-only. Customer");
  console.log("   org-admin routes live under /v1/orgs/{org_id}/*.");
  console.log();
  if (staffPathsInSpec.length > 0) {
    console.log(`   openapi.json paths (${staffPathsInSpec.length}):`);
    for (const p of staffPathsInSpec) console.log(`     - ${p}`);
    console.log();
  }
  if (mdxLeaks.length > 0) {
    console.log(`   Files referencing /v1/admin/ (${mdxLeaks.length}):`);
    for (const f of mdxLeaks) console.log(`     - ${f}`);
    console.log();
  }
  exit(1);
}

// ── Guard 2 — manifest sync ─────────────────────────────────────────────
//
// docs/api-reference/openapi.json is a downstream mirror of
// mnemom-api/openapi.json (which is generated from the manifest at
// mnemom-api/openapi/). Drift between them is enforced byte-equivalent.
// To resolve drift: copy mnemom-api/openapi.json over.

if (docsRaw === sotRaw) {
  console.log("✓ openapi.json matches mnemom-api/openapi.json (no drift).");
  exit(0);
}

// They differ. Produce a useful summary diff.
const docsPaths = new Set(Object.keys(docsSpec.paths ?? {}));
const sotPaths = new Set(Object.keys(sotSpec.paths ?? {}));
const onlyDocs = [...docsPaths].filter((p) => !sotPaths.has(p)).sort();
const onlySot = [...sotPaths].filter((p) => !docsPaths.has(p)).sort();

console.log("❌ docs/api-reference/openapi.json drifts from mnemom-api/openapi.json.");
console.log();
console.log("   mnemom-api/openapi.json is the manifest-generated source of");
console.log("   truth. To resolve: copy it over and commit.");
console.log();
console.log("   Local fix:");
console.log("     cp ../mnemom-api/openapi.json api-reference/openapi.json");
console.log("     git add api-reference/openapi.json && git commit -m 'chore(docs): sync openapi.json'");
console.log();

if (onlyDocs.length > 0) {
  console.log(`   Paths in docs but not in mnemom-api source-of-truth (${onlyDocs.length}):`);
  for (const p of onlyDocs) console.log(`     - ${p}`);
  console.log();
}
if (onlySot.length > 0) {
  console.log(`   Paths in mnemom-api source-of-truth but not in docs (${onlySot.length}):`);
  for (const p of onlySot) console.log(`     + ${p}`);
  console.log();
}

if (onlyDocs.length === 0 && onlySot.length === 0) {
  console.log(
    "   Path keys match; the drift is in operations, components, info, or formatting.",
  );
  console.log("   Use `diff api-reference/openapi.json ../mnemom-api/openapi.json` for the line-level diff.");
  console.log();
}

exit(1);
