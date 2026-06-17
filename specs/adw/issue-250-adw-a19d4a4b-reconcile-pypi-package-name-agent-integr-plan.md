# Spec — Reconcile PyPI package name (`agent-integrity-proto` → `agent-integrity-protocol`)

- **Status:** Done
- **Branch:** chore-issue-250-adw-a19d4a4b-reconcile-pypi-package-name-agent-integr
- **Linear:** MNE-625
- **Location:** introduction.mdx, quickstart/sdk-direct.mdx, protocols/overview.mdx, protocols/aip/quickstart.mdx, changelog.mdx, guides/upgrading-to-1-0.mdx, es/quickstart/sdk-direct.mdx, fr/quickstart/sdk-direct.mdx

## Problem / Objective

The AIP Python package was documented as `agent-integrity-proto` throughout the docs, but the canonical PyPI name is `agent-integrity-protocol` — matching the pattern of the npm package `@mnemom/agent-integrity-protocol` (without the scope prefix). This is the exact same class of bug fixed for AAP in issue #201 (`agent-alignment-proto` → `agent-alignment-protocol`).

An agent or developer copying `pip install agent-integrity-proto` would hit a PyPI 404 or install the wrong package.

The inconsistency also surfaced in `agents.txt` (on the marketing site, out of scope for this repo) which named the package differently from the docs.

## Approach & Changes

Replace every standalone `agent-integrity-proto` (bare PyPI token) with `agent-integrity-protocol` in live documentation pages. Leave `@mnemom/agent-integrity-protocol` (npm scoped name, already correct) untouched.

Files changed:
- **`introduction.mdx`** — pip install line, package reference table, canonical-name Note callout
- **`quickstart/sdk-direct.mdx`** — pip install line
- **`protocols/overview.mdx`** — SDK reference table cell and PyPI URL
- **`protocols/aip/quickstart.mdx`** — pip install line
- **`changelog.mdx`** — v1.0 launch entry
- **`guides/upgrading-to-1-0.mdx`** — upgrade table and pip/uv install code blocks
- **`es/quickstart/sdk-direct.mdx`** — pip install line (Spanish locale)
- **`fr/quickstart/sdk-direct.mdx`** — pip install line (French locale)

Out of scope per guardrails:
- `.github/workflows/sdk-examples.yml` — CI config guardrail; note: contains `agent-integrity-proto==` on line 213, flagged for human reviewer
- `specs/adw/` and `app_docs/` — historical artifacts
- `docs.json`, images, lockfiles

## Verification

```bash
# No bare agent-integrity-proto in live docs (only @mnemom-scoped npm references remain):
grep -rn "agent-integrity-proto\b" . --include="*.mdx" --include="*.md" | grep -vE "(specs/|app_docs/|node_modules|\.git)/"

# No corruption from prefix-replace:
grep -rn "agent-integrity-protocolcol" .
```

Both commands return zero output after the fix.

### PyPI gate outcome (advisory: double-404 edge case)

Before editing, the implementing agent verified:
- `agent-integrity-protocol` → PyPI **200** (the canonical name is published; edits are safe)
- `agent-integrity-proto` → PyPI **404** (the wrong name is not published; no rollback risk)

If a future re-run of this class of fix encounters both names returning 404 (neither name published
on PyPI), that is an ambiguous state with no ground truth — **abort to human before proceeding**;
do not fall through to edits based solely on npm-name coherence. If `agent-integrity-protocol`
returns 200 *and* `agent-integrity-proto` also returns 200, abort: the wrong name is published and
the rename cannot proceed until PyPI is corrected first.
