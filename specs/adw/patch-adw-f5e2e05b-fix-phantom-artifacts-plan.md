# Spec — Patch: Remove phantom-artifact claims from the card G trust-notes docs

- **Status:** Draft
- **Branch:** chore-issue-620-adw-f5e2e05b-card-g-docs-state-the-real-ioc-and-advis
- **Location:** `.adw-docs/feature-f5e2e05b-trust-ioc-advisory-notes.md`, `scripts/nav-coverage-allowlist.json`
- **Related docs:** N/A (no `spec_path` provided). Phantom plan-spec reference being removed:
  `agents/f5e2e05b/plan/issue-620-adw-f5e2e05b-ioc-advisory-real-behaviour-plan.md` (never existed
  in any commit per `git log --all`).

## Problem / Objective
**Original Spec:** N/A
**Issue:** Two review-gate findings, both the same underlying pattern — the merged diff describes
or references artifacts that were never actually delivered:
1. `.adw-docs/feature-f5e2e05b-trust-ioc-advisory-notes.md` describes a new regression-check
   script (`scripts/check-trust-claims.mjs`), its test file, and three `package.json` npm scripts
   as delivered, with specific passing-test counts. Verified via `git log --follow` that commit
   `0eca64f` added all three, then the final commit `a88c5a8` deleted
   `scripts/check-trust-claims.mjs` (-181 lines), `scripts/check-trust-claims.test.mjs` (-79
   lines), and reverted the `package.json` entries. None of it exists in the working tree or in
   the diff vs `origin/main`. `npm run check:trust-claims` referenced in the doc does not exist.
2. `scripts/nav-coverage-allowlist.json` added two entries —
   `agents/f5e2e05b/design_review/advisories.md` and
   `agents/f5e2e05b/plan/issue-620-adw-f5e2e05b-ioc-advisory-real-behaviour-plan.md` — neither of
   which exists anywhere in the repo or its history (confirmed via
   `git log --all -- "agents/f5e2e05b/plan/*" "agents/f5e2e05b/design_review/*"`, zero hits).
   `agents/f5e2e05b/` only contains `adw_state.json`, `pr-ref.json`, `run-record.json`,
   `review_gate/`, `steering_resolver/`.

**Solution:** Bring the two doc/metadata artifacts in line with what actually shipped in this PR
(the three hand-written `<Note>` edits on the Trust-surface `api-reference/endpoint/*.mdx` pages —
already merged and out of scope for this patch), rather than resurrecting a deleted script whose
removal was a deliberate decision in the final commit of this branch. This is the smaller, lower-risk
of the two suggested fixes per finding: it touches only prose and a JSON allowlist, adds no new
logic-bearing code, and cannot reintroduce whatever consideration led to the script's removal.

## Approach & Changes
### Files to Modify
- `.adw-docs/feature-f5e2e05b-trust-ioc-advisory-notes.md`
- `scripts/nav-coverage-allowlist.json`

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite the feature doc to describe only what shipped
- Remove the `Plan-Spec:` line pointing at the nonexistent plan file (the ADW metadata header).
- In "Overview": drop the sentence claiming "A new regression-gate script,
  `check-trust-claims.mjs`, guards these facts against silently drifting back to stale or
  unverified claims."
- In "What Was Built": remove the three bullets describing `scripts/check-trust-claims.mjs`,
  `scripts/check-trust-claims.test.mjs`, and the three new `npm run` scripts. Keep only the bullet
  describing the hand-written `<Note>` bodies on the three `api-reference/endpoint/*.mdx` pages.
- In "Technical Implementation" → "Files Modified": remove the two
  `scripts/check-trust-claims*.mjs` bullets and the `package.json` bullet. Keep the three `.mdx`
  bullets (these match the actual diff: `get-trust-iocs.mdx`, `get-trust-advisories.mdx`,
  `get-trust-advisories-slug.mdx`).
- In "Technical Implementation" → "Key Changes": drop the bullet describing
  `check-trust-claims.mjs`'s regression-detection behavior (references code that doesn't exist).
  Keep the stub/`STUB_RE` bullet and the "signed" disclaimer scoping bullet — both describe the
  `.mdx` edits that did ship.
- In "How to Use": remove steps 2–4 (`npm run check:trust-claims`, `check:trust-claims:self-test`,
  `test:trust-claims`) and renumber the remaining step 1 as the only step.
- In "Configuration": replace with "No new environment variables or configuration." (drop the
  sentence naming `check-trust-claims.mjs` constants).
- In "Testing": remove the three bullets citing `check-trust-claims.mjs` self-test/live/unit-test
  counts. Keep only the "Manifest verbs" bullet (`npm run check:redirects`, no-op typecheck,
  `npm ci && npm run check:doc-examples`, no-op build).
- In "Notes": remove the first two bullets (CI-wiring follow-up and manual-update caveat — both
  are about the now-nonexistent script). Keep the third bullet about out-of-scope concept/guide
  pages, since that's still accurate.

### Step 2: Remove the two phantom entries from the nav-coverage allowlist
- In `scripts/nav-coverage-allowlist.json`, delete the two list entries:
  `"agents/f5e2e05b/design_review/advisories.md"` and
  `"agents/f5e2e05b/plan/issue-620-adw-f5e2e05b-ioc-advisory-real-behaviour-plan.md"`.
- Keep `.adw-docs/feature-f5e2e05b-trust-ioc-advisory-notes.md` in the allowlist — that file does
  exist and is a genuine (dot-prefixed, internal) orphan-by-design entry, consistent with the
  other `.adw-docs/feature-*` entries already in the list.
- Fix the trailing comma / JSON array syntax after removal so the file stays valid JSON.

## Key Decisions & Rationale
**Lines of code to change:** ~25-30 lines removed/edited in the `.adw-docs` doc, 2 lines removed in
the allowlist JSON. No code files touched.
**Risk level:** low — prose and JSON-config only, no script/test/package.json changes, nothing
that affects a build, lint, or test verb.
**Testing required:** Confirm the edited `.adw-docs` file no longer references
`check-trust-claims`, `check:trust-claims`, or the phantom plan path anywhere; confirm the
allowlist JSON parses and no longer lists the two nonexistent paths; run the manifest verbs to
confirm no regression.

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `grep -rn "check-trust-claims\|check:trust-claims" .adw-docs/feature-f5e2e05b-trust-ioc-advisory-notes.md` → must return no matches.
- `grep -n "agents/f5e2e05b" scripts/nav-coverage-allowlist.json` → must only show the `.adw-docs/feature-f5e2e05b-trust-ioc-advisory-notes.md` line (if any), not the `plan/` or `design_review/` paths.
- `node -e "JSON.parse(require('fs').readFileSync('scripts/nav-coverage-allowlist.json','utf8'))"` → must parse without error.
- `npm run check:redirects` (manifest `lint` verb) — must pass.
- `npm ci && npm run check:doc-examples` (manifest `test` verb) — must pass.
- `npm run check:nav-coverage` — must still report 0 orphans (sanity check that removing the two entries didn't orphan a real page).

## Known Limitations / Follow-ups
- This patch does not restore the `check-trust-claims.mjs` regression guard the original card
  rationale called for. If that guard is still wanted, it should be re-proposed as a fresh,
  separately-reviewed change (not resurrected silently via this patch), since the final commit of
  this branch deliberately removed it and the reviewing finding gives no information on why.
