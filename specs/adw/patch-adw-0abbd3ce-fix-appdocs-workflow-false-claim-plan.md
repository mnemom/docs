# Spec — Patch: Remove false workflow-modified claim from app_docs artifact

- **Status:** Draft
- **Branch:** feature-issue-380-adw-0abbd3ce-report-live-executor-coverage-of-doc-exa
- **Location:** `app_docs/feature-0abbd3ce-live-executor-coverage.md`
- **Related docs:** specs/adw/issue-380-adw-0abbd3ce-report-live-executor-coverage-plan.md (if present)

## Problem / Objective
**Original Spec:** specs/adw/issue-380-adw-0abbd3ce-report-live-executor-coverage-plan.md
**Issue:** `app_docs/feature-0abbd3ce-live-executor-coverage.md` lists `.github/workflows/doc-examples-live.yml` in the "Files Modified" section (lines 49–50) and claims it "Passes the `MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT` repo variable into the execute step." This is false. The workflow file is absent from the net diff (commit 700cce2 reverted those changes). The Configuration section also misleads operators by implying setting `MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT` as a GitHub repo variable is sufficient, when GitHub Actions does NOT auto-expose repo variables as env vars — so the floor silently does nothing until the workflow is manually wired.

**Solution:** Remove `.github/workflows/doc-examples-live.yml` from "Files Modified" and update the Configuration section with a note mirroring the accurate NEVER-AUTO comment already in `run-doc-examples.mjs` (lines 138–146) — explaining that workflow env wiring is intentionally left to an operator, and that until wired the floor must be set via `--min-executed-pct`.

## Approach & Changes

### Files to Modify
- `app_docs/feature-0abbd3ce-live-executor-coverage.md`

### Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove the false workflow entry from "Files Modified"
- Delete the bullet for `.github/workflows/doc-examples-live.yml` (lines 49–50 of the current file).
- The remaining four bullets accurately reflect the net diff.

### Step 2: Update the Configuration section to add the NEVER-AUTO operator note
- In the Configuration section, extend the `MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT` entry to explain:
  - GitHub Actions does **not** auto-expose repo variables as env vars.
  - To wire it via a repo variable an operator must add `MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT: ${{ vars.MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT }}` to the `env:` block of the "Execute safe doc examples" step in `doc-examples-live.yml`.
  - That one-line workflow edit is intentionally left to the operator (NEVER-AUTO constraint on `.github/workflows/**`).
  - Until wired, set the floor via the `--min-executed-pct` CLI flag; unset means no floor (no silent failure).

### Step 3: Optionally update the "What Was Built" overview bullet to remove the repo-variable wiring claim
- Line 32 of the artifact says "Wiring of the coverage summary into `$GITHUB_STEP_SUMMARY` in the nightly workflow, plus a dedicated test suite and npm test script." — this is accurate (the GITHUB_STEP_SUMMARY wiring IS in the net diff). No change needed there.
- Line 29 says the floor can be set via "env/repo variable" — adjust to note that repo-variable use requires operator workflow wiring (consistent with the Configuration section update).

## Key Decisions & Rationale
**Lines of code to change:** ~10 (remove 2 lines, add ~8 lines of note)
**Risk level:** low — documentation-only change to a pipeline artifact; no logic touched
**Testing required:** No automated tests apply; verify the diff matches only the one artifact file and the updated text is internally consistent with `run-doc-examples.mjs` lines 138–146.

## Verification
Execute every command to validate the patch is complete with zero regressions.

- Confirm only `app_docs/feature-0abbd3ce-live-executor-coverage.md` appears in `git diff --name-only`.
- Confirm `.github/workflows/doc-examples-live.yml` is absent from `git diff --name-only`.
- Confirm the phrase `doc-examples-live.yml` no longer appears in the "Files Modified" section of the artifact.
- Confirm the Configuration section now mentions the NEVER-AUTO constraint and the `--min-executed-pct` fallback.
- `npm run test:doc-coverage` — unit tests must still pass (no code changed).

## Known Limitations / Follow-ups
- Actual operator workflow wiring (`MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT: ${{ vars.MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT }}`) is out of scope for this patch per the NEVER-AUTO constraint; it must be done manually by an operator.
