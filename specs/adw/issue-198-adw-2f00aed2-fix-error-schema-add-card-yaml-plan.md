# Spec — Fix documented error-schema shape + add pasteable card YAML & publish commands (MNE-242 N1+N2)

- **Status:** Draft
- **Branch:** bug-issue-198-adw-2f00aed2-fix-error-schema-add-card-yaml
- **Location:** api-reference/overview.mdx, api-reference/intelligence-overview.mdx, api-reference/on-chain-overview.mdx, api-reference/policy-overview.mdx, api-reference/reclassification-overview.mdx, api-reference/reputation-overview.mdx, api-reference/safe-house-overview.mdx, api-reference/team-overview.mdx, concepts/alignment-cards.mdx, concepts/safe-house.mdx, quickstart/safe-house-protection.mdx
- **Related docs:** api-reference/errors.mdx (canonical error taxonomy, MNE-86 envelope), specifications/alignment-card-schema.mdx (unified card YAML), specifications/protection-card-schema.mdx (protection card YAML), AGENTS.md (repo conventions), Linear MNE-242

## Problem / Objective

Two docs-only accuracy gaps surfaced by the 2026-06-04 capability test pass (Linear MNE-242). Both are documentation correctness defects: a customer who codes to what the docs say will break. N3 of the Linear issue ("four independently-configurable checkpoints" marketing copy) lives on the website and is **out of scope here**.

### Problem Statement

**N1 — API error-schema doc shape is wrong.** The `api-reference/overview` page (and adjacent error-format examples on the per-domain `*-overview` pages) document the API error body as a flat, human-readable string. The live API actually returns a structured object — `{"error":{"code":"...","message":"..."}}` — consistently across `400`/`401`/`404` (the canonical envelope per MNE-86, documented authoritatively in `api-reference/errors.mdx`). A customer parsing the documented flat-string shape (e.g. reading `response.error` as a string) fails at runtime because `error` is actually an object. Codes are the stable contract; clients must branch on `error.code`, not the message.

**N2 — Concept/quickstart card pages lack pasteable YAML + the publish command.** The only valid, copy-pasteable card YAML in the docs lives on the `specifications/*-card-schema` pages. The conceptual and quickstart pages that a customer reads first are missing it:
- `concepts/alignment-cards` shows a JSON example only — no YAML, and no `mnemom card publish` command.
- `concepts/safe-house` and `quickstart/safe-house-protection` show only a REST `PUT` reference — no Protection Card YAML and no CLI command.

A reader cannot get from the concept page to a working, publishable card without leaving for the spec pages.

### Steps to Reproduce

**N1:**
1. Open `api-reference/overview.mdx` → "Error format" section (and the same section on each `api-reference/*-overview.mdx`).
2. Observe the documented error body is a flat string rather than the nested `{"error":{"code","message"}}` object.
3. Compare with `api-reference/errors.mdx` (lines 16, 83, 108) and the live API — they use the nested envelope. The overview pages disagree with the canonical doc.

**N2:**
1. Open `concepts/alignment-cards.mdx` — search for a fenced ```yaml card example and `mnemom card publish`. Neither is present (only JSON).
2. Open `concepts/safe-house.mdx` and `quickstart/safe-house-protection.mdx` — search for a Protection Card ```yaml example and `mnemom protection publish`. Neither is present (only a REST `PUT`).
3. Contrast with `specifications/alignment-card-schema.mdx` and `specifications/protection-card-schema.mdx`, which carry valid, validate-first-try YAML.

### Root Cause Analysis

- **N1:** The per-domain overview pages were authored before the error envelope was standardized to the MNE-86 nested shape (`{"error":{"code","message"}}`). The flat-string examples were never reconciled against the canonical `api-reference/errors.mdx`. Root cause: the overview error examples drifted from the canonical envelope and the doc-example validator did not (yet) catch a prose error-shape mismatch.
- **N2:** Pasteable card YAML was written once on the normative `specifications/*-card-schema` pages and never duplicated onto the higher-traffic concept/quickstart pages. Root cause: the onboarding pages were written REST-first and never gained the CLI + YAML path that the spec pages already prove out.

## Approach & Changes

Surgical, docs-only edits. Reuse the already-validated YAML from the spec pages verbatim (they pass `check:doc-examples`) so the new snippets validate first-try, and align every error example with the canonical nested envelope from `api-reference/errors.mdx`.

Relevant files and why they matter:

