# Spec — Bug: Remove bare % from headings crashing mint broken-links (full sweep)

- **Status:** Draft
- **Branch:** bug-issue-413-adw-666a4b8a-docs-remove-bare-from-headings-crashing
- **Location:** `concepts/reputation-scores.mdx`, `guides/improving-reputation.mdx`, `concepts/team-reputation.mdx`, `concepts/risk-assessment.mdx`
- **Tracks:** Linear MNE-2314

## Problem / Objective

`mint broken-links` (the `Validate Mintlify Docs` required check) crashes with `URIError: URI malformed` whenever a heading contains a bare `%` character. Mintlify's anchor/slug resolver runs each heading through a URI-decode step, and a bare `%` (not followed by two hex digits) is an invalid percent-escape sequence. This keeps the check red repo-wide.

**Root cause:** Headings like `### Integrity ratio (40%)` produce a slug that Mintlify URI-decodes, triggering the crash. The fix is to replace `%` with the word `percent` in every affected heading.

**Full sweep result** (`grep -rn "^#.*%" --include="*.mdx"`): 18 headings across 4 files. Two additional grep hits (`concepts/policy-engine.mdx:423` and `gateway/enforcement.mdx:232`) are bash-comment lines inside fenced code blocks — not headings — and are out of scope.

**Anchor safety:** The old anchors were already broken (URIError), so they cannot have been reliably used as external links. A repo-wide search for inbound anchor links to all 18 old slugs returned zero hits. No `docs.json` redirects are needed.

## Approach & Changes

### Files to Modify

- `concepts/reputation-scores.mdx` — 5 headings
- `guides/improving-reputation.mdx` — 5 headings
- `concepts/team-reputation.mdx` — 5 headings
- `concepts/risk-assessment.mdx` — 3 headings

### Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix `concepts/reputation-scores.mdx` (5 headings)

| From | To |
|------|----|
| `### Integrity ratio (40%)` | `### Integrity ratio (40 percent)` |
| `### Compliance (20%)` | `### Compliance (20 percent)` |
| `### Drift stability (20%)` | `### Drift stability (20 percent)` |
| `### Trace completeness (10%)` | `### Trace completeness (10 percent)` |
| `### Coherence compatibility (10%)` | `### Coherence compatibility (10 percent)` |

### Step 2: Fix `guides/improving-reputation.mdx` (5 headings)

| From | To |
|------|----|
| `### 1. Integrity ratio (40% of score)` | `### 1. Integrity ratio (40 percent of score)` |
| `### 2. Compliance (20% of score)` | `### 2. Compliance (20 percent of score)` |
| `### 3. Drift stability (20% of score)` | `### 3. Drift stability (20 percent of score)` |
| `### 4. Trace completeness (10% of score)` | `### 4. Trace completeness (10 percent of score)` |
| `### 5. Coherence compatibility (10% of score)` | `### 5. Coherence compatibility (10 percent of score)` |

### Step 3: Fix `concepts/team-reputation.mdx` (5 headings)

| From | To |
|------|----|
| `### Coherence history (35%)` | `### Coherence history (35 percent)` |
| `### Member quality (25%)` | `### Member quality (25 percent)` |
| `### Operational record (20%)` | `### Operational record (20 percent)` |
| `### Structural stability (10%)` | `### Structural stability (10 percent)` |
| `### Assessment density (10%)` | `### Assessment density (10 percent)` |

### Step 4: Fix `concepts/risk-assessment.mdx` (3 headings)

| From | To |
|------|----|
| `### Context-aware component risk (60%)` | `### Context-aware component risk (60 percent)` |
| `### Recency penalty (30%)` | `### Recency penalty (30 percent)` |
| `### Confidence penalty (10%)` | `### Confidence penalty (10 percent)` |

### Step 5: Confirm no bare % remains in any MDX heading

Run: `grep -rn "^#.*%" --include="*.mdx"` — must return only the two known code-comment hits (`policy-engine.mdx:423` and `enforcement.mdx:232`).

## Key Decisions & Rationale

**Lines of code to change:** 18 heading lines across 4 files.
**Risk level:** low — prose-only, no nav/link/schema changes, no env-var or contract changes.
**No redirects needed:** Old anchors were already broken (the bug itself), so they were never reliably reachable externally; and zero inbound anchor refs exist in the repo.
**Wording choice:** `percent` (spelled out) matches the plain-prose style of these concept pages and produces a valid, readable anchor slug.
**Scope:** Per issue #413, docs-content only — no `.github/workflows/**` edits.

## Verification

Execute every command from the repo root to validate the patch is complete with zero regressions.

- `npm run check:redirects` — **lint verb.** Redirect-table integrity (and `docs.json` parse).
- `echo "(no typecheck for MDX docs)"` — **typecheck verb** (no-op for MDX).
- `npm ci && npm run check:doc-examples` — **test verb.** Doc-as-spec validator.
- `echo "(Mintlify-hosted build; validated by CI)"` — **build verb** (no-op).
- `grep -rn "^#.*%" --include="*.mdx"` — must return only the two code-comment hits; no heading hits.
- `mintlify broken-links` — the required **"Validate Mintlify Docs"** check; must exit 0.

## Known Limitations / Follow-ups

- Bare `%` inside body prose (non-headings) does not trigger the URIError and is out of scope for this fix.
- If additional `%`-in-heading pages are added in the future, CI will catch them via the same `mint broken-links` check.
