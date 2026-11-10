# Nav grouping audit: Concepts and Guides tabs

**ADW ID:** c698a795
**Date:** 2026-11-10
**Plan-Spec:** agents/c698a795/plan/issue-652-adw-c698a795-nav-grouping-concepts-and-guides-plan.md

## Overview

Issue #652 asked to group the Concepts tab (reported as 44 flat pages) and the Guides tab (reported as 50 flat pages) into themed sections. Investigation found this grouping already exists in `docs.json`, introduced by PR #421 (commit `e9ca634`, merged 2026-07-27) and maintained correctly since. This change is an audit-and-confirm chore with no navigation restructuring.

## What Was Built

- Verification that `docs.json`'s `navigation.languages[en]` already groups every concepts and guides page into themed sections, with zero flat/uncategorized pages.
- Confirmation that the "Documentation" tab (which holds the concepts pages — there is no tab literally labeled "Concepts") contains an `Overview` group plus six themed groups: `Identity & Cards` (14), `Posture & Policy` (6), `Detection & Safe House` (10), `AEGIS` (3), `Reputation & Risk` (3), `Lifecycle` (2) — 38 concepts pages total, matching the 38 files on disk under `concepts/`.
- Confirmation that the "Guides" tab contains five themed groups using the same taxonomy (minus AEGIS, which has no guide-level pages): `Identity & Cards` (13), `Posture & Policy` (7), `Detection & Safe House` (12), `Reputation & Risk` (4), `Lifecycle` (12) — 48 guides pages total, matching the 48 files on disk under `guides/`.
- A spot-check of internal cross-links across `concepts/` and `guides/` for any hardcoded assumption of a flat sidebar (e.g. hand-rolled "browse all concepts" indexes); none were found, since regrouping never changes page URLs.
- Confirmation that `scripts/nav-coverage-allowlist.json` contains no genuine concepts/guides page — only ephemeral `agents/<run-id>/...` artifacts from past ADW runs — so no masked orphan is hiding the true page count.

## Technical Implementation

### Files Modified

- `scripts/nav-coverage-allowlist.json`: added this run's plan artifact (`agents/c698a795/plan/issue-652-adw-c698a795-nav-grouping-concepts-and-guides-plan.md`) to the allowlist, consistent with prior ADW runs' plan files.
- `.adw-current-phase`: advanced the ADW workflow phase marker from `document` to `review`.

### Key Changes

- No `docs.json` edit was made — the issue's premise (flat 44/50-page tabs) does not match the current repo state (grouped, 38/48 pages, 0 orphans). The 44/50 vs 38/48 count mismatch is consistent with the issue describing a stale/earlier snapshot predating later page retirements (e.g. "retire protection-network page").
- `npm run check:nav-pages`, `npm run check:nav-coverage`, and `npm run check:redirects` all pass clean (798 navigable pages, 0 orphans, 36 redirects OK) against the current tree, confirming the grouping gate is already green.
- Re-applying grouping that already exists would have been no-op churn against an already-passing nav-coverage gate, so the plan explicitly avoided a speculative `docs.json` rewrite.

## How to Use

This is an internal audit chore with no user-facing navigation change — the Concepts and Guides tabs in the docs sidebar are already grouped by theme and require no further action from readers or editors. Contributors adding new `concepts/*.mdx` or `guides/*.mdx` pages should continue placing them in the matching existing themed group in `docs.json` rather than a flat list.

## Configuration

None. No environment variables or settings were introduced.

## Testing

- `npm run check:nav-pages` — confirms navigable pages still resolve (798 pages).
- `npm run check:nav-coverage` — confirms zero orphaned pages.
- `npm run check:redirects` — confirms 36 redirects still resolve (lint verb).
- `npm ci && npm run check:doc-examples` — test verb.
- `echo "(no typecheck for MDX docs)"` / `echo "(Mintlify-hosted build; validated by CI)"` — no-op typecheck/build verbs by design.
- `mintlify broken-links` (if the Mintlify CLI is available locally), per `AGENTS.md`'s pre-merge convention.

## Notes

- The plan flagged one unresolved item: the planning session had no outbound network access to compare the live `docs.mnemom.ai` sidebar directly against `docs.json`. The in-repo evidence (grouped, 0 orphans, matching page counts) is strong, but if a live check later finds the deployed site genuinely still flat, that would point to an infrastructure/deploy issue outside this chore's scope rather than a `docs.json` defect.
- Recommendation carried into the PR: close issue #652 as already resolved by PR #421, since the requested grouping was found to already be in place and correctly maintained.
