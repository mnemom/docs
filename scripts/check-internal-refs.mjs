#!/usr/bin/env node
// scripts/check-internal-refs.mjs — internal-reference leakage gate (MNE-57 + MNE-139).
//
// Single source of truth for the gate. Scans TWO customer-facing surfaces:
//   1. *.mdx  — hand-written pages, raw text, line by line (faithful to the
//      original `grep -rInE -i --include='*.mdx'` behavior).
//   2. api-reference/openapi.json — the committed customer slice's PROSE fields
//      (summary/description/tag text/param·body·response·schema descriptions).
//      The generated api-reference pages render their *description* from the spec,
//      NOT from .mdx, so a .mdx-only scan was blind to description-level leaks
//      (MNE-139). We scan PROSE only — never path keys, operationIds, schema
//      names, or example data (those legitimately contain tokens like the live
//      path `/safe-house/cbd/evaluations` and would false-positive).
//
// Exit 1 + report on any non-allowlisted match. `--self-test` runs assertions.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(ROOT, "api-reference", "openapi.json");
const SELFTEST = process.argv.includes("--self-test");

// label::ERE → matched case-insensitively. `mdxOnly` rules are NOT applied to the
// OpenAPI spec (ADR-NNN citations are legitimate, public decision-record links in
// API descriptions — Stripe-links-to-RFCs style; in hand-written .mdx prose an
// ADR ref is more likely an accidental internal leak, so it stays banned there).
const RULES = [
  { label: "private-repo link (404s for customers)", re: /github\.com\/mnemom\/(scale|safe-house-hardening|safe-house-aegis|deploy)/i },
  { label: "retired codename smoltbot", re: /\bsmoltbot\b/i },
  { label: "retired codename XFD/CBD/CFD", re: /\b(xfd|cbd|cfd)\b/i },
  { label: "internal codename polis", re: /\bpolis\b|polis_yaml/i },
  { label: "internal agent name", re: /\b(solon|themis|cassandra|blackbeard|wintermute)\b/i },
  { label: "1Password path", re: /op:\/\// },
  { label: "internal tooling path", re: /emps\.|packages\/core/i },
  { label: "internal tracker ref (UC-N / mnemom-platform#N / AEGIS-N)", re: /UC-[0-9]|mnemom-platform#[0-9]|\bAEGIS-[0-9]{1,3}\b/i },
  { label: "internal decision-record ref (ADR-NNN)", re: /ADR-[0-9]{3}/i, mdxOnly: true },
];

// Grandfather list for live leaks in the committed slice (synced from the deployed
// spec). Empty: the MNE-139 grandfathered set (9 entries) was scrubbed at the
// source (mnemom-api#720), deployed, and re-synced — so the gate is now blocking
// with NO exceptions. Add an entry only to ratchet in a gate on a non-clean tree:
// `${location}::${matchedToken}` + a comment + a ticket to scrub at source.
const SPEC_ALLOWLIST = new Set([]);

const findings = []; // {surface, loc, label, token}
const allowlistHits = new Set();

function scan(loc, text, surface) {
  if (typeof text !== "string" || !text) return;
  for (const rule of RULES) {
    if (surface === "spec" && rule.mdxOnly) continue;
    for (const m of text.matchAll(new RegExp(rule.re.source, rule.re.flags.includes("i") ? "gi" : "g"))) {
      const token = m[0];
      if (surface === "spec") {
        const fp = `${loc}::${token}`;
        if (SPEC_ALLOWLIST.has(fp)) {
          allowlistHits.add(fp);
          continue;
        }
      }
      findings.push({ surface, loc, label: rule.label, token });
    }
  }
}

// ---- 1. *.mdx (raw, line by line) ----
function walkMdx(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walkMdx(p, out);
    else if (e.endsWith(".mdx")) out.push(p);
  }
  return out;
}
if (!SELFTEST) {
  for (const file of walkMdx(ROOT)) {
    const rel = relative(ROOT, file);
    readFileSync(file, "utf8").split("\n").forEach((line, i) => scan(`${rel}:${i + 1}`, line, "mdx"));
  }
}

// ---- 2. OpenAPI committed slice — recursive walk of every PROSE value ----
// Scans the string value of any `description`/`summary`/`title` key (+ tag
// `name`) ANYWHERE in the spec — operations, tags, AND all of components
// (schemas, securitySchemes, parameters, responses…). It deliberately does NOT
// scan path keys, operationIds, schema/property names, enum or example values:
// those carry tokens like the live `/safe-house/cbd/` path and would
// false-positive. Locations are JSON-path-ish, name-keyed for arrays (stable
// across reordering) so SPEC_ALLOWLIST fingerprints don't churn.
const PROSE_KEYS = new Set(["description", "summary", "title"]);
function scanSpec(node, loc) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => scanSpec(v, `${loc}.${(v && typeof v === "object" && (v.name || v.tab)) || i}`));
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string" && PROSE_KEYS.has(k)) scan(`${loc}.${k}`, v, "spec");
    else if (v && typeof v === "object") scanSpec(v, `${loc}.${k}`);
  }
}
if (!SELFTEST && existsSync(SPEC)) scanSpec(JSON.parse(readFileSync(SPEC, "utf8")), "$");

