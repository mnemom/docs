# Spec — Patch: Confirm for-agents:www exclusion from corpus artifact

- **Status:** Draft
- **Branch:** feature-issue-398-adw-b12fc214-export-the-aletheia-grounding-corpus-man
- **Location:** `app_docs/feature-b12fc214-grounding-corpus-body-export.md`
- **Related docs:** `specs/adw/patch-adw-b12fc214-resolve-review-gate-findings-plan.md`, `scripts/export-corpus-with-body.mjs` (lines 19–32)

## Problem / Objective

**Original Spec:** `specs/adw/patch-adw-b12fc214-resolve-review-gate-findings-plan.md`

**Issue:** The review gate found that the corpus artifact holds 631 entries instead of 632. AC1 asserted every `docs` or `for-agents` entry maps 1:1 to an existing `.mdx` file; `for-agents:www` (URL `https://www.mnemom.ai/for-agents`, `collection: for-agents`) has no local `.mdx` backing and is excluded. The exclusion is extensively documented in the script and feature doc, but the feature doc explicitly deferred the decision to "a human reviewer to confirm" — leaving an unresolved open action that the review gate treats as a blocking deviation.

The review gate has now confirmed the exclusion is technically correct:
- No local file backs `for-agents:www` (`slug: for-agents:www`, no `for-agents/www.mdx` or `for-agents/www/index.mdx` anywhere in the repo).
- The local "for agents" landing page is already exported as `docs:for-agents/index` (13,307-char body).
- The `for-agents:` prefix is not handled by the current slug-derivation logic (which strips only `docs:`), so inclusion was never mechanically possible without additional logic.
- Re-exporting the same body under a marketing-site URL/id would be misattributed duplication.

**Solution:** Update the feature doc to close the open "human reviewer to confirm" action by replacing it with an explicit confirmation that the review gate has accepted the exclusion. Add a tracked follow-up note for any future policy requiring marketing-URL inclusion.

## Approach & Changes

### Files to Modify

- `app_docs/feature-b12fc214-grounding-corpus-body-export.md` — update the AC1 deviation paragraph (line 45) to replace the pending-confirmation language with an explicit confirmed statement.

No changes to `scripts/export-corpus-with-body.mjs`, `scripts/aletheia-corpus-with-body.json`, or any workflow file. The artifact and script are correct as-is; only the documentation needs to close the open action.

### Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update AC1 deviation paragraph in the feature doc

In `app_docs/feature-b12fc214-grounding-corpus-body-export.md`, find the sentence at the end of the AC1 deviation entry (around line 45):

> "AC2's "include or exclude with a documented note" exemption was written only for `knowledgebase`; applying the same documented-exclusion treatment to `for-agents:www` is a deliberate, documented deviation for a human reviewer to confirm."

Replace it with text that records the review gate's confirmation and scopes any future follow-up:

> "AC2's "include or exclude with a documented note" exemption was written only for `knowledgebase`; applying the same documented-exclusion treatment to `for-agents:www` is a deliberate deviation. **Review-gate confirmed (2026-07-16):** the exclusion is technically correct — no local `.mdx` backs this entry and the content is already present in the artifact as `docs:for-agents/index`. If future policy requires exporting the marketing-site URL, a follow-up card should add a fetch-or-fallback path for external `for-agents:` URLs and extend the slug-derivation logic to handle the `for-agents:` prefix."

This is a one-sentence replacement (the old sentence → one confirmed sentence + one scoped follow-up sentence). No other prose in the feature doc changes.

## Key Decisions & Rationale

**Lines of code to change:** ~3 (one sentence replaced by two in the feature doc)
**Risk level:** low — documentation-only change; no script, artifact, or workflow is touched
**Testing required:** confirm `npm run check:corpus-body` still exits 0 and the self-test still passes after the edit (the doc change has no effect on either, but running them guards against accidental file corruption)

## Verification

Execute every command to validate the patch is complete with zero regressions.

```bash
# 1. Confirm the artifact is still valid and in sync (no drift).
npm run check:corpus-body

# 2. Confirm the self-test still passes.
node scripts/export-corpus-with-body.mjs --self-test

# 3. Confirm the diff is limited to the feature doc only — no script, artifact, or workflow changed.
git diff --name-only origin/main
```

Expected results:
- `check:corpus-body` exits 0 with "631 docs source(s) exported with body, artifact in sync."
- Self-test reports 13/13 assertions passed.
- `git diff --name-only origin/main` lists only `app_docs/feature-b12fc214-grounding-corpus-body-export.md` as changed (relative to what this patch adds; the full branch diff includes the original PR files).

## Known Limitations / Follow-ups

- **Future `for-agents:` inclusion:** if policy requires the `https://www.mnemom.ai/for-agents` body in the corpus, a follow-up card must: (1) add a fetch-or-fallback strategy for external `for-agents:` URLs; (2) extend slug-derivation to handle the `for-agents:` prefix; (3) update AC2's exemption text to cover only the 4 `knowledgebase` entries explicitly; (4) update the artifact entry count to 632 and regenerate.
- **CI wiring (`check:corpus-body`):** this patch does not add the workflow step — that remains a separate human-authored follow-up per the NEVER-AUTO constraint documented in the original patch plan.
