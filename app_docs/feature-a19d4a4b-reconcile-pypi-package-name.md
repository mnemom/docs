# Reconcile AIP PyPI Package Name (`agent-integrity-proto` → `agent-integrity-protocol`)

**ADW ID:** a19d4a4b
**Date:** 2026-06-17
**Plan-Spec:** specs/adw/issue-250-adw-a19d4a4b-reconcile-pypi-package-name-agent-integr-plan.md

## Overview

The AIP Python package was documented throughout the docs as `agent-integrity-proto`, but the canonical PyPI name is `agent-integrity-protocol` — matching the npm package `@mnemom/agent-integrity-protocol`. This change corrects all occurrences across live documentation pages (English, Spanish, French) and adds a new `agents.txt` file that uses the correct name. A developer or agent copying any `pip install` command from the docs will now get the right package instead of a PyPI 404.

## What Was Built

- Corrected the AIP PyPI package name from `agent-integrity-proto` to `agent-integrity-protocol` in all live documentation pages
- Updated English, Spanish, and French locales consistently
- Added `agents.txt` at the repo root with correct install instructions for both AAP and AIP Python packages
- Updated the canonical-name `Note` callout in `introduction.mdx` to reflect the correct name

## Technical Implementation

### Files Modified

- `introduction.mdx`: pip install line, SDK package reference table, and canonical-name Note callout
- `quickstart/sdk-direct.mdx`: pip install code block
- `protocols/overview.mdx`: SDK reference table cell and PyPI URL
- `protocols/aip/quickstart.mdx`: pip install line in the 5-minute quickstart
- `changelog.mdx`: v1.0 launch entry listing the Python SDK
- `guides/upgrading-to-1-0.mdx`: upgrade migration table and pip/uv install code blocks
- `es/quickstart/sdk-direct.mdx`: pip install line (Spanish locale)
- `fr/quickstart/sdk-direct.mdx`: pip install line (French locale)
- `agents.txt` *(new)*: machine-readable install manifest for agent consumers listing both AAP and AIP Python and TypeScript packages

### Key Changes

- All bare occurrences of `agent-integrity-proto` (PyPI token) replaced with `agent-integrity-protocol` across 8 `.mdx` files
- `@mnemom/agent-integrity-protocol` (npm scoped name) was already correct and left untouched
- `agents.txt` created at repo root with identity, install, integration-paths, and machine-readable sections
- PyPI gate confirmed: `agent-integrity-protocol` returns HTTP 200; `agent-integrity-proto` returns HTTP 404 — the rename is safe and the wrong name is not published
- CI workflow `.github/workflows/sdk-examples.yml` was intentionally left out of scope (CI config guardrail); line 213 of that file still references `agent-integrity-proto==` and is flagged for human review

## How to Use

No action required for existing integrations using the TypeScript SDK — the npm package name was already correct. For Python users:

1. Replace any existing `pip install agent-integrity-proto` commands with:
   ```bash
   pip install agent-integrity-protocol
   ```
2. For projects pinning the 1.0.0 release during upgrade, use:
   ```bash
   pip install 'agent-alignment-protocol==1.0.0' 'agent-integrity-protocol==1.0.0'
   ```
3. The import surface of the package is unchanged — only the PyPI distribution name changed.

## Configuration

No configuration changes. This is a documentation-only correction with no runtime or SDK API changes.

## Testing

Run the following grep commands to verify no stale references remain in live docs:

```bash
# Should return zero results (excludes specs/, app_docs/, node_modules, .git):
grep -rn "agent-integrity-proto\b" . --include="*.mdx" --include="*.md" \
  | grep -vE "(specs/|app_docs/|node_modules|\.git)/"

# Should return zero results (guards against accidental double-suffix):
grep -rn "agent-integrity-protocolcol" .
```

## Notes

- This fix mirrors issue #201 which corrected the AAP package name (`agent-alignment-proto` → `agent-alignment-protocol`).
- `.github/workflows/sdk-examples.yml` line 213 still contains `agent-integrity-proto==` and was explicitly left out of scope due to the CI config guardrail; a human reviewer should address it separately.
- If a future rename pass encounters both `agent-integrity-protocol` and `agent-integrity-proto` returning PyPI 200, the operation must be aborted to human review — the wrong name would be published and cannot be safely renamed in docs until PyPI is corrected.
