# Aletheia Grounding Corpus — Body Export

**ADW ID:** b12fc214
**Date:** 2026-07-16
**Plan-Spec:** specs/adw/issue-398-adw-b12fc214-export-corpus-with-body-plan.md

## Overview

The Aletheia grounding-corpus manifest lists trusted, Mnemom-owned sources as pure *metadata* (id / collection / url / title) and carries no page content — so on its own it cannot ground a Q&A answer. This feature adds a script that derives a content-bearing artifact, `scripts/aletheia-corpus-with-body.json`, by composing the actual page body for every `docs` source from the manifest plus the docs pages on disk, and a fail-closed CI gate that keeps that artifact byte-for-byte in sync.

## What Was Built

- A new exporter, `scripts/export-corpus-with-body.mjs`, that reads the grounding-corpus manifest and, for each `docs` source, composes a `body` from the backing page.
- Two composition modes:
  - A page with a real markdown body → that body (content after frontmatter).
  - A frontmatter-only page (e.g. an OpenAPI-generated API-reference page) → its `description` + the `openapi` operation line as a fallback.
- A versioned output artifact, `scripts/aletheia-corpus-with-body.json` (631 `docs` entries), wrapping the entries with `manifest_version` and `generated_from` provenance.
- A `--check` mode that verifies the committed artifact is present, has no empty bodies, and is byte-for-byte identical to what the manifest + pages produce now (drift detection).
- A fail-closed validation rule: a missing/unparseable/empty manifest, or any entry that would export an empty body, is a hard exit 1 in both generate and check modes.
- A built-in `--self-test` covering both compose modes, the docs-only filter, empty-body validation, and stable serialization.
- Two npm scripts (`export:corpus-body`, `check:corpus-body`). Wiring `check:corpus-body` into CI is intentionally left as a human-authored follow-up (see *Acceptance-criteria deviations* below) — `.github/workflows/` is a NEVER-AUTO protected path.

## Technical Implementation

### Files Modified

- `scripts/export-corpus-with-body.mjs`: **New (398 lines).** The exporter/checker CLI. Node built-ins only (no `npm ci` needed). Exports its core functions (`parseFrontmatterField`, `extractMarkdownBody`, `composeBody`, `resolvePageText`, `buildBodyCorpus`, `validateBodies`, `buildArtifact`, `serializeArtifact`) so they are unit-exercisable and run the CLI only when executed directly.
- `scripts/aletheia-corpus-with-body.json`: **New (4423 lines).** The generated content artifact — one entry per `docs` source, in manifest order, each with `source_id`, `collection`, `url`, `title`, and composed `body`.
- `package.json`: Added `export:corpus-body` (generate) and `check:corpus-body` (verify with `--check`) scripts.
- `.github/workflows/mintlify-ci.yml`: **Intentionally NOT modified by this change.** Although the issue authorized adding an additive `npm run check:corpus-body` step, `.github/workflows/` is a NEVER-AUTO protected path that the autonomous worker must not edit. The CI wiring is deferred to a human-authored follow-up (see *Acceptance-criteria deviations*); the `check:corpus-body` npm script is ready to drop into a new step.

### Key Changes

- **Derivation, not duplication.** The manifest remains the system of record; the body artifact is derived from it, so it can be regenerated deterministically. `generated_from` records which manifest produced the content.
- **Docs-only scope (631 entries, not 632).** Only the `docs` collection has local backing pages, so only it carries a body. Non-`docs` sources are intentionally excluded — the manifest stays their system of record: the 4 `knowledgebase` sources are external marketing pages with no local file. The acceptance criterion grouped the single `for-agents` source (`for-agents:www`) with `docs` as "1:1 mappable to an `.mdx` file" (632 entries), but that is inaccurate: `for-agents:www` resolves to the marketing site `https://www.mnemom.ai/for-agents` (not `docs.mnemom.ai`), so no docs page backs it — and the local "for agents" landing page is *already* exported here as the separate `docs:for-agents/index` entry. Re-exporting the same body under a marketing-site URL/id would be misattributed duplication, so `for-agents:www` is excluded and the artifact holds **631** `docs` entries by design. This resolves the AC's 632 figure per-criterion rather than silently omitting the entry.
- **Slug resolution mirrors Mintlify.** `<slug>.mdx|.md` and `<slug>/index.mdx|.md` both back a slug, matching how Mintlify serves `foo/index.mdx` at `/foo`.
- **Fail-closed on empty bodies.** `validateBodies` rejects any missing/whitespace-only body in both modes, so an invalid artifact is never written or allowed to drift in (mirrors `check-grounding-corpus.mjs`, advisory MNE-442).
- **Canonical serialization** (2-space indent + trailing newline) is shared by the writer and the `--check` drift comparison, so they can never disagree.
- **Dark change.** The artifact is a `scripts/` data file, not a Mintlify page — it renders nothing and exposes nothing to customers. The retrieval/ranking engine and feature flag live in other repos and are out of scope.

