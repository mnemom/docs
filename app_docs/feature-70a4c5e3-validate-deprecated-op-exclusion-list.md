# Validate the Deprecated-Op Exclusion List

**ADW ID:** 70a4c5e3
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-382-adw-70a4c5e3-validate-deprecated-op-exclusion-list-plan.md

## Overview

The API reference is generated from a committed OpenAPI slice, but the decision of *which* ops get published — and which are excluded as deprecated, dashboard-session-only, or non-API — was previously invisible: an upstream op flipping `deprecated: true` (or a `CookieAuth` change) would silently add or drop pages with no reviewed signal. This feature adds a `--report` mode to `scripts/generate-api-reference.mjs` that emits a deterministic **coverage manifest** classifying every spec operation, commits it as `api-reference/.coverage-manifest.json`, and gates it in CI so any drift in the deprecated-op exclusion list (or any other bucket) surfaces as a required, reviewed diff.

## What Was Built

- A `--report` flag on `scripts/generate-api-reference.mjs` that classifies every operation in the committed OpenAPI spec into `generated`, `excluded` (`deprecated` / `dashboard-session` / `non-api`), or `held`, and writes a stable, sorted JSON manifest.
- The committed coverage manifest `api-reference/.coverage-manifest.json` (462 generated, 26 deprecated-excluded, 6 dashboard-session, 2 non-api, 2 held at time of writing).
- A CI gate in the OpenAPI freshness workflow that regenerates the manifest and fails the build if the committed copy is stale — making every change to what's published or excluded an explicit, reviewable delta.

## Technical Implementation

### Files Modified

- `scripts/generate-api-reference.mjs`: Added the `--report` code path that recomputes classification from the spec alone (`HELD` set + `exclusionReason()`), builds a `{generated, excluded: {dashboard-session, deprecated, non-api}, held}` manifest, sorts every bucket for deterministic output, writes it to `api-reference/.coverage-manifest.json`, and prints per-bucket counts to stderr. The block short-circuits and `process.exit(0)`s *before* the endpoint-file scan, since classification needs only the spec.
- `api-reference/.coverage-manifest.json`: New committed manifest — the source-of-truth snapshot the CI gate diffs against.
- `.github/workflows/openapi-freshness.yml`: Added `.coverage-manifest.json` and `generate-api-reference.mjs` to the `pull_request` path triggers, a step that runs `--report`, and an assertion step that fails if the regenerated manifest differs from the committed one.

### Key Changes

- Classification is derived purely from the spec: `exclusionReason()` returns `"deprecated"` for `op.deprecated`, `"dashboard-session"` for `CookieAuth`-only ops (no `ApiKeyAuth`/`BearerAuth`/`LicenseJwtAuth`/`AgentAuth`), and `"non-api"` for the `NON_API` website-surface set; anything left over is `generated`. Ops in the `HELD` set are bucketed as `held`.
- Output is fully deterministic — every bucket array is sorted and the file ends with a trailing newline — so an unchanged spec always regenerates a byte-identical manifest, and `git diff --exit-code` is a reliable staleness signal.
- The `--report` short-circuit was moved ahead of the endpoint-`.mdx` scan and the `--check` (orphan-drift) path, so report generation never touches the filesystem beyond the spec and the manifest.
- CI now runs `node scripts/generate-api-reference.mjs --report` and asserts `git diff --exit-code api-reference/.coverage-manifest.json`, turning a silent exclusion-list change into a required, failing check with a clear remediation message.

## How to Use

1. Regenerate the manifest after any OpenAPI spec change:
   ```bash
   node scripts/generate-api-reference.mjs --report
   ```
2. Review the resulting diff in `api-reference/.coverage-manifest.json`. A new entry under `excluded.deprecated` means an op was newly marked deprecated upstream; a removed `generated` entry means a page will stop being published.
3. Commit the updated manifest alongside the spec refresh. The full refresh sequence is:
   ```bash
   node scripts/sync-openapi.mjs \
     && node scripts/generate-api-reference.mjs \
     && node scripts/generate-api-reference.mjs --report
   ```
4. Open the refresh PR. CI validates the manifest is up-to-date; a stale manifest fails the **OpenAPI freshness** workflow with instructions to rerun `--report` and commit.

## Configuration

No environment variables or settings. Behavior is controlled by three CLI flags on `scripts/generate-api-reference.mjs`:

- `--report` — write the coverage manifest (this feature)
- `--dry-run` — report projected pages only, write nothing
- `--check` — orphan-drift audit (advisory)

The manifest path is fixed at `api-reference/.coverage-manifest.json`. Exclusion behavior is governed by the in-script `HELD` set, `NON_API` set, and `exclusionReason()`.

## Testing

- Run the report and confirm no diff on a clean tree: `node scripts/generate-api-reference.mjs --report && git diff --exit-code api-reference/.coverage-manifest.json`.
- Verify determinism by running `--report` twice and confirming the file is byte-identical.
- The CI gate lives in `.github/workflows/openapi-freshness.yml`; it triggers on changes to `api-reference/openapi.json`, `api-reference/.coverage-manifest.json`, `scripts/sync-openapi.mjs`, and `scripts/generate-api-reference.mjs`.
- Repo-wide doc validators (e.g. `npm run check:deprecation-coverage`, `check:nav-coverage`, `check:links`) remain the surrounding safety net for reference-page integrity.

## Notes

- The manifest is a snapshot of *classification intent*, not a second source of truth — it is always regenerated from the committed OpenAPI slice, so it can never drift from the spec without CI catching it.
- Counts at time of writing: 462 generated, 26 deprecated-excluded, 6 dashboard-session-excluded, 2 non-api-excluded, 2 held.
- The gate does not auto-commit; a human reviews the spec delta and the manifest delta and regenerates. The final decision about publishing or excluding an op remains a human, reviewed action.
