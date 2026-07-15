# Spec — Patch: Correct false CI-catches-drift claim in Notes section

- **Status:** Draft
- **Branch:** feature-issue-382-adw-70a4c5e3-validate-the-deprecated-op-exclusion-lis
- **Location:** `app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md` line 63
- **Related docs:** specs/adw/patch-adw-70a4c5e3-fix-false-ci-claims-plan.md

## Problem / Objective
**Original Spec:** N/A
**Issue:** The Notes section (line 63) still asserts "it can never drift from the spec without CI catching it." The CI gate (path triggers + manifest-freshness assertion step) is explicitly deferred to a human-gated follow-up commit per the NEVER-AUTO invariant. The Testing section (line 58) and How-to-Use step 4 (line 42) already correctly describe the gate as deferred, but this Notes bullet contradicts them and creates a false sense of safety — the exact failure mode the original issue was filed to prevent.

**Solution:** Replace the tail of the Notes bullet ("so it can never drift from the spec without CI catching it") with accurate forward-looking language that matches the deferred-gate framing used elsewhere in the doc.

## Approach & Changes
### Files to Modify
- `app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md` — one line changed in the Notes section

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Replace the false claim in the Notes bullet (line 63)

**Before:**
```
- The manifest is a snapshot of *classification intent*, not a second source of truth — it is always regenerated from the committed OpenAPI slice, so it can never drift from the spec without CI catching it.
```

**After:**
```
- The manifest is a snapshot of classification intent, not a second source of truth — it is always regenerated from the committed OpenAPI slice. Once the CI gate lands (path triggers + manifest-freshness step), any drift will surface as a failing check; until then, regenerate and commit the manifest manually before opening a refresh PR.
```

## Key Decisions & Rationale
**Lines of code to change:** 1 line modified
**Risk level:** low
**Testing required:** grep verification only; the doc has no automated tests

## Verification
Execute every command to validate the patch is complete with zero regressions.

1. Confirm the false phrase is gone:
   ```
   grep -n "CI catching it" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   ```
   Expected: zero matches.

2. Confirm the corrected text is present:
   ```
   grep -n "Once the CI gate lands" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   ```
   Expected: exactly one match in the Notes section.

3. Confirm the doc uses "deferred" consistently across Notes, Testing, and How-to-Use:
   ```
   grep -n "deferred" app_docs/feature-70a4c5e3-validate-deprecated-op-exclusion-list.md
   ```
   Expected: at least three matches.

## Known Limitations / Follow-ups
- This patch corrects documentation only. The actual CI gate remains deferred and must be applied by a human reviewer in a separate, explicitly approved commit.
