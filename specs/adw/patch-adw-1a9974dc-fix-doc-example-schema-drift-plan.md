# Spec — Patch: Fix doc-example schema drift in guide files

- **Status:** Draft
- **Branch:** feature-issue-295-adw-1a9974dc-add-a-quickstart-coverage-matrix-asserti
- **Location:** guides/upgrading-to-0-5.mdx, guides/policy-management.mdx, guides/team-management.mdx, guides/trust-recovery.mdx
- **Related docs:** specs/adw/issue-295-adw-1a9974dc-quickstart-coverage-matrix-plan.md

## Problem / Objective

**Original Spec:** specs/adw/issue-295-adw-1a9974dc-quickstart-coverage-matrix-plan.md
**Issue:** The CI check "Validate Mintlify Docs" fails on this branch (non-reproducible locally — all five blocking steps pass including `mint@4.2.696`, the exact CI version). Separately, `npm run check:doc-examples` (the manifest `test` verb) fails with 9 NEW schema-drift findings: the branch modified curl examples in four guide files, changing spec-compliant payloads to invalid ones (wrong enum value, array-of-strings where spec expects array-of-objects, missing required field). Committing the fixes below resolves the `check:doc-examples` regression (MNE-441) and triggers a fresh "Validate Mintlify Docs" CI run, which is expected to pass (all local blocking checks pass).
**Solution:** Revert the five incorrect curl-example payload changes to restore spec-compliant values, keeping the prose ("per-turn" → "real time") changes intact.

## Approach & Changes

### Files to Modify

- `guides/upgrading-to-0-5.mdx` — revert `trust_level`/free-text `reason` back to `weight`/enum `reason`
- `guides/policy-management.mdx` — revert `tools` strings to objects; restore `forecast_id` field
- `guides/team-management.mdx` — revert `values.declared` objects back to strings
- `guides/trust-recovery.mdx` — revert `tools` strings back to objects

### Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix `guides/upgrading-to-0-5.mdx` — restore valid `reason` enum and `weight`

The branch changed:
```json
  "weight": 0.9,
  "reason": "manual"
```
to:
```json
  "trust_level": "high",
  "reason": "Verified partner agent for data pipeline"
```

The OpenAPI spec enum for `/reason` is `["team_membership","manual","org_co_membership"]`. `"Verified partner agent for data pipeline"` is not a valid value. Revert to the original spec-compliant payload at line ~254:
- Restore `"weight": 0.9`
- Restore `"reason": "manual"`
- Remove the `"trust_level": "high"` line

### Step 2: Fix `guides/policy-management.mdx` — restore `tools` array-of-objects (line ~290)

The branch changed `"tools": [{ "name": "mcp__browser__navigate" }, { "name": "mcp__filesystem__delete" }]` to `"tools": ["mcp__browser__navigate", "mcp__filesystem__delete"]`. The spec requires `tools` items to be objects. Revert to the original array-of-objects form.

### Step 3: Fix `guides/policy-management.mdx` — restore `forecast_id` to `POST /teams/recommend-policy` body (line ~413)

The branch replaced:
```json
  "forecast_id": "rf-8f21c0a49d3b",
  "constraints": { "enforcement_mode": "warn" }
```
with:
```json
  "team_id": "team-support-ops",
  "analysis_window_days": 30
```

The spec marks `forecast_id` as required. Restore the original body with `forecast_id` and `constraints`. The surrounding prose change (removing the mention of "risk forecast" → general description) may be kept if it is accurate, but the example payload must be spec-compliant.

### Step 4: Fix `guides/team-management.mdx` — restore `values.declared` to array of strings (line ~151)

The branch changed `"declared": ["reliability", "transparency", "user_safety"]` to `"declared": [{ "name": "reliability" }, ...]`. The spec expects `declared` items to be strings, not objects. Revert to the original array-of-strings form.

### Step 5: Fix `guides/trust-recovery.mdx` — restore `tools` array-of-objects (line ~74)

Same as Step 2: revert `"tools": ["mcp__browser__navigate", "mcp__filesystem__read_file"]` back to `"tools": [{ "name": "mcp__browser__navigate" }, { "name": "mcp__filesystem__read_file" }]`.

## Key Decisions & Rationale

**Lines of code to change:** ~15 (5 curl payload snippets across 4 files)
**Risk level:** low — reverting previously-correct values; no logic changes; prose changes untouched
**Testing required:** `npm run check:doc-examples` must exit 0 (zero schema-drift findings in the changed files)

## Verification

Execute every command to validate the patch is complete with zero regressions.

```bash
# Manifest lint verb
npm run check:redirects && npm run check:links

# Manifest test verb (the primary failing check)
npm ci && npm run check:doc-examples

# Mintlify broken-links (the blocking CI step)
npx mintlify broken-links

# Nav checks (other blocking CI steps)
node scripts/check-nav-pages.mjs
node scripts/check-nav-coverage.mjs

# Quickstart matrix (regression guard)
node scripts/check-quickstart-matrix.mjs
```

All of the above must exit 0. After pushing, confirm the "Validate Mintlify Docs" CI check passes on the new run.

## Known Limitations / Follow-ups

- The "Validate Mintlify Docs" CI failure was not reproducible locally (all five blocking steps pass including `mint@4.2.696`). The failure is expected to resolve once the fixes trigger a fresh CI run. If the CI still fails after this commit, the investigation should focus on the actual CI step output (the structured `outputs: {}` means no set-output commands ran — CI console logs are needed to identify the specific failing step).
- The prose changes in these four guide files (e.g., `POST /teams/recommend-policy` description) may or may not be accurate with respect to the current API. Only the payload shapes are corrected here; prose accuracy is out of scope for this patch.
