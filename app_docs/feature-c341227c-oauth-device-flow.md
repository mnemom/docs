# OAuth 2.0 Device Authorization Flow Documentation

**ADW ID:** c341227c
**Date:** 2026-06-26
**Plan-Spec:** N/A (spec file not accessible in worktree)

## Overview

This feature adds comprehensive documentation for the OAuth 2.0 device-authorization grant (RFC 8628), covering how headless agents — CI runners, containerised workers, server-side pipelines — authenticate with Mnemom without a browser. The new guide explains the full flow: device-authorization request, operator approval, poll loop with backoff, error handling, and token usage.

## What Was Built

- New guide page `guides/oauth-device-flow.mdx` (207 lines) covering the complete device-authorization flow
- Flow overview with a four-step `<Steps>` component walkthrough
- HTTP request/response reference for `POST /oauth/device_authorization` with field descriptions
- Poll loop code samples in Python and TypeScript with correct `slow_down` backoff logic
- Error code reference table for all terminal and non-terminal token-endpoint errors
- Token response reference and Bearer token usage example
- TTL summary table for device codes, access tokens, and refresh tokens
- Client registration note pointing to the dynamic registration endpoint
- Cross-links added to `guides/authentication.mdx` (headless-agent callout note) and `for-agents/index.mdx` (agent reference list)
- Navigation entry added to `docs.json` under the Security/Auth sidebar group

## Technical Implementation

### Files Modified

- `guides/oauth-device-flow.mdx`: New file — full guide for the OAuth 2.0 device-authorization grant (RFC 8628), including HTTP examples, Python/TypeScript poll-loop code, error table, and TTL reference
- `guides/authentication.mdx`: Added a `<Note>` callout directing headless-agent readers to the new device-flow guide
- `for-agents/index.mdx`: Added a bullet linking to the device-authorization flow guide in the agent reference section
- `docs.json`: Added `guides/oauth-device-flow` to the sidebar navigation after `guides/authentication`

### Key Changes

- The device-authorization guide covers the full RFC 8628 lifecycle: code request → operator approval → poll loop → token receipt
- Poll loop samples correctly implement the `slow_down` backoff rule (permanent +5 s increment per response), not just a fixed retry
- Error codes table distinguishes retryable (`authorization_pending`, `slow_down`) from terminal (`expired_token`, `access_denied`, `invalid_client`) errors with prescribed actions for each
- Token response section documents the refresh-token grant path for token renewal
- Two inline `TODO` comments flag fields (`expires_in`, `interval`, endpoint path) that need verification against the `mnemom-api` source before merging

## How to Use

1. Register an OAuth client (public client, no secret) via `POST /oauth/register` if not already done.
2. Send `POST /oauth/device_authorization` with `client_id` and desired `scope`.
3. Display the returned `user_code` and `verification_uri` to the human operator (log to console, CLI prompt, or QR code from `verification_uri_complete`).
4. Poll `POST /oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code` and `device_code` at the prescribed `interval`.
5. On `authorization_pending`, wait and retry. On `slow_down`, permanently add 5 s to the interval. On `expired_token` or `access_denied`, abort.
6. On HTTP 200, extract `access_token` and use it as `Authorization: Bearer <access_token>` on API calls.
7. Exchange `refresh_token` at `POST /oauth/token` before the access token's 1-hour TTL elapses.

## Configuration

No environment-specific configuration required beyond a valid `client_id` from the OAuth client registration endpoint (`POST /oauth/register`). The guide uses `api.mnemom.ai` as the API host.

## Testing

Run the project's standard lint and typecheck suite:

```bash
npm run lint
npm run typecheck
```

Verify the new page renders correctly in the docs site and that all cross-links (`/guides/authentication`, `/guides/oauth-device-flow`, `/api-reference/overview`) resolve. Confirm the new page appears in the sidebar under the Security/Auth group.

## Notes

- Two `TODO` comments in `guides/oauth-device-flow.mdx` flag values that must be verified against `mnemom-api/src/oauth/handlers.ts` and `mnemom-api/src/oauth/device-grant.ts` before this page goes live: the endpoint path (`/oauth/device_authorization`) and the default `expires_in` (1800 s) and `interval` (5 s) values.
- The refresh-token grant is mentioned but not fully documented here; a separate guide or API reference page may be needed.
- The `verification_uri_complete` field (pre-filled URL for QR codes) is documented but the guide notes it is optional — agents should degrade gracefully if the server omits it.
