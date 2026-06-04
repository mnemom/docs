# Spec — Agent-claim-flow docs describe a non-existent token endpoint; rewrite to hash_proof flow

- **Status:** Draft
- **Branch:** bug-issue-188-adw-08eb0b04-rewrite-claim-flow-hash-proof
- **Location:** guides/agent-claim-flow.mdx (rewrite)
- **Related docs:** api-reference/openapi.json (`claimAgent` — `POST /v1/agents/{agent_id}/claim`, source of truth), concepts/agent-identity.mdx (`#claiming-a-gateway-provisioned-agent-into-your-org`), api-reference/endpoint/post-agents-agent-id-claim.mdx, for-agents/index.mdx, changelog.mdx, AGENTS.md, .mnemom/capability.yaml

## Problem / Objective

### Problem Statement
`guides/agent-claim-flow.mdx` (referenced from onboarding Step 8) documents a **two-step claim flow that does not exist in the API**:

1. Mint a short-lived token via `POST /v1/claim/tokens`.
2. Claim the agent by sending `Authorization: Claim-Token <token>`.

Neither the `POST /v1/claim/tokens` mint endpoint nor the `Claim-Token` authorization scheme exists in the live OpenAPI spec. A new user following the guide hits a **404 on the mint call** and cannot claim their agent. Dogfood finding F15 / Linear MNE-193.

### Steps to Reproduce
1. Follow `guides/agent-claim-flow.mdx` as written.
2. At the documented first step, call `POST /v1/claim/tokens` to mint a claim token.
3. **Actual:** the request 404s — the endpoint is not implemented; the flow dead-ends.
4. **Expected:** the guide should describe the single authenticated `POST /v1/agents/{agent_id}/claim` call that actually works.

### Root Cause Analysis
The guide was authored against a fictional "claim-token delegation" design that never shipped. The real, implemented mechanism (per `api-reference/openapi.json` operation `claimAgent`) is a **single authenticated call**:

