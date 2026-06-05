# Spec — Gateway quickstart uses a retired model id → upstream 404 on first call

- **Status:** Draft
- **Branch:** bug-issue-196-adw-3dd22545-fix-retired-gateway-model-id
- **Location:** quickstart/gateway.mdx, gateway/cli.mdx, concepts/agent-identity.mdx, guides/agent-claim-flow.mdx
- **Related docs:** specs/adw/issue-187-adw-066b4fe4-add-anthropic-version-header-plan.md (sibling MNE-192, same quickstart page), .mnemom/capability.yaml (doc-validation verbs + supervised merge contract), scripts/check-doc-examples.mjs (doc↔OpenAPI walker + its `--scope`)

## Problem / Objective

### Problem Statement
The gateway docs' copy-paste `curl` examples set `"model": "claude-sonnet-4-5-20250514"`, which is a **retired** model id. A new customer following the quickstart verbatim makes a first gateway call that the upstream Anthropic API rejects with **HTTP 404** (`not_found_error`, *"model: claude-sonnet-4-5-20250514"*). The same request with a current model id returns `200`.

This is a **docs-only** defect. The Mnemom gateway layer is healthy — it returns a valid verdict and all `X-Mnemom-*` headers; the 404 originates upstream solely because the documented model id is stale. Source: 2026-06-04 capability test pass, finding **F-C1**; direct sibling of MNE-192 (docs#187), same quickstart page.

### Steps to Reproduce
1. Open `quickstart/gateway.mdx` and copy the first "Send your first request" `curl` block.
2. Export a valid `ANTHROPIC_API_KEY` and run the command against `https://gateway.mnemom.ai/anthropic/v1/messages`.
3. Observe the response: **HTTP 404**, body `{"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-4-5-20250514"}}`. Mnemom verdict + `X-Mnemom-*` headers are present and correct.
4. Re-run with `"model": "claude-sonnet-4-6"` (or `claude-haiku-4-5-20251001`) → **HTTP 200**.

### Root Cause Analysis
The model id `claude-sonnet-4-5-20250514` was hard-coded into the documented request bodies and has since been retired from the upstream Anthropic API. The gateway forwards the body unchanged, so the stale id propagates straight to upstream and yields a 404. The fix is to replace every occurrence of the retired id in the **published** gateway examples with a current, valid id. The retired id still appears in two non-published historical artifacts (`app_docs/feature-066b4fe4-anthropic-version-header.md` and `specs/adw/issue-187-adw-066b4fe4-add-anthropic-version-header-plan.md`); these are out of the doc-validator `--scope` and are records of prior work — see Key Decisions for why they are intentionally left untouched.

## Approach & Changes
Replace the retired model id `claude-sonnet-4-5-20250514` with the current, consistent id **`claude-sonnet-4-6`** in every published doc example. `claude-sonnet-4-6` is chosen because `quickstart/gateway.mdx` already uses it elsewhere (lines 52, 185) — so the page stays internally consistent — and it is a current, valid id (the issue lists it as a sanctioned alternative; `claude-haiku-4-5-20251001` and `claude-opus-4-8` are also valid). Also refresh the provider/models reference table row in `quickstart/gateway.mdx` so the named model lineup no longer advertises retired versions.

Relevant files and why they matter:
- **quickstart/gateway.mdx** — the primary page from finding F-C1. Two `curl` request bodies use the retired id (the "Send your first request" block and the later full example), plus the **Supported providers** table row for Anthropic lists retired versions (`Claude Opus 4.6, Opus 4.5, Sonnet 4.5`). All three must be corrected.
- **gateway/cli.mdx** — gateway `curl` example reuses the same retired id (one occurrence).
- **concepts/agent-identity.mdx** — gateway `curl` example reuses the same retired id (one occurrence).
- **guides/agent-claim-flow.mdx** — gateway `curl` example reuses the same retired id (one occurrence).

No new files. No new dependencies. No source/build changes — this is `.mdx` prose only.

### Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Confirm the full occurrence set
- Run `grep -rn "claude-sonnet-4-5-20250514" .` (excluding `node_modules`) to enumerate every occurrence.
- Confirm the published-doc hits are exactly: `quickstart/gateway.mdx` (×2 curl bodies), `gateway/cli.mdx` (×1), `concepts/agent-identity.mdx` (×1), `guides/agent-claim-flow.mdx` (×1).
- Confirm the only remaining hits are the historical artifacts `app_docs/feature-066b4fe4-anthropic-version-header.md` and `specs/adw/issue-187-adw-066b4fe4-add-anthropic-version-header-plan.md` (intentionally out of scope — see Key Decisions).

### 2. Fix quickstart/gateway.mdx
- Replace both `"model": "claude-sonnet-4-5-20250514"` occurrences in the `curl` request bodies with `"model": "claude-sonnet-4-6"`.
- Update the **Supported providers** table's Anthropic row from `Claude Opus 4.6, Opus 4.5, Sonnet 4.5` to a current lineup, e.g. `Claude Opus 4.7, Sonnet 4.6, Haiku 4.5`, so the page advertises only current models.

### 3. Fix the sibling gateway examples
- In `gateway/cli.mdx`, `concepts/agent-identity.mdx`, and `guides/agent-claim-flow.mdx`, replace the `claude-sonnet-4-5-20250514` model id in each `curl` body with `claude-sonnet-4-6`.

### 4. Verify no retired id remains in published docs
- Re-run `grep -rn "claude-sonnet-4-5-20250514" .` and confirm zero hits inside the doc-validator scope (`introduction.mdx,changelog.mdx,quickstart,guides,concepts,specifications,protocols,gateway,for-agents,migration,pricing`).
- Sanity-grep for other retired ids in published examples (e.g. `claude-3-5-sonnet-20241022` appears only in `quickstart/safe-house-protection.mdx` — leave it unless it is also a live gateway "first call" example; it is not in scope for this bug).

### 5. Run the Verification commands
- Execute every command in the Verification section below and confirm all are green with zero regressions.

## Key Decisions & Rationale
- **Root cause, not symptom:** the 404 is caused entirely by the stale model id in the request body; replacing it with a current valid id makes the documented call succeed end-to-end. Nothing in the gateway layer changes because nothing in the gateway layer is wrong.
- **Why `claude-sonnet-4-6`:** it is already used elsewhere on `quickstart/gateway.mdx`, so the page stays internally consistent, and it is a current sanctioned id per the issue. Keeping a single id across all curl + SDK variants avoids re-introducing drift.
- **Historical artifacts left untouched:** `app_docs/feature-066b4fe4-*.md` and `specs/adw/issue-187-*-plan.md` still reference the retired id, but they are records of the prior MNE-192 work, are **not** published in `docs.json` nav, and are **outside** the `check-doc-examples` `--scope`. Rewriting them would falsify the historical record without any user-facing or CI benefit. The acceptance criterion targets user-copyable doc *examples*, all of which are fixed.
- **Human-in-the-loop contract preserved:** `.mnemom/capability.yaml` declares `merge_strategy: external` (supervised — worker drives checks green + labels `agent`, human merges). This plan changes no workflow/merge behavior.
- **Not a UX change:** `ux_path_globs` is `images/**` only; prose `.mdx` edits do not trigger visual validation, so no UX Scenarios section and no E2E test are required.

## Verification
Reproduce before the fix: copy the `quickstart/gateway.mdx` first `curl` block (with the retired id) and send it to the gateway → expect **HTTP 404** `not_found_error` for `model: claude-sonnet-4-5-20250514`. After the fix: the same documented block uses `claude-sonnet-4-6` and returns **HTTP 200** with `X-Mnemom-*` headers intact.

Static confirmation: `grep -rn "claude-sonnet-4-5-20250514" quickstart gateway concepts guides specifications protocols for-agents migration pricing introduction.mdx changelog.mdx` returns **zero** matches.

Run from the worktree root:

- `npm run check:redirects` — the manifest `lint` verb (redirect / broken-link integrity).
- `echo "(no typecheck for MDX docs)"` — the manifest `typecheck` verb (no-op for MDX).
- `npm ci && npm run check:doc-examples` — the manifest `test` verb (doc↔OpenAPI example validator; the gateway `curl` bodies must still validate).
- `echo "(Mintlify-hosted build; validated by CI)"` — the manifest `build` verb (no-op; Mintlify-hosted).

Also ensure the required check **`Validate Mintlify Docs`** (broken-links) and **`Doc Examples vs OpenAPI`** are green on the PR before handoff.

## Known Limitations / Follow-ups
- The doc-examples validator checks `curl` path/method/body against OpenAPI but does **not** assert model-id validity, so it would not have caught (and will not catch) a future retired id. A follow-up could add a small lint that flags model ids not on a current-allowlist across published `.mdx`. Out of scope for this surgical fix.
- If the org later standardizes the "hello world" example on `claude-haiku-4-5-20251001` (the cheapest verified id), align the gateway examples with the SDK examples (`quickstart/sdk-direct.mdx`, `quickstart/self-hosted.mdx` already use it) in a separate consistency pass.
