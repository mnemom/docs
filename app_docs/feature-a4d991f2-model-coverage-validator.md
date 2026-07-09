# Model-Coverage Validator

**ADW ID:** a4d991f2
**Date:** 2026-07-09
**Plan-Spec:** specs/adw/issue-276-adw-a4d991f2-model-coverage-validator-plan.md

## Overview

Adds a CI gate (`scripts/check-model-coverage.mjs`) that reconciles the supported-model claims made in `quickstart/gateway.mdx` and `concepts/provider-support.mdx` against the gateway's `/models.json` registry. The two pages had drifted apart (gateway listed GPT-5.2 / Gemini 3 Pro and omitted Opus 4.8 / GPT-5 Codex / o3), and nothing kept either page aligned with the registry it declares as the source of truth. This validator closes a gap that `mint broken-links` cannot cover — it checks the *model names asserted in prose and tables*, not just in-content links.

## What Was Built

- A new reconciliation validator script that fails CI when a page claims an unsupported model, when the two pages disagree, or when a page's authoritative model region goes missing.
- HTML-comment sentinel regions embedded in both canonical pages to deterministically delimit the "asserted-supported" model list, so unrelated deprecation/passthrough tables, AIP footnotes, and curl examples are never mis-flagged.
- A committed registry snapshot (`scripts/model-registry-snapshot.json`) that serves as an offline fallback and as the single reconciled source of truth both pages are aligned to.
- Corrected supported-model lists on both pages (Anthropic Opus 4.8/4.7 + Sonnet 4.6 + Haiku 4.5; OpenAI GPT-5, GPT-5 Codex, o3, o3-mini; Gemini 2.5 Pro/Flash).
- A new `check:model-coverage` npm script and a built-in `--self-test` suite (15 assertions).

## Technical Implementation

### Files Modified

- `scripts/check-model-coverage.mjs`: New validator (527 lines). Loads the registry, builds a supported-model index, extracts each page's claimed model set from the sentinel region, and fails on unknown claims, cross-page disagreements, or missing sentinels.
- `scripts/model-registry-snapshot.json`: New committed fallback snapshot of the gateway `/models.json` registry (`{ models: [{ id, name, provider, supported }] }`).
- `quickstart/gateway.mdx`: Wrapped the "Supported providers" table's Models column in sentinels; corrected the Anthropic/OpenAI/Gemini model lists; updated the AIP-compatibility row for the OpenAI o-series.
- `concepts/provider-support.mdx`: Wrapped the supported-models cards + `supported_models:` YAML block in sentinels.
- `package.json`: Added the `check:model-coverage` script.

### Key Changes

- **Registry resolution precedence** (`loadRegistry`): `MODEL_REGISTRY_PATH` (local file) → live `fetch` of `MODEL_REGISTRY_URL` (default `https://gateway.mnemom.ai/models.json`) → committed snapshot. Live-fetch errors are swallowed so offline/flaky CI never fails; only a missing/unparseable snapshot is a hard failure.
- **Sentinel-bounded extraction**: only text between `<!-- model-coverage:supported:start -->` and `<!-- model-coverage:supported:end -->` is parsed. A missing/unterminated region is treated as a fail-closed error, so a dropped delimiter cannot pass vacuously.
- **Name ↔ id equivalence**: marketing names (`Claude Opus 4.8`) and canonical ids (`claude-opus-4-8`) resolve to the same id via a normalized (case/whitespace-insensitive), boundary-aware matcher — so `GPT-5` matches `GPT-5,` but not the longer unknown `GPT-5.2`.
- **False-positive guards**: JSX attributes (`title="..."`, `cols={3}`) are stripped before tokenizing, and unknown model-shaped tokens are only hunted on lines that already carried a known model name — prose lines are left alone. Passthrough (`supported: false`) models named outside the region are ignored.
- **Failure modes**: exits `0` clean; `1` on an unknown claim, cross-page disagreement, missing sentinel region, registry hard-failure, or self-test failure; `2` on bad CLI usage. Sibling contract to `check-path-references.mjs` / `check-redirects.mjs`.

## How to Use

Run the gate from the repo root:

1. `npm run check:model-coverage` — reconciles both pages against the registry (uses live registry, falling back to the committed snapshot offline).
2. To edit the supported-model set, update `scripts/model-registry-snapshot.json`, then edit both pages' sentinel regions to match. Re-run the gate until it reports `✓ both pages reconciled`.
3. When adding/removing a model on a page, keep the change *inside* the `model-coverage:supported` sentinels and mirror it on the other page.

## Configuration

- `MODEL_REGISTRY_PATH` — path to a local registry JSON file (highest precedence; sets source to `local`).
- `MODEL_REGISTRY_URL` — override the live registry URL (default `https://gateway.mnemom.ai/models.json`).
- CLI flags: `--root <dir>` (docs root), `--registry <path>` (maps onto `MODEL_REGISTRY_PATH`), `--self-test`, `--help`.

## Testing

- **Self-test:** `node scripts/check-model-coverage.mjs --self-test` runs 15 built-in fixture assertions (happy path, name↔id equivalence, JSX-attribute false positives, unknown claims in YAML and tables, passthrough exclusion, cross-page disagreement, missing-sentinel fail-closed, and registry fallback/override). All 15 pass.
- **Real run:** `npm run check:model-coverage` reports `registry source: snapshot`, 10 supported claims per page, and `✓ both pages reconciled against the registry's supported set`.
- No new dependencies — Node ≥22 (per `engines`) provides global `fetch`; everything else is `node:*`.

## Notes

- The committed snapshot is a fallback, not authoritative-live: refresh `scripts/model-registry-snapshot.json` (and re-reconcile both pages) whenever the live registry adds or retires a supported model.
- Only the Models column in `quickstart/gateway.mdx`'s "Supported providers" table is inside the sentinels; the AIP-compatibility table below it is intentionally excluded so passthrough/legacy mentions there are not treated as supported claims.
- The gate fails closed on a missing sentinel region — do not remove the sentinel comments when editing either page.
