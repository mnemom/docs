# Spec — Onboarding docs nits: CLI 404 redirect, Python package name, llms.txt onboarding entry, signup form alignment

- **Status:** Draft
- **Branch:** feature-issue-192-adw-e6a00177-fix-onboarding-docs-nits
- **Location:** `docs.json`, `introduction.mdx`, `protocols/overview.mdx`, `for-agents/index.mdx`, `quickstart/overview.mdx`, `agents.txt`
- **Related docs:** `AGENTS.md` (working conventions), `.mnemom/capability.yaml` (verbs), `scripts/check-redirects.mjs`, `scripts/check-doc-examples.mjs`, `api-reference/endpoint/post-auth-sign-up.mdx`, `concepts/personal-organization.mdx`, prior ADW plans in `specs/adw/`

## Problem / Objective

A bundle of independent onboarding/documentation nits surfaced by dogfooding the live Mnemom docs site (F1, F2, F6, F7). Each erodes the first five minutes of an agent's or human's integration experience — a dead CLI link, an inconsistent Python package name, an `llms.txt` index that buries the onboarding paths under the REST catalog, and signup docs that imply fields the real form does not have. The fifth finding (F3, the published alignment-card version drift) lives in the **website** repo and is explicitly out of scope here.

**User Story**

- As an **AI agent (or the human it is onboarding)** reading `docs.mnemom.ai` to integrate Mnemom for the first time,
- I want **every onboarding link to resolve, one unambiguous Python package name, an `llms.txt` that surfaces the quickstart/onboarding paths near the top, and signup instructions that match the real form**,
- So that **I can self-onboard from zero to a first verified call in five minutes without hitting a 404, installing the wrong package, missing the onboarding entry point, or being told to fill in fields that don't exist**.

**Problem Statement**

Four discrete defects, all fixable within the `docs` (Mintlify) repo:

- **F1 — CLI quickstart 404.** `docs.mnemom.ai/quickstart/cli` is a dead link. The canonical CLI reference page is `gateway/cli.mdx`, served at `/gateway/cli` (the legacy `/smoltbot/cli` path already redirects to `/gateway/cli` via the `/smoltbot/:path*` wildcard). There is no redirect or page covering `/quickstart/cli`, so anyone (or any agent) who guesses that URL — a natural guess given the `/quickstart/*` family — gets a 404.
- **F2 — Python package name mismatch.** The Agent Integrity Protocol Python package is referred to inconsistently across the broader surface: the canonical PyPI name used throughout *these* docs is `agent-integrity-proto`, but a stray `mnemom-aip` name appears on the marketing-site `agents.txt`. The docs must commit to **one** canonical Python package name and state it authoritatively where onboarding agents read it, so the docs never become the source of a second name.
- **F6 — `llms.txt` has no onboarding entry point.** The auto-generated `/llms.txt` is ordered by the `docs.json` navigation. The onboarding/quickstart paths live in the **"Getting Started"** tab, which currently sits *third* — after the very large **"Documentation"** tab — so `/quickstart/*` is buried deep in the index. A self-onboarding agent scanning `llms.txt` top-down sees the concept/reference catalog long before it finds how to start.
- **F7 — signup docs vs. the real form.** The real Mnemom signup is **email + password only** (no company field, no "syncs to CRM"). The docs' onboarding entry point (`quickstart/overview.mdx`) jumps straight to `mnemom login` and never states what creating an account actually involves, leaving room for the website's richer-form language to leak into a reader's expectations. The onboarding docs should state the real shape of the form (email + password) and contain no company/CRM claims.

## Approach & Changes

Small, surgical, config-and-prose edits. No new pages, no new dependencies, no build-step changes — consistent with `AGENTS.md` ("`docs.json` is the config contract", "don't add a custom build step") and the supervised `merge_strategy: external` posture (the worker drives the checks green and stops; a human reviews and merges the public docs).

