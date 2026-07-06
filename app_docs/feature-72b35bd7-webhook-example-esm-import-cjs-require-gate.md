# Fix `ReferenceError: require is not defined` in Webhook Example + CJS-require Regression Gate

**ADW ID:** 72b35bd7
**Date:** 2026-07-06
**Plan-Spec:** `specs/adw/issue-351-adw-72b35bd7-fix-require-not-defined-console-error-plan.md`

## Overview

The `guides/webhooks.mdx` Node.js signature-verification sample opened with a CommonJS `const crypto = require('crypto')`. Mintlify v4's Vite-based bundler can surface the JavaScript inside a fenced code block as executable module code, so that `require(...)` call threw an uncaught `ReferenceError: require is not defined` in the browser console on page load (issue #351 / MNE-1442). This change rewrites the sample to ESM `import` and adds a CI gate that keeps CommonJS `require(...)` from creeping back into any JavaScript/TypeScript doc example.

## What Was Built

- Rewrote the Node.js webhook signature-verification example to use ESM `import` instead of CommonJS `require('crypto')`.
- Added `scripts/check-no-cjs-require.mjs` — a regression gate that scans the customer-facing MDX/MD surface and fails when a JS/TS fenced code block calls `require(...)`.
- Registered the gate as the `check:no-cjs-require` npm script.

## Technical Implementation

### Files Modified

- `guides/webhooks.mdx`: Replaced `const crypto = require('crypto')` with `import { createHmac, timingSafeEqual } from 'crypto';`, and updated the two call sites (`crypto.createHmac(...)` → `createHmac(...)`, `crypto.timingSafeEqual(...)` → `timingSafeEqual(...)`).
- `scripts/check-no-cjs-require.mjs`: New validator (242 lines) that extracts fenced code blocks, filters to JS/TS dialect tags, and flags CommonJS `require(...)` calls.
- `package.json`: Added the `check:no-cjs-require` script pointing at the new validator.

### Key Changes

- The gate reuses the shared `walkMdx` / `extractFencedBlocks` helpers from `scripts/lib/doc-examples-extract.mjs`, matching the contract of sibling validators like `check-img-alt.mjs` and `check-path-references.mjs`.
- Only fenced blocks tagged with a JS/TS dialect (`js`, `javascript`, `jsx`, `ts`, `typescript`, `tsx`, `mjs`, `cjs`, `node`, `es`, `esm`, `mts`, `cts`) are inspected, so Ruby's `require 'openssl'` and shell prose never produce false positives.
- The detection regex `/\brequire\s*\(/` requires a following parenthesis and a word boundary, so parenthesis-less requires (Ruby) and identifiers ending in `require` (e.g. `prerequire(`) are correctly ignored; ESM `import ... from` is left alone as the sanctioned replacement.
- Exit-code contract: `0` on clean, `1` on any violation or failed self-test, `2` on bad CLI usage. Each failure is reported as `file:line (tag) — code`.
- A built-in `--self-test` exercises fixtures covering CJS detection, correct line reporting, TS coverage, ESM pass-through, Ruby/bash non-matches, the `prerequire(` word boundary, and multiple offenders per block.

## How to Use

The primary fix is transparent to readers — the webhook guide now renders without throwing a console error. For maintainers, the new gate runs as follows:

1. Run the check locally: `npm run check:no-cjs-require`
2. List every scanned file: `node scripts/check-no-cjs-require.mjs --verbose`
3. Point it at a different docs root: `node scripts/check-no-cjs-require.mjs --root <dir>`
4. Verify the gate's own logic: `node scripts/check-no-cjs-require.mjs --self-test`

When authoring JavaScript/TypeScript doc examples, use ESM `import { ... } from '...'` rather than `const x = require('...')`.

## Configuration

- `--root <dir>` / `--docs <dir>`: docs root to scan (default: repo root, resolved relative to `scripts/`).
- `--verbose`: list every scanned doc.
- `--self-test`: run the built-in fixtures and exit.
- `--help`, `-h`: show usage.

## Testing

- Run the validator's self-test: `node scripts/check-no-cjs-require.mjs --self-test` (all assertions must pass).
- Run the gate against the docs: `npm run check:no-cjs-require` (should report no CommonJS `require(...)` in JS/TS examples).
- Confirm the webhook page loads without the `ReferenceError: require is not defined` console error.

## Notes

- The gate is intentionally scoped to JS/TS dialect tags; non-JS languages that legitimately use `require` (Ruby, prose references) are excluded by design.
- Future JavaScript/TypeScript examples must use ESM `import` to remain compatible with Mintlify's bundler and to pass this gate.
