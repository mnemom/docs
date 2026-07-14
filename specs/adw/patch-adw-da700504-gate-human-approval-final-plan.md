# Spec — Patch: NEVER-AUTO gate — human approval is the only remaining action

- **Status:** Draft
- **Branch:** chore-issue-379-adw-da700504-replace-orphaned-check-links-local-mjs-w
- **Location:** No files to modify — resolution is a GitHub PR approval action, not a code change.
- **Related docs:** `specs/adw/patch-adw-da700504-confirm-never-auto-process-gate-plan.md`, `specs/adw/patch-adw-da700504-never-auto-human-approval-required-plan.md`, `specs/adw/patch-adw-da700504-document-rewrite-presatisfied-human-gate-plan.md`, `app_docs/feature-da700504-wire-check-links-into-mintlify-ci.md`

## Problem / Objective
**Original Spec:** `specs/adw/patch-adw-da700504-confirm-never-auto-process-gate-plan.md`
**Issue:** The review gate raises a NEVER-AUTO blocking finding because `.github/workflows/mintlify-ci.yml` was edited (+7 lines, additive `Check cross-locale links` step). Per the ADW safety invariant, any edit to `.github/workflows/` is unconditionally blocking regardless of whether the change is additive or strengthening. The worker must not self-merge this PR.

All code and documentation pre-conditions are fully satisfied:
- The workflow change is additive: +7 lines adding a blocking `Check cross-locale links` step, no existing step removed or weakened, no `continue-on-error` present, script resolves to Node built-ins only.
- `app_docs/feature-da700504-wire-check-links-into-mintlify-ci.md` lines 7–12 carry a `## Merge Gate` section explicitly stating human review is required before merge.
- Three prior patch plans (`confirm-never-auto-process-gate`, `never-auto-human-approval-required`, `document-rewrite-presatisfied-human-gate`) all confirm 0 code changes needed.

The sole remaining blocker is that a human has not yet submitted an explicit GitHub PR approval. This is a process enforcement finding, not a content objection.

**Solution:** No code changes are needed. A human reviewer must open the PR, inspect the `.github/workflows/mintlify-ci.yml` diff to confirm the `Check cross-locale links` step is additive and does not weaken any existing check, then submit a GitHub PR review with Approve status. Only after that explicit approval may the PR be merged.

## Approach & Changes
### Files to Modify
None. All workflow, documentation, and patch-plan files are complete and correct.

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Human reviewer inspects the workflow diff
- Open the PR on GitHub and navigate to the **Files Changed** tab.
- Locate the diff to `.github/workflows/mintlify-ci.yml`.
- Confirm the added `Check cross-locale links` step is purely additive (+7 lines).
- Confirm the step runs `npm run check:links` with **no** `continue-on-error` flag (the step is blocking).
- Confirm no existing step was removed, weakened, or reordered.
- Confirm the script resolves to Node built-ins only (no external network calls, no secrets consumed).

### Step 2: Human reviewer submits an explicit GitHub PR approval
- In the GitHub PR review interface, submit a review with **Approve** status (not merely a comment).
- This explicit approval satisfies the NEVER-AUTO gate for `.github/workflows/` edits.
- Only after this approval may the PR be merged.

## Key Decisions & Rationale
**Lines of code to change:** 0
**Risk level:** low — the workflow change is already committed and additive; it adds a blocking cross-locale link check, does not remove or weaken any existing step; no source files are modified by this patch.
**Testing required:** None — no executable code is modified. CI must remain green on the branch; the existing `Check cross-locale links` step exits 0 on the current content.

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `git diff --stat origin/main..HEAD` — must show `.github/workflows/mintlify-ci.yml` with exactly `+7` lines and the `app_docs/` feature doc with the `## Merge Gate` section; no further modifications to any workflow file.
- `grep -n "Merge Gate" app_docs/feature-da700504-wire-check-links-into-mintlify-ci.md` — must return at least one match (confirms documentation pre-condition is satisfied).
- GitHub PR review status shows **Approved** after human reviewer acts — this is the gate condition that unblocks merge.

## Known Limitations / Follow-ups
- This gate is unconditional by policy design. The additive, non-weakening nature of the workflow change is relevant context for the human reviewer but does not bypass the gate.
- If the ADW pipeline needs a standing carve-out for workflow additions that only ADD blocking checks (not weaken them), that carve-out must be made explicitly in the gate config — it cannot be inferred from issue scope or the additive nature of the change.
