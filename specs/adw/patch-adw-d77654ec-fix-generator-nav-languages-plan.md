# Spec — Patch: Fix generator nav-languages fallback and regenerate api-reference pages

- **Status:** Draft
- **Branch:** chore-issue-232-adw-d77654ec-sync-openapi-freshness
- **Location:** scripts/generate-api-reference.mjs, api-reference/endpoint/ (8 new stubs), docs.json
- **Related docs:** /home/runner/work/docs/docs/agents/d77654ec/plan/issue-232-adw-d77654ec-sync-openapi-freshness-plan.md, specs/adw/patch-adw-d77654ec-revert-generator-script-changes-plan.md

## Problem / Objective
**Original Spec:** /home/runner/work/docs/docs/agents/d77654ec/plan/issue-232-adw-d77654ec-sync-openapi-freshness-plan.md
**Issue:** Acceptance criterion step 3 is unmet — the branch contains only `api-reference/openapi.json`; no regenerated `.mdx` endpoint stubs and no `docs.json` nav additions for the 8 new endpoints (5 OAuth + 2 Agents tombstone/restore + 1 Auth token-exchange). The root cause is that `scripts/generate-api-reference.mjs` line 169 calls `docs.navigation.tabs.find(...)`, but `docs.json` uses the `navigation.languages` structure (tabs are nested under `navigation.languages[0].tabs`). Running the script as-is crashes immediately with a TypeError (`Cannot read properties of undefined`), so no pages were ever generated for the new spec surface.
**Solution:** Add a two-line `navigation.languages` fallback to line 169 of `scripts/generate-api-reference.mjs` (so it finds the API Reference tab in either structure), add `'OAuth'` to `GROUP_ORDER` after `'Auth'` (the new tag used by the 5 OAuth endpoints), then run `node scripts/generate-api-reference.mjs` and commit the full outputs: 8 new `.mdx` stubs + updated `docs.json`.

## Approach & Changes
### Files to Modify
- `scripts/generate-api-reference.mjs` — two targeted changes: (1) replace the single-tab lookup on line 169 with a fallback that handles both `navigation.tabs` and `navigation.languages[n].tabs`; (2) insert `'OAuth'` into `GROUP_ORDER` after `'Auth'`
- `docs.json` — updated in-place by running the script (nav additions for 8 new endpoints)
- `api-reference/endpoint/get-oauth-authorize.mdx` — created by the script
- `api-reference/endpoint/post-oauth-authorize.mdx` — created by the script
- `api-reference/endpoint/post-oauth-token.mdx` — created by the script
- `api-reference/endpoint/post-oauth-register.mdx` — created by the script
- `api-reference/endpoint/post-oauth-revoke.mdx` — created by the script
- `api-reference/endpoint/post-auth-token-exchange.mdx` — created by the script
- `api-reference/endpoint/post-agents-agent-id-tombstone.mdx` — created by the script
- `api-reference/endpoint/post-agents-agent-id-restore.mdx` — created by the script

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `'OAuth'` to GROUP_ORDER in generate-api-reference.mjs
- Open `scripts/generate-api-reference.mjs` and locate the `GROUP_ORDER` array (line 47).
- Insert `"OAuth"` immediately after `"Auth"` on line 48 so the OAuth nav group sorts between Auth and Agents:
  ```
  const GROUP_ORDER = [
    "API Reference", "Auth", "OAuth", "Agents", "Alignment", ...
  ```
- This ensures the 5 new OAuth endpoints render under an "OAuth" nav group positioned logically after "Auth".

### Step 2: Fix the navigation.languages fallback on line 169
- Locate line 169: `const tab = docs.navigation.tabs.find((t) => t.tab === "API Reference");`
- Replace it with the following three lines that resolve the API Reference tab from either `navigation.tabs` (legacy) or `navigation.languages[*].tabs` (current `docs.json`):
  ```js
  const allTabs = docs.navigation.tabs
    ?? docs.navigation.languages?.find((l) => l.default)?.tabs
    ?? docs.navigation.languages?.[0]?.tabs ?? [];
  const tab = allTabs.find((t) => t.tab === "API Reference");
  ```
