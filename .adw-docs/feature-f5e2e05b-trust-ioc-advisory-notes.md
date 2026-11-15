# Trust IoC and Advisory Pages State Real Read-Only, Rate-Limit, and Signing Behaviour

**ADW ID:** f5e2e05b
**Date:** 2026-11-15
**Plan-Spec:** agents/f5e2e05b/plan/issue-620-adw-f5e2e05b-ioc-advisory-real-behaviour-plan.md

## Overview

The three public Trust-surface endpoint pages — the IoC feed, the advisory list, and the single-advisory fetch — now explicitly state that they are read-only today, cite the real gateway rate limit (100 requests/minute per IP), and (for the IoC feed only) state that the STIX bundle is not cryptographically signed yet. A new regression-gate script, `check-trust-claims.mjs`, guards these facts against silently drifting back to stale or unverified claims.

This closes the single ACCEPTANCE criterion on GitHub issue #620 (card G): *"docs.mnemom.ai IoC and advisory pages say the feed is read-only today, state the real rate limit, and drop 'signed' until WI R14 lands."* This was the third dispatch of the issue — two prior attempts were blocked by design review, first for asserting an unverified in-handler rate limit, then for omitting a rate-limit number entirely. This run uses a verified figure (100 req/min per IP, gateway-enforced, MNE-240) supplied by a human operator.

## What Was Built

- Hand-written `<Note>` bodies appended below the generated frontmatter on three `api-reference/endpoint/*.mdx` pages, stating the read-only and rate-limit facts (and, for the IoC feed, the not-yet-signed fact).
- A new regression-check script, `scripts/check-trust-claims.mjs`, that fails if any of the three pages drops the read-only language, drops the `100 requests/minute` figure, reintroduces a stale rate-limit number, or reintroduces an un-hedged "signed" claim on the IoC page.
- `node --test` unit coverage for the check script in `scripts/check-trust-claims.test.mjs`.
- Three new `npm run` scripts wiring the checker and its tests into the existing script conventions (not into CI — see Known Limitations).

## Technical Implementation

### Files Modified

- `api-reference/endpoint/get-trust-iocs.mdx`: added a `<Note>` stating read-only, the 100 req/min rate limit, and that the STIX bundle is not cryptographically signed today.
- `api-reference/endpoint/get-trust-advisories.mdx`: added a `<Note>` stating read-only and the 100 req/min rate limit.
- `api-reference/endpoint/get-trust-advisories-slug.mdx`: same `<Note>` body as the advisories list page.
- `scripts/check-trust-claims.mjs` (new): exported `checkTrustClaims()` / `checkPageText()` pure check functions, a `--self-test` mode with inline fixtures, and a CLI `main()` with exit codes `0`/`1`/`2`.
- `scripts/check-trust-claims.test.mjs` (new): `node --test` coverage exercising the exported check function against compliant and regressed fixtures.
- `package.json`: added `check:trust-claims`, `check:trust-claims:self-test`, and `test:trust-claims` scripts.

### Key Changes

- The endpoint pages were left as generator stubs (frontmatter + `openapi:` directive) with a hand-written body appended underneath — per `AGENTS.md`, `api-reference/` pages are regenerated from `api-reference/openapi.json` and must not be hand-edited at the frontmatter/stub level, but `scripts/lib/api-reference-drift.mjs`'s `STUB_RE` only matches frontmatter-only pages, so appending a body makes the page permanently skipped by future resyncs — a pattern already used by other endpoint pages (e.g. `post-agents-agent-id-resolve.mdx`).
- The "signed" disclaimer is scoped to the IoC feed only, since a STIX bundle is the only artifact here where a signature claim is meaningful; there is no comparable claim about advisories.
- `check-trust-claims.mjs` detects regressions, not incorrect-but-plausible new content — e.g. it flags an un-hedged `is signed` claim via regex while explicitly not tripping on the page's own `is not ... signed` phrasing.
- The script ships runnable (`npm run check:trust-claims`) but is intentionally **not** wired into any `.github/workflows/*.yml` file — `.github/workflows` is marked NEVER-AUTO in the issue's scope fences, so CI wiring is left as a human follow-up.

## How to Use

1. View any of the three Trust-surface endpoint pages (`/api-reference/endpoint/get-trust-iocs`, `get-trust-advisories`, `get-trust-advisories/{slug}`) — the rendered page now shows the auto-generated method/params/response block followed by a `<Note>` with the read-only, rate-limit, and (IoC page only) signing facts.
2. To check the pages haven't regressed, run `npm run check:trust-claims` (exits non-zero and prints the specific failing rule(s)/file(s) if a fact has drifted).
3. To validate the checker's own logic, run `npm run check:trust-claims:self-test`.
4. To run the unit test suite, run `npm run test:trust-claims`.

## Configuration

No new environment variables or configuration. The three target file paths and claim regexes are defined as constants (`TARGET_FILES`, `READ_ONLY_RE`, `RATE_LIMIT_RE`, `STALE_RATE_LIMIT_RE`, `SIGNED_CLAIM_RE`, `SIGNED_FEED_RE`) at the top of `scripts/check-trust-claims.mjs`.

## Testing

- `node scripts/check-trust-claims.mjs --self-test` — 12/12 assertions pass.
- `node scripts/check-trust-claims.mjs` — confirms all three live pages state the facts correctly.
- `node --test scripts/check-trust-claims.test.mjs` — 10/10 tests pass.
- Manifest verbs: `npm run check:redirects` (lint), no-op typecheck, `npm ci && npm run check:doc-examples` (test), no-op build (Mintlify-hosted, validated by CI).

## Notes

- `scripts/check-trust-claims.mjs` is not wired into any CI workflow — a human should add an `npm run check:trust-claims` step to `docs-validators.yml` (or similar) in a separate, explicitly-scoped PR.
- If mnemom-api's rate limit or signing status changes again, the literal `100 requests/minute` string and the "not ... signed" phrasing will need a manual update; the checker only guards against regression to a previously-disproven claim, not a future legitimate change.
- The concept/guide pages flagged in the issue's broader "Problem" narrative (`concepts/aegis.mdx`, `concepts/managed-rules.mdx`, `specifications/managed-rule-envelope-schema.mdx`, `guides/owasp-agentic-top-10.mdx`, `guides/safe-house-threat-model.mdx`) and `get-network-threat-state.mdx` are out of scope for this issue's single numbered acceptance criterion and remain untouched.
