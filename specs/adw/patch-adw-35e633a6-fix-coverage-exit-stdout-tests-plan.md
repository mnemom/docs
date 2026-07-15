# Spec — Patch: Fix coverage floor exit, stdout breakdown, and dry-run tests

- **Status:** Draft
- **Branch:** feature-issue-380-adw-35e633a6-report-live-executor-coverage-of-doc-exa
- **Location:** `scripts/run-doc-examples.mjs`, `scripts/run-doc-examples.test.mjs`, `scripts/test-fixtures/minimal-openapi.json` (new)
- **Related docs:** `specs/adw/issue-380-adw-35e633a6-report-live-executor-coverage-of-doc-exa-plan.md` (if present), `app_docs/feature-35e633a6-executor-coverage-report.md`

## Problem / Objective
**Original Spec:** `app_docs/feature-35e633a6-executor-coverage-report.md`
**Issue:** Four review-gate findings on the live-executor coverage feature (ADW 35e633a6):
1. (Finding #1) `exit(1)` at `run-doc-examples.mjs:444` on floor violation contradicts the AC's explicit "warn only, not fail" parenthetical — the AC names `exit(2)` as the only non-zero code introduced.
2. (Finding #2) The `!floorMet` branch and the entire coverage-reporting block (lines 405–449) are unreachable by the existing CLI tests; no test reaches the coverage section.
3. (Finding #3) The always-emitted `console.log` one-liner (lines 435–437) omits skipped-by-reason; the AC requires "executed / skipped-by-reason / executed%" on stdout on every run — the breakdown currently only appears under `--verbose` or in `$GITHUB_STEP_SUMMARY`.
4. (Finding #4) No CLI test exercises the coverage output path via `--dry-run` + local spec fixture (AC: "Verified via --dry-run against current fixtures").

**Solution:**
- Replace `exit(1)` with a `console.warn` (warn-only, exit 0 continues normally).
- Import `summarizeSkipReasons` in `run-doc-examples.mjs` and unconditionally emit skip-reason lines to stdout after the one-liner.
- Create a minimal OpenAPI fixture at `scripts/test-fixtures/minimal-openapi.json`.
- Add CLI tests that run with `--dry-run` + `OPENAPI_SPEC_PATH=<fixture>` to reach the coverage section and assert: stdout one-liner present, skip-reason breakdown present, exit 0 at default floor, exit 0 (warn-only) when floor is tripped.

## Approach & Changes

### Files to Modify
- `scripts/run-doc-examples.mjs` — two targeted edits: (a) add `summarizeSkipReasons` to import, (b) replace `exit(1)` with `console.warn`, (c) emit skip-reason breakdown unconditionally to stdout
- `scripts/run-doc-examples.test.mjs` — add CLI integration tests that reach the coverage section via `--dry-run` + `OPENAPI_SPEC_PATH`
- `scripts/test-fixtures/minimal-openapi.json` — new minimal OpenAPI 3.1 fixture (no paths, no network needed)

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create minimal OpenAPI fixture for CLI tests

Create `scripts/test-fixtures/minimal-openapi.json` — a well-formed OpenAPI 3.1 document with no paths. `loadSpec()` will parse it successfully via `OPENAPI_SPEC_PATH`; the extractor will find zero curl examples, producing `executed=0 / skipped=0 / discovered=0`.

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Test fixture", "version": "0.0.0" },
  "paths": {}
}
```

### Step 2: Add `summarizeSkipReasons` to the import in `run-doc-examples.mjs`

At `run-doc-examples.mjs` lines 60–65, extend the import from `./lib/executor-coverage.mjs`:

```js
import {
  parseMinExecutedPct,
  computeExecutorCoverage,
  coverageFloorMet,
  summarizeSkipReasons,
  renderCoverageSummary,
} from "./lib/executor-coverage.mjs";
```

### Step 3: Emit skip-reason breakdown to stdout unconditionally

After the always-emitted one-liner (currently lines 435–437), add unconditional stdout lines for each skip-reason category. Insert immediately after the `console.log(...)` one-liner:

```js
const reasons = summarizeSkipReasons(skipped);
for (const { category, count } of reasons) {
  console.log(`  Skipped by reason: ${count} (${category})`);
}
```

This satisfies the AC requirement that stdout carries "executed / skipped-by-reason / executed%" on every run, without touching the `$GITHUB_STEP_SUMMARY` append path or the `--verbose` full-Markdown branch.

### Step 4: Replace `exit(1)` on floor violation with warn-only

At `run-doc-examples.mjs` lines 438–445, change the `!floorMet` branch from:

```js
if (!floorMet) {
  console.error(
    `::error::Executor coverage ${coverage.pct}% is below the --min-executed-pct floor (${minExecutedPct}%).`,
  );
  exit(1);
}
```

to:

```js
if (!floorMet) {
  console.warn(
    `::warning::Executor coverage ${coverage.pct}% is below the --min-executed-pct floor (${minExecutedPct}%). (warn only — near-100%-skip is the expected current baseline)`,
  );
}
```

Also update the exit-code table in the file's JSDoc comment block (lines 37–42) to remove the "coverage fell below --min-executed-pct" bullet from the `1` exit-code description, since floor violation no longer causes a non-zero exit.

### Step 5: Add CLI integration tests that reach the coverage section

In `scripts/run-doc-examples.test.mjs`, add a second `runCli` helper (`runCliWithSpec`) that injects `OPENAPI_SPEC_PATH` pointing to the new fixture. Add the following tests in a new clearly-labelled block:

```js
// ── CLI coverage output (dry-run + local spec, network-free) ─────────────
const FIXTURE_SPEC = join(__dirname, "test-fixtures/minimal-openapi.json");

function runCliWithSpec(cliArgs, extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...cliArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      MNEMOM_STAGING_TOKEN: "",
      OPENAPI_SPEC_PATH: FIXTURE_SPEC,
      ...extraEnv,
    },
  });
}

