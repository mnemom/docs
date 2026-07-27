# Docs Bundle: Nav Grouping + Broken-Link Sweep + agents.txt Drift Check

**ADW ID:** bb7316cb
**Date:** 2026-07-27
**Plan-Spec:** agents/bb7316cb/plan/issue-420-adw-bb7316cb-nav-grouping-broken-links-agents-drift-plan.md

## Overview

This chore bundles three independent documentation maintenance deliverables (MNE-40a/b/c): restructuring the flat Concepts and Guides navigation tabs into six themed sub-groups, committing a clean broken-links sweep artifact, and creating a machine-readable `agents.txt` with a drift gate script to keep it in sync with `for-agents/index.mdx`.

## What Was Built

- **Nav grouping (40a):** The flat 43-page Concepts section and the flat 46-page Guides group (plus a 5-page Safe House group) in `docs.json` were replaced with six themed sub-groups — Identity & Cards, Posture & Policy, Detection & Safe House, AEGIS, Reputation & Risk, and Lifecycle — matching the structure already used in the API Reference and Protocols tabs. No page files were renamed or moved; only their grouping in `docs.json` changed.
- **Broken-link sweep (40b):** `mint broken-links` was run after the nav restructuring and the raw output committed as a launch-checklist artifact. The sweep returned zero broken links.
- **agents.txt (40c):** A machine-readable agent-discovery file was created at the repo root declaring all machine-readable surfaces the docs site exposes for AI agents (launch commitment #8).
- **Drift gate script (40c):** `scripts/check-agents-txt-drift.mjs` was written to cross-check `agents.txt` against `for-agents/index.mdx` in both directions, with a `--self-test` mode using in-memory fixtures.
- **package.json scripts (40c):** Two new npm scripts register the drift check for local and CI use.

## Technical Implementation

### Files Modified

- `docs.json`: Replaced the flat `"group": "Concepts"` (43 pages) with six themed groups in the Documentation tab, and replaced `"group": "Guides"` (46 pages) + `"group": "Safe House"` (5 pages) with six themed groups in the Guides tab. Total page counts unchanged (43 Concepts, 51 Guides).
- `for-agents/index.mdx`: Added three missing URL entries to the Machine-readable anchors section (`for-agents` page, `llms.txt`, `llms-full.txt`) so `agents.txt` and the page are in sync.
- `package.json`: Added `check:agents-txt-drift` and `check:agents-txt-drift:self-test` scripts.
- `scripts/nav-coverage-allowlist.json`: Added this ADW's agent working files (`agents/bb7316cb/design_review/advisories.md` and `agents/bb7316cb/plan/...`) to the nav-coverage allowlist so the coverage auditor does not flag them as orphaned pages.

### New Files

- `agents.txt`: Machine-readable agent-discovery manifest at repo root. Uses `Key: URL` lines (robots.txt style). Declares the docs site, for-agents page, `agents.txt` self-reference, `llms.txt`/`llms-full.txt`, OpenAPI spec, status page, AEGIS machine-readable surfaces (IOCs, advisories, threat-state, agent-readiness), and Mnemom's AAP alignment card.
- `scripts/check-agents-txt-drift.mjs` (316 lines): Drift gate with two check directions — (1) every URL in `agents.txt` must appear somewhere in `for-agents/index.mdx`; (2) every URL in the `## Machine-readable anchors` section of `for-agents/index.mdx` must appear in `agents.txt`. Exits 0 on clean, 1 on any finding. Supports `--self-test`, `--agents-txt <path>`, `--for-agents <path>`. Node built-ins only, no npm dependencies.
- `specs/launch-checklist/broken-links-2026-07-27.txt`: Mintlify broken-links sweep artifact (mintlify 4.2.592). Result: 0 broken links. One non-error warning (test fixture in `scripts/test-fixtures/`) annotated as no-action-required.

### Key Changes

- The Concepts section went from one 43-entry flat list to six labeled groups; the Guides tab went from two groups (a 46-entry flat list + a 5-entry Safe House group) to six labeled groups. The Safe House group was absorbed into Detection & Safe House.
- The drift check enforces a bidirectional invariant: stale `agents.txt` entries (declared but undocumented in `for-agents`) and undeclared surfaces (documented in `for-agents` anchors section but absent from `agents.txt`) are both caught.
- The `--self-test` mode follows the same in-memory fixture pattern as `check-redirects.mjs` and `check-nav-pages.mjs` — four fixture cases: clean pair, stale entry, missing entry, and empty anchors section (no false positive).
- If the `## Machine-readable anchors` heading is absent or renamed in `for-agents/index.mdx`, the script emits a stderr WARNING and exits 0 rather than producing a false positive (advisory MNE-414).

## How to Use

1. **View the restructured navigation:** The Documentation tab's Concepts section and the Guides tab now show six named groups (Identity & Cards, Posture & Policy, Detection & Safe House, AEGIS, Reputation & Risk, Lifecycle) instead of flat lists.

2. **Run the drift check:**
   ```bash
   node scripts/check-agents-txt-drift.mjs
   ```
   Exits 0 if `agents.txt` and `for-agents/index.mdx` are in sync, 1 on any finding.

3. **Run the self-test:**
   ```bash
   npm run check:agents-txt-drift:self-test
   # or
   node scripts/check-agents-txt-drift.mjs --self-test
   ```

4. **Update agents.txt:** Add a new `Key: https://...` line in `agents.txt`, then add the corresponding URL to the `## Machine-readable anchors` section of `for-agents/index.mdx`. Run the drift check to confirm sync.

5. **Verify nav integrity after any future `docs.json` edits:**
   ```bash
   node scripts/check-nav-pages.mjs
   node scripts/check-nav-coverage.mjs
   node scripts/check-redirects.mjs
   ```

## Configuration

- `agents.txt` path defaults to `<repo-root>/agents.txt`; override with `--agents-txt <path>`.
- `for-agents/index.mdx` path defaults to `<repo-root>/for-agents/index.mdx`; override with `--for-agents <path>`.
- The drift check reads the anchors section as everything between `## Machine-readable anchors` and the next `##` heading.

## Testing

```bash
# Nav integrity (must all exit 0)
node scripts/check-nav-pages.mjs
node scripts/check-nav-coverage.mjs
node scripts/check-redirects.mjs

# Drift gate self-test
npm run check:agents-txt-drift:self-test

# Live drift check
npm run check:agents-txt-drift
```

There is no separate typecheck or build step — Mintlify handles the build and all scripts are plain JavaScript.

## Notes

- **CI wiring for the drift check is a PENDING follow-up (MNE-443):** `npm run check:agents-txt-drift` is not yet wired into `.github/workflows/docs-validators.yml`. Editing workflow files is a NEVER-AUTO class per AGENTS.md and must land in the consolidated CI PR. The exact hook is: add a `run: npm run check:agents-txt-drift` step after the existing `check:concept-fields` step in `docs-validators.yml`.
- **Safe House group absorbed:** The former top-level "Safe House" group in the Guides tab (5 pages) was merged into the "Detection & Safe House" theme. This reduces the Guides tab from 7 groups to 6 and aligns the theme count across all tabs.
- **No page renames:** All 94 nav pages (43 Concepts + 51 Guides) retain their existing URL slugs. No redirects were added.
- **Broken-links sweep is clean:** The `specs/launch-checklist/broken-links-2026-07-27.txt` artifact records 0 broken links. The single warning about a test fixture OpenAPI file is annotated as no-action-required.
