#!/usr/bin/env node
// scripts/check-code-facts.mjs: annotated pages must agree with the code (MNE-9916).
//
// Offline and secret-free, so it runs on every PR (including forks). It reads
// every .mdx page, collects its `code-facts:` MDX comment claims, and fails if a
// claim names an unknown fact, asserts a value the vendored snapshot
// (scripts/code-facts-snapshot.json) contradicts, or quotes a phrase the page no
// longer contains. See scripts/lib/code-facts.mjs for the annotation syntax.
//
// Whether the snapshot itself still matches mnemom-api and mnemom-platform main
// is a separate, token-gated check: `node scripts/sync-code-facts.mjs --check`.
//
// Env overrides (used by the self-test): CODE_FACTS_ROOT (pages root),
// CODE_FACTS_SNAPSHOT (snapshot path).
//
// Exit codes: 0 every claim holds, 1 a claim is wrong, 2 a malformed annotation
// or snapshot.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { CodeFactsError, checkPage, parseAnnotations, validateSnapshot } from "./lib/code-facts.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.CODE_FACTS_ROOT || REPO;
const SNAPSHOT = process.env.CODE_FACTS_SNAPSHOT || join(REPO, "scripts", "code-facts-snapshot.json");

function* pages(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* pages(p);
    else if (e.name.endsWith(".mdx")) yield p;
  }
}

function main() {
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  validateSnapshot(snap);
  const problems = [];
  let annotated = 0;
  let claims = 0;
  for (const file of pages(ROOT)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    let found;
    try {
      found = parseAnnotations(text).length;
    } catch (e) {
      if (e instanceof CodeFactsError) throw new CodeFactsError(`${rel}: ${e.message}`);
      throw e;
    }
    if (!found) continue;
    annotated += 1;
    claims += found;
    problems.push(...checkPage(text, snap.facts, rel));
  }
  if (problems.length) {
    process.stderr.write(`check-code-facts: ${problems.length} claim problem(s) on ${annotated} annotated page(s):\n`);
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    process.exit(1);
  }
  process.stderr.write(`check-code-facts: ${claims} claim(s) on ${annotated} page(s) match the code facts snapshot\n`);
}

try {
  main();
} catch (e) {
  process.stderr.write(`check-code-facts: ${e.message}\n`);
  process.exit(2);
}
