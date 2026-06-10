# Sync OpenAPI Freshness & Regenerate API Reference

**ADW ID:** d77654ec
**Date:** 2026-06-10
**Plan-Spec:** /home/runner/work/docs/docs/agents/d77654ec/plan/issue-232-adw-d77654ec-sync-openapi-freshness-plan.md

## Overview

This change syncs the `api-reference/openapi.json` with the latest upstream API surface, adds eight new auto-generated endpoint stub pages, updates the navigation in `docs.json`, and fixes a nav-tab resolution bug in the `generate-api-reference.mjs` script that caused it to crash when `docs.json` uses the `navigation.languages` structure instead of a flat `navigation.tabs` array.

## What Was Built

- Updated `api-reference/openapi.json` with all new/changed schema definitions from the upstream API
- New OAuth 2.1 endpoint stubs (5 pages): authorize (GET + POST), token, dynamic client registration, revocation
- New Agent lifecycle endpoint stubs (2 pages): tombstone and restore
- New Auth endpoint stub (1 page): GoTrue token exchange
- New `OAuth` navigation group added to `docs.json` API Reference tab
- Agent lifecycle endpoints (`tombstone`, `restore`) wired into the Agents nav group
- `post-auth-token-exchange` wired into the Auth nav group
- `generate-api-reference.mjs` script updated with robust nav-tab resolution and `OAuth` group ordering

## Technical Implementation

### Files Modified

- `api-reference/openapi.json`: Major sync — new `OAuth` tag with RFC 7591/7009 description; enriched `TooManyRequests` response with `Retry-After`, `X-RateLimit-*` headers; new agent fields (`name`, `containment_status`, `key_prefix`); new `checkpoint_accounting` breakdown object; `next_compute_at` field on alignment card; `network.threat_level.changed` signal source added; posture assignment `assigned_revision_id` and `replaced_prior` fields; new OAuth 2.1 paths and auth token-exchange path
- `docs.json`: Added `OAuth` nav group (5 pages), `post-auth-token-exchange` to Auth group, `post-agents-agent-id-tombstone` and `post-agents-agent-id-restore` to Agents group
- `scripts/generate-api-reference.mjs`: Two fixes — (1) added `"OAuth"` to `GROUP_ORDER` between `"Auth"` and `"Agents"`; (2) replaced `docs.navigation.tabs` direct access with a multi-fallback resolver that also checks `navigation.languages`
- `api-reference/endpoint/get-oauth-authorize.mdx`: New stub — `GET /oauth/authorize` (consent screen)
- `api-reference/endpoint/post-oauth-authorize.mdx`: New stub — `POST /oauth/authorize` (submit consent decision)
- `api-reference/endpoint/post-oauth-token.mdx`: New stub — `POST /oauth/token` (code exchange + refresh)
- `api-reference/endpoint/post-oauth-register.mdx`: New stub — `POST /oauth/register` (RFC 7591 dynamic client registration)
- `api-reference/endpoint/post-oauth-revoke.mdx`: New stub — `POST /oauth/revoke` (RFC 7009 token revocation)
- `api-reference/endpoint/post-agents-agent-id-tombstone.mdx`: New stub — `POST /agents/{agent_id}/tombstone`
- `api-reference/endpoint/post-agents-agent-id-restore.mdx`: New stub — `POST /agents/{agent_id}/restore`
- `api-reference/endpoint/post-auth-token-exchange.mdx`: New stub — `POST /auth/token-exchange`

### Key Changes

- **Nav-tab resolution bug fixed:** `generate-api-reference.mjs` previously called `docs.navigation.tabs.find(...)` directly, crashing when the docs config uses `navigation.languages[].tabs`. The fix chains three fallbacks: `tabs` → `languages[default].tabs` → `languages[0].tabs` → `[]`.
- **OAuth 2.1 / PKCE surface documented:** Full authorization-code flow (MNE-328) is now represented in the API reference, including RFC 7591 dynamic client registration and RFC 7009 token revocation.
- **Agent tombstone/restore lifecycle:** Two reversible soft-delete operations are now exposed in the nav under the Agents group, matching the backend ADR-053 containment model.
- **Rate-limit response enriched:** The `TooManyRequests` shared response now documents all four rate-limit headers (`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) with the global 100 req/min per-IP policy.
- **Checkpoint accounting field added:** Alignment card schema gains `checkpoint_accounting` — a structured breakdown of total/analyzed/excluded checkpoint counts, enabling clients to render the eligibility gauge correctly.

## How to Use

1. Browse to the **API Reference** section of the docs site — the new **OAuth** group appears between Auth and Agents in the left nav.
2. Click any OAuth endpoint (e.g. `POST /oauth/token`) to view the rendered OpenAPI spec page.
3. Use `POST /agents/{agent_id}/tombstone` to reversibly soft-delete an agent; recover it with `POST /agents/{agent_id}/restore`.
4. Use `POST /auth/token-exchange` to exchange a GoTrue refresh token for a `mnemom_session` cookie.

## Configuration

No new environment variables or runtime configuration required. The `generate-api-reference.mjs` script is invoked during the docs build pipeline and reads `api-reference/openapi.json` + `docs.json` automatically.

## Testing

```bash
# Regenerate stubs and verify nav
node scripts/generate-api-reference.mjs

# Lint / type-check the docs build
npm run lint
npm run build
```

Verify that the `OAuth` group appears in the generated `docs.json` nav and that all eight new endpoint `.mdx` stubs render without errors.

## Notes

- The OAuth 2.1 implementation (MNE-328) delegates identity to Supabase GoTrue; `mnemom-api` mints its own short-lived MCP-scoped tokens — this is reflected in the tag description in `openapi.json`.
- `checkpoint_accounting` is null for legacy alignment-card rows computed before this field was introduced; consumers must handle null gracefully.
- `next_compute_at` on the alignment card is the next 6-hour UTC cron slot after `computed_at`; it is null when `computed_at` is null.
- The `network.threat_level.changed` signal source was added in DB migration 234 and is now reflected in the closed enum for `GovernanceSignalSource`.
