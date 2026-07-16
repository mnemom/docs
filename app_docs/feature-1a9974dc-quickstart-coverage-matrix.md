# Quickstart Coverage-Matrix Assertion

**ADW ID:** 1a9974dc
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-295-adw-1a9974dc-quickstart-coverage-matrix-plan.md

## Overview

Adds a documentation gate that asserts every provider × auth-header × integration-path (× SDK language) combination the quickstart set *claims* to support also ships a worked, copy-pasteable example. It closes coverage holes where a provider is advertised in a table but has no runnable `curl`, or an integration path documents one provider and silently omits the others. The gate also backfills the previously missing OpenAI and Gemini `curl` examples on the gateway and self-hosted quickstart pages.

## What Was Built

- A new coverage-matrix checker, `scripts/check-quickstart-matrix.mjs`, that derives the asserted-supported set from the docs (never hard-coded) and verifies each cell has a real, worked example.
- Backfilled OpenAI (`/openai`, `Authorization: Bearer`) and Gemini (`/gemini`, `x-goog-api-key`) `curl` examples in `quickstart/gateway.mdx`, alongside the existing Anthropic (`/anthropic`, `x-api-key`) example.
- The same OpenAI and Gemini `curl` examples in `quickstart/self-hosted.mdx` against the local `http://localhost:8787` gateway.
- A new `check:quickstart-matrix` npm script wired into `package.json`.
- A built-in `--self-test` suite (fixtures for indented fences, auth-header mismatch, SDK-operation bar, and fail-closed behaviors) and a `--print` matrix renderer.

## Technical Implementation

### Files Modified

- `scripts/check-quickstart-matrix.mjs`: New 612-line coverage-matrix gate (checker, extractors, self-test, CLI).
- `quickstart/gateway.mdx`: Added worked OpenAI and Gemini `curl` examples against `gateway.mnemom.ai`.
- `quickstart/self-hosted.mdx`: Added worked OpenAI and Gemini `curl` examples against the local gateway.
- `package.json`: Added the `check:quickstart-matrix` script.

### Key Changes

- **Asserted set is derived, not hard-coded.** Providers and their required auth headers come from the `model-coverage:supported` sentinel table in `quickstart/gateway.mdx` (Anthropic → `x-api-key`, OpenAI → `Authorization`, Gemini → `x-goog-api-key`). The gateway path segment is derived algorithmically as the lowercased provider name (`/anthropic`, `/openai`, `/gemini`). SDK languages come from the Install `<CodeGroup>` fence labels in `quickstart/sdk-direct.mdx`.
- **Documented-example set is extracted from fenced code blocks.** For curl pages (gateway, self-hosted), a provider cell is covered only when a `curl` targets that provider's path segment *and* carries its required auth header. For `sdk-direct`, a language cell is covered only when a fenced block of that language contains a recognizable SDK operation (an SDK import or a `verify`/`check`/`detect`/`AlignmentCard`/`APTrace` call) — an install snippet or deprecation notice alone does not count.
- **Indentation-tolerant fence extractor.** Quickstart fences are nested inside `<Step>`/`<CodeGroup>` MDX tags, so the checker uses a local indent-stripping fence extractor (modeled on `check-sdk-quickstart.mjs`) rather than the shared column-0 detector, which would miss them.
- **Fails closed.** A missing sentinel region, an empty asserted set, or zero extracted blocks on any page throws (exit 1) rather than passing vacuously — a dropped table or broken extractor can never yield a false green.
- **Reuses existing primitives.** No new dependency; it reuses `extractCurls`/`parseCurl` from `scripts/lib/doc-examples-extract.mjs` and Node ≥22 `node:*` built-ins. CLI exits 0 clean, 1 on any uncovered cell / missing region / self-test failure, 2 on bad CLI usage.

## How to Use

1. Run the gate directly: `npm run check:quickstart-matrix`.
2. Print the full coverage matrix: `node scripts/check-quickstart-matrix.mjs --print`.
3. Run the built-in fixtures: `node scripts/check-quickstart-matrix.mjs --self-test`.
4. When adding a provider to the supported table or a new SDK language, add a matching worked example (a `curl` with the correct path + auth header, or an SDK-operation code block) — otherwise the gate fails and names the uncovered cell.

## Configuration

- `--root <dir>` (alias `--docs`): docs root, defaults to the repo root resolved from `scripts/`.
- `--print`: render the full coverage matrix to stdout.
- `--self-test`: run the built-in fixtures and exit.
- `--help`, `-h`: show usage.

## Testing

- `node scripts/check-quickstart-matrix.mjs --self-test` — runs the built-in fixtures (indented-fence parsing, auth-header mismatch detection, SDK-operation coverage bar, and fail-closed on missing sentinel / zero blocks).
- `npm run check:quickstart-matrix` — runs the gate against the live quickstart pages; expected to exit 0 with all asserted cells covered.
- Add it to CI alongside the sibling `check:model-coverage` / `check-sdk-quickstart` gates.

## Notes

- The checker is a sibling to `check-model-coverage.mjs` / `check-sdk-quickstart.mjs` and follows the same exit-code contract.
- Because the asserted set is derived from the docs rather than hard-coded, the gate cannot go stale: adding a provider or language automatically expands the matrix and requires a corresponding worked example.
