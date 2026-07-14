# Live Doc-Example Executor Coverage Reporting

**ADW ID:** 0abbd3ce
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-380-adw-0abbd3ce-report-live-executor-coverage-plan.md

## Overview

The nightly doc-examples job runs curl examples pulled from the docs against the
staging API, but most examples are skipped (write ops, missing fixtures,
unresolved placeholders) so very few are actually executed live. This feature
adds a **live-executor coverage report** — the percentage of matched doc
examples actually executed versus skipped, broken down by skip reason — so a
silent regression toward zero real execution becomes visible in the job output
rather than passing unnoticed.

## What Was Built

- A pure coverage-aggregation module that turns the executor's `plan`
  (executed) and `skipped` lists into an executed / skipped-by-reason /
  executed% summary.
- A closed skip-reason vocabulary (`spec-path-unmatched`,
  `write-op-not-allowlisted`, `needs-fixture`, `unresolved-placeholder`) with a
  fail-closed guard: an unclassified skip cause throws rather than being
  silently absorbed.
- Plain-text (stdout) and GitHub-flavored-markdown (job summary) renderers for
  the coverage summary, emitted on every run.
- An optional, **warn-only** coverage floor (`--min-executed-pct` flag or
  `MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT` env var) that emits a `::warning::`
  on breach but never fails the run. Using a GitHub repo variable requires
  operator workflow wiring — see Configuration.
- Wiring of the coverage summary into `$GITHUB_STEP_SUMMARY` in the nightly
  workflow, plus a dedicated test suite and npm test script.

## Technical Implementation

### Files Modified

- `scripts/lib/coverage-summary.mjs` (new): Pure, side-effect-free coverage
  core — `SKIP_REASON_CLASSES` vocabulary, `buildCoverageSummary`,
  `renderCoverageText`, and `renderCoverageMarkdown`. No network, no I/O, no
  `process`/`Date.now`/`Math.random`.
- `scripts/run-doc-examples.mjs`: Tags each skipped example with a
  `reasonClass`, parses/validates the `--min-executed-pct` flag and env
  fallback, and prints the coverage summary to stdout / appends markdown to
  `$GITHUB_STEP_SUMMARY` on every run (before the dry-run / empty-plan exits).
- `scripts/run-doc-examples.coverage.test.mjs` (new): Regression suite driving
  the coverage core with fixture `plan`/`skipped` arrays.
- `package.json`: Adds the `test:doc-coverage` script.

### Key Changes

- **`executed% = executed / (executed + skipped)`** where `executed` equals the
  planned count (in a live run, planned === attempted). Grouping is by a fixed
  `reasonClass` enum tagged at skip time, not by parsing the human-readable
  reason string.
- **Cold-start safety:** with zero matched examples, `executedPct` is `null`
  (rendered as "N/A" / "0 doc examples found") — never a divide-by-zero or a
  false 0%.
- **Fail-closed classification:** `buildCoverageSummary` throws on an unknown
  `reasonClass`, forcing any new skip cause to be classified explicitly.
- **Warn-only floor:** a breach uses strict less-than, never trips on cold
  start or when unset, and emits `::warning::` without changing the exit code —
  the run's real pass/fail verdict (assertion failures) still governs it.
- **Floor resolution order:** `--min-executed-pct` flag > env var > unset;
  empty/whitespace values are treated as unset, and only a non-empty
  non-numeric / out-of-range value is a config error (exit 2).
- **Fail-soft reporting:** a `$GITHUB_STEP_SUMMARY` write error emits a
  `::notice::` but does not fail the executor (stdout is the primary signal).

## How to Use

1. Run the executor as usual: `node scripts/run-doc-examples.mjs --verbose`.
   The coverage summary is printed to stdout on every run and appended to the
   GitHub job summary when running in CI.
2. To enforce a warn-only floor locally, pass
   `--min-executed-pct 20` (0–100). In CI, set the
   `MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT` repo variable — a breach surfaces as
   a `::warning::` annotation.
3. Read the coverage line (`Coverage: X/Y executed (Z%)`) and the per-reason
   skip counts to see why examples were skipped and whether live execution is
   regressing.

## Configuration

- `--min-executed-pct <n>` — CLI flag; warn-only coverage floor (0–100).
- `MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT` — env var fallback for the floor;
  empty/unset means no floor (no silent failure). **Note:** GitHub Actions repo
  variables are NOT auto-exposed as env vars. To drive the floor from a repo
  variable an operator must add
  `MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT: ${{ vars.MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT }}`
  to the `env:` block of the "Execute safe doc examples" step in
  `doc-examples-live.yml`. That one-line workflow edit is intentionally left to
  the operator (editing `.github/workflows/**` is a NEVER-AUTO path). Until
  wired, set the floor via the `--min-executed-pct` CLI flag.
- `--include-writes` — existing flag; opts write ops into the executable plan
  (which raises coverage), gated by the `WRITE_ALLOWLIST`.

## Testing

- Coverage core unit tests: `npm run test:doc-coverage`
  (`node --test scripts/run-doc-examples.coverage.test.mjs`). Covers the mixed
  case, cold start, all-skipped/zero-executed, strict floor boundary, full skip
  vocabulary, the fail-closed unknown-class guard, and both renderers.
- Run the executor in dry-run to see the same coverage summary a live run
  would produce without issuing requests:
  `node scripts/run-doc-examples.mjs --dry-run`.

## Notes

- The coverage floor is intentionally **warn-only**: a near-100%-skip ratio is
  the expected baseline today, so a breach is a regression *signal*, not a gate.
- The skip-reason vocabulary is a closed set; adding a new skip cause requires
  adding a matching `SKIP_REASON_CLASSES` entry, or `buildCoverageSummary` will
  throw by design.
- The summary is emitted on every run that reaches planning; the workflow's
  preflight gate skips token-less runs, so there is no un-summarized run.
