# Spec — Patch: Execute sync + generate scripts and commit all outputs

- **Status:** Draft
- **Branch:** chore-issue-237-adw-9b760acd-resync-regenerate-openapi-api-reference
- **Location:** api-reference/openapi.json, api-reference/endpoint/*.mdx, docs.json, app_docs/feature-9b760acd-resync-regenerate-openapi-api-reference.md
- **Related docs:** agents/9b760acd/plan/issue-237-adw-9b760acd-resync-regenerate-openapi-api-reference-plan.md, api-reference/_DESIGN-openapi-generation.md

## Problem / Objective
**Original Spec:** agents/9b760acd/plan/issue-237-adw-9b760acd-resync-regenerate-openapi-api-reference-plan.md
**Issue:** The worker committed only a documentation stub (`app_docs/feature-9b760acd-resync-regenerate-openapi-api-reference.md`) and no changes to `api-reference/openapi.json` or `api-reference/endpoint/`. The worker's claim that "no update was required" is unverified assertion — the issue premise is that mnemom-api#930 shipped new API surface and the CI freshness check was failing. A doc file claiming no delta is not verifiable proof.
**Solution:** Actually run `node scripts/sync-openapi.mjs` (writes the live spec to `api-reference/openapi.json`), then run `node scripts/generate-api-reference.mjs` (projects updated spec into endpoint pages + updates `docs.json`), and commit every file that changes. If the sync genuinely returns no delta, the script's stderr output (path count, op count) must be captured in the commit message as verifiable evidence — not just asserted in a prose doc.

## Approach & Changes
### Files to Modify
- `api-reference/openapi.json` — overwritten by `sync-openapi.mjs` with the live customer-facing slice
- `api-reference/endpoint/*.mdx` — new stubs written + existing stubs title-refreshed by `generate-api-reference.mjs`
- `docs.json` — navigation updated by `generate-api-reference.mjs`
- `app_docs/feature-9b760acd-resync-regenerate-openapi-api-reference.md` — update "Files Modified" section to reflect actual changed files (or confirm no delta with script output pasted)

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Run sync-openapi.mjs and capture output
- Run: `node scripts/sync-openapi.mjs 2>&1 | tee /tmp/sync-output.txt`
- The script fetches `https://api.mnemom.ai/openapi.json`, applies the staff-path leakage guard, and overwrites `api-reference/openapi.json`
- Capture stderr (path count, op count) for use in the commit message
- If the script exits non-zero (fetch failure or staff path leaked), stop and report the error — do not proceed

### Step 2: Check for a delta in openapi.json
- Run: `git diff api-reference/openapi.json`
- Note the exact diff (added paths, removed paths, changed ops) — this is the evidence the review gate requires
- If the diff is empty, note the path/op counts from Step 1 output (these confirm the script actually ran against the live API, not a cached or offline copy)

### Step 3: Run generate-api-reference.mjs and capture output
- Run: `node scripts/generate-api-reference.mjs 2>&1 | tee /tmp/generate-output.txt`
- This writes new `api-reference/endpoint/*.mdx` stubs for any ops not yet projected, refreshes titles on existing generated stubs, and updates the `docs.json` API Reference navigation
- Note counts: pages written, titles refreshed, nav pages added

### Step 4: Stage and commit all changed files
- Stage: `git add api-reference/openapi.json api-reference/endpoint/ docs.json`
- If there are changed files, commit with a message that includes the sync output (path count, op count, delta summary) as concrete evidence
- If openapi.json has no delta and generate produced no new pages, commit the empty-result confirmation with the sync/generate script output pasted into the commit body — this is the only acceptable form of "no change needed" proof

### Step 5: Update the app_docs feature file
- Edit `app_docs/feature-9b760acd-resync-regenerate-openapi-api-reference.md` — update the "Files Modified" section to list the actual files changed (or explicitly state counts from script output if no files changed)
- Stage and commit this file as a follow-up or in the same commit

## Key Decisions & Rationale
**Lines of code to change:** 0 lines of script code — the scripts are correct. The only changes are to the generated/synced output files and the feature doc.
**Risk level:** low — `sync-openapi.mjs` is idempotent and the staff-path leakage guard prevents committing internal paths; `generate-api-reference.mjs` skips hand-written pages
**Testing required:** Run freshness check (`git diff --exit-code api-reference/openapi.json` after a second sync run) and doc-examples check to confirm no regressions

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `node scripts/sync-openapi.mjs && git diff --exit-code api-reference/openapi.json` — confirms the committed spec matches the live API (freshness check passes)
- `node scripts/generate-api-reference.mjs --dry-run` — confirms no further pages would be written (generation is idempotent after commit)
- `npm run check:redirects` — manifest `lint` verb; confirms redirect integrity is intact
- `npm ci && npm run check:doc-examples` — manifest `test` verb; confirms doc↔OpenAPI examples are valid

## Known Limitations / Follow-ups
- If `api.mnemom.ai` is unreachable from the worker environment, the sync step will exit with code 2. In that case the patch should set `MNEMOM_OPENAPI_URL` to a staging fixture or request a network-enabled run — do not skip the sync step.
- The `app_docs` feature doc is intentional per project convention; it is not removed, only corrected.
