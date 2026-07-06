#!/usr/bin/env node
/**
 * check-no-cjs-require.mjs — CommonJS `require(...)` regression gate (issue #351).
 *
 * Mintlify v4's Vite-based MDX bundler can surface the JavaScript inside a
 * fenced code block as executable module code. A CommonJS call —
 * `const crypto = require('crypto')` — then throws
 * `ReferenceError: require is not defined` in the browser console on page load
 * (observed on the intro page, 2026-07-04, MNE-1442). The offending sample in
 * `guides/webhooks.mdx` was rewritten to ESM `import`; this gate keeps CJS
 * `require(...)` from creeping back into any JavaScript/TypeScript example.
 *
 * It walks the customer-facing MDX/MD surface, pulls every fenced code block
 * via the shared extractor, and — for blocks tagged as a JS/TS dialect
 * (`js`, `javascript`, `jsx`, `ts`, `typescript`, `tsx`, `mjs`, `cjs`,
 * `node`, `es`, `esm`, `mts`, `cts`) — flags any line that calls
 * `require(` — a CommonJS require. Blocks in
 * other languages are ignored, so Ruby's `require 'openssl'` (no parenthesis,
 * non-JS tag) and shell prose are never false positives. ESM `import ... from`
 * is the sanctioned replacement and is left alone.
 *
 * Sibling to `check-img-alt.mjs` / `check-path-references.mjs` and follows the
 * same contract: exits 0 on clean, exits 1 on any violation or a failed
 * self-test, exits 2 on bad CLI usage. `--verbose` echoes every scanned file.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

import {
  walkMdx,
  extractFencedBlocks,
} from "./lib/doc-examples-extract.mjs";

// ── Configuration ──────────────────────────────────────────────────────────
// Fenced-block language tags whose bodies are JavaScript/TypeScript module
// code — the only dialects where a `require(...)` call is a CommonJS use that
// can throw `ReferenceError: require is not defined` once bundled.
const JS_TAGS = new Set([
  "js",
  "javascript",
  "jsx",
  "ts",
  "typescript",
  "tsx",
  "mjs",
  "cjs",
  "node",
  "es",
  "esm",
  "mts",
  "cts",
]);

// A CommonJS `require(` call. The leading `\b` keeps identifiers that merely
// end in "require" (e.g. `prerequire(`) from matching; `\s*` tolerates
// whitespace between the name and the opening paren (`require (`).
const CJS_REQUIRE_RE = /\brequire\s*\(/;

// Directories we never scan for doc examples.
const IGNORE_DIRS = new Set(["node_modules", ".git"]);

// ── Core scanning ──────────────────────────────────────────────────────────

// Scan one MDX/MD source string. Returns an array of
// `{ tag, line, code }` hits — one per JS/TS fenced-block line that calls
// `require(...)`. `line` is the 1-based file line of the offending code.
export function scanSource(source) {
  const hits = [];
  for (const block of extractFencedBlocks(source)) {
    if (!JS_TAGS.has(block.tag)) continue;
    const lines = block.body.split("\n");
    for (let j = 0; j < lines.length; j++) {
      if (CJS_REQUIRE_RE.test(lines[j])) {
        // block.line is the 1-based file line of the opening fence; the body's
        // first line sits one below it, so file line = block.line + 1 + j.
        hits.push({ tag: block.tag, line: block.line + 1 + j, code: lines[j].trim() });
      }
    }
  }
  return hits;
}

// Collect every `*.mdx` / `*.md` doc under `root`, skipping node_modules/.git.
// Root-level pages (`introduction.mdx`, `changelog.mdx`, …) are included
// alongside the subtree walk.
export function collectDocs(root) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || IGNORE_DIRS.has(entry)) continue;
    const full = join(root, entry);
    const s = statSync(full);
    if (s.isDirectory()) walkMdx(full, files);
    else if (entry.endsWith(".mdx") || entry.endsWith(".md")) files.push(full);
  }
  return files;
}

// Scan the whole doc surface under `docsRoot`. Returns
// `{ scanned, failures }` where each failure is `{ file, tag, line, code }`.
export function checkNoCjsRequire({ docsRoot }) {
  const files = collectDocs(docsRoot);
  const failures = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const hit of scanSource(source)) {
      failures.push({ file: relative(docsRoot, file), ...hit });
    }
  }
  return { scanned: files.length, failures };
}

// ── Self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`  ✗ ${label}`);
    }
  };

  // A JS block with a CJS require is flagged, with the right file line.
  const cjs = ["intro", "", "```js", "const crypto = require('crypto');", "```", ""].join("\n");
  const cjsHits = scanSource(cjs);
  assert("CJS require in a js block is flagged", cjsHits.length === 1);
  assert("flagged line points at the require call", cjsHits[0]?.line === 4);

  // The TypeScript dialect tag is covered too.
  const ts = ["```typescript", 'const fs = require("fs");', "```"].join("\n");
  assert("require in a ts block is flagged", scanSource(ts).length === 1);

  // ESM import — the sanctioned replacement — is left alone.
  const esm = ["```js", "import { createHmac } from 'crypto';", "```"].join("\n");
  assert("ESM import is not flagged", scanSource(esm).length === 0);

  // Ruby `require 'x'` (no parenthesis, non-JS tag) is never a false positive.
  const ruby = ["```ruby", "require 'openssl'", "require 'json'", "```"].join("\n");
  assert("Ruby require without parens is not flagged", scanSource(ruby).length === 0);

  // Prose/other-language blocks are ignored even if they contain `require(`.
  const bash = ["```bash", "# see require('crypto') in the node docs", "```"].join("\n");
  assert("non-JS block mentioning require( is not flagged", scanSource(bash).length === 0);

  // A word merely ending in "require" is not a CommonJS require.
  const boundary = ["```js", "prerequire(config);", "```"].join("\n");
  assert("prerequire( is not flagged (word boundary)", scanSource(boundary).length === 0);

  // Multiple offenders in one block are all reported.
  const many = ["```js", "const a = require('a');", "const b = require('b');", "```"].join("\n");
  assert("both requires in a block are reported", scanSource(many).length === 2);

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(
    [
      "Usage: check-no-cjs-require.mjs [options]",
      "",
      "Fails when any JavaScript/TypeScript fenced code block in the docs",
      "calls CommonJS `require(...)` — which throws `require is not defined`",
      "once Mintlify's bundler surfaces the block as executable code.",
      "",
      "Options:",
      "  --root <dir>   Docs root (default: repo root, resolved from scripts/).",
      "  --docs <dir>   Alias for --root.",
      "  --verbose      List every scanned doc.",
      "  --self-test    Run built-in fixtures and exit.",
      "  --help, -h     Show this help.",
    ].join("\n"),
  );
}

function main() {
  const args = argv.slice(2);
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  let root = resolve(scriptDir, "..");
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--self-test") exit(selfTest() ? 0 : 1);
    else if (a === "--verbose") verbose = true;
    else if (a === "--root" || a === "--docs") {
      if (i + 1 >= args.length) {
        console.error(`${a} requires a path argument`);
        exit(2);
      }
      root = resolve(args[++i]);
    } else if (a === "--help" || a === "-h") {
      printHelp();
      exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      exit(2);
    }
  }

  const { scanned, failures } = checkNoCjsRequire({ docsRoot: root });

  if (verbose) {
    console.log(`Scanned ${scanned} doc(s) under ${root}.`);
  }

  if (failures.length > 0) {
    console.error(
      `\n✗ check-no-cjs-require: ${failures.length} CommonJS require(...) call(s) in JS/TS code block(s):`,
    );
    for (const f of failures) {
      console.error(`  - ${f.file}:${f.line} (${f.tag}) — ${f.code}`);
    }
    console.error(
      "\nMintlify may surface fenced JS as executable code, so `require(...)` throws" +
        "\n`ReferenceError: require is not defined` in the browser. Use ESM `import` instead.",
    );
    exit(1);
  }

  console.log(
    `✓ check-no-cjs-require: ${scanned} doc(s) scanned; no CommonJS require(...) in JS/TS examples.`,
  );
  exit(0);
}

// Run the CLI only when executed directly (`node check-no-cjs-require.mjs …`),
// not when imported — so the exported functions can be unit-exercised.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
