# Spec — Patch: Rebase branch on origin/main to restore deleted workflow file

- **Status:** Draft
- **Branch:** feature-issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas
- **Location:** `.github/workflows/sdk-quickstart-trace.yml` (must not appear in PR diff)
- **Related docs:** N/A

## Problem / Objective
**Original Spec:** N/A
**Issue:** The branch was cut from commit `7469584` (feat: #220), before commit `2f29706` (ci: regression gate for SDK-direct quickstart trace, #233) was merged to `main`. As a result, `.github/workflows/sdk-quickstart-trace.yml` does not exist in the branch's history. The PR diff therefore shows it as deleted, which is a NEVER-AUTO path violation for the `.github/workflows/` tree.
**Solution:** Rebase the branch on `origin/main`. Once rebased, the workflow file will already be present in the branch's base history, so it will not appear in the PR diff at all.

## Approach & Changes
### Files to Modify
No source files need to be modified. The fix is a pure git rebase operation.

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fetch latest origin/main
- Run `git fetch origin main` to ensure the local copy of `origin/main` is up to date.

### Step 2: Rebase the branch onto origin/main
- Run `git rebase origin/main` from the branch `feature-issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas`.
- Resolve any merge conflicts that arise (expected: none for the workflow file itself; possible conflicts in `api-reference/openapi.json` or `docs.json` if main changed those areas).
- If conflicts occur in `api-reference/openapi.json`, prefer the branch's version (it contains the issue-225 PublicAgent schema changes) and manually re-apply any freshness-check changes from `16a5fc1` that are orthogonal.

### Step 3: Verify the workflow file is no longer in the diff
- Run `git diff origin/main -- .github/workflows/sdk-quickstart-trace.yml` and confirm the output is empty (no deletions).
- Run `git diff --stat origin/main` and confirm `.github/workflows/sdk-quickstart-trace.yml` does not appear.

### Step 4: Force-push the rebased branch
- Run `git push --force-with-lease origin feature-issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas`.
- This is safe because only the ADW bot commits sit above the new base; no human-authored commits are rewritten.

## Key Decisions & Rationale
**Lines of code to change:** 0 — rebase only; no file edits.
**Risk level:** low — the three branch commits (sdlc_planner, sdlc_implementor, sdlc_documenter) are orthogonal to every commit merged to main since the branch was cut. Conflict probability is low; if `api-reference/openapi.json` conflicts, the resolution strategy is clear (keep branch additions, accept main's freshness-check wrapper).
**Testing required:** Confirm workflow file absent from PR diff post-rebase.

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `git diff origin/main -- .github/workflows/sdk-quickstart-trace.yml` → must produce no output (empty diff).
- `git diff --stat origin/main | grep sdk-quickstart-trace` → must match nothing.
- `git log --oneline origin/main..HEAD` → should show only the three ADW commits (sdlc_planner, sdlc_implementor, sdlc_documenter) for issue #225.
- `node scripts/check-sdk-quickstart.mjs` → must exit 0 (regression gate added in `2f29706` passes after rebase brings `scripts/check-sdk-quickstart.mjs` into the branch).

## Known Limitations / Follow-ups
- If the rebase surfaces conflicts in other files (e.g., `api-reference/openapi.json` touched by both `16a5fc1` and the branch), resolve them and commit before continuing the rebase. The conflict is a content merge, not a structural one.
- No spec or ADR changes are needed for this patch; the rebase does not alter the issue-225 feature intent.
