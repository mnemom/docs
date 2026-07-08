# Triage: MDX Pages Referencing API Paths Absent from Committed Spec

**ADW ID:** d1e67f7a
**Date:** 2026-07-08
**Plan-Spec:** /home/runner/work/docs/docs/agents/d1e67f7a/plan/issue-363-adw-d1e67f7a-triage-mdx-pages-referencing-api-paths-plan.md

## Overview

This change triages MDX documentation pages that referenced API paths not present in the committed OpenAPI spec. Three MDX files were corrected to use accurate, spec-aligned API paths, and the `path-references-allowlist.json` was extended with 13 new entries to legitimize references that are intentionally non-live (migration notes, removal documentation, spec-incomplete endpoints).

## What Was Built

- Corrected three stale or incorrect API path references across `changelog.mdx`, `guides/explain-and-remediate.mdx`, and `guides/org-admin.mdx`
- Added 13 new allowlist entries in `scripts/path-references-allowlist.json` covering removed endpoints, migration-context references, OAuth device flow (spec-incomplete), and AIP protocol spec references

## Technical Implementation

### Files Modified

- `changelog.mdx`: Fixed `/agents/{agent_id}/reputation` → `/reputation/{agent_id}` for the public reputation page URL
- `guides/explain-and-remediate.mdx`: Fixed two occurrences of bare `/v1/exemptions` → `/v1/agents/{agent_id}/exemptions` (the agent-scoped exemptions path)
- `guides/org-admin.mdx`: Fixed two bare paths — `/billing/summary` → `/orgs/{org_id}/billing/summary` and `/billing/portal-session` → `/v1/orgs/{org_id}/billing/portal-session`
- `scripts/path-references-allowlist.json`: Added 13 allowlist entries for references that are intentionally non-live

### Key Changes

- **Reputation page path correction**: The public reputation page URL in `changelog.mdx` was using the old agent-nested path; corrected to the flat `/reputation/{agent_id}` structure
- **Exemptions endpoint scoping**: `explain-and-remediate.mdx` referenced the unscoped `POST /v1/exemptions`; updated to the correct agent-scoped `POST /v1/agents/{agent_id}/exemptions` (both inline example and prose)
- **Billing path org-scoping**: `org-admin.mdx` referenced two billing paths without the org context segment; both corrected to include `/orgs/{org_id}/`
- **Allowlist: removal documentation**: 10 entries added for endpoints explicitly documented as removed or retired (old policy path, safe-house config, enforcement retirement, internal governance signals, etc.) — these are intentional migration/historical references, not doc drift
- **Allowlist: spec-incomplete**: 2 entries added for OAuth device flow (`/oauth/device_authorization`, `/oauth/device`) which exist in the platform but are absent from the committed `openapi.json` pending a mnemom-api follow-up (MNE-1393)

## How to Use

This is a maintenance/triage change with no end-user-facing behavior change. Validators that check MDX path references against the committed OpenAPI spec (`scripts/path-references-allowlist.json`) will now pass cleanly for these pages.

To add a future allowlist exemption:
1. Open `scripts/path-references-allowlist.json`
2. Add an entry under the `"allowlist"` array with `"path"` and `"reason"` fields
3. The `reason` must explain why the reference is intentionally non-live (removal doc, migration table, spec-incomplete, etc.)

## Configuration

No configuration changes required. The allowlist file (`scripts/path-references-allowlist.json`) is read by the path-references validation script at lint/CI time.

## Testing

Run the project's standard lint and path-reference checks. The allowlist additions should cause previously-failing path-reference checks to pass for the affected MDX files. Verify no new violations are introduced by reviewing the validator output.

## Notes

- The OAuth device flow entries (`/oauth/device_authorization`, `/oauth/device`) are marked spec-incomplete (not doc drift) — a mnemom-api follow-up is needed to add device-flow operations to the committed OpenAPI spec (tracked as MNE-1393)
- Entries for old/retired paths (e.g., `/agents/{id}/policy`, `/agents/{id}/enforcement`, `/agents/{id}/safe-house/config`) document intentional removals across the 2026-04-15 unified-cards consolidation and 2026-05-14 enforcement retirement; they should remain in the allowlist for historical reference
- The AIP `/aip/register` entry reflects a protocol-spec reference where docs are correct but the OpenAPI spec is incomplete
