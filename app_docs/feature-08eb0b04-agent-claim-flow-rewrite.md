# Agent Claim Flow Guide — Rewrite to the Real `hash_proof` Flow

**ADW ID:** 08eb0b04
**Date:** 2026-06-04
**Plan-Spec:** specs/adw/issue-188-adw-08eb0b04-rewrite-claim-flow-hash-proof-plan.md

## Overview

The `guides/agent-claim-flow.mdx` guide documented a two-step claim flow — minting a short-lived token via `POST /v1/claim/tokens`, then presenting `Authorization: Claim-Token <token>` — that does not exist in the live API. New users following the guide hit a 404 and could not claim their agents (dogfood finding F15 / Linear MNE-193). This change rewrites the guide to document the single authenticated `POST /v1/agents/{agent_id}/claim` call with a `hash_proof` body, matching the OpenAPI `claimAgent` operation, which is the source of truth.

## What Was Built

- A full rewrite of the Agent Claim Flow guide aligned to the real gateway-first lifecycle: `gateway first-traffic → Mnemom Sandbox (unclaimed) → claim → your org`.
- Removal of every reference to the fictional `POST /v1/claim/tokens` mint endpoint and the `Claim-Token` authorization scheme.
- A "self-register vs. claim" decision section disambiguating `POST /v1/agents` (you are the agent) from `POST /v1/agents/{id}/claim` (you are adopting a gateway-provisioned agent).
- An explanation of how `hash_proof` proves key ownership, including the two distinct keys involved (the agent's provider key vs. the owner's Mnemom credential).
- Working, validator-checked examples (cURL, TypeScript SDK, CLI) that compute `hash_proof` locally and call the real endpoint.
- Updated idempotency / re-homing semantics and a corrected failure-mode table matching the real error codes.

## Technical Implementation

### Files Modified

- `guides/agent-claim-flow.mdx`: Rewritten end-to-end (257 lines changed). Updated frontmatter description, replaced the delegated-token narrative with the gateway-first claim narrative, added the `hash_proof` derivation, the three accepted auth options, org-selection semantics, and aligned all fenced examples and the response shape to the `claimAgent` schema.
- `specs/adw/issue-188-adw-08eb0b04-rewrite-claim-flow-hash-proof-plan.md`: Added the plan-spec describing the bug, root cause, and approach.

### Key Changes

- **`hash_proof` derivation documented:** full 64-char lowercase SHA-256 hex of `SHA256(providerApiKey + '|' + agentName)` for a named agent, or `SHA256(providerApiKey)` for an unnamed singleton. The server resolves the agent via `agent_hash = hash_proof[:16]`.
- **Auth model corrected:** the claim is a standard authenticated call accepting a Bearer JWT, `X-Mnemom-Api-Key`, or a session cookie — there is no special claim-only scheme. The authenticated principal becomes the agent's owner.
- **Request/response aligned to OpenAPI:** body `{ "hash_proof": "<64-hex>", "org_id"?: "<uuid>" }`; 200 response `{ claimed, agent_id, org_id, claimed_at }`. The response always reports the resolved `org_id`.
- **Org selection clarified:** omit `org_id` to land in the personal org (smallest blast radius); pass an `org_id` you're a member of to place the agent there.
- **Failure-mode table rebuilt:** `401` (no/expired credentials), `400 hash_proof_required`, `400 invalid_key_hash_format`, `403 agent_org_not_member` (with `details.claimable_orgs`), `403 agent_cross_tenant`, `404` unknown agent. Claim is idempotent for the same owner; there is no `409`.

## How to Use

1. **Route first traffic through the gateway.** The agent makes a normal request with its provider key (and optionally `x-mnemom-agent: <name>`); the gateway registers it, parks it in the Mnemom Sandbox as `unclaimed`, and returns the `mnm-*` agent ID in the `x-mnemom-agent` response header.
2. **Compute `hash_proof` locally** from the agent's provider key (and name), e.g. `printf '%s|%s' "$AGENT_PROVIDER_KEY" "my-agent" | shasum -a 256 | awk '{print $1}'`.
3. **Claim as the owner.** Authenticated with a Bearer JWT, `X-Mnemom-Api-Key`, or session cookie, call `POST /v1/agents/{agent_id}/claim` with `{ "hash_proof": "...", "org_id"?: "..." }`.
4. **Confirm the landing.** The 200 response reports the resolved `org_id` and `claimed_at`. Re-claiming with a new `org_id` re-homes the agent between your orgs.

## Configuration

- `AGENT_PROVIDER_KEY` — the agent's Anthropic / OpenAI / Gemini key used to derive `hash_proof` (never sent raw to the API).
- `MNEMOM_API_KEY` (or a Bearer JWT / session cookie) — authenticates you as the owner; the principal becomes `claimed_by`.
- `org_id` (optional in the request body) — omit for personal org, or pass an org you belong to.

## Testing

This is a docs-only change; validation is the documentation toolchain rather than app tests:

- **lint** (redirect / link integrity): `npm run check:redirects`
- **typecheck**: no-op for MDX docs.
- **test** (doc↔OpenAPI example validator — `Doc Examples vs OpenAPI`): `npm ci && npm run check:doc-examples`
- **Broken-links** (`Validate Mintlify Docs`): `mintlify broken-links`
- **Straggler sweep:** `grep -rn "claim/tokens\|Claim-Token" . --include=*.mdx --include=*.md --include=*.json | grep -v node_modules` must return no matches.

## Notes

- Scope was deliberately limited to the single out-of-sync guide; sibling docs (`concepts/agent-identity.mdx`, `for-agents/index.mdx`, `changelog.mdx`) already described the real flow correctly.
- Not a UI/UX change (prose `.mdx`; manifest `ux_path_globs` is `images/**`), so no E2E test or screenshots are required.
- Per `.mnemom/capability.yaml`, this is a SUPERVISED docs change (`merge_strategy: external`): the worker drives the deterministic Mintlify check green and labels the PR `agent`; a human reviews the remaining checks and makes the final merge decision. AI output here is preliminary.
