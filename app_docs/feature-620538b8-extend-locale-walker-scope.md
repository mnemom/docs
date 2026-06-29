# Extend Doc-as-Spec Walker Scope to es/ and fr/ Locale Pages

**ADW ID:** 620538b8
**Date:** 2026-06-29
**Plan-Spec:** /home/runner/work/docs/docs/agents/620538b8/plan/issue-333-adw-620538b8-extend-locale-walker-scope-plan.md

## Overview

The doc-as-spec walker (`scripts/check-doc-examples.mjs`) previously only checked English-language documentation pages for API example drift. This change extends the default walker scope to include the `es/` (Spanish) and `fr/` (French) locale directories, ensuring that localized pages containing hand-authored API examples are validated against the live API specification alongside their English counterparts.

## What Was Built

- Extended `DEFAULT_SCOPE` in the walker script to include `es` and `fr` locale directory paths
- Updated inline comments to document the rationale for locale inclusion and describe the specific files covered (`mcp-clients.mdx` and `safe-house-protection.mdx` in each locale)
- Added two new self-test assertions (assertions 3 and 4) verifying that `es/` and `fr/` locale files are present in the resolved scope
- Increased the self-test total from 2 to 4 to account for the new assertions
- Refactored the self-test to resolve `DEFAULT_SCOPE` once and share the result across all filter predicates

## Technical Implementation

### Files Modified

- `scripts/check-doc-examples.mjs`: Extended `DEFAULT_SCOPE` constant to append `,es,fr`; updated explanatory comments; added self-test assertions 3 and 4 for locale coverage; refactored shared `allFiles` variable in self-test block

### Key Changes

- `DEFAULT_SCOPE` now ends with `...,api-reference/endpoint,es,fr` — the two locale roots are resolved by `resolveScope()` the same way as any other directory token
- Comments note that `es/mcp-clients.mdx` and `fr/mcp-clients.mdx` contain a curl against `api.mnemom.ai/mcp` which is walked but produces zero findings (not a `/v1/*` path)
- Comments note that `es/safe-house-protection.mdx` and `fr/safe-house-protection.mdx` each contain 6 `api.mnemom.ai/v1/` curl invocations that mirror the English page and are now validated
- Self-test assertions 3 and 4 verify `esFiles.length > 0` and `frFiles.length > 0` respectively, guarding against accidental scope regressions
- The `allFiles` variable is resolved once before all assertions to avoid redundant filesystem traversals in the self-test block

## How to Use

1. Run the walker normally — locale pages are now included automatically:
   ```
   node scripts/check-doc-examples.mjs
   ```
2. To verify locale coverage is active, run the self-test:
   ```
   node scripts/check-doc-examples.mjs --self-test
   ```
   Expect output showing `4/4 passed`, including the two new locale assertions.
3. To restrict the scope explicitly (excluding locales), pass a custom `--scope` argument:
   ```
   node scripts/check-doc-examples.mjs --scope guides,concepts
   ```

## Configuration

No additional configuration is required. The `es` and `fr` tokens are appended to the `DEFAULT_SCOPE` constant and take effect automatically when no explicit `--scope` flag is provided.

## Testing

Run the built-in self-test to confirm the scope extension is working:

```
node scripts/check-doc-examples.mjs --self-test
```

Expected output: `self-test: 4/4 passed` — assertions 3 and 4 confirm that `es/` and `fr/` locale files are resolved into the default scope.

## Notes

- Locale pages mirror English content. If an English page's API examples are updated, the corresponding locale pages (`es/` and `fr/`) should be updated in sync — the walker will now surface drift in those pages automatically.
- The `mcp-clients.mdx` files in each locale contain a curl against `api.mnemom.ai/mcp` (not a `/v1/` path) which is intentionally skipped by the path filter and produces no findings — this is expected behavior, not a gap.
- The six `api.mnemom.ai/v1/` curl invocations in each locale's `safe-house-protection.mdx` are the primary examples validated by this scope extension.
