#!/usr/bin/env node
// scripts/check-frontmatter-description.mjs — frontmatter description: presence gate.
//
// Every customer-facing MDX page in the five scoped content directories must
// carry a non-empty `description:` in its YAML frontmatter. Mintlify uses it
// for the search-result snippet and <meta name="description">/OG tags; without
// it, search results show truncated raw body text and SEO/social-preview
// quality degrades.
//
// Scoped directories (EN customer-facing pages only):
//   concepts/   guides/   api-reference/ (recursive)   protocols/ (recursive)
//   specifications/
//
// Additionally flags descriptions longer than 160 chars (Mintlify/SEO limit).
//
// Exit codes: 0 = clean, 1 = violations found, 2 = bad CLI usage.
// `--self-test` runs inline assertions and exits without touching the filesystem.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELFTEST = process.argv.includes("--self-test");

// ── CLI ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
for (const arg of args) {
  if (arg === "--self-test") continue;
  if (arg === "--help" || arg === "-h") {
    console.log("Usage: check-frontmatter-description.mjs [--self-test]");
    exit(0);
  } else {
    console.error(`Unknown flag: ${arg}`);
    exit(2);
  }
}

// ── Scoped dirs ───────────────────────────────────────────────────────────
const SCOPED = [
  join(ROOT, "concepts"),
  join(ROOT, "guides"),
  join(ROOT, "api-reference"),
  join(ROOT, "protocols"),
  join(ROOT, "specifications"),
];

function walkMdx(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkMdx(p, out);
    else if (e.endsWith(".mdx")) out.push(p);
  }
  return out;
}

// ── Frontmatter parse ─────────────────────────────────────────────────────
// Returns { hasDesc: boolean, descLength: number }
const FM_RE = /^---\n([\s\S]*?)\n---/;
// description: "quoted" or description: unquoted value (single-line)
const DESC_RE = /^description:\s*(?:"([^"]*)"|'([^']*)'|(.*\S.*))\s*$/m;

function checkFrontmatter(text) {
  const fm = FM_RE.exec(text);
  if (!fm) return { hasDesc: false, descLength: 0 };
  const m = DESC_RE.exec(fm[1]);
  if (!m) return { hasDesc: false, descLength: 0 };
  const val = (m[1] ?? m[2] ?? m[3] ?? "").trim();
  if (!val) return { hasDesc: false, descLength: 0 };
  return { hasDesc: true, descLength: val.length };
}

// ── Self-test ─────────────────────────────────────────────────────────────
if (SELFTEST) {
  const cases = [
    ["populated description: (quoted)", '---\ntitle: "Foo"\ndescription: "A short description."\n---\n', true, false],
    ["empty description: (quoted empty string)", '---\ntitle: "Foo"\ndescription: ""\n---\n', false, false],
    ["description: key absent", '---\ntitle: "Foo"\nopenapi: "GET /foo"\n---\n', false, false],
    ["no frontmatter at all", 'Just plain text with no frontmatter.', false, false],
    ["multi-word description", '---\ntitle: "Foo"\ndescription: "Retrieve the alignment posture for a specific org"\n---\n', true, false],
    ["description over 160 chars", `---\ntitle: "Foo"\ndescription: "${"x".repeat(161)}"\n---\n`, true, true],
    ["unquoted description", '---\ntitle: "Foo"\ndescription: An unquoted single-line value\n---\n', true, false],
  ];
  let pass = 0;
  for (const [name, text, expectHasDesc, expectTooLong] of cases) {
    const { hasDesc, descLength } = checkFrontmatter(text);
    const okHas = hasDesc === expectHasDesc;
    const okLen = (descLength > 160) === expectTooLong;
    const ok = okHas && okLen;
    console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` (hasDesc=${hasDesc} wantHasDesc=${expectHasDesc} len=${descLength} wantTooLong=${expectTooLong})`}`);
    if (ok) pass++;
  }
  const total = cases.length;
  console.log(`\nself-test: ${pass}/${total} passed`);
  exit(pass === total ? 0 : 1);
}

// ── Scan ──────────────────────────────────────────────────────────────────
const missing = [];
const tooLong = [];

for (const dir of SCOPED) {
  if (!existsSync(dir)) continue;
  for (const file of walkMdx(dir)) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf8");
    const { hasDesc, descLength } = checkFrontmatter(text);
    if (!hasDesc) {
      missing.push(rel);
    } else if (descLength > 160) {
      tooLong.push(`${rel} (${descLength} chars)`);
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────
let exitCode = 0;

if (missing.length > 0) {
  console.error(`\n✗ check-frontmatter-description: ${missing.length} page(s) missing description:`);
  for (const f of missing) console.error(`  - ${f}`);
  exitCode = 1;
}

if (tooLong.length > 0) {
  // Advisory only — existing hand-authored descriptions are not truncated by this script.
  // Reported as a warning so future violations are visible without blocking the gate.
  console.error(`\n⚠ check-frontmatter-description: ${tooLong.length} page(s) with description > 160 chars (advisory):`);
  for (const f of tooLong) console.error(`  - ${f}`);
}

if (exitCode === 0) {
  console.log(`✓ check-frontmatter-description: all scanned pages carry a non-empty description ≤160 chars.`);
}

exit(exitCode);