- **`api-reference/overview.mdx`** — primary N1 target. "Error format" section + the `429` rate-limit error example must document `{"error":{"code","message"}}`. (Note: `api-reference/` is OpenAPI-generated for *endpoint* pages, but these hand-written `*-overview.mdx` narrative pages are editable per AGENTS.md — only `api-reference/endpoint/*` is generated.)
- **`api-reference/intelligence-overview.mdx`, `on-chain-overview.mdx`, `policy-overview.mdx`, `reclassification-overview.mdx`, `reputation-overview.mdx`, `safe-house-overview.mdx`, `team-overview.mdx`** — adjacent error-format examples found by grepping `"error"` JSON blocks. Each must use the nested envelope. These are the "grep for adjacent error-format examples" the issue calls for.
- **`api-reference/errors.mdx`** — canonical reference; **read, do not change**. It already uses the nested envelope and is the source of truth for the correct shape and code taxonomy.
- **`specifications/alignment-card-schema.mdx`** — source of the minimal unified alignment-card YAML to reuse (`card_version: unified/2026-04-26`, `autonomy_mode`, `integrity_mode`, four-mode enum). Read, do not change.
- **`specifications/protection-card-schema.mdx`** — source of the minimal Protection Card YAML (`card_version: protection/2026-04-26`, `mode`) to reuse. Read, do not change.
- **`concepts/alignment-cards.mdx`** — N2 target: add a pasteable unified alignment-card YAML block + `mnemom card publish agent.card.yaml`.
- **`concepts/safe-house.mdx`** — N2 target: add a pasteable Protection Card YAML block + `mnemom protection publish protection.card.yaml`.
- **`quickstart/safe-house-protection.mdx`** — N2 target: add the same Protection Card YAML + `mnemom protection publish` command alongside the existing REST `PUT` so the quickstart has a CLI path.

The CLI verbs already exist in the docs and must be reused exactly as documented elsewhere: `mnemom card publish agent.card.yaml` (see `concepts/agent-cards.mdx`) and `mnemom protection publish protection.card.yaml` (see `concepts/protection-card.mdx`). Do **not** invent new command names.

### Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the canonical sources of truth
- Read `api-reference/errors.mdx` to confirm the exact nested envelope shape (`{"error":{"code","message"}}`) and that some errors add an optional `details` object. This is the shape every example must match.
- Read the YAML examples in `specifications/alignment-card-schema.mdx` (the `card_version: unified/2026-04-26` block with `autonomy_mode`/`integrity_mode`) and `specifications/protection-card-schema.mdx` (the `card_version: protection/2026-04-26` block). These are the validate-first-try snippets to reuse.
- Confirm the documented CLI verbs in `concepts/agent-cards.mdx` (`mnemom card publish`) and `concepts/protection-card.mdx` (`mnemom protection publish`).

### 2. Fix the primary error schema (N1) — `api-reference/overview.mdx`
- In the "Error format" section, ensure the documented error body is the nested object:
  ```json
  {
    "error": {
      "code": "error_code",
      "message": "Human-readable error message"
    }
  }
  ```
- Add the guidance line: branch on `error.code` (stable contract), not `error.message` (may evolve); note the optional `details` object; link to `/api-reference/errors`.
- Update the `429` rate-limit response example in the same file to the nested `{"error":{"code":"rate_limited","message":"Rate limit exceeded"}}` shape.

### 3. Fix adjacent error examples (N1) across the per-domain overview pages
- For each of `api-reference/intelligence-overview.mdx`, `on-chain-overview.mdx`, `policy-overview.mdx`, `reclassification-overview.mdx`, `reputation-overview.mdx`, `safe-house-overview.mdx`, `team-overview.mdx`: update every error-body example to the nested `{"error":{"code","message"}}` envelope. Preserve each example's domain-specific `code` value and message text; only the *shape* changes.
- Re-grep to confirm no flat-string error schema remains on any `api-reference/*-overview.mdx` page: `grep -rn '"error"' api-reference/*-overview.mdx` and verify each hit is an object opener, not a string assignment.
- Note: leave `concepts/sub-resource-verbs.mdx` and `gateway/enforcement.mdx` as-is — those `"error": "..."` strings are unrelated payload fields (a precondition reason and a gateway status), not the API error envelope, and are out of the N1 scope.

