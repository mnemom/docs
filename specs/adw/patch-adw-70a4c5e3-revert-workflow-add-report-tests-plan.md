# Spec — Patch: Revert workflow NEVER-AUTO violation; add --report branch tests

- **Status:** Draft
- **Branch:** feature-issue-382-adw-70a4c5e3-validate-the-deprecated-op-exclusion-lis
- **Location:** `.github/workflows/openapi-freshness.yml`, `scripts/test-report.mjs`, `package.json`
- **Related docs:** specs/adw/ (no prior spec for this ADW), AGENTS.md

## Problem / Objective
**Original Spec:** N/A (no prior ADW spec found for this run)
**Issue:** Two independent review-gate blockers on the current branch:
1. The automated worker committed +18 lines to `.github/workflows/openapi-freshness.yml` (adding path triggers and two CI steps). The NEVER-AUTO invariant is absolute: any autonomous edit to `.github/workflows/` is a blocking finding regardless of content or intent.
2. The `--report` flag added to `scripts/generate-api-reference.mjs` (lines 138–175) introduces four distinct code branches — HELD classification, excluded-by-reason, generated fallback, and `process.exit(0)` short-circuit — none of which have automated tests. The CI gate is an integration test for the happy path only; the edge case where HELD wins over `deprecated=true` is unverified.

