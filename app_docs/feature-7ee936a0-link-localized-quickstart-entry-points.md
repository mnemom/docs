# Link Localized Quickstart Entry Points

**ADW ID:** 7ee936a0
**Date:** 2026-06-24
**Plan-Spec:** N/A

## Overview

Added language-discovery `<Note>` banners to the five English quickstart pages so readers know that Spanish and French translations exist and can navigate directly to them. Previously, the localized pages were translated but undiscoverable from the English originals.

## What Was Built

- Language-switcher `<Note>` block added to `quickstart/overview.mdx`
- Language-switcher `<Note>` block added to `quickstart/gateway.mdx`
- Language-switcher `<Note>` block added to `quickstart/safe-house-protection.mdx`
- Language-switcher `<Note>` block added to `quickstart/sdk-direct.mdx`
- Language-switcher `<Note>` block added to `quickstart/self-hosted.mdx`

## Technical Implementation

### Files Modified

- `quickstart/overview.mdx`: Added `<Note>` linking to `/es/quickstart/overview` and `/fr/quickstart/overview`
- `quickstart/gateway.mdx`: Added `<Note>` linking to `/es/quickstart/gateway` and `/fr/quickstart/gateway`
- `quickstart/safe-house-protection.mdx`: Added `<Note>` linking to `/es/quickstart/safe-house-protection` and `/fr/quickstart/safe-house-protection`
- `quickstart/sdk-direct.mdx`: Added `<Note>` linking to `/es/quickstart/sdk-direct` and `/fr/quickstart/sdk-direct`
- `quickstart/self-hosted.mdx`: Added `<Note>` linking to `/es/quickstart/self-hosted` and `/fr/quickstart/self-hosted`

### Key Changes

- Each English quickstart page now opens with a Mintlify `<Note>` component placed immediately after the `h1` heading
- The `overview.mdx` note uses slightly different copy ("These five quickstart pages are also available in…") to reflect that it is the index page covering all five guides
- The four individual quickstart pages use consistent copy ("This page is also available in… — five quickstart pages translated in total.")
- Links target canonical `/es/` and `/fr/` route prefixes that were already served by the existing translated content
- No nav changes, no new files — purely additive inline metadata

## How to Use

Readers who land on any English quickstart page will see the note banner at the top and can click the inline links to switch to the Spanish or French version of the same page.

1. Navigate to any quickstart page (e.g. `/quickstart/gateway`)
2. Observe the `<Note>` banner below the page title
3. Click **Español** or **Français** to open the translated equivalent

## Configuration

No configuration required. The `/es/` and `/fr/` route prefixes are handled by the existing docs routing configuration.

## Testing

- Run `npm run build` (or the project's lint/check command) to verify no MDX parse errors were introduced
- Open each of the five English quickstart pages in a browser and confirm the `<Note>` banner renders
- Click each language link and confirm it resolves to the correct translated page

## Notes

This change is purely additive and non-breaking. The translated pages (`/es/quickstart/*` and `/fr/quickstart/*`) must already exist and be reachable for the links to be valid — these were produced by the prior localization work (ADW 322a7e4b). If additional languages are added in the future, the note copy in each of these five files will need to be updated manually.
