# Backfill `description:` Frontmatter on API Reference Pages

**ADW ID:** e308acf4
**Date:** 2026-07-01
**Plan-Spec:** /home/runner/work/docs/docs/agents/e308acf4/plan/issue-341-adw-e308acf4-backfill-description-frontmatter-plan.md

## Overview

This feature backfills a `description:` frontmatter field onto the ~472 auto-generated API reference endpoint pages that were previously missing it. Mintlify uses this field for search-result snippets, `<meta name="description">`, and Open Graph social previews; without it, those surfaces fall back to truncated raw body text. A new validation gate (`check-frontmatter-description.mjs`) now enforces that all customer-facing MDX pages carry a non-empty description going forward.

## What Was Built

- `description:` frontmatter added to 472 `api-reference/endpoint/*.mdx` stub files
- New linting script `scripts/check-frontmatter-description.mjs` that gates CI on missing or oversized descriptions
- Updated `scripts/generate-api-reference.mjs` to emit `description:` on all newly generated and refreshed stubs
- `STUB_RE` regex updated to remain migration-safe (treats the `description:` line as optional when detecting stubs)

## Technical Implementation

### Files Modified

- `scripts/check-frontmatter-description.mjs` (new, 138 lines): Walks five scoped content directories (`concepts/`, `guides/`, `api-reference/`, `protocols/`, `specifications/`), parses YAML frontmatter, and exits non-zero if any `.mdx` page is missing a `description:` value. Also emits advisory warnings for descriptions longer than 160 characters. Includes a `--self-test` mode with inline assertions.
- `scripts/generate-api-reference.mjs` (+36 / -6 lines): Added `descriptionFor(op)` helper that derives a plain-text, ≤160-char description from an OpenAPI operation's `description` prose field (preferred) or its `summary` field (fallback). Both the new-stub write path and the refresh/overwrite path now include the derived description in the emitted frontmatter.
- `api-reference/endpoint/*.mdx` (472 files, +1 line each): Each stub received a `description: "…"` line inserted between `title:` and `openapi:`.

### Key Changes

- `descriptionFor(op)` strips Markdown markup (headings, bold, italic, backtick code, links, HTML tags) and collapses newlines to produce clean SEO-ready prose; it takes the first sentence if the result exceeds 160 characters.
- `STUB_RE` was updated from `^---\ntitle: .*\nopenapi:` to `^---\ntitle: .*\n(?:description: .*\n)?openapi:` so the refresh pass recognises existing stubs that now carry a description line without falsely treating them as hand-written pages.
- The generator passes the raw `op` object through to `toGen` entries so `descriptionFor` has access to both `op.description` and `op.summary` during generation.
- The check script exits 0 only when every scanned page has a non-empty description; oversized descriptions (>160 chars) are reported as advisory warnings rather than hard failures, preserving existing hand-authored long descriptions.

## How to Use

**Running the description gate manually:**
```bash
node scripts/check-frontmatter-description.mjs
```

**Running the built-in self-test:**
```bash
node scripts/check-frontmatter-description.mjs --self-test
```

**Regenerating API reference stubs (descriptions are now included automatically):**
```bash
node scripts/generate-api-reference.mjs
```

## Configuration

No environment variables or configuration changes are required. The five scoped directories checked by `check-frontmatter-description.mjs` are hardcoded at the top of the script (`concepts/`, `guides/`, `api-reference/`, `protocols/`, `specifications/`). To add a new directory to the gate, extend the `SCOPED` array in that script.

## Testing

- Run `node scripts/check-frontmatter-description.mjs --self-test` to validate the frontmatter parser against seven inline test cases.
- Run `node scripts/check-frontmatter-description.mjs` against the working tree to confirm all 472 backfilled pages now pass.
- Run `node scripts/generate-api-reference.mjs --dry` (if a dry-run flag is supported) or regenerate against the OpenAPI spec and verify new stubs include a `description:` line.

## Notes

- Descriptions longer than 160 characters are flagged as advisory warnings (not hard failures) to avoid breaking any existing hand-authored pages whose descriptions intentionally exceed the SEO limit.
- The `description:` line is omitted entirely (rather than emitted as an empty string) when `descriptionFor` returns an empty result, keeping stubs syntactically clean when the OpenAPI spec lacks both `description` and `summary` for an operation.
- Locale pages (`es/`, `fr/`) are intentionally out of scope for this gate; the walker only covers EN customer-facing directories.
