# Compliance Control-Coverage Check

**ADW ID:** 04923445
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-337-adw-04923445-compliance-coverage-check-plan.md (not present in this worktree)

## Overview

`guides/compliance.mdx` publishes Mnemom's compliance posture in a "Status at a glance" table, and its own legend defines an honesty contract: a **Supported** row "means we implement the controls today with published evidence." Nothing enforced that promise — a Supported row could cite an evidence link that 404s, point at a `#fragment` that no longer resolves, or carry no internal evidence at all, and still ship looking backed. This feature adds a CI-style validator, `scripts/check-compliance-coverage.mjs`, that ties every implemented-control claim to at least one internal evidence link that fully resolves.

## What Was Built

- A new documentation-integrity check that parses the compliance status table and asserts every **Supported** row carries ≥1 internal evidence link that resolves (destination page exists, and any `#fragment` resolves to a real heading anchor).
- A status vocabulary guard: only known statuses (`Supported`, `Partial`, `Readiness assessment in progress`, `Not on roadmap`, `Not in scope`) pass; an unknown/typo'd status (e.g. `Suported`) fails explicitly rather than silently escaping the evidence requirement.
- A built-in `--self-test` harness that builds a throwaway docs tree, exercises every row class (valid link, multi-link, dead page, bad anchor, percent-encoded anchor, malformed `%`-sequence, no link, external-only, unknown status), and then confirms the real shipped page passes.
- An `npm run check:compliance-coverage` script entry so it runs alongside the sibling docs validators.

## Technical Implementation

### Files Modified

- `scripts/check-compliance-coverage.mjs`: New 427-line ESM validator (no new dependencies). Contains table parsing, internal-link extraction, link/anchor resolution, the pure core check, a self-test, and a CLI.
- `package.json`: Added the `check:compliance-coverage` script → `node scripts/check-compliance-coverage.mjs`.

### Key Changes

- **Table discovery is column-name based, not positional.** `parseStatusTable` locates the GFM table whose header exposes a Framework, Status, and Evidence column (matched case-insensitively), so it is robust to column reordering. It strips `**bold**` markers from the status cell.
- **Evidence must be internal.** `extractInternalLinks` pulls Markdown links from the evidence cell and keeps only internal routes (`/...`), skipping external URLs (`https://`, `//`) and bare same-page fragments — an external-only cell counts as having no internal evidence.
- **Consistency with sibling validators.** It reuses `extractAnchors` exported from `check-anchors.mjs` and percent-decodes a fragment before anchor lookup (mirroring `check-anchors.mjs`), falling back to the raw fragment if `decodeURIComponent` throws on a malformed `%`-sequence. Division of labor: `check-links-local.mjs` answers "does the page exist?", `check-anchors.mjs` answers "does every `#fragment` resolve?", and this check answers "does every Supported claim carry ≥1 resolving internal evidence link?"
- **One failure per row, with a precise reason.** A row is backed if any one of its links resolves. A cell with links but none resolving yields exactly one failure — reason `page not found` if no page resolved, else `missing anchor`; an empty/external-only cell yields `no internal evidence link`; an unrecognized status yields `unknown status`.
- **The core is pure.** `checkComplianceCoverage({ root, page })` does no `process.exit`/`console`, so it can be exercised against fixtures; the CLI wrapper handles flags, exit codes, and reporting. Exits `0` when all claims are backed, `1` on any unbacked claim / unknown status / read error, `2` on bad CLI usage.

## How to Use

1. Run the check locally from the docs root:
   ```bash
   npm run check:compliance-coverage
   ```
2. Read the summary line — e.g. `scanned 11 row(s); 5/5 claim(s) backed, 0 failure(s).` A non-zero exit lists each failing row as `Framework [Status] → reason`.
3. When adding or editing a **Supported** row in `guides/compliance.mdx`, ensure the "Evidence / reference" cell includes at least one internal link (`/path/to/page` or `/path/to/page#heading-anchor`) that resolves in the docs tree.
4. Optional flags: `--page <file>` to validate a specific file, `--root <dir>` to point at a different docs root, `--self-test` to run the built-in fixtures, and `--help` for usage.

## Configuration

No environment variables or config files. Behavior is governed by two in-script constants: `KNOWN_STATUSES` (the accepted status vocabulary) and `REQUIRE_EVIDENCE` (statuses that assert an implemented control and therefore must be backed — currently just `Supported`). A new status word must be added to `KNOWN_STATUSES` deliberately.

## Testing

- **Self-test:** `node scripts/check-compliance-coverage.mjs --self-test` — 14/14 assertions pass, including a real-file assertion that the shipped `guides/compliance.mdx` has every Supported claim backed (5/5).
- **Live check:** `npm run check:compliance-coverage` — currently reports `5/5 claim(s) backed, 0 failure(s)` and exits 0.
- Fits the existing docs-validation suite (`check:links`, `check:anchors`, `check:model-coverage`, etc.), so it can be wired into the same CI gate.

## Notes

- Repo-internal `.md` notes are intentionally out of scope for page resolution — only rendered `.mdx` pages are indexed (matching `check-anchors.mjs`).
- The check treats `Supported` as the only claim that requires evidence today; work-in-progress or non-committed statuses (`Partial`, `Readiness assessment in progress`, `Not on roadmap`, `Not in scope`) legitimately carry `—` or plain text.
- The referenced plan-spec was not present in this worktree; this documentation is derived from the shipped code and its inline contract comments.
