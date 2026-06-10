# Resync and Regenerate OpenAPI API Reference

**ADW ID:** 9b760acd
**Date:** 2026-06-10
**Plan-Spec:** agents/9b760acd/plan/issue-237-adw-9b760acd-resync-regenerate-openapi-api-reference-plan.md

## Overview

This task verified that the committed `api-reference/openapi.json` is current with the deployed customer-facing API slice at `api.mnemom.ai`. The freshness check confirmed the committed spec (380 paths, 498 ops) already matches the deployed surface — no delta was found and no files required updating.

## What Was Built

- Ran `scripts/sync-openapi.mjs` to fetch the current customer-facing OpenAPI slice from `api.mnemom.ai` and compare it against the committed `api-reference/openapi.json`
- Ran `scripts/generate-api-reference.mjs` to project the spec into Mintlify endpoint pages and navigation
- Confirmed freshness check passes: committed spec matches deployed API — no stale paths, no missing operations

## Technical Implementation

### Files Modified

No files were modified. Both scripts were executed against the live API and confirmed the committed spec is already in sync.

**sync-openapi.mjs output (run 2026-06-10):**
```
sync-openapi: wrote api-reference/openapi.json (380 paths, 498 ops)
git diff api-reference/openapi.json → (empty — no delta)
```

**generate-api-reference.mjs output (run 2026-06-10):**
```
generate-api-reference:
  pages written: 0
  titles refreshed: 0
  nav pages added: 0
  groups touched (0):
  EXCLUDED — deprecated:18 dashboard-session:2 non-api:2 held:2
  flagged: none
```

### Key Changes

- `api-reference/openapi.json`: Verified current at 380 paths / 498 operations — no update required; `git diff` empty after sync confirms committed copy matches live API
- `api-reference/endpoint/`: No new stubs written, no titles refreshed — generation is fully idempotent against the current spec
- `docs.json`: No navigation changes — 0 nav pages added
- `scripts/sync-openapi.mjs`: Fetches the customer-only OpenAPI slice from `api.mnemom.ai`, applies a staff-path leakage guard (rejects `/admin`, `/arena`, `/internal`, `/sonar`, `/rb2b` prefixes), and writes the result to `api-reference/openapi.json`
- `scripts/generate-api-reference.mjs`: Projects the committed spec into per-operation Mintlify stub pages and updates `docs.json` navigation — idempotent (skips hand-written pages with a body)
- CI enforces freshness via `.github/workflows/openapi-freshness.yml`, which re-runs `sync-openapi.mjs` and fails on `git diff --exit-code` if the committed copy drifts from the deployed surface
- The committed spec is a deterministic offline snapshot; docs builds never fetch at build time

## How to Use

1. Trigger a resync manually: `node scripts/sync-openapi.mjs`
2. Regenerate endpoint pages and navigation: `node scripts/generate-api-reference.mjs`
3. To dry-run the page generation without writing: `node scripts/generate-api-reference.mjs --dry-run`
4. CI runs the freshness check automatically on every PR — a non-zero `git diff` after the sync step fails the gate

## Configuration

- `MNEMOM_OPENAPI_URL`: Override the upstream source (default: `https://api.mnemom.ai/openapi.json`)
- Held endpoints (intentionally unpublished) are declared in the `HELD` set inside `generate-api-reference.mjs`
- Staff-path leakage guard pattern is defined in `sync-openapi.mjs` (`STAFF` regex)

## Testing

Run the freshness check locally:

```sh
node scripts/sync-openapi.mjs
git diff --exit-code api-reference/openapi.json
```

Run the reference generation dry-run to validate page projections without writing:

```sh
node scripts/generate-api-reference.mjs --dry-run
```

## Notes

- The prior issue (#232 / #235) was the one that actually updated a stale `openapi.json` (which had returned 429 responses). This task (#237) is a follow-up freshness verification confirming the spec remained current.
- The `api-reference` tier is a projection of the deployed customer API per ADR-054; the server applies the customer-only filter, so the committed slice contains no staff/internal paths.
- Hand-written endpoint pages (those with a body beyond `title` + `openapi` frontmatter) are never overwritten by `generate-api-reference.mjs`.
