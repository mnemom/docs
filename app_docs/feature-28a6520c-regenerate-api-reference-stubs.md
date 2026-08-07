# Regenerate API Reference Stubs to Clear Title/Description Drift

**ADW ID:** 28a6520c
**Date:** 2026-08-07
**Plan-Spec:** agents/28a6520c/plan/issue-425-adw-28a6520c-regenerate-api-reference-stubs-plan.md

## Overview

The `verify-docs` nightly check failed on the `api-reference-orphans` axis because the committed API-reference stub for `GET /auth/me/personal-org` was behind the OpenAPI spec. This change re-runs the canonical generator so the drifted stub `description:` is re-projected byte-for-byte from `api-reference/openapi.json`, clearing the drift gate.

## What Was Built

This is a data-refresh remediation, not a code change. The generator was re-run to bring the committed docs projection back in sync with the spec.

- Regenerated the `description:` frontmatter of the `GET /auth/me/personal-org` endpoint stub to match the current OpenAPI operation description.
- Confirmed the drift gate (`node scripts/generate-api-reference.mjs --check`) now passes with zero drift.
- Recorded the nightly link-health metric snapshot for 2026-08-07.

## Technical Implementation

### Files Modified

- `api-reference/endpoint/get-auth-me-personal-org.mdx`: The generated stub's `description:` line was refreshed from the spec — from `"Returns the authenticated user's personal organization — the auto-provisioned org-of-one that scopes their individual resources."` to `"Returns the authenticated user's personal-org-of-one (per ADR-044 Piece 1)."`
- `metrics/link-health.jsonl`: New nightly link-health metric snapshot appended for 2026-08-07 (1683 total links, 3 broken, 0.2%).

### Key Changes

- The API-reference tree is a **drift-proof projection** of the committed OpenAPI slice (`api-reference/openapi.json`). When the slice was re-synced upstream, the operation description for `GET /auth/me/personal-org` changed, leaving the committed stub stale.
- The `computeDrift()` core (`descriptionFor`, `stubBody`, `STUB_RE` in `scripts/lib/api-reference-drift.mjs`) correctly detected `cur !== stubBody(...)` and failed the gate closed — exactly one drifted stub description.
- The fix ran the canonical write-path generator (`node scripts/generate-api-reference.mjs`) with no flags, re-projecting the stub from the spec. No generator logic, `openapi.json`, or nav config (`docs.json`) was hand-edited.
- The diff stays scoped to a single frontmatter line: `pages would write: 0`, `titles refreshed: 1`, `nav pages added: 0`.

## How to Use

This is an internal docs-pipeline fix; there is no end-user-facing feature. To reproduce or apply the same remediation when drift recurs:

1. From the repo root, run the drift gate: `node scripts/generate-api-reference.mjs --check` (or `npm run check:api-reference-drift`).
2. If it exits `1` with `N stub title/description(s) drifted`, inspect with `node scripts/generate-api-reference.mjs --dry-run`.
3. Regenerate by running the write path: `node scripts/generate-api-reference.mjs`.
4. Confirm the diff is scoped to the expected generated files and commit only those.

## Configuration

No configuration, environment variables, or dependencies were added or changed.

## Testing

- **Drift gate (primary acceptance):** `node scripts/generate-api-reference.mjs --check` — exits `0` with `✓ no drift`. Equivalently `npm run check:api-reference-drift`.
- **Generator unit tests:** `npm run test:api-reference` (`node --test scripts/generate-api-reference.test.mjs`) — proves the projection logic is unchanged.
- **lint:** `npm run check:redirects` (redirect integrity).
- **typecheck:** no-op for MDX docs.
- **test:** `npm ci && npm run check:doc-examples` (doc↔OpenAPI example validator).
- **build:** no build step; `mint broken-links` runs in CI via the `Validate Mintlify Docs` required check.

## Notes

- This is a self-healing, data-in/data-out refresh: the same drift will recur whenever `api-reference/openapi.json` is re-synced and an operation's summary/description changes. The nightly gate flags it and the generator resolves it — no follow-up beyond this regeneration is needed.
- Do **not** hand-edit `api-reference/` pages or `openapi.json` — the pages are generated and the spec is re-synced from the live surface; hand-editing either would reintroduce drift on the next check.
- Not a UI/UX change: only an `.mdx` `description:` frontmatter string changed, so no E2E test or screenshots are required.
