# Spec — Gateway quickstart missing `anthropic-version` header → first call 400

- **Status:** Draft
- **Branch:** bug-issue-187-adw-066b4fe4-add-anthropic-version-header-docs
- **Location:** quickstart/gateway.mdx, gateway/cli.mdx, concepts/agent-identity.mdx, guides/lockfile-hash-opt-in.mdx
- **Related docs:** quickstart/gateway.mdx (headline path), quickstart/sdk-direct.mdx (checked — no change needed), AGENTS.md (conventions + CI gates), api-reference/headers.mdx (header reference)

## Problem / Objective

### Problem Statement
The documented Mnemom Gateway quickstart shows raw `curl` calls to the gateway's Anthropic passthrough path (`https://gateway.mnemom.ai/anthropic/v1/messages`) **without** the `anthropic-version` request header. The gateway forwards the request unchanged to Anthropic's Messages API, which **requires** the `anthropic-version` header. A new customer who copies the quickstart verbatim therefore gets their first call rejected with **HTTP 400 — `"anthropic-version: header is required"`**. The identical request with `anthropic-version: 2023-06-01` returns 200. (Dogfood finding F12 / Linear MNE-192.)

### Steps to Reproduce
1. Follow `quickstart/gateway.mdx` → "Make an API call" step.
2. Run the documented curl exactly as written:
   ```bash
   curl https://gateway.mnemom.ai/anthropic/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "x-mnemom-agent: my-agent" \
     -H "content-type: application/json" \
     -d '{ "model": "claude-sonnet-4-5-20250514", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello"}] }'
   ```
3. **Actual:** HTTP 400, `anthropic-version: header is required`.
4. **Expected:** HTTP 200 with a normal Messages response.
5. Re-run with `-H "anthropic-version: 2023-06-01"` added → HTTP 200. Confirms the missing header is the sole cause.

### Root Cause Analysis
The Anthropic Messages API mandates the `anthropic-version` header on every request. The Mnemom Gateway's `/anthropic/*` path is a transparent passthrough — it forwards request headers unchanged and does not inject a default version. The docs were authored without that header, so every documented gateway-call curl example that targets the `/anthropic/v1/messages` path produces a 400 on first use. This is a documentation defect (the examples are incomplete), not a gateway bug. (Gateway-side default-injection is tracked separately as a platform change and is explicitly out of scope here.)

The defect is duplicated across every page that shows a raw HTTP gateway call to the Anthropic path:
- `quickstart/gateway.mdx` — headline "Make an API call" curl **and** the "Named agents" curl.
- `gateway/cli.mdx` — "Point your LLM client at the gateway" curl.
- `concepts/agent-identity.mdx` — the auto-create curl.
- `guides/lockfile-hash-opt-in.mdx` — raw curl + Python `requests` + TypeScript `fetch` snippets (these hand-build the request, so the SDK does not add the version for them).

Note: SDK snippets that go through the official Anthropic SDK (e.g. `base_url` overrides in `quickstart/sdk-direct.mdx`, `concepts/integrity-checkpoints.mdx`, `guides/improving-reputation.mdx`) auto-inject `anthropic-version` and need **no** change. The `quickstart/safe-house-protection.mdx` examples hit the distinct `/v1/messages` Safe-House path with `Authorization: Bearer $MNEMOM_TOKEN` (not the `/anthropic/*` passthrough), so they are out of scope for this bug.

## Approach & Changes

Surgically add `-H "anthropic-version: 2023-06-01"` (curl) / the equivalent `"anthropic-version": "2023-06-01"` header entry (Python/TS) to **every documented gateway-call example that targets `gateway.mnemom.ai/anthropic/v1/messages` and hand-builds the HTTP request**. Place the header consistently right after `content-type`/`Content-Type` so all variants read the same. No prose rewrites beyond, optionally, a one-line note where it clarifies why the header is required.

Files and why they matter:
- **quickstart/gateway.mdx** — the headline onboarding path; the primary fix. Two curl blocks: the "Make an API call" step and the "Named agents" example.
- **gateway/cli.mdx** — the CLI guide repeats the same gateway curl; must match so the example is copy-paste correct.
- **concepts/agent-identity.mdx** — the auto-create curl that a reader runs to mint an agent; same 400 without the header.
- **guides/lockfile-hash-opt-in.mdx** — raw curl + `requests` + `fetch` to the Anthropic path; all three hand-build headers and need the version added for parity and correctness.

### New Files
None. This is an edit-only, docs-only fix.

### Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

#### 1. Fix the headline quickstart curl (`quickstart/gateway.mdx`)
- In the "Make an API call" `<Step>` curl (the block starting `curl https://gateway.mnemom.ai/anthropic/v1/messages`), add a new line `  -H "anthropic-version: 2023-06-01" \` immediately after the `content-type` header line.
- In the "Named agents" section curl (`curl https://gateway.mnemom.ai/anthropic/v1/messages` with `x-mnemom-agent: my-coder`), add the same `-H "anthropic-version: 2023-06-01" \` line after `content-type`.
- Optionally add one concise sentence near the first curl noting that the gateway forwards to Anthropic unchanged, so the `anthropic-version` header is required (keep it brief; do not restructure the step).

