# Spec — Patch: Add subprocess test for `--check` exit-0 path

- **Status:** Draft
- **Branch:** feature-issue-277-adw-2a5f9a96-wire-generate-api-reference-mjs-check-in
- **Location:** `scripts/generate-api-reference.test.mjs`
- **Related docs:** `specs/adw/patch-adw-2a5f9a96-revert-out-of-scope-endpoint-fix-smoke-test-plan.md`

## Problem / Objective
**Original Spec:** N/A
**Issue:** `generate-api-reference.mjs` line 164: `process.exit(0)` fires when `drift.written + drift.refreshed + drift.added + drift.deduped + drift.orphans.length === 0`. All existing subprocess tests (the drifted-tree test at line 183 plus the 4 fail-closed edge cases at lines 231–285) assert exit non-zero. No test calls `checkIn(root)` and asserts `r.status === 0`. The exit-0 branch is unreachable by the current test suite.

**Solution:** Add one subprocess test using the existing `makeTree`/`checkIn`/`VALID_*` harness. Build a clean tree (spec + matching page + matching nav), call `checkIn`, assert `r.status === 0` and `r.stderr` matches `/✓ no drift/`. This test would have FAILED on the pre-patch code (which exited 0 on any orphan-free tree regardless of write/refresh/nav drift).

## Approach & Changes

### Files to Modify
- `scripts/generate-api-reference.test.mjs` — add one subprocess test (~12 lines)

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the exit-0 subprocess test
Insert the following test immediately before the `"fail-closed: missing openapi.json"` test (after the `VALID_PAGE` constant declaration at line 229, before the `test("fail-closed: missing openapi.json…")` block at line 231):

```javascript
test("`--check` exits 0 on a clean tree (no drift)", () => {
  const root = makeTree({ openapi: VALID_OPENAPI, docs: VALID_DOCS, pages: VALID_PAGE });
  try {
    const r = checkIn(root);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /✓ no drift/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

This reuses the three existing `VALID_*` constants (lines 227–229) which already form a fully clean tree: one spec op, one matching stub page, one matching nav entry. No new fixtures needed.

## Key Decisions & Rationale
**Lines of code to change:** ~12 (one new test block inserted; no deletions)
**Risk level:** low — additive only; touches no logic, only the test file
**Testing required:** `node --test scripts/generate-api-reference.test.mjs` must pass all 16 tests (15 existing + 1 new)

## Verification
Execute every command to validate the patch is complete with zero regressions.

1. **All tests pass (including the new exit-0 test):**
   ```bash
   node --test scripts/generate-api-reference.test.mjs
   ```
   Expect 16 tests passing, 0 failing.

2. **New test name appears in output:**
   ```bash
   node --test scripts/generate-api-reference.test.mjs 2>&1 | grep "exits 0 on a clean tree"
   ```
   Must print the test name with a pass indicator.

3. **No out-of-scope files touched:**
   ```bash
   git diff --name-only HEAD
   ```
   Must list only `scripts/generate-api-reference.test.mjs`.

## Known Limitations / Follow-ups
- None. The `VALID_*` constants were already present for the fail-closed edge-case tests; this test reuses them directly.
