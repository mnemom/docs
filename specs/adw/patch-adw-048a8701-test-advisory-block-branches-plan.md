# Spec — Patch: Test advisory block's untested branches in check-doc-examples

- **Status:** Draft
- **Branch:** feature-issue-278-adw-048a8701-detect-committed-slice-drift-vs-live-spe
- **Location:** `scripts/check-doc-examples.mjs`, `scripts/check-slice-freshness.test.mjs`
- **Related docs:** specs/docs-validators-health.md

## Problem / Objective
**Original Spec:** specs/docs-validators-health.md
**Issue:** The advisory block added to `scripts/check-doc-examples.mjs` (lines 398–415) has three code paths — the happy path (diffSlices + emit summary line), the `else` branch when `spec.paths` is empty (logs `"committed-slice vs live: skipped — live spec has no paths"`), and the `catch` block (logs `"committed-slice vs live: skipped — ${err.message}"`). Neither the `else` branch nor the `catch` block is covered by any test.
**Solution:** Add two lightweight integration tests to `scripts/check-slice-freshness.test.mjs` that spawn `check-doc-examples.mjs` with a minimal scope and controlled env vars. To make the `catch` branch reachable from outside the process, add a one-line `COMMITTED_SLICE_PATH` env override to the `readFileSync` call in the advisory block.

## Approach & Changes
### Files to Modify
- `scripts/check-doc-examples.mjs` — 3-line change: add `process.env.COMMITTED_SLICE_PATH` env override to the `readFileSync` call so tests can redirect the committed-slice read without touching the real file
- `scripts/check-slice-freshness.test.mjs` — append ~35 lines: `DOC_EXAMPLES_CLI` constant, `runDocExamplesCli` helper, and two test cases

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `COMMITTED_SLICE_PATH` env override in `check-doc-examples.mjs`

In the advisory block (around line 399), change:

```javascript
  const committedSlice = JSON.parse(
    readFileSync(new URL("../api-reference/openapi.json", import.meta.url), "utf8"),
  );
```

to:

```javascript
  const committedSlice = JSON.parse(
    readFileSync(
      process.env.COMMITTED_SLICE_PATH || new URL("../api-reference/openapi.json", import.meta.url),
      "utf8",
    ),
  );
```

- `readFileSync` accepts both a string path and a WHATWG URL object in Node.js ≥ 7.6, so no extra import is needed.
- `process` is already in scope (used at line 53 and line 97).
- When `COMMITTED_SLICE_PATH` is unset (normal production runs), behavior is identical to before.

### Step 2: Add two test cases to `check-slice-freshness.test.mjs`

Append at the end of `scripts/check-slice-freshness.test.mjs`:

```javascript
// ── Advisory block branches in check-doc-examples.mjs ──────────────────
// These exercise the two untested skip paths of the committed-slice
// advisory block. They spawn the real script with an empty --scope (zero
// MDX files, fast exit) and env-var overrides to steer the two branches.

const DOC_EXAMPLES_CLI = fileURLToPath(new URL("./check-doc-examples.mjs", import.meta.url));

// Minimal helper: spawn check-doc-examples with controlled inputs.
// liveSpecPath  → OPENAPI_SPEC_PATH  (what loadSpec() reads)
// committedSlicePath → COMMITTED_SLICE_PATH (what the advisory readFileSync reads)
// scope         → --scope flag (pass an empty dir to skip all MDX validation)
function runDocExamplesCli({ liveSpecPath, committedSlicePath, scope }) {
  const env = { ...process.env };
  if (liveSpecPath) env.OPENAPI_SPEC_PATH = liveSpecPath;
  if (committedSlicePath) env.COMMITTED_SLICE_PATH = committedSlicePath;
  const r = spawnSync("node", [DOC_EXAMPLES_CLI, "--scope", scope], {
    encoding: "utf8",
    env,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

test("advisory block in check-doc-examples: else branch — logs skip when live spec has no paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-examples-advisory-"));
  try {
    const emptyPathsSpec = join(dir, "empty-paths.json");
    writeFileSync(
      emptyPathsSpec,
      JSON.stringify({ openapi: "3.1.0", info: { title: "t", version: "1" }, paths: {} }),
    );
    const r = runDocExamplesCli({ liveSpecPath: emptyPathsSpec, scope: dir });
    // Advisory block must not crash the script; gate continues to exit 0.
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
    assert.match(
      r.stdout,
      /committed-slice vs live: skipped — live spec has no paths/,
      "expected skip message for empty live spec paths",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("advisory block in check-doc-examples: catch branch — logs skip when committed slice is unreadable", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-examples-advisory-"));
  try {
    const missingSlice = join(dir, "no-such-committed-slice.json");
    // OPENAPI_SPEC_PATH → the real committed spec so spec.paths is non-empty
    // (ensures we reach the readFileSync call rather than the else branch).
    const r = runDocExamplesCli({
      liveSpecPath: COMMITTED,
      committedSlicePath: missingSlice,
      scope: dir,
    });
    // Catch block must not propagate — script exits 0 (advisory, non-failing).
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
    assert.match(
      r.stdout,
      /committed-slice vs live: skipped — /,
      "expected skip message from catch block",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- `fileURLToPath`, `spawnSync`, `mkdtempSync`, `rmSync`, `writeFileSync`, `tmpdir`, `join`, and `COMMITTED` are all already imported/defined at the top of `check-slice-freshness.test.mjs`.

## Key Decisions & Rationale
**Lines of code to change:** ~38 added (3 in check-doc-examples.mjs, ~35 in test file)
**Risk level:** low
**Testing required:** `npm run test:slice-freshness` must stay green; the two new tests must pass

The `COMMITTED_SLICE_PATH` env override is the minimal seam needed to reach the `catch` branch from a subprocess. It follows the same pattern as `OPENAPI_SPEC_PATH` / `--spec-path` used throughout this suite. It has no effect in production (env var is absent during normal CI runs).

Spawning with `--scope <empty-tmp-dir>` means zero MDX files are walked, so Ajv and the spec index are never exercised — the tests complete quickly and focus exclusively on the advisory block paths.

## Verification
Execute every command to validate the patch is complete with zero regressions.

```sh
# Run the existing slice-freshness suite (includes the two new tests)
npm run test:slice-freshness

# Quick smoke-check that the advisory block still works in the normal path
# (OPENAPI_SPEC_PATH points to the committed file so no network needed)
OPENAPI_SPEC_PATH=api-reference/openapi.json node scripts/check-doc-examples.mjs --scope /tmp 2>&1 | grep "committed-slice vs live:"
```

The second command should print the summary line (not a skip), confirming the production path is unaffected.

## Known Limitations / Follow-ups
- The happy path (diffSlices + emit line) is already exercised indirectly by the existing `check-slice-freshness.test.mjs` CLI tests and by the `diffSlices` unit tests; no additional test for that branch is needed.
- `test:doc-examples` is not added as a dedicated package.json script — the two new cases run under the existing `npm run test:slice-freshness` command, keeping the change minimal.
