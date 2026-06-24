# Internal-Reference Gate — Localized Page Coverage

**ADW ID:** b2781594
**Date:** 2026-06-24
**Plan-Spec:** specs/adw/issue-298-adw-b2781594-scan-locale-pages-plan.md

## Overview

The internal-reference leakage gate (`scripts/check-internal-refs.mjs`) already recurses the whole repo when scanning `*.mdx` pages, so the localized page trees (`fr/`, `es/`) were covered in practice. This change makes that coverage **explicit and regression-proof** by adding self-test assertions that pin the production walk to the locale trees — so a future refactor of the file walker can't silently drop a locale from the gate.

## What Was Built

- New locale-coverage assertions in the scanner's `--self-test` block that prove the production `walkMdx(ROOT)` walk reaches every localized page tree.
- A single `LOCALES = ["fr", "es"]` list that documents which locale trees are pinned and is the one place to extend when a new locale (e.g. `de/`, `pt/`) is added.
- Header/comment documentation explaining that the recursive walk covers localized pages "by construction" and that the assertions exist to pin that coverage.

## Technical Implementation

### Files Modified

- `scripts/check-internal-refs.mjs`: Added a locale-coverage section to the `--self-test` path (+27/-2 lines). Updated the top-of-file doc comment to call out that the walk recurses localized page trees and that `--self-test` pins that coverage (issue-298). Updated the test total to `cases.length + 1 + LOCALES.length`.

### Key Changes

- For each locale in `LOCALES`, the test walks `ROOT/<locale>` and asserts every file it finds is also present in the set produced by the full `walkMdx(ROOT)` walk — proving the gate's production scan includes those files.
- Coverage is asserted against the **live tree**, not a synthetic fixture: planting a fake leak under a locale dir would itself trip the gate on the committed tree, so the test instead verifies file-set inclusion (and that the locale tree is non-empty).
- The check is defensive about missing directories: `existsSync(dir)` guards the walk, and a locale with zero `.mdx` files fails the assertion (`localeMdx.length > 0`), surfacing an empty/renamed locale tree rather than silently passing.
- No change to production scanning behavior — only the self-test gained assertions; the non-self-test scan path is untouched.

## How to Use

This is an internal CI gate; there's no end-user-facing surface. To work with it:

1. Run the scanner's assertions locally: `node scripts/check-internal-refs.mjs --self-test`
2. Run the full scan over `*.mdx` + OpenAPI prose: `node scripts/check-internal-refs.mjs`
3. When adding a new top-level locale tree (e.g. `de/`, `pt/`), add its directory name to the `LOCALES` array in `scripts/check-internal-refs.mjs`. The production walk already covers it; this just adds the matching coverage assertion.

## Configuration

- `LOCALES` (in `scripts/check-internal-refs.mjs`) — the list of locale directory names whose coverage is pinned by the self-test. Currently `["fr", "es"]`.

## Testing

- Self-test: `node scripts/check-internal-refs.mjs --self-test` — now reports `14/14 passed`, including `gate scans fr/ locale pages (6 file(s))` and `gate scans es/ locale pages (6 file(s))`.
- CI: `.github/workflows/internal-reference-gate.yml` runs the self-test and then the full scan on every PR and push to `main`.

## Notes

- The localized `fr/` and `es/` page trees each currently contain 6 `.mdx` files; the assertions confirm all of them fall under the gate's scan.
- The assertions guard against regressions in the file-walking logic, not against new locales being unscanned by default — any locale tree under `ROOT` is already scanned by the recursive walk; `LOCALES` only governs which trees get an explicit pin.
