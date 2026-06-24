#!/usr/bin/env node
// scripts/check-img-alt.mjs — image alt-text accessibility gate (issue #294).
//
// Every `<img>` rendered in the docs must carry a non-empty `alt` attribute.
// Missing alt text means screen readers announce nothing (or read the raw
// filename), so the badge images in the reputation/team guides shipped without
// a usable description. Nothing in the existing toolchain catches this — the
// fix landed by hand, and this gate keeps it from regressing.
//
// It scans every customer-facing `*.mdx` page for `<img …>` tags (HTML in
// fenced code blocks and JSX components alike) and asserts each one has an
// `alt` attribute whose value is non-empty — either a quoted string
// (`alt="Team Trust Rating"`) or a JSX expression (`alt={label}`). An absent
// `alt`, or an empty `alt=""` / `alt={''}`, is a failure.
//
// Sibling to `check-redirects.mjs` / `check-internal-refs.mjs` and follows the
// same contract: exits 0 on clean, exits 1 on any violation, exits 2 on bad
// CLI usage. `--verbose` lists every checked tag.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── CLI ──────────────────────────────────────────────────────────────────
const args = argv.slice(2);
let verbose = false;
for (const arg of args) {
  if (arg === "--verbose") verbose = true;
  else if (arg === "--help" || arg === "-h") {
    console.log("Usage: check-img-alt.mjs [--verbose]");
    exit(0);
  } else {
    console.error(`Unknown flag: ${arg}`);
    exit(2);
  }
}

// ── Collect *.mdx pages ────────────────────────────────────────────────────
function walkMdx(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkMdx(p, out);
    else if (e.endsWith(".mdx")) out.push(p);
  }
  return out;
}

// ── Validate <img> alt attributes ──────────────────────────────────────────
// `<img …>` tags may span several lines (attributes one-per-line), so match
// across newlines up to the first `>`. Badge markup never embeds `>` inside an
// attribute value, so a non-greedy run to the first `>` is safe.
const IMG_RE = /<img\b[\s\S]*?>/g;
// `alt` with a non-empty quoted string OR a JSX expression that is not empty
// (`{}` / `{''}` / `{""}` do not count).
const ALT_QUOTED = /\balt\s*=\s*"(?:[^"]+)"/;
const ALT_QUOTED_SINGLE = /\balt\s*=\s*'(?:[^']+)'/;
const ALT_EXPR = /\balt\s*=\s*\{(?!\s*(?:''|"")?\s*\})[^}]+\}/;
const hasAlt = (tag) =>
  ALT_QUOTED.test(tag) || ALT_QUOTED_SINGLE.test(tag) || ALT_EXPR.test(tag);

const failures = [];
let checked = 0;

for (const file of walkMdx(ROOT)) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(IMG_RE)) {
    checked++;
    const tag = match[0];
    const line = text.slice(0, match.index).split("\n").length;
    if (hasAlt(tag)) {
      if (verbose) console.log(`✓ ${rel}:${line}`);
    } else {
      const oneLine = tag.replace(/\s+/g, " ").trim();
      failures.push(`${rel}:${line} — <img> without a non-empty alt: ${oneLine}`);
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n✗ check-img-alt: ${failures.length} <img> without alt text:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nEvery <img> must have a descriptive alt attribute for screen-reader users.",
  );
  exit(1);
}

console.log(`✓ check-img-alt: ${checked} <img> tag(s) checked; all carry alt text.`);
exit(0);
