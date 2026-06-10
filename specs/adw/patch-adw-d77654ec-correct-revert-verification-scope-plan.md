# Spec — Patch: Correct revert-spec verification scope for specs/adw files

- **Status:** Draft
- **Branch:** chore-issue-232-adw-d77654ec-sync-openapi-freshness
- **Location:** specs/adw/patch-adw-d77654ec-revert-generator-script-changes-plan.md
- **Related docs:** /home/runner/work/docs/docs/agents/d77654ec/plan/issue-232-adw-d77654ec-sync-openapi-freshness-plan.md, specs/adw/patch-adw-d77654ec-revert-generator-script-changes-plan.md

## Problem / Objective
**Original Spec:** /home/runner/work/docs/docs/agents/d77654ec/plan/issue-232-adw-d77654ec-sync-openapi-freshness-plan.md
**Issue:** The Verification section of `specs/adw/patch-adw-d77654ec-revert-generator-script-changes-plan.md` (line 53) states: `git diff origin/main HEAD --name-only — must list only api-reference/openapi.json (no script, no docs.json, no .mdx stubs)`. After the shipper committed the two ADW plan files in commit f272a60, the actual diff listed three files: `api-reference/openapi.json`, `specs/adw/patch-adw-d77654ec-remove-feature-doc-plan.md`, and `specs/adw/patch-adw-d77654ec-revert-generator-script-changes-plan.md`. The self-stated criterion was therefore never satisfied as written, even though the revert itself was correct. The verification was not updated to account for ADW pipeline metadata files that the shipper adds.
**Solution:** Update line 53 of the revert patch spec to state that `specs/adw/*.md` files are acceptable in the diff (they are ADW operational metadata, not prohibited by the scope guard's spirit) and that the check should only require the absence of script, docs.json, and .mdx stubs.

## Approach & Changes
### Files to Modify
- `specs/adw/patch-adw-d77654ec-revert-generator-script-changes-plan.md` — update one line in the Verification section

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update the diff verification criterion on line 53
- Open `specs/adw/patch-adw-d77654ec-revert-generator-script-changes-plan.md`.
- Replace the existing line 53:
  ```
  - `git diff origin/main HEAD --name-only` — must list only `api-reference/openapi.json` (no script, no docs.json, no .mdx stubs)
  ```
  with:
  ```
  - `git diff origin/main HEAD --name-only` — must include `api-reference/openapi.json`; may also include `specs/adw/*.md` ADW pipeline metadata files added by the shipper (these are not generated outputs and are acceptable under the scope guard); must NOT list `scripts/generate-api-reference.mjs`, `docs.json`, or any `api-reference/endpoint/*.mdx` stubs
  ```

## Key Decisions & Rationale
**Lines of code to change:** 1 line
**Risk level:** low — documentation-only change to an ADW spec file; no code is modified
**Testing required:** Visual confirmation that the updated criterion accurately describes the expected diff state

## Verification
Execute every command to validate the patch is complete with zero regressions.

- Confirm the updated line is present:
  ```bash
  grep -n "specs/adw" specs/adw/patch-adw-d77654ec-revert-generator-script-changes-plan.md
  ```
  Must return the updated criterion text on the line that was formerly line 53.

- Confirm no prohibited files remain in the criterion:
  ```bash
  grep "must list only" specs/adw/patch-adw-d77654ec-revert-generator-script-changes-plan.md
  ```
  Must return empty output (the old phrasing is gone).

## Known Limitations / Follow-ups
- This patch corrects only the written verification claim; the actual diff state on the branch currently includes the 8 .mdx stubs and script changes from commit 28b1b61. A separate patch (patch-adw-d77654ec-fix-generator-nav-languages-plan.md) is responsible for those changes and has its own verification criteria.
