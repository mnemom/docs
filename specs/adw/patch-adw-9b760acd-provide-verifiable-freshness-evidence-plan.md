# Spec — Patch: Provide verifiable freshness evidence for the CI gate

- **Status:** Draft
- **Branch:** chore-issue-237-adw-9b760acd-resync-regenerate-openapi-api-reference
- **Location:** No new file changes required — verification only
- **Related docs:** specs/adw/patch-adw-9b760acd-satisfy-freshness-ci-path-trigger-plan.md, .github/workflows/openapi-freshness.yml

## Problem / Objective
**Original Spec:** N/A
**Issue:** Commit d94a90d asserts "Ran node scripts/sync-openapi.mjs … no delta" and "freshness check passes" purely inside commit message prose. A commit message is not evidence — the script may have run against a stale endpoint or not run at all. The reviewer requires either (a) a CI check run log or (b) the openapi.json committed so the freshness gate can execute on this PR and produce a verifiable result.
**Solution:** Condition (b) is already satisfied by f008cee, which committed both `api-reference/openapi.json` and `scripts/sync-openapi.mjs` — the two paths that trigger `openapi-freshness.yml`. The remaining gap is confirming that a second sync run against the live API produces zero diff (i.e., the gate would pass). Run `node scripts/sync-openapi.mjs && git diff --exit-code api-reference/openapi.json` in this environment to produce machine-verifiable evidence. The CI run triggered by the PR push is the definitive, public check run link.

## Approach & Changes
### Files to Modify
None — this patch is verification-only. f008cee already committed the trigger-path files. No additional file edits are required.

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm path-trigger files are present in the PR diff
- Run: `git diff --name-only origin/main..HEAD | grep -E '(api-reference/openapi\.json|scripts/sync-openapi\.mjs)'`
- Both files must appear in the output. If either is missing, the freshness workflow will not trigger on this PR.
- Expected output includes both lines:
  ```
  api-reference/openapi.json
  scripts/sync-openapi.mjs
  ```

### Step 2: Re-run the sync script to verify zero drift
- Run: `node scripts/sync-openapi.mjs 2>&1`
- The script fetches `https://api.mnemom.ai/openapi.json`, applies the leakage guard, sorts `components.schemas` alphabetically, and writes `api-reference/openapi.json`.
- Expected stderr: `sync-openapi: wrote … (N paths, M ops)` with exit code 0.

### Step 3: Assert committed file matches the live API surface
- Run: `git diff --exit-code api-reference/openapi.json`
- Exit code 0 = committed copy matches the deployed surface → freshness gate passes.
- Exit code 1 = drift detected → the committed file is stale; re-stage and commit the updated file before proceeding.

### Step 4: Record evidence
- Capture the combined output of Steps 2–3 (script stderr + diff exit code).
- This output is the local equivalent of the CI gate result. When the branch is pushed and the PR is processed by GitHub Actions, `openapi-freshness.yml` will execute the same two commands (`node scripts/sync-openapi.mjs` then `git diff --exit-code api-reference/openapi.json`) and produce the public, linkable check run that satisfies condition (a) of the reviewer's suggested fix.

## Key Decisions & Rationale
**Lines of code to change:** 0 — verification only; f008cee already provides all required code changes
**Risk level:** low — read-only check; if drift is found the corrective action is another sync commit identical in shape to f008cee
**Testing required:** Second sync run (`node scripts/sync-openapi.mjs`) + `git diff --exit-code`; the CI run triggered by the PR push is the definitive public evidence

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `git diff --name-only origin/main..HEAD | grep -E '(api-reference/openapi\.json|scripts/sync-openapi\.mjs)'` — confirm both path-trigger files are in the PR diff
- `node scripts/sync-openapi.mjs 2>&1; echo "exit:$?"` — re-sync from live API; must exit 0
- `git diff --exit-code api-reference/openapi.json; echo "diff-exit:$?"` — assert zero drift; must print `diff-exit:0`

## Known Limitations / Follow-ups
- This patch cannot produce the public CI check run link directly — that requires the branch to be pushed to GitHub and the PR to be processed by GitHub Actions. The local verification above is the immediate evidence; the CI run is the definitive public artifact.
- If `api.mnemom.ai` is unreachable from the runner environment, set `MNEMOM_OPENAPI_URL` to a local fixture to unblock. The CI run in GitHub Actions will always use the live endpoint.
