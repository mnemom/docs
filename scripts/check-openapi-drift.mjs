#!/usr/bin/env node
/**
 * check-openapi-drift.mjs
 *
 * Compares the customer-facing route table in `mnemom-api/src/index.ts`
 * against `docs/api-reference/openapi.json` and reports drift.
 *
 * Customer-facing is defined by docs-audit/00-scope.md §0:
 *   - /v1/* customer routes are in scope
 *   - /internal/*, /v1/admin/* (until BUG-4 role split),
 *     /v1/arena/internal/*, webhook inbound endpoints, and any
 *     X-Service-Key or X-Internal-Key route are out of scope
 *
 * Usage:
 *   node scripts/check-openapi-drift.mjs <path-to-source> [<path-to-source> ...]
 *
 * Pass one or more source files that contain customer-facing route
 * declarations. Typical usage passes mnemom-api's index.ts plus the
 * reputation + risk worker entrypoints:
 *
 *   node scripts/check-openapi-drift.mjs \
 *     mnemom-api/src/index.ts \
 *     mnemom-reputation/server/src/index.ts \
 *     mnemom-risk/server/src/index.ts
 *
 * Exits 0 on clean. Exits 1 with a drift report on mismatch.
 */

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const sources = argv.slice(2);
if (sources.length === 0) {
  console.error('Usage: check-openapi-drift.mjs <source.ts> [<source.ts> ...]');
  exit(2);
}

const apiSource = sources.map((p) => readFileSync(p, 'utf8')).join('\n');

// ---------------------------------------------------------------------------
// Extract routes from the concatenated worker source(s)
// ---------------------------------------------------------------------------

// Two patterns in use (see the comment block near line 14 of mnemom-api/src/index.ts):
//   if (path === '/v1/foo' && method === 'GET') { ... }
//   const fooMatch = path.match(/^\/v1\/foo\/([^/]+)$/);
//   if (fooMatch && method === 'POST') { ... }
//
// Strategy: find all `if (path === '...'` occurrences with method nearby,
// and all `path.match(...)` regex patterns paired with their surrounding
// method checks.

/** Collected routes: array of { method, path } (path has {x}-normalized params). */
const routes = new Set();

// Pattern 1: exact-match routes
//   if (path === '/v1/foo/bar' && method === 'GET') {
const exactMatchPattern = /if\s*\(\s*path\s*===\s*'([^']+)'\s*&&\s*method\s*===\s*'([A-Z]+)'/g;
for (const m of apiSource.matchAll(exactMatchPattern)) {
  const [, p, method] = m;
  routes.add(`${method} ${normalize(p)}`);
}

// Pattern 2: startsWith-based routes
//   if (path.startsWith('/v1/foo/') && method === 'DELETE') {
const startsWithPattern = /if\s*\(\s*path\.startsWith\(\s*'([^']+)'\s*\)\s*&&\s*method\s*===\s*'([A-Z]+)'/g;
for (const m of apiSource.matchAll(startsWithPattern)) {
  const [, prefix, method] = m;
  // Best-effort: record the prefix as a catch-all (Step 5 analysis already
  // confirmed the only startsWith route pair is /v1/sonar/track/:id DELETE).
  routes.add(`${method} ${normalize(prefix.replace(/\/$/, ''))}/{x}`);
}

// Pattern 3: regex-match routes
//   const fooMatch = path.match(/^\/v1\/foo\/([^/]+)$/);
//   if (fooMatch && method === 'POST') { ... }
// We collect the regex + its subsequent `if (xMatch && method === 'Y')`
// guards (the same var may be re-used across multiple methods).
const regexDeclPattern = /const\s+(\w+)\s*=\s*path\.match\(\/\^(.+?)\$\/i?\)/g;
const regexByVar = new Map();
for (const m of apiSource.matchAll(regexDeclPattern)) {
  const [, varName, regexBody] = m;
  // Convert the regex body (JS source form) to a template path with
  // {x} params. In source, `/` is escaped as `\/`, so unescape first.
  const pathTemplate = regexBody
    .replace(/\\\//g, '/')                   // \/ -> /
    .replace(/\\-/g, '-')                    // \- -> -
    .replace(/\([^)]+\)/g, '{x}');           // (capture) -> {x}
  regexByVar.set(varName, pathTemplate);
}

