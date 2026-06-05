# Spec — Fix AAP pip package name: `agent-alignment-proto` → `agent-alignment-protocol`

- **Status:** Implemented
- **Branch:** bug-issue-201-adw-5d35b6cb-fix-pip-package-name
- **Location:** `introduction.mdx`, `quickstart/sdk-direct.mdx`
- **Related docs:** `AGENTS.md`, `.mnemom/capability.yaml`, `specs/adw/issue-192-adw-e6a00177-onboarding-docs-nits-plan.md`

## Problem / Objective

PR #192 (`e8dc2ca`) "fixed" `introduction.mdx` and `sdk-direct.mdx` to use `agent-alignment-proto` as the canonical AAP Python package name, but that name is wrong. The actual PyPI package is `agent-alignment-protocol`:

- All five AAP protocol docs (`protocols/aap/quickstart.mdx`, `a2a-integration.mdx`, `architecture.mdx`, `mcp-migration.mdx`) use `pip install agent-alignment-protocol`.
- `guides/upgrading-to-1-0.mdx` explicitly shows `pip install 'agent-alignment-protocol==1.0.0'` and its "what changed" table lists both the 0.5.x and 1.0.0 AAP PyPI package as `agent-alignment-protocol`.

This means the introduction and the main SDK quickstart now contradict the rest of the docs and would cause a `pip install` error for anyone following those two pages.

**User Story**

- As an **agent or developer** reading `introduction.mdx` or the SDK direct quickstart,
- I want **the pip package name to match what is actually on PyPI**,
- So that `pip install agent-alignment-protocol` succeeds and I don't waste time debugging a non-existent package.

## Approach & Changes

Two surgical string replacements. No new pages, no nav changes, no build-step changes.

### Files modified

1. **`introduction.mdx`** — three occurrences of `agent-alignment-proto`:
   - The `pip` code block (line 83)
   - The package table row (line 92)
   - The `<Note>` canonical names callout (line 96)
   All three become `agent-alignment-protocol`.

2. **`quickstart/sdk-direct.mdx`** — one occurrence (line 16) in the `pip` code block.
   Becomes `agent-alignment-protocol`.

### Explicitly out of scope

- `changelog.mdx` line 313 (`pip install agent-alignment-proto` under AAP v0.1.0): this is a historical release record. If the SDK was genuinely published under the old name at v0.1.0, changing the changelog entry rewrites history. Flagged for human reviewer: if the package was always `agent-alignment-protocol` on PyPI, the changelog line should also be corrected in a follow-on pass.
- `guides/upgrading-to-0-5.mdx` line 100 (`pip install agent-alignment-proto==0.5.0`): same rationale — that entry records what to install when upgrading to 0.5. The `upgrading-to-1-0.mdx` table implies 0.5.x was already named `agent-alignment-protocol`, which would make this a bug too, but scope is limited to the canonical forward-facing docs.

## Verification

Run from the repo root — each must exit cleanly:

```bash
# Lint (redirect integrity)
npm run check:redirects

# Test (doc-as-spec validator)
npm ci && npm run check:doc-examples

# Assert the stale name is gone from canonical pages
grep -n "agent-alignment-proto" introduction.mdx quickstart/sdk-direct.mdx
# expected: no output

# Assert the correct name is present
grep -n "agent-alignment-protocol" introduction.mdx quickstart/sdk-direct.mdx
# expected: lines 83, 92, 96 (introduction) and line 16 (sdk-direct)
```

`mintlify broken-links` must pass (no link changes, so no new broken links expected).
