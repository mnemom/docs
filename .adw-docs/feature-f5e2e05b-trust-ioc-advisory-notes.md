# Trust IoC and Advisory Pages State Real Read-Only, Rate-Limit, and Signing Behaviour

**ADW ID:** f5e2e05b
**Date:** 2026-11-15

## Overview

The three public Trust-surface endpoint pages — the IoC feed, the advisory list, and the single-advisory fetch — now explicitly state that they are read-only today, cite the real gateway rate limit (100 requests/minute per IP), and (for the IoC feed only) state that the STIX bundle is not cryptographically signed yet.

This closes the single ACCEPTANCE criterion on GitHub issue #620 (card G): *"docs.mnemom.ai IoC and advisory pages say the feed is read-only today, state the real rate limit, and drop 'signed' until WI R14 lands."* This was the third dispatch of the issue — two prior attempts were blocked by design review, first for asserting an unverified in-handler rate limit, then for omitting a rate-limit number entirely. This run uses a verified figure (100 req/min per IP, gateway-enforced, MNE-240) supplied by a human operator.

## What Was Built

- Hand-written `<Note>` bodies appended below the generated frontmatter on three `api-reference/endpoint/*.mdx` pages, stating the read-only and rate-limit facts (and, for the IoC feed, the not-yet-signed fact).

## Technical Implementation

### Files Modified

- `api-reference/endpoint/get-trust-iocs.mdx`: added a `<Note>` stating read-only, the 100 req/min rate limit, and that the STIX bundle is not cryptographically signed today.
- `api-reference/endpoint/get-trust-advisories.mdx`: added a `<Note>` stating read-only and the 100 req/min rate limit.
- `api-reference/endpoint/get-trust-advisories-slug.mdx`: same `<Note>` body as the advisories list page.

### Key Changes

- The endpoint pages were left as generator stubs (frontmatter + `openapi:` directive) with a hand-written body appended underneath — per `AGENTS.md`, `api-reference/` pages are regenerated from `api-reference/openapi.json` and must not be hand-edited at the frontmatter/stub level, but `scripts/lib/api-reference-drift.mjs`'s `STUB_RE` only matches frontmatter-only pages, so appending a body makes the page permanently skipped by future resyncs — a pattern already used by other endpoint pages (e.g. `post-agents-agent-id-resolve.mdx`).
- The "signed" disclaimer is scoped to the IoC feed only, since a STIX bundle is the only artifact here where a signature claim is meaningful; there is no comparable claim about advisories.

## How to Use

1. View any of the three Trust-surface endpoint pages (`/api-reference/endpoint/get-trust-iocs`, `get-trust-advisories`, `get-trust-advisories/{slug}`) — the rendered page now shows the auto-generated method/params/response block followed by a `<Note>` with the read-only, rate-limit, and (IoC page only) signing facts.

## Configuration

No new environment variables or configuration.

## Testing

- Manifest verbs: `npm run check:redirects` (lint), no-op typecheck, `npm ci && npm run check:doc-examples` (test), no-op build (Mintlify-hosted, validated by CI).

## Notes

- The concept/guide pages flagged in the issue's broader "Problem" narrative (`concepts/aegis.mdx`, `concepts/managed-rules.mdx`, `specifications/managed-rule-envelope-schema.mdx`, `guides/owasp-agentic-top-10.mdx`, `guides/safe-house-threat-model.mdx`) and `get-network-threat-state.mdx` are out of scope for this issue's single numbered acceptance criterion and remain untouched.
