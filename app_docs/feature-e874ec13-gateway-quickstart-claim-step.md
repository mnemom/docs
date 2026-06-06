# Gateway Quickstart: Add the Agent Claim Step

**ADW ID:** e874ec13
**Date:** 2026-06-06
**Plan-Spec:** agents/e874ec13/plan/issue-205-adw-e874ec13-gateway-quickstart-add-claim-step-plan.md

## Overview

The gateway quickstart documented agents as "auto-created on first call" but never told users the auto-created agent lands in the shared Mnemom Sandbox with no owner — so the read commands (`mnemom status`, `logs`, `integrity`, `card show`) could not resolve it. This change inserts an explicit **"Claim your agent"** step into the gateway quickstart that proves key ownership and binds the agent to the user's account, and threads the same expectation through the overview onboarding page. It closes the gap between "I made my first call" and "why can't I see my agent."

## What Was Built

- A new **"Claim your agent"** step in `quickstart/gateway.mdx`, placed after the verdict/error step and before "Check status", documenting the `mnemom agents claim` command and its constraints.
- Updated **"Make an API call"** guidance: the agent is auto-created in the Mnemom Sandbox *with no owner*, and the read commands cannot resolve it until claimed.
- The first `curl` example now uses `-i` so the response prints headers, letting users capture the `X-Mnemom-Agent` id required for the claim.
- The status-check example output updated to the canonical `mnm-…` agent id format (`mnm-a1b2c3d4e5f6`) instead of the old `agent-a1b2c3d4`.
- Corrected closing prose: "claim once to bind the agent to your account" replaces the bare "no registration step is needed" claim.
- A one-line claim pointer added to `quickstart/overview.mdx`, linking to the gateway quickstart.

## Technical Implementation

### Files Modified

- `quickstart/gateway.mdx`: added the "Claim your agent" `<Step>`; rewrote the "Make an API call" intro to explain the Sandbox/no-owner state; switched the example `curl` to `curl -i`; updated the `mnemom status` example output to the `mnm-…` id format; rewrote the closing "auto-created" paragraph to mention the claim.
- `quickstart/overview.mdx`: added a sentence to the CLI fast-path note pointing users to claim the auto-created agent, linking to `/quickstart/gateway`.

### Key Changes

- **Claim command + flags documented inline.** `mnemom agents claim <id> --name <name> --key $ANTHROPIC_API_KEY`, with the constraints that matter: `--name` **must** match the `x-mnemom-agent` header value sent on the gateway call or claim returns `403 invalid_hash_proof`.
- **Key never leaves the machine.** The doc states the provider key is hashed locally (SHA-256) and never transmitted to Mnemom — the proof-of-possession model.
- **Org targeting and idempotency.** The agent claims into the user's personal org by default; `--org <slug>` targets a shared org. The operation is idempotent and safe to re-run.
- **Failure modes surfaced.** A `<Note>` documents `503` (personal org still provisioning — wait and retry) and points to the [Agent claim flow guide](/guides/agent-claim-flow) for `403` cross-tenant / not-a-member errors.
- **Consistent canonical id format.** Example agent ids were normalized to the `mnm-…` shape so the "capture the header → paste into claim" walkthrough is internally consistent.

## How to Use

1. Make your first gateway call with `curl -i` and the `x-mnemom-agent: my-agent` header; the agent is auto-created in the Mnemom Sandbox with no owner.
2. Copy the `X-Mnemom-Agent` id from the printed response headers (e.g. `mnm-a1b2c3d4e5f6`).
3. Claim it into your account: `mnemom agents claim mnm-a1b2c3d4e5f6 --name my-agent --key $ANTHROPIC_API_KEY` — `--name` must match the header value you sent.
4. (Optional) Add `--org <slug>` to claim into a shared org instead of your personal org.
5. Run the read commands — `mnemom status`, `logs`, `integrity`, `card show` — which can now resolve the claimed agent.

## Configuration

No repo configuration changes. The documented runtime knobs are CLI flags on the claim command: `--name` (must match the `x-mnemom-agent` header), `--key` (the provider key, hashed locally), and `--org <slug>` (target a shared org instead of the personal default).

## Testing

This is a docs-only (Mintlify MDX) change; the gates are the repo's deterministic doc checks plus the Mintlify link validator. Run from the worktree root:

- **Lint:** `npm run check:redirects` — validates the redirect table is intact.
- **Typecheck:** none for MDX docs (no-op).
- **Test:** `npm ci && npm run check:doc-examples` — doc-as-spec validator; confirms no malformed example was introduced.
- **Build:** Mintlify-hosted; validated by CI (no local build step).
- **Link check:** `mintlify broken-links` (the "Validate Mintlify Docs" check) — must report zero broken internal links, confirming the new `/guides/agent-claim-flow` and `/quickstart/gateway` links resolve.

There is no application code or E2E harness in this repo; the "tests" are the doc gates above.

## Notes

- The `mnemom agents claim` command, its flags, and the `invalid_hash_proof` / `503` semantics are owned by the CLI and gateway services; this change documents that contract but does not implement it. Verify the flag names and error strings against the live CLI before relying on them.
- This change uses the supervised `merge_strategy: external` posture: the worker drives the deterministic doc checks green and stops; a human reviews and merges the public docs. The final decision is made by a human.
