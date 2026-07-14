# Spec — Origin-vs-edge attribution probe for docs.mnemom.ai

- **Status:** Draft
- **Branch:** feature-issue-269-adw-0d0961c2-add-origin-vs-edge-attribution-probe-tig
- **Location:** `scripts/lib/origin-edge-attribution.mjs` (new), `scripts/probe-docs-origin-edge.mjs` (new), `scripts/probe-docs-origin-edge.test.mjs` (new), `package.json` (add npm scripts), `specs/docs-validators-health.md` (document the new probe + record the out-of-repo follow-ups)
- **Related docs:** `AGENTS.md` (stack + conventions), `specs/docs-validators-health.md` (validator/gate dashboard), `.mnemom/capability.yaml` (verbs), existing `scripts/check-*.mjs` validators (CLI + exit-code contract), `scripts/lib/doc-examples-extract.mjs` (pure-function lib pattern)

## Problem / Objective

**User Story**

- As an on-call responder for docs.mnemom.ai,
- I want an origin-vs-edge attribution probe that, at alert time, tells me whether a docs outage (e.g. a sustained HTTP 403) is a Mintlify **origin** fault or a Cloudflare **edge/DNS** fault, with the supporting response headers attached,
- So that I stop hand-separating a healthy edge from a broken origin (which cost ≈5.5 min from first failure to diagnosis) and can act on the correct system immediately.

**Problem Statement**

Incident `980582706` (engagement `E-e9bb436b`) was a Mintlify SaaS origin returning `403 Forbidden` for the docs deployment, while the Cloudflare edge was healthy and faithfully proxying that 403 to clients. Diagnosis had to *manually* determine that the edge was fine and the origin was at fault. Today this repo has **no** probe that captures that distinction, so every future docs-403 alert repeats the same manual triage.

