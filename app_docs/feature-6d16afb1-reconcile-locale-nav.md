# Reconcile fr/es Locale Navigation and Redirects with Files on Disk

**ADW ID:** 6d16afb1
**Date:** 2026-06-24
**Plan-Spec:** specs/adw/issue-300-adw-6d16afb1-reconcile-locale-nav-plan.md

## Overview

Extends the `check-redirects.mjs` validation script to enforce multi-locale
parity between the navigation config, the redirect table, and the actual
translation files on disk. Previously the script only validated redirect
destinations and the root → `/introduction` regression invariant; it now also
guarantees that every enforced locale (currently `fr` and `es`) keeps its
navigation, content files, and locale-prefixed redirects in sync — catching
orphaned translations, missing content files, and redirects that land on
pages not navigable within their target locale.

## What Was Built

- A **data-driven enforced-locale set** derived from `navigation.languages`
  (every non-default language), so a future locale (e.g. `de`) is covered
  automatically with no edit to the script.
- **Assertion (a) — nav → file parity:** every page listed in a locale's
  navigation must have a content file on disk.
- **Assertion (b) — redirect → locale parity:** every redirect whose
  destination is locale-prefixed must land on a page navigable within *that*
  locale's navigation, keyed off the destination's own prefix (so a
  cross-locale hop `/fr → /es/…` is checked against `es`).
- **Assertion (c) — file → nav parity:** every `.mdx`/`.md` file under
  `<docsRoot>/<locale>` must be listed in that locale's navigation, so no
  orphaned translation ships while being unreachable.
- An updated success summary that reports which locales passed parity checks.

## Technical Implementation

### Files Modified

- `scripts/check-redirects.mjs`: Added multi-locale parity validation
  (+113/−11 lines). Refactored page collection to be reusable per-locale,
  added an enforced-locale map, locale-navigability helpers, a recursive
  locale-file walker, and three new failure-collecting checks.

### Key Changes

- Refactored `collectPages` (closure over a module-level `Set`) into a generic
  `collectPagesInto(node, set)` so the same navigation walk can populate both
  the global page set and a per-locale page set.
- Built `localeNav`, a `Map<localeCode, Set<slug>>`, by walking each
  non-default entry in `navigation.languages`; `enforcedLocales` is derived
  from its keys rather than hard-coded.
- Added `navigableInLocale(set, slug)` which treats both `slug` and
  `${slug}/index` as navigable (bare-path index pages).
- Added a `walkLocaleFiles` recursive directory walk (skipping `node_modules`
  and `.git`) plus `fileToSlug` to map on-disk paths back to slug form,
  scanning both `.mdx` and `.md` to match `fileExists()` resolution.
- Redirect validation now also flags locale-prefixed destinations that resolve
  but are not navigable in their target locale's nav, while skipping
  destinations whose first segment is not an enforced locale (already covered
  by the general reachability check) and avoiding double-reporting already
  missing pages.

## How to Use

1. Run the check directly:
   ```bash
   node scripts/check-redirects.mjs
   ```
2. Pass an explicit docs config path if needed (same CLI contract as its
   sibling `check-doc-examples.mjs` / `check-spec-examples.mjs` scripts):
   ```bash
   node scripts/check-redirects.mjs path/to/docs.json
   ```
3. Use `--verbose` to print each passing redirect.
4. On success the script prints, e.g.:
   `✓ check-redirects: N redirect(s) OK; root → /introduction verified; locale nav/file parity OK (fr, es).`
   On failure it lists each parity violation and exits non-zero.

## Configuration

No new configuration. The enforced-locale set is read entirely from
`navigation.languages` in the docs config — the default language (served at
the docs root with no prefix) is skipped, and every other declared language is
enforced. Adding a new locale to `navigation.languages` automatically brings it
under these checks.

## Testing

- Run the script itself: `node scripts/check-redirects.mjs` (exit 0 = all
  parity checks pass).
- Run alongside the repo's other validation scripts
  (`check-doc-examples.mjs`, `check-spec-examples.mjs`) and the standard lint
  step to confirm no regressions.
- To exercise a failure path, temporarily add an unreferenced
  `fr/<page>.mdx` file or a `/fr → /es/<missing>` redirect and confirm the
  script reports the orphaned translation / non-navigable destination and
  exits non-zero.

## Notes

- Coverage tracks `navigation.languages` automatically; there is no hard-coded
  `fr`/`es` list to maintain (MNE-414).
- The redirect locale check only runs when the destination already resolves,
  to avoid double-reporting an already-missing page.
- Both `.mdx` and `.md` extensions are scanned so a stray `<locale>/foo.md`
  translation is caught the same as an `.mdx` one.
