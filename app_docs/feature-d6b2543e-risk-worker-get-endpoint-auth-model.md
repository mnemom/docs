# Risk Worker GET-Endpoint Authorization Model

**ADW ID:** d6b2543e
**Date:** 2026-06-26
**Plan-Spec:** /home/runner/work/docs/docs/agents/d6b2543e/plan/issue-329-adw-d6b2543e-document-risk-worker-auth-model-plan.md

## Overview

This change documents the authorization model for the Risk Worker's GET endpoints, clarifying how authentication works and how account-scoped resource lookups behave. The key behavior explained is that ID-based GET endpoints return `404` rather than `403` when a valid token from a different account requests a resource, preventing resource existence leakage to authenticated callers who do not own the resource.

## What Was Built

- New `## Authorization model` reference section in the Risk Assessment concept page covering both authentication credential formats and the `404`-vs-`403` scoping contract
- Authentication notes added to two endpoint pages that were previously missing them (`GET /risk/history/:agent_id`, `GET /risk/team-assessments/:assessment_id`, `GET /risk/team-history/:team_id`)
- Cross-links from all five affected endpoint pages and the Risk API overview page to the new canonical authorization model section
- Clarified distinction between ID-based lookup endpoints (hard 404) and list/history endpoints (implicit account filter, empty list)

## Technical Implementation

### Files Modified

- `concepts/risk-assessment.mdx`: Added new `## Authorization model` section (13 lines) explaining credential formats, account-scoped 404 behavior for ID-based GET endpoints, and implicit account filtering for list endpoints
- `api-reference/risk-overview.mdx`: Added link to authorization model in the top-level auth description and added a 404 callout to the team-assessments endpoint description
- `api-reference/endpoint/get-risk-assessments-assessment-id.mdx`: Extended existing auth note with link to the new authorization model section
- `api-reference/endpoint/get-risk-proofs-proof-id.mdx`: Extended existing auth note with link to the new authorization model section
- `api-reference/endpoint/get-risk-history-agent-id.mdx`: Added new auth note with credential formats, account-filter behavior, and link to authorization model
- `api-reference/endpoint/get-risk-team-assessments-assessment-id.mdx`: Added new auth note with credential formats, 404 behavior, and link to authorization model
- `api-reference/endpoint/get-risk-team-history-team-id.mdx`: Added new auth note with credential formats, account-filter behavior, and link to authorization model

### Key Changes

- **Canonical auth section**: `concepts/risk-assessment.mdx#authorization-model` is now the single authoritative source for the auth model; all endpoint pages link to it rather than duplicating the rules
- **404-not-403 contract documented**: ID-based GET endpoints (`/assessments/:id`, `/team-assessments/:id`, `/proofs/:id`) explicitly return `404` for cross-account requests; this anti-enumeration design decision is now surfaced to consumers
- **List endpoint behavior differentiated**: History/list endpoints (`/history/:agent_id`, `/team-history/:team_id`) filter results to the calling account and return an empty list rather than a 404, which is distinct from the ID-based endpoints
- **Consistent cross-linking**: All five GET endpoint reference pages now carry an auth note with a direct link to `/concepts/risk-assessment#authorization-model`
- **Overview page updated**: The Risk API overview intro and the team-assessments endpoint description both now reference the authorization model section

## How to Use

1. Navigate to [Risk Assessment concepts page](/concepts/risk-assessment#authorization-model) to read the full authorization model
2. When calling any Risk API GET endpoint, pass credentials as either:
   - `Authorization: Bearer <token>` (Bearer token)
   - `X-Mnemom-Api-Key: <key>` (API key)
3. For ID-based lookups (`/assessments/:id`, `/team-assessments/:id`, `/proofs/:id`): expect `404` if the ID belongs to another account — this is expected behavior, not an error
4. For list/history endpoints (`/history/:agent_id`, `/team-history/:team_id`): results are implicitly filtered to the calling account; a cross-account ID returns an empty list, not a `404`

## Configuration

No configuration changes. This is a documentation-only change with no API behavior modifications.

## Testing

Verify the documentation renders correctly by running the docs dev server and checking:
- `concepts/risk-assessment.mdx` displays the new `Authorization model` section with the correct anchor (`#authorization-model`)
- All five endpoint pages show the auth `<Note>` block with a working link to the authorization model section
- The Risk API overview page cross-links resolve correctly

## Notes

This is a documentation-only change. No API behavior was modified — the `404`-vs-`403` scoping behavior was pre-existing; this change makes it explicit and discoverable for API consumers.
