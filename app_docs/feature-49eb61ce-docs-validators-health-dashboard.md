# Docs Validators Health Dashboard

**ADW ID:** 49eb61ce
**Date:** 2026-06-29
**Plan-Spec:** N/A

## Overview

This feature adds a single reference document (`specs/docs-validators-health.md`) that catalogs every automated gate running against the docs repository. It provides a consolidated dashboard of all 9 validators — their workflow files, trigger conditions, schedules, blocking posture, and what each one validates — along with maintenance guidance for operators.

## What Was Built

- A new spec file `specs/docs-validators-health.md` serving as a single-source-of-truth health dashboard for all CI validators
- A reference table of 9 validators covering Mintlify CI, OpenAPI conformance, internal-reference gating, spec example validation, live staging checks, SDK quickstart trace verification, SDK package drift detection, OpenAPI freshness, and Engine A conformance
- Posture definitions (BLOCKING, ADVISORY, ADVISORY secret-gated) explaining the gate failure semantics
- Maintenance runbooks for the three most operationally sensitive validators (SDK pin bump, OpenAPI refresh, Engine A activation)
- A verification snippet for confirming diff scope after edits

## Technical Implementation

### Files Modified

- `specs/docs-validators-health.md`: New file — a 40-line Markdown dashboard enumerating all 9 automated doc-validation gates with their workflow names, PR path filters, cron schedules, posture, and validated scope

### Key Changes

- Documents all 9 validators in a single table with uniform columns: `#`, `Validator`, `Workflow`, `PR trigger`, `Schedule (UTC)`, `Posture`, `What it validates`
- Classifies each validator's posture as BLOCKING (exits 1, fails PR), ADVISORY (reports but never fails), or ADVISORY secret-gated (skips cleanly when secret absent)
- Captures cron schedules for the 6 validators that run on a schedule (06:00–07:30 UTC daily or Monday 13:00 UTC for OpenAPI freshness)
- Includes targeted maintenance notes for SDK version pin bumps (validator 7), OpenAPI drift refresh (validator 8), and Engine A activation steps (validator 9)
- Adds a self-verification shell snippet to catch accidental scope creep when editing the file

## How to Use

1. Open `specs/docs-validators-health.md` to get a full view of all active CI gates and their current posture.
2. When a PR check fails, find the matching row by workflow name to understand what the gate validates and why it may be failing.
3. To understand whether a gate is blocking or advisory, consult the **Posture** column and the **Posture definitions** section.
4. When performing maintenance (SDK upgrades, OpenAPI refresh, Engine A enablement), follow the runbooks in the **Maintenance notes** section.
5. After editing the file, run the verification snippet at the bottom to confirm the diff is scoped only to `specs/docs-validators-health.md`.

## Configuration

No configuration changes required. The dashboard is a documentation artifact only — the underlying workflow files it references (`mintlify-ci.yml`, `doc-examples.yml`, `internal-reference-gate.yml`, `spec-examples.yml`, `doc-examples-live.yml`, `sdk-quickstart-trace.yml`, `sdk-examples.yml`, `openapi-freshness.yml`, `verify-docs-gate.yml`) already exist and are not modified by this change.

Notable secret dependencies documented:
- `MNEMOM_STAGING_TOKEN` — required by validator 5 (Doc Examples Live); gate skips without it
- `APP_PRIVATE_KEY` + `vars.APP_ID` — required by validator 9 (Engine A); gate skips without them

## Testing

Confirm the file renders correctly in the docs site (Mintlify CI, validator 1, will validate it on every PR). No logic or script changes were introduced, so no unit or integration tests apply. To verify diff scope after any future edits, run:

```sh
git diff --name-only HEAD
git status --short | grep -vE '^\?\? specs/docs-validators-health\.md' && echo "ERROR: unexpected untracked files" || echo "OK"
```

## Notes

- Validator 9 (Engine A / `verify-docs-gate.yml`) is currently ADVISORY and skips without the GitHub App credentials. The dashboard documents the two-step promotion path to BLOCKING once the drift backlog is cleared.
- The internal-reference gate patterns listed in the validator 3 description are intentional meta-documentation, not a leak of the gate's detection patterns.
- Schedules are staggered 15 minutes apart (06:00–07:30 UTC) to avoid concurrent runner contention.
