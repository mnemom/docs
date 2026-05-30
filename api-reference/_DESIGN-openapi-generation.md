# ADR: OpenAPI-driven `api-reference/` generation (MNE-114)

**Status:** Proposed (pilot landed — Safe House tag group)
**Date:** 2026-05-30
**Owner:** docs / verify-docs
**Branch:** `verify-docs/mne-114-openapi-pilot`

---

## Context

The `api-reference/` surface in mnemom/docs is the public contract for `api.mnemom.ai`.
Today it is a hybrid:

- **189** of 191 `api-reference/endpoint/*.mdx` pages already use Mintlify's
  `openapi:` frontmatter directive (e.g. `openapi: "GET /orgs"`). Mintlify renders
  the full reference (params, request/response schemas, "Try it", language samples)
  from the referenced spec operation. **The generation mechanism is already proven
  in-repo.**
- **2** endpoint pages are still hand-written prose
  (`delete-agents-agent-id.mdx`, `get-agents-agent-id-deletion-status.mdx`).
- **14** `api-reference/*.mdx` are hand-written **conceptual** pages
  (`overview`, `headers`, `errors`, `webhook-events`, `governance`, and the
  `*-overview` intros). Several of these — notably `safe-house-overview.mdx` —
  embed large per-endpoint prose tables and curl examples that **duplicate** what
  the spec already defines and therefore drift independently of the API.

The spec itself (`mnemom-api/openapi.json`, ~2.3 MB, committed in the API repo)
defines **619 operations across 487 paths**. Only **189** are projected by a
generated page. **430 operations have no generated page at all** — that is the
true migration backlog, far larger than the "2 hand-written endpoint pages"
headline suggests. Most of the gap is hidden inside prose overview pages and
entire tag groups (Alignment, Admin, Protection, Safe House, …) that were never
broken out into per-endpoint pages.

This ADR makes the per-endpoint reference a **projection of the committed spec**,
so endpoint drift becomes structurally impossible (the Cloudflare/Stripe pattern).

### Findings from the survey (verify before acting on these)

1. **Directive path form must OMIT `/v1`.** The spec's `servers[0].url` is
   `https://api.mnemom.ai/v1`, and **every** path key in `paths` is written
   *without* the `/v1` prefix (`/orgs`, `/safe-house/quarantine`, …). The 181
   majority of generated pages correctly use the bare form
   (`openapi: "GET /orgs"`). **8 pages are currently BROKEN** — they prefix `/v1`
   (`openapi: "GET /v1/trust/iocs"`, all of `Trust & Network (AEGIS)` + the admin
   security-advisory pages) and therefore match **no** spec operation. These
   should be fixed to the bare form as part of the cutover (tracked in the backlog
   below).
2. **The spec is wired by URL, not committed.** `docs.json` →
   `api.openapi = ["https://api.mnemom.ai/openapi.json"]`. Builds fetch the live
   prod spec. This couples doc builds to prod availability and to deploy timing,
   and is misaligned with the verify-docs `api-coverage` oracle, which already
   validates against the **committed** spec (`MNEMOM_API_DIR`, see
   `.github/workflows/verify-docs-gate.yml`). See "Decision 2".

---

## Decision

### 1. Every per-endpoint page is `openapi:`-generated from the committed spec.

Each `api-reference/endpoint/<method>-<path-slug>.mdx` contains only frontmatter:

```mdx
---
title: "<human title — the spec operation summary>"
openapi: "<METHOD> <path-without-/v1>"
---
```

- `<path-without-/v1>` must be an exact key in `openapi.json#/paths` (the bare,
  server-relative form). This is the load-bearing invariant.
- Filename convention (matches the existing 189 pages):
  `method` lowercased, then the path with `/`→`-`, `{param}`→`param`, and `_`→`-`.
  e.g. `GET /safe-house/quarantine/{quarantine_id}` →
  `get-safe-house-quarantine-quarantine-id.mdx`.
- No hand-written params/responses/examples in endpoint pages. The spec is the
  single source for those (see "Keeping curl examples" under Risks).

### 2. The spec is a COMMITTED copy in this repo, synced from `mnemom-api`.

Replace the live URL reference with a committed file and point `docs.json` at it:

```jsonc
// docs.json
"api": { "openapi": ["api-reference/openapi.json"] }
```

- **Why committed, not URL:** (a) deterministic, offline, reproducible builds;
  (b) a doc PR's diff *shows* the API surface change that motivated it, so
  reviewers see endpoint changes in the same PR; (c) it is the *same oracle*
  verify-docs `api-coverage` already uses (`MNEMOM_API_DIR`), so docs and the
  conformance gate agree by construction; (d) no prod-deploy-timing coupling.
