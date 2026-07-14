# Spec — Patch: Add test for edge-fault CF-marker reason string

- **Status:** Draft
- **Branch:** feature-issue-269-adw-0d0961c2-add-origin-vs-edge-attribution-probe-tig
- **Location:** `scripts/probe-docs-origin-edge.test.mjs`
- **Related docs:** `specs/adw/issue-269-adw-0d0961c2-add-origin-vs-edge-probe-plan.md`

## Problem / Objective
**Original Spec:** `specs/adw/issue-269-adw-0d0961c2-add-origin-vs-edge-probe-plan.md`
**Issue:** In `scripts/lib/origin-edge-attribution.mjs` (line 220–222), the `edge-fault` branch contains a ternary on `hasCloudflareEdgeMarkers(edge?.headers)`. Both existing edge-fault tests pass `headers: {}`, so `hasCloudflareEdgeMarkers` always returns `false` and the `true` arm (`"the edge returned a failure"`) is never exercised. The scenario it covers — edge returns a non-2xx/3xx *with* Cloudflare markers while origin-direct is healthy — is reachable (e.g. a CF 503 overlay error when the origin is fine), and per rule 3a(b) every new conditional must have a direct test.
**Solution:** Add one test case to `scripts/probe-docs-origin-edge.test.mjs` that supplies `CF_MARKERS` on the edge observation while origin is healthy, and asserts `verdict === 'edge-fault'`, `confidence === 'high'`, and `reason` matches `/the edge returned a failure/i`.

## Approach & Changes
### Files to Modify
- `scripts/probe-docs-origin-edge.test.mjs` — add one test case after the existing edge-fault tests.

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the missing edge-fault + CF-markers test case
- Append a new `test(...)` block to `scripts/probe-docs-origin-edge.test.mjs` immediately after the existing `"edge fault: edge 502 with no Cloudflare markers…"` test (line 56–63).
- Fixture: `edge: { ok: false, status: 503, headers: CF_MARKERS }`, `origin: { ok: true, status: 200, headers: VERCEL_MARKERS }`.
- Assertions:
  - `result.verdict === 'edge-fault'`
  - `result.confidence === 'high'`
  - `result.reason` matches `/the edge returned a failure/i`
- `CF_MARKERS` and `VERCEL_MARKERS` are already defined at the top of the file — no new fixture constants needed.

### Step 2: Run the test suite to confirm zero regressions
- Execute `node --test scripts/probe-docs-origin-edge.test.mjs` from the repo root and confirm all tests pass (exit 0).

## Key Decisions & Rationale
**Lines of code to change:** ~9 (one test block)
**Risk level:** low — additive test only; no production code touched
**Testing required:** run `node --test scripts/probe-docs-origin-edge.test.mjs`

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `node --test scripts/probe-docs-origin-edge.test.mjs` — all tests pass, exit 0; the new test must appear and pass
- `npm run test:probe` — same via the npm script
- `npm run check:redirects && npm run check:links` — manifest `lint` verb; zero regressions

## Known Limitations / Follow-ups
None — this patch is solely the missing test for the `true` arm of the CF-marker ternary in the `edge-fault` branch. No production code is changed.
