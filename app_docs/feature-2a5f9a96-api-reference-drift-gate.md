# API Reference Drift Gate

**ADW ID:** 2a5f9a96
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-277-adw-2a5f9a96-generate-api-ref-check-drift-plan.md

## Overview

The `generate-api-reference.mjs --check` flag was upgraded from an advisory, orphan-only audit into a **complete, fail-closed drift gate** that CI can trust. It now fails if running the generator *would* create or modify any endpoint page or `docs.json` nav entry — meaning the committed API reference tree has fallen behind `api-reference/openapi.json`. To guarantee the gate and the write path can never disagree, the "what would change?" decision was extracted into a single pure module and covered by a dedicated regression suite.

## What Was Built

- A pure, side-effect-free drift-computation core (`computeDrift`) shared by both the generator's write path and the `--check` gate — one source of truth for every drift class.
- A hardened `--check` gate that detects **all** drift classes (pages to write, stub title/description refreshes, missing nav entries, duplicate nav entries, and orphan directives), not just orphans.
- **Fail-closed** behavior: a missing/unparseable spec, an empty `endpoint/` directory, or a missing/malformed `docs.json` now exits non-zero with an actionable `::error::` line instead of silently reporting "no drift".
- A regression test suite (15 tests) covering each drift class in memory plus the CLI's exit-code contract via subprocess.
- Two new npm scripts wiring the gate and its tests into the CI toolchain.
- A reconciled endpoint description so the committed tree passes the new gate cleanly.

## Technical Implementation

### Files Modified

- `scripts/lib/api-reference-drift.mjs` *(new)*: Pure `computeDrift({ spec, existingFiles, readEndpoint, docs })` function plus the shared `stubBody()` helper. Holds all the projection logic previously inlined in the generator (HELD list, exclusion rules, tag→group mapping, scope nesting, slug/description derivation, nav add/dedup). Performs no filesystem writes; reads page contents only through the injected `readEndpoint` reader so tests can drive it with in-memory fixtures.
- `scripts/generate-api-reference.mjs`: Refactored to import and route through `computeDrift`. The write/dry-run path now applies the helper's plan (`toGen`, `refreshList`, mutated `docs`) to disk; the `--check` path asserts the plan is a total no-op. Added fail-closed loaders (`loadSpec`, `loadEndpointFiles`, `loadDocs`) and a `checkFail()` helper that emits `::error::` and exits 1.
- `scripts/generate-api-reference.test.mjs` *(new)*: 15-test suite — unit tests drive `computeDrift` with minimal fixtures (one per drift class) and subprocess tests exercise the real CLI's exit codes, including all fail-closed edge cases.
- `package.json`: Added `check:api-reference-drift` (`node scripts/generate-api-reference.mjs --check`) and `test:api-reference` (`node --test scripts/generate-api-reference.test.mjs`).
- `api-reference/endpoint/get-auth-me-personal-org.mdx`: Reconciled the `description` field to match the current spec summary so the committed tree passes the gate.

### Key Changes

- **Single source of truth:** the write path and the drift gate share one pure computation, so the gate can never pass green while the generator would still rewrite the tree.
- **Full drift coverage:** `--check` now sums `written + refreshed + added + deduped + orphans` and fails on any non-zero total, reporting exactly which classes drifted and the remediation command to run.
- **Fail-closed by design:** any condition that blocks a trustworthy evaluation (missing spec, empty endpoint dir, bad JSON) exits non-zero with a clear message — never a false "✓ no drift".
- **Testability via dependency injection:** `computeDrift` takes an injected `readEndpoint` reader instead of calling `readFileSync` directly, enabling fast in-memory fixture tests with no disk or network.
- **Byte-identical output:** the initial-write and refresh paths both build stub frontmatter through `stubBody()`, guaranteeing generated and refreshed pages are identical in shape.

## How to Use

1. **Check for drift locally** before pushing API-reference changes:
   ```bash
   npm run check:api-reference-drift
   ```
   Exit 0 means the committed pages, nav, and directives all match the spec. Non-zero means drift was detected.
2. **Remediate drift** when the gate fails — run the generator and commit the result:
   ```bash
   node scripts/generate-api-reference.mjs
   git add api-reference/ docs.json && git commit
   ```
3. **Run the regression suite** for the gate:
   ```bash
   npm run test:api-reference
   ```

## Configuration

No configuration or environment variables. The gate is driven entirely by the committed inputs:

- `api-reference/openapi.json` — the source contract.
- `api-reference/endpoint/*.mdx` — the generated/hand-written endpoint pages.
- `docs.json` — the navigation tree (`API Reference` tab).

Endpoints intentionally withheld from publication are tracked in the `HELD` set in `scripts/lib/api-reference-drift.mjs`; exclusion rules (deprecated, dashboard-session/CookieAuth-only, non-API website endpoints) live in the same module.

## Testing

- Gate/unit + CLI contract: `npm run test:api-reference` (`node --test`) — 15 tests covering each drift class in memory and the CLI exit-code contract (clean tree exits 0; drifted tree and all fail-closed edge cases exit non-zero).
- Drift gate itself: `npm run check:api-reference-drift` — asserts the committed tree matches the spec.
- Broader docs validation (navigation, links, redirects): the `Mintlify Docs CI` workflow (`npm run check:nav-pages`, `check:nav-coverage`, `check:redirects`, etc.).

## Notes

- The `--check` gate is deliberately conservative: it treats *any* would-be write as drift, so refreshing a stub description or adding a single nav entry will fail the gate until the generator is re-run and the output committed.
- The previous `--check` was advisory and orphan-only; this change makes it a required, comprehensive gate. Existing pages generated before descriptions were added remain migration-safe — the stub regex treats the `description:` line as optional.
- The pure core mutates the `docs` object it is handed (to build the nav plan); the `--check` and `--dry-run` callers simply never serialize it back to disk.
