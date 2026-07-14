#!/usr/bin/env node
// scripts/check-i18n-lag.mjs — i18n translation-lag detector (fingerprint gate).
//
// Fails when an English source page is edited but its French/Spanish translation
// is not, so localized readers never silently receive stale content that has
// drifted from the authoritative English source.
//
// Mechanism: each EN page has a structural fingerprint derived from the two
// elements a translation MUST track verbatim — the ordered set of markdown
// heading texts and the ordered list of fenced-code-block bodies (prose is
// deliberately excluded so translators localize wording freely). The fingerprint
// the translation was made against is recorded in the localized page's YAML
// frontmatter under `source_fingerprint`. The check recomputes each EN source's
// fingerprint live and compares it to the recorded value:
//   match    → in sync
//   mismatch → EN changed since translation → stale
//
// Fail-closed (MNE-442/441/439): every abnormal condition is a non-zero failure,
// never a silent skip — a missing `source_fingerprint`, a missing/unreadable EN
// counterpart, an unreadable localized page, and the zero-pages cold-start each
// exit non-zero. A detector that passes when it cannot verify is worse than none.
//
// Counters (MNE-438) are four disjoint terminal outcomes with an enforced
// invariant `inSync + stale + errors === checked`; each page increments exactly
// one, and the null/unidentified case increments `errors`, never a generic bucket.
//
// Exit codes: 0 = clean, 1 = stale/errors found (or bad tree), 2 = bad CLI usage.
//
// Flags:
//   --self-test        run inline assertions, no filesystem writes, then exit.
//   --write, --baseline  (re)stamp each localized page's `source_fingerprint`
//                        to its EN counterpart's current fingerprint. Maintenance
//                        affordance for translators AFTER a re-translation; never
//                        invoked by CI. NOTE: --write is NOT atomic — if
//                        interrupted (SIGINT, disk error) some pages carry the new
//                        fingerprint and others the old; re-run to completion.
//   --help, -h         usage.
//
// CI wiring is intentionally NOT authored here (maintainer override; NEVER-AUTO
// path). The operator lands the workflow separately with:
//   on: { pull_request: { paths: ["**/*.mdx"] } }
//   job: npm ci && npm run check:i18n-lag

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exit } from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Locale trees to check. A localized page at `<locale>/<rel>` maps to the EN
// counterpart at `<rel>` (strip the leading locale segment).
const LOCALES = ["fr", "es"];

// ── Pure helpers (exported for check-i18n-lag.test.mjs) ─────────────────────

// Split leading `---`…`---` YAML frontmatter from the body. Returns
// { frontmatter, body } — frontmatter is "" when the page has none.
export function stripFrontmatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { frontmatter: "", body: src };
  return { frontmatter: m[1], body: src.slice(m[0].length) };
}

// Extract ordered fenced-code-block bodies from MDX source, keyed by language
// tag. Indent-aware so fences nested inside <Step>/<CodeGroup> MDX components
// are captured with their common indentation stripped. Ported from
// scripts/check-sdk-quickstart.mjs (kept behaviourally identical).
export function extractFencedBlocks(source) {
  const blocks = [];
  const lines = source.split("\n");
  let inFence = false;
  let lang = "";
  let fenceIndent = "";
  let buf = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!inFence && trimmed.startsWith("```")) {
      fenceIndent = line.slice(0, line.length - trimmed.length);
      lang = trimmed.slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      inFence = true;
      buf = [];
    } else if (inFence && trimmed.startsWith("```") && trimmed.trim() === "```") {
      blocks.push({ lang, body: buf.join("\n") });
      inFence = false;
    } else if (inFence) {
      // Strip the common indentation prefix so content is left-aligned.
      const content = line.startsWith(fenceIndent)
        ? line.slice(fenceIndent.length)
        : line;
      buf.push(content);
    }
  }
  return blocks;
}

// Extract ordered ATX heading texts (`#`..`######`) from a body. Fence-aware:
// a `#` inside a fenced code block is a code comment, not a heading, so headings
// are only collected outside fences (mirrors extractFencedBlocks' fence tracking).
export function extractHeadings(body) {
  const headings = [];
  const lines = body.split("\n");
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) headings.push(m[2].trim());
  }
  return headings;
}

// Structural fingerprint of a page: strip frontmatter, extract the heading set
// and fenced-code bodies, canonically serialize, and sha256. Frontmatter is
// stripped first so a page's own frontmatter never feeds its fingerprint.
export function computeFingerprint(src) {
  const { body } = stripFrontmatter(src);
  const headings = extractHeadings(body);
  const codeBlocks = extractFencedBlocks(body).map((b) => ({
    lang: b.lang,
    body: b.body,
  }));
  const canonical = JSON.stringify({ headings, codeBlocks });
  const hex = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${hex}`;
}

// Read a single-line frontmatter field. Regex-based (no `yaml` dep) to match the
// house style already proven in scripts/check-frontmatter-description.mjs.
// Returns the trimmed value, or null when the key is absent/empty.
export function readFrontmatterField(frontmatter, key) {
  const re = new RegExp(
    `^${key}:\\s*(?:"([^"]*)"|'([^']*)'|(.*\\S.*))\\s*$`,
    "m",
  );
  const m = re.exec(frontmatter);
  if (!m) return null;
  const val = (m[1] ?? m[2] ?? m[3] ?? "").trim();
  return val || null;
}

