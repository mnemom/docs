# Live Doc-Example Executor Coverage Report

**ADW ID:** 35e633a6
**Date:** 2026-07-15
**Plan-Spec:** specs/adw/issue-380-adw-35e633a6-report-live-executor-coverage-plan.md

## Overview

The live doc-example executor (`run-doc-examples.mjs`) discovers every safe-to-run `curl` example in the docs, then runs only the subset it can (skipping examples that need fixtures, are write operations, or contain unresolved placeholders). A high skip rate silently erodes the value of the live check without ever failing it. This feature reports **executor coverage** — the share of discovered examples the executor actually runs — in every run, and adds an opt-in `--min-executed-pct` floor that turns that report into a CI gate.

## What Was Built

- A pure helper module (`scripts/lib/executor-coverage.mjs`) that computes executor coverage, parses/validates the CLI floor, groups skip reasons, and renders a Markdown summary.
- Coverage reporting wired into `run-doc-examples.mjs`: every run prints coverage to stdout and appends a Markdown table to `$GITHUB_STEP_SUMMARY` (or stdout under `--verbose`).
- A new `--min-executed-pct N` CLI flag that gates the run — coverage below `N` exits non-zero. Defaults to `0` (report-only, non-blocking).
- A "Skipped by reason" breakdown that groups skip categories (missing fixtures, write ops, unresolved placeholders) so erosion is diagnosable at a glance.
- A regression suite (`scripts/run-doc-examples.test.mjs`) covering the pure helpers and the CLI flag contract, plus a `test:doc-examples` npm script.

## Technical Implementation

### Files Modified

- `scripts/lib/executor-coverage.mjs` (new): Pure, I/O-free helpers — `parseMinExecutedPct`, `computeExecutorCoverage`, `coverageFloorMet`, `summarizeSkipReasons`, and `renderCoverageSummary`. No `process`/`env` reads, so the floor policy stays CLI-only and the helpers are directly unit-testable.
- `scripts/run-doc-examples.mjs`: Added `--min-executed-pct` parsing (with a usage-error `exit(2)` for a missing/blank/invalid value), computed coverage from the executed `plan` vs `skipped` split, appended the rendered summary to `$GITHUB_STEP_SUMMARY`, and added a fail-closed `exit(1)` when coverage falls below the floor.
- `scripts/run-doc-examples.test.mjs` (new): Two-layer suite — pure-helper unit tests (CLI-value contract, cold-start zero-divide edge, floor comparison, summary shape) plus network-free end-to-end CLI tests driven through `child_process`.
- `package.json`: Added the `test:doc-examples` script (`node --test scripts/run-doc-examples.test.mjs`).

### Key Changes

- **Coverage = executed / discovered**, where `discovered = executed + skipped`, rounded to 1 decimal place via a shared `round1` so the reported percentage and the floor comparison see the identical value.
- **Cold-start fails closed**: when nothing is discovered (`discovered === 0`), coverage is defined as `0%`, not `100%` — an empty run trips any positive floor instead of silently reporting full coverage.
- **Floor is CLI-only, never an env var.** `$GITHUB_STEP_SUMMARY` is treated strictly as an output destination, not a policy input.
- **Plan-time property**: coverage is computed before execution, so it is reported and gated in every mode — including `--dry-run`, making `--dry-run --min-executed-pct N` a fast, token-free, network-free PR gate.
- **Skip reasons are grouped** on the text before the first colon, keeping the breakdown to a handful of stable categories rather than one row per unique placeholder.

## How to Use

1. Run the executor as usual to see coverage reported (report-only, never fails on coverage):
   ```bash
   node scripts/run-doc-examples.mjs --verbose
   ```
2. Read the `Executor coverage: X/Y discovered example(s) executable (Z%)` line on stdout, or the "Live doc-example executor coverage" table in the GitHub Actions step summary.
3. To enforce a minimum, pass a floor. Coverage below it exits non-zero:
   ```bash
   node scripts/run-doc-examples.mjs --min-executed-pct 25
   ```
4. For a fast PR gate that never touches the network, combine with `--dry-run`:
   ```bash
   node scripts/run-doc-examples.mjs --dry-run --min-executed-pct 25
   ```

## Configuration

- `--min-executed-pct N` — coverage floor as a percentage in `[0, 100]`. Omitted → `0` (report-only). A missing, blank, non-numeric, or out-of-range value is a usage error (`exit 2`). **CLI-only — never read from the environment.**
- `$GITHUB_STEP_SUMMARY` — when set (as in GitHub Actions), the Markdown coverage summary is appended to this file; otherwise it prints to stdout under `--verbose`. This is an output destination only.
- Existing flags (`--scope`, `--dry-run`, `--include-writes`, `--staging-base`, `--verbose`) are unchanged.

## Testing

- Run the new suite: `npm run test:doc-examples` (or `node --test scripts/run-doc-examples.test.mjs`).
- The suite has two layers: pure-helper unit tests (no scan, no network) and end-to-end CLI flag-contract tests driven via `child_process` that resolve before any network call.
- Coverage exit codes: `0` (no assertion failures and coverage meets the floor), `1` (an executed call failed assertion **or** coverage fell below `--min-executed-pct`), `2` (usage/configuration error).

## Notes

- The floor defaults to `0`, so the executor remains non-blocking on coverage until a floor is explicitly opted into — introducing the report cannot break existing CI.
- Test fixtures use counts and opaque skip strings only — no credential-shaped values (per MNE-339).
- Coverage measures whether examples are *executed live*, not whether they *pass*; assertion outcomes remain a separate signal on the same run.
