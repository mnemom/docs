# Fix Documented Error-Schema Shape + Add Pasteable Card YAML & Publish Commands

**ADW ID:** 2f00aed2
**Date:** 2026-06-05
**Plan-Spec:** specs/adw/issue-198-adw-2f00aed2-fix-error-schema-add-card-yaml-plan.md

## Overview

This change closes two documentation-correctness gaps surfaced by the 2026-06-04 capability test pass (Linear MNE-242). It (N1) corrects the API error-body shape documented across the `api-reference/*-overview` pages so it matches the canonical nested envelope, and (N2) adds pasteable, validate-first-try card YAML plus the CLI publish command to the concept and quickstart pages so a reader can get from concept to a published card without leaving for the spec pages.

## What Was Built

- **Corrected error envelope across all API overview pages.** Every error example now documents the nested `{"error":{"code","message"}}` object instead of a flat human-readable string, matching the canonical `api-reference/errors.mdx`.
- **`error.code` branching guidance.** New prose on `api-reference/overview.mdx` instructing clients to branch on the stable `error.code` rather than the evolving `error.message`, noting the optional `details` object and linking to the full code taxonomy.
- **Pasteable unified alignment-card YAML** on `concepts/alignment-cards.mdx`, with `mnemom card validate` / `mnemom card publish` commands.
- **Pasteable Protection Card YAML** on both `concepts/safe-house.mdx` and `quickstart/safe-house-protection.mdx`, each with the `mnemom protection publish` command, alongside the existing REST `PUT` path in the quickstart.

## Technical Implementation

### Files Modified

- `api-reference/overview.mdx`: Rewrote the "Error format" section to the nested envelope, added branch-on-`code` guidance, and converted the `429` rate-limit example to the nested shape.
- `api-reference/intelligence-overview.mdx`, `on-chain-overview.mdx`, `policy-overview.mdx`, `reclassification-overview.mdx`, `reputation-overview.mdx`, `safe-house-overview.mdx`, `team-overview.mdx`: Converted every error-body example to the nested `{"error":{"code","message"}}` envelope, preserving each example's domain-specific `code` and message — only the shape changed.
- `concepts/alignment-cards.mdx`: Added a "Minimal card file" section with a valid `card_version: unified/2026-04-26` YAML block (`autonomy_mode`/`integrity_mode` from the four-mode enum) plus the publish commands.
- `concepts/safe-house.mdx`: Added a "Publish your protection card" section with a `card_version: protection/2026-04-26` YAML block and `mnemom protection publish`.
- `quickstart/safe-house-protection.mdx`: Added a "CLI alternative" Protection Card YAML block and publish command next to the existing curl `PUT`.

### Key Changes

- The documented error body is now the MNE-86 nested envelope everywhere customers copy from, eliminating the runtime break where a client reads `response.error` as a string when it is actually an object.
- Stable contract is made explicit: clients are told to switch on `error.code`, with `error.message` flagged as subject to change.
- Card YAML was reused verbatim from the already-validated `specifications/*-card-schema` pages, so the new concept/quickstart snippets pass `check:doc-examples` against the live schemas on the first try (avoiding the MNE-190 schema-mismatch failure class).
- All examples default to `observe` mode, steering readers to log-only before tightening to `nudge`/`enforce`.
- Scope held firm: the unrelated `"error": "..."` payload fields in `concepts/sub-resource-verbs.mdx` and `gateway/enforcement.mdx`, and the N3 marketing copy, were intentionally left untouched.

## How to Use

**Publish an alignment card (from the concept page):**

1. Save the YAML block on `concepts/alignment-cards.mdx` as `alignment-card.yaml` and fill in your `agent_id`.
2. Validate it: `mnemom card validate alignment-card.yaml`.
3. Publish it: `mnemom card publish alignment-card.yaml --agent $AGENT_ID`.
4. Start in `observe` mode, then tighten to `nudge`/`enforce` once you have real-traffic visibility.

**Publish a protection card (from the concept or quickstart page):**

1. Save the YAML block as `protection.card.yaml` and fill in your `agent_id`.
2. Publish it: `mnemom protection publish protection.card.yaml` — or use the existing REST `PUT` path in the quickstart.

**Parse API errors correctly:**

1. Read the `error` field as an object, not a string.
2. Branch program logic on `error.code` (stable); show `error.message` to humans only.
3. Inspect the optional `error.details` object for structured per-code data.

## Configuration

No new configuration, environment variables, or dependencies. All edits are MDX content. Card examples reference `$AGENT_ID` as a placeholder the reader supplies.

## Testing

This is a docs-only change; verify with the project's documentation checks from the worktree root:

- `npm run check:redirects` — redirect / link integrity (manifest `lint`).
- Typecheck is a no-op for MDX docs.
- `npm ci && npm run check:doc-examples` — doc↔OpenAPI + schema example validator; confirms the new card YAML validates and no error example is malformed (manifest `test`).
- Build is a no-op (Mintlify-hosted; validated by CI).
- `npx mintlify broken-links` — required "Validate Mintlify Docs" check; must report no broken internal links.

There is no E2E test: the change touches only prose/MDX content, and there is no E2E harness for the Mintlify site.

## Notes

- Covers MNE-242 **N1 + N2 only**. N3 ("four independently-configurable checkpoints" marketing copy) is handled separately on the website and is out of scope here.
- The card YAML is now intentionally duplicated between the normative `specifications/*-card-schema` pages and the concept/quickstart pages; the shared `check:doc-examples` validator keeps both copies honest against the same schema, so drift is caught in CI.
- This is a **supervised** docs change (`merge_strategy: external`): the worker drives the doc checks green and labels the PR `agent`; a human reviews and merges. It is not auto-merged into the public docs.
- Optional future hardening: extend `scripts/check-doc-examples.mjs` to assert error-body examples conform to the nested envelope, so a flat-string regression fails CI deterministically.