**Scope reality (authoritative — per the maintainer comments on issue #269, which override the issue body).** Two of the three acceptance criteria in the body cannot be satisfied by a change *in this repository*, and one class of change is explicitly forbidden here:

1. **Monitor confirmation/retry window (AC #2)** is a BetterStack *configuration* on monitor `4536046`, defined in **mnemom-adw**'s `ops_service_map.yaml` / the ops-responder provisioning scripts — **not** in `mnemom/docs`. There is no file in this repo a PR can change to tighten it. This plan does **not** attempt it; it is surfaced as a tracked out-of-repo follow-up (see *Known Limitations / Follow-ups*). Silently pretending to satisfy it here would be an intent mismatch (MNE-440/MNE-443).
2. **Wiring the attribution into the live alert payload (part of AC #1)** requires the ops-responder / BetterStack side to *consume* the probe output. This repo can produce a correct, machine-readable attribution artifact; it cannot inject it into an alert that is fired elsewhere.
3. **A new/modified GitHub Actions workflow is a NEVER-AUTO surface** for this ADW lane, so the probe is delivered as a **standalone, on-demand script** (mirroring the existing `scripts/*.mjs` validators), *not* as a scheduled CI workflow. A human may later wire it into CI or into ops-responder; that wiring is out of scope here.

**What this repo can honestly deliver (in scope):** a reusable, tested origin-vs-edge attribution probe — the exact classification logic and the machine-readable payload that the diagnosis previously had to produce by hand — so that whichever caller runs it (a responder at the terminal, or later ops-responder/CI) gets the attribution for free. This is *probe additions only, no monitor deletions* (AC #3, fully satisfiable here) and is the reusable core behind AC #1.

## Approach & Changes

Follow the established repo pattern exactly: a **pure-function library** in `scripts/lib/` holding the testable classification logic, plus a **thin CLI wrapper** in `scripts/` that does the network I/O and prints the result, using the same `argv`/exit-code contract (`0` clean, `1` fault/attributed-down, `2` bad CLI usage) as `check-redirects.mjs` and `check-doc-examples.mjs`. Node 22's global `fetch` and the built-in `node:test` runner mean **no new dependency and no lockfile change** (avoiding the NEVER-AUTO lockfile surface entirely).

Relevant files and why they matter:

- `AGENTS.md` — establishes the stack (Mintlify, no build step) and that `scripts/` holds tooling; confirms the probe is a script, not a build artifact.
- `.mnemom/capability.yaml` — defines the `lint`/`typecheck`/`test`/`build` verbs used in Verification; confirms `typecheck`/`build` are no-ops for this docs repo.
- `scripts/check-redirects.mjs`, `scripts/check-doc-examples.mjs` — the CLI + exit-code contract and `--help`/`--verbose` flag conventions to mirror.
- `scripts/lib/doc-examples-extract.mjs` — the "pure functions, no side effects, no global state; consumers wrap with their own I/O" convention to follow for the classification core.
- `specs/docs-validators-health.md` — the dashboard where the probe and the two out-of-repo follow-ups get recorded so the gap is not silently dropped (MNE-443).

### New Files

- `scripts/lib/origin-edge-attribution.mjs` — pure classification core. Exports `classifyAttribution({ edge, origin })` where `edge`/`origin` are plain `{ ok, status, headers, error }` observation objects (never live `Response`s), returning a structured verdict `{ verdict, confidence, edgeHealthy, originHealthy, reason, supportingHeaders, observedAt }`. Also exports small header helpers (`hasCloudflareEdgeMarkers(headers)` → `cf-ray`/`cf-cache-status`; `hasOriginMarkers(headers)` → `x-vercel-id`/`server`). No network, no `process`, no globals — fully unit-testable.
- `scripts/probe-docs-origin-edge.mjs` — thin CLI. Resolves target (`--url`, default `https://docs.mnemom.ai/`) and origin endpoint (`--origin-host`/`--origin-url`, configurable so no origin hostname is hard-coded; **no secrets** — the origin host is public config), performs the edge request and the origin-direct request with a bounded timeout, builds the two observation objects, calls `classifyAttribution`, prints a machine-readable JSON payload (and a human line in `--verbose`), and exits per the contract below.
- `scripts/probe-docs-origin-edge.test.mjs` — `node:test` regression suite driving `classifyAttribution` with mocked observations (no network). Covers the incident and the failure-mode edges (below).

### Implementation Plan

**Foundation** — Build the pure classification library and its exit-code/verdict vocabulary first, so the CLI and tests both consume one source of truth.

**Core Implementation** — Add the CLI wrapper that performs the two probes (edge + origin-direct) and emits the attribution payload. Keep all network I/O in the CLI; keep all decision logic in the library.

**Integration** — Wire npm scripts for running the probe and its unit test; document the probe and the explicit out-of-repo follow-ups in the validators-health dashboard.

### Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Create the pure attribution library (`scripts/lib/origin-edge-attribution.mjs`)

- Follow the `scripts/lib/doc-examples-extract.mjs` header/style convention (module docstring, "pure functions, no side effects, no global state").
- Export `hasCloudflareEdgeMarkers(headers)` (true when `cf-ray` or `cf-cache-status` present) and `hasOriginMarkers(headers)` (true when `x-vercel-id` present, or a non-Cloudflare `server` header).
- Export `classifyAttribution({ edge, origin, observedAt })` returning `{ verdict, confidence, edgeHealthy, originHealthy, reason, supportingHeaders, observedAt }`. Verdict vocabulary and rules (enumerate EVERY branch — MNE-438/MNE-442, fail *closed* on ambiguity):
  - `healthy` — edge `ok` (2xx/3xx) AND origin `ok`. Exit 0.
  - `origin-fault` — edge reachable AND Cloudflare markers present AND the edge status equals the origin status AND that status is a failure (e.g. both 403): the edge is faithfully proxying an origin failure. This is the incident case. Exit 1.
  - `edge-fault` — edge request errored/timed out or DNS-failed, OR edge returned a failure with **no** Cloudflare markers, WHILE origin-direct is `ok`: the edge/DNS layer is at fault. Exit 1.
  - `both-down` — edge failure AND origin failure but statuses diverge (not a clean proxied-through). Exit 1.
  - `indeterminate` — insufficient signal (e.g. origin-direct not attempted/unreachable so origin health is unknown, or markers absent on both sides). MUST NOT be reported as `healthy`. Exit 1 with a clear "attribution indeterminate — escalate manually" reason (MNE-439: no misleading/silent no-data path; MNE-442: fail closed on cold-start/no-data).
- `supportingHeaders` always echoes the specific headers that drove the verdict (`cf-ray`, `cf-cache-status`, `x-vercel-id`, `server`, status codes) so the payload is self-explaining.

### 2. Create the CLI probe (`scripts/probe-docs-origin-edge.mjs`)

- Mirror `check-redirects.mjs`: shebang, module docstring stating purpose + the exit-code contract, `argv` parsing with `--help`/`-h`, `--verbose`, `--url <url>`, `--origin-url <url>` (or `--origin-host <host>` sent to the edge IP with a `Host` header), `--timeout <ms>` (default e.g. 8000), `--json` (default on; pretty in `--verbose`).
- Perform the **edge** request against the public URL and the **origin-direct** request against the configurable origin endpoint, each wrapped in `AbortController` timeout + try/catch, producing `{ ok, status, headers, error }` observation objects (extract only the headers the classifier reads — do not dump full bodies).
- Call `classifyAttribution`, print the JSON payload to stdout, and `exit()` with `0` for `healthy`, `1` for any attributed-down/indeterminate verdict, `2` for bad CLI usage. Never throw an unhandled rejection — a network failure is a data point, not a crash (MNE-442).
- Use only Node built-ins (`node:process`, `node:util`, global `fetch`, `AbortController`). **Add no dependency** → no lockfile change.

### 3. Create the regression test (`scripts/probe-docs-origin-edge.test.mjs`)

- Use the built-in `node:test` + `node:assert/strict` (zero new deps). Import `classifyAttribution` directly and assert on verdicts with mocked observation objects — **no live network**.
- Required cases (each an `assert` on `verdict` + `edgeHealthy`/`originHealthy`):
  - **Incident reproduction:** edge 403 with `cf-ray`+`cf-cache-status` present, origin-direct 403 → `origin-fault`. (This is the regression test the issue's ACs require.)
  - **Edge fault:** edge request `error`/timeout (or 5xx with no Cloudflare markers) while origin-direct 200 → `edge-fault`.
  - **Healthy:** edge 200 + origin 200 → `healthy`.
  - **Both-down divergent:** edge 502 (Cloudflare markers), origin 200-but-then-503 mismatch / diverging statuses → `both-down`.
  - **Cold-start / no-data:** origin-direct not performed or unreachable so origin health unknown → `indeterminate` (asserts we do NOT emit `healthy` and DO signal escalate — MNE-439/MNE-441/MNE-442).
  - Header-helper unit checks: `hasCloudflareEdgeMarkers` / `hasOriginMarkers` true/false cases.
- Any credential-shaped header value in fixtures must be an obvious placeholder (e.g. `"x-vercel-id": "iad1::dummy"`) — no real/real-looking tokens (MNE-339).

### 4. Wire npm scripts (`package.json`)

- Add `"probe:origin-edge": "node scripts/probe-docs-origin-edge.mjs"` and `"test:probe": "node --test scripts/probe-docs-origin-edge.test.mjs"`.
- Do **not** modify the `.mnemom/capability.yaml` verbs and do **not** touch `package-lock.json` (no dependency added). Editing `package.json` scripts only is not a NEVER-AUTO surface; the lockfile is untouched.

### 5. Document the probe + surface the out-of-repo gaps (`specs/docs-validators-health.md`)

- Add a short subsection describing the origin-vs-edge probe (what it does, how to run it, its exit-code/verdict contract) so it is discoverable alongside the other gates. It is on-demand tooling, **not** a scheduled workflow — state that explicitly.
- Record the two items this repo cannot close, as explicit tracked follow-ups (MNE-440/MNE-443): (a) tighten monitor `4536046` confirmation window → mnemom-adw `ops_service_map.yaml` / ops-responder provisioning; (b) wire the probe payload into the BetterStack/ops-responder alert → ops-responder. This prevents the ACs from being silently dropped.
- Respect that file's own "Verification (no unexpected files)" note — keep the diff scoped.

### 6. Run all Verification commands

- Run every command in the *Verification → Validation Commands* section and confirm zero errors and zero regressions.

## Key Decisions & Rationale

- **Deliver a standalone script, not a CI workflow.** New/modified GitHub Actions workflows are a NEVER-AUTO surface for this lane (and the maintainer triage says so explicitly). A script mirrors the existing `scripts/*.mjs` validators, is auto-mergeable, and is trivially wired into CI/ops-responder later by a human. Rejected: adding a scheduled `*.yml` synthetic workflow (blocked surface).
- **Pure library + thin CLI split.** Matches the repo's `scripts/lib/` convention and makes the classification logic deterministically unit-testable without hitting the live site — the network is unreliable and rate-limited, and the incident is best captured as a fixture, not a live call. This is what makes the regression test meaningful.
- **`indeterminate` verdict fails closed.** On cold-start / no-data / missing markers the probe must never claim `healthy`; it exits non-zero and says "escalate manually" (MNE-439/MNE-442). A false "healthy" would be worse than the manual triage this replaces.
- **No new dependency.** Node 22 gives global `fetch` + `node:test`, so the lockfile is untouched — sidestepping the NEVER-AUTO lockfile path and the phantom-lockfile abort (MNE-462). Rejected: adding `undici`/`node-fetch`/a test framework.
- **Configurable origin endpoint, no hard-coded origin host or secrets.** The origin hostname is passed via flag/env (public config). Keeps the probe honest and secret-free.
- **Honestly scope AC #2 out.** Tightening the BetterStack confirmation window is not a file in this repo; the plan records it as an out-of-repo follow-up rather than faking satisfaction (MNE-440/MNE-443). AC #1 is satisfied *as far as this repo can* (the reusable attribution core + payload); AC #3 (probe additions only, no monitor deletions) is fully satisfied.

## Verification

Execute every command to validate the feature works correctly with zero regressions.

### Unit Tests & Edge Cases

- Unit tests live in `scripts/probe-docs-origin-edge.test.mjs` (`node:test`), asserting `classifyAttribution` for: incident 403 → `origin-fault`; edge error/timeout + origin ok → `edge-fault`; healthy → `healthy`; divergent double-failure → `both-down`; **cold-start/no-data → `indeterminate` (never `healthy`)**; header-helper true/false cases.
- Edge cases explicitly covered: edge timeout / DNS failure (network error path); failure status present but Cloudflare markers absent; origin-direct unreachable (origin health unknown); statuses that match vs. diverge; fixtures use only obvious placeholder header values (MNE-339).

### Acceptance Criteria

- **AC #1 (this repo's share):** running the probe against a 403-origin/healthy-edge condition yields a machine-readable payload labeled `origin-fault` with the supporting `cf-ray`/`cf-cache-status`/`x-vercel-id`/status headers attached. (Consuming that payload inside the live BetterStack alert is an out-of-repo follow-up — see below.)
- **AC #2:** monitor confirmation-window change is **out of this repo's scope** (BetterStack config in mnemom-adw); recorded as a tracked follow-up in `specs/docs-validators-health.md`, not silently dropped.
- **AC #3:** probe additions only — no monitor definitions or workflows deleted or modified. ✅ (verify `git diff --name-only` touches only the files in *Location*).
- A regression test reproduces the origin-403 failure mode and asserts `origin-fault`.
- `lint`, `test`, and the probe unit test all pass; no lockfile / workflow / secret change in the diff.

### Validation Commands

- `git diff --name-only main` — confirm the diff touches ONLY the files listed in *Location* (no `.github/workflows/**`, no `package-lock.json`, no NEVER-AUTO surface).
- `node --test scripts/probe-docs-origin-edge.test.mjs` — run the new regression suite (must pass, exit 0).
- `npm run test:probe` — same, via the npm script.
- `node scripts/probe-docs-origin-edge.mjs --help` — CLI help renders, exits 0.
- `npm run check:redirects && npm run check:links` — manifest `lint` verb (redirect + link integrity; zero regressions).
- `echo "(no typecheck for MDX docs)"` — manifest `typecheck` verb (no-op).
- `npm ci && npm run check:doc-examples` — manifest `test` verb (doc↔OpenAPI examples still pass; `npm ci` confirms the lockfile is unchanged/consistent).
- `echo "(Mintlify-hosted build; validated by CI)"` — manifest `build` verb (no-op).

## Known Limitations / Follow-ups

- **AC #2 — monitor confirmation window (out of repo):** tightening monitor `4536046` so a sustained failure opens an engagement within ~90s is a BetterStack configuration living in **mnemom-adw** (`ops_service_map.yaml` `docs` entry) / the ops-responder provisioning scripts (`apps/ops-responder/scripts/setup-betterstack-*.py`). File/route a follow-up against mnemom-adw. Documented in `specs/docs-validators-health.md`.
- **AC #1 — alert-payload wiring (out of repo):** injecting this probe's attribution into the fired BetterStack alert requires the ops-responder side to invoke the probe and attach its JSON. This repo provides the reusable probe + payload; the wiring is a human/ops-responder follow-up.
- **Origin-direct mechanics:** how the origin is reached (dedicated origin hostname vs. edge-IP-with-`Host`-header) depends on the Mintlify/Cloudflare setup; the CLI keeps it configurable via flag/env so the human wiring the probe supplies the correct public origin endpoint. No secret is required.
- The probe is on-demand tooling; it is intentionally NOT a scheduled CI workflow (NEVER-AUTO). Promotion to a scheduled workflow, if desired, is a separate human-authored change.