- **Sync mechanism:** add `scripts/sync-openapi.mjs` that copies
  `$MNEMOM_API_DIR/openapi.json` (or fetches a pinned ref) into
  `api-reference/openapi.json`, plus a CI **freshness check** that re-runs the
  sync against `mnemom/mnemom-api@main` and fails if the committed copy is stale.
  This mirrors the GitHub-App cross-repo checkout already wired in
  `verify-docs-gate.yml` (it already checks out `mnemom-api` at `main`). The check
  is **advisory** until the broader drift backlog is burned down (consistent with
  the existing gate posture), then flipped to blocking.
- Keep the existing redirect `/api-reference/openapi.json` →
  `https://api.mnemom.ai/openapi.json` for external consumers, OR repoint it to the
  committed file — decide at cutover; the committed file is authoritative for the
  *build*.

### 3. Nav is grouped by spec `tag`; conceptual overviews stay and link in.

- Each Mintlify nav group under the **API Reference** tab corresponds to a spec
  tag (or a small set of related tags). The group's first page is the
  hand-written conceptual `*-overview.mdx` (narrative + cross-links); the rest are
  the generated endpoint pages for that tag, in a stable read order.
- The hand-written conceptual pages (`overview`, `headers`, `errors`,
  `webhook-events`, `governance`, and the `*-overview` intros) **remain
  hand-written** — they carry narrative the spec can't (threat models, when to use
  what, base URL, auth, error taxonomy). They must NOT re-document individual
  endpoints; per-endpoint prose belongs in the generated pages.

---

## Migration strategy

Migrate **tag group by tag group**, smallest-blast-radius first, each as its own
reviewable PR. Per group:

1. Enumerate the tag's operations from `openapi.json` (`method`, `path`,
   `summary`).
2. Generate one `openapi:`-directive page per operation (skip any that already
   exist).
3. Replace any **broken `/v1`-prefixed** directives in that tag with the bare form.
4. **Content-parity checklist** (the human review gate): for each endpoint that
   had hand-authored prose/examples in an overview page, confirm the equivalent
   information is either (a) present in the spec operation (description, examples,
   schemas) — preferred, push it upstream into `mnemom-api` if missing; or
   (b) intentionally dropped (e.g. redundant). Record the disposition. Then thin
   the overview page down to narrative-only and cross-link the generated pages.
5. Wire the generated pages into the tag's nav group in `docs.json`.
6. Run `mint validate` + `mint broken-links`; confirm every new directive
   resolves to a real spec op.

### Interaction with verify-docs

Generated pages **cannot drift** from the spec — the page *is* the spec
projection. As tag groups migrate:

- `api-coverage` (committed-spec oracle): the uncovered-operations count falls
  toward zero. The pilot alone takes the backlog from **430 → 399** uncovered ops.
- `api-examples` (live-prod curl walker): hand-written curl blocks in overview
  pages are the main thing this layer can flag. Removing per-endpoint prose/examples
  from overviews (step 4) shrinks this surface to near-zero, which is exactly the
  burndown the `verify-docs-gate.yml` header is waiting on before flipping
  `api-coverage`/`api-examples` to **blocking**.

---

## Pilot (landed in this branch)

**Tag group: `Safe House` (32 operations).**

Why Safe House:

- **Self-contained & coherent** — one tag, one functional domain (config/posture,
  quarantine, evaluations, metrics, patterns, canaries, campaigns, compliance), no
  cross-tag entanglement.
- **Currently almost entirely hand-written** — only **1** of its 32 operations had
  a generated page (`post-orgs-org-id-safe-house-enable`). The other 31 lived only
  as prose tables + curl in `safe-house-overview.mdx`, i.e. the maximal-drift case
  the ADR targets. High signal, contained blast radius.
- It exercises path params, query-heavy GETs, an SSE endpoint (`/safe-house/feed`),
  and a cross-resource compliance export — a good stress test of the directive
  mechanism.

What landed:

- **31 new generated endpoint pages** (the 32nd already existed). All directives
  use the bare (no-`/v1`) path form and resolve to real spec operations.
- `docs.json` Safe House nav group expanded from 1 → 33 pages
  (overview kept as the conceptual intro, then generated pages in functional order).
- `safe-house-overview.mdx` left **unchanged** in this pilot (per scope: thinning
  its per-endpoint prose is the content-parity step and needs human review — see
  the parity note below). It now sits above the generated pages as the narrative
  intro.

**Validation:** `mint validate` → `success build validation passed` /
`success OpenAPI definition is valid`. All 32 Safe House directives verified
present in `mnemom-api/openapi.json#/paths`. `docs.json` is valid JSON.

