# Add `anthropic-version` Header to Gateway Curl Examples

**ADW ID:** 066b4fe4
**Date:** 2026-06-04
**Plan-Spec:** specs/adw/issue-187-adw-066b4fe4-add-anthropic-version-header-plan.md

## Overview

The documented Mnemom Gateway quickstart and related guides showed raw `curl` (and Python/TypeScript) calls to the gateway's Anthropic passthrough path (`/anthropic/v1/messages`) **without** the `anthropic-version` request header. Because the gateway forwards requests unchanged to Anthropic's Messages API — which **requires** that header — a new customer copying the examples verbatim got their first call rejected with **HTTP 400 — `anthropic-version: header is required`**. This change surgically adds `anthropic-version: 2023-06-01` to every hand-built gateway-call example so the examples are copy-paste correct. (Dogfood finding F12 / Linear MNE-192, issue #187.)

## What Was Built

- Added the `anthropic-version: 2023-06-01` header to every documented gateway-call example that hand-builds the HTTP request against the Anthropic passthrough path.
- Covered all affected surfaces: the headline quickstart, the "Named agents" example, the CLI guide, the agent-identity auto-create example, the lockfile-hash opt-in snippets (curl + Python + TypeScript), and the self-hosted quickstart.
- Left SDK-mediated examples (official Anthropic SDK with a `base_url` override) untouched, since the SDK injects `anthropic-version` automatically.

## Technical Implementation

### Files Modified

- `quickstart/gateway.mdx`: Added the `anthropic-version` header line to both the "Make an API call" curl and the "Named agents" curl.
- `gateway/cli.mdx`: Added the header to the "Point your LLM client at the gateway" curl.
- `concepts/agent-identity.mdx`: Added the header to the auto-create curl.
- `guides/lockfile-hash-opt-in.mdx`: Added the header to the raw `curl` block, the Python `requests` `headers` dict, and the TypeScript `fetch` `headers` object.
- `quickstart/self-hosted.mdx`: Added the header to the self-hosted (`http://localhost:8787/anthropic/v1/messages`) curl.

### Key Changes

- For curl examples, inserted `-H "anthropic-version: 2023-06-01" \` consistently among the existing `-H` flags (before `content-type`).
- For the Python snippet, added `"anthropic-version": "2023-06-01",` to the `headers` dict; for TypeScript, added the equivalent entry to the `headers` object.
- Used a single consistent version value (`2023-06-01`, the stable recommended Anthropic Messages API version) across all variants.
- Preserved existing `x-mnemom-agent` and `X-Mnemom-*` lockfile/SDK headers — only the version header was added.
- Content-only change: no prose restructuring, navigation, or generated `api-reference/` page changes.

## How to Use

The examples now work as-is. To call the gateway's Anthropic passthrough:

1. Export your API key: `export ANTHROPIC_API_KEY=...`
2. Run the documented curl, which now includes the required version header:
   ```bash
   curl https://gateway.mnemom.ai/anthropic/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "x-mnemom-agent: my-agent" \
     -H "anthropic-version: 2023-06-01" \
     -H "content-type: application/json" \
     -d '{ "model": "claude-sonnet-4-5-20250514", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello"}] }'
   ```
3. Expect **HTTP 200** with a normal Messages response instead of the prior 400.

## Configuration

No configuration is required. The header value `2023-06-01` is the stable, recommended Anthropic Messages API version. If the recommended version changes in future, these examples (and any SDK pins) should be updated together to stay consistent.

## Testing

This is a docs-only change. Verification verbs for this repo:

- **lint / broken-links:** `npx -y mintlify broken-links` — adding a header line touches no links; must stay green.
- **Doc examples vs OpenAPI:** `npm run check:doc-examples` (`node scripts/check-doc-examples.mjs`) — the walker validates only `api.mnemom.ai/v1/...` curls and excludes `gateway.mnemom.ai/*` passthrough URLs, so this must stay green.
- **Coverage check:** `grep -rn "gateway.mnemom.ai/anthropic/v1/messages" --include=*.mdx . | grep -v node_modules` — confirm every hit either carries `anthropic-version` or is an SDK-mediated call that adds it automatically.
- **typecheck / unit test / build:** N/A — this docs repo has no type-checking, unit-test, or local build step (Mintlify is the build). No E2E spec is required (no UI interaction flow).

## Notes

- **Out of scope:** The durable fix is for the gateway to inject a default `anthropic-version` when the caller omits it; that is a platform/gateway change tracked separately.
- SDK `base_url` override snippets (e.g. `quickstart/sdk-direct.mdx`, `concepts/integrity-checkpoints.mdx`, `guides/improving-reputation.mdx`) need no change — the official Anthropic SDK injects the header.
- The Safe-House `/v1/messages` path examples use Mnemom `Authorization: Bearer` auth on a distinct (non-passthrough) route and are intentionally unaffected.
- No new dependencies were introduced.
