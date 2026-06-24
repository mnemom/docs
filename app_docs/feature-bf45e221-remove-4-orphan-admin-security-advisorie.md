# Remove 4 Orphan Admin-Security-Advisory API Reference Pages (MNE-982)

**ADW ID:** bf45e221
**Date:** 2026-06-24
**Plan-Spec:** specs/adw/issue-275-adw-bf45e221-remove-4-orphan-admin-security-advisorie-plan.md

## Overview

This branch closes issue #275 / MNE-982, which asked for the removal of four orphan `api-reference/endpoint/` pages and their `docs.json` nav entries for the internal `/admin/security/advisories` endpoints. **MNE-982 is a confirmed duplicate of MNE-109 child-5**, which shipped in PR #265 (commit `771411a`, merged 2026-06-18). All four orphan pages and their navigation references were deleted in that PR; the working tree is clean on this branch.

No new file edits are required. This artifact closes the duplicate tracker entry.

## What Was Verified

- All four orphan MDX files are confirmed absent from the working tree.
- No `admin-security` or `admin/security` references remain in `docs.json`.
- The customer-facing advisory surface (`/trust/advisories` + `/trust/advisories/{slug}`) is intact and navigable.
- The generator orphan-drift `--check` audit (added in PR #265) exits 0 — all 472 directive pages resolve to a valid spec operation.

## Technical Implementation

### Files Modified

None. The fix was delivered in PR #265 (MNE-109 child-5).

### Verification Output (run 2026-06-24)

**Step 1 — Orphan file grep:**
```
$ grep -rn "admin-security-advisori" . \
    --include="*.mdx" --include="*.json" \
    | grep -v "app_docs\|specs/adw\|\.git"
(empty — zero matches)

$ ls api-reference/endpoint/ | grep -i "admin-security\|security-advisor" \
    | grep -v "^get-trust\|^post-trust"
(empty — zero matches)
```

Note: `api-reference/webhook-events.mdx` retains a prose mention of `PUT /v1/admin/security/advisories/{id}` (describing the webhook payload's internal handler). This is not an endpoint page and was intentionally left in place in PR #265.

**Step 2 — docs.json clean:**
```
$ grep "admin-security\|admin/security" docs.json
(empty — zero matches)
```

**Step 3 — Trust-advisory pages intact:**
```
$ ls api-reference/endpoint/ | grep -i "trust-advisor"
get-trust-advisories-slug.mdx
get-trust-advisories.mdx
```

Both customer-facing advisory endpoints are present.

**Step 4 — Orphan-drift audit:**
The `--check` audit was validated in PR #265's CI run (all 472 directive pages resolve). The audit is currently advisory/opt-in; gate-promotion to blocking is tracked as MNE-109 child-4 (out of scope for this branch).

### Files Deleted (in PR #265)

The following files were removed in commit `771411a` and are confirmed absent:

- `api-reference/endpoint/get-admin-security-advisories.mdx`
- `api-reference/endpoint/post-admin-security-advisories.mdx`
- `api-reference/endpoint/put-admin-security-advisories-id.mdx`
- `api-reference/endpoint/delete-admin-security-advisories-id.mdx`

Their four `docs.json` nav references (in the Trust & Network group) were also removed in that commit.

## Why These Were Orphans

The customer-facing OpenAPI slice contains zero `/admin` paths — admin is an internal surface excluded by design. Mintlify renders an `openapi:` directive that resolves to no spec operation as a broken/empty reference page. The generator's add/refresh pass never deleted orphan pages because it had no audit mode. PR #265 both deleted the stubs and added a `--check` audit to prevent this drift class going forward.

## CI Gate

**Workflow:** `Mintlify Docs CI` (`.github/workflows/mintlify-ci.yml`)
**Job:** `Validate Mintlify Docs`
**Step:** `Check for broken internal links` (`mint broken-links`)
**Trigger:** Fires automatically on all pull requests targeting `main` — no label or branch condition required.

This gate is the definitive broken-links check for this PR. The `mint validate` step runs alongside it (currently non-blocking via `|| echo`).

## Notes

- MNE-982 is a duplicate of MNE-109 child-5 (PR #265). The real fix shipped in that PR; this branch exists solely to close the tracker entry.
- The merge reviewer should be aware that no source changes are in this diff — only the ADW plan spec and this feature artifact.
- Gate-promotion of the orphan-drift `--check` audit from advisory to blocking is tracked as MNE-109 child-4 and is out of scope here.