#### 2. Fix the gateway CLI guide curl (`gateway/cli.mdx`)
- In the "Point your LLM client at the gateway" curl, add `-H "anthropic-version: 2023-06-01" \` after the `content-type` header line so it matches the quickstart exactly.

#### 3. Fix the agent-identity auto-create curl (`concepts/agent-identity.mdx`)
- In the auto-create curl (`curl https://gateway.mnemom.ai/anthropic/v1/messages` near the "auto-create" path), add `-H "anthropic-version: 2023-06-01" \` after the `content-type` header line.

#### 4. Fix the lockfile-hash gateway snippets (`guides/lockfile-hash-opt-in.mdx`)
- In the `curl` block, add `-H "anthropic-version: 2023-06-01" \` alongside the other `-H` flags.
- In the Python `requests` block, add `"anthropic-version": "2023-06-01",` to the `headers` dict.
- In the TypeScript `fetch` block, add `"anthropic-version": "2023-06-01",` to the `headers` object.
- Keep the existing `X-Mnemom-*` lockfile/SDK headers intact — only add the version header.

#### 5. Confirm no other gateway-call examples were missed
- Re-run the discovery grep to prove every Anthropic-passthrough call is covered:
  ```bash
  grep -rn "gateway.mnemom.ai/anthropic/v1/messages" --include=*.mdx . | grep -v node_modules
  ```
- For each hit, confirm it is either (a) now carrying `anthropic-version`, or (b) an SDK-mediated call (base-URL override through the official Anthropic SDK) that adds the header automatically. Document the verdict in the PR description.

#### 6. Run the Verification commands
- Execute every command in the Verification section below and confirm zero regressions before marking the plan complete.

## Key Decisions & Rationale
- **Root cause vs symptom:** the symptom is "first call 400". The root cause is that every hand-built gateway request example omits a header Anthropic mandates. Fixing only `quickstart/gateway.mdx` would leave `gateway/cli.mdx`, `concepts/agent-identity.mdx`, and `guides/lockfile-hash-opt-in.mdx` broken for anyone who lands there first — so the fix covers all hand-built gateway-call examples. This directly satisfies the issue's acceptance criterion "every gateway-call example in the quickstart/onboarding includes `anthropic-version`."
- **Why `2023-06-01`:** it is the stable, currently-recommended Anthropic Messages API version and is the value the issue specifies; using one consistent value across curl + SDK variants keeps the examples coherent.
- **Why not touch the SDK `base_url` snippets or the Safe-House `/v1/messages` examples:** the Anthropic SDK injects `anthropic-version` itself, and the Safe-House path uses Mnemom auth on a different (non-passthrough) route — adding the header there would be noise, not a fix. Staying surgical avoids scope creep and respects the docs' existing conventions.
- **No contract change:** this is content-only; it does not alter any human-in-the-loop/approval contract, navigation, or generated `api-reference/` pages.

## Verification
Reproduce before/after conceptually by reading each edited block: before the fix the curl lacks `anthropic-version` (→ Anthropic returns 400); after, every hand-built gateway call to `/anthropic/v1/messages` carries `anthropic-version: 2023-06-01` (→ 200). The grep in Task 5 is the deterministic "all examples covered" check.

Run from the repo/worktree root:

- **lint / `Validate Mintlify Docs` (broken-links):**
  ```bash
  npx -y mintlify broken-links
  ```
  Adding a header line touches no links; this must stay green.
- **`Doc Examples vs OpenAPI`:**
  ```bash
  npm run check:doc-examples
  ```
  (`node scripts/check-doc-examples.mjs`.) The walker only validates `api.mnemom.ai/v1/...` curls and explicitly excludes `gateway.mnemom.ai/*` passthrough URLs, so adding the gateway header is safe; this must stay green.
- **typecheck:** N/A — this docs repo has no type-checking step (MDX content, no TypeScript build).
- **test (unit):** N/A — no unit-test suite in this repo.
- **build:** N/A — Mintlify is the build (no local build step per AGENTS.md); `npx -y mintlify broken-links` is the closest pre-merge gate and is run above.

Note: this fix is docs content only and is **not** UX-facing client source (no styling/layout/responsive/accessibility change) and involves **no** UI interaction flow, so no `UX Scenarios` section and no E2E test are required.

## Known Limitations / Follow-ups
- The durable fix is for the gateway to inject a default `anthropic-version` when the caller omits it (so the headline curl works even without the header). That is a platform/gateway change tracked separately — explicitly out of scope for this docs-only issue.
- If the recommended Anthropic API version changes in future, these examples (plus any SDK pins) should be updated together to stay consistent.
- No new dependencies were introduced.
