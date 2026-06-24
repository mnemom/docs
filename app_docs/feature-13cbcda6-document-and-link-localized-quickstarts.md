# Document and Link Localized Quickstart Entry Points

**ADW ID:** 13cbcda6
**Date:** 2026-06-24
**Plan-Spec:** /home/runner/work/docs/docs/agents/13cbcda6/plan/issue-301-adw-13cbcda6-document-and-link-localized-quickstarts-plan.md

## Overview

Adds discoverability notices to the English quickstart pages so readers can find the existing French and Spanish translations. A `<Note>` callout linking to both `/es/quickstart/overview` and `/fr/quickstart/overview` was inserted at the top of four high-traffic English pages, informing users that six pages per language have been translated.

## What Was Built

- A `<Note>` callout added to `introduction.mdx` pointing readers to the Spanish and French quickstart overview pages.
- The same `<Note>` added to `quickstart/overview.mdx`, `quickstart/gateway.mdx`, and `quickstart/sdk-direct.mdx`.
- No new pages, routes, or navigation changes — this change surfaces already-published localized content to English readers.

## Technical Implementation

### Files Modified

- `introduction.mdx`: Added `<Note>` after the "Get started" heading, before the `<CardGroup>`, linking to `/es/quickstart/overview` and `/fr/quickstart/overview`.
- `quickstart/overview.mdx`: Added `<Note>` after the page title, before the "Create your account" section.
- `quickstart/gateway.mdx`: Added `<Note>` after the introductory paragraph about API keys, before the `<Steps>` block.
- `quickstart/sdk-direct.mdx`: Added `<Note>` after the opening paragraph, before the "Install" section.

### Key Changes

- Uniform `<Note>` component used across all four pages for visual consistency with the Mintlify docs framework.
- Both localized entry points are linked in every callout: Spanish (`/es/quickstart/overview`) and French (`/fr/quickstart/overview`).
- The note text clarifies scope — "six pages per language have been translated" — setting accurate expectations for readers.
- Placement is immediately visible without scrolling (top of each page), maximizing discoverability.

## How to Use

1. Navigate to any English quickstart page (`/introduction`, `/quickstart/overview`, `/quickstart/gateway`, `/quickstart/sdk-direct`).
2. The blue `<Note>` callout near the top of the page links to the Spanish and French quickstart overviews.
3. Click **Spanish (Español)** or **French (Français)** to enter the localized quickstart flow.

## Configuration

No configuration required. This is a documentation-only change; no environment variables, feature flags, or `docs.json` changes are involved.

## Testing

- Serve the docs locally (`mintlify dev` or the project's equivalent build command) and confirm the `<Note>` callout renders on all four pages.
- Click each link in the callout and verify it resolves to the correct localized page (`/es/quickstart/overview`, `/fr/quickstart/overview`).
- Confirm no existing content was displaced or reformatted by the insertion.

## Notes

- This is a documentation-only change; no application code, APIs, or runtime behavior were affected.
- The localized pages themselves were created in a prior ADW (322a7e4b). This change only adds cross-links from the English pages.
- If additional languages are added in the future, the `<Note>` on each of these four pages should be updated to include the new language link.
