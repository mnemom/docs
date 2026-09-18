# OAuth Device Flow: Update TTLs at a Glance to New Token Lifetimes

**ADW ID:** aeccadb3
**Date:** 2026-09-18
**Plan-Spec:** agents/aeccadb3/plan/issue-501-adw-aeccadb3-docs-update-guides-oauth-device-flow-ttl-plan.md

## Overview

This change updates the `guides/oauth-device-flow.mdx` documentation to reflect the new token lifetimes shipped in MNE-7389 (mnemom-api#3155). The access token TTL increased from 1800 s (30 minutes) to 28800 s (8 hours), and the refresh token description was expanded to include the 60 s rotation grace window for network-race protection.

## What Was Built

- Updated the "TTLs at a glance" table to reflect the MNE-7389 token lifetimes
- Updated the `expires_in` field in the token-response JSON example from `1800` to `28800`
- Clarified that the outgoing access token runs to its own 8-hour expiry after a refresh (it is not cut short)
- Added documentation of the 60 s grace window on the outgoing refresh token after rotation

## Technical Implementation

### Files Modified

- `guides/oauth-device-flow.mdx`: Updated `expires_in` in the token-response JSON example and the "TTLs at a glance" table rows for access token and refresh token

### Key Changes

- **`expires_in` JSON field** (line 165): Changed from `1800` to `28800` to match the actual access-token lifetime
- **Access token table row** (line 186): Changed from `1800 s (30 minutes)` to `28800 s (8 hours); the outgoing access token runs to its own 8-hour expiry after a refresh — it is not cut short.`
- **Refresh token table row** (line 187): Changed from `30 days; single-use — each exchange rotates it.` to `30 days sliding; single-use — each exchange issues a new refresh token. The outgoing refresh token has a **60 s grace window** after rotation before it is invalidated, to protect against network races.`
- Content-only edits — no new files, no navigation changes, no dependency additions

## How to Use

No changes to the integration surface; this is a documentation-only update. Developers following the `guides/oauth-device-flow` guide will now see:

1. Token-response JSON examples showing `"expires_in": 28800` (8 hours)
2. The "TTLs at a glance" table reflecting the current MNE-7389 token lifetimes:
   - `device_code` / `user_code`: `expires_in` seconds from the device-authorization response (typically 900 s / 15 min)
   - Access token: 28800 s (8 hours); outgoing access token survives to its own 8-hour expiry after refresh
   - Refresh token: 30 days sliding; single-use with a 60 s rotation grace window

## Configuration

No configuration changes. This is a documentation-only update tracking the API behavior shipped in mnemom-api#3155 (MNE-7389).

## Testing

- **Broken-links check:** `npx -y mintlify broken-links` — content-only TTL table edits touch no internal links; must stay green
- **Doc examples drift check:** `npm run check:doc-examples` — validates curl examples against the OpenAPI snapshot; TTL table rows contain no curl examples; must stay green
- **typecheck / unit tests / build:** N/A — this docs repo has no TypeScript build or unit-test suite; Mintlify auto-deploys on push to `main`

A secondary grep sweep confirmed no other user-facing `.mdx` or `.md` files outside `guides/oauth-device-flow.mdx` reference the old `1800 s` / `30-minute` access-token lifetime (excluding `app_docs/` and `specs/` per scope fence).

## Notes

- **Tracks:** mnemom-api#3155 (MNE-7389) — access token 28800 s, refresh token 30 d sliding, 60 s rotation grace
- **Stale `app_docs` reference:** `app_docs/feature-c341227c-oauth-device-flow.md` line 49 says "before the access token's 1-hour TTL elapses" — stale (should be 8 h) but is an internal feature-history doc outside this issue's scope fence; file a follow-up to update it separately
- **Scope fence respected:** changes are limited exclusively to `guides/oauth-device-flow.mdx` per the issue requirements; no new pages or navigation entries were added
