# Spec Leakage Gate for Staff Paths in check-doc-examples

**ADW ID:** a675ff9e
**Date:** 2026-06-24
**Plan-Spec:** /home/runner/work/docs/docs/agents/a675ff9e/plan/issue-287-adw-a675ff9e-gate-the-staff-prefixes-staff-paths-mirr-plan.md

## Overview

This feature adds a hard early-exit guard to `check-doc-examples.mjs` that asserts the live OpenAPI spec served to the doc-checker contains no staff or internal API paths. If the server-side filter (`buildCustomerFacingSpec`) leaks any staff path into the spec, the script refuses to run (exit code 2) rather than silently producing misleading drift results against endpoints that should never be customer-facing.

## What Was Built

- A spec-leakage gate block inserted immediately after `loadSpec()` in `check-doc-examples.mjs`
- Coverage of both `STAFF_PREFIXES` (prefix-based, e.g. `/admin/`, `/arena/`, `/internal/`) and `STAFF_PATHS` (exact-path set, e.g. `/health`, `/billing/webhooks/stripe`) via the existing `isStaffPath()` predicate
- A descriptive `stderr` error message naming every leaked path and referencing ADR-054
- Exit code `2` to distinguish this class of failure from normal drift failures

## Technical Implementation

### Files Modified

- `scripts/check-doc-examples.mjs`: Added 20-line spec-leakage gate block (AC2) after `loadSpec()`, before the Ajv/dereferencer setup

### Key Changes

- After `const spec = await loadSpec()`, the new gate runs `Object.keys(spec.paths || {}).filter(isStaffPath)` to find any staff paths that escaped server-side filtering
- If any leaked paths are found, writes a diagnostic message to `stderr` (including the leaked path names and the ADR-054 reference) and calls `exit(2)`
- Reuses the already-defined `isStaffPath()` function and `STAFF_PREFIXES`/`STAFF_PATHS` constants — no new mirror of those constants is introduced
- The gate is stronger than the regex-only leakage check in `sync-openapi.mjs`; this one covers both prefix-based and exact-path staff surface, and is the canonical check satisfying AC2
- Runs before any doc-example validation so a leaked staff path cannot produce false drift reports

## How to Use

The gate is automatic — no invocation changes are needed. Run the script as normal:

```sh
node scripts/check-doc-examples.mjs
```

If the served spec is clean (no staff paths), the script proceeds normally. If a staff path leaks through the server filter, the script exits immediately with:

```
check-doc-examples: refusing — staff/internal path(s) present in the served spec (server filter gap, ADR-054): /admin/example, ...
```

Exit code `2` signals a spec-integrity failure (as opposed to a doc-drift failure).

## Configuration

No new configuration. The staff surface definition lives in two constants near the top of `scripts/check-doc-examples.mjs`:

- `STAFF_PREFIXES` — prefix-based namespaces: `/admin/`, `/arena/`, `/internal/`, `/v1/internal/`, `/sonar/`, `/rb2b/`
- `STAFF_PATHS` — exact paths: `/auth/send-email-hook`, `/billing/webhooks/stripe`, `/contact/notify`, `/on-chain/anchor-root`, `/on-chain/publish-scores`, `/health`

These mirror `mnemom-api openapi/customer-facing.ts`; update both files together whenever the staff surface changes.

## Testing

Run the script against a spec that contains a known staff path (e.g. set `OPENAPI_SPEC_PATH` to a fixture that includes `/admin/foo`) and confirm it exits with code `2` and the expected `stderr` message. Against a clean spec it should proceed normally and produce no new failures.

## Notes

- `sync-openapi.mjs` has a related but weaker regex-only gate that covers only prefix-based staff paths; this gate is the canonical, stronger check (AC2).
- The gate fires before Ajv setup and any per-endpoint validation, keeping the fast-fail cost minimal.
