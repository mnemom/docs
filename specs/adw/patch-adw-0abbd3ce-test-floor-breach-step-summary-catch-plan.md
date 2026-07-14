# Spec — Patch: Cover floor-breach ::warning:: and GITHUB_STEP_SUMMARY catch paths

- **Status:** Draft
- **Branch:** feature-issue-380-adw-0abbd3ce-report-live-executor-coverage-of-doc-exa
- **Location:** `scripts/run-doc-examples.coverage.test.mjs`
- **Related docs:** specs/adw/patch-adw-0abbd3ce-fix-appdocs-workflow-false-claim-plan.md

## Problem / Objective
**Original Spec:** specs/adw/issue-380-adw-0abbd3ce-report-live-executor-coverage-plan.md
**Issue:** Two new branches added to `scripts/run-doc-examples.mjs` (lines 415–431) are exercised by no test:
1. **Finding 1** — `if (coverage.floor.breached)` block (lines 424–431): the `::warning::` annotation, the message format (`coverage.executedPct.toFixed(1)%`, `minExecutedPct%`), and both `console.log` calls are untested. A test that would fail on pre-change code does not exist.
2. **Finding 2** — `catch (err)` in the `if (env.GITHUB_STEP_SUMMARY)` block (lines 415–423): when `appendFileSync` throws, the `::notice::Could not write coverage summary to GITHUB_STEP_SUMMARY: ${err.message}` path is never exercised.

**Solution:** Add two child-process integration tests to `scripts/run-doc-examples.coverage.test.mjs`. Each test spawns `run-doc-examples.mjs --dry-run` with a minimal temp spec (`{ "paths": {} }`) and a temp MDX fixture containing one curl example. Because the spec has no paths, the example gets `spec-path-unmatched` → `plan=[], skipped=[1]` → `executedPct=0`. That is sufficient for both scenarios without any network calls or live fixtures.

## Approach & Changes

### Files to Modify
- `scripts/run-doc-examples.coverage.test.mjs` — add imports + 2 integration tests (no other file touched)

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add child-process + fs + path imports at the top of the test file
After the existing `import` block in `scripts/run-doc-examples.coverage.test.mjs` (after line 24), add:

```javascript
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
```

Then add two module-level constants derived from `import.meta.url`:

```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "run-doc-examples.mjs");
const REPO_ROOT = join(__dirname, "..");
```

And a helper that creates temp fixtures reused by both integration tests:

```javascript
function mkIntegrationEnv() {
  const dir = mkdtempSync(join(tmpdir(), "run-doc-eg-test-"));
  // Minimal spec: no paths → every curl gets spec-path-unmatched → executedPct = 0
  writeFileSync(join(dir, "openapi.json"), JSON.stringify({ paths: {} }));
  // One GET example in a bash block — no credential-shaped values (MNE-339)
  writeFileSync(
    join(dir, "fixture.mdx"),
    "```bash\ncurl https://api.mnemom.ai/v1/agents\n```\n",
  );
  return dir;
}
```

### Step 2: Add integration test for finding 1 — floor-breach `::warning::` branch
Append a new test at the bottom of the file:

```javascript
// ── Integration: wiring in run-doc-examples.mjs (child-process) ──────────────
//
// These tests exercise branches in the top-level script that cannot be reached
// by importing coverage-summary.mjs alone. They spawn a real child process with
// a minimal temp spec (no paths → all examples are spec-path-unmatched,
// executedPct = 0) so no network call or live fixture is required.

test("floor-breach emits ::warning:: annotation with correct percentage format", () => {
  const dir = mkIntegrationEnv();
  try {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--dry-run", "--min-executed-pct", "99", "--scope", join(dir, "fixture.mdx")],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, OPENAPI_SPEC_PATH: join(dir, "openapi.json") },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.ok(
      r.stdout.includes(
        "::warning::Live doc-example coverage 0.0% is below the configured floor of 99%",
      ),
      `expected ::warning:: annotation in stdout\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

### Step 3: Add integration test for finding 2 — GITHUB_STEP_SUMMARY catch branch
Append after the test from Step 2:

```javascript
test("GITHUB_STEP_SUMMARY appendFileSync error emits ::notice:: annotation", () => {
  const dir = mkIntegrationEnv();
  try {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--dry-run", "--scope", join(dir, "fixture.mdx")],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          OPENAPI_SPEC_PATH: join(dir, "openapi.json"),
          GITHUB_STEP_SUMMARY: dir, // directory → appendFileSync throws EISDIR
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.ok(
      r.stdout.includes("::notice::Could not write coverage summary to GITHUB_STEP_SUMMARY:"),
      `expected ::notice:: annotation in stdout\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

## Key Decisions & Rationale
**Lines of code to change:** ~55 added (imports + constants + helper + 2 tests), 0 deleted
**Risk level:** low — test-only change; no production logic touched
**Testing required:** `npm run test:doc-coverage` must pass; both new tests must turn green

**Why child-process over extract-to-pure-function:**
- Finding 2 (the `catch` path) is inherently I/O-wiring and cannot be tested without a real fs throw. A child-process approach covers both findings uniformly without splitting the test surface across two strategies.
- No changes to `coverage-summary.mjs` or `run-doc-examples.mjs` keeps this strictly within the described patch scope.

**Why `{ "paths": {} }` spec:**
- `buildSpecIndex` uses `Object.keys(spec.paths ?? {})`. An empty `paths` object makes `specIndex = []`, so `matchSpecPath` always returns `null` → every example is skipped as `spec-path-unmatched`. This gives `plan=[], skipped=[1]` → `executedPct = 0` — the simplest state that satisfies both test scenarios.

**Why a directory path for `GITHUB_STEP_SUMMARY` failure:**
- `appendFileSync(<dir>, ...)` throws `EISDIR` on all POSIX platforms. This is more reliable than a mode-0000 file, which requires root-bypass in some container environments.

## Verification
Execute every command to validate the patch is complete with zero regressions.

```
npm run test:doc-coverage
```

- All pre-existing tests must still pass (imports are additive; no existing code modified).
- The new "floor-breach emits ::warning::" test must pass (fails on pre-change code where that branch didn't exist).
- The new "GITHUB_STEP_SUMMARY appendFileSync error emits ::notice::" test must pass (fails on pre-change code where that branch didn't exist).
- `git diff --name-only` must show only `scripts/run-doc-examples.coverage.test.mjs`.

## Known Limitations / Follow-ups
- The integration tests do not verify `exit(0)` is returned (the warning is warn-only / non-gating). This is intentional — the test verifies the branch fires, not the exit code semantics, which are already covered by the existing unit tests.
- No linter / typecheck targets are defined in `package.json`; only `npm run test:doc-coverage` applies.
