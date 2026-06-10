# Spec — Patch: Restore out-of-scope deleted lockfile spec

- **Status:** Draft
- **Branch:** feature-issue-242-adw-89a29f88-document-unclaimed-agent-integrity-behavior
- **Location:** specs/adw/patch-adw-e3e6ace4-fix-lockfile-never-auto-violation-plan.md
- **Related docs:** N/A (issue #242 — document unclaimed-agent integrity behavior)

## Problem / Objective
**Original Spec:** N/A (no spec_path provided)
**Issue:** The planner commit (`b36ceee`) on this branch deletes `specs/adw/patch-adw-e3e6ace4-fix-lockfile-never-auto-violation-plan.md`, a planning artifact from an unrelated prior ADW run (issue #225 / PR #231, already merged to `main`). Issue #242 is scoped to documenting unclaimed-agent integrity behavior and contains no instruction to clean up specs from other ADW runs. The deletion adds nothing to the #242 documentation work and its inclusion is unexplained out-of-scope churn.
**Solution:** Restore the deleted file to its `main` state so the PR diff contains only the intended #242 documentation changes. Any genuine stale-spec cleanup belongs in a dedicated housekeeping commit with explicit rationale, not in this documentation PR.

## Approach & Changes
### Files to Modify
- `specs/adw/patch-adw-e3e6ace4-fix-lockfile-never-auto-violation-plan.md` — restore (un-delete) from `main`.

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore the deleted spec file from main
- From the worktree root, run:
  `git checkout main -- specs/adw/patch-adw-e3e6ace4-fix-lockfile-never-auto-violation-plan.md`
- This recreates the file with byte-identical content to the version on `main` (last touched by `554bc1c`), removing the deletion from the branch diff.

### Step 2: Confirm the deletion is gone from the PR diff
- Run `git diff --stat main...HEAD` and confirm `patch-adw-e3e6ace4-fix-lockfile-never-auto-violation-plan.md` no longer appears as a deletion.
- Confirm the remaining diff contains only the intended #242 documentation files: `api-reference/headers.mdx`, `concepts/agent-identity.mdx`, `concepts/alignment-cards.mdx`, `concepts/ap-traces.mdx`, `concepts/integrity-checkpoints.mdx`, `guides/agent-claim-flow.mdx`.

## Key Decisions & Rationale
**Lines of code to change:** ~51 lines restored (1 file un-deleted); no documentation content changed.
**Risk level:** low
**Testing required:** Verify the file is restored and the branch diff no longer shows the unrelated deletion; run repo validation verbs to confirm zero regressions.

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `test -f specs/adw/patch-adw-e3e6ace4-fix-lockfile-never-auto-violation-plan.md && echo RESTORED` — file is present again.
- `git diff --stat main...HEAD` — no deletion of `patch-adw-e3e6ace4-fix-lockfile-never-auto-violation-plan.md`; only the six #242 `.mdx` doc files remain in the diff.
- `npm run check:redirects` — manifest `lint` verb (redirect integrity).
- `echo "(no typecheck for MDX docs)"` — manifest `typecheck` verb (no-op).
- `npm ci && npm run check:doc-examples` — manifest `test` verb (doc↔OpenAPI example validation).
- `echo "(Mintlify-hosted build; validated by CI)"` — manifest `build` verb (no-op).

## Known Limitations / Follow-ups
- This patch is not UX-facing: no changes under `images/**`, so the `ux` visual-validation phase does not apply.
- This patch deliberately does NOT delete the stale spec. If maintainers want to remove `patch-adw-e3e6ace4-fix-lockfile-never-auto-violation-plan.md` (PR #231 is merged), do so in a separate housekeeping commit that states the rationale explicitly.
