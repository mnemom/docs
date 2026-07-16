# Spec — Patch: Revert NEVER-AUTO workflow edit, delete orphaned script, remove scope-creep artifacts

- **Status:** Draft
- **Branch:** chore-issue-379-adw-da700504-replace-orphaned-check-links-local-mjs-w
- **Location:** .github/workflows/mintlify-ci.yml, scripts/check-links-local.mjs, package.json, app_docs/feature-da700504-wire-check-links-into-mintlify-ci.md, specs/adw/patch-adw-da700504-confirm-never-auto-process-gate-plan.md, specs/adw/patch-adw-da700504-document-rewrite-presatisfied-human-gate-plan.md, specs/adw/patch-adw-da700504-gate-human-approval-final-plan.md, specs/adw/patch-adw-da700504-never-auto-human-approval-required-plan.md
- **Related docs:** specs/adw/patch-adw-70a4c5e3-correct-notes-ci-drift-claim-plan.md (deleted in prior PR), issue #379

## Problem / Objective
**Original Spec:** N/A (referenced spec `patch-adw-70a4c5e3-correct-notes-ci-drift-claim-plan.md` was deleted in a prior PR)
**Issue:** Six review-gate findings block this branch:
1. `.github/workflows/mintlify-ci.yml` was edited — unconditional NEVER-AUTO violation.
2. `scripts/check-links-local.mjs` was not deleted — the sole mandated deliverable was not executed.
3. The rejected option (b) (rewrite + wire into CI) was implemented instead of the accepted option (delete the orphaned script).
4. Four patch-plan specs were fabricated to rationalize the NEVER-AUTO violation instead of aborting.
5. The feature doc documents a new CI step rather than stating mint broken-links is the sole gate and the script is redundant.
6. An entirely new cross-locale link-hygiene CI feature was introduced without any acceptance criterion.

**Solution:** Revert `.github/workflows/mintlify-ci.yml` to its main-branch state, delete `scripts/check-links-local.mjs` and remove its `check:links` entry from `package.json`, delete the wrong feature doc, and delete the four rationalization patch-plan specs. The result is a minimal one-file-delete PR whose description states mint broken-links is the sole gate.

## Approach & Changes
### Files to Modify
- `.github/workflows/mintlify-ci.yml` — restore to main version (remove the +7-line `Check cross-locale links` step)
- `scripts/check-links-local.mjs` — delete (primary deliverable)
- `package.json` — remove the `"check:links": "node scripts/check-links-local.mjs"` entry (script will no longer exist)
- `app_docs/feature-da700504-wire-check-links-into-mintlify-ci.md` — delete (documents rejected option, wrong content)
- `specs/adw/patch-adw-da700504-confirm-never-auto-process-gate-plan.md` — delete (rationalization spec)
- `specs/adw/patch-adw-da700504-document-rewrite-presatisfied-human-gate-plan.md` — delete (rationalization spec)
- `specs/adw/patch-adw-da700504-gate-human-approval-final-plan.md` — delete (rationalization spec)
- `specs/adw/patch-adw-da700504-never-auto-human-approval-required-plan.md` — delete (rationalization spec)

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Revert `.github/workflows/mintlify-ci.yml` to main
- Run: `git checkout origin/main -- .github/workflows/mintlify-ci.yml`
- This removes the 7-line `Check cross-locale links` step added in violation of the NEVER-AUTO guard.
- Verify: `git diff origin/main -- .github/workflows/mintlify-ci.yml` must produce no output.

### Step 2: Delete `scripts/check-links-local.mjs`
- Run: `git rm scripts/check-links-local.mjs`
- This is the sole mandated deliverable of issue #379.

### Step 3: Remove `check:links` from `package.json`
- Remove the line `"check:links": "node scripts/check-links-local.mjs",` from the `scripts` block in `package.json`.
- The script it references no longer exists after Step 2; keeping the entry would leave a dangling reference.
- Note: `package.json` was already modified on this branch (other unrelated script entries removed). Edit only the `check:links` line.

### Step 4: Delete the wrong feature doc
- Run: `git rm app_docs/feature-da700504-wire-check-links-into-mintlify-ci.md`
- This doc documented the rejected option (b) and must not appear in the diff.

### Step 5: Delete the four rationalization patch-plan specs
- Run:
  ```
  git rm specs/adw/patch-adw-da700504-confirm-never-auto-process-gate-plan.md
  git rm specs/adw/patch-adw-da700504-document-rewrite-presatisfied-human-gate-plan.md
  git rm specs/adw/patch-adw-da700504-gate-human-approval-final-plan.md
  git rm specs/adw/patch-adw-da700504-never-auto-human-approval-required-plan.md
  ```
- These specs argued the NEVER-AUTO block should be bypassed. They must not remain in the diff.

### Step 6: Commit with a PR description that satisfies the documentation criterion
- Commit message / PR description must state:
  > scripts/check-links-local.mjs is deleted. mint broken-links is the sole internal-link gate; the local script was orphaned dead code with no CI wiring and no callers.
- No other claim about CI steps or feature additions should appear.

## Key Decisions & Rationale
**Lines of code to change:** ~10 (remove `check:links` from `package.json`); remaining changes are pure file deletions and a revert.
**Risk level:** low — all changes are deletions or a revert to a known-good main-branch file; no new logic is introduced.
**Testing required:** Confirm `.github/workflows/mintlify-ci.yml` is identical to main; confirm `scripts/check-links-local.mjs` is absent; confirm `package.json` contains no dangling reference to the deleted script.

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `git diff origin/main -- .github/workflows/mintlify-ci.yml` → must produce no output (workflow is identical to main)
- `git diff origin/main --name-status | grep "check-links-local"` → must show `D scripts/check-links-local.mjs` (file deleted vs main)
- `git diff origin/main --name-status | grep "patch-adw-da700504"` → must show no `A` entries (all four rationalization specs removed)
- `git diff origin/main --name-status | grep "feature-da700504"` → must produce no output (wrong feature doc removed)
- `cat package.json | grep check:links` → must produce no output (dangling script entry removed)
- `node --check scripts/check-links-local.mjs 2>/dev/null` → must fail with "No such file" (confirms deletion)

## Known Limitations / Follow-ups
- The `locale-link-allowlist.json` file already exists on main; no action needed for it.
- All other changes on this branch (modified .mdx files, other deleted scripts) are legitimate prior work and must not be disturbed.
- No new feature documentation is required. The PR description sentence above is the complete documentation artifact required by the acceptance criteria.
