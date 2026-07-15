# Spec — Patch: Correct inaccurate PR title and description

- **Status:** Draft
- **Branch:** chore-issue-379-adw-da700504-replace-orphaned-check-links-local-mjs-w
- **Location:** PR metadata only (title + body of PR #384) — no source files modified
- **Related docs:** specs/adw/patch-adw-da700504-revert-never-auto-delete-script-plan.md

## Problem / Objective
**Original Spec:** N/A
**Issue:** PR #384 title and body falsely claim Option (b) was chosen (wiring a new CI step into `.github/workflows/mintlify-ci.yml`). `git diff origin/main -- .github/workflows/mintlify-ci.yml` produces no output — the workflow is identical to main. Acceptance criterion 3 explicitly required documenting that `mint broken-links` is the sole gate and that Option (b) was *rejected*. The PR description contradicts both the actual diff and the acceptance criterion.
**Solution:** Replace the PR title and body with accurate content that matches the real diff: `scripts/check-links-local.mjs` deleted, `check:links` entry removed from `package.json`, no workflow changes, `mint broken-links` is the sole internal-link gate.

## Approach & Changes
### Files to Modify
- PR #384 metadata (title + body) via `gh pr edit` — no filesystem changes required

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update PR title
- Run `gh pr edit 384 --title "chore: delete orphaned scripts/check-links-local.mjs"`

### Step 2: Replace PR body with accurate content
- Run `gh pr edit 384 --body` with the replacement text below:

```
scripts/check-links-local.mjs is deleted. mint broken-links is the sole internal-link gate; the local script was orphaned dead code with no CI wiring and no callers.

Option (b) (rewrite + wire into CI) was explicitly rejected by the issue acceptance criteria.

## Changes

- `scripts/check-links-local.mjs` — deleted (orphaned, no callers, no CI wiring)
- `package.json` — `check:links` script entry removed (dangling reference to deleted file)
- No workflow files were modified

## Why mint broken-links is sufficient

`mint broken-links` runs in `mintlify-ci.yml` on every PR and validates all internal links across the docs tree. The local script duplicated a subset of that check without being hooked into CI, making it unreachable dead code.

Closes #379

<!-- ADW tracking: da700504 -->
```

## Key Decisions & Rationale
**Lines of code to change:** 0 (PR metadata only)
**Risk level:** low
**Testing required:** Verify `gh pr view 384` reflects the updated title and body after the edit

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `gh pr view 384 --json title,body | jq '.title'` — must equal `"chore: delete orphaned scripts/check-links-local.mjs"`
- `gh pr view 384 --json body | jq '.body'` — must contain `"mint broken-links is the sole internal-link gate"` and must NOT contain `"Option (b)"` as a chosen path or `"mintlify-ci.yml — added"`
- `git diff origin/main -- .github/workflows/mintlify-ci.yml` — must produce no output (confirming workflow was never changed)

## Known Limitations / Follow-ups
This patch addresses only the PR metadata (finding 1). Other scripts deleted on this branch (check-api-reference-coverage.mjs, check-compliance-coverage.mjs, etc.) are out of scope for this patch and are addressed by prior ADW runs.
