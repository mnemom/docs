# Redirect Chain & Loop Invariants (with `--self-test`)

**ADW ID:** 61f4e227
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-381-adw-61f4e227-redirect-chain-loop-invariants-plan.md

## Overview

The `check-redirects.mjs` gate previously validated each redirect in isolation
(destinations resolve, root `/` → `/introduction`, locale nav/file parity). This
change adds **graph-level invariants** over the whole `docs.json` redirect table:
it detects redirect **cycles** (infinite redirect / 404) and multi-hop
**chains** (browser double-hops), plus **duplicate sources**. The pure detector
functions are exercised by a new hermetic `--self-test` mode that runs against
in-memory fixtures with no `docs.json` on disk.

## What Was Built

- **Redirect graph model** — the redirect table is treated as a directed graph
  (`source → destination`), considering only internal, non-wildcard,
  non-external, non-empty entries.
- **Cycle detection** — finds every cycle, including self-loops (`/a → /a`) and
  multi-node loops (`/a → /b → /a`). Cycles **FAIL unconditionally** in all modes.
- **Chain detection** — finds any source whose destination is itself a redirect
  source (a double-hop), reporting the full hop path and the flattened terminal.
- **Duplicate-source detection** — a normalized source appearing twice is
  surfaced as a failure instead of being silently overwritten in the map.
- **`--allow-chains` flag** — downgrades chain failures to warnings (cycles still
  fail), emitting the flatten suggestion for the operator to apply.
- **`--self-test` flag** — hermetic assertion suite over the pure detectors,
  short-circuiting before any `docs.json` load; prints `✓/✗` per assertion and
  exits non-zero on any failure.
- **`check:redirects:self-test` npm script** — wires the self-test into the
  project's script set, mirroring the sibling `check-internal-refs.mjs` convention.

## Technical Implementation

### Files Modified

- `scripts/check-redirects.mjs`: Added CLI flags (`--self-test`, `--allow-chains`);
  extracted pure path/graph helpers (`toSlug`, `isWildcard`, `isExternal`,
  `asPath`); added `buildRedirectGraph`, `detectCycles`, `detectChains`,
  `classifyChains`, and `runSelfTest`; added a graph-invariants pass to the live
  check and updated the success summary line.
- `package.json`: Added the `check:redirects:self-test` script.

### Key Changes

- **Side-effect-free helpers.** The path/graph helpers were made dependency-free
  and moved above the `docs.json` load so both the live check and `--self-test`
  call the exact same code paths.
- **Single classification per node.** A node belonging to a cycle is never also
  reported as a chain — each node is classified as exactly one of cycle / chain /
  clean, avoiding double-counting.
- **Termination guarantees.** Chain walks are guarded against cycles and
  re-visits so they always terminate; cycles are normalized (rotated to their
  lexicographically smallest node) and de-duplicated so `A→B→A` and `B→A→B` report
  once.
- **Exclusions prevent false positives.** External (`http(s)://`) destinations and
  wildcard (`:param` / `*`) sources/destinations are excluded from the graph
  because they cannot form a concrete in-repo resolvable hop.
- **Mode dispatch.** `classifyChains` centralizes the default-FAIL vs
  `--allow-chains`-WARN behavior so the self-test can assert both arms in a single
  run regardless of CLI flags.

## How to Use

1. Run the live redirect gate as before (now including graph invariants):
   ```bash
   npm run check:redirects
   ```
2. Run the hermetic detector self-test (no `docs.json` needed):
   ```bash
   npm run check:redirects:self-test
   ```
3. To triage a chain during migration without failing the build, downgrade
   chains to warnings:
   ```bash
   node scripts/check-redirects.mjs --allow-chains
   ```
4. When a chain is reported, follow the suggested fix: flatten the source to
   point directly at the terminal destination (the script never rewrites
   `docs.json` itself). Cycles must be resolved — they always fail.

## Configuration

- `--self-test` — run the in-memory assertion suite and exit; does not read
  `docs.json`.
- `--allow-chains` — downgrade redirect-chain failures to warnings (cycles and
  duplicate sources still fail).
- `--docs <path>` — validate a specific `docs.json` (unchanged).
- `--verbose` — print a `✓ graph OK: N internal redirect(s), no chains/cycles`
  line when the graph is clean (unchanged flag, new output).

## Testing

- **Self-test:** `npm run check:redirects:self-test` — exercises clean tables,
  chained pairs (both default-FAIL and `--allow-chains`-WARN arms), 2-node loops,
  self-loops, external/wildcard exclusion, duplicate sources, and the empty table.
- **Live gate / CI:** `npm run check:redirects` runs in `.github/workflows/mintlify-ci.yml`
  (the "Validate redirects" step), so the new cycle/chain/duplicate invariants are
  enforced on every push against the real `docs.json`.
- The self-test follows the same `--self-test` convention as
  `scripts/check-internal-refs.mjs` (wired via `.github/workflows/internal-reference-gate.yml`).

## Notes

- The gate is advisory on *how* to fix: it reports the flattened terminal but
  never modifies `docs.json` — the operator applies the change.
- Only internal, concrete redirects participate in the graph; external and
  wildcard endpoints are intentionally excluded to avoid false-positive
  chains/cycles.
- Duplicate normalized sources are treated as a defect (a source may have only
  one destination) and reported rather than silently overwritten.
