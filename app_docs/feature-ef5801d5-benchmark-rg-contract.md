# Benchmark Harness RG Contract Specification

**ADW ID:** ef5801d5
**Date:** 2026-08-16
**Plan-Spec:** agents/ef5801d5/plan/issue-452-adw-ef5801d5-frozen-contract-rg-driver-plan.md

## Overview

This feature adds a single normative specification page (`specifications/benchmark-rg-contract.mdx`) that documents the frozen L1 contract obligations from the benchmark harness to the Research Grade (RG) driver. The page captures the `benchmark_results` row schema, the `harness_ledger` row schema including the new `outcome` field landed in MNE-5703, the `benchmark_snapshots` manifest format, and the six isolation guarantees the harness provides — giving Shraddha's RG driver team (MNE-5539..5545) a stable, version-controlled reference that removes the dependency on harness authors being available.

## What Was Built

- `specifications/benchmark-rg-contract.mdx` — new 192-line normative spec page with four major sections
- Navigation wiring in `docs.json` — page added to the Specifications nav group
- Nav-coverage allowlist update in `scripts/nav-coverage-allowlist.json` — ef5801d5 agent files excluded from the orphaned-file check

## Technical Implementation

### Files Modified

- `specifications/benchmark-rg-contract.mdx`: New file. Four normative sections: results schema (`benchmark_results` column table), ledger schema (`harness_ledger` column table + status-transition diagram + status-vs-outcome comparison + outcome enum table with RG incorporation rule), snapshot manifest format (annotated `jsonc` block + 13-field reference table), and isolation guarantees (six numbered invariants + explicit non-guarantees).
- `docs.json`: Appended `"specifications/benchmark-rg-contract"` to the `"Specifications"` nav group `pages` array after `"specifications/threat-state-response-schema"`.
- `scripts/nav-coverage-allowlist.json`: Added `agents/ef5801d5/design_review/advisories.md` and `agents/ef5801d5/plan/issue-452-adw-ef5801d5-frozen-contract-rg-driver-plan.md` to the allowlist so the nav-coverage gate ignores the agent-internal files.
- `.adw-current-phase`: Phase marker updated by the ADW harness (metadata only).

### Key Changes

- The `outcome` field on `harness_ledger` (added in MNE-5703) is now documented: six enum values (`pass`, `fail`, `error`, `inconclusive`, `timeout`, `aborted`), the distinction from `status` and from per-suite `verdict` in `benchmark_results`, and the RG driver incorporation rule (`outcome IN ('pass','fail')`).
- The `benchmark_results` table documents 13 columns with types, CHECK constraints, and a cross-reference note for `verdict` vs `harness_ledger.outcome`.
- The snapshot manifest is documented as an annotated `jsonc` block covering all 13 fields, with a stability note that `schema_version` v1 is frozen for the current harness major version.
- Six isolation invariants are enumerated (namespace, credential, network, deterministic replay, clean-room teardown, clock monotonicity) alongside four explicit non-guarantees (run ordering, retry behaviour, score stability across harness versions, `trust_rating_at_capture` accuracy).
- All internal links use absolute paths (e.g., `/concepts/reputation-scores`, `/specifications/transparency-log-schema`); no runnable `curl` examples are included.

## How to Use

1. Navigate to the **Specifications** section in the docs sidebar.
2. Open **Benchmark RG Contract** (or go directly to `/specifications/benchmark-rg-contract`).
3. To determine whether to incorporate a harness run into the RG dataset, read `harness_ledger.outcome` for the relevant `(agent_id, benchmark_id)` pair and apply the rule: incorporate only when `outcome = 'pass' OR outcome = 'fail'`.
4. To verify a run's environment conditions, resolve `harness_ledger.snapshot_ref` → `benchmark_snapshots.snapshot_id` and compare the manifest fields against the expected card versions and posture revision.
5. To understand lifecycle state independently of business result, use `harness_ledger.status` (transition diagram is in the spec); use `harness_ledger.outcome` only once `status` reaches a terminal value.

## Configuration

No configuration changes. The page is a pure content addition; no environment variables, feature flags, or service configuration are required.

## Testing

Run these commands from the repo root to verify the addition with zero regressions:

```bash
npm run check:redirects           # confirms no redirect is needed for the new path
npm run check:nav-pages           # confirms docs.json entry has a matching .mdx file
npm run check:nav-coverage        # confirms the new .mdx is reachable from navigation
npx mintlify broken-links         # validates all internal links in the new page resolve
npm run check:doc-examples        # passes (page has no runnable curl examples)
```

Note: this repo has no `typecheck`, `test`, or `build` npm scripts — Mintlify is the build system and runs server-side. The above checks are the complete local verification surface.

## Notes

- The `outcome` enum values match MNE-5703 as merged. If the harness team extends the enum in a future minor version, this page must be updated before the RG driver cutover.
- `benchmark_results.component_scores` keys are suite-specific and are not enumerated here; a follow-up spec can document per-suite component schemas.
- `trust_rating_at_capture` lag is documented as "up to the recompute interval" — the exact interval is owned by the trust-rating service. A TODO comment in the spec marks where the SLO link should be added once that page is published.
- No new redirect entry is needed; this is a new path with no prior location.
