# API-Reference Page ↔ Spec Reconciliation Auditor

**ADW ID:** 013f1d3d
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-274-adw-013f1d3d-add-api-reference-coverage-auditor-plan.md

## Overview

Adds a blocking auditor that reconciles the generated Mintlify endpoint pages in `api-reference/endpoint/` against the committed OpenAPI slice in `api-reference/openapi.json` in **both directions**. The existing generator only ever adds/refreshes pages for ops that currently exist in the spec — it never checks the reverse — so two kinds of drift could previously ship silently: endpoint pages pointing at ops that no longer exist (orphans), and real spec ops that have no page at all (gaps). This auditor closes that gap and fails CI on any inconsistency.

## What Was Built

- A standalone, dependency-free Node auditor (`check-api-reference-coverage.mjs`) that reconciles pages ↔ spec both ways.
- **Direction 1 — orphan detection (page → spec):** every page's `openapi: "METHOD /path"` directive must resolve to a real operation in the committed spec.
- **Direction 2 — gap detection (spec → page):** every non-excluded spec op must be covered by a directive page or an allowlisted hand-written page.
- A deliberate-exclusion model mirroring the generator's conventions: `deprecated`, `dashboard-session` (CookieAuth-only), `non-api`, and `held` buckets are classified rather than reported as gaps.
- An allowlist (`api-reference-coverage-allowlist.json`) for genuine hand-written endpoint pages that carry no generated directive, with built-in hygiene checks.
- A `--self-test` mode with 26 fixture-backed assertions covering both directions, exclusion buckets, allowlist hygiene, and the fail-closed guard.
- A new `npm run check:api-reference-coverage` script.

## Technical Implementation

### Files Modified

- `scripts/check-api-reference-coverage.mjs`: New 440-line auditor — spec/page/allowlist reading, pure two-direction reconciliation, reporting, self-test, and CLI.
- `scripts/api-reference-coverage-allowlist.json`: New allowlist mapping `METHOD /path` op keys to hand-written `.mdx` pages that document them without a generated `openapi:` directive (currently the two GDPR agent-erasure narratives).
- `package.json`: Added the `check:api-reference-coverage` npm script.

### Key Changes

- **Op classification is single-bucket and order-sensitive.** Each spec op falls into exactly one of: `held` → excluded (deprecated / dashboard-session / non-api) → covered → gap. `HELD` is checked *first* because it is not handled by the exclusion predicate; checking it later would let held ops fall through as false gaps.
- **Allowlist hygiene is enforced.** A stale entry — a key that is not a real spec op, or a mapped file that does not exist on disk — is itself a failure, so the allowlist can never silently rot. Allowlisting a genuine gap to silence the gate is explicitly disallowed.
- **Fail-closed on empty specs.** A spec with zero paths throws an error rather than passing vacuously, guarding against cold-start / mis-fetched specs greening the gate with nothing to reconcile.
- **Shared vocabulary is mirrored, not imported.** `METHODS`, `HELD`, `NON_API`, `securityString()`, and `exclusionReason()` are copied from `generate-api-reference.mjs` (which runs side-effectfully at import time) with a surfaced follow-up to extract a shared lib.
- **Offline & standardized exit contract.** Node built-ins only, reads from disk with no network; exits `0` clean, `1` on any finding or read/parse/empty-spec error, `2` on bad CLI usage — matching sibling validators.

## How to Use

1. Run the auditor from the repo root:
   ```bash
   npm run check:api-reference-coverage
   ```
2. Read the summary line, e.g. `474 ops: 468 covered, 6 excluded {…}, 0 gaps; 474 pages, 0 orphans`.
3. If it reports findings, resolve them at the source:
   - **Orphan page:** remove the stale endpoint page (or fix its directive).
   - **Uncovered op (gap):** add the missing endpoint page — do *not* allowlist it to silence the gate.
   - **Stale allowlist entry:** remove/correct the entry, or restore the mapped hand-written page.
4. Use `--verbose` to print each excluded op grouped by exclusion reason.

## Configuration

- `--openapi <path>` — override the spec path (default `api-reference/openapi.json`).
- `--endpoint-dir <path>` — override the endpoint page directory (default `api-reference/endpoint/`).
- `--allowlist <path>` — override the allowlist file (default `scripts/api-reference-coverage-allowlist.json`).
- `--verbose` — list excluded ops by reason.
- `--self-test` — run the throwaway-fixture assertions instead of auditing the repo.
- `--help` / `-h` — usage.
- The allowlist JSON's `allow` object maps `"METHOD /path"` → repo-relative `.mdx` file for hand-written directive-less pages.

## Testing

- Run the built-in fixture suite: `node scripts/check-api-reference-coverage.mjs --self-test` (26/26 assertions pass), which exercises both reconciliation directions, all exclusion buckets, allowlist hygiene (missing file and dead key), the clean-tree case, and the empty-spec fail-closed guard.
- Run against the live tree: `npm run check:api-reference-coverage` — expected to exit `0` clean, since the tree is already reconciled (the four `/admin/security/advisories` orphan pages were removed and the two GDPR pages are allowlisted).

## Notes

- CI wiring (the one-line `npm run check:api-reference-coverage` hook in `.github/workflows/mintlify-ci.yml`) is intentionally *not* included in this change; that NEVER-AUTO path lands separately in the consolidated operator PR.
- The mirrored generator constants are duplicated deliberately and surfaced as a follow-up: once `generate-api-reference.mjs` exposes its exclusion vocabulary without executing at import time, both should consume a shared `scripts/lib/api-reference-exclusions.mjs`.
- The auditor is blocking from day one — it exits `1` on any orphan, gap, or stale-allowlist entry, so genuine drift cannot be merged without an explicit, reviewable fix.