// ---- self-test ----
if (SELFTEST) {
  const cases = [
    ["catches AEGIS-N in spec summary", "spec", "sum", "Report a thing (AEGIS-6)", true],
    ["catches UC-N in spec desc", "spec", "schema:X.description", "UC-4 unified card", true],
    ["catches private-repo link in spec desc", "spec", "d", "see github.com/mnemom/scale/blob/x", true],
    ["catches smoltbot in mdx", "mdx", "f:1", "the smoltbot runtime", true],
    ["allows smolt-{hex} agent id", "mdx", "f:2", "agent smolt-1a2b3c4d connected", false],
    ["allows STIX aegis-2026 id in spec", "spec", "ex", "extension-definition--mnemom-aegis-2026-05", false],
    ["allows ADR-NNN in spec (mdxOnly rule)", "spec", "d", "idempotency per ADR-023", false],
    ["catches ADR-NNN in mdx", "mdx", "f:3", "see ADR-023 for details", true],
  ];
  let pass = 0;
  for (const [name, surface, loc, text, shouldHit] of cases) {
    findings.length = 0;
    scan(loc, text, surface);
    const hit = findings.length > 0;
    const ok = hit === shouldHit;
    console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` (expected hit=${shouldHit}, got ${hit})`}`);
    if (ok) pass++;
  }
  // recursive-walk: a leak buried in a nested component (securityScheme) must be caught
  findings.length = 0;
  scanSpec({ components: { securitySchemes: { Foo: { description: "token at op://vault/secret" } } } }, "$");
  const walkOk = findings.some((f) => f.label.includes("1Password"));
  console.log(`  ${walkOk ? "✓" : "✗"} recursive walk catches op:// in components.securitySchemes`);
  const total = cases.length + 1;
  if (walkOk) pass++;
  console.log(`\nself-test: ${pass}/${total} passed`);
  process.exit(pass === total ? 0 : 1);
}

// ---- report ----
const stale = [...SPEC_ALLOWLIST].filter((fp) => !allowlistHits.has(fp));
if (allowlistHits.size) {
  process.stderr.write(`ℹ ${allowlistHits.size} grandfathered spec leak(s) allowlisted (MNE-139 burn-down):\n`);
  for (const fp of allowlistHits) process.stderr.write(`    ${fp}\n`);
}
if (stale.length) {
  process.stderr.write(`⚠ ${stale.length} stale SPEC_ALLOWLIST entr(ies) no longer present — safe to remove:\n`);
  for (const fp of stale) process.stderr.write(`    ${fp}\n`);
}
if (findings.length) {
  const byLabel = {};
  for (const f of findings) (byLabel[`${f.surface} · ${f.label}`] ||= []).push(f);
  for (const [k, fs] of Object.entries(byLabel)) {
    process.stderr.write(`\n::error::Internal reference leak — ${k}\n`);
    for (const f of fs) process.stderr.write(`    ${f.loc}  «${f.token}»\n`);
  }
  process.stderr.write(`\nFAIL: ${findings.length} internal reference(s) in customer-facing docs/spec.\n`);
  process.stderr.write(`Scrub at the source. For a deliberate legacy surface, scope an exception in check-internal-refs.mjs (RULES / SPEC_ALLOWLIST) with a comment + ticket.\n`);
  process.exit(1);
}
process.stderr.write("✓ No internal references in customer-facing *.mdx or OpenAPI prose.\n");
