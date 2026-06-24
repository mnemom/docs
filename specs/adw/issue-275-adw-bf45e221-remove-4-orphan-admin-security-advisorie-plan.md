# Spec — Remove 4 Orphan Admin-Security-Advisory API Reference Pages (MNE-982)

- **Status:** Complete — confirmed duplicate; real fix shipped in PR #265 (MNE-109 child-5)
- **Branch:** chore-issue-275-adw-bf45e221-remove-4-orphan-admin-security-advisorie
- **Location:** No new file edits required — all four orphan pages and their docs.json nav entries were removed in PR #265.
- **Related docs:** scripts/generate-api-reference.mjs (orphan-drift `--check` added in PR #265), api-reference/endpoint/ (orphan stubs deleted), docs.json (nav refs removed), api-reference/webhook-events.mdx (retains legitimate prose mention of the internal handler — not a nav page, not in scope)

## Problem / Objective

### Problem Statement
Four api-reference endpoint pages carried Mintlify `openapi:` directives that resolve to **no operation** in the committed customer-facing OpenAPI slice:

```
GET    /admin/security/advisories
POST   /admin/security/advisories
PUT    /admin/security/advisories/{id}
DELETE /admin/security/advisories/{id}
```

The committed slice contains zero `/admin` paths — admin is an internal surface excluded by design from the customer-facing spec. The customer-facing advisory surface is `/trust/advisories` + `/trust/advisories/{slug}`, both present and navigable. The four `admin/security/advisories` pages were orphan stubs left from an earlier spec version that exposed admin endpoints; Mintlify renders a directive matching no operation as a broken/empty reference page. The generator's add/refresh passes only operations that exist in the spec, so it never cleaned these up automatically.

These pages were also listed in the `docs.json` navigation (Trust & Network group), making them reachable from the nav sidebar despite rendering as broken.

### Root Cause Analysis
The `scripts/generate-api-reference.mjs` generator's add/refresh pass created pages for every spec operation and kept nav refs in sync — but it had no orphan-drift audit: it never checked whether existing endpoint pages still corresponded to a valid spec operation. When the admin endpoint slice was removed from the customer-facing spec, these four pages were left behind as orphans. The root cause is now closed: PR #265 added a `--check` audit mode that exits 1 when any endpoint page's directive resolves to no spec operation, catching this drift class going forward.

### MNE-982 / Issue #275 status
**This issue is a confirmed duplicate of MNE-109 child-5 (PR #265).** The four orphan pages, their docs.json nav entries, and the generator orphan-drift audit were all delivered in commit `771411a` (PR #265, merged 2026-06-18). This branch exists only to close the duplicate tracker entry.

## Approach & Changes

### New Files
None.

### Files to Modify
None — confirmed. The worktree is clean on this branch; all four orphan MDX files and their docs.json nav entries are absent.

### Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

#### Step 1 — Verify the four orphan files are absent (conditional deletion)
Run:
```sh
grep -rn "admin-security-advisori" . \
  --include="*.mdx" --include="*.json" \
  | grep -v "app_docs\|specs/adw\|\.git"
```
And:
```sh
ls api-reference/endpoint/ | grep -i "admin-security\|security-advisor" \
  | grep -v "^get-trust\|^post-trust"
```
**Expected output: empty (no matches).**

**If any matches are found:** this means the four orphan MDX files or their docs.json nav refs are unexpectedly present on this branch. Delete each matching file with `git rm <path>` and remove the corresponding `docs.json` nav entries, then re-run the grep to confirm zero matches before proceeding.

The four specific files that must be absent are:
- `api-reference/endpoint/get-admin-security-advisories.mdx`
- `api-reference/endpoint/post-admin-security-advisories.mdx`
- `api-reference/endpoint/put-admin-security-advisories-id.mdx`
- `api-reference/endpoint/delete-admin-security-advisories-id.mdx`

Note: `api-reference/webhook-events.mdx` legitimately references `PUT /v1/admin/security/advisories/{id}` in prose describing a webhook payload — this is NOT an orphan page and must NOT be modified.

#### Step 2 — Verify docs.json is clean
Run:
```sh
grep "admin-security\|admin/security" docs.json
```
**Expected output: empty.**

#### Step 3 — Confirm trust-advisory pages are intact
Run:
```sh
ls api-reference/endpoint/ | grep -i "trust-advisor"
```
**Expected: `get-trust-advisories.mdx` and `get-trust-advisories-slug.mdx` are present.**

This confirms the customer-facing advisory surface was not disturbed.

#### Step 4 — Confirm the orphan-drift audit now covers the generator
Run:
```sh
node scripts/generate-api-reference.mjs --check 2>&1 | tail -5
```
**Expected: exits 0 with all directive pages resolving to a valid spec operation.**

If the script is unavailable in this environment, note the unavailability and proceed — the audit was validated in PR #265's CI run.

## Known Limitations / Follow-ups

- Gate-promotion of the `--check` orphan-drift audit from advisory/opt-in to a required CI gate is tracked as MNE-109 child-4 and is **explicitly out of scope** for this branch.
- The `api-reference/webhook-events.mdx` prose mention of `PUT /v1/admin/security/advisories/{id}` (describing the webhook's internal handler) is intentionally retained — it is documentation of a webhook payload, not a Mintlify endpoint page.

## Acceptance Criteria

- [ ] `grep -rn "admin-security-advisori" . --include="*.mdx" --include="*.json"` returns zero live-docs hits (excluding `app_docs/`, `specs/adw/`, and `.git`).
- [ ] `ls api-reference/endpoint/ | grep "admin-security"` returns empty.
- [ ] `grep "admin-security\|admin/security" docs.json` returns empty.
- [ ] `get-trust-advisories.mdx` and `get-trust-advisories-slug.mdx` are present and navigable.
- [ ] CI job **"Validate Mintlify Docs"** (workflow: `mintlify-ci.yml`, step: **"Check for broken internal links"**) passes on this PR. This workflow triggers automatically on all pull requests targeting `main` — no label or branch-name condition. The `mint broken-links` step is the definitive gate for link integrity and subsumes local verification.
- [ ] `scripts/generate-api-reference.mjs --check` exits 0 (validated by PR #265's CI; advisory-only until MNE-109 child-4 promotes it to blocking).
