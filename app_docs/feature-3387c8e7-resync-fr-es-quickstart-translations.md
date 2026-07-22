# Resync fr/es Quickstart Translations

**ADW ID:** 3387c8e7
**Date:** 2026-07-22
**Plan-Spec:** agents/3387c8e7/plan/issue-409-adw-3387c8e7-resync-fr-es-quickstart-translations-plan.md

## Overview

This chore resyncs 4 stale French and Spanish quickstart translation pages whose `source_fingerprint` frontmatter values had drifted from the current English source content hashes. The `npm run check:i18n-lag` gate was failing (blocking all docs PRs on MNE-2290); this change brings it back to green by updating translation content where the EN source changed substantively and re-baselining all fingerprints.

## What Was Built

- Updated `fr/quickstart/self-hosted.mdx` and `es/quickstart/self-hosted.mdx` with faithful translations of new OpenAI and Gemini multi-provider code block examples added to the EN source
- Re-baselined `source_fingerprint` in all 4 localized quickstart pages to match current EN hashes
- `fr/quickstart/gateway.mdx` and `es/quickstart/gateway.mdx` required fingerprint re-stamp only (EN changes were prose/frontmatter-only for gateway)

## Technical Implementation

### Files Modified

- `fr/quickstart/gateway.mdx`: `source_fingerprint` updated from `sha256:74e4c44c...` to `sha256:33616606...` (re-baseline only; no content change)
- `fr/quickstart/self-hosted.mdx`: Added French translations of two new multi-provider curl examples (OpenAI `/openai` route and Gemini `/gemini` route) + `source_fingerprint` updated from `sha256:57c1e83d...` to `sha256:32e1c1d3...`
- `es/quickstart/gateway.mdx`: `source_fingerprint` updated from `sha256:74e4c44c...` to `sha256:33616606...` (re-baseline only; no content change)
- `es/quickstart/self-hosted.mdx`: Added Spanish translations of two new multi-provider curl examples (OpenAI `/openai` route and Gemini `/gemini` route) + `source_fingerprint` updated from `sha256:57c1e83d...` to `sha256:32e1c1d3...`

### Key Changes

- The EN `quickstart/self-hosted.mdx` had received substantive additions: two new `curl` code block examples demonstrating the gateway's OpenAI-compatible (`/openai`) and Gemini-compatible (`/gemini`) proxy routes, with surrounding prose explaining the `OPENAI_API_KEY` and `GEMINI_API_KEY` environment variables
- French translations used idiomatic phrasing (e.g. "Si vous avez configuré", "Et Gemini sur le chemin", "Vérifiez que l'agent est connecté") while keeping code blocks verbatim
- Spanish translations used idiomatic phrasing (e.g. "Si configuraste", "Y Gemini en la ruta", "Verifica que el agente esté conectado") while keeping code blocks verbatim
- Code blocks themselves are not translated; only surrounding prose and inline descriptions were localized
- `node scripts/check-i18n-lag.mjs --write` was used to atomically re-stamp all fingerprints after content updates

## How to Use

This is a maintenance chore with no user-facing feature change. The localized quickstart pages now reflect the same multi-provider gateway examples available in the English source.

1. Navigate to `fr/quickstart/self-hosted` or `es/quickstart/self-hosted` in the docs site
2. The self-hosted quickstart now includes curl examples for calling OpenAI and Gemini models through the gateway's proxy routes
3. No EN source pages were modified

## Configuration

No configuration changes. The `source_fingerprint` field in MDX frontmatter is managed automatically by `node scripts/check-i18n-lag.mjs --write`.

## Testing

```sh
# Primary gate — must exit 0
npm run check:i18n-lag

# Unit tests for the i18n-lag script — must exit 0
npm run test:i18n-lag
```

There is no generic `lint`, `typecheck`, or `build` script in this documentation-only repo (Mintlify). The two commands above are the definitive validators for this chore.

## Notes

- The CI gate (`.github/workflows/i18n-lag.yml`) is intentionally deferred to a human operator per the maintainer override on docs#283 — tracked in docs#395. Until that workflow lands, the green state is advisory-only and will not automatically block future PRs that introduce staleness.
- The `--write` flag is not atomic; if interrupted, re-run `node scripts/check-i18n-lag.mjs --write` to complete stamping.
- No EN source files, CI/workflow files, or lockfiles were modified — only the 4 localized translation pages.
- Closes #409 (MNE-2290).
