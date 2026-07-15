# Spec — Patch: Add test for unreadable-localized-page error branch in runCheck

- **Status:** Draft
- **Branch:** feature-issue-283-adw-d6def37d-add-an-i18n-translation-lag-detector-tha
- **Location:** `scripts/check-i18n-lag.test.mjs`
- **Related docs:** N/A

## Problem / Objective
**Original Spec:** N/A
**Issue:** The try/catch at `scripts/check-i18n-lag.mjs:264–270` — which reads the localized page itself (`readFile(abs)`) and on failure increments `errors` and pushes `'${rel}: unreadable — ${e.message}'` — has no test coverage. All six existing `runCheck` tests supply the localized file in the `files` map, so `readFile(abs)` never throws. The branch is distinct in message format (`unreadable`) and in which counter it increments (`errors`, not `stale`).
**Solution:** Add one focused test that omits `abs` from the files map (so `readFile(abs)` throws ENOENT), then asserts `r.errors === 1`, `r.stale === 0`, `r.inSync === 0`, `r.exitCode === 1`, and `r.errorReports[0]` matches `/unreadable/`.

## Approach & Changes
### Files to Modify
- `scripts/check-i18n-lag.test.mjs` — append one test after the existing `runCheck` tests (before the `countersConsistent` section)

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the missing test to `check-i18n-lag.test.mjs`

Insert the following test immediately after the `runCheck: cold-start` test (line 328) and before the `runCheck: counters partition` test (line 330):

```js
test("runCheck: unreadable localized page → routes to errors (fail closed), exit 1", () => {
  const enRel = "quickstart/overview.mdx";
  const abs = `${ROOT}/fr/${enRel}`;
  const enAbs = `${ROOT}/${enRel}`;
  // Only enAbs is readable; abs is intentionally absent so readFile(abs) throws.
  const readFile = (p) => {
    if (p === enAbs) return EN;
    throw new Error(`ENOENT: no such file, open '${p}'`);
  };
  const r = runCheck({
    root: ROOT,
    listPages: () => [{ locale: "fr", abs, rel: `fr/${enRel}`, enRel }],
    readFile,
  });
  assert.equal(r.exitCode, 1);
  assert.equal(r.errors, 1);
  assert.equal(r.stale, 0);
  assert.equal(r.inSync, 0);
  assert.match(r.errorReports[0], /unreadable/);
});
```

This exercises the `catch (e)` block at `check-i18n-lag.mjs:267–270` directly. No changes to any other file.

## Key Decisions & Rationale
**Lines of code to change:** ~18 (one new test block inserted)
**Risk level:** low — additive test only, no production code changes
**Testing required:** Run the test suite to confirm all tests pass, including the new one

## Verification
Execute every command to validate the patch is complete with zero regressions.

```sh
# From repo/worktree root
node --test scripts/check-i18n-lag.test.mjs
```

All tests must pass (including the new one). No other verification steps needed — this is a pure test addition.

## Known Limitations / Follow-ups
None. The fix is strictly in scope: one test for the one untested error branch.
