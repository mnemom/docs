# Wire check-links-local.mjs into Mintlify CI

**ADW ID:** da700504
**Date:** 2026-07-14
**Plan-Spec:** agents/da700504/plan/issue-379-adw-da700504-wire-check-links-into-mintlify-ci-plan.md

## Merge Gate

> **Human review required before merge.**
> This PR edits `.github/workflows/mintlify-ci.yml`, a NEVER-AUTO protected path.
> Per the ADW safety invariant, a human reviewer must explicitly approve the
> workflow-file change before this PR is merged. Do not auto-merge.

## Overview

This feature wires the previously orphaned `scripts/check-links-local.mjs` script into the `mintlify-ci.yml` GitHub Actions workflow as a blocking CI step. The step enforces cross-locale link hygiene: pages under `fr/` or `es/` must not silently fall back to English-locale link targets unless the fallback is explicitly allowlisted.

## What Was Built

- A new `Check cross-locale links` step in the `validate-docs` CI job that runs `npm run check:links`
- The step runs `scripts/check-links-local.mjs` via the existing `check:links` npm script, which was already defined in `package.json` but never invoked in CI
- Broken-link sub-check output is advisory (logged, no `exit 1`); cross-locale violations are blocking (`exit 1`)
- An `allowSet` lookup backed by `scripts/locale-link-allowlist.json` lets teams intentionally permit EN fallbacks with a documented reason until a translation lands

## Technical Implementation

### Files Modified

- `.github/workflows/mintlify-ci.yml`: Added a `Check cross-locale links` step between the existing `mint broken-links` step and the `Validate redirects` step

### Key Changes

- The new CI step calls `npm run check:links`, which resolves to `node scripts/check-links-local.mjs`
- `check-links-local.mjs` walks all `.mdx` and `.md` files, extracts internal links from both Markdown and JSX/MDX `href` syntax, and classifies each link as clean, a repoint candidate (same-locale translation exists but link still points at EN), or an unapproved EN fallback
- Repoint candidates and unapproved fallbacks both fail the build (`exit 1`); broken-link findings are logged only (advisory)
- The allowlist at `scripts/locale-link-allowlist.json` supports a `locales` array (or singular `locale`) field per entry, making it possible to exempt the same target path for multiple locales with one record
- The step uses only Node.js built-in modules, so no `npm ci` install step is required before it runs

## How to Use

1. Push a PR that modifies any `.mdx` or `.md` file — the `Check cross-locale links` step runs automatically in the `validate-docs` job.
2. If a page under `fr/` or `es/` contains an internal link whose target has an existing same-locale translation, the build fails with a "should repoint to `/locale/...`" message. Update the link to point at the localized page.
3. If no same-locale translation exists yet and the EN fallback is intentional, add an entry to `scripts/locale-link-allowlist.json`:
   ```json
   { "locales": ["fr", "es"], "target": "/the-en-path", "reason": "not yet translated" }
   ```
4. Remove the allowlist entry once the page is translated and the link has been repointed.

## Configuration

- **`scripts/locale-link-allowlist.json`** — the allowlist file; each entry requires `target` (the EN path) and `reason`, and either `locale` (single string) or `locales` (array of strings).
- **`package.json` `check:links` script** — resolves to `node scripts/check-links-local.mjs`; no additional flags are currently supported.

## Testing

Run the check locally before pushing:

```bash
npm run check:links
```

The script exits `0` when no unapproved cross-locale leaks are found and prints a summary line (`Scanned N MDX/MD files.`). In CI, the step appears in the `validate-docs` job between `Check for broken internal links` and `Validate redirects`.

## Notes

- The broken-link sub-check inside `check-links-local.mjs` is advisory and will never fail CI on its own. `mint broken-links` (the preceding step) is the authoritative broken-link gate.
- The script resolves locale from the file path prefix (`fr/`, `es/`). Pages not under a locale subdirectory are skipped by the cross-locale check entirely.
- Allowlist entries should shrink over time as sections get translated; stale entries (where the translation has since landed) are surfaced as repoint errors on the next run.
- **AC (b) 'rewrite' clause is pre-satisfied.** Issue #379 AC (b) says "rewrite it and wire it." No rewrite was required in this PR — `check-links-local.mjs` had already evolved beyond a simple broken-link checker to serve cross-locale link hygiene before this issue was filed. The script's current form (cross-locale `exit 1` + advisory broken-link logging) is the output of that prior evolution. This PR's scope is wire-only, which satisfies the intent of AC (b).
