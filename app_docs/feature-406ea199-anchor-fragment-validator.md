# Anchor / Fragment Deep-Link Validator

**ADW ID:** 406ea199
**Date:** 2026-07-08
**Plan-Spec:** specs/adw/issue-362-adw-406ea199-add-anchor-fragment-validator-plan.md

## Overview

Adds `scripts/check-anchors.mjs`, a zero-dependency link checker that validates the `#fragment` half of internal deep links. The existing link tooling (`mint broken-links`, `check-links-local.mjs`) only confirms that a linked *page* exists, and `check-redirects.mjs` strips `#anchor` entirely — so a deep link like `/concepts/agent-identity#registration` could point at a renamed or deleted heading and ship silently broken. This script closes that gap for both same-page (`#section`) and cross-page (`/path#section`) links.

## What Was Built

- A standalone Node ESM validator (`scripts/check-anchors.mjs`) that walks the docs tree, computes each page's rendered heading anchors, and asserts every internal deep-link fragment resolves.
- An inlined GitHub-slugger-compatible slugifier (no new npm dependency).
- Anchor extraction that mirrors a Markdown renderer: ATX headings only, outside YAML frontmatter and fenced code blocks, with GitHub duplicate-suffix disambiguation (`-1`, `-2`).
- Link extraction for both Markdown (`[text](/path#frag)`, `[text](#frag)`) and JSX/MDX (`href="…#frag"`) forms.
- A built-in `--self-test` mode that spins up a throwaway fixture tree and asserts each anchor class is classified correctly, plus a real-file assertion against `concepts/agent-identity.mdx`.
- A `check:anchors` npm script wired into `package.json`.
- A fix to a pre-existing broken deep-link target: the `## §trusted_sources` heading in `specifications/protection-card-schema.mdx` (the `§` prefix produced no clean anchor).

## Technical Implementation

### Files Modified

- `scripts/check-anchors.mjs`: New 431-line validator — slugifier, anchor extraction, fragment-link extraction, page index, core check, self-test, and CLI.
- `package.json`: Added the `"check:anchors": "node scripts/check-anchors.mjs"` script alongside the other `check:*` link checks.
- `specifications/protection-card-schema.mdx`: Renamed heading `## §trusted_sources` → `## trusted_sources` so its anchor slugifies cleanly.

### Key Changes

- **Page index** (`buildPageIndex`) maps every internal route to its `.mdx` file, folding `/index` pages under both their explicit path and their directory route. Only `.mdx` files are scanned — those are the pages Mintlify actually renders; repo-internal `.md` notes are intentionally out of scope.
- **Anchor extraction** (`extractAnchors`) skips leading YAML frontmatter and any fenced code blocks (` ``` ` / `~~~`), so heading-shaped lines in comments or code never become anchors.
- **Fragment resolution** — same-page links resolve against the current file; cross-page links resolve through the page index. Links whose page does *not* resolve are deliberately ignored (page existence is `check-links-local.mjs`'s job). Fragments are percent-decoded before comparison.
- **Contract parity** with sibling checkers: exit `0` when every fragment resolves, `1` on any unresolved anchor / failed self-test / read error, `2` on bad CLI usage.
- **Known limitation** documented in-file: the slugifier targets GitHub-slugger semantics, which diverge from Mintlify's `@sindresorhus/slugify` on non-ASCII characters and duplicate-counter suffixes; no current link hits those cases.

## How to Use

1. Run the validator against the whole docs tree:
   ```bash
   npm run check:anchors
   ```
2. Read the output: for each unresolved fragment it prints the source file, the raw link, and the missing anchor on the destination page, then a summary line (`scanned N page(s); checked M fragment link(s), K unresolved.`).
3. Fix broken links by correcting the fragment to match the destination heading's slug, or updating the heading.
4. Optionally target a different root or run the self-test:
   ```bash
   node scripts/check-anchors.mjs --root path/to/docs
   node scripts/check-anchors.mjs --self-test
   node scripts/check-anchors.mjs --help
   ```

## Configuration

- `--root <dir>` — docs root to scan (default: repo root, resolved relative to `scripts/`).
- `--self-test` — run the built-in fixtures and exit.
- `--help`, `-h` — show usage.

No environment variables or external dependencies are required.

## Testing

- **Self-test:** `node scripts/check-anchors.mjs --self-test` exercises every anchor class (valid/broken cross-page, same-page, duplicate-heading disambiguation, frontmatter and code-fence exclusion, external/fragment-less ignoring) plus a live assertion against `concepts/agent-identity.mdx`.
- **Full run:** `npm run check:anchors` validates every deep link in the tree.
- This is a docs repo; the relevant verbs are the `check:*` scripts in `package.json` (e.g. `check:links`, `check:path-references`, `check:anchors`).

## Notes

- The validator is intentionally scoped to `.mdx` (rendered) pages; `.md` working notes under `specs/`, `app_docs/`, and `AGENTS.md` quote example links in prose and are out of scope.
- Cross-page links whose *page* does not resolve are silently skipped here by design — that failure is reported by `check-links-local.mjs`, keeping each checker's responsibility single-purpose.
- Revisit the inlined slugifier if the tree ever adds non-ASCII or duplicate-target headings that are linked via deep links.
