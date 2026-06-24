# Fix Broken Heading Hierarchy in Policy DSL Specification

**ADW ID:** 9cf2b284
**Date:** 2026-06-24
**Plan-Spec:** specs/adw/issue-291-adw-9cf2b284-fix-policy-dsl-heading-hierarchy-plan.md

## Overview

The Policy DSL specification page (`specifications/policy-dsl.mdx`) declared an explicit `# Policy DSL specification` H1 heading in the body, even though the page already produces an H1 from its frontmatter `title`. This duplicated top-level heading broke the document's heading hierarchy. The fix removes the redundant in-body H1 so the frontmatter title is the sole H1 and the remaining `##`/`###` sections nest correctly beneath it.

## What Was Built

- Removed the redundant in-body H1 heading from the Policy DSL specification page
- Restored a valid, single-root heading hierarchy (one H1 from frontmatter → H2 sections → H3/H4 subsections)

## Technical Implementation

### Files Modified

- `specifications/policy-dsl.mdx`: Deleted the `# Policy DSL specification` H1 line (and its trailing blank line) that immediately followed the frontmatter and intro paragraph.

### Key Changes

- The page's frontmatter already defines `title: "Policy DSL Specification"`, which Mintlify renders as the page H1. The explicit body-level `# Policy DSL specification` produced a second H1, yielding two competing top-level headings.
- Removing the body H1 makes the frontmatter title the single H1, so the existing `## Schema version`, `## Complete schema definition`, and subsequent sections now nest correctly under one root.
- Change is minimal and content-only: 2 lines deleted, no prose or schema content altered.

## How to Use

This is a documentation correction; no user action is required. To view the corrected page:

1. Build or preview the docs site.
2. Navigate to the Policy DSL specification page under `specifications/`.
3. Confirm the page shows a single top-level title followed by properly nested `##` sections.

## Configuration

No configuration changes. No environment variables or settings are involved.

## Testing

- Run the docs lint / Mintlify validation used by the project (e.g. `mint broken-links` / the repo's docs check) to confirm no heading or link warnings.
- Visually verify in a local docs preview that the page has exactly one H1 and that the table of contents reflects a clean hierarchy.

## Notes

- Heading hierarchy matters for accessibility (screen-reader navigation) and for auto-generated tables of contents; a single H1 per page is the expected convention for Mintlify `.mdx` pages whose frontmatter supplies the title.
- Scope is limited to `specifications/policy-dsl.mdx`; other specification pages were not modified.
