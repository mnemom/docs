# Spec — Patch: NEVER-AUTO gate — human approval required before merge

- **Status:** Draft
- **Branch:** chore-issue-379-adw-da700504-replace-orphaned-check-links-local-mjs-w
- **Location:** No files to modify — resolution is a PR approval action, not a code change.
- **Related docs:** `app_docs/feature-da700504-wire-check-links-into-mintlify-ci.md`

## Problem / Objective
**Original Spec:** N/A
**Issue:** `.github/workflows/mintlify-ci.yml` is a NEVER-AUTO protected path. The diff adds a `Check cross-locale links` step (+7 lines) to this file. Per the ADW safety invariant, any edit to `.github/workflows/` is unconditionally blocking — the worker must not self-merge this PR. Acknowledgment in the feature doc (`## Merge Gate`) is correct documentation but does not satisfy the gate; only an explicit human approval action on the PR does.

The review finding explicitly states: "The change itself (adding a blocking `npm run check:links` step) looks correct and additive — this block is about the merge-path policy, not the content of the change."

**Solution:** No code changes are needed. A human reviewer must inspect the workflow diff and explicitly approve the PR via the GitHub PR review interface before it is merged. The worker must not self-merge.

## Approach & Changes
### Files to Modify
None. The workflow change is already complete and correct. No edits to any file are required.

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Human reviewer inspects the workflow diff
- Reviewer opens the PR and reads the diff to `.github/workflows/mintlify-ci.yml`
- Confirms the added step (`Check cross-locale links` / `npm run check:links`) is additive and does not weaken any existing check
- Confirms the step has no `continue-on-error` and is placed in the blocking section of the job

### Step 2: Human reviewer explicitly approves the PR
- Reviewer submits a GitHub PR review with **Approve** (not just a comment)
- This explicit approval satisfies the NEVER-AUTO gate for `.github/workflows/` edits
- Only after this approval may the PR be merged

## Key Decisions & Rationale
**Lines of code to change:** 0
**Risk level:** low — the workflow change is additive; it adds a blocking cross-locale check, does not remove or weaken any existing step
**Testing required:** CI passes on the branch (all existing checks remain green; the new `Check cross-locale links` step exits 0 because `npm run check:links` finds no cross-locale violations in the current content)

## Verification
- Human PR approval is recorded on the GitHub PR (GitHub UI shows "Approved" status)
- `git diff --stat origin/main..HEAD` — `.github/workflows/mintlify-ci.yml` shows `+7 lines` (the correct, already-committed change); no further modifications to the workflow file
- CI job `validate-docs` passes end-to-end including the new `Check cross-locale links` step

## Known Limitations / Follow-ups
- This gate is unconditional by policy design. If the ADW pipeline needs a standing carve-out for workflow additions that only ADD blocking checks (not weaken them), that carve-out must be made explicitly in the gate config — it cannot be inferred from issue scope or the additive nature of the change.
