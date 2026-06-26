# GDPR Deletion Cascade Phase Documentation

**ADW ID:** 186e77ce
**Date:** 2026-06-25
**Plan-Spec:** agents/186e77ce/plan/issue-324-adw-186e77ce-document-gdpr-deletion-cascade-phases-plan.md

## Overview

This feature documents the GDPR deletion cascade phases in detail, giving developers a clear reference for every `status` value returned by the `GET /v1/agents/{agent_id}/deletion-status` endpoint. A new "Cascade phase breakdown" section was added to the GDPR Data Subject Rights guide, and a cross-reference link was added to the API reference endpoint page.

## What Was Built

- A new `## Cascade phase breakdown` section in the GDPR Data Subject Rights guide listing all 11 cascade phases in a structured table
- A `### Retained in pseudonymized form` subsection clarifying what happens when the `pseudonymized` status is reached and linking to the legal basis section
- Updated prose in the guide to point readers to the new breakdown section rather than enumerating the closed enum inline
- A new `### Cascade phase reference` section in the deletion-status API reference endpoint page that cross-links to the guide

## Technical Implementation

### Files Modified

- `guides/gdpr-data-subject-rights.mdx`: Added the "Cascade phase breakdown" table documenting all status values and what data each phase removes, plus a "Retained in pseudonymized form" subsection; updated the introductory sentence to reference the new section instead of listing the enum inline
- `api-reference/endpoint/get-agents-agent-id-deletion-status.mdx`: Added a "Cascade phase reference" callout at the bottom of the endpoint page linking back to the guide section

### Key Changes

- The deletion `status` closed enum is now fully documented with a phase-by-phase breakdown table covering: `tombstoned`, `phase_1_complete` through `phase_7_complete`, `kv_cleared`, `pseudonymized`, `complete`, and `failed`
- Each table row describes the `status` value, a human-readable phase name, and exactly what data is removed at that step (identity, integrity/reasoning, reputation/trust, detection/analysis, configuration, webhooks, cryptographic state, KV cache, pseudonymization)
- The `pseudonymized` phase is linked to the existing "Retained in pseudonymized form" and "Legal basis for retained data" sections to close the documentation loop on Article 17(3) carve-outs
- The `failed` phase documents the `failed_phase` field behavior and automatic retry semantics
- The API reference endpoint page now cross-links to the guide, so developers reading the reference don't have to discover the guide independently

## How to Use

1. Trigger an agent deletion via `DELETE /v1/agents/{agent_id}` — the response includes `status: "tombstoned"` and a `202 Accepted`
2. Poll `GET /v1/agents/{agent_id}/deletion-status` to track cascade progress
3. Consult the "Cascade phase breakdown" table in the GDPR Data Subject Rights guide to understand what each `status` value means and what data has been removed at that point
4. If `status` is `failed`, inspect the `failed_phase` field to identify which phase stalled; automatic retries will resume the cascade

## Configuration

No configuration changes. The documentation references the existing deletion API endpoints and the existing `status` enum — no new endpoints or fields were introduced.

## Testing

Verify that:
- `guides/gdpr-data-subject-rights.mdx` renders correctly with the new table and subsection (run `npm run dev` or equivalent to preview locally)
- All internal anchor links resolve: `#cascade-phase-breakdown`, `#retained-in-pseudonymized-form`, `#legal-basis-for-retained-data`, `#pseudonymized-agent-identity-removed-structure-retained`
- The cross-link from `api-reference/endpoint/get-agents-agent-id-deletion-status.mdx` to `/guides/gdpr-data-subject-rights#cascade-phase-breakdown` resolves without a 404
- Run the project's internal-reference gate (see `scripts/`) to confirm no broken anchors were introduced

## Notes

- The cascade phase sequence is fixed and ordered; the table documents it top-to-bottom in execution order
- The `failed` phase includes automatic retry behavior — the documentation notes this but retry configuration is not exposed via the API
- Pseudonymized records are retained for legal/compliance reasons under GDPR Article 17(3); the documentation cross-links to the existing legal basis section rather than duplicating that content
