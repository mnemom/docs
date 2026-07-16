# Spec — Patch: Fix false CI-enforcement claims in feature doc

- **Status:** Draft
- **Branch:** feature-issue-382-adw-70a4c5e3-validate-the-deprecated-op-exclusion-lis
- **Location:** `app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md`
- **Related docs:** specs/adw/patch-adw-70a4c5e3-revert-workflow-add-report-tests-plan.md

## Problem / Objective
**Original Spec:** N/A
**Issue:** `app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md` contains five factually false claims about CI enforcement that does not exist. The workflow file was reverted to `main` state (no path-trigger additions, no manifest-freshness steps) per the NEVER-AUTO invariant, yet the doc still tells engineers "CI will catch stale manifests" — creating a false sense of safety and masking exactly the silent drift the issue was meant to prevent.

The five false claims:
1. **What Was Built** bullet 3: "A CI gate in the OpenAPI freshness workflow that regenerates the manifest and fails the build if the committed copy is stale"
2. **Files Modified**: `.github/workflows/openapi-freshness.yml` entry describing added path triggers and steps
3. **Key Changes** bullet 4: "CI now runs `node scripts/generate-api-reference.mjs --report` and asserts `git diff --exit-code`..."
4. **How to Use** step 4: "CI validates the manifest is up-to-date; a stale manifest fails the OpenAPI freshness workflow"
5. **Testing** paragraph: "The CI gate lives in `.github/workflows/openapi-freshness.yml`; it triggers on changes to..."

**Solution:** Remove or correct all five false claims in-place. Replace each with accurate text reflecting the shipped vs. deferred scope: the `--report` flag and committed manifest are shipped; the workflow CI gate is intentionally deferred to a human-gated commit per the NEVER-AUTO invariant.

## Approach & Changes
### Files to Modify
- `app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md` — remove/replace the five false CI claims; add one deferred-gate note

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix "What Was Built" — remove the CI gate bullet
Remove the third bullet point that claims a CI gate was built.

**Before (line 15):**
```
- A CI gate in the OpenAPI freshness workflow that regenerates the manifest and fails the build if the committed copy is stale — making every change to what's published or excluded an explicit, reviewable delta.
```
**After:** Delete this bullet entirely (two shipped bullets remain: `--report` flag and committed manifest).

### Step 2: Fix "Files Modified" — remove the workflow entry
Remove the `.github/workflows/openapi-freshness.yml` bullet from the Files Modified list (lines 23–24).

**Before:**
```
- `.github/workflows/openapi-freshness.yml`: Added `.coverage-manifest.json` and `generate-api-reference.mjs` to the `pull_request` path triggers, a step that runs `--report`, and an assertion step that fails if the regenerated manifest differs from the committed one.
```
**After:** Delete this bullet (only the two shipped files remain: `scripts/generate-api-reference.mjs` and `api-reference/.coverage-manifest.json`).

### Step 3: Fix "Key Changes" — remove the CI assertion bullet
Remove the CI assertion from Key Changes (line 30).

**Before:**
```
- CI now runs `node scripts/generate-api-reference.mjs --report` and asserts `git diff --exit-code api-reference/.coverage-manifest.json`, turning a silent exclusion-list change into a required, failing check with a clear remediation message.
```
**After:** Delete this bullet.

### Step 4: Fix "How to Use" step 4 — replace false CI claim with accurate manual note
**Before (line 45):**
```
4. Open the refresh PR. CI validates the manifest is up-to-date; a stale manifest fails the **OpenAPI freshness** workflow with instructions to rerun `--report` and commit.
```
**After:**
```
4. Open the refresh PR. The CI gate for manifest freshness is intentionally deferred (see Notes); until it lands, reviewers must verify the manifest was regenerated and committed alongside the spec change.
```

### Step 5: Fix "Testing" paragraph — remove false CI gate claim; replace with deferred note
**Before (lines 61–62):**
```
- The CI gate lives in `.github/workflows/openapi-freshness.yml`; it triggers on changes to `api-reference/openapi.json`, `api-reference/.coverage-manifest.json`, `scripts/sync-openapi.mjs`, and `scripts/generate-api-reference.mjs`.
```
**After:**
```
- The CI gate (path triggers for `.coverage-manifest.json` and `scripts/generate-api-reference.mjs`, plus the manifest-freshness assertion step) is intentionally deferred to a separate human-gated commit per the NEVER-AUTO invariant. Until that lands, regenerate and commit the manifest manually before opening a refresh PR.
```

## Key Decisions & Rationale
**Lines of code to change:** ~8 lines removed, ~4 lines modified — net negative
**Risk level:** low
**Testing required:** Visual diff review only; the doc has no automated tests

## Verification
Execute every command to validate the patch is complete with zero regressions.

1. Confirm the doc no longer mentions the workflow file as a shipped artifact:
   ```
   grep -n "openapi-freshness.yml" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   ```
   Expected: zero matches that claim it was modified; the single remaining mention (in the Testing bullet) must describe the gate as *deferred*, not as shipped.

2. Confirm none of the five original false phrases remain:
   ```
   grep -n "CI gate in the OpenAPI freshness workflow" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   grep -n "Added .coverage-manifest.json" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   grep -n "CI now runs" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   grep -n "a stale manifest fails" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   grep -n "it triggers on changes to" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   ```
   Expected: all return zero matches.

3. Confirm the deferred-gate note is present:
   ```
   grep -n "deferred" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   ```
   Expected: at least two matches (Testing section and How to Use step 4).

4. Run existing checks to confirm no regressions:
   ```
   npm run check:nav-pages
   npm run check:nav-coverage
   ```

## Known Limitations / Follow-ups
- This patch corrects documentation only. The actual CI gate (workflow path triggers + manifest-freshness step) remains deferred and must be applied by a human reviewer in a separate, explicitly approved commit after this PR merges. See `patch-adw-70a4c5e3-revert-workflow-add-report-tests-plan.md` § Known Limitations for the deferred scope.
