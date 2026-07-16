# Spec — Patch: Resolve three review-gate findings (b12fc214)

- **Status:** Draft
- **Branch:** feature-issue-398-adw-b12fc214-export-the-aletheia-grounding-corpus-man
- **Location:** `.github/workflows/mintlify-ci.yml` (human-only, NEVER-AUTO), `app_docs/feature-b12fc214-grounding-corpus-body-export.md` (no change needed — already documents deviations)
- **Related docs:** `app_docs/feature-b12fc214-grounding-corpus-body-export.md`, `specs/adw/issue-398-adw-b12fc214-export-corpus-with-body-plan.md` (if present)

## Problem / Objective

**Original Spec:** `app_docs/feature-b12fc214-grounding-corpus-body-export.md`

**Issue:** The review gate raised three findings against PR #398 (ADW b12fc214). None of the three requires a change to the merged artifact (scripts, JSON output, or package.json); all require either acknowledgment, human confirmation, or a human-authored workflow edit:

1. **Finding 1** — Worker wrote to `.github/workflows/mintlify-ci.yml` during the pipeline (commit `6577da8`), then reverted the write (commit `d97f60e`). The final three-dot diff is clean. ADW path-guard tightening is recommended upstream; no change to this PR.
2. **Finding 2** — `for-agents:www` excluded from the 631-entry artifact without an explicit AC2 exemption for the `for-agents` collection. The exclusion is well-reasoned and documented in the feature doc; human reviewer confirmation is required.
3. **Finding 3** — `npm run check:corpus-body` is not wired into `.github/workflows/mintlify-ci.yml`. Path is NEVER-AUTO. A human must add the step manually.

**Solution:** Acknowledge findings 1 and 2 with no code change (already handled in feature doc); document the exact YAML a human must add to satisfy finding 3.

## Approach & Changes

### Files to Modify

- `.github/workflows/mintlify-ci.yml` — **human-authored addition only** (NEVER-AUTO; autonomous worker must not touch); add one `- name: Validate grounding corpus body export` step after `check:nav-coverage`.

No other files require modification. The merged artifact is correct; the feature doc already captures all three deviations.

### Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Acknowledge Finding 1 — ADW behavioral audit (no code change)

- The final diff (`origin/main...HEAD`) contains zero changes to `.github/workflows/mintlify-ci.yml` — the NEVER-AUTO invariant is satisfied in the merged output.
- The write+revert pattern (commits `6577da8` → `d97f60e`) is a pipeline-level behavioral defect, not a PR artifact defect.
- **No change to this PR.** For the ADW pipeline operator: tighten the commit-time `path_guard` to abort before writing to `.github/workflows/`, so a correction does not itself require a NEVER-AUTO edit.

### Step 2: Confirm Finding 2 — `for-agents:www` exclusion is acceptable (no code change)

- The feature doc (`app_docs/feature-b12fc214-grounding-corpus-body-export.md`, lines 44–45) and the exporter (`scripts/export-corpus-with-body.mjs`, comment at lines 19–32) both explicitly document why `for-agents:www` is excluded:
  - Its URL is `https://www.mnemom.ai/for-agents` (marketing site, not `docs.mnemom.ai`).
  - No local `.mdx` file backs it.
  - The local for-agents landing page is already exported as the distinct `docs:for-agents/index` entry.
  - Re-exporting the same body under a marketing-site URL/id would be misattributed duplication.
- AC2's documented-exclusion exemption was written for the 4 `knowledgebase` entries; applying it to `for-agents:www` is a deliberate deviation flagged for human sign-off.
- **Human reviewer action:** confirm this exclusion is acceptable. If not, a follow-up should add the `for-agents` collection to the exporter's filter with a fetch-or-fallback for the marketing URL and update the AC2 exemption text.
- **No code change in this patch** — the documentation is complete; the decision is the human reviewer's.

### Step 3: Resolve Finding 3 — wire `check:corpus-body` into CI (human-authored edit)

- This is the only actionable code change in the three findings. It is blocked by NEVER-AUTO on the autonomous worker; a human must make it.
- **Human action:** open `.github/workflows/mintlify-ci.yml` and insert the following block after the `Validate navigation coverage` step (line 57 as of this patch, before the `# --- Advisory reporting gates ---` comment):

  ```yaml
        # Verifies the committed corpus-body artifact is present, has no empty
        # bodies, and is byte-for-byte in sync with what the manifest + pages
        # would produce now. Fail-closed (exit 1 on drift). Node built-ins only.
        - name: Validate grounding corpus body export
          run: npm run check:corpus-body
  ```

- No other workflow changes are needed. The `check:corpus-body` npm script is already present in `package.json` (line 32) and requires only Node built-ins — no `npm ci` or additional setup step is needed.

## Key Decisions & Rationale

**Lines of code to change:** 4 (one YAML step block; human-authored only)
**Risk level:** low — the `check:corpus-body` step is additive; it does not alter any existing step and uses only Node built-ins already available in the runner.
**Testing required:** confirm `npm run check:corpus-body` exits 0 locally (no drift) before the human pushes the workflow edit.

## Verification

Execute every command to validate the patch is complete with zero regressions.

```bash
# 1. Confirm the artifact is valid and in sync (no drift since last export).
npm run check:corpus-body

# 2. Run the exporter self-test.
node scripts/export-corpus-with-body.mjs --self-test

# 3. Confirm workflow file is unchanged from origin/main after all three
#    findings are acknowledged (before the human adds the CI step).
git diff origin/main -- .github/workflows/mintlify-ci.yml

# 4. After the human adds the CI step: confirm the workflow parses as valid YAML.
#    (Use any YAML linter available, e.g. `npx js-yaml .github/workflows/mintlify-ci.yml`)
```

Expected results:
- `check:corpus-body` exits 0.
- Self-test exits 0.
- Workflow diff is empty until the human intentionally adds the new step.

## Known Limitations / Follow-ups

- **Finding 1 (ADW path guard):** The `path_guard.CommitDebrisError` fires by artifact name/size; it cannot detect a write-then-revert to a NEVER-AUTO path. The pipeline operator should add a pre-write abort check for `.github/workflows/` to prevent the corrective revert itself from touching the protected path.
- **Finding 2 (for-agents:www):** If the human reviewer determines the exclusion is NOT acceptable, a follow-up card should extend the exporter to fetch the marketing-URL body with a fallback strategy, add it as a `for-agents` collection entry, and grant explicit AC2 exemption.
- **Finding 3 (CI wiring):** Until the human adds the YAML step, the only drift gate is the manual `npm run check:corpus-body` command. The artifact can silently drift without automated detection.
