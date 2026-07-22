# Strip Unshipped `org use` / `agents move` Commands from CLI Docs

**ADW ID:** b176ba69
**Date:** 2026-07-22
**Plan-Spec:** agents/b176ba69/plan/issue-407-adw-b176ba69-docs-strip-unshipped-org-use-agents-move-plan.md

## Overview

Removed all documentation for `mnemom org use` (active-org selection) and `mnemom agents move`, two commands that were documented in `gateway/cli.mdx` but were never shipped and are not planned (MNE-2290). The live CLI v0.16.2 only exposes `org list`, `org show`, and `agents claim`. All references to the "active org" concept were also stripped to align docs with the shipped CLI surface.

## What Was Built

- Rewrote the post-login `<Note>` to remove active-org language and the dangling `#mnemom-org-use` anchor link
- Removed the active-org clause (`*active` tag) from the `mnemom org list` description
- Removed the entire `### mnemom org use` section (heading, description, code block, resolution-order paragraph)
- Updated the `--org` bullet under `mnemom agents claim` to remove the active-org default reference
- Removed the entire `### mnemom agents move <id-or-name>` section (heading, description, code block, `--to` and idempotent-no-op bullets)
- Rewrote the `<Note>` following the removed `agents move` section to keep only the still-valid re-claim possession-based re-homing description

## Technical Implementation

### Files Modified

- `gateway/cli.mdx`: Six targeted edits removing all references to `mnemom org use`, `mnemom agents move`, and the "active org" concept; rewritten notes now accurately reflect `--org` flag usage and possession-based re-homing

### Key Changes

- The post-login note now reads: org-scoped commands target an org via `--org`, defaulting to personal org when omitted — no active-org concept mentioned
- `mnemom org list` description no longer mentions the `*active` tag (the `(personal)` tag description is preserved)
- The complete `mnemom org use` section (including the `~/.mnemom/config.json` persistence detail and resolution-order paragraph) is removed
- The `mnemom agents move` section and its `--to` flag description are removed; the trailing `<Note>` is rewritten to keep only the re-claim path
- The `--org` default description under `agents claim` now reads: "Defaults to your personal org (with a loud notice) when omitted"

## How to Use

This is a documentation-only change with no user-facing action required. Readers of `gateway/cli.mdx` will no longer see instructions for unshipped commands. Existing workflows using `org list`, `org show`, and `agents claim` are unaffected.

## Configuration

No configuration changes. This is a content-only edit to a single MDX file.

## Testing

```bash
# Verify no remaining references to stripped commands/concepts
grep -n "org use\|agents move\|active org\|active-org\|mnemom-org-use" gateway/cli.mdx
# Must return no output

# Verify shipped commands remain
grep -n "org list\|org show\|agents claim" gateway/cli.mdx
# Must return entries

# Anchor integrity and internal-reference checks
npm run check:anchors
npm run check:path-references
npm run check:nav-pages
```

## Notes

- Two pre-existing red CI checks (Mintlify app_docs URIError, i18n translation-lag on fr/es quickstart) remain unrelated to this change and fail on all open PRs. Only "Block internal-reference leakage" is required for merge.
- `guides/agent-claim-flow.mdx` lines 147–159 also document `mnemom org use` and are out of scope for this PR; a follow-up ticket under the command-drift class should clean that page.
- The path-reference check flag for `/agents/{}/move` in `guides/agent-claim-flow.mdx` line 188 is a pre-existing issue unrelated to these edits.
