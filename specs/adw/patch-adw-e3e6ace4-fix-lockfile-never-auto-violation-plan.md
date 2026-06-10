# Spec — Patch: Fix package-lock.json NEVER-AUTO violation via rebase

- **Status:** Draft
- **Branch:** feature-issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas
- **Location:** No source files modified — pure git rebase operation
- **Related docs:** specs/adw/patch-adw-e3e6ace4-rebase-on-origin-main-plan.md

## Problem / Objective
**Original Spec:** N/A
**Issue:** The PR diff removes playwright devDependency entries from both `package.json` (diff lines 7340-7352) and `package-lock.json` (diff lines 7272-7336). `package-lock.json` is a dependency lockfile and sits in the NEVER-AUTO protected set. The removal is a staleness artifact: playwright was added to `origin/main` (in the commit block for e02adf2e screenshot agents) after this branch was cut, so the branch's base does not include those additions and the PR diff presents them as deletions.
**Solution:** Rebase the branch on current `origin/main`. Once rebased, the playwright entries will be present in the branch's base history and neither `package.json` nor `package-lock.json` will appear in the PR diff.

## Approach & Changes
### Files to Modify
No source files need to be modified. The fix is a pure git rebase operation.

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fetch latest origin/main
- Run `git fetch origin main` to pull the playwright-containing commits that the review system observes but the local tracking ref does not yet reflect.

### Step 2: Rebase the branch onto origin/main
- Run `git rebase origin/main` from branch `feature-issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas`.
- Expected conflicts: possible content conflict in `api-reference/openapi.json` if origin/main touched that file after `16a5fc1`. Resolution strategy: keep the branch's PublicAgent schema additions and integrate any freshness-check wrapper from main.
- `package.json` and `package-lock.json` should rebase cleanly (branch never modified them; the conflict is one-sided — main added, branch didn't touch).

### Step 3: Verify lockfile is absent from the PR diff
- Run `git diff origin/main -- package.json package-lock.json` and confirm the output is empty.
- Run `git diff --stat origin/main` and confirm neither `package.json` nor `package-lock.json` appears.

### Step 4: Force-push the rebased branch
- Run `git push --force-with-lease origin feature-issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas`.
- Safe because only ADW bot commits (sdlc_planner, sdlc_implementor, sdlc_documenter) sit above the new base; no human-authored commits are rewritten.

## Key Decisions & Rationale
**Lines of code to change:** 0 — rebase only; no file edits.
**Risk level:** low — the three branch commits are orthogonal to the playwright addition. `package.json`/`package-lock.json` were never touched by this branch, so they merge cleanly; only `api-reference/openapi.json` might need a manual resolution if both sides changed it.
**Testing required:** Confirm lockfiles absent from diff post-rebase.

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `git diff origin/main -- package.json` → must produce no output.
- `git diff origin/main -- package-lock.json` → must produce no output.
- `git diff --stat origin/main | grep -E "package(-lock)?\.json"` → must match nothing.
- `git log --oneline origin/main..HEAD` → must show only the three ADW commits (sdlc_planner, sdlc_implementor, sdlc_documenter) for issue #225; no extra commits.

## Known Limitations / Follow-ups
- This patch addresses only the `package-lock.json` / `package.json` NEVER-AUTO violation. The companion plan `patch-adw-e3e6ace4-rebase-on-origin-main-plan.md` covers the `.github/workflows/sdk-quickstart-trace.yml` NEVER-AUTO violation; both are resolved by the same rebase operation and can be executed together.
- If the rebase surfaces a conflict in `api-reference/openapi.json`, resolve it by accepting both the branch's PublicAgent additions and any freshness-check changes from `origin/main`.
