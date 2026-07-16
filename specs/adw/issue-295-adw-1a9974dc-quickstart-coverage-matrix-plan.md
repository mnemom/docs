# Spec — Quickstart coverage matrix: assert every provider × auth-header × path (× SDK-language) is documented

- **Status:** Draft
- **Branch:** feature-issue-295-adw-1a9974dc-add-a-quickstart-coverage-matrix-asserti
- **Location:** scripts/check-quickstart-matrix.mjs (new), quickstart/gateway.mdx, quickstart/self-hosted.mdx, package.json
- **Related docs:** quickstart/gateway.mdx (Supported providers table + gateway-path table), quickstart/sdk-direct.mdx (Install CodeGroup), quickstart/self-hosted.mdx (provider env vars + Connect-an-agent curl), scripts/check-model-coverage.mjs (sibling sentinel-region gate this mirrors), scripts/lib/doc-examples-extract.mjs (curl parsing primitives), scripts/check-sdk-quickstart.mjs (indentation-tolerant fence extractor reference), AGENTS.md

## Problem / Objective

**User Story**

- As a docs maintainer / an AI coding agent onboarding a customer,
- I want a single deterministic check that asserts every provider × auth-header × integration-path (× SDK-language) combination that the quickstart *claims to support* also has a *worked, copy-pasteable example*,
- So that a coverage hole (a provider auth header advertised in a table but with no runnable curl, or an integration path missing one provider) is caught in CI instead of silently shipping a doc that a reader cannot actually follow.

**Problem Statement**

The quickstart set documents three providers (Anthropic `x-api-key`, OpenAI `Authorization: Bearer`, Gemini `x-goog-api-key` — see `quickstart/gateway.mdx` "Supported providers" table) and two SDK languages (Python + TypeScript, per the `<CodeGroup>` fences in `quickstart/sdk-direct.mdx`) across three integration paths (gateway / sdk-direct / self-hosted). But there is **no artifact or check asserting the matrix is complete**. Concretely, on the current tree:

- `quickstart/gateway.mdx` advertises OpenAI and Gemini gateway paths + auth headers in tables, but only ships a **worked curl for Anthropic**. OpenAI and Gemini have no runnable example — a documented-but-unexemplified cell.
- `quickstart/self-hosted.mdx` advertises `OPENAI_API_KEY` / `GEMINI_API_KEY` as supported providers, but the "Connect an agent" step only shows an **Anthropic curl** against `localhost:8787`.

These holes are invisible today. This feature (a) adds a deterministic coverage-matrix check and (b) fills the current holes so the check exits 0 on the tree — delivering the "worked example for every advertised provider" value the issue asks for.

## Approach & Changes

Add `scripts/check-quickstart-matrix.mjs`: a Node ≥22, dependency-free (`node:*` + reuse of existing `scripts/lib/doc-examples-extract.mjs` primitives) check that:

