# Origin-vs-Edge Attribution Probe

**ADW ID:** 0d0961c2
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-269-adw-0d0961c2-add-origin-vs-edge-probe-plan.md

## Overview

Adds an on-demand diagnostic probe that tells an on-call responder whether a `docs.mnemom.ai` outage (for example a sustained HTTP 403) is a Mintlify **origin** fault or a Cloudflare **edge/DNS** fault, and attaches the supporting response headers as evidence. It encodes — once, in reusable code — the manual triage that cost roughly 5.5 minutes during incident `980582706`, so future responders get the attribution for free.

## What Was Built

- A pure, side-effect-free classification core (`classifyAttribution`) that maps an `edge` observation and an `origin` observation to a verdict.
- A CLI probe wrapper that performs the two network requests and prints a machine-readable JSON payload with an exit-code contract.
- A `node:test` unit suite that drives the classifier with mocked observations (including the incident 403 case), requiring no live network.
- `npm` script entries `probe:origin-edge` and `test:probe`.
- Documentation of the probe (and two tracked out-of-repo follow-ups) in the validators-health spec.

## Technical Implementation

### Files Modified

- `scripts/lib/origin-edge-attribution.mjs`: New pure classification core. Header helpers (`hasCloudflareEdgeMarkers`, `hasOriginMarkers`), observation predicates, and `classifyAttribution` — every verdict branch enumerated explicitly.
- `scripts/probe-docs-origin-edge.mjs`: New CLI wrapper. All network I/O (via built-in `fetch`/`AbortController`), flag parsing, observation building, JSON output, and exit codes.
- `scripts/probe-docs-origin-edge.test.mjs`: New unit tests exercising the classifier with mocked observations.
- `package.json`: Added `probe:origin-edge` and `test:probe` scripts. No dependency or lockfile change.
- `specs/docs-validators-health.md`: Documented the on-demand probe and recorded two out-of-repo follow-ups (AC #1 wiring, AC #2 monitor window).

### Key Changes

- **Separation of concerns:** all decision logic lives in the pure library (no network, no `process`, no globals); all network I/O lives in the CLI wrapper. Tests drive the library directly.
- **Verdict vocabulary:** `healthy`, `origin-fault`, `edge-fault`, `both-down`, `indeterminate`. Each verdict carries a confidence level, the reason, and `supportingHeaders` (e.g. `cf-ray`, `cf-cache-status`, `x-vercel-id`, `server`).
- **Fails closed on ambiguity:** a side that was not probed, or a matching failure status with no Cloudflare markers to confirm a proxied-through, yields `indeterminate` with "escalate manually" — never a misleading `healthy`.
- **Incident case:** when the edge and origin return the same failure status and Cloudflare markers are present, the verdict is `origin-fault` (high confidence) — the edge is faithfully proxying an origin failure.
- **Network errors are data, not crashes:** a timeout/DNS/connection failure is normalized to `{ ok: false, status: null, error }` so a mixed network-error / HTTP-error pair classifies as diverging statuses (`both-down`) rather than silently collapsing.
- **On-demand only:** intentionally NOT a scheduled CI workflow — a new/modified GitHub Actions workflow is a NEVER-AUTO surface for this lane.

## How to Use

1. Run the probe against the origin-direct endpoint:
   ```bash
   npm run probe:origin-edge -- --origin-url <origin-direct-url> --verbose
   ```
   or invoke the script directly: `node scripts/probe-docs-origin-edge.mjs --help`.
2. Read the JSON payload — the `verdict`, `confidence`, `reason`, and `supportingHeaders` fields tell you which layer is at fault and why.
3. Check the exit code in automation: `0` = healthy, `1` = any attributed-down / indeterminate verdict, `2` = bad CLI usage.

## Configuration

Flags (no secrets; the origin endpoint is public config passed via flag):

- `--url <url>` — public edge URL (default `https://docs.mnemom.ai/`).
- `--origin-url <url>` — origin-direct URL to probe. If omitted, origin health is unknown → `indeterminate`.
- `--origin-host <host>` — send this `Host` header to the edge URL as an alternative way to probe origin-direct.
- `--timeout <ms>` — per-request timeout (default `8000`).
- `--verbose` — also print a human-readable summary line and pretty JSON.
- `--help`, `-h` — show usage.

## Testing

- Unit tests (no live network): `npm run test:probe` (`node --test scripts/probe-docs-origin-edge.test.mjs`).
- The suite drives `classifyAttribution` with mocked observation objects covering each verdict branch, including the incident 403 proxied-through case.

## Notes

- **Scope, stated honestly:** this repo delivers the reusable attribution *tooling* — the probe and its machine-readable payload — which is AC #1's in-repo share. It does **not** deliver the *automatic* alert-time labeling (AC #1's "automatically" wording) or the monitor-window reduction (AC #2); both require changes outside `mnemom/docs` and are filed as a tracked follow-up, not silently deferred.
- **Filed tracking issue:** [mnemom/docs#377](https://github.com/mnemom/docs/issues/377) — covers both out-of-repo pieces (the work lands in mnemom-adw / ops-responder; the issue is filed in this repo because the ADW automation is scoped here):
  - **Wire the probe payload into the live alert (AC #1, automatic labeling):** the ops-responder alert pipeline must invoke the probe and attach its JSON to the fired BetterStack alert. This repo provides the reusable probe and payload; the automatic wiring is the ops-responder follow-up.
  - **Tighten monitor `4536046` confirmation window (AC #2):** lives in **mnemom-adw** (`ops_service_map.yaml` `docs` entry and the ops-responder BetterStack provisioning scripts).
- The probe is a decision aid: on `indeterminate` verdicts a human must still triage and escalate manually.