- **`docs.json`** — the config contract for both routing and navigation order. Two changes:
  - **F1:** add a `redirects[]` entry `{"source": "/quickstart/cli", "destination": "/gateway/cli"}`. Destination must be the concrete page `/gateway/cli` (not `/smoltbot/cli`), because `scripts/check-redirects.mjs` requires every non-wildcard internal destination to resolve to an existing page — `gateway/cli.mdx` exists; `smoltbot/cli` does not.
  - **F6:** reorder the `navigation.tabs` array so the **"Getting Started"** tab immediately follows **"For AI Agents"** (i.e. tabs become: `For AI Agents`, `Getting Started`, `Documentation`, `Guides`, `Protocols`, `API Reference`, …). Because Mintlify derives `/llms.txt` ordering from the navigation tree, this lifts the five `/quickstart/*` pages to just below the already-first `/for-agents` entry, giving `llms.txt` a clear onboarding entry point near the top without removing or renaming any page.
- **`introduction.mdx`** — the "SDK packages" table (lines ~72–93) is the authoritative package map. **F2:** add a one-line callout immediately under the table fixing the canonical names ("PyPI: `agent-integrity-proto`; npm: `@mnemom/agent-integrity-protocol`; `mnemom-aip` is **not** a package — do not install it"). This makes the docs an unambiguous single source of truth.
- **`protocols/overview.mdx`** — the protocol package table (lines ~163–164) is the other place the package map is published. **F2:** verify it already reads `agent-integrity-proto` for Python (it does) and leave it as the canonical reference; no name change needed, but it is in scope for the audit.
- **`for-agents/index.mdx`** — the agent-facing "Start Here" page. **F2:** ensure any package reference points at the canonical `agent-integrity-proto` (audit; currently it references no pip name, so this is a no-op unless the audit finds drift).
- **`quickstart/overview.mdx`** — the onboarding entry point. **F7:** add a short "Create your account" note above the `mnemom login` snippet stating signup is **email + password only** (linking to the [Sign up](/api-reference/endpoint/post-auth-sign-up) reference and `/concepts/personal-organization` for what auto-provisions at signup), with no company field and no CRM-sync claim. Prose only — **no** new `curl https://api.mnemom.ai/...` block, so `check-doc-examples.mjs` (which validates such curl bodies against the live OpenAPI spec) is not triggered.
- **`agents.txt`** — repo-root mirror of the agent pitch. **F2/F6 audit:** confirm it carries no `mnemom-aip` string and its quickstart links are correct (currently clean); update only if the audit finds drift.

### New Files

None. All changes are edits to existing config and content files.

### Implementation Plan

**Foundation (audit + canonical decision).** Establish the single canonical Python package name (`agent-integrity-proto`) and confirm the live offending strings (`mnemom-aip`, `/quickstart/cli`, company/CRM signup language) do not already exist inside this repo's content — so the work is *making the docs authoritative and complete*, not chasing the website's copies (which are out of scope per the F3 note).

**Core Implementation (the four nits).** Apply F1 (redirect), F6 (nav reorder), F2 (canonical-name callout), and F7 (signup note) as described above.

**Integration (validation).** Run the deterministic gates — `check:redirects` (lint verb), `check-doc-examples` (test verb), and `mintlify broken-links` (the required "Validate Mintlify Docs" check) — to prove zero regressions, then hand off for human review.

### Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Audit the current state (read-only baseline)
- Confirm `gateway/cli.mdx` exists and is the canonical CLI page (served at `/gateway/cli`).
- Grep the whole repo (excluding `node_modules`) for `mnemom-aip` and confirm it appears **nowhere** in this repo's content; record this as the F2 baseline.
- Grep for `quickstart/cli` and confirm no page or redirect currently covers it (F1 baseline).
- Grep onboarding/quickstart content for `company`, `CRM`, `Salesforce`, `HubSpot`, "syncs to" in a signup context and confirm none describe the signup form (F7 baseline; `concepts/webhook-contract.mdx`'s HubSpot reference is unrelated notification routing — leave it).
- Read `scripts/check-redirects.mjs` and `scripts/check-doc-examples.mjs` to confirm the exact validation rules the edits must satisfy (redirect destinations must resolve to a real page; only `api.mnemom.ai` curl blocks are spec-checked).

### 2. F1 — Add the `/quickstart/cli` redirect
- In `docs.json`, append to the `redirects` array: `{ "source": "/quickstart/cli", "destination": "/gateway/cli" }`.
- Keep the existing root invariant (`/` → `/introduction`) and all other redirects intact (the redirect checker asserts the root invariant explicitly).

### 3. F6 — Reorder navigation so onboarding leads `llms.txt`
- In `docs.json` `navigation.tabs`, move the entire **"Getting Started"** tab object so it sits immediately after the **"For AI Agents"** tab and before **"Documentation"**.
- Do not add, remove, rename, or re-slug any page — order only. Every page must remain reachable (orphaned `.mdx` files 404 in Mintlify).

### 4. F2 — Make the canonical Python package name authoritative
- In `introduction.mdx`, directly below the SDK packages table, add a one-line note pinning the canonical names: PyPI `agent-integrity-proto`, npm `@mnemom/agent-integrity-protocol`, and that `mnemom-aip` is not a real package.
- Verify `protocols/overview.mdx`, `for-agents/index.mdx`, and `agents.txt` reference only `agent-integrity-proto` for the AIP Python package; fix any drift found (expected: none).
- Do not touch the AAP package (`agent-alignment-proto` / `@mnemom/agent-alignment-protocol`) — it is a distinct, correctly-named protocol SDK.

### 5. F7 — Align the signup docs to the real form
- In `quickstart/overview.mdx`, add a short "Create your account" note above the `mnemom login` snippet: signup is **email + password only**, link to [Sign up with email + password](/api-reference/endpoint/post-auth-sign-up) and [Personal organization](/concepts/personal-organization) (auto-provisioned at signup).
- Use absolute internal links (`/api-reference/...`), per `AGENTS.md`. Add no company field, no CRM-sync language, and no `curl https://api.mnemom.ai/...` block.

### 6. Run the verification commands (final step)
- Execute every command in the **Validation Commands** section below and confirm each exits cleanly with zero regressions before handing off the supervised PR for human review.

> Note: This change is **not** UX-facing per `.mnemom/capability.yaml` (`ux_path_globs` is `images/**` only; this touches `.json`/`.mdx`/`.txt` content). No UX scenario manifest, `/ux_validate` audit, or `ux` regression check applies. There is also no client/front-end code and no E2E harness in this repo (the manifest declares no `test_e2e`; `test` is the doc-as-spec validator), so no E2E test is created.

## Key Decisions & Rationale

- **F1 destination is `/gateway/cli`, not `/smoltbot/cli`.** `check-redirects.mjs` resolves non-wildcard destinations against real pages and the nav tree. `smoltbot/cli` is itself only a redirect source (`/smoltbot/:path*` → `/gateway/:path*`) with no backing file, so pointing the new redirect at it would (a) fail the redirect checker and (b) create a redirect chain. Targeting the concrete `gateway/cli.mdx` page is correct and chain-free.
- **F6 is solved by nav order, not by hand-editing `llms.txt`.** `llms.txt` and `llms-full.txt` are auto-generated by Mintlify (stated in `AGENTS.md` and `agents.txt`) and are public commitment #8 — they must not be hand-authored or broken. The only repo-controllable lever over their ordering is the `docs.json` navigation tree. "For AI Agents" is already first; promoting "Getting Started" to second is the minimal change that surfaces `/quickstart/*` near the top of the index. *Rejected alternative:* trying to inject a custom `llms.txt` — not supported by Mintlify when navigation exists, and would violate the "don't break the agent-facing surfaces" rule.
- **F2 canonical name is `agent-integrity-proto`.** It is already the name used consistently across every page in this repo (`introduction.mdx`, `protocols/overview.mdx`, `protocols/aip/quickstart.mdx`, `guides/upgrading-to-1-0.mdx`, `changelog.mdx`, …). Standardizing on it costs zero churn; standardizing on `mnemom-aip` would require rewriting the entire repo and the published PyPI history. The fix therefore *hardens* the docs as the single source of truth rather than introducing a new name. The actual `mnemom-aip` string lives on the **website** `agents.txt` and is corrected there (out of scope, like F3) — flag this for the human reviewer in the PR description.
- **F7 stays prose-only with no curl example.** Adding a `curl https://api.mnemom.ai/v1/auth/...` block would be validated against the live OpenAPI spec by `check-doc-examples.mjs`; the sign-up path (`POST /auth/sign-up`) and exact body are already documented in `api-reference/endpoint/post-auth-sign-up.mdx`. Linking to that generated reference avoids duplicating (and risking drift in) the request contract while still making the onboarding page state the real form shape. *Rejected alternative:* hand-writing the signup request body inline — duplicates spec-owned content and risks tripping the doc-as-spec gate.
- **Scope discipline.** F3 (website alignment-card version) and the website-side `mnemom-aip` string are deliberately left to the website repo, matching the issue's split. This plan touches only the `docs` repo.

## Verification

Execute every command to validate the feature works correctly with zero regressions.

### Unit Tests & Edge Cases

There is no application code; the "tests" are the deterministic doc gates. Cover these cases:

- **Redirect resolves (F1):** `check:redirects` must pass with the new `/quickstart/cli` → `/gateway/cli` entry, proving the destination is a real page. Edge case: the root invariant (`/` → `/introduction`) must still be reported OK — confirm it is untouched.
- **No broken/orphaned pages after reorder (F6):** `mintlify broken-links` must report zero broken internal links, and every page moved with the "Getting Started" tab must remain reachable from navigation (no orphans).
- **No spec drift introduced (F7/F2):** `check-doc-examples` must pass — confirming the prose additions introduced no malformed `api.mnemom.ai` curl example.
- **Name-consistency assertion (F2):** a repo grep for `mnemom-aip` over content files returns **zero** matches; a grep for the canonical `agent-integrity-proto` still resolves in `introduction.mdx` and `protocols/overview.mdx`.
- **JSON validity (F1/F6):** `docs.json` still parses (the redirect checker parses it as a side effect and exits 1 on syntax error).

### Acceptance Criteria

- [ ] No dead `/quickstart/cli` link — the URL redirects to `/gateway/cli` (the canonical CLI reference), and `check:redirects` is green.
- [ ] Exactly one Python package name for AIP across all docs content — `agent-integrity-proto` — stated authoritatively in `introduction.mdx`; the string `mnemom-aip` appears nowhere in the repo.
- [ ] `/llms.txt` surfaces the onboarding paths near the top: the "Getting Started" tab (the `/quickstart/*` pages) is the second navigation tab, immediately after "For AI Agents".
- [ ] The onboarding entry point (`quickstart/overview.mdx`) states signup is email + password only, with no company field and no CRM-sync claim, and links to the generated Sign up reference.
- [ ] `Validate Mintlify Docs` (`mintlify broken-links`) + the redirect and doc-example checks all pass.
- [ ] No page is added, removed, renamed, or orphaned; no new dependency is introduced; no build step is added.

### Validation Commands

Run from the repo/worktree root. Every command must exit cleanly.

- `npm run check:redirects` — **lint verb.** Redirect-table integrity, including the new `/quickstart/cli` → `/gateway/cli` entry and the `/` → `/introduction` root invariant.
- `echo "(no typecheck for MDX docs)"` — **typecheck verb** (no-op; MDX has no static type step).
- `npm ci && npm run check:doc-examples` — **test verb.** Doc-as-spec validator: confirms no malformed `api.mnemom.ai` curl example was introduced.
- `echo "(Mintlify-hosted build; validated by CI)"` — **build verb** (no-op; the site is Mintlify-hosted).
- `mintlify broken-links` — the required **"Validate Mintlify Docs"** check. Must report zero broken internal links after the nav reorder and redirect addition. (Run `npm i -g mintlify` once if the CLI is not installed.)
- `grep -rn "mnemom-aip" --include='*.mdx' --include='*.md' --include='*.txt' --include='*.json' . | grep -v node_modules` — must print **nothing** (F2 assertion).

## Known Limitations / Follow-ups

- **Website repo handles F3 and the live `mnemom-aip` string.** The published `www.mnemom.ai/.well-known/alignment-card.json` version drift (F3) and the marketing-site `agents.txt` that actually contains `pip install mnemom-aip` live in the **website** repo. Call this out in the supervised PR description so the reviewer can ensure the companion website change lands — otherwise the cross-surface inconsistency persists even though the docs are internally correct.
- **`llms.txt` ordering verification needs a live Mintlify build.** `mintlify broken-links` validates links but does not render `/llms.txt`. After merge (Mintlify auto-deploys on push to `main`), spot-check that `https://docs.mnemom.ai/llms.txt` now lists the `/quickstart/*` paths near the top. This is a post-merge human check, consistent with the supervised posture.
- **Nav reorder is a human-facing change too.** Promoting "Getting Started" above "Documentation" also changes the top-tab order humans see in the rendered site. This is intentional and improves onboarding discoverability, but flag it in the PR so the reviewer signs off on the UX shift.
