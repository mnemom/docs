# Persist Link-Health Metrics Over Time (Broken-Percent Trend)

**ADW ID:** 32288566
**Date:** 2026-07-14
**Plan-Spec:** agents/32288566/plan/issue-334-adw-32288566-persist-link-health-metrics-plan.md

## Overview

The existing `link-health-report.mjs` renders an advisory, per-group broken-link percentage table to the GitHub step summary on every run — but that table is ephemeral and vanishes with the job, so there is no way to answer "is link rot getting worse over time?". This feature adds an append-only, machine-readable **trend artifact**: a new `link-health-metrics.mjs` script that reuses the same link-health core and appends one dated JSON row per run to `metrics/link-health.jsonl`, enabling a broken-% trend to be tracked across scheduled runs.

## What Was Built

- A new observability-only CLI, `scripts/link-health-metrics.mjs`, that computes internal-link health for the docs tree and appends one dated JSON row to a JSONL trend file.
- Reuse of the **same** `computeLinkHealth(root)` core from `link-health-report.mjs` (imported verbatim) so the trend row can never disagree with the advisory table — single source of truth.
- Strict write-time invariant checks (`assertRowInvariants`) that make the write path **fail closed**: any inconsistency or scan error exits non-zero so a scheduled run never commits corrupt/misleading data.
- A comprehensive unit test suite, `scripts/link-health-metrics.test.mjs` (15 tests) covering row shaping, rounding, invariants, empty-tree/divide-by-zero handling, and append/cold-start behavior.
- A new `check:link-health` npm script wired into `package.json`.
- A guard on `link-health-report.mjs` so its `main()` runs only when invoked directly, allowing sibling scripts to import `computeLinkHealth` without triggering a scan/exit.

## Technical Implementation

### Files Modified

- `scripts/link-health-metrics.mjs` (new, 234 lines): the trend CLI plus exported pure helpers `round1`, `buildRow`, `assertRowInvariants`, and `appendRow`.
- `scripts/link-health-metrics.test.mjs` (new, 187 lines): `node --test` unit suite for the helpers.
- `scripts/link-health-report.mjs` (+7 lines): entrypoint guard so `main()` only runs when the file is invoked directly, making `computeLinkHealth` safely importable.
- `package.json` (+1 line): added `"check:link-health": "node scripts/link-health-metrics.mjs"`.

### Key Changes

- **Row shape** — `buildRow` produces `{ date, generated_at, total_links, broken, pct, by_group: { <group>: { total, broken, pct } } }`. `date` (YYYY-MM-DD, UTC) is the daily trend key; `generated_at` is a full ISO-8601 millisecond timestamp so two consecutive runs yield two distinct rows.
- **Consistent rounding** — `round1` (round to 1 decimal) is shared by `buildRow` and `assertRowInvariants` so the write-time percentage invariant is a strict equality with no last-ULP drift on repeating-decimal ratios.
- **Fail-closed invariants** — `assertRowInvariants` enforces non-negative integer counts, `broken <= total`, per-group counts summing to top-line totals, each group's `pct` matching its own counts, an exact top-line `pct` (0 on an empty tree, no divide-by-zero), and valid `date`/`generated_at` formats.
- **Cold-start-safe append** — `appendRow` creates the parent directory and file if absent, then appends the row as a single JSONL line.
- **Node built-ins only** — no `npm ci` required; sibling to `link-health-report.mjs` / `check-links-local.mjs`.

## How to Use

1. Dry run (compute + validate + print the row JSON, no write):
   ```bash
   npm run check:link-health -- --print
   ```
2. Append a row to the default trend file (`metrics/link-health.jsonl` at repo root):
   ```bash
   npm run check:link-health
   ```
3. Optional overrides:
   ```bash
   node scripts/link-health-metrics.mjs --file <path> --root <docs-tree> --date YYYY-MM-DD
   ```
4. Inspect the accumulated trend by reading the JSONL file — each line is one dated row; downstream tooling can chart `pct` (overall and `by_group`) over `date`.

## Configuration

CLI flags (see `--help`):

- `--print` — dry run; compute, validate, and print the row JSON to stdout without writing. Takes precedence over `--file`.
- `--file <path>` — output JSONL path (default: `metrics/link-health.jsonl` at repo root).
- `--root <path>` — docs tree to scan (default: repo root).
- `--date <YYYY-MM-DD>` — override the trend date (default: today, UTC).
- `-h`, `--help` — show usage.

Operational notes: the script is intended for **scheduled (non-PR) runs only**. The row is meant to be committed to a dedicated `metrics` branch by a separately-authored, operator-owned workflow — never to `main` (Mintlify auto-deploys on push to `main`, so keeping the trend off `main` avoids deploy noise). `.github/workflows/**` is a never-auto path; the ready-to-paste workflow YAML lives in the PR description, not in this change. The JSONL artifact is data, not an MDX page, and is never rendered by Mintlify.

## Testing

- **Unit tests:** `node --test scripts/link-health-metrics.test.mjs` — 15 tests covering `round1` rounding, `buildRow` shaping, invariant pass/fail cases (broken > total, mismatched group sums, inconsistent pct, malformed date/timestamp), empty-tree divide-by-zero safety, and append-only / cold-start file creation.
- **Manual smoke test:** `npm run check:link-health -- --print` to validate the row without writing.
- Standard repo checks (lint / link-health advisory report via `npm run link-health-report`) remain unaffected.

## Notes

- This is a safe-additive, observability-only change: no product behavior, no API contract, and no user-facing UX surface.
- Unlike the always-exit-0 advisory report, this write path fails closed — any invariant violation or scan error exits non-zero so a scheduled run never persists misleading data.
- The trend file is append-only; historical rows are never rewritten, so the artifact is a durable time series suitable for charting link rot per group over time.
