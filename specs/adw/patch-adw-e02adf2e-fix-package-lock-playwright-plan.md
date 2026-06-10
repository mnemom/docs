# Spec — Patch: Regenerate package-lock.json after adding playwright devDependency

- **Status:** Draft
- **Branch:** bug-issue-226-adw-e02adf2e-fix-self-hosted-quickstart-docs
- **Location:** package-lock.json
- **Related docs:** agents/e02adf2e/plan/issue-226-adw-e02adf2e-fix-self-hosted-quickstart-docs-plan.md, AGENTS.md

## Problem / Objective
**Original Spec:** agents/e02adf2e/plan/issue-226-adw-e02adf2e-fix-self-hosted-quickstart-docs-plan.md
**Issue:** A prior commit on this branch (`b23e86d`) added `playwright: ^1.60.0` under `devDependencies` in `package.json` (used by the screenshot verification scripts `agents/e02adf2e/screenshot.cjs`/`.js`), but `package-lock.json` was never updated to match. `git diff` shows 0 lines changed in `package-lock.json`, and `grep playwright package-lock.json` returns 0 hits. Any developer or CI step that runs `npm ci` after pulling this branch will fail with `package-lock.json is inconsistent with package.json`.
**Solution:** Regenerate `package-lock.json` so it includes the new `playwright` entry, and commit the updated lockfile alongside the existing `package.json` change. No edits to `package.json` itself — only the lockfile is brought back into sync.

## Approach & Changes
### Files to Modify
- `package-lock.json` — regenerated from `package.json` to add the `playwright` dependency tree.

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Regenerate the lockfile from package.json
- From the repo/worktree root, run `npm install --package-lock-only --no-audit --no-fund`.
- This resolves the newly added `playwright: ^1.60.0` devDependency and writes the resolved tree into `package-lock.json` without installing packages into `node_modules`.
- Do NOT modify `package.json` — the dependency declaration there is already correct; only the lockfile is out of sync.

### Step 2: Confirm the lockfile now reflects playwright
- Run `grep -c playwright package-lock.json` and confirm it returns a non-zero count (expected: the `playwright` package and its `playwright-core` dependency appear).
- Run `git status --short package-lock.json` and confirm `package-lock.json` now shows as modified.

### Step 3: Stage the regenerated lockfile for commit
- Ensure the regenerated `package-lock.json` is included in the branch so the PR carries both `package.json` and `package-lock.json` changes together, keeping `npm ci` consistent.

## Key Decisions & Rationale
**Lines of code to change:** ~1 file regenerated (lockfile entries auto-added for `playwright`/`playwright-core`); no hand-edits.
**Risk level:** low
**Testing required:** Verify `package-lock.json` is consistent with `package.json` via `npm ci` (or a `--package-lock-only` regen producing no further diff). This is a tooling/lockfile fix only; it touches no docs content (`.mdx`) and is not UX-facing, so the ADW UX validation / `ux` check does not apply.

## Verification
Execute every command from the repo/worktree root to validate the patch is complete with zero regressions.

- `npm install --package-lock-only --no-audit --no-fund` — regenerates the lockfile; running it a second time must produce no further diff (lockfile is stable/consistent).
- `grep -c playwright package-lock.json` — must return a non-zero count, confirming `playwright` is now present in the lockfile.
- `git diff --stat package-lock.json` — must show `package-lock.json` modified with the playwright tree added.
- `npm ci --ignore-scripts` — must complete without the `package-lock.json is inconsistent with package.json` error (the exact failure called out in the review). Requires network access to the npm registry.

## Known Limitations / Follow-ups
- This patch addresses only the lockfile inconsistency raised in the review. It deliberately does not revisit whether `playwright` belongs in `package.json` at all, nor the broader AGENTS.md note that this repo is "no build step" — those are out of scope for this fix.
- If a CI environment is fully offline, `npm ci` cannot fetch `playwright`; the lockfile-consistency check (`npm install --package-lock-only` producing no diff) is the offline-safe equivalent.