- `POST /v1/agents/{agent_id}/claim`
- **Auth:** `Authorization: Bearer …` **or** `X-Mnemom-Api-Key: …` **or** session cookie (standard auth; the authenticated principal becomes the agent's owner).
- **Body:** `{ "hash_proof": "<64-hex>", "org_id"?: "<uuid>" }`, where `hash_proof` = full lowercase 64-char SHA-256 hex of the agent's provider API key joined with the agent name, pipe-separated: `SHA256("<providerKey>|<agentName>")` (or `SHA256("<providerKey>")` for an unnamed singleton). The server resolves the agent via `agent_hash = hash_proof[:16]`.
- **Response (HTTP 200):** `{ "claimed": true, "agent_id", "org_id", "claimed_at" }`.

The sibling docs (`concepts/agent-identity.mdx`, `for-agents/index.mdx`, `changelog.mdx`) already describe this real flow correctly — only `guides/agent-claim-flow.mdx` was out of sync. This is a **docs-only** fix: align the prose + examples in that one guide to the OpenAPI spec, which is the source of truth (the doc↔OpenAPI example validator is the gate).

## Approach & Changes
Rewrite `guides/agent-claim-flow.mdx` so it documents the real `hash_proof` claim mechanism end-to-end, removing every reference to `POST /v1/claim/tokens` and the `Claim-Token` scheme.

Relevant files and why they matter:
- **guides/agent-claim-flow.mdx** — the only file with the bug; the prose, the `hash_proof` derivation, the auth options, the curl/SDK/CLI examples, and the response shape must all match `claimAgent`.
- **api-reference/openapi.json** (`claimAgent`) — source of truth for the path, auth schemes, request body (`hash_proof` required, `org_id` optional), and the 200 response shape. Do not edit; mirror it.
- **concepts/agent-identity.mdx**, **for-agents/index.mdx**, **changelog.mdx** — already correct; read them so the rewritten guide stays consistent in voice, the `hash_proof` formula, the org-selection semantics, and the `/concepts/agent-identity#claiming-a-gateway-provisioned-agent-into-your-org` cross-link. Verify none still point at the old flow (a repo-wide grep confirms zero `claim/tokens` / `Claim-Token` references remain anywhere).
- **AGENTS.md / .mnemom/capability.yaml** — conventions: MDX, one H1 per page, absolute internal links, no hand-editing `api-reference/`; validation verbs (`lint` = `check:redirects`, `test` = `check:doc-examples`).

No new files. No new dependencies. No UI/UX surface affected (prose-only `.mdx`; the manifest's `ux_path_globs` is `images/**` only — no UX Scenarios section and no E2E test required).

### Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Confirm the source of truth
- Read the `claimAgent` operation in `api-reference/openapi.json`: path `/agents/{agent_id}/claim`, the accepted security schemes (Bearer / `X-Mnemom-Api-Key` / session cookie), the request body (`hash_proof` required, `org_id` optional), and the 200 response (`claimed`, `agent_id`, `org_id`, `claimed_at`).
- Read `concepts/agent-identity.mdx` (`#claiming-a-gateway-provisioned-agent-into-your-org`) and `for-agents/index.mdx` so the guide's framing, formula, and cross-links match the already-correct sibling docs.

### 2. Rewrite guides/agent-claim-flow.mdx
- Remove **all** references to `POST /v1/claim/tokens` and the `Claim-Token` authorization scheme.
- Document the single authenticated `POST /v1/agents/{agent_id}/claim` call: the three accepted auth options (Bearer JWT, `X-Mnemom-Api-Key`, session cookie), the `hash_proof` derivation (`SHA256(providerApiKey + '|' + agentName)`, full 64-char lowercase hex; unnamed-singleton variant `SHA256(providerApiKey)`), and the optional `org_id` (omit → personal org; pass → a specific org you're a member of).
- Provide working examples (cURL + TypeScript SDK + CLI) that compute `hash_proof` locally and call the real endpoint. Ensure any fenced API example the doc↔OpenAPI validator inspects matches the `claimAgent` request/response schema exactly (correct path, body keys, and the `{ claimed, agent_id, org_id, claimed_at }` 200 response).
- Keep idempotency / re-home semantics and the failure-mode table aligned with the spec (`401` unauthenticated, `400 hash_proof_required` / `invalid_key_hash_format`, `403 agent_org_not_member` with `details.claimable_orgs`, `403 agent_cross_tenant`, `404` unknown agent).
- Preserve absolute internal links and one-H1-per-page; keep the existing cross-links to `/concepts/agent-identity`, `/guides/authentication`, and the claim endpoint reference.

### 3. Sweep for stragglers
- Run a repo-wide grep for `claim/tokens` and `Claim-Token` (excluding `node_modules`) and confirm zero matches remain. Update any onboarding step / cross-link that still pointed at the old flow (expected: none outside the guide, since siblings are already correct).

### 4. Validate
- Run the Verification commands below and confirm the bug is fixed with zero regressions (broken-links clean, doc↔OpenAPI examples green).

## Key Decisions & Rationale
- **Root cause, not symptom:** the fix replaces the fictional two-step token flow with the single real `hash_proof` call documented by the OpenAPI `claimAgent` operation — the API is the source of truth (AGENTS.md: `api-reference/` is generated from the spec; never hand-edit it). Aligning the guide to the spec is what makes the doc↔OpenAPI validator pass and prevents the same drift from recurring.
- **Scope discipline:** docs-only, one file. Sibling docs already describe the correct flow, so no broader rewrite is needed — minimal change, minimal regression surface.
- **Human-in-the-loop contract preserved:** per `.mnemom/capability.yaml` this is a SUPERVISED (`merge_strategy: external`) docs change — the worker drives the deterministic Mintlify check green and a human reviews + merges. This plan does not alter that contract.
- **Tradeoff:** the guide's prose is duplicative with `concepts/agent-identity.mdx`; we keep the guide as a focused how-to and lean on cross-links rather than collapsing the two, to avoid scope creep.

## Verification
Reproduce before the fix: following the guide, `POST /v1/claim/tokens` 404s (no such endpoint) and `Authorization: Claim-Token <token>` is not a valid scheme — the flow dead-ends. After the fix: the guide documents only `POST /v1/agents/{agent_id}/claim` with `hash_proof` + standard auth, and a repo-wide grep for `claim/tokens` / `Claim-Token` returns nothing. The acceptance gate is the doc↔OpenAPI example validator plus Mintlify broken-links.

Execute every command from the repo/worktree root to validate the bug is fixed with zero regressions:

- **lint** (redirect / link integrity): `npm run check:redirects`
- **typecheck** (no-op for MDX docs): `echo "(no typecheck for MDX docs)"`
- **test** (doc↔OpenAPI example validator — `Doc Examples vs OpenAPI`): `npm ci && npm run check:doc-examples`
- **build** (Mintlify-hosted; validated by CI): `echo "(Mintlify-hosted build; validated by CI)"`
- **Broken-links** (`Validate Mintlify Docs`, the required check): `mintlify broken-links`
- **Straggler sweep:** `grep -rn "claim/tokens\|Claim-Token" . --include=*.mdx --include=*.md --include=*.json | grep -v node_modules` → must return no matches.

## Known Limitations / Follow-ups
- No new dependencies introduced.
- Not a UI/UX change (prose `.mdx`; manifest `ux_path_globs` is `images/**`), so no E2E test and no UX Scenarios/screenshots are required.
- This is a SUPERVISED docs PR: the worker drives the deterministic Mintlify check green, labels the PR `agent`, and stops; a human reviews the remaining checks (doc↔code conformance, examples, spellcheck) and merges. No autonomous merge into the public docs.