## Acceptance-criteria deviations

Two acceptance criteria could not be satisfied exactly as written; both are resolved here with an explicit audit trail rather than silently:

1. **AC1's "632 entries, confirmed 1:1 mappable" was factually inaccurate for `for-agents:www`.** AC1 asked the artifact to cover every `docs` *or* `for-agents` entry (632 of 636), asserting each maps 1:1 to an existing `.mdx` file. That is true for the 631 `docs` entries but **not** for the single `for-agents` entry (`for-agents:www`): its URL is the marketing site `https://www.mnemom.ai/for-agents`, which no docs `.mdx` backs, and the local for-agents landing page is already exported as the distinct `docs:for-agents/index` entry. Exporting the same body a second time under a marketing-site URL/id would be misattributed duplication. **Resolution:** `for-agents:www` is excluded and the artifact holds 631 entries by design. AC2's "include or exclude with a documented note" exemption was written only for `knowledgebase`; applying the same documented-exclusion treatment to `for-agents:www` is a deliberate, documented deviation for a human reviewer to confirm.

2. **The CI-wiring portion of the scope is deferred to a human follow-up.** The issue authorized adding an additive `npm run check:corpus-body` step to `.github/workflows/mintlify-ci.yml`, but that path is a NEVER-AUTO protected path the autonomous worker must not edit. **Resolution:** the workflow file is left untouched; the `check:corpus-body` npm script is ready to drop into a new step. A follow-up should add:

   ```yaml
   - name: Validate grounding corpus body export
     run: npm run check:corpus-body
   ```

   Until then, run `npm run check:corpus-body` locally / manually to guard the artifact.

## How to Use

1. Regenerate the artifact after editing the manifest or a backing page:
   ```bash
   npm run export:corpus-body
   ```
2. Commit the updated `scripts/aletheia-corpus-with-body.json`.
3. Verify it is valid and in sync (what the CI step should run once wired in — see *Acceptance-criteria deviations*):
   ```bash
   npm run check:corpus-body
   ```
4. If the check fails with a drift error, re-run `npm run export:corpus-body` and commit the result.

## Configuration

The CLI accepts optional flags (defaults resolve relative to `scripts/`):

- `--root <dir>` — docs root (default: repo root).
- `--manifest <path>` — manifest JSON (default: `scripts/aletheia-corpus-manifest.json`).
- `--out <path>` — artifact JSON (default: `scripts/aletheia-corpus-with-body.json`).
- `--check` — verify only, write nothing; exit 1 on drift or empty bodies.
- `--self-test` — run built-in fixtures and exit.
- `--help`, `-h` — show usage.

Exit codes: `0` clean; `1` on any failure (missing/unparseable manifest, empty body, drift, or self-test failure); `2` on bad CLI usage.

## Testing

- **Self-test:** `node scripts/export-corpus-with-body.mjs --self-test` runs in-memory fixtures for both compose modes, the docs-only filter, `validateBodies`, and stable serialization.
- **Drift/validity gate:** `npm run check:corpus-body` (intended for CI once wired in — see *Acceptance-criteria deviations*) confirms the committed artifact is present, has no empty bodies, and matches regeneration byte-for-byte.
- **Regenerate + diff:** run `npm run export:corpus-body` and confirm `git diff` on `scripts/aletheia-corpus-with-body.json` is empty when nothing upstream changed.

## Notes

- The import path / fetch mechanism for consumers is to be coordinated with the gateway-wiring card (MNE-1975); the versioned wrapper (`manifest_version`, `generated_from`) insulates that consumer from format churn.
- The retrieval engine that will use this corpus (MNE-1936) and its feature flag live in other repos and are out of scope here — this change is the content export and its freshness gate only.
- The CI wiring for `check:corpus-body` is a deferred human follow-up (NEVER-AUTO path); once added it is additive and independent of the existing `check:grounding-corpus` manifest gate.