1. **Derives the ASSERTED-SUPPORTED set** from the docs (never hard-codes it, so it can't go stale):
   - Provider → auth-header, parsed from the `model-coverage:supported` sentinel-delimited table in `quickstart/gateway.mdx` (`Anthropic → x-api-key`, `OpenAI → Authorization: Bearer`, `Gemini → x-goog-api-key`).
   - Provider → gateway path segment (`/anthropic`, `/openai`, `/gemini`), parsed from the "gateway supports all three providers" path table in `quickstart/gateway.mdx`.
   - SDK languages (`python`, `typescript`), parsed from the Install `<CodeGroup>` fence labels in `quickstart/sdk-direct.mdx`.
2. **Derives the DOCUMENTED-EXAMPLE set** by extracting fenced code blocks from each quickstart page and:
   - For curl paths (**gateway**, **self-hosted**): finding every `curl` whose URL path begins with a provider segment AND whose headers carry that provider's expected auth header. (Reuses `extractCurls` + `parseCurl` from `doc-examples-extract.mjs` — those primitives are correct; only fence *detection* needs fixing, see below.)
   - For **sdk-direct**: finding a `python` and a `typescript` fenced block for each core SDK operation.
3. **Computes the matrix** = asserted cells, and **flags any asserted cell lacking a documented example**. Exits `0` when the matrix is fully covered; exits `1` listing the exact uncovered cells; exits `2` on bad CLI usage. **Fails closed** (exit 1, explicit error) if any source region/table is missing or yields zero blocks — a dropped table or a broken extractor must never pass vacuously.
4. Supports `--print` (render the matrix to stdout, human-readable) and `--self-test` (run built-in fixtures), matching the `scripts/check-model-coverage.mjs` / `scripts/check-path-references.mjs` CLI contract.

**Fill the current coverage holes** so the check exits 0 on the tree:

- `quickstart/gateway.mdx`: add worked OpenAI (`/openai/v1/chat/completions`, `Authorization: Bearer $OPENAI_API_KEY`) and Gemini (`/gemini/v1beta/models/gemini-2.5-flash:generateContent`, `x-goog-api-key: $GEMINI_API_KEY`) curl examples alongside the existing Anthropic one, inside the "Make an API call" step.
- `quickstart/self-hosted.mdx`: add worked OpenAI + Gemini curls against `http://localhost:8787` in the "Connect an agent" step, mirroring the existing Anthropic curl.

**Wire the npm script** (not CI): add `"check:quickstart-matrix": "node scripts/check-quickstart-matrix.mjs"` to `package.json`.

### The fence-detection fix (blocking, per @wassimwehbi-mnemom)

`doc-examples-extract.mjs`'s `extractFencedBlocks` uses **column-0** fence detection (``line.startsWith("\`\`\`")``). Every fence in `gateway.mdx` is 4-space indented inside `<Step>` / `<CodeGroup>` MDX tags, so that extractor parses **zero** blocks from these pages — the fail-closed guard would fire on every run and the AC could never exit 0. **The new script must NOT reuse that column-0 detector for block splitting.** Instead it defines a **local, indentation-tolerant** `extractFencedBlocks` that trims leading whitespace before testing for the ```` ``` ```` marker and strips the common indent from block bodies — modeled on the working extractor already in `scripts/check-sdk-quickstart.mjs:35`. (We deliberately do **not** edit the shared `doc-examples-extract.mjs` extractor: it has three other consumers — `check-doc-examples.mjs`, `run-doc-examples.mjs`, `extractBashBlocks` — and changing its splitting behavior would be an out-of-scope rewrite (MNE-437). Only `extractCurls`/`parseCurl`, which operate on an already-extracted block *body*, are reused.) A fixture with an **indented** fence is added to `--self-test` so this regresses loudly if it ever breaks again.

### New Files

- `scripts/check-quickstart-matrix.mjs` — the coverage-matrix derivation + check, with an embedded `--self-test` fixture suite (indentation-tolerant fence extraction, provider/auth derivation, uncovered-cell detection, fail-closed-on-empty).

### Implementation Plan

**Foundation** — establish the indentation-tolerant extractor and the asserted-set derivation from the docs, with fail-closed guards. **Core Implementation** — build the documented-example scanner (curl matching per provider/auth-header; SDK-language block detection), compute the matrix, format the uncovered-cell report. **Integration** — fill the two content gaps so the tree is fully covered, add the npm script, and prove exit 0 via the validation commands.

### Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the reference implementations

- Read `scripts/check-model-coverage.mjs` for the sentinel-region parsing, the `--self-test`/`--print` CLI contract, exit-code convention (0 clean / 1 fail / 2 bad usage), and the fail-closed-on-missing-region idiom.
- Read `scripts/check-sdk-quickstart.mjs:35` for the indentation-tolerant `extractFencedBlocks` to model the local extractor on.
- Read `scripts/lib/doc-examples-extract.mjs` `extractCurls` + `parseCurl` (the header/URL parsing to reuse on block bodies).

### 2. Create `scripts/check-quickstart-matrix.mjs` — extraction primitives

- Add a module docstring stating purpose, exit codes, and the "no new dependency (Node ≥22 `node:*` + reuse)" note (mirror the sibling scripts' header style).
- Implement a **local, indentation-tolerant** `extractFencedBlocks(source)` (trim leading whitespace before the fence test; strip common indent from bodies), returning `{ lang, line, body }`. Do NOT import the column-0 detector from `doc-examples-extract.mjs`.
- Import `extractCurls` and `parseCurl` from `../lib/doc-examples-extract.mjs` for per-block curl parsing.

### 3. Derive the ASSERTED-SUPPORTED set (data-driven, fail-closed)

- Parse the `model-coverage:supported:start/end` sentinel table in `quickstart/gateway.mdx` → `Map<provider, authHeaderName>` (`x-api-key`, `authorization` (Bearer), `x-goog-api-key`; normalize header names lowercase).
- Parse the gateway-path table → `Map<provider, pathSegment>` (`/anthropic`, `/openai`, `/gemini`).
- Parse the Install `<CodeGroup>` fence labels in `quickstart/sdk-direct.mdx` → `Set<sdkLanguage>` = {python, typescript}.
- **Fail closed**: if any region is missing, unparseable, or yields an empty set, exit 1 with a specific message. (Guards MNE-442 cold-start/empty and the exact zero-blocks bug the reviewer flagged.)

### 4. Derive the DOCUMENTED-EXAMPLE set

- For **gateway** and **self-hosted** pages: extract fenced blocks, run `extractCurls`/`parseCurl` over `bash`/`sh`/`shell`/`curl` block bodies, and for each curl determine the provider from the URL path segment and whether the required auth header for that provider is present. Record `(path, provider)` as covered.
- For **sdk-direct**: record `(sdk-direct, language)` as covered when at least one `python` / `typescript` fenced block exists for the core SDK operations.

### 5. Compute the matrix + report

- Build the asserted cell set: gateway × \{each provider\}, self-hosted × \{each provider\}, sdk-direct × \{each language\}.
- Diff asserted − documented → uncovered cells. Track `covered`/`total` counts where numerator and denominator correspond (MNE-438); list each uncovered cell exactly once with provider, auth-header, path, and the missing evidence type.
- Exit 0 when `uncovered.length === 0`; else exit 1 printing the exact uncovered cells. Add `--print` to render the full matrix table to stdout regardless of pass/fail.

### 6. Add the `--self-test` fixture suite

- Follow the `selfTest()` pattern in `check-model-coverage.mjs` (pass/fail counter, `assert(name, cond)`).
- Fixtures MUST include: (a) an **indented** fence (4-space, inside a simulated `<Step>`) that the extractor parses correctly — regression guard for the flagged bug; (b) a curl with a mismatched/absent auth header → flagged uncovered; (c) a fully-covered mini-matrix → exit-0/ok; (d) a missing sentinel region → fail-closed. Use obvious placeholder tokens in fixtures (e.g. `$ANTHROPIC_API_KEY`, `test-token`), never real- or credential-shaped values (MNE-339).
- Wire `--self-test` to `exit(selfTest() ? 0 : 1)` and `--print`/`--help` per the sibling CLI contract; exit 2 on unknown args.

### 7. Fill the coverage gaps in the docs

- `quickstart/gateway.mdx`, "Make an API call" step: add worked OpenAI and Gemini curls next to the Anthropic one — OpenAI `POST /openai/v1/chat/completions` with `Authorization: Bearer $OPENAI_API_KEY` (model `gpt-5`); Gemini `POST /gemini/v1beta/models/gemini-2.5-flash:generateContent` with `x-goog-api-key: $GEMINI_API_KEY`. Use `$OPENAI_API_KEY`/`$GEMINI_API_KEY` env references (never literal keys). Keep the existing Anthropic example and the provider-path table intact.
- `quickstart/self-hosted.mdx`, "Connect an agent" step: add worked OpenAI + Gemini curls against `http://localhost:8787/openai/...` and `.../gemini/...` mirroring the existing Anthropic curl.
- Keep prose sentence-case and the institutional Mnemom voice (no exclamation marks); no new emoji or hard-coded design tokens (these are curl code blocks + prose, no styling).

### 8. Wire the npm script (NOT CI)

- Add `"check:quickstart-matrix": "node scripts/check-quickstart-matrix.mjs"` to `package.json` `scripts`. Do NOT add any dependency (`package.json`/`package-lock.json` stay otherwise untouched).
- **Do NOT create or edit any `.github/workflows/**` file.** (NEVER-AUTO path, 7-for-7 fleet pattern; scope correction by @wassimwehbi-mnemom.) The CI wiring lands separately by the operator in a consolidated PR (precedent: docs#350).

### 9. Run the Verification commands

- Run every command in the Validation Commands section and confirm zero errors and the check exits 0 on the current tree.

## Key Decisions & Rationale

- **Script-derives, no new `.mdx` page.** The AC allows a `coverage-matrix.mdx` table *or* a script that derives it. A script avoids a new orphan page that would need `docs.json` nav wiring (AGENTS.md: Mintlify 404s orphaned files) and keeps the check the single source of truth. Rejected: a hand-maintained `.mdx` table (drifts, needs nav coverage, adds a `check-nav-coverage` obligation).
- **Do NOT edit the shared `doc-examples-extract.mjs` fence detector.** It has three live consumers; changing its splitting behavior to be indentation-tolerant is an out-of-scope rewrite that risks a regression in the doc-as-spec walker (MNE-437). A local extractor (modeled on the proven one in `check-sdk-quickstart.mjs`) is isolated and safe. We still reuse the *correct* `extractCurls`/`parseCurl` primitives (they operate on block bodies, not fence detection).
- **Fill the holes rather than accept a non-zero exit.** The AC says "exits 0 on the current tree (or lists the exact uncovered cells)"; the human comment makes clear the intent is exit 0. Since the current tree genuinely lacks OpenAI/Gemini worked examples, delivering the feature means *adding* them — which is the reader value the issue targets.
- **Fail closed on empty/missing regions.** A dropped table or a fence-extractor that returns zero blocks must be a hard error, never a vacuous pass (MNE-442 / MNE-439) — this is exactly the failure mode the reviewer flagged.
- **No CI wiring in this PR.** `.github/workflows/**` is a NEVER-AUTO path for the autonomous pipeline (@wassimwehbi-mnemom scope correction). The exact wiring hook is flagged in the PR description (see Known Limitations) for the operator's consolidated PR.
- **Curl-path model is uniform across gateway + self-hosted.** Requiring a worked curl per provider on both curl-bearing paths keeps the coverage model simple and verifiable rather than special-casing self-hosted to accept config-table evidence.

## Verification

Execute every command to validate the feature works correctly with zero regressions.

### Unit Tests & Edge Cases

Covered by the embedded `--self-test` suite (run via `node scripts/check-quickstart-matrix.mjs --self-test`):

- **Indented fence** (4-space, inside a simulated `<Step>`) is parsed into a block — the regression guard for the column-0 bug the reviewer flagged.
- **Auth-header mismatch/absent** on a provider curl → cell flagged uncovered.
- **Fully-covered mini-matrix** → `ok`, 0 uncovered, exit 0.
- **Missing sentinel region / zero extracted blocks** → fail-closed (exit 1, explicit error), never a vacuous pass.
- **Counter correctness**: covered + uncovered === total asserted cells; each uncovered cell listed once (MNE-438).
- Fixtures use obvious placeholder tokens only (MNE-339).

### Acceptance Criteria

- [ ] `scripts/check-quickstart-matrix.mjs` exists and enumerates provider (Anthropic/OpenAI/Gemini) × auth-header × integration-path (gateway/sdk-direct/self-hosted) × SDK-language (python/typescript).
- [ ] It flags any cell asserted-supported elsewhere in the quickstart but lacking a documented example.
- [ ] It **exits 0 on the current tree** after the gateway + self-hosted worked-example additions.
- [ ] `--print` renders the full matrix; `--self-test` passes; exit codes are 0/1/2 per the sibling contract.
- [ ] It fails closed (exit 1) on a missing source region or zero extracted blocks.
- [ ] `npm run check:quickstart-matrix` is defined and passes; no new dependency added.
- [ ] NO `.github/workflows/**` file is created or edited; the wiring hook is documented in the PR description.
- [ ] Existing doc checks (`check:doc-examples`, `check:links`, `check:redirects`, `check:model-coverage`, `check:sdk-quickstart`) still pass with the new curl examples in place.

### Validation Commands

- `node scripts/check-quickstart-matrix.mjs --self-test` — built-in fixtures pass.
- `node scripts/check-quickstart-matrix.mjs` — exits 0 on the current tree (add worked examples first).
- `node scripts/check-quickstart-matrix.mjs --print` — renders the matrix for eyeball review.
- `npm run check:quickstart-matrix` — the wired script passes.
- `node scripts/check-sdk-quickstart.mjs` — SDK quickstart trace gate still green (sdk-direct untouched but verify).
- `node scripts/check-model-coverage.mjs` — supported-model gate still green after the gateway.mdx edits (the sentinel table is unchanged; the new curls are outside it).
- The manifest `lint` verb: `npm run check:redirects && npm run check:links` — passes.
- The manifest `typecheck` verb: `echo "(no typecheck for MDX docs)"` — no-op, passes.
- The manifest `test` verb: `npm ci && npm run check:doc-examples` — the doc↔OpenAPI example validator still passes with the new curls (they target real gateway paths with valid shapes).
- The manifest `build` verb: `echo "(Mintlify-hosted build; validated by CI)"` — no-op, passes.
- `npx mintlify broken-links` — no new broken internal links (AGENTS.md pre-merge requirement).

## Known Limitations / Follow-ups

- **CI wiring hook (for the operator's consolidated PR, per @wassimwehbi-mnemom + docs#350):** wire `node scripts/check-quickstart-matrix.mjs` into a new `.github/workflows/quickstart-matrix.yml` triggered on `pull_request` to `main` with `paths: ["quickstart/**", "scripts/check-quickstart-matrix.mjs", "scripts/lib/doc-examples-extract.mjs"]` (model it on `.github/workflows/sdk-quickstart-trace.yml`). This PR intentionally does NOT create it — flag this in the PR description.
- The matrix requires a worked curl per provider on the curl-bearing paths; if a future page documents a fourth provider, add it to the gateway sentinel + path tables and the check will demand a worked example (fail-closed on the new hole) — intended behavior.
- sdk-direct coverage is at the SDK-language granularity (python/typescript), matching how the SDKs are provider-agnostic; per-provider analysis-LLM examples are out of scope here.
