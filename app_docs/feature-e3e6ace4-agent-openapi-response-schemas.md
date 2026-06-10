# Split GET /v1/agents/{id} Response: PublicAgent vs Agent

**ADW ID:** e3e6ace4
**Date:** 2026-06-10
**Plan-Spec:** specs/adw/issue-225-adw-e3e6ace4-fix-agent-openapi-response-schemas-plan.md

## Overview

The OpenAPI specification for `GET /v1/agents/{agent_id}` previously advertised a single `Agent` response schema for all callers, while noting in prose that "private agents return a limited response to non-owners." This change makes that isolation contract explicit in the schema by introducing a dedicated `PublicAgent` projection and modeling the endpoint response as a `oneOf` between `PublicAgent` and `Agent`.

## What Was Built

- A new `PublicAgent` component schema describing the limited, public projection returned to unauthenticated or non-owner callers.
- An updated `Agent` schema description clarifying it is the full owner-only view.
- A revised `200` response for `GET /v1/agents/{agent_id}` that uses `oneOf` to document both possible response shapes, with a clearer description of which caller receives which.

## Technical Implementation

### Files Modified

- `api-reference/openapi.json`: Added the `PublicAgent` schema, annotated the `Agent` schema, and changed the `GET /v1/agents/{agent_id}` 200 response to a `oneOf` of `PublicAgent` and `Agent`.

### Key Changes

- **New `PublicAgent` schema**: Exposes only `id`, `name`, `claimed`, `created_at`, `last_seen`, `status`, and `avatar_url`. Required fields are `id`, `claimed`, `created_at`, and `status`. `status` is constrained to the enum `active` | `offline`.
- **Strict-isolation contract documented**: The `PublicAgent` description explicitly states that owner-only PII (`email`, `user_id`, `agent_hash`, `billing_account_id`) and operational fields are never present in this projection.
- **`Agent` schema annotated**: Now described as the "Full agent view returned to the authenticated owner of the agent."
- **Response split into `oneOf`**: The endpoint's 200 response references both `PublicAgent` and `Agent`, returning `PublicAgent` for unauthenticated or non-owner callers and `Agent` for the authenticated owner.
- **Documentation-only change**: This is a specification update to `openapi.json`; no runtime/API behavior is altered by the diff itself — it brings the published schema in line with existing server behavior.

## How to Use

1. Open the API reference for `GET /v1/agents/{agent_id}`.
2. Note the 200 response now documents two possible shapes via `oneOf`.
3. When calling as an unauthenticated client or a non-owner, expect the `PublicAgent` projection (id, name, claimed, created_at, last_seen, status, avatar_url).
4. When calling as the authenticated owner of the agent, expect the full `Agent` response, including owner-only fields.

## Configuration

No configuration required. This is a static OpenAPI specification change consumed by the rendered API reference docs.

## Testing

- Validate the JSON is well-formed and the spec is valid OpenAPI (e.g., `npx @redocly/cli lint api-reference/openapi.json` or the project's docs build/preview command such as `mintlify dev` / `mint dev`).
- Confirm the rendered `GET /v1/agents/{agent_id}` page shows both the `PublicAgent` and `Agent` response variants.

## Notes

- The `oneOf` accurately models the two mutually distinct caller views; clients should branch on authentication/ownership to determine which schema applies.
- The `PublicAgent` field set is intentionally the authoritative isolation boundary — any future owner-only field must stay out of this projection to preserve the strict-isolation contract.
