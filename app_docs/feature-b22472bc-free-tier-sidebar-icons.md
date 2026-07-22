# Fix Blank Sidebar Icons: Swap 5 Pro-tier Font Awesome Icons for Free-tier Equivalents

**ADW ID:** b22472bc
**Date:** 2026-07-22
**Plan-Spec:** agents/b22472bc/plan/issue-404-adw-b22472bc-swap-pro-tier-icons-plan.md

## Overview

Five sidebar icons on `docs.mnemom.ai` rendered blank because their `icon:` frontmatter values referenced **Font Awesome Pro-tier-only** names. The docs CDN only serves the **free** tier, so those SVG requests returned HTTP 403 and Mintlify showed nothing. This change replaces each Pro-only name with a verified free-tier equivalent that returns HTTP 200 — a zero-cost, in-tier swap with no plan upgrade.

## What Was Built

- Five one-line `icon:` frontmatter swaps across five MDX pages, each replacing a Pro-only Font Awesome icon with a free-tier equivalent that resolves on the pinned CDN version (v7.2.0).

| Page | Pro icon (403) | Free-tier icon (200) |
|---|---|---|
| Posture Versioning | `git-branch` | `code-branch` |
| Posture vs. Cards | `git-compare` | `code-compare` |
| agent-preview/v1 | `file-json` | `file-code` |
| Provider Support | `circuit-board` | `network-wired` |
| Verifiable Verdicts (ZK Proofs) | `cpu` | `microchip` |

## Technical Implementation

### Files Modified

- `concepts/posture-versioning.mdx`: line 5 `icon:` `git-branch` → `code-branch`
- `concepts/posture-vs-cards.mdx`: line 5 `icon:` `git-compare` → `code-compare`
- `specifications/agent-preview-v1.mdx`: line 5 `icon:` `file-json` → `file-code`
- `concepts/provider-support.mdx`: line 5 `icon:` `circuit-board` → `network-wired`
- `protocols/aip/verifiable-verdicts.mdx`: line 5 `icon:` `cpu` → `microchip`

### Key Changes

- Only the `icon:` value on line 5 of each file was changed; all other frontmatter keys, quoting style, and body content are byte-for-byte unchanged.
- The diff is exactly five changed lines across five files (`git diff --stat` shows 6 insertions / 5 deletions, the sixth being the ADW phase marker) — docs-content only, no CI/workflow edits.
- Each replacement preserves semantic fidelity: version-control glyphs (`code-branch`/`code-compare`), a code/file glyph (`file-code`), and a hardware glyph (`microchip`).
- `circuit-board` has no exact free-tier equivalent; `network-wired` is the operator-approved fit (`sitemap`/`diagram-project` are documented acceptable alternates).
- This fixes the root cause (a Pro-only icon name absent from the free CDN tier), not the symptom — no styling/CSS workaround was needed.

## How to Use

No action is required by readers — the fix is transparent. To confirm the render:

1. Open `docs.mnemom.ai` and view the sidebar entries for the five affected pages.
2. Confirm each leading icon now renders instead of appearing blank.
3. Optionally verify the CDN directly, e.g. `curl -sI https://d3gk2c5xim1je2.cloudfront.net/fontawesome/v7.2.0/regular/code-branch.svg` returns **200** (the old `git-branch.svg` returned **403**).

## Configuration

None. No plan upgrade, no new dependencies, and no environment or build configuration changes. The Font Awesome version remains pinned at v7.2.0 on the existing CloudFront CDN.

## Testing

Per `.mnemom/capability.yaml`, MDX frontmatter edits do not trigger the UX visual-validation gate (scoped to `images/**`), so no E2E test is required.

- **lint** — `npm run check:redirects && npm run check:links` (redirect/link integrity)
- **typecheck** — no-op for MDX docs
- **test** — `npm ci && npm run check:doc-examples` (doc↔OpenAPI example validator)
- **build** — no-op; Mintlify-hosted. The required CI check `Validate Mintlify Docs` (`mint broken-links`) gates the PR.

## Notes

- **Idempotent.** Commit `dd5d073` already applied all five edits on this branch, so each file's line 5 already shows the free-tier target. Re-applying the swap is a no-op.
- `network-wired` is a semantic approximation for `circuit-board`; design may later prefer `sitemap` or `diagram-project`.
- Scope is intentionally minimal: MNE-1484 and the maintainer comment approve the free-tier swap and explicitly forbid a Pro-tier plan upgrade.
