# Reconcile fr/es Locale Navigation and Redirects with Files on Disk

**ADW ID:** f0e68a9e
**Date:** 2026-06-24
**Plan-Spec:** specs/adw/issue-299-adw-f0e68a9e-reconcile-fr-es-locale-nav-plan.md

## Overview

Only a handful of the 600+ documentation pages are localized (fr/es), and until now nothing kept the localized navigation in sync with the content files on disk: a renamed or deleted localized page left a dangling nav entry, and a new localized file could ship without ever being linked into its nav block. This change extends the existing `check-redirects.mjs` CI guard with a **locale navigation completeness** check that reconciles every non-default locale's navigation block against the files on disk — failing the build (closed) on any drift.

## What Was Built

- A locale-reconciliation pass added to `scripts/check-redirects.mjs`, derived generically from `navigation.languages` (every entry not marked `default`) — locales are never hard-coded.
- Three invariants enforced per locale:
  - **(a)** every page listed in a locale's nav block has a content file on disk;
  - **(b)** every redirect whose destination lands inside a locale resolves to a page navigable *through that locale's nav block* (stricter than the existing file-exists check), and a redirect entering a declared-but-empty locale fails closed;
  - **(c)** every `<locale>/**` content file on disk is listed in that locale's nav block — no orphan localized files.
- A reusable `collectPagesInto(node, set)` walk (refactored from the previous global-mutating `collectPages`) so the same generic page-slug collection works for both the global navigation and per-locale language blocks.
- An expanded success summary reporting locale count, localized page count, and orphan count.

## Technical Implementation

### Files Modified

- `scripts/check-redirects.mjs`: +134 / −10 lines. Added the locale navigation completeness section, refactored the page-collection helper to be reusable, and extended the final success report.

### Key Changes

- **Refactored `collectPages` → `collectPagesInto(node, set)`** — the recursive walk that pulls page slugs from any `pages` array at any depth now writes into a caller-supplied `Set` instead of a module-global, allowing it to be reused per locale. The global `pages` set is now built by calling it explicitly.
- **Locale derivation** — `localeLangs` is computed from `docs.navigation.languages`, filtering to entries with a string `language` and `default !== true`. Each locale's declared page slugs are collected into a `localePages` map (`locale → Set<slug>`).
- **Check (a) — dangling nav entries** — for every slug in each locale's nav block, `fileExists(slug)` must find a content file (`<slug>.mdx|.md` or `<slug>/index.mdx|.md`), else a failure is recorded.
- **Check (b) — redirect destinations** — destination prefix is the primary classifier (`localeOfSlug`): a redirect whose destination resolves into a known locale must point at a slug present in that locale's nav block. External (`https?://`) and wildcard (`:`/`*`) destinations are skipped. A separate orthogonal pass fails closed when a redirect's source segment enters a declared locale whose nav block is empty — kept distinct so a legitimate cross-locale "exit" redirect is never mistaken for a broken localized one.
- **Check (c) — orphan files** — `walkFiles` recursively lists every `.mdx`/`.md` file under `<docsRoot>/<locale>`, normalizes the path (stripping the extension and collapsing trailing `/index`), and flags any file not present in the locale's nav set.

## How to Use

1. Edit localized content or navigation as usual (e.g. add/rename a page under `fr/` or `es/`, or change a redirect destination).
2. Run the check locally: `npm run check:redirects` (or `node scripts/check-redirects.mjs`).
3. A clean run prints a summary such as:
   `✓ check-redirects: 20 redirect(s) OK; root → /introduction verified; 2 locale(s) reconciled (12 localized pages, 0 orphans).`
4. On drift, the script exits non-zero and lists each problem — a dangling nav entry, a redirect pointing outside a locale's nav block, or an orphan localized file — so it can be fixed before merge.

## Configuration

No configuration required. The script accepts the same optional `--verbose` flag (prints each verified locale nav entry) and resolves `docs.json` relative to the repo root. Locales are discovered automatically from `navigation.languages`; adding a new locale block is picked up with no script change.

## Testing

- Run the guard directly: `npm run check:redirects`. It is the canonical verification for this change and currently reports 20 redirects OK and 2 locales (fr, es) reconciled with 12 localized pages and 0 orphans.
- This runs in CI alongside the sibling `check:doc-examples` guard; a failing reconciliation fails the build.

## Notes

- The check is intentionally **fail-closed**: ambiguous or empty-locale cases produce a failure rather than a silent pass, so localization drift cannot slip through.
- Locale detection is fully generic — there are no `fr`/`es` literals in the logic; the title names them only because they are today's localized locales.
- This is a CI/tooling change only; no user-facing documentation pages or redirects were altered.
