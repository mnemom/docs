# Spec — Patch: Prune 31 phantom entries from locale-link allowlist

- **Status:** Draft
- **Branch:** feature-issue-289-adw-bc4f2e9d-stop-fr-es-quickstart-pages-from-linking
- **Location:** `scripts/locale-link-allowlist.json`
- **Related docs:** N/A

## Problem / Objective
**Original Spec:** N/A
**Issue:** `scripts/locale-link-allowlist.json` contains 36 entries but only 5 correspond to cross-locale links that actually exist in the current fr/es pages (`/api-reference/headers`, `/api-reference/overview`, `/concepts/safe-house`, `/gateway/enforcement`, `/gateway/safe-house-overview`). The other 31 entries reference targets removed by predecessor PR #290. Because the locale-leak check only fires when a link is NOT in `allowSet`, these 31 phantom entries act as silent pre-approved exemptions — any future re-addition of those links would pass the gate undetected, defeating the gate's purpose. The allowlist is meant to shrink over time, but phantom entries can never naturally shrink since the auto-shrink only fires when a same-locale translation appears, not when the referencing link is absent.
**Solution:** Replace the allowlist with exactly the 5 entries that correspond to links actually present in the fr/es pages today. Future editors who re-add a removed target will be forced to explicitly allowlist it with a reason.

## Approach & Changes
### Files to Modify
- `scripts/locale-link-allowlist.json` — replace all 36 entries with the 5 active ones

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm the 5 active cross-locale link targets
Verified by grepping all fr/ and es/ MDX files for internal links (`[text](/path)` and `href="/path"` patterns) that do not start with `/fr/` or `/es/`:
- `/api-reference/headers` — referenced in fr/es quickstart pages
- `/api-reference/overview` — referenced in fr/es quickstart pages
- `/concepts/safe-house` — referenced in fr/es quickstart pages
- `/gateway/enforcement` — referenced in fr/es quickstart pages
- `/gateway/safe-house-overview` — referenced in fr/es quickstart pages

### Step 2: Replace `scripts/locale-link-allowlist.json` with only the 5 active entries
Write the pruned JSON retaining the original entry format (`locales`, `target`, `reason`) for the 5 confirmed entries. Remove all other 31 entries.

The replacement content:
```json
[
  {
    "locales": ["fr", "es"],
    "target": "/api-reference/headers",
    "reason": "API reference not translated; EN fallback accepted until api-reference/ is localized."
  },
  {
    "locales": ["fr", "es"],
    "target": "/api-reference/overview",
    "reason": "API reference not translated; EN fallback accepted until api-reference/ is localized."
  },
  {
    "locales": ["fr", "es"],
    "target": "/concepts/safe-house",
    "reason": "Concepts section not yet translated; EN fallback accepted until concepts/ is localized."
  },
  {
    "locales": ["fr", "es"],
    "target": "/gateway/enforcement",
    "reason": "Gateway section not yet translated; EN fallback accepted until gateway/ is localized."
  },
  {
    "locales": ["fr", "es"],
    "target": "/gateway/safe-house-overview",
    "reason": "Gateway section not yet translated; EN fallback accepted until gateway/ is localized."
  }
]
```

## Key Decisions & Rationale
**Lines of code to change:** ~150 lines removed (31 × ~5 lines each), net file shrinks from 182 to ~34 lines
**Risk level:** low — data-only change to a config file; the check script logic is untouched; the 5 retained entries exactly match links that exist today so the gate continues to pass
**Testing required:** Run `node scripts/check-links-local.mjs` from the repo root; it must exit 0 with "✓ No unallowlisted cross-locale links found."

## Verification
Execute every command to validate the patch is complete with zero regressions.

```bash
# Run the locale-link check — must exit 0
node scripts/check-links-local.mjs
```

Expected output contains both:
- `✓ No broken internal page links found.`
- `✓ No unallowlisted cross-locale links found.`

No other verification commands are required — this is a data-only change to a JSON config file with no build, typecheck, or lint pipeline steps applicable.

## Known Limitations / Follow-ups
None — the scope is strictly limited to removing the 31 phantom entries identified in the review finding. The check script and all fr/es page content are left untouched.
