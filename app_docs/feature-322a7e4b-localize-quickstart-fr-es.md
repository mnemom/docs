# French & Spanish Quickstart Localization

**ADW ID:** 322a7e4b
**Date:** 2026-06-10
**Plan-Spec:** agents/322a7e4b/plan/issue-220-adw-322a7e4b-localize-quickstart-fr-es-plan.md

## Overview

Adds fully localized French (`fr`) and Spanish (`es`) versions of the Getting Started / Quickstart documentation and the MCP Clients guide. The Mintlify navigation (`docs.json`) was migrated from a flat `tabs` structure to a multi-language `languages` structure so readers can switch between English, French, and Spanish, with English remaining the default.

## What Was Built

- A complete French quickstart suite under `fr/` (overview, gateway, SDK direct, self-hosted, safe-house protection) plus the MCP Clients guide.
- A complete Spanish quickstart suite under `es/` mirroring the same six pages.
- A restructured `docs.json` navigation that introduces a top-level `languages` array (`en` as default, plus `fr` and `es`), each exposing a "Démarrage rapide" / "Inicio rápido" tab pointing at the localized pages.
- Translated prose, sidebar titles, descriptions, and internal links (localized hrefs such as `/fr/quickstart/gateway`) while preserving all code samples, commands, YAML, and technical identifiers verbatim.

## Technical Implementation

### Files Modified

- `docs.json`: Converted `navigation.tabs` into `navigation.languages` with `en` (default), `fr`, and `es` entries; added localized quickstart tabs/groups for the two new languages.
- `fr/quickstart/overview.mdx`, `fr/quickstart/gateway.mdx`, `fr/quickstart/sdk-direct.mdx`, `fr/quickstart/self-hosted.mdx`, `fr/quickstart/safe-house-protection.mdx`, `fr/mcp-clients.mdx`: New French pages.
- `es/quickstart/overview.mdx`, `es/quickstart/gateway.mdx`, `es/quickstart/sdk-direct.mdx`, `es/quickstart/self-hosted.mdx`, `es/quickstart/safe-house-protection.mdx`, `es/mcp-clients.mdx`: New Spanish pages.

### Key Changes

- Migrated to Mintlify's multi-language navigation model: each language is an object with a `language` code and its own `tabs`/`groups`/`pages`; `en` carries `"default": true`.
- Localized frontmatter per page (`title`, `description`, `sidebarTitle`) and translated all narrative content, callouts (`<Note>`), card titles, accordions, and comparison tables.
- Internal documentation links inside translated pages point to the language-prefixed routes (e.g. `/fr/quickstart/gateway`, `/es/quickstart/self-hosted`) so navigation stays within the chosen language.
- Code blocks, CLI commands (`mnemom login`, `npm install -g @mnemom/mnemom`), API endpoints, and YAML card examples were left untranslated to preserve correctness — confirmed by matching code-fence counts across the localized files.

## How to Use

1. Build/serve the docs site (Mintlify reads `docs.json`).
2. Use the language switcher in the top navigation to select **English**, **Français**, or **Español**.
3. Open the **Démarrage rapide** (FR) or **Inicio rápido** (ES) tab to browse the localized overview, Gateway, SDK Direct, self-hosted, safe-house protection, and MCP Clients pages.
4. Internal links within a language keep you on the localized routes (`/fr/...`, `/es/...`).

## Configuration

No environment variables or runtime settings. Localization is driven entirely by `docs.json` (the `navigation.languages` array) and the language-prefixed `fr/` and `es/` content directories. Adding another language follows the same pattern: a new `languages` entry plus a matching content directory.

## Testing

- Validate the Mintlify config and links locally (e.g. `mintlify dev` / the project's docs build) to confirm the `languages` navigation renders and all `fr/` and `es/` pages resolve without broken internal links.
- Spot-check the language switcher and that each localized page's frontmatter and internal hrefs resolve to the correct language-prefixed routes.

## Notes

- This is a documentation-only change; no application code, APIs, or runtime behavior were affected.
- Code samples and technical identifiers are intentionally untranslated to avoid introducing errors; only prose, frontmatter, and navigation labels are localized.
- Translations should ideally receive a human language review before release; treat the localized copy as a first pass pending native-speaker sign-off.