**Solution:**
1. Revert `.github/workflows/openapi-freshness.yml` to its `main` state, removing the NEVER-AUTO violation. The workflow changes are safe and correct but must be applied by a human reviewer in a separate, explicitly approved commit.
2. Add `scripts/test-report.mjs` (node:test, consistent with the project's existing `test:probe` pattern) exercising all four `--report` branches, including the priority edge case (HELD wins over deprecated). Add `test:report` to `package.json`.

## Approach & Changes
### Files to Modify
- `.github/workflows/openapi-freshness.yml` — revert to `main` branch content (remove the 18 added lines)
- `scripts/test-report.mjs` — create new test file (does not exist on branch or main)
- `package.json` — add `"test:report"` npm script entry

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Revert `.github/workflows/openapi-freshness.yml` to `main` state
Overwrite with the exact content from `main` to eliminate the NEVER-AUTO violation. The
diff to remove is:
- Comment lines 9–12 (coverage manifest paragraph)
- Two new `pull_request.paths` entries (`api-reference/.coverage-manifest.json`, `scripts/generate-api-reference.mjs`)
- Changed error message in `Assert committed copy matches deployed surface`
- Two new steps: `Re-generate coverage manifest` and `Assert coverage manifest is up-to-date`

The restored file content (verbatim from `main`):

```yaml
name: OpenAPI freshness

# The committed api-reference/openapi.json is a snapshot of the deployed
# customer-facing slice (GET https://api.mnemom.ai/openapi.json). This gate
# re-syncs it and fails if the committed copy has drifted from the deployed
# surface — the signal to run `node scripts/sync-openapi.mjs` and open a refresh
# PR (which then regenerates pages via scripts/generate-api-reference.mjs).
#
# It does NOT auto-commit — a human reviews the spec delta + regenerates.

on:
  workflow_dispatch:
  schedule:
    - cron: "0 13 * * 1" # Mondays 13:00 UTC
  pull_request:
    paths:
      - "api-reference/openapi.json"
      - "scripts/sync-openapi.mjs"

jobs:
  freshness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: "22.x"
      - name: Re-sync committed slice from deployed surface
        run: node scripts/sync-openapi.mjs
      - name: Assert committed copy matches deployed surface
        run: |
          if ! git diff --exit-code api-reference/openapi.json; then
            echo "::error::api-reference/openapi.json is stale vs the deployed customer slice."
            echo "Run 'node scripts/sync-openapi.mjs && node scripts/generate-api-reference.mjs' and open a refresh PR."
            exit 1
          fi
          echo "✓ committed OpenAPI slice matches the deployed surface"
```

### Step 2: Create `scripts/test-report.mjs`

The test uses Node.js `node:test` (same as `test:probe`) and runs the script as a subprocess
in a temp directory so the fixture spec does not touch `api-reference/openapi.json`. The
script's `ROOT` is resolved from `dirname(import.meta.url)/..`, so placing a copy at
`tmpDir/scripts/generate-api-reference.mjs` makes it read `tmpDir/api-reference/openapi.json`
and write `tmpDir/api-reference/.coverage-manifest.json`.

Six test cases to cover:
- `(a)` HELD op → `manifest.held`
- `(b)` `op.deprecated=true` → `manifest.excluded.deprecated`
- `(c)` CookieAuth-only security → `manifest.excluded["dashboard-session"]`
- `(d)` NON_API path (`POST /contact/submit`) → `manifest.excluded["non-api"]`
- `(e)` Plain op (no exclusion, not held) → `manifest.generated`
- `(f)` HELD wins when op also has `deprecated: true` (priority edge case cited by the review gate)

```js
// scripts/test-report.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "generate-api-reference.mjs");

function runReport(ops) {
  const dir = mkdtempSync(join(tmpdir(), "test-report-"));
  mkdirSync(join(dir, "api-reference"), { recursive: true });
  mkdirSync(join(dir, "scripts"));

  const spec = {
    openapi: "3.0.0",
    info: { title: "Test", version: "1.0" },
    servers: [{ url: "https://api.test.com/v1" }],
    paths: {},
  };
  for (const { method, path: p, op } of ops) {
    spec.paths[p] ||= {};
    spec.paths[p][method] = op;
  }
  writeFileSync(join(dir, "api-reference", "openapi.json"), JSON.stringify(spec));
  copyFileSync(SCRIPT, join(dir, "scripts", "generate-api-reference.mjs"));

  execFileSync(process.execPath, [
    join(dir, "scripts", "generate-api-reference.mjs"),
    "--report",
  ], { stdio: ["ignore", "ignore", "ignore"] });

  return JSON.parse(
    readFileSync(join(dir, "api-reference", ".coverage-manifest.json"), "utf8"),
  );
}

test("HELD op is classified as held", () => {
  const m = runReport([
    { method: "post", path: "/safe-house/ingest-pattern", op: { summary: "Held op", tags: ["Safe House"] } },
  ]);
  assert.deepEqual(m.held, ["POST /safe-house/ingest-pattern"]);
  assert.deepEqual(m.generated, []);
  assert.deepEqual(m.excluded.deprecated, []);
});

test("deprecated op is classified as excluded.deprecated", () => {
  const m = runReport([
    { method: "get", path: "/things/{id}", op: { summary: "Old thing", deprecated: true, tags: ["Things"], security: [{ ApiKeyAuth: [] }] } },
  ]);
  assert.deepEqual(m.excluded.deprecated, ["GET /things/{id}"]);
  assert.deepEqual(m.generated, []);
  assert.deepEqual(m.held, []);
});

test("CookieAuth-only op is classified as excluded.dashboard-session", () => {
  const m = runReport([
    { method: "get", path: "/dashboard/prefs", op: { summary: "Prefs", tags: ["Dashboard"], security: [{ CookieAuth: [] }] } },
  ]);
  assert.deepEqual(m.excluded["dashboard-session"], ["GET /dashboard/prefs"]);
  assert.deepEqual(m.generated, []);
  assert.deepEqual(m.held, []);
});

test("NON_API op is classified as excluded.non-api", () => {
  const m = runReport([
    { method: "post", path: "/contact/submit", op: { summary: "Contact form", tags: ["Contact"], security: [{ ApiKeyAuth: [] }] } },
  ]);
  assert.deepEqual(m.excluded["non-api"], ["POST /contact/submit"]);
  assert.deepEqual(m.generated, []);
  assert.deepEqual(m.held, []);
});

test("plain op is classified as generated", () => {
  const m = runReport([
    { method: "get", path: "/widgets", op: { summary: "List widgets", tags: ["Widgets"], security: [{ ApiKeyAuth: [] }] } },
  ]);
  assert.deepEqual(m.generated, ["GET /widgets"]);
  assert.deepEqual(m.held, []);
  assert.deepEqual(m.excluded.deprecated, []);
  assert.deepEqual(m.excluded["dashboard-session"], []);
  assert.deepEqual(m.excluded["non-api"], []);
});

test("HELD wins over deprecated when both conditions are true", () => {
  const m = runReport([
    { method: "post", path: "/safe-house/ingest-pattern", op: { summary: "Held+deprecated", deprecated: true, tags: ["Safe House"] } },
  ]);
  assert.deepEqual(m.held, ["POST /safe-house/ingest-pattern"]);
  assert.deepEqual(m.excluded.deprecated, []);
});
```

### Step 3: Add `test:report` to `package.json`

Add one entry to the `"scripts"` block in `package.json` (after `"test:probe"`):

```json
"test:report": "node --test scripts/test-report.mjs"
```

## Key Decisions & Rationale
**Lines of code to change:** ~5 lines removed from workflow + ~75 new lines (test file) + 1 line in package.json
**Risk level:** low
**Testing required:** `node --test scripts/test-report.mjs` (all 6 tests pass); `git diff main HEAD -- .github/workflows/openapi-freshness.yml` produces no output confirming revert is clean.

**Why not keep the workflow changes:** The NEVER-AUTO invariant is a hard constraint independent of correctness. The workflow changes are safe and should be applied by a human in a follow-up commit (e.g., by cherry-picking or manually editing after this PR merges). This is noted explicitly so the CI manifest gate is not silently abandoned — it is deferred to a human-gated follow-up.

## Verification
Execute every command to validate the patch is complete with zero regressions.

1. Confirm workflow file matches main exactly:
   ```
   git diff main HEAD -- .github/workflows/openapi-freshness.yml
   ```
   Expected: no output (empty diff).

2. Run the new report tests:
   ```
   node --test scripts/test-report.mjs
   ```
   Expected: 6 passing tests, exit 0.

3. Confirm `--report` still writes the manifest on the real spec (smoke test):
   ```
   node scripts/generate-api-reference.mjs --report
   git diff --stat api-reference/.coverage-manifest.json
   ```
   Expected: no diff (committed manifest already reflects current spec).

4. Run existing checks to confirm no regressions:
   ```
   npm run check:nav-pages
   npm run check:nav-coverage
   ```

## Known Limitations / Follow-ups
- The workflow additions (path triggers for `.coverage-manifest.json` + `scripts/generate-api-reference.mjs`, and the two new CI steps) are intentionally excluded from this PR. A human reviewer must apply them in a separate, explicitly approved commit after merge. This is the CI enforcement for the `--report` manifest gate (MNE-443 deferred AC).
- The test fixtures use hardcoded entries from `HELD` (`POST /safe-house/ingest-pattern`) and `NON_API` (`POST /contact/submit`). If those entries are ever removed from the script, the corresponding tests will need updating — this is intentional since the tests pin the specific classification behavior the review gate requires.
