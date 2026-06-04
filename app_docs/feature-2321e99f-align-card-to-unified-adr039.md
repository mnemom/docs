# Align Documented Alignment Card to Unified / ADR-039 Shape

**ADW ID:** 2321e99f
**Date:** 2026-06-04
**Plan-Spec:** specs/adw/issue-193-adw-2321e99f-align-card-to-unified-adr039-plan.md

## Overview

The customer-facing "create → validate → publish" docs showed alignment-card templates in the legacy **AAP 0.5.0/1.0 protocol shape**, while `mnemom card validate` and `PUT /v1/alignment/agent/{id}` expect the **unified / ADR-039 shape**. A customer copying the documented card would fail validation and be unable to publish (Dogfood finding F14 / Linear MNE-190). This docs-only fix rewrites every *publishable* card example and the surrounding prose to the unified shape, mirroring `specifications/alignment-card-schema.mdx` as the source of truth.

## What Was Built

- Migrated all publishable JSON/YAML card templates in the Card Management guide to the unified / ADR-039 shape.
- Replaced the misleading upgrade instructions that told users to bump only the version string (a change that still failed validation) with a correct field-structure migration.
- Flipped the primary policy-management snippet to the unified `autonomy` shape.
- Corrected residual legacy field references in publishable prose and the validation-rules table.
- Added a local link-checker script (`scripts/check-links-local.mjs`) and the `mintlify` dev dependency to support broken-link verification.

## Technical Implementation

### Files Modified

- `guides/card-management.mdx`: Rewrote the framing Note, the "Start from the template" JSON+YAML tabs, the "Define the autonomy block" and audit snippets, the full "Customer support agent" worked example (JSON+YAML), the validation-rules "Required blocks" row, and supporting prose.
- `guides/upgrading-to-1-0.mdx`: Replaced the `sed`-the-version-number "Via YAML / JSON file" tab with a real unified-shape migration; updated comparison table, verification commands, and FAQ prose to reference `card_version` instead of `aap_version`.
- `guides/policy-management.mdx`: Flipped the "Start from your alignment card" snippet from `autonomy_envelope` to `autonomy`, keeping a note that the AAP protocol shape exists.
- `guides/security-trust-model.mdx`: Updated `audit_commitment.retention_days` → `audit.retention_days`.
- `scripts/check-links-local.mjs`: New script that walks `.mdx`/`.md` files and reports broken internal page links.
- `package.json`: Added `mintlify` dependency for link validation.

### Key Changes

- **Field renames applied consistently:** `aap_version` → top-level `card_version: "unified/2026-04-15"`; `autonomy_envelope` → `autonomy`; `audit_commitment` → `audit`.
- **New required top-level master switches** added to every template: `autonomy_mode` and `integrity_mode` (`observe` for bare templates, `enforce` for the worked example).
- **`principal.identifier`** added to every example whose `principal.type != "unspecified"` (required by the validator).
- **`audit.query_endpoint`** (`https://api.mnemom.ai/v1/traces`) added since the composer enforces its presence.
- **Worked-scenario content preserved** — only the card *shape* changed; values, bounded actions, and escalation triggers are unchanged.
- **Scope boundary respected:** the AAP 1.0 protocol-level interop pages (`concepts/alignment-cards.mdx`, `protocols/aap/*`) intentionally retain `autonomy_envelope`/`audit_commitment` and were left untouched.

## How to Use

1. Open the [Card Management](/guides/card-management) guide and copy a template from "Start from the template" or the "Customer support agent" full example.
2. Map your agent's real values, bounded actions, and escalation triggers into the unified fields.
3. Run `mnemom card validate my-card.yaml` — the copied card now validates against the unified schema.
4. Run `mnemom card publish my-card.yaml --agent my-agent` to publish.
5. Migrating an existing 0.x card? Follow the "Via YAML / JSON file" tab in [Upgrading to 1.0](/guides/upgrading-to-1-0): set `card_version`, add `autonomy_mode`/`integrity_mode`, move actions under `autonomy:`, move audit settings under `audit:` with a `query_endpoint`, and add `principal.identifier`.

## Configuration

No new runtime configuration. The unified card requires these fields that the legacy shape did not:

- `card_version: "unified/2026-04-15"`
- `autonomy_mode` and `integrity_mode` — one of `off | observe | nudge | enforce`
- `principal.identifier` — required whenever `principal.type != "unspecified"`
- `audit.query_endpoint` — validator-enforced

## Testing

- **Grep gate (no residual legacy shape in publishable examples):**
  `grep -n "aap_version\|autonomy_envelope\|audit_commitment" guides/card-management.mdx guides/upgrading-to-1-0.mdx guides/policy-management.mdx` → expect zero matches.
- **Lint verb:** `npm run check:redirects` (redirect integrity).
- **Typecheck verb:** no-op for MDX docs.
- **Test verb:** `npm ci && npm run check:doc-examples` (doc↔OpenAPI example validator — the already-unified `PUT` curl bodies must still validate).
- **Build verb:** Mintlify-hosted build, validated by CI.
- **Broken-links gate:** `mintlify broken-links` (or `node scripts/check-links-local.mjs`) must report no broken internal links introduced by the heading change.

## Notes

- **Site-wide `autonomy_envelope` removal is out of scope by design.** The AAP 1.0 protocol-level interop pages and the historical `changelog.mdx` / `guides/upgrading-to-0-5.mdx` intentionally keep the legacy field names; they document a separate, still-stable contract that is not submitted to `mnemom card validate`.
- **No CI schema validation for standalone card templates yet.** `check:doc-examples` only validates `curl` bodies against the live OpenAPI spec, not fenced JSON/YAML card templates. Wiring a walker to validate fenced card examples against `specifications/alignment-card-schema.mdx` is a recommended follow-up.
- The cross-repo `aap/schemas/alignment-card.schema.json` + SDK reconciliation and the CLI `--agent` flag gap noted in MNE-190 are tracked separately and not addressed here.
