# Fix AAP PyPI Package Name (`agent-alignment-proto` → `agent-alignment-protocol`)

**ADW ID:** 5d35b6cb
**Date:** 2026-06-05
**Plan-Spec:** specs/adw/issue-201-adw-5d35b6cb-fix-pip-package-name-plan.md

## Overview

Several documentation pages referenced the Python AAP package as `agent-alignment-proto`, a name that does not exist on PyPI and returns a 404 on both `pip install` and the `pypi.org/project/...` URL. This change replaces every standalone occurrence of the broken short name with the canonical, published name `agent-alignment-protocol` so that every copy-pasteable install command and link resolves to a real, installable package.

## What Was Built

- Corrected the Python AAP package name across the live documentation surface (install commands, a reference-table cell, and a PyPI link).
- Eliminated the copy-paste 404 (`ERROR: No matching distribution found for agent-alignment-proto`) at its source.
- Completed the repo-wide docs sweep started in a prior pass (which had fixed only `introduction.mdx` and `quickstart/sdk-direct.mdx`).

## Technical Implementation

### Files Modified

- `changelog.mdx`: AAP v0.1.0 release note — `pip install agent-alignment-proto` → `pip install agent-alignment-protocol`.
- `protocols/overview.mdx`: "SDK packages" reference table — corrected the `agent-alignment-proto` cell and its PyPI link `https://pypi.org/project/agent-alignment-proto/` → `.../agent-alignment-protocol/`.
- `guides/upgrading-to-0-5.mdx`: CodeGroup `pip install agent-alignment-proto==0.5.0` and the "Update SDK packages" prose line `agent-alignment-proto==0.5.0 (pip)` → `agent-alignment-protocol==0.5.0`.
- `introduction.mdx`: install command, package reference-table row, and the "Canonical Python package names" callout — all updated to `agent-alignment-protocol`.
- `quickstart/sdk-direct.mdx`: `pip install agent-alignment-proto agent-integrity-proto` → `pip install agent-alignment-protocol agent-integrity-proto`.

### Key Changes

- Replaced only the **bare token** `agent-alignment-proto` with `agent-alignment-protocol`. This is the critical guardrail: the correct name *contains* the broken name as a prefix, so an unbounded find-and-replace would corrupt it into `agent-alignment-protocolcol`.
- Left the AIP Python package `agent-integrity-proto` untouched — that is the real published name.
- Left the npm package `@mnemom/agent-alignment-protocol` untouched — already correct.
- Left historical artifacts under `app_docs/` and `specs/` unchanged, per the issue Guardrails.

## How to Use

This is a documentation correction; readers benefit automatically. To install the AAP Python SDK using the now-correct name:

1. Run `pip install agent-alignment-protocol` (or pin a version, e.g. `pip install agent-alignment-protocol==0.5.0`).
2. The command resolves to the real PyPI distribution and installs successfully.
3. Browse the package at `https://pypi.org/project/agent-alignment-protocol/`.

## Configuration

None. No code, dependencies, or configuration were changed — this is a prose/MDX edit only.

## Testing

- **No-corruption guard:** `grep -rn 'agent-alignment-protocolcol' .` returns nothing.
- **Offenders gone:** `grep -rn 'agent-alignment-proto\b' . --include='*.mdx' --include='*.md' | grep -vE '(^|/)(app_docs|specs|node_modules|\.git)/'` returns zero hits in live docs.
- **AIP references unchanged:** `grep -rc 'agent-integrity-proto' . --include='*.mdx' --include='*.md'` count matches the pre-fix snapshot.
- **Lint:** `npm run check:redirects` (redirect integrity).
- **Test:** `npm ci && npm run check:doc-examples` (doc↔OpenAPI example validator).
- **Required CI check:** `Validate Mintlify Docs` (`mintlify broken-links`) — the PyPI URL change keeps the link valid.

## Notes

- Scope is the live documentation surface (what readers install from). The bare name intentionally remains in `app_docs/` and `specs/adw/` planning files as historical artifacts, per the issue Guardrails.
- The capability manifest is `merge_strategy: external` (supervised / human-in-the-loop). This change does not alter that contract: AI output is preliminary — the PR is driven to green checks and labeled `agent`, and the final merge decision is made by a human reviewer.
