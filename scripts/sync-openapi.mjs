#!/usr/bin/env node
// scripts/sync-openapi.mjs — sync the committed customer-facing OpenAPI slice.
//
// The api-reference tier is a PROJECTION of the deployed customer API. The
// source of truth is the slice served at GET https://api.mnemom.ai/openapi.json
// (mnemom-api applies its STAFF_PREFIXES/STAFF_TAGS filter server-side per
// ADR-054, so this is already customer-only — no /admin, /arena, /internal).
//
// We commit that slice into the repo (api-reference/openapi.json) so docs
// builds are deterministic + offline, and `docs.json` renders from the file
// rather than fetching at build time. CI re-runs this and `git diff --exit-code`s
// the result (see .github/workflows/openapi-freshness.yml) so the committed copy
// can never silently drift from the deployed surface.
//
// Usage:  node scripts/sync-openapi.mjs            (writes the file)
//         node scripts/sync-openapi.mjs --check    (writes; CI then diffs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE = process.env.MNEMOM_OPENAPI_URL || "https://api.mnemom.ai/openapi.json";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "api-reference", "openapi.json");

const res = await fetch(SOURCE, { headers: { accept: "application/json" } });
if (!res.ok) {
  process.stderr.write(`sync-openapi: fetch ${SOURCE} -> ${res.status}\n`);
  process.exit(2);
}
const spec = await res.json();

// Defensive: the served slice must be customer-only. If a staff path leaks
// through, fail loudly rather than commit it (matches the leakage gate intent).
const STAFF = /^\/(admin|arena|internal|sonar|rb2b)\/|^\/v1\/internal\//;
const leaked = Object.keys(spec.paths || {}).filter((p) => STAFF.test(p));
if (leaked.length) {
  process.stderr.write(`sync-openapi: refusing — staff paths in served slice: ${leaked.join(", ")}\n`);
  process.exit(2);
}

writeFileSync(OUT, JSON.stringify(spec, null, 2) + "\n");
const ops = Object.values(spec.paths || {}).reduce(
  (n, item) => n + ["get", "put", "post", "delete", "patch"].filter((m) => item[m]).length,
  0,
);
process.stderr.write(`sync-openapi: wrote ${OUT} (${Object.keys(spec.paths || {}).length} paths, ${ops} ops)\n`);