// Compare an EN source fingerprint against the value recorded in a translation.
export function compareFingerprint(enFingerprint, recorded) {
  if (!recorded) return { status: "missing" };
  return { status: recorded === enFingerprint ? "in-sync" : "stale" };
}

// Insert or replace a single-line frontmatter field, preserving all other keys
// and their order. Targeted `s/key: .*/key: value/` replacement, or an insert
// before the closing `---`; creates a frontmatter block if the page has none.
// Used only by --write.
export function setFrontmatterField(src, key, value) {
  const m = /^(---\n)([\s\S]*?)(\n---)/.exec(src);
  if (!m) {
    return `---\n${key}: ${value}\n---\n\n${src}`;
  }
  const fmBody = m[2];
  const keyRe = new RegExp(`^${key}:.*$`, "m");
  const newFm = keyRe.test(fmBody)
    ? fmBody.replace(keyRe, `${key}: ${value}`)
    : `${fmBody}\n${key}: ${value}`;
  return m[1] + newFm + m[3] + src.slice(m[0].length);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Only run when executed directly (`node scripts/check-i18n-lag.mjs`), never
// when imported by the test harness — importing must not trigger the CLI/exit.

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

function main() {
const args = process.argv.slice(2);
let selfTest = false;
let write = false;
for (const arg of args) {
  if (arg === "--self-test") selfTest = true;
  else if (arg === "--write" || arg === "--baseline") write = true;
  else if (arg === "--help" || arg === "-h") {
    console.log(
      "Usage: check-i18n-lag.mjs [--self-test] [--write|--baseline] [--help]\n" +
        "  (no flag)          read-only: report stale/untracked localized pages\n" +
        "  --self-test        run inline assertions, no filesystem writes\n" +
        "  --write|--baseline (re)stamp source_fingerprint into localized pages\n" +
        "                     (not atomic — re-run to completion if interrupted)",
    );
    exit(0);
  } else {
    console.error(`Unknown flag: ${arg}`);
    exit(2);
  }
}

// ── Locale-page discovery ────────────────────────────────────────────────────

function walkMdx(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkMdx(p, out);
    else if (e.endsWith(".mdx")) out.push(p);
  }
  return out;
}

// Every localized page path (absolute) and its EN counterpart (relative to ROOT).
function discoverLocalizedPages() {
  const pages = [];
  for (const locale of LOCALES) {
    const localeDir = join(ROOT, locale);
    if (!existsSync(localeDir)) continue;
    for (const abs of walkMdx(localeDir)) {
      const rel = relative(ROOT, abs); // e.g. fr/quickstart/overview.mdx
      const enRel = relative(join(ROOT, locale), abs); // e.g. quickstart/overview.mdx
      pages.push({ locale, abs, rel, enRel });
    }
  }
  return pages;
}

// ── Self-test (inline assertions, no filesystem side effects) ────────────────

if (selfTest) {
  const results = [];
  const check = (name, cond) => {
    results.push([name, cond]);
    console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  };

  const base =
    "---\ntitle: A\n---\n\n# Heading one\n\nProse.\n\n```python\nx = 1\n```\n";
  const proseChanged =
    "---\ntitle: B\n---\n\n# Heading one\n\nDifferent prose.\n\n```python\nx = 1\n```\n";
  const headingChanged =
    "---\ntitle: A\n---\n\n# Heading two\n\nProse.\n\n```python\nx = 1\n```\n";
  const codeChanged =
    "---\ntitle: A\n---\n\n# Heading one\n\nProse.\n\n```python\nx = 2\n```\n";

  const fpBase = computeFingerprint(base);
  check("fingerprint has sha256: prefix", fpBase.startsWith("sha256:"));
  check("prose-only change → same fingerprint", computeFingerprint(proseChanged) === fpBase);
  check("frontmatter-only change → same fingerprint (stripped)", computeFingerprint(proseChanged) === fpBase);
  check("heading change → different fingerprint", computeFingerprint(headingChanged) !== fpBase);
  check("code change → different fingerprint", computeFingerprint(codeChanged) !== fpBase);
  check("`#` inside code fence is not a heading", extractHeadings("```python\n# not a heading\n```\n").length === 0);
  check("compareFingerprint match → in-sync", compareFingerprint(fpBase, fpBase).status === "in-sync");
  check("compareFingerprint mismatch → stale", compareFingerprint(fpBase, "sha256:deadbeef").status === "stale");
  check("compareFingerprint absent → missing", compareFingerprint(fpBase, null).status === "missing");
  check("readFrontmatterField reads source_fingerprint", readFrontmatterField("title: A\nsource_fingerprint: sha256:abc", "source_fingerprint") === "sha256:abc");
  check("setFrontmatterField inserts when absent", readFrontmatterField(stripFrontmatter(setFrontmatterField(base, "source_fingerprint", "sha256:abc")).frontmatter, "source_fingerprint") === "sha256:abc");
  check("setFrontmatterField replaces when present", readFrontmatterField(stripFrontmatter(setFrontmatterField("---\nsource_fingerprint: sha256:old\n---\n", "source_fingerprint", "sha256:new")).frontmatter, "source_fingerprint") === "sha256:new");

  const passed = results.filter(([, ok]) => ok).length;
  console.log(`\nself-test: ${passed}/${results.length} passed`);
  exit(passed === results.length ? 0 : 1);
}

// ── --write / --baseline: (re)stamp source_fingerprint ───────────────────────

if (write) {
  const pages = discoverLocalizedPages();
  if (pages.length === 0) {
    console.error("✗ check-i18n-lag --write: no localized pages found under fr/, es/");
    exit(1);
  }
  let written = 0;
  let errors = 0;
  for (const { locale, abs, rel, enRel } of pages) {
    const enPath = join(ROOT, enRel);
    let enSrc;
    try {
      enSrc = readFileSync(enPath, "utf8");
    } catch (e) {
      console.error(`  ERROR ${rel}: EN counterpart ${enRel} unreadable — ${e.message}`);
      errors++;
      continue;
    }
    const fp = computeFingerprint(enSrc);
    let locSrc;
    try {
      locSrc = readFileSync(abs, "utf8");
    } catch (e) {
      console.error(`  ERROR ${rel}: unreadable — ${e.message}`);
      errors++;
      continue;
    }
    const next = setFrontmatterField(locSrc, "source_fingerprint", fp);
    if (next !== locSrc) {
      writeFileSync(abs, next);
      written++;
    }
    console.log(`  wrote ${rel} [${locale}] → ${fp}`);
  }
  console.log(`\ncheck-i18n-lag --write: ${written} page(s) updated, ${errors} error(s).`);
  exit(errors > 0 ? 1 : 0);
}

// ── Read-only check (default) ────────────────────────────────────────────────

const pages = discoverLocalizedPages();

// Cold-start fail-closed (MNE-442): a detector that silently passes when it found
// nothing to check is the fail-open trap — report and exit non-zero instead.
if (pages.length === 0) {
  console.error("✗ check-i18n-lag: no localized pages found under fr/, es/ — nothing to verify.");
  exit(1);
}

let checked = 0;
let inSync = 0;
let stale = 0;
let errors = 0;
const staleReports = [];
const errorReports = [];

for (const { locale, abs, rel, enRel } of pages) {
  checked++;

  // Read the localized page (fail closed on unreadable/unparseable).
  let locSrc;
  try {
    locSrc = readFileSync(abs, "utf8");
  } catch (e) {
    errors++;
    errorReports.push(`${rel}: unreadable — ${e.message}`);
    continue;
  }

  // Read the EN counterpart (fail closed on missing/unreadable — cannot verify).
  const enPath = join(ROOT, enRel);
  let enSrc;
  try {
    enSrc = readFileSync(enPath, "utf8");
  } catch (e) {
    errors++;
    errorReports.push(`${rel}: EN counterpart ${enRel} missing/unreadable — ${e.message}`);
    continue;
  }

  const enFingerprint = computeFingerprint(enSrc);
  const { frontmatter } = stripFrontmatter(locSrc);
  const recorded = readFrontmatterField(frontmatter, "source_fingerprint");

  // Missing fingerprint is an untracked translation — indistinguishable from a
  // stale one, so it fails closed as an error (never in-sync). (MNE-438/442)
  const { status } = compareFingerprint(enFingerprint, recorded);
  if (status === "missing") {
    errors++;
    errorReports.push(`${rel}: no source_fingerprint frontmatter — run \`--write\` to baseline against ${enRel}`);
  } else if (status === "stale") {
    stale++;
    staleReports.push(`${rel} [${locale}]: EN source ${enRel} changed since this translation was recorded`);
  } else {
    inSync++;
  }
}

// Enforce the counter invariant before reporting (MNE-438).
if (inSync + stale + errors !== checked) {
  console.error(`✗ check-i18n-lag: counter invariant violated — inSync(${inSync}) + stale(${stale}) + errors(${errors}) !== checked(${checked})`);
  exit(1);
}

if (staleReports.length > 0) {
  console.error(`\n✗ check-i18n-lag: ${stale} stale translation(s) — EN source edited without updating the translation:`);
  for (const r of staleReports) console.error(`  - ${r}`);
}
if (errorReports.length > 0) {
  console.error(`\n✗ check-i18n-lag: ${errors} error(s):`);
  for (const r of errorReports) console.error(`  - ${r}`);
}

console.log(`\ncheck-i18n-lag: checked ${checked} · in-sync ${inSync} · stale ${stale} · errors ${errors}`);

if (stale + errors > 0) {
  console.error("Re-run `node scripts/check-i18n-lag.mjs --write` after re-translating to re-baseline.");
  exit(1);
}
console.log("✓ all localized pages track their EN source.");
exit(0);
}
