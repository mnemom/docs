# Spec — Align documented alignment-card to unified/ADR-039 shape so it validates

- **Status:** Draft
- **Branch:** bug-issue-193-adw-2321e99f-align-card-to-adr-039
- **Location:** guides/card-management.mdx (rewrite the publishable templates + examples + validation table + framing notes), guides/upgrading-to-1-0.mdx (fix the "Via YAML / JSON file" tab), guides/policy-management.mdx (flip the "Start from your alignment card" snippet to the unified shape)
- **Related docs:** specifications/alignment-card-schema.mdx (the normative unified/ADR-039 shape — source of truth), api-reference/openapi.json (`PUT /v1/alignment/agent/{agent_id}` body — already unified), concepts/alignment-cards.mdx + protocols/aap/* (the AAP 1.0 *protocol-level* interop surface — intentionally separate, **out of scope**), gateway/cli.mdx (already shows the unified `autonomy:`/`audit:` shape), AGENTS.md, .mnemom/capability.yaml

## Problem / Objective

### Problem Statement
The alignment-card example a customer copies out of the **card-management / publish** docs is shown in the legacy **AAP 0.5.0 / 1.0 protocol shape** (`aap_version` + `card_id`/`issued_at`/`principal`/`values`/`autonomy_envelope`/`audit_commitment`). The platform's `mnemom card validate` / `PUT /v1/alignment/agent/{id}` endpoint expects the **unified / ADR-039** shape. A customer who copies the documented card and runs `mnemom card validate` **fails validation and cannot publish**. Dogfood finding F14 / Linear MNE-190 (docs portion).

The unified/ADR-039 shape (per `specifications/alignment-card-schema.mdx`, the normative source of truth) requires, at minimum:
- top-level `card_version` (string, e.g. `"unified/2026-04-15"`) — **replaces** `aap_version`
- top-level `autonomy_mode` (`off | observe | nudge | enforce`) — legacy `enforcement.mode` no longer accepted
- top-level `integrity_mode` (`off | observe | nudge | enforce`)
- `principal.identifier` — required whenever `principal.type != "unspecified"`
- `autonomy` (the block; `bounded_actions`/`forbidden_actions`/`escalation_triggers`/`max_autonomous_value` live here) — **renamed** from `autonomy_envelope`
- `audit` (object) — **renamed** from `audit_commitment`
- `values` (required), with `audit.query_endpoint` present (composer-enforced invariant)

### Steps to Reproduce
1. Open `guides/card-management.mdx` → **Creating a card → Start from the template** (or **Full example: Customer support agent**).
2. Copy the JSON/YAML card verbatim into `my-card.yaml`.
3. Run `mnemom card validate my-card.yaml` (the page tells you to do exactly this — line ~336 says it "checks compliance against the unified schema").
4. **Actual:** validation fails — the platform rejects `aap_version`, has no `card_version`/`autonomy_mode`/`integrity_mode`, and does not recognize `autonomy_envelope`/`audit_commitment` (it wants `autonomy`/`audit`); `principal.identifier` is missing. The card cannot be published.
5. **Expected:** the copied card validates against the unified/ADR-039 schema and publishes.

The same dead-end exists in `guides/upgrading-to-1-0.mdx` → **Via YAML / JSON file**, which instructs the user to `sed` `aap_version: "0.5.0"` → `"1.0.0"` and then `mnemom card validate` / `publish` — a version-number bump that still leaves a legacy-shaped card the validator rejects.

### Root Cause Analysis
The customer-facing **publish-a-card** docs were authored against the old AAP protocol-shape card and were never migrated to the unified/ADR-039 card the platform now enforces. The page is internally **self-contradictory**: line ~336 says validation runs "against the **unified** schema" and line ~348 lists required blocks as "`principal, values, autonomy, audit`", yet the **Validation rules** table (line ~576) still lists `autonomy_envelope`/`audit_commitment` and every template/example above uses the legacy shape. The pieces that were already migrated (the `PUT` curl bodies in `card-management.mdx` lines ~460–527 and `upgrading-to-1-0.mdx` lines ~96–117, and all of `gateway/cli.mdx`) prove the unified shape is the live contract; the hand-authored templates simply lagged behind. This is a **docs-only** fix: align the publishable examples + prose to `specifications/alignment-card-schema.mdx`, which is the source of truth.

**Scope boundary (deliberate).** `concepts/alignment-cards.mdx` and `protocols/aap/*` document the **AAP 1.0 protocol-level interop card** — a genuinely separate, still-stable contract for external agent-to-agent / MCP interop (served at `/.well-known/alignment-card.json`), explicitly framed as "the protocol surface, not the unified production card." Those pages legitimately use `autonomy_envelope`/`audit_commitment` and are **not** what `mnemom card validate` rejects. Rewriting them is out of scope and would be wrong; see Known Limitations. The bug is strictly the **publish-to-platform** path.

## Approach & Changes
Rewrite the documented **publishable** card examples (the ones paired with `mnemom card validate` / `mnemom card publish` / `PUT /v1/alignment/agent/{id}`) into the unified/ADR-039 shape, mirroring `specifications/alignment-card-schema.mdx` field-for-field. Keep the worked-scenario content (customer-support agent values, bounded actions, escalation triggers) identical — only the **shape** changes.

Field migration to apply consistently in every rewritten example:
- Remove `aap_version`; add top-level `card_version: "unified/2026-04-15"`.
- Add top-level `autonomy_mode` and `integrity_mode` (use `enforce` for the worked example; `observe` is a reasonable starting default for the bare template — pick one and be consistent within a file).
- `autonomy_envelope:` → `autonomy:` (keep `bounded_actions`, `forbidden_actions`, `escalation_triggers`, `max_autonomous_value` underneath unchanged).
- `audit_commitment:` → `audit:`; ensure `query_endpoint` is present (e.g. `https://api.mnemom.ai/v1/traces`) since the validator enforces it.
- Add `principal.identifier` to every example whose `principal.type != "unspecified"` (all current examples use `type: human`/`organization`, so `identifier` is required).
- Keep `card_id`, `agent_id`, `issued_at`, `expires_at`, `values`, `extensions` as-is (these are unchanged between shapes).

Relevant files and why they matter:
- **guides/card-management.mdx** — PRIMARY. The canonical "create → validate → publish your card" guide. The bare templates (Tabs, lines ~28–93), **Define autonomy envelope** (~132–155), **Set audit commitment** (~161–174), **Full example: Customer support agent** (~178–328), the **framing Note** (~14–18 — it currently calls the JSON/YAML templates the "AAP 1.0 protocol-level surface"; they must become the unified surface the user actually publishes), and the **Validation rules** table (~573–581, fix the "Required blocks" row to `principal`, `values`, `autonomy`, `audit`) all teach the legacy shape and must be migrated. Section heading "Define autonomy envelope" → "Define the autonomy block" (or similar) so prose matches the `autonomy` field name.
- **guides/upgrading-to-1-0.mdx** — the **Via YAML / JSON file** tab (~120–134) tells users to `sed` the `aap_version` value and republish, which still fails validation. Replace it with the correct unified migration: rename `autonomy_envelope`→`autonomy` and `audit_commitment`→`audit`, drop `aap_version` for `card_version: unified/2026-04-15`, add `autonomy_mode`/`integrity_mode`, then `mnemom card validate` / `publish` — or point readers at the dedicated migration tooling if one is referenced elsewhere. (The **Via API** tab is already unified — leave it.)
- **guides/policy-management.mdx** — the **Start from your alignment card** snippet (~135–147) shows `autonomy_envelope.bounded_actions` as the primary example. The surrounding prose already names both shapes; flip the shown JSON to the unified `autonomy.bounded_actions` so the primary example matches what customers publish. (Keep the parenthetical that notes the AAP protocol shape exists.)
- **specifications/alignment-card-schema.mdx** — read-only source of truth for every field name, required/optional status, and the `principal.identifier` conditional. Mirror it; do not edit.
- **gateway/cli.mdx** — already correct (`autonomy:`/`audit:`); read it to keep voice + the `card validate` output narrative consistent. Do not edit.

### New Files
None.

### Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Re-read the source of truth
- Read `specifications/alignment-card-schema.mdx` end to end and confirm the exact unified field set, the `autonomy_mode`/`integrity_mode` enum, the `principal.identifier` conditional, and the accepted `card_version` value(s). This is the contract every rewritten example must match.
- Read the already-unified `PUT` curl bodies in `guides/card-management.mdx` (~460–527) and `guides/upgrading-to-1-0.mdx` (~96–117) and all of `gateway/cli.mdx` so the rewritten examples are byte-consistent in field names and ordering with what already validates.

### 2. Migrate the templates + worked example in `guides/card-management.mdx`
- Rewrite both Tabs under **Start from the template** (JSON + YAML) to the unified shape.
- Rewrite the **Define autonomy envelope** and **Set audit commitment** snippets to `autonomy` / `audit` (rename the "Define autonomy envelope" heading to match the field name).
- Rewrite both Tabs of **Full example: Customer support agent** (JSON + YAML) to the unified shape, preserving the worked content.
- Update the **framing Note** (top of page) so the JSON/YAML templates are presented as the unified production card the user publishes — not the AAP protocol surface — and cross-link `/specifications/alignment-card-schema`.
- Fix the **Validation rules** "Required blocks" row to `principal`, `values`, `autonomy`, `audit`.
- Update the "Every card requires five blocks: identity, principal, values, **autonomy envelope**, and **audit commitment**" prose to the unified block names + the two master switches.

### 3. Fix the upgrade-guide file tab in `guides/upgrading-to-1-0.mdx`
- Replace the `sed`-the-version-number instructions in the **Via YAML / JSON file** tab with the correct field-rename migration to the unified shape, ending in `mnemom card validate` / `publish` that will actually pass.

### 4. Flip the primary snippet in `guides/policy-management.mdx`
- Rewrite the **Start from your alignment card** JSON snippet (~135–147) to `autonomy.bounded_actions`, keeping the note that the AAP protocol shape also exists.

### 5. Repo-wide sweep for residual legacy publishable shapes
- Grep the three edited files (and the broader `guides/`, `quickstart/`, `concepts/policy-engine.mdx`) for `aap_version`, `autonomy_envelope`, `audit_commitment`. Confirm zero remain in any **publish-to-platform** example. Any remaining hits must be **only** on the AAP protocol-level interop pages (`concepts/alignment-cards.mdx`, `protocols/aap/*`), the historical `changelog.mdx`, and `guides/upgrading-to-0-5.mdx` — all out of scope by design. If a publishable example outside the three target files is found, migrate it too (note it in the PR).

### 6. Run the Verification commands
- Run every command in the **Verification** section below and confirm the doc checks are green with zero new failures, and that `mintlify broken-links` is clean.

## Key Decisions & Rationale
- **Fix the shape, not just the version string.** The naive reading ("bump `aap_version`") is exactly the `upgrading-to-1-0.mdx` trap that still fails the validator. The root cause is the *block structure* (`autonomy_envelope`/`audit_commitment` + missing `card_version`/`autonomy_mode`/`integrity_mode`/`principal.identifier`), so the fix renames blocks and adds the required top-level switches to match `specifications/alignment-card-schema.mdx` — the platform's source of truth.
- **Preserve the AAP protocol-level surface.** `concepts/alignment-cards.mdx` and `protocols/aap/*` document a distinct, still-valid interop contract that is *not* submitted to `mnemom card validate`. Migrating them would break correct documentation and exceeds the surgical scope of MNE-190's docs portion (the issue itself defers the AAP-schema/SDK reconciliation to a separate cross-repo follow-up). Tradeoff: the literal acceptance phrase "no `autonomy_envelope` left in the prose" is satisfied for the **publishable** examples (the actual bug) but not site-wide — see Known Limitations.
- **No automated schema gate for these examples today.** The `test` verb (`check:doc-examples`) only validates `curl … -d '{…}'` bodies against the live OpenAPI spec; the standalone JSON/YAML card *templates* are explicitly out of its scope. So the fix is verified by (a) keeping the existing doc checks green, (b) a grep proving no legacy shape remains in publishable examples, and (c) field-for-field conformance to the normative schema page. Adding template validation to CI is a follow-up, not this fix.

## Verification
Execute every command to validate the bug is fixed with zero regressions. Run from the worktree root.

**Reproduce before the fix:** copy the **Start from the template** / **Full example** card out of `guides/card-management.mdx` and confirm it carries `aap_version` + `autonomy_envelope` + `audit_commitment` with no `card_version`/`autonomy_mode`/`integrity_mode` — the exact shape `mnemom card validate` rejects. **Confirm after the fix:** the same examples now carry `card_version: unified/2026-04-15`, top-level `autonomy_mode`/`integrity_mode`, `principal.identifier`, `autonomy:`/`audit:` blocks, and `audit.query_endpoint`.

- Grep gate — no legacy shape remains in the publishable examples:
  - `grep -n "aap_version\|autonomy_envelope\|audit_commitment" guides/card-management.mdx guides/upgrading-to-1-0.mdx guides/policy-management.mdx` → expect **zero** matches.
- The manifest `lint` verb — `npm run check:redirects` (redirect integrity).
- The manifest `typecheck` verb — `echo "(no typecheck for MDX docs)"` (no-op).
- The manifest `test` verb — `npm ci && npm run check:doc-examples` (doc↔OpenAPI example validator — must stay green; the already-unified `PUT` curl bodies must still validate).
- The manifest `build` verb — `echo "(Mintlify-hosted build; validated by CI)"` (no-op).
- Required check parity — `mintlify broken-links` (the "Validate Mintlify Docs" gate) must report no broken internal links introduced by the heading/anchor change in `card-management.mdx`. If the "Define autonomy envelope" heading is renamed, grep for inbound `#define-autonomy-envelope` anchors first and update any.

## Known Limitations / Follow-ups
- **Site-wide `autonomy_envelope` removal is out of scope.** The AAP 1.0 protocol-level interop pages (`concepts/alignment-cards.mdx`, `protocols/aap/*`) and the historical `changelog.mdx` / `guides/upgrading-to-0-5.mdx` intentionally retain the legacy field names. A future docs decision on whether to fold the protocol-level card into the unified card (or relabel those pages) is tracked separately, alongside the cross-repo `aap/schemas/alignment-card.schema.json` + SDK reconciliation called out in the MNE-190 Notes.
- **No CI schema-validation for standalone card templates.** `check:doc-examples` does not parse JSON/YAML card templates against the unified schema (only curl bodies). Wiring `scripts/check-spec-examples.mjs` (or a new walker) to validate fenced card examples against `specifications/alignment-card-schema.mdx` would prevent this class of regression — recommended follow-up, not part of this fix.
- **CLI `--agent` flag gap** (`mnemom card publish --help` omits the required `--agent`) is a separate CLI issue noted in MNE-190, not addressed here.