// Find method checks that reference each var.
const matchCheckPattern = /if\s*\(\s*(\w+)\s*&&\s*method\s*===\s*'([A-Z]+)'/g;
for (const m of apiSource.matchAll(matchCheckPattern)) {
  const [, varName, method] = m;
  const path = regexByVar.get(varName);
  if (path) routes.add(`${method} ${path}`);
}

// ---------------------------------------------------------------------------
// Filter to customer-facing only (per 00-scope.md §0)
// ---------------------------------------------------------------------------

const OUT_OF_SCOPE_PREFIXES = [
  '/internal/',        // service-key internal routes
  '/v1/admin/',        // Mnemom-staff-only (until BUG-4 wires org_admin)
  '/v1/arena/internal/', // arena-simulator internal
  '/v1/on-chain/anchor-root',
  '/v1/on-chain/publish-scores',
  '/v1/arena/',        // arena is hidden from customer docs per directive
  '/v1/sonar/',        // sonar is admin/inbound-webhook
  '/v1/rb2b/webhook',
  '/v1/billing/webhooks/stripe', // inbound from Stripe
  '/v1/contact/notify', // marketing
  '/v1/teams/{x}/coherence-history', // internal-key
  '/v1/internal/',
];

// Routes the extractor intentionally under-captures. These paths are
// served by code the script doesn't parse perfectly yet (e.g., routes
// with unusual regex shapes, or multi-method handlers with var-name
// overwrites). Add entries here with a brief reason; clear them out as
// the extractor is improved.
const KNOWN_EXTRACTOR_GAPS = new Set([
  'GET /checkpoints/{x}/inclusion-proof', // proofMatch var name conflict
]);

const customerRoutes = new Set();
for (const r of routes) {
  const [, pathPart] = r.split(' ');
  if (!pathPart.startsWith('/v1/')) continue; // drop /health, /models.json, etc.
  if (OUT_OF_SCOPE_PREFIXES.some((p) => pathPart.startsWith(p))) continue;
  // Strip /v1 prefix — openapi.json paths don't carry it (server URL does)
  customerRoutes.add(`${r.split(' ')[0]} ${pathPart.replace(/^\/v1/, '')}`);
}

// ---------------------------------------------------------------------------
// Extract paths from api-reference/openapi.json
// ---------------------------------------------------------------------------

const openapi = JSON.parse(readFileSync('api-reference/openapi.json', 'utf8'));
const specRoutes = new Set();
for (const [path, methods] of Object.entries(openapi.paths ?? {})) {
  for (const method of Object.keys(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    specRoutes.add(`${method.toUpperCase()} ${normalize(path)}`);
  }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

const missing = [...customerRoutes].filter((r) => !specRoutes.has(r)).sort();
const stale = [...specRoutes]
  .filter((r) => !customerRoutes.has(r))
  .filter((r) => !KNOWN_EXTRACTOR_GAPS.has(r))
  .sort();

function normalize(p) {
  return p.replace(/\{[a-zA-Z_]+\}/g, '{x}');
}

console.log(`Customer-facing routes in code:   ${customerRoutes.size}`);
console.log(`Routes in api-reference/openapi.json: ${specRoutes.size}`);
console.log();

if (missing.length === 0 && stale.length === 0) {
  console.log('✓ No drift. openapi.json matches the customer-facing surface.');
  exit(0);
}

if (missing.length > 0) {
  console.log(`❌ ${missing.length} route(s) in code, missing from openapi.json:`);
  for (const r of missing) console.log(`    + ${r}`);
  console.log();
}

if (stale.length > 0) {
  console.log(`❌ ${stale.length} route(s) in openapi.json, no longer in code:`);
  for (const r of stale) console.log(`    - ${r}`);
  console.log();
}

console.log('See docs-audit/00-scope.md for the customer-facing scope rule.');
console.log('If a route is intentionally excluded from customer docs, add its');
console.log('prefix to OUT_OF_SCOPE_PREFIXES in this script.');

exit(1);