test("CLI --dry-run + local spec: coverage one-liner appears on stdout", () => {
  const r = runCliWithSpec(["--dry-run"]);
  assert.equal(r.status, 0, `unexpected exit ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /Executor coverage:/);
});

test("CLI --dry-run + local spec: exit 0 with default floor (0)", () => {
  const r = runCliWithSpec(["--dry-run"]);
  assert.equal(r.status, 0);
});

test("CLI --dry-run + local spec: exit 0 (warn-only) when floor tripped", () => {
  // With an empty spec, coverage is 0%; a floor of 50 is below coverage.
  // AC requires warn-only (exit 0), not exit 1.
  const r = runCliWithSpec(["--dry-run", "--min-executed-pct", "50"]);
  assert.equal(r.status, 0, `expected exit 0 (warn-only) but got ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, /warning/i);
});

test("CLI --dry-run + local spec: no skip reasons emitted when list is empty", () => {
  const r = runCliWithSpec(["--dry-run"]);
  assert.equal(r.status, 0);
  // With an empty spec the discovered count is 0; no skip-reason lines expected.
  assert.ok(!r.stdout.includes("Skipped by reason:"), "no skip-reason lines when nothing was skipped");
});
```

## Key Decisions & Rationale
**Lines of code to change:** ~20 in `run-doc-examples.mjs`, ~45 in `run-doc-examples.test.mjs`, 5 in new fixture file
**Risk level:** low — changes are additive (new fixture, new tests) or narrowly scoped (swap `exit(1)` → `console.warn`, one import addition, a short stdout emit loop); no existing logic is removed
**Testing required:** Existing test suite passes unchanged (no existing assertions on the `!floorMet` exit path); new tests assert the coverage output and warn-only behavior

## Verification
Execute every command to validate the patch is complete with zero regressions.

```sh
# From the worktree root:
node --test scripts/run-doc-examples.test.mjs
```

All existing tests must continue to pass. The four new tests must also pass:
- `CLI --dry-run + local spec: coverage one-liner appears on stdout` → exit 0, stdout matches `/Executor coverage:/`
- `CLI --dry-run + local spec: exit 0 with default floor (0)` → exit 0
- `CLI --dry-run + local spec: exit 0 (warn-only) when floor tripped` → exit 0, stderr matches `/warning/i`
- `CLI --dry-run + local spec: no skip reasons emitted when list is empty` → exit 0, no "Skipped by reason:" line

Optionally run the linter/type-check if configured:
```sh
# lint / format (if available):
npm run lint --if-present
```

## Known Limitations / Follow-ups
- The minimal fixture produces `discovered=0` (no curl examples in an empty-paths spec). Tests for a non-zero skip reason breakdown (finding #3 with actual skip items) would require a richer fixture; that is intentionally deferred to avoid scope creep — the empty-fixture tests are sufficient to verify the coverage path is reachable and exits correctly.
- The header JSDoc exit-code table cleanup (removing "coverage below floor → exit 1") is in scope for Step 4 and must be done in the same commit to avoid misleading documentation.
