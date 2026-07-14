# Docs Validators — Health Dashboard

Single reference for every automated gate that runs against this docs repo.
Last verified: 2026-06-29.

## Validators

| # | Validator | Workflow | PR trigger | Schedule (UTC) | Posture | What it validates |
|---|-----------|----------|------------|----------------|---------|-------------------|
| 1 | Mintlify CI | `mintlify-ci.yml` | All PRs (no path filter) | Daily 06:00 (`0 6 * * *`) | BLOCKING | `mint validate` build + broken internal links + redirect-table integrity (`docs.json` `redirects`) |
| 2 | Doc Examples vs OpenAPI | `doc-examples.yml` | PRs touching `**/*.mdx`, `**/*.md`, scripts, `package.json` | Daily 06:45 (`45 6 * * *`) | BLOCKING (curl drift); ADVISORY (slice drift line) | Every `curl https://api.mnemom.ai/v1/…` invocation in MDX must resolve to a real `{path, method}` in the live OpenAPI spec. Also emits (advisory, non-failing) the `committed-slice vs live: N paths added / M removed / K changed` drift line (issue #278) — see the committed-slice freshness check under "On-demand probes" |
| 3 | Internal-reference gate | `internal-reference-gate.yml` | All PRs (no path filter) | — (PR + push only) | BLOCKING | Scans `*.mdx` and `api-reference/openapi.json` prose for: private-repo links (`github.com/mnemom/scale`, `safe-house-hardening`, `safe-house-aegis`, `deploy`); retired codenames XFD/CBD/CFD; internal codename polis; internal agent names solon/themis/cassandra/blackbeard/wintermute; 1Password paths (`op://`); internal tooling paths (`emps.`, `packages/core`); internal tracker refs UC-N, `mnemom-platform#N`, AEGIS-N; ADR refs (ADR-NNN, MDX only) |
| 4 | Spec Examples Validation | `spec-examples.yml` | PRs touching `specifications/**/*.mdx`, scripts, `package.json` | Daily 07:00 (`0 7 * * *`) | BLOCKING | YAML/JSON fenced blocks in `specifications/*.mdx` annotated `# t5-3:full-example` validate against the live OpenAPI schema via Ajv 2020 |
| 5 | Doc Examples Live (staging) | `doc-examples-live.yml` | No PR trigger | Daily 07:00 (`0 7 * * *`) | ADVISORY (requires `MNEMOM_STAGING_TOKEN` secret; skips without it) | Executes safe curl examples from MDX against the staging environment and asserts response status is documented or 2xx |
| 6 | SDK Quickstart Trace Verification | `sdk-quickstart-trace.yml` | PRs touching `quickstart/sdk-direct.mdx`, `es/`+`fr/` locale equivalents, script, workflow file | Daily 07:15 (`15 7 * * *`) | BLOCKING | AlignmentCard + APTrace pairs in the SDK-direct quickstart (en/es/fr): asserts `action.name` is in `bounded_actions` |
| 7 | SDK Examples vs Published Packages | `sdk-examples.yml` | PRs touching drift-detection pages, `quickstart/sdk-direct.mdx` (en/es/fr), workflow file | Daily 07:30 (`30 7 * * *`) | BLOCKING | TypeScript snippets compile against pinned npm packages (`@mnemom/agent-alignment-protocol@1.3.0`, `@mnemom/agent-integrity-protocol@1.2.0`); Python snippets bind against matching pip packages (`agent-alignment-protocol==1.3.0`, `agent-integrity-proto==1.2.0`) |
| 8 | OpenAPI Freshness | `openapi-freshness.yml` | PRs touching `api-reference/openapi.json` or `scripts/sync-openapi.mjs` | Mondays 13:00 (`0 13 * * 1`) | BLOCKING on drift (does not auto-commit — requires human review + refresh PR) | Committed `api-reference/openapi.json` matches the deployed customer slice at `https://api.mnemom.ai/openapi.json` |
| 9 | Verify Docs Gate (Engine A) | `verify-docs-gate.yml` | All PRs, push to main | — (no schedule) | ADVISORY (skips without `APP_PRIVATE_KEY` configured; all layers `continue-on-error`) | docs↔code conformance across five axes (api-coverage, api-examples, cli, sdk, links) via `mnemom-test/docs/verify-full.sh`; SurfaceReport is the drift backlog |
| 10 | Aletheia grounding-corpus manifest | `npm run check:grounding-corpus` (NOT yet wired into a workflow — see note) | — (no CI trigger yet) | — (no schedule yet) | NOT YET WIRED (intended BLOCKING) | `scripts/aletheia-corpus-manifest.json` — unique `source_id`s, Mnemom-owned https URLs (owned-host allowlist; `github.com` excluded), non-empty titles, all three collections present, and the `docs` collection reconciled exactly against `docs.json` navigation |

## Posture definitions

- **BLOCKING** — exits 1 on failure; fails the PR check. Every PR to `main` must clear all blocking gates.
- **ADVISORY** — runs and reports but never fails the PR. Used while a backlog is burned down (Engine A) or when a prerequisite secret is not yet configured (staging live runner, Engine A App key).
- **ADVISORY (secret-gated)** — skips cleanly with a notice when the required secret is absent; treated as advisory until the secret is configured.

## Maintenance notes

- **SDK pin bump** (validator 7): when the docs move to a new SDK release, update `AAP_NPM_VERSION`, `AIP_NPM_VERSION`, `AAP_PIP_VERSION`, `AIP_PIP_VERSION` in `sdk-examples.yml` together and re-verify every affected page.
- **OpenAPI refresh** (validator 8): when the Monday freshness run fails, run `node scripts/sync-openapi.mjs && node scripts/generate-api-reference.mjs` and open a refresh PR. The workflow does not auto-commit.
- **Engine A activation** (validator 9): configure `vars.APP_ID` and `secrets.APP_PRIVATE_KEY` (mnemom-docs GitHub App) to move from skip to advisory. Promote to blocking after the drift backlog is cleared (see workflow header for the two-step flip).
- **Internal-reference gate** (validator 3): the `What it validates` column above lists the patterns the gate searches for — this is intentional meta-documentation, not a leak of the patterns themselves. The gate does not scan `.md` files today; if that changes, the descriptions in this column remain correct as meta-documentation.
- **Aletheia grounding-corpus wiring** (validator 10): the validator (`scripts/check-grounding-corpus.mjs`) and its manifest ship here, but the CI step is **not yet wired** into `mintlify-ci.yml`. `.github/workflows/**` is a NEVER-AUTO path — the workflow edit must land through a separate human-reviewed PR. **Follow-up:** in that PR, add a blocking step `- name: Validate Aletheia grounding corpus manifest` / `run: npm run check:grounding-corpus` after the `check:nav-coverage` step and before the advisory (`if: ${{ always() }}`) gates — no `npm ci` (Node built-ins only), no `continue-on-error` — then flip this row to BLOCKING / `mintlify-ci.yml` / Daily 06:00.

## On-demand probes (not scheduled)

These are run by a human on demand (or wired into an external caller later);
they are intentionally NOT scheduled CI workflows — a new/modified GitHub
Actions workflow is a NEVER-AUTO surface for this lane.

- **Origin-vs-edge attribution probe** — `scripts/probe-docs-origin-edge.mjs`
  (classification core: `scripts/lib/origin-edge-attribution.mjs`; tests:
  `scripts/probe-docs-origin-edge.test.mjs`). At alert time it tells an
  on-call responder whether a docs.mnemom.ai outage (e.g. a sustained HTTP
  403) is a Mintlify **origin** fault or a Cloudflare **edge/DNS** fault, and
  attaches the supporting response headers — encoding the manual triage that
  cost ≈5.5 min during incident `980582706`.
  - Run: `npm run probe:origin-edge -- --origin-url <origin-direct-url> [--verbose]`
    (or `node scripts/probe-docs-origin-edge.mjs --help`). The origin endpoint
    is passed via flag/env (public config, no secrets); no origin hostname is
    hard-coded.
  - Verdict vocabulary: `healthy`, `origin-fault`, `edge-fault`, `both-down`,
    `indeterminate`. Fails **closed** — on cold-start / no-data / missing
    markers it reports `indeterminate` and says "escalate manually", never a
    misleading `healthy`.
  - Exit-code contract (mirrors the `check-*.mjs` validators): `0` = `healthy`,
    `1` = any attributed-down / `indeterminate` verdict, `2` = bad CLI usage.
  - Unit test: `npm run test:probe` (`node:test`, no live network — drives the
    classifier with mocked observations, including the incident 403 case).

- **Committed-slice freshness check** — `scripts/check-slice-freshness.mjs`
  (normalization/diff core: `scripts/lib/openapi-slice.mjs`, shared with
  `scripts/sync-openapi.mjs`; tests: `scripts/check-slice-freshness.test.mjs`).
  Read-only: it revalidates the committed `api-reference/openapi.json` slice
  against the live customer slice INDEPENDENTLY of validator 8's narrow
  trigger, so a PR that edits `api-reference/endpoint/**` pages or `docs.json`
  (but not `openapi.json`) can still be caught building on a stale slice. It
  emits an explicit `committed-slice vs live: N paths added / M removed / K
  changed (ops +A / -R)` line plus a JSON payload. It NEVER writes a file and
  NEVER auto-commits (same human-review contract as validator 8). Because it
  shares one normalization lib with `sync-openapi.mjs`, its verdict can never
  disagree with the Monday `openapi-freshness.yml` gate.
  - Run: `npm run check:slice-freshness [-- --soft --verbose]`
    (or `node scripts/check-slice-freshness.mjs --help`). Live source is the
    same as `sync-openapi.mjs`: `MNEMOM_OPENAPI_URL` / `--url`
    (default `https://api.mnemom.ai/openapi.json`), or a local file via
    `--spec-path` / `OPENAPI_SPEC_PATH` for offline runs.
  - Exit-code contract — **default (strict/blocking):** `0` = fresh (byte-match,
    0/0/0); `1` = drift (≥1 added/removed/changed — re-sync + open a refresh
    PR); `2` = cannot verify (committed file missing/unparseable, live
    fetch/HTTP/JSON error, live leaked staff paths, or live had no paths).
    Fails **closed** — a "cannot verify" is never reported as fresh.
  - Exit-code contract — **`--soft` (advisory):** `0` = fresh OR drift (drift is
    downgraded to an advisory warning; the diff line is still printed); `2` =
    cannot verify (UNCHANGED from strict — soft never silently masks a broken
    live endpoint). `1` is never returned in `--soft` mode.
  - Unit test: `npm run test:slice-freshness` (`node:test`, no live network —
    drives the diff core with in-memory fixtures, including the path-added,
    path-removed, path-changed, schema-order-only, staff-leak, and empty-live
    edges).
  - Canonical ADR-054 intent: the **committed-snapshot** reading is canonical —
    `api-reference/openapi.json` is committed, re-synced, and diffed (drift is
    detected, not "impossible by construction"). The stale "live-only" phrasing
    in `scripts/_load-spec.mjs` and `AGENTS.md` was corrected to match.
  - **CI wiring — satisfied in-repo via validator 2 (issue #278 AC branch b):**
    the same diff line is emitted (advisory) by `scripts/check-doc-examples.mjs`
    (validator 2, `doc-examples.yml`), which already triggers **daily** and on
    every PR touching `**/*.mdx` — and `api-reference/endpoint/**` pages ARE
    `.mdx`, so **a PR editing only an endpoint page already triggers the slice
    freshness emission** (the issue's verification criterion) with no workflow
    change. That emission is advisory-only: it prints `committed-slice vs live:
    …` and NEVER changes validator 2's pass/fail. It shares the one
    normalization lib, so it can never disagree with the blocking check.

### Optional upgrade — blocking committed-slice trigger (operator's consolidated PR)

The AC is satisfied in-repo (validator 2 emission, above). This is an OPTIONAL
STRONGER upgrade: to make committed-slice drift **block** a PR that edits only
`api-reference/endpoint/**` or `docs.json` (rather than surface an advisory
line), add a dedicated trigger. That requires a `.github/workflows/**` edit,
which is a **NEVER-AUTO** surface for this lane — it lands separately, by the
operator, in a consolidated PR (precedent: the grounding-corpus and origin-edge
wiring recorded above). The exact hook, so it is not silently dropped
(MNE-443):

- File: `.github/workflows/openapi-freshness.yml` (or a new gate).
- Add these two globs to `on.pull_request.paths` (which today lists only
  `api-reference/openapi.json` and `scripts/sync-openapi.mjs`):

  ```yaml
  on:
    pull_request:
      paths:
        - "api-reference/openapi.json"
        - "scripts/sync-openapi.mjs"
        - "api-reference/endpoint/**"   # add
        - "docs.json"                    # add
  ```

- Invoke the check as a step. Two options, with their exit-code implications:
  - **Blocking:** `run: node scripts/check-slice-freshness.mjs` — exit `1` on
    drift fails the PR (same posture as validator 8's git-diff assert).
  - **Non-blocking signal:** `run: node scripts/check-slice-freshness.mjs --soft`
    with `continue-on-error: true` — drift is surfaced as an advisory diff line
    (exit `0`) but a genuine cannot-verify (exit `2`) still fails, so a broken
    live endpoint is never masked.

## Out-of-repo follow-ups (tracked, not silently dropped)

The origin-vs-edge work (issue #269) has two acceptance-criteria pieces that
cannot be closed by a change in this repo. They are recorded here — and filed
as a tracked issue — so they are not silently dropped. **Filed tracking issue:
[mnemom/docs#377](https://github.com/mnemom/docs/issues/377)** (the work lands
in mnemom-adw / ops-responder; the tracking issue is filed in this repo because
the ADW automation is scoped here).

- **Tighten monitor `4536046` confirmation window (AC #2):** the BetterStack
  monitor confirmation/retry window is a configuration living in **mnemom-adw**
  (`ops_service_map.yaml` `docs` entry) and the ops-responder provisioning
  scripts (`apps/ops-responder/scripts/setup-betterstack-*.py`) — no file in
  this repo can change it. Tracked in mnemom/docs#377.
- **Wire the probe payload into the live alert (part of AC #1):** injecting the
  probe's attribution payload into the fired BetterStack alert requires the
  ops-responder side to invoke the probe and attach its JSON. This repo
  provides the reusable probe + machine-readable payload; the *automatic*
  wiring is an ops-responder follow-up. Tracked in mnemom/docs#377.

## Verification (no unexpected files)

After any edit to this file, confirm the diff is scoped to `specs/docs-validators-health.md` only:

```sh
git diff --name-only HEAD
git status --short | grep -vE '^\?\? specs/docs-validators-health\.md' && echo "ERROR: unexpected untracked files" || echo "OK"
```
