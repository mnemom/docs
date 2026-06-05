# Fix Retired Gateway Model ID in Quickstart Examples

**ADW ID:** 3dd22545
**Date:** 2026-06-05
**Plan-Spec:** specs/adw/issue-196-adw-3dd22545-fix-retired-gateway-model-id-plan.md

## Overview

The gateway documentation's copy-paste `curl` examples hard-coded the retired model id `claude-sonnet-4-5-20250514`, causing a new customer's first gateway call to be rejected upstream with an HTTP 404 (`not_found_error`). This docs-only fix replaces the retired id with the current, valid `claude-sonnet-4-6` across all published examples and refreshes the provider/models reference table so the page only advertises current models.

## What Was Built

- Replacement of the retired model id `claude-sonnet-4-5-20250514` with `claude-sonnet-4-6` in every published gateway `curl` example
- Updated **Supported providers** table in the gateway quickstart so the Anthropic row lists only current model versions
- Internal consistency across the quickstart page (the chosen id `claude-sonnet-4-6` was already used elsewhere on the same page)

## Technical Implementation

### Files Modified

- `quickstart/gateway.mdx`: Replaced the retired id in two `curl` request bodies (the "Send your first request" block and the later full example), and updated the Anthropic row of the Supported providers table from `Claude Opus 4.6, Opus 4.5, Sonnet 4.5` to `Claude Opus 4.7, Sonnet 4.6, Haiku 4.5`.
- `gateway/cli.mdx`: Replaced the retired id in the gateway `curl` example body (×1).
- `concepts/agent-identity.mdx`: Replaced the retired id in the gateway `curl` example body (×1).
- `guides/agent-claim-flow.mdx`: Replaced the retired id in the gateway `curl` example body (×1).

### Key Changes

- All user-copyable gateway `curl` examples now send `"model": "claude-sonnet-4-6"`, a current and valid upstream Anthropic model id, so the documented first call returns HTTP 200 instead of 404.
- The fix targets the root cause (a stale model id in the request body) rather than any gateway-layer behavior — the Mnemom gateway was already healthy and returns valid `X-Mnemom-*` headers; only the upstream-forwarded model id was stale.
- The Supported providers table no longer advertises retired Anthropic versions.
- Historical, non-published artifacts (`app_docs/feature-066b4fe4-anthropic-version-header.md` and `specs/adw/issue-187-*-plan.md`) that still reference the retired id were intentionally left untouched — they are records of prior work, are outside the doc-validator scope, and are not in `docs.json` nav.
- Prose `.mdx` edits only — no source, build, or dependency changes.

## How to Use

1. Open the gateway quickstart at `quickstart/gateway.mdx`.
2. Copy the "Send your first request" `curl` block.
3. Export a valid `ANTHROPIC_API_KEY` and run the command against `https://gateway.mnemom.ai/anthropic/v1/messages`.
4. The request now uses `claude-sonnet-4-6` and returns **HTTP 200** with the `X-Mnemom-*` headers intact.

## Configuration

No configuration required. The change only updates documented example model ids. If your organization standardizes on a different valid model id (e.g. `claude-haiku-4-5-20251001` or `claude-opus-4-8`), substitute it in the `model` field of the request body.

## Testing

Run from the worktree root:

- `npm run check:redirects` — lint verb (redirect / broken-link integrity).
- `echo "(no typecheck for MDX docs)"` — typecheck verb (no-op for MDX).
- `npm ci && npm run check:doc-examples` — test verb (doc↔OpenAPI example validator; gateway `curl` bodies must still validate).
- `echo "(Mintlify-hosted build; validated by CI)"` — build verb (no-op; Mintlify-hosted).

Static confirmation: `grep -rn "claude-sonnet-4-5-20250514" quickstart gateway concepts guides specifications protocols for-agents migration pricing introduction.mdx changelog.mdx` returns zero matches.

Ensure the required CI checks **`Validate Mintlify Docs`** (broken-links) and **`Doc Examples vs OpenAPI`** are green on the PR before handoff.

## Notes

- The doc-examples validator checks `curl` path/method/body against OpenAPI but does **not** assert model-id validity, so it would not catch a future retired id. A follow-up could add a lint that flags model ids not on a current-allowlist across published `.mdx`.
- This repository's capability manifest declares a supervised merge contract (`merge_strategy: external`): the worker drives checks green and labels the PR `agent`, but the final merge decision is made by a human. AI-generated output here is preliminary; a human makes the final decision.