### 4. Add pasteable unified alignment-card YAML + publish command (N2) — `concepts/alignment-cards.mdx`
- Add a fenced ```yaml block with a minimal, valid **unified** alignment card reused from `specifications/alignment-card-schema.mdx`: `card_version: unified/...`, plus `autonomy_mode` and `integrity_mode` from the four-mode enum (`off | observe | nudge | enforce`). Do NOT use the retired `aap_version`/`autonomy_envelope` shape (that mismatch was MNE-190, already fixed).
- Immediately follow the YAML with the CLI publish command: `mnemom card publish agent.card.yaml`.

### 5. Add pasteable Protection Card YAML + publish command (N2) — `concepts/safe-house.mdx`
- Add a fenced ```yaml block with a minimal, valid Protection Card reused from `specifications/protection-card-schema.mdx` (`card_version: protection/...`, `mode`).
- Follow it with `mnemom protection publish protection.card.yaml`, keeping any existing REST `PUT` reference for completeness.

### 6. Add the same YAML + publish command to the quickstart (N2) — `quickstart/safe-house-protection.mdx`
- Add the Protection Card ```yaml block and `mnemom protection publish protection.card.yaml` alongside the existing REST `PUT` so the quickstart has a copy-paste CLI path.

### 7. Validate
- Run the Verification commands below and confirm all pass with zero regressions. In particular `npm run check:doc-examples` must validate the newly added card YAML against the live schemas, and `mintlify broken-links` / `npm run check:redirects` must stay green.

> No E2E test task: this fix touches only prose/MDX content, not client UI or user-interaction flows, and the capability manifest's `ux_path_globs` is restricted to `images/**`. There is no E2E harness for the Mintlify site, so an E2E test is not applicable.

## Key Decisions & Rationale

- **Reuse spec-page YAML verbatim instead of authoring new examples.** The `specifications/*-card-schema` snippets already pass `check:doc-examples` against the live schemas. Copying them guarantees the new concept/quickstart examples validate first-try and eliminates the risk of introducing a fresh schema mismatch (the exact failure class of MNE-190).
- **Fix the shape across all `*-overview.mdx` pages, not just `overview.mdx`.** The root cause is divergence from the canonical `errors.mdx` envelope; fixing only the top page would leave the same wrong shape on every domain overview, so the regression would persist where customers actually copy from. This addresses the root cause (drift from the MNE-86 canonical envelope) rather than a single symptom.
- **Branch-on-`code` guidance is part of the fix, not decoration.** The whole point of the nested envelope is a stable machine-readable `code`; documenting that contract prevents customers from re-coupling to the volatile `message`.
- **Tradeoff:** The card YAML is now duplicated between the spec pages and the concept/quickstart pages. This is accepted: onboarding readers need a pasteable example in place, and the shared `check:doc-examples` validator keeps both copies honest against the same schema, so drift is caught in CI.
- **Out of scope held firm:** N3 (marketing copy) and the unrelated `"error":` payload fields in `sub-resource-verbs.mdx`/`enforcement.mdx` are deliberately not touched, keeping the change minimal.

## Verification

Reproduce-before / confirm-after: before the fix, `grep -rn '"error"' api-reference/overview.mdx` shows (or the prose describes) a flat-string error body and the card concept pages have no ```yaml + publish command. After the fix, every `api-reference/*-overview.mdx` error example is the nested `{"error":{"code","message"}}` object, and `concepts/alignment-cards.mdx`, `concepts/safe-house.mdx`, and `quickstart/safe-house-protection.mdx` each contain a pasteable card YAML plus its `mnemom card publish` / `mnemom protection publish` command.

Execute every command from the repo/worktree root to validate the bug is fixed with zero regressions:

- `npm run check:redirects` — lint (redirect / link integrity). [manifest `lint`]
- `echo "(no typecheck for MDX docs)"` — typecheck no-op. [manifest `typecheck`]
- `npm ci && npm run check:doc-examples` — doc↔OpenAPI + schema example validator; confirms the new card YAML validates and no error example is malformed. [manifest `test`]
- `echo "(Mintlify-hosted build; validated by CI)"` — build no-op. [manifest `build`]
- `npx mintlify broken-links` — required check "Validate Mintlify Docs"; must report no broken internal links.

## Known Limitations / Follow-ups

- This plan covers MNE-242 N1+N2 only. **N3** ("four independently-configurable checkpoints" marketing copy) is handled separately on the website and is intentionally excluded.
- No new dependencies are introduced; all edits are MDX content.
- This is a **supervised** docs change (`merge_strategy: external`): the worker drives the doc checks green and labels the PR `agent`, then a human reviews and merges. Do not auto-merge into the public docs.
- Optional future hardening: extend `scripts/check-doc-examples.mjs` to assert error-body examples conform to the nested envelope, so a flat-string regression fails CI deterministically.
