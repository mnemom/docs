# Self-Hosted Quickstart Documentation Fix

**ADW ID:** e02adf2e
**Date:** 2026-06-10
**Plan-Spec:** agents/e02adf2e/plan/issue-226-adw-e02adf2e-fix-self-hosted-quickstart-docs-plan.md

## Overview

The self-hosted quickstart guide described environment variables, Docker services, and health-check responses that did not match the actual deploy artifacts, leading users to misconfigure their gateway (issue #226). This change corrects the quickstart across all three locales (English, Spanish, French) and adds a new **Data residency** section that documents exactly which traffic crosses network boundaries.

## What Was Built

- Corrected required environment variable set for the self-hosted gateway (`SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `INTERNAL_API_KEY`, `REDIS_PASSWORD`, plus a corrected `SUPABASE_URL` format)
- Updated the Docker Compose service description from five services to four (migrations now run on gateway startup instead of a separate `migrate` service)
- Fixed the `/health` endpoint expected response to match actual output (`status: "ok"` with `{ "ok": true }` check shape)
- Added a new **Data residency** section with a traffic-boundary table (LLM provider calls, heartbeat, agent creation) and in-region mitigation guidance
- Added the `HEARTBEAT_URL` override to the configuration reference for EU/air-gapped deployments
- Added a note about the stale `SMOLTBOT_ROLE` → `MNEMOM_ROLE` rename in `.env.example`
- Mirrored all corrections into the Spanish (`es/`) and French (`fr/`) translations
- Added a Playwright-based screenshot verification harness used to confirm the rendered docs

## Technical Implementation

### Files Modified

- `quickstart/self-hosted.mdx`: English quickstart — corrected env vars, service list, health response, added Data residency section and `HEARTBEAT_URL` reference
- `es/quickstart/self-hosted.mdx`: Spanish translation updated to match the English corrections
- `fr/quickstart/self-hosted.mdx`: French translation updated to match the English corrections
- `package.json`: Added `playwright` as a dev dependency for screenshot verification
- `agents/e02adf2e/screenshot.cjs` / `agents/e02adf2e/screenshot.js`: Playwright scripts that load the rendered quickstart and capture verification screenshots (top of page, env vars, health response, data residency)

### Key Changes

- **Required environment variables** now reflect the real entrypoint: `SUPABASE_SECRET_KEY` (was `SUPABASE_KEY`), plus newly-required `SUPABASE_JWT_SECRET` (observer hard-fails without it), `INTERNAL_API_KEY` (service-to-service agent creation), and `REDIS_PASSWORD`. `SUPABASE_URL` corrected to the `https://<ref>.supabase.co` form.
- **Docker stack** corrected to four services; the standalone `migrate` service was removed and migrations are documented as running during gateway startup. The Kubernetes secret example (`kubectl create secret`) was updated with the same variables.
- **Health-check contract** corrected: top-level `status` is `"ok"` (not `"ready"`) and each check uses `{ "ok": true }` rather than `{ "status": "ok" }` / `"valid"`.
- **Data residency** section added clarifying that prompt/response content and traces never leave the user's infrastructure, with a table of the three boundary-crossing traffic types and how to keep each in-region.
- **Localization parity** — identical structural and value corrections applied to the `es` and `fr` quickstarts.

## How to Use

1. Open the self-hosted quickstart at `/quickstart/self-hosted` (or the `/es` and `/fr` localized routes).
2. Follow the corrected environment-variable list when populating `.env`, including the newly-required `SUPABASE_JWT_SECRET`, `INTERNAL_API_KEY`, and `REDIS_PASSWORD`.
3. Run `docker compose up -d` and expect four services (PostgreSQL, Redis, Gateway, Observer).
4. Verify health and match against the corrected expected response (`"status": "ok"`).
5. Consult the **Data residency** section to understand which traffic leaves your network and how to constrain it (e.g. setting `HEARTBEAT_URL`).

## Configuration

- `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `REDIS_PASSWORD`, `INTERNAL_API_KEY`, `MNEMOM_LICENSE_JWT`, `ANTHROPIC_API_KEY` — required.
- `HEARTBEAT_URL` (default `https://api.mnemom.ai/v1/deployments/heartbeat`) — optional override to point the phone-home heartbeat at an internal relay for EU or air-gapped deployments.
- `MNEMOM_ROLE` — `gateway`, `scheduler`, or `all` (note: a stale `SMOLTBOT_ROLE` key in `.env.example` should be renamed to `MNEMOM_ROLE`).

## Testing

- Documentation checks: `npm run check:doc-examples` and `npm run check:redirects`.
- Visual verification: the Playwright harness in `agents/e02adf2e/screenshot.cjs` renders the running docs (`http://localhost:4115/quickstart/self-hosted`) and captures screenshots of the top of the page, environment-variables section, health response, and data-residency section. Requires `playwright` (added as a dev dependency).

## Notes

- This change is documentation-only for the public-facing guides; no gateway runtime code is modified. The corrections were derived from the actual deploy artifacts to align the docs with real behavior.
- All three locales (en/es/fr) are kept in parity; future edits to the self-hosted quickstart should update all three.
- The Playwright screenshot scripts live under `agents/e02adf2e/` and are verification tooling rather than shipped product code.
