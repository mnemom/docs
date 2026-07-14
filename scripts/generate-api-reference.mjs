#!/usr/bin/env node
// scripts/generate-api-reference.mjs — project the committed customer-facing
// OpenAPI slice into Mintlify api-reference endpoint pages + navigation.
//
// Each customer-facing operation becomes a generated page:
//     ---
//     title: "<operation summary>"
//     openapi: "<METHOD> <bare path>"
//     ---
// (bare path: the spec keys paths without the /v1 prefix, which lives in
//  servers[0].url). This makes the reference a drift-proof projection — pages
//  can never document an endpoint the contract doesn't define.
//
// Idempotent: skips ops that already have a page (by openapi-directive key OR by
// filename, so hand-written pages like the GDPR-erasure narratives are
// preserved). Skips deliberately-held endpoints (see HELD).
//
// The "what would change?" decision (new pages, refreshed stubs, nav add/dedup,
// orphan directives) lives in the pure helper scripts/lib/api-reference-drift.mjs
// so the write path and the --check gate can never disagree.
//
// Usage:  node scripts/generate-api-reference.mjs           (write pages + nav)
//         node scripts/generate-api-reference.mjs --dry-run (report only)
//         node scripts/generate-api-reference.mjs --check   (drift gate; exit 1
//             if running the generator WOULD create or modify any endpoint page
//             or docs.json nav entry — i.e. the committed tree has drifted from
//             the spec. Covers every drift class: pages to write, stub
//             title/description refreshes, nav entries to add/dedup, and orphan
//             directives that resolve to no spec operation. Fail-closed: a
//             missing/unparseable spec, an empty endpoint/ dir, or a
//             missing/malformed docs.json exits non-zero with a clear error,
//             never a false "no drift".)

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { computeDrift } from "./lib/api-reference-drift.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(ROOT, "api-reference", "openapi.json");
const ENDPOINT_DIR = join(ROOT, "api-reference", "endpoint");
const DOCS_JSON = join(ROOT, "docs.json");
const DRY = process.argv.includes("--dry-run");
const CHECK = process.argv.includes("--check");

// --check must fail CLOSED: any condition that prevents a trustworthy drift
// evaluation exits non-zero with an actionable ::error:: line, never a false ✓.
function checkFail(msg) {
  process.stderr.write(`::error::generate-api-reference --check: ${msg}\n`);
  process.exit(1);
}

function loadSpec() {
  let raw;
  try {
    raw = readFileSync(SPEC, "utf8");
  } catch {
    if (CHECK) checkFail("api-reference/openapi.json is missing or unreadable — cannot evaluate drift.");
    throw new Error(`Cannot read ${SPEC}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    if (CHECK) checkFail("api-reference/openapi.json is not valid JSON — cannot evaluate drift.");
    throw e;
  }
}

function loadEndpointFiles() {
  let files;
  try {
    files = readdirSync(ENDPOINT_DIR).filter((f) => f.endsWith(".mdx"));
  } catch {
    if (CHECK) checkFail("api-reference/endpoint/ is missing or unreadable — cannot evaluate drift.");
    throw new Error(`Cannot read ${ENDPOINT_DIR}`);
  }
  if (CHECK && files.length === 0) {
    checkFail('api-reference/endpoint/ contains no .mdx pages — refusing to report "no drift" on an empty tree.');
  }
  return files;
}

function loadDocs() {
  let raw;
  try {
    raw = readFileSync(DOCS_JSON, "utf8");
  } catch {
    if (CHECK) checkFail("docs.json is missing or unreadable — cannot evaluate nav drift.");
    throw new Error(`Cannot read ${DOCS_JSON}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    if (CHECK) checkFail("docs.json is not valid JSON — cannot evaluate nav drift.");
    throw e;
  }
}

const spec = loadSpec();
const existingFiles = loadEndpointFiles();
const docs = loadDocs();
const readEndpoint = (f) => readFileSync(join(ENDPOINT_DIR, f), "utf8");

// Single source of truth: the write path and the --check gate route through the
// same pure computation (no disk writes inside; docs is mutated to hold the plan).
const drift = computeDrift({ spec, existingFiles, readEndpoint, docs });

// --check: assert the generator is a complete no-op on the committed tree.
if (CHECK) {
  const total = drift.written + drift.refreshed + drift.added + drift.deduped + drift.orphans.length;
  if (total === 0) {
    process.stderr.write(
      `generate-api-reference --check: ✓ no drift — ${existingFiles.length} pages, nav, and directives all match the spec.\n`,
    );
    process.exit(0);
  }
  const classes = [];
  if (drift.written) classes.push(`would write ${drift.written} page(s)`);
  if (drift.refreshed) classes.push(`${drift.refreshed} stub title/description(s) drifted`);
  if (drift.added) classes.push(`${drift.added} nav entry/entries missing`);
  if (drift.deduped) classes.push(`${drift.deduped} duplicate nav entry/entries`);
  if (drift.orphans.length) {
    classes.push(`${drift.orphans.length} orphan directive(s):\n    ${drift.orphans.sort().join("\n    ")}`);
  }
  process.stderr.write(
    `::error::generate-api-reference --check: drift detected — the committed pages/nav are behind the spec:\n  ` +
      classes.join("\n  ") +
      `\nRun 'node scripts/generate-api-reference.mjs' and commit the generated changes.\n`,
  );
  process.exit(1);
}

// Write / dry-run: apply the helper's plan to disk (unless --dry-run).
let written = 0;
for (const o of drift.toGen) {
  if (!DRY) writeFileSync(join(ENDPOINT_DIR, o.file), o.body);
  written++;
}
let refreshed = 0;
for (const r of drift.refreshList) {
  if (!DRY) writeFileSync(join(ENDPOINT_DIR, r.file), r.body);
  refreshed++;
}
if (!DRY) writeFileSync(DOCS_JSON, JSON.stringify(docs, null, 2) + "\n");

// ---- Report ----
const added = drift.added;
const { flagged, excluded, byGroup } = drift;
const groupCounts = Object.entries(byGroup)
  .map(([g, o]) => `${g} (+${o.length})`)
  .sort();
process.stderr.write(
  `generate-api-reference${DRY ? " [dry-run]" : ""}:\n` +
    `  pages ${DRY ? "would write" : "written"}: ${written}\n`+
    `  titles refreshed: ${refreshed}\n`+
    `` +
    `  nav pages added: ${added}\n` +
    `  groups touched (${groupCounts.length}):\n    ${groupCounts.join("\n    ")}\n` +
    `  EXCLUDED — deprecated:${excluded.deprecated.length} dashboard-session:${excluded["dashboard-session"].length} non-api:${excluded["non-api"].length} held:${excluded.held.length}\n` +
    `    deprecated: ${excluded.deprecated.join(", ") || "—"}\n` +
    `    dashboard-session: ${excluded["dashboard-session"].join(", ") || "—"}\n` +
    `    non-api: ${excluded["non-api"].join(", ") || "—"}\n` +
    (flagged.length ? `  public (no-auth) product endpoints kept (${flagged.length}):\n    ${flagged.map((f) => `${f.key}`).join("\n    ")}\n` : "  flagged: none\n"),
);
