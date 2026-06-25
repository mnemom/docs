# Auth + Tenant-Scoping Documentation on Risk GET Endpoints

**ADW ID:** 9857a552
**Date:** 2026-06-25
**Plan-Spec:** /home/runner/work/docs/docs/agents/9857a552/plan/issue-318-adw-9857a552-document-the-auth-tenant-scoping-require-plan.md

## Overview

This change surfaces the authentication requirement and tenant-scoping behavior for the two risk GET-by-ID endpoints (`GET /risk/assessments/{assessment_id}` and `GET /risk/proofs/{proof_id}`). Specifically, it documents that these endpoints return `404` rather than `403` when a valid token from a different account attempts to access a resource, a deliberate security design that avoids leaking the existence of resources across account boundaries.

## What Was Built

- Added an inline `<Note>` callout to the `GET /risk/assessments/{assessment_id}` endpoint page explaining auth methods and the `404`-on-cross-account behavior.
- Added the same `<Note>` callout to the `GET /risk/proofs/{proof_id}` endpoint page.
- Updated the Risk API overview page (`risk-overview.mdx`) to state the tenant-scoping rule in the top-level auth paragraph and inline in the per-endpoint descriptions for both GET-by-ID endpoints.

## Technical Implementation

### Files Modified

- `api-reference/endpoint/get-risk-assessments-assessment-id.mdx`: Added `<Note>` block documenting Bearer token / API key auth and the `404`-not-`403` cross-account policy.
- `api-reference/endpoint/get-risk-proofs-proof-id.mdx`: Same `<Note>` block added.
- `api-reference/risk-overview.mdx`: Extended the top-level auth sentence to include tenant-scoping behavior; updated endpoint summary lines for both GET-by-ID endpoints to note the `404` response for cross-account IDs.

### Key Changes

- **Consistent note format** — both individual endpoint pages use the same `<Note>` component with identical auth and scoping language, keeping the reader experience uniform.
- **`404` over `403` rationale explicitly stated** — documentation explains that `404` is intentional to avoid leaking resource existence across accounts (IDOR-mitigation pattern).
- **Overview-level disclosure** — the risk overview page now surfaces this behavior at the section level so developers scanning the overview understand the scoping contract before reaching individual endpoint pages.
- **No API behavior change** — this is a documentation-only update; the underlying API already returns `404` in these cases.

## How to Use

1. Authenticate requests to `GET /risk/assessments/{assessment_id}` or `GET /risk/proofs/{proof_id}` with either:
   - `Authorization: Bearer <token>` header, or
   - `X-Mnemom-Api-Key: <key>` header.
2. Results are scoped to the authenticated account — only resources belonging to that account are returned.
3. If the `assessment_id` or `proof_id` belongs to a different account (or does not exist), the API returns `404`. Do not interpret a `404` as confirmation that the resource does not exist globally.

## Configuration

No configuration changes required. This is a documentation update only.

## Testing

Verify the rendered docs look correct by running the local docs dev server:

```bash
npm run dev
```

Navigate to the Risk API overview and the two individual endpoint pages to confirm the `<Note>` callouts render and the overview text is updated as expected.

## Notes

The `404`-instead-of-`403` design is a deliberate IDOR-prevention measure: returning `403` would confirm that a resource with the given ID exists but belongs to another account. Returning `404` gives no information about whether the ID exists at all outside the caller's account scope. Future GET-by-ID endpoints added to the Risk API should follow the same convention and include equivalent documentation.