- This is a minimal, non-breaking change: repos still on `navigation.tabs` are unaffected (the `??` short-circuits); repos on `navigation.languages` now work correctly.

### Step 3: Run the generator to produce the 8 missing stubs and nav additions
- From the worktree root, run:
  ```bash
  node scripts/generate-api-reference.mjs
  ```
- Confirm stderr reports `pages written: 8` and `nav pages added: 8` (or equivalent non-zero counts for the new endpoints: 5 OAuth + 1 Auth/token-exchange + 2 Agents/tombstone+restore).
- Confirm the 8 new `.mdx` files exist under `api-reference/endpoint/`.
- Confirm `docs.json` has been updated with the new nav entries.

### Step 4: Commit the complete outputs
- Stage the script change, the 8 new stubs, and the updated docs.json:
  ```bash
  git add scripts/generate-api-reference.mjs api-reference/endpoint/ docs.json
  ```
- Commit with a message explaining why the script fix is necessary:
  ```
  chore: fix generator nav-languages fallback and regenerate api-reference pages

  generate-api-reference.mjs assumed docs.navigation.tabs but docs.json now
  uses navigation.languages[0].tabs. Add a two-line fallback so the script
  resolves the API Reference tab in both layouts, and add 'OAuth' to
  GROUP_ORDER for the new OAuth endpoints. Re-run produces the 8 missing
  stubs (5 OAuth + auth/token-exchange + agents/tombstone + agents/restore)
  and the corresponding docs.json nav additions — completing acceptance
  criterion step 3 of issue-232.
  ```

## Key Decisions & Rationale
**Lines of code to change:** ~4 lines in `scripts/generate-api-reference.mjs` (2 for the fallback replacement, 1 for the OAuth GROUP_ORDER insertion); 8 new stub files (~3 lines each); ~15 nav lines in `docs.json`
**Risk level:** low — the script change is additive and backward-compatible; existing repos on `navigation.tabs` see no behavior change; the 8 new stubs are pure generated output
**Testing required:** Confirm `node scripts/generate-api-reference.mjs --dry-run` exits 0 before the live run; confirm `git diff --name-only origin/main HEAD` includes the stubs, docs.json nav additions, openapi.json, and the script — nothing more; run `npm run check:redirects` to confirm no broken-link regressions from the new nav entries

## Verification
Execute every command to validate the patch is complete with zero regressions.

- **Dry-run the generator first** (confirm no crash, expected output counts):
  ```bash
  node scripts/generate-api-reference.mjs --dry-run 2>&1
  ```
  Must report non-zero `pages would write` and `nav pages added` without errors.

- **Diff confirms complete outputs** — all three kinds of change are present:
  ```bash
  git diff --name-only origin/main HEAD
  ```
  Must include: `api-reference/openapi.json`, `scripts/generate-api-reference.mjs`, `docs.json`, and all 8 `api-reference/endpoint/` stubs (get-oauth-authorize, post-oauth-authorize, post-oauth-token, post-oauth-register, post-oauth-revoke, post-auth-token-exchange, post-agents-agent-id-tombstone, post-agents-agent-id-restore). No other files.

- **lint** (redirect / broken-link check):
  ```bash
  npm run check:redirects
  ```

- **test** (doc↔OpenAPI example validator):
  ```bash
  npm ci && npm run check:doc-examples
  ```

## Known Limitations / Follow-ups
- The `navigation.languages` fallback resolves to `languages[0].tabs` when no language is marked `default: true`. This is safe for the current single-language `docs.json` and forward-compatible with multi-language setups where one language is marked default.
- If Mintlify introduces further navigation-schema variants in future, the generator will need another adaptation pass.
