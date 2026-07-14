# Aletheia Q&A Grounding-Corpus Manifest

**ADW ID:** 892ca4f7
**Date:** 2026-07-14
**Plan-Spec:** specs/adw/issue-375-adw-892ca4f7-assemble-aletheia-grounding-corpus-plan.md

## Overview

Aletheia (the in-product Q&A assistant, MNE-1934) may ground its answers *only*
on a curated set of trusted, Mnemom-owned sources. Per the Constellation
repo-ownership rule ("docs = Q&A grounding corpus / trusted sources"), this docs
repo now **owns** that source list. This feature adds the manifest
(`scripts/aletheia-corpus-manifest.json`) plus a fail-closed CI validator that
keeps it honest, drift-proof, and non-leaking.

The change is **DARK**: the manifest is a `scripts/` data file (not a Mintlify
page), so it renders nothing and exposes nothing to customers. The retrieval /
ranking engine, the feature flag, and the reviewer allowlist live in other repos
(MNE-1936) and are out of scope — this delivers the manifest and its validation
only.

## What Was Built

- **The grounding-corpus manifest** (`scripts/aletheia-corpus-manifest.json`) —
  636 trusted sources across three collections: 631 `docs` pages, 4
  `knowledgebase` marketing/research pages, and 1 canonical `for-agents` entry.
- **A fail-closed validator** (`scripts/check-grounding-corpus.mjs`) that
  enforces the manifest's shape, uniqueness, URL ownership, collection coverage,
  and exact reconciliation against `docs.json` navigation. Includes a built-in
  `--self-test` suite of in-memory fixtures.
- **An npm script** (`check:grounding-corpus`) and a **BLOCKING CI step** wired
  into `mintlify-ci.yml`, running on all PRs.
- **A validator-health registry entry** (row 10) documenting the gate's trigger,
  cadence, posture, and contract.

## Technical Implementation

### Files Modified

- `scripts/aletheia-corpus-manifest.json` (new): The manifest itself — a
  `manifest_version`, an explanatory `note`, and a `sources[]` array where each
  entry has `source_id`, `collection`, `url`, and `title`.
- `scripts/check-grounding-corpus.mjs` (new, 522 lines): The validator. Node ≥22
  built-ins only (no dependencies). Exports its pure core (`checkCorpus`) and
  helpers so they can be unit-exercised via `--self-test`.
- `.github/workflows/mintlify-ci.yml`: Adds the "Validate Aletheia grounding
  corpus manifest" step (BLOCKING, no `npm ci` required).
- `package.json`: Adds the `check:grounding-corpus` script.
- `specs/docs-validators-health.md`: Adds row 10 to the validator registry.

### Key Changes

The validator enforces, **fail-closed** (a missing/empty/malformed manifest is a
hard failure, never a vacuous pass):

1. **Shape** — `sources` must be a non-empty array of well-formed entries; every
   entry needs a non-empty `title` and a unique `source_id` (every duplicate is
   reported).
2. **URL ownership** — each `url` must be an absolute `https://` URL whose host
   is in a **hard-coded** Mnemom-owned allowlist (`docs.mnemom.ai`,
   `www.mnemom.ai`, `mnemom.ai`, `api.mnemom.ai`, `gateway.mnemom.ai`). The
   allowlist lives in the script (not the manifest) so a manifest edit can never
   widen the definition of "Mnemom-owned." `github.com` is deliberately excluded
   — a private-repo URL must never enter a corpus consumed by a publicly
   auto-deploying repo (private-repo-topology leak safety).
3. **Collection coverage** — at least one entry each in `docs`, `knowledgebase`,
   and `for-agents`; exactly one `for-agents` entry pinned to the canonical
   `https://www.mnemom.ai/for-agents`.
4. **docs↔nav reconciliation** — the `docs` collection must exactly equal the
   set of default-locale (en) navigable pages from `docs.json` (a new docs page
   absent from the corpus, or a corpus entry pointing at a non-navigable slug,
   fails CI), and each docs entry's `title`/`url` must match the backing page's
   real frontmatter title and canonical URL.

The URL check is deterministic and offline (a live fetch would make a blocking
gate flaky and non-reproducible). The validator is a sibling to
`check-model-coverage.mjs` / `check-nav-coverage.mjs` and shares their exit-code
contract.

## How to Use

This is an internal validator, not a customer-facing feature. Contributors
interact with it as follows:

1. **When you add or remove a docs page** in `docs.json` navigation, add or
   remove the matching `docs:<slug>` entry in
   `scripts/aletheia-corpus-manifest.json` (matching `title` and canonical URL).
2. **Run the validator locally** before pushing:
   ```
   npm run check:grounding-corpus
   ```
   It exits 0 when clean and prints the number of trusted sources reconciled;
   on failure it exits 1 and lists each problem with an error code and detail.
3. **Run the built-in self-test** to exercise every rule against fixtures:
   ```
   node scripts/check-grounding-corpus.mjs --self-test
   ```
4. CI runs the same gate automatically on every PR (BLOCKING).

## Configuration

The validator accepts optional flags (defaults resolve from the `scripts/`
directory):

- `--root <dir>` — Docs root (default: repo root).
- `--manifest <path>` — Manifest JSON (default:
  `scripts/aletheia-corpus-manifest.json`).
- `--self-test` — Run built-in fixtures and exit.
- `--help`, `-h` — Show usage.

Exit codes: `0` clean, `1` on any validation or self-test failure, `2` on bad
CLI usage.

The owned-host allowlist and the canonical `for-agents` URL are hard-coded
constants (`OWNED_HOSTS`, `FOR_AGENTS_URL`) in the script — intentionally not
configurable from the manifest.

## Testing

- **Validator gate:** `npm run check:grounding-corpus`
- **Self-test fixtures:** `node scripts/check-grounding-corpus.mjs --self-test`
  (12 assertion groups covering clean pass plus each failure mode: duplicate id,
  empty title, non-owned/non-https/github URL, missing collection, too-many /
  wrong for-agents URL, missing-from-manifest, non-navigable, title/url
  mismatch, fail-closed empty/null/non-object manifest, and index-slug URL
  normalization).
- **CI:** the "Validate Aletheia grounding corpus manifest" step in
  `mintlify-ci.yml` runs on all PRs and daily at 06:00.

## Notes

- **DARK / no customer exposure:** the manifest renders nothing and exposes
  nothing until explicitly promoted. The retrieval engine, feature flag, and
  reviewer allowlist are out of scope (MNE-1936).
- **Human-in-the-loop:** the manifest is human-curated and human-reviewed, never
  machine-mutated. The validator only *checks* the manifest; it does not
  generate or edit entries. Any change is a preliminary contribution subject to
  human review before merge.
- **Corpus is en-only:** reconciliation walks only the default-locale (en)
  navigable pages; `fr`/`es` locale slugs (owned by `check-redirects.mjs`) are
  intentionally excluded, as is the `global` anchors-only section.
