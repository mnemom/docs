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

// Grandfathered live leaks in the committed slice (synced from the deployed spec).
// The gate is blocking NOW to stop NEW description leaks; these known ones are
// scrubbed at the source (mnemom-api) under MNE-139 and these entries retire on
// the next deploy + re-sync. Fingerprint = `${location}::${matchedToken}`.
const SPEC_ALLOWLIST = new Set([
  "tag:Network.description::AEGIS-12", // MNE-139 — scrub in mnemom-api tag desc
  "tag:Recipes.description::AEGIS-6", // MNE-139
  "tag:Trust.description::AEGIS-13", // MNE-139
  "DELETE /agents/{agent_id}.description::github.com/mnemom/scale", // MNE-139 — ADR-021 link → private repo
  "schema:UnifiedAlignmentCard.description::UC-4", // MNE-139
  "schema:UnifiedProtectionCard.description::UC-4", // MNE-139
  "schema:AgentExemption.description::UC-4", // MNE-139
  "schema:AgentExemption.status.description::UC-4", // MNE-139
]);

const METHODS = ["get", "put", "post", "delete", "patch"];
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

// ---- 2. OpenAPI committed slice (prose fields only) ----
function scanSpec(spec) {
  scan("info.title", spec.info?.title, "spec");
  scan("info.description", spec.info?.description, "spec");
  for (const t of spec.tags || []) {
    scan(`tag:${t.name}.name`, t.name, "spec");
    scan(`tag:${t.name}.description`, t.description, "spec");
  }
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const b = `${m.toUpperCase()} ${path}`;
      scan(`${b}.summary`, op.summary, "spec");
      scan(`${b}.description`, op.description, "spec");
      for (const pr of op.parameters || []) scan(`${b} param:${pr.name}.description`, pr.description, "spec");
      if (op.requestBody) scan(`${b}.requestBody.description`, op.requestBody.description, "spec");
      for (const [code, r] of Object.entries(op.responses || {})) scan(`${b}.responses[${code}].description`, r?.description, "spec");
    }
  }
  for (const [name, sch] of Object.entries(spec.components?.schemas || {})) {
    scan(`schema:${name}.description`, sch?.description, "spec");
    for (const [pn, pp] of Object.entries(sch?.properties || {})) scan(`schema:${name}.${pn}.description`, pp?.description, "spec");
  }
}
if (!SELFTEST && existsSync(SPEC)) scanSpec(JSON.parse(readFileSync(SPEC, "utf8")));

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
  console.log(`\nself-test: ${pass}/${cases.length} passed`);
  process.exit(pass === cases.length ? 0 : 1);
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
