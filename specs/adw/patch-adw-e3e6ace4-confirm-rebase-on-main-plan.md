# Spec — Patch: Confirm rebase onto origin/main resolves behind-main review finding

- **Status:** Draft
- **Branch:** feature-issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas
- **Location:** No source files require editing — rebase is a pure git operation.
- **Related docs:** specs/adw/patch-adw-e3e6ace4-rebase-on-origin-main-plan.md

## Problem / Objective
**Original Spec:** specs/adw/patch-adw-d77654ec-correct-revert-verification-scope-plan.md
**Issue:** The review gate detected that the branch `feature-issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas` was severely behind `origin/main`. The PR diff showed approximately 4063 removed lines versus 246 added lines because the branch was cut from an earlier commit before several already-merged PRs landed: `api-reference/endpoint/*.mdx` stubs, `agents/e02adf2e/` screenshot artifacts, `app_docs/feature-e02adf2e-*`, `scripts/check-sdk-quickstart.mjs`, `scripts/generate-api-reference.mjs`, quickstart locale files, `docs.json` nav entries, `concepts/provider-support.mdx` edits, and multiple `specs/adw/patch-adw-*` plan files. Merging the PR in that state would silently revert all of that merged work.
**Solution:** Rebase the branch onto current `origin/main` so the only PR diff is the three ADW commits for issue #225 (PublicAgent schema changes in `api-reference/openapi.json` and the feature doc in `app_docs/feature-e3e6ace4-agent-openapi-response-schemas.md`). The rebase was executed as part of the companion plan `patch-adw-e3e6ace4-rebase-on-origin-main-plan.md`. This plan verifies the post-rebase state satisfies the review gate criteria.

## Approach & Changes
### Files to Modify
No files need to be modified. The fix was a `git rebase origin/main` operation; this plan only performs verification.

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm the merge base equals origin/main HEAD
- Run `git merge-base origin/main HEAD` and `git rev-parse origin/main`.
- Both must return the same SHA (`16a5fc1...`).
- If they differ, a further rebase is required before proceeding.

### Step 2: Confirm the PR diff contains only the two expected files
- Run `git diff origin/main --name-only`.
- Output must list exactly:
  - `api-reference/openapi.json`
  - `app_docs/feature-e3e6ace4-agent-openapi-response-schemas.md`
- `specs/adw/*.md` plan files in the working tree (untracked) are acceptable metadata; they do not appear in the committed diff.
- Any other path (`.github/workflows/`, `scripts/`, `docs.json`, `api-reference/endpoint/*.mdx`) is a failure.

### Step 3: Confirm the commit log contains only the three ADW commits
- Run `git log --oneline origin/main..HEAD`.
- Must show exactly three commits authored by the sdlc agents for issue #225 (sdlc_planner, sdlc_implementor, sdlc_documenter). No other commits.

### Step 4: Force-push if not already pushed post-rebase
- Run `git push --force-with-lease origin feature-issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas`.
- Required only if the remote still reflects the pre-rebase SHAs. Safe: only ADW-authored commits are being rewritten.

## Key Decisions & Rationale
**Lines of code to change:** 0 — verification and git push only.
**Risk level:** low — the rebase has already been performed; the branch diff matches the expected scope exactly.
**Testing required:** Confirm `git diff origin/main --name-only` returns only the two expected paths; confirm no NEVER-AUTO paths appear in the diff.

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `git merge-base origin/main HEAD` must equal `git rev-parse origin/main` (same SHA).
- `git diff origin/main --name-only` must list exactly `api-reference/openapi.json` and `app_docs/feature-e3e6ace4-agent-openapi-response-schemas.md`.
- `git log --oneline origin/main..HEAD | wc -l` must equal `3`.
- `git diff origin/main --name-only | grep -E '\.github/|scripts/|docs\.json|api-reference/endpoint/'` must produce no output.

## Known Limitations / Follow-ups
- The untracked plan files (`specs/adw/patch-adw-e3e6ace4-*.md`) will be committed by the ADW shipper as part of the normal pipeline; they do not need manual staging in this patch.
- The force-push in Step 4 rewrites the three ADW commit SHAs; the PR should be reviewed against the post-push HEAD.
