# Docs Validators — Health Dashboard

Single reference for every automated gate that runs against this docs repo.
Last verified: 2026-06-29.

## Validators

| # | Validator | Workflow | PR trigger | Schedule (UTC) | Posture | What it validates |
|---|-----------|----------|------------|----------------|---------|-------------------|
| 1 | Mintlify CI | `mintlify-ci.yml` | All PRs (no path filter) | Daily 06:00 (`0 6 * * *`) | BLOCKING | `mint validate` build + broken internal links + redirect-table integrity (`docs.json` `redirects`) |
| 2 | Doc Examples vs OpenAPI | `doc-examples.yml` | PRs touching `**/*.mdx`, `**/*.md`, scripts, `package.json` | Daily 06:45 (`45 6 * * *`) | BLOCKING | Every `curl https://api.mnemom.ai/v1/…` invocation in MDX must resolve to a real `{path, method}` in the live OpenAPI spec |
| 3 | Internal-reference gate | `internal-reference-gate.yml` | All PRs (no path filter) | — (PR + push only) | BLOCKING | Scans `*.mdx` and `api-reference/openapi.json` prose for: private-repo links (`github.com/mnemom/scale`, `safe-house-hardening`, `safe-house-aegis`, `deploy`); retired codenames XFD/CBD/CFD; internal codename polis; internal agent names solon/themis/cassandra/blackbeard/wintermute; 1Password paths (`op://`); internal tooling paths (`emps.`, `packages/core`); internal tracker refs UC-N, `mnemom-platform#N`, AEGIS-N; ADR refs (ADR-NNN, MDX only) |
| 4 | Spec Examples Validation | `spec-examples.yml` | PRs touching `specifications/**/*.mdx`, scripts, `package.json` | Daily 07:00 (`0 7 * * *`) | BLOCKING | YAML/JSON fenced blocks in `specifications/*.mdx` annotated `# t5-3:full-example` validate against the live OpenAPI schema via Ajv 2020 |
| 5 | Doc Examples Live (staging) | `doc-examples-live.yml` | No PR trigger | Daily 07:00 (`0 7 * * *`) | ADVISORY (requires `MNEMOM_STAGING_TOKEN` secret; skips without it) | Executes safe curl examples from MDX against the staging environment and asserts response status is documented or 2xx |
| 6 | SDK Quickstart Trace Verification | `sdk-quickstart-trace.yml` | PRs touching `quickstart/sdk-direct.mdx`, `es/`+`fr/` locale equivalents, script, workflow file | Daily 07:15 (`15 7 * * *`) | BLOCKING | AlignmentCard + APTrace pairs in the SDK-direct quickstart (en/es/fr): asserts `action.name` is in `bounded_actions` |
| 7 | SDK Examples vs Published Packages | `sdk-examples.yml` | PRs touching drift-detection pages, `quickstart/sdk-direct.mdx` (en/es/fr), workflow file | Daily 07:30 (`30 7 * * *`) | BLOCKING | TypeScript snippets compile against pinned npm packages (`@mnemom/agent-alignment-protocol@1.3.0`, `@mnemom/agent-integrity-protocol@1.2.0`); Python snippets bind against matching pip packages (`agent-alignment-protocol==1.3.0`, `agent-integrity-proto==1.2.0`) |
| 8 | OpenAPI Freshness | `openapi-freshness.yml` | PRs touching `api-reference/openapi.json` or `scripts/sync-openapi.mjs` | Mondays 13:00 (`0 13 * * 1`) | BLOCKING on drift (does not auto-commit — requires human review + refresh PR) | Committed `api-reference/openapi.json` matches the deployed customer slice at `https://api.mnemom.ai/openapi.json` |
| 9 | Verify Docs Gate (Engine A) | `verify-docs-gate.yml` | All PRs, push to main | — (no schedule) | ADVISORY (skips without `APP_PRIVATE_KEY` configured; all layers `continue-on-error`) | docs↔code conformance across five axes (api-coverage, api-examples, cli, sdk, links) via `mnemom-test/docs/verify-full.sh`; SurfaceReport is the drift backlog |
| 10 | Aletheia grounding-corpus manifest | `mintlify-ci.yml` | All PRs (no path filter) | Daily 06:00 (`0 6 * * *`) | BLOCKING | `scripts/aletheia-corpus-manifest.json` — unique `source_id`s, Mnemom-owned https URLs (owned-host allowlist; `github.com` excluded), non-empty titles, all three collections present, and the `docs` collection reconciled exactly against `docs.json` navigation |

## Posture definitions

- **BLOCKING** — exits 1 on failure; fails the PR check. Every PR to `main` must clear all blocking gates.
- **ADVISORY** — runs and reports but never fails the PR. Used while a backlog is burned down (Engine A) or when a prerequisite secret is not yet configured (staging live runner, Engine A App key).
- **ADVISORY (secret-gated)** — skips cleanly with a notice when the required secret is absent; treated as advisory until the secret is configured.

## Maintenance notes

- **SDK pin bump** (validator 7): when the docs move to a new SDK release, update `AAP_NPM_VERSION`, `AIP_NPM_VERSION`, `AAP_PIP_VERSION`, `AIP_PIP_VERSION` in `sdk-examples.yml` together and re-verify every affected page.
- **OpenAPI refresh** (validator 8): when the Monday freshness run fails, run `node scripts/sync-openapi.mjs && node scripts/generate-api-reference.mjs` and open a refresh PR. The workflow does not auto-commit.
- **Engine A activation** (validator 9): configure `vars.APP_ID` and `secrets.APP_PRIVATE_KEY` (mnemom-docs GitHub App) to move from skip to advisory. Promote to blocking after the drift backlog is cleared (see workflow header for the two-step flip).
- **Internal-reference gate** (validator 3): the `What it validates` column above lists the patterns the gate searches for — this is intentional meta-documentation, not a leak of the patterns themselves. The gate does not scan `.md` files today; if that changes, the descriptions in this column remain correct as meta-documentation.

## Verification (no unexpected files)

After any edit to this file, confirm the diff is scoped to `specs/docs-validators-health.md` only:

```sh
git diff --name-only HEAD
git status --short | grep -vE '^\?\? specs/docs-validators-health\.md' && echo "ERROR: unexpected untracked files" || echo "OK"
```