**Parity note for the follow-up (do NOT silently drop):** `safe-house-overview.mdx`
documents `GET/PUT /safe-house/config` and `GET/PUT /agents/:id/safe-house/config`.
**These paths are NOT in the current spec** (only `POST /safe-house/config/bulk-apply`
is tagged Safe House). Either the spec is missing those operations (fix in
`mnemom-api`) or the overview documents removed endpoints (drift to delete). Resolve
before thinning the overview.

---

## Migration backlog (remaining tag groups)

Counts are **uncovered operations per tag** after the Safe House pilot (399 total).
Order: ascending blast radius — small/clean tags first to build confidence, then the
three large tags (Alignment, Admin, Protection) which need the most content-parity
review. `[x]` = done.

- [x] **Safe House** — 31 pages (pilot, this branch)
- [ ] **A2A** — 1
- [ ] **Orgs** — 1 (likely a casing/tag dup of Organizations — reconcile tag)
- [ ] **Recipes** — 1
- [ ] **tools** — 1 (lowercase dup of `Tools` — reconcile tag casing in spec)
- [ ] **Attestation** — 2
- [ ] **Verification** — 2
- [ ] **Billing** — 2
- [ ] **Catalog** — 2
- [ ] **Misc** — 2
- [ ] **On-Chain** — 2
- [ ] **Organizations** — 2
- [ ] **Drift** — 2
- [ ] **Webhook Notifications** — 2
- [ ] **Notifications** — 3
- [ ] **Sideband** — 3
- [ ] **Transparency** — 3
- [ ] **Enforcement** — 4
- [ ] **Webhooks** — 5
- [ ] **Team Reputation** — 5
- [ ] **Tools** — 5
- [ ] **Teams** — 6
- [ ] **Licensing** — 6
- [ ] **Risk** — 7
- [ ] **Card Templates** — 10
- [ ] **Reputation** — 10
- [ ] **Internal** — 10 *(consider: keep out of the public reference — internal tag)*
- [ ] **Auth** — 12
- [ ] **Postures** — 15
- [ ] **Agents** — 17 *(includes folding in the 2 remaining hand-written pages: `delete-agents-agent-id`, `get-agents-agent-id-deletion-status` — preserve their GDPR narrative in an overview, generate the endpoint shells)*
- [ ] **Governance** — 19
- [ ] **Intelligence** — 27
- [ ] **Protection** — 50 *(large; heavy parity review)*
- [ ] **Admin** — 78 *(largest; decide public vs internal-only exposure per op)*
- [ ] **Alignment** — 82 *(largest functional surface; phase by sub-area)*

**Cross-cutting cleanup (do in an early wave, not per-tag):**

- [ ] Fix the **8 broken `/v1`-prefixed directives** (Trust & Network AEGIS + admin
  security advisories) → bare path form.
- [ ] Reconcile **duplicate/casing tags** in `mnemom-api` (`Orgs`↔`Organizations`,
  `tools`↔`Tools`) so nav grouping is clean.
- [ ] Decide exposure policy for `Internal` (10) — likely excluded from the public
  reference entirely.
- [ ] Switch `docs.json` `api.openapi` from the live URL to the committed
  `api-reference/openapi.json`, and land `scripts/sync-openapi.mjs` + the freshness
  CI check (Decision 2).

---

## Risks / tradeoffs

- **Loss of hand-authored per-endpoint narrative.** The current overviews have
  warm, opinionated prose ("Release with false-positive flag", threat rationale).
  Mitigation: that narrative moves *up* into the conceptual overview pages (which we
  keep) and *into the spec* (`description`/`x-codeSamples`) so it still renders on
  the generated page. The content-parity checklist (migration step 4) is the gate
  that prevents silent loss.
- **Mintlify directive limits.** The directive renders only what the spec encodes.
  Anything richer than the spec (multi-step flows, cross-endpoint how-tos) must live
  in guides/overviews, not endpoint pages. Acceptable — that's the right home for it.
- **Keeping curl examples.** Mintlify auto-generates a curl sample per operation.
  Curated/realistic examples should be added to the spec via `x-codeSamples` (or
  request/response `examples`) in `mnemom-api` so they render on the generated page
  *and* are validated by the `api-examples` walker against live prod — turning
  today's drift-prone hand-written curl into spec-anchored, verified examples.
- **Committed-spec staleness.** A committed copy can lag prod. Mitigation: the
  freshness CI check (Decision 2) re-syncs from `mnemom-api@main` and flags drift;
  this is strictly better than the current silent prod-timing coupling.
- **Big-tag review cost.** Alignment (82) + Admin (78) + Protection (50) are 210 of
  the 399 remaining ops and carry the most prose. Phase them by sub-area, and treat
  `Admin`/`Internal` exposure decisions as product calls, not mechanical conversion.
