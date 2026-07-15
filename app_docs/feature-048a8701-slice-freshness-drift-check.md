# Committed-Slice Drift Check vs Live OpenAPI Spec

**ADW ID:** 048a8701
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-278-adw-048a8701-detect-committed-slice-drift-vs-live-spec-plan.md

## Overview

The committed `api-reference/openapi.json` slice is the source of truth for the
generated API reference pages, but the existing `openapi-freshness.yml` gate only
re-validates it on a schedule (Mondays) or on PRs that touch `openapi.json` /
`sync-openapi.mjs`. That leaves a gap: a PR that edits `api-reference/endpoint/**`
pages or `docs.json` — without touching `openapi.json` — can ship pages describing
a slice that has since drifted from production. This feature adds a read-only,
on-demand drift check (`scripts/check-slice-freshness.mjs`) that revalidates the
committed slice against the live customer slice independently of that narrow
trigger, emitting an explicit diff line and a machine-readable JSON payload.

## What Was Built

- **`scripts/check-slice-freshness.mjs`** — a read-only CLI drift check that
  compares the committed slice against the live (or a local) customer slice and
  reports drift. Never writes a file and never auto-commits.
- **`scripts/lib/openapi-slice.mjs`** — a pure normalization + diff core shared
  by both the drift check and `sync-openapi.mjs`, so the two can never disagree
  about what "the committed slice" is.
- **`scripts/check-slice-freshness.test.mjs`** — `node:test` unit coverage for the
  diff core driven entirely with in-memory fixtures (no live network).
- **Refactor of `scripts/sync-openapi.mjs`** to consume the shared lib
  (staff-leak guard + `components.schemas` sort + serialization).
- **npm scripts** `check:slice-freshness` and `test:slice-freshness`.
- **Documentation corrections** in `AGENTS.md`, `scripts/_load-spec.mjs`, and
  `specs/docs-validators-health.md` reflecting the canonical committed-snapshot
  reading of ADR-054 (drift is *detected*, not "impossible by construction").

## Technical Implementation

### Files Modified

- `scripts/lib/openapi-slice.mjs` (new): Pure core exporting `assertCustomerOnly`
  (staff-path leak guard), `normalizeSlice` (alphabetical `components.schemas`
  sort), `serializeSlice` (the exact committed-file byte string), and `diffSlices`
  (path/op diff with mutually-exclusive added/removed/changed buckets).
- `scripts/check-slice-freshness.mjs` (new): CLI that reads the committed slice,
  resolves the live slice (network `fetch` with `AbortController` timeout, or a
  local file), applies the fail-closed guards, diffs, and prints the summary line
  plus JSON payload. Uses only Node built-ins — no new dependency.
- `scripts/check-slice-freshness.test.mjs` (new): fixture-driven tests for
  path-added, path-removed, path-changed, schema-order-only, staff-leak, and
  empty-live edges.
- `scripts/sync-openapi.mjs`: replaced its inline staff guard, schema sort, and
  serialization with the shared `assertCustomerOnly` / `serializeSlice` lib calls.
- `package.json`: added `check:slice-freshness` and `test:slice-freshness` scripts.
- `AGENTS.md`, `scripts/_load-spec.mjs`, `specs/docs-validators-health.md`:
  corrected ADR-054 phrasing and documented the new validator + its CI wiring hook.

### Key Changes

- **One shared normalization** (`openapi-slice.mjs`) guarantees the drift check's
  `byteEqual` verdict matches `openapi-freshness.yml`'s `git diff --exit-code`
  semantics exactly — the on-demand check can never contradict the Monday gate.
- **Honest counter semantics (MNE-438):** every path is bucketed into exactly one
  of added / removed / changed / unchanged. `opsAdded`/`opsRemoved` count HTTP
  methods only on *whole* added/removed paths; a surviving path that merely gains a
  method is reported as `pathsChanged`, never as an added op.
- **Fails closed (MNE-442):** a missing/unparseable committed file, a live
  fetch/HTTP/JSON error, a staff-path leak, or an empty live `paths` all exit `2`
  ("cannot verify") — never silently reported as fresh, and an empty live spec is
  never rendered as "everything removed".
- **Strict vs `--soft` exit contract:** strict returns `0` fresh / `1` drift;
  `--soft` downgrades drift to an advisory (`0`) while still printing the diff
  line, and `2` (cannot verify) is unchanged in both modes.
- **Preserves the human-review contract:** the check is read-only; a human runs
  `sync-openapi.mjs` + `generate-api-reference.mjs` and opens a refresh PR.

## How to Use

1. Run the check on demand:
   ```bash
   npm run check:slice-freshness
   ```
2. For an advisory (non-blocking) run that still prints the drift line:
   ```bash
   npm run check:slice-freshness -- --soft --verbose
   ```
3. Point it at a specific live source or an offline fixture:
   ```bash
   node scripts/check-slice-freshness.mjs --url https://api.mnemom.ai/openapi.json
   node scripts/check-slice-freshness.mjs --spec-path ./local-live.json
   ```
4. Read the output: an explicit line
   `committed-slice vs live: N paths added / M removed / K changed (ops +A / -R)`
   followed by a JSON payload. On drift, re-sync and open a refresh PR:
   ```bash
   node scripts/sync-openapi.mjs && node scripts/generate-api-reference.mjs
   ```
5. See usage details anytime with `node scripts/check-slice-freshness.mjs --help`.

## Configuration

- `MNEMOM_OPENAPI_URL` / `--url` — live slice URL
  (default `https://api.mnemom.ai/openapi.json`).
- `OPENAPI_SPEC_PATH` / `--spec-path <file>` — read the live slice from a local
  file instead of the network (offline testing).
- `--timeout <ms>` — per-request timeout (default `8000`).
- `--soft` — downgrade drift (exit `1`) to an advisory (exit `0`).
- `--verbose` — pretty-print the JSON payload.

**Exit codes — strict (default):** `0` fresh (byte-match, 0/0/0); `1` drift;
`2` cannot verify (fails closed).
**Exit codes — `--soft`:** `0` fresh *or* drift; `2` cannot verify (unchanged).

## Testing

- Unit test: `npm run test:slice-freshness` (`node:test`, no live network; drives
  the diff core with in-memory fixtures covering the path-added, path-removed,
  path-changed, schema-order-only, staff-leak, and empty-live edges).
- Related sync check: `node scripts/sync-openapi.mjs` (writes the slice; CI then
  git-diffs it via `.github/workflows/openapi-freshness.yml`).
- No build step in this repo — Mintlify handles rendering.

## Notes

- **CI wiring is a separate operator PR.** This ships as on-demand tooling. Making
  a PR that edits only `api-reference/endpoint/**` or `docs.json` actually *run*
  the check requires a `.github/workflows/**` edit, which is a NEVER-AUTO surface
  for this lane and lands separately in a consolidated operator PR (precedent:
  the grounding-corpus and origin-edge wiring). The exact hook — adding
  `api-reference/endpoint/**` and `docs.json` to `openapi-freshness.yml`'s
  `on.pull_request.paths`, plus a blocking or `--soft` + `continue-on-error` step —
  is recorded in `specs/docs-validators-health.md` (MNE-443) so it is not dropped.
- **Human-in-the-loop contract.** The check is strictly read-only and never
  writes or auto-commits; its output is a preliminary signal. The final decision
  to re-sync the slice and open a refresh PR is made by a human.
