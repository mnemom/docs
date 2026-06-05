# Spec — Docs `pip install agent-alignment-proto` 404s → use `agent-alignment-protocol`

- **Status:** Draft
- **Branch:** bug-issue-201-adw-5d35b6cb-fix-pip-package-name
- **Location:** changelog.mdx, protocols/overview.mdx, guides/upgrading-to-0-5.mdx
- **Related docs:** introduction.mdx (canonical-package-name callout, already correct), quickstart/sdk-direct.mdx (already correct), protocols/aap/quickstart.mdx (already correct), AGENTS.md (repo conventions), .mnemom/capability.yaml (verbs)

## Problem / Objective

### Problem Statement
Several documented `pip install` lines, a reference-table cell, and a PyPI URL use the package name **`agent-alignment-proto`**, which **does not exist on PyPI (returns 404)**. The canonical, published PyPI name is **`agent-alignment-protocol`** (the `-tocol` suffix is missing in the offenders). A customer who copy-pastes any of these lines gets `ERROR: No matching distribution found for agent-alignment-proto`. The docs also contradict themselves page-to-page: `introduction.mdx`, `quickstart/sdk-direct.mdx`, and all `protocols/aap/*` pages already use the correct `agent-alignment-protocol`, while the offending pages still use the broken short name.

This is the **docs half of MNE-224**. The website half (`agents.txt` `mnemom-aip` → `agent-integrity-proto`) already shipped in `mnemom-website` #606.

### Steps to Reproduce
1. Open the public docs at any of the offending pages (e.g. `guides/upgrading-to-0-5.mdx`).
2. Copy the documented command: `pip install agent-alignment-proto==0.5.0`.
3. Run it in a shell → `ERROR: No matching distribution found for agent-alignment-proto`.
4. Repeat with the bare `pip install agent-alignment-proto` from `changelog.mdx` → same 404.
5. Click the PyPI link in `protocols/overview.mdx` (`https://pypi.org/project/agent-alignment-proto/`) → PyPI 404 page.

Expected: every documented install command / link resolves to a real, installable package (`agent-alignment-protocol`, verified 200 on PyPI).
Actual: the bare `agent-alignment-proto` name 404s on both `pip install` and the `pypi.org/project/...` URL.

### Root Cause Analysis
The Python AAP package was documented under a truncated name (`agent-alignment-proto`) that was never published to PyPI; the real distribution is `agent-alignment-protocol`. A prior pass (commit `f6d92f8`, this branch) already corrected `introduction.mdx` and `quickstart/sdk-direct.mdx` but deliberately left the "historical" changelog and upgrade-guide entries and the `protocols/overview.mdx` reference table untouched. The issue (MNE-224 docs half) scopes the fix as **repo-wide**: the broken name must not appear anywhere a reader could copy it, including the changelog, the upgrade guide, and the reference table's PyPI URL. The remaining bare-token occurrences are the residual root cause of the copy-paste 404.

A naive find-and-replace is itself a hazard: `agent-alignment-protocol` **contains** `agent-alignment-proto` as a prefix, so an unbounded replace produces the corrupted `agent-alignment-protocolcol`. The fix must match the **bare token only**.

## Approach & Changes

Replace every **standalone** `agent-alignment-proto` with `agent-alignment-protocol` in the live documentation pages, including the `pypi.org/project/agent-alignment-proto/` URL. Use a word-boundary / negative-lookahead match so the already-correct `agent-alignment-protocol` is never touched (no `…-protocolcol`). Leave `agent-integrity-proto` (the AIP Python package — correct as-is) and `@mnemom/agent-alignment-protocol` (the npm package — correct as-is) untouched.

Relevant files and why they matter:
- **`changelog.mdx`** (line 313) — AAP v0.1.0 release note shows `pip install agent-alignment-proto`. Even as a release record, it's a copy-pasteable 404; the issue explicitly includes the changelog in scope.
- **`protocols/overview.mdx`** (line 161) — the "SDK packages" reference table cell `` `agent-alignment-proto` `` **and** its PyPI link `https://pypi.org/project/agent-alignment-proto/`. Both must become `agent-alignment-protocol`. (Line 162's `@mnemom/agent-alignment-protocol` npm row is already correct — do not touch.)
- **`guides/upgrading-to-0-5.mdx`** (lines 100 and 309) — `pip install agent-alignment-proto==0.5.0` in the CodeGroup and `agent-alignment-proto==0.5.0 (pip)` in the prose "Update SDK packages" line.

Out of scope / intentionally NOT changed (per issue Guardrails — "Leave historical artifacts under `app_docs/`/`specs/` alone"):
- `app_docs/feature-e6a00177-onboarding-docs-nits.md` — historical feature artifact.
- `specs/adw/issue-192-*-plan.md` and `specs/adw/issue-201-*-plan.md` (this file) — historical/planning artifacts.
- `.github/`, `images/`, `docs.json`/nav, redirect config, lockfiles — guardrail.

Already correct (verify, do not modify): `introduction.mdx`, `quickstart/sdk-direct.mdx`, `protocols/aap/*.mdx`, all `@mnemom/agent-alignment-protocol` and `agent-integrity-proto` references.

### New Files
None.

### Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

#### 1. Snapshot the before-state
- Run `grep -rn 'agent-alignment-proto' . --include='*.mdx' --include='*.md' | grep -vE '(^|/)(app_docs|specs|node_modules|\.git)/'` and record every live-docs hit. Confirm the set is exactly: `changelog.mdx:313`, `protocols/overview.mdx:161` (cell + URL), `guides/upgrading-to-0-5.mdx:100`, `guides/upgrading-to-0-5.mdx:309`.
- Run `grep -rc 'agent-integrity-proto' . --include='*.mdx' --include='*.md'` and record the total count of `agent-integrity-proto` hits — this must be unchanged after the fix.

#### 2. Fix `changelog.mdx`
- Line 313: change `pip install agent-alignment-proto` → `pip install agent-alignment-protocol`. Leave the adjacent `npm install @mnemom/agent-alignment-protocol` untouched.

#### 3. Fix `protocols/overview.mdx`
- Line 161 table cell: change `` `agent-alignment-proto` `` → `` `agent-alignment-protocol` ``.
- Line 161 PyPI URL: change `https://pypi.org/project/agent-alignment-proto/` → `https://pypi.org/project/agent-alignment-protocol/`.
- Do NOT touch line 162 (`@mnemom/agent-alignment-protocol`) or line 163 (`agent-integrity-proto`).

#### 4. Fix `guides/upgrading-to-0-5.mdx`
- Line 100: change `pip install agent-alignment-proto==0.5.0` → `pip install agent-alignment-protocol==0.5.0`.
- Line 309: change `agent-alignment-proto==0.5.0` → `agent-alignment-protocol==0.5.0` (the `(pip)` reference in the "Update SDK packages" prose). Leave the `@mnemom/agent-alignment-protocol@0.5.0` npm reference on the same line untouched.

#### 5. Verify no corruption and no over-reach
- Run `grep -rn 'agent-alignment-protocolcol' .` → must return **nothing** (guards against the prefix-replace bug).
- Run the live-docs grep from step 1 again → must return **zero** bare `agent-alignment-proto` hits in live docs (only `agent-alignment-protocol` remains).
- Re-run `grep -rc 'agent-integrity-proto'` and confirm the count matches the step-1 snapshot (AIP references unchanged).
- Confirm `git diff --stat` touches only `changelog.mdx`, `protocols/overview.mdx`, `guides/upgrading-to-0-5.mdx`.

#### 6. Run the Verification commands
- Execute every command in the Verification section below and confirm all pass with zero regressions.

## Key Decisions & Rationale

- **Root cause, not symptom:** The bug is a non-existent package name copied into install commands and a PyPI link. Replacing the bare token everywhere a reader can copy it (install lines, table cell, URL) eliminates the 404 at its source rather than patching one page. The prior pass fixed only the two quickstart-path pages; this completes the repo-wide sweep the issue requires.
- **Bare-token-only match (the critical guardrail):** `agent-alignment-protocol` contains `agent-alignment-proto` as a prefix. Any replace must be bounded (`agent-alignment-proto\b` or `agent-alignment-proto(?!col)`) so the already-correct names are never corrupted into `agent-alignment-protocolcol`. The plan does targeted, line-specific edits and adds an explicit `grep -rn 'agent-alignment-protocolcol'` guard.
- **Leave AIP and npm names alone:** `agent-integrity-proto` (AIP Python) and `@mnemom/agent-alignment-protocol` (AAP npm) are the real published names; touching them would introduce new bugs. The plan verifies the `agent-integrity-proto` count is unchanged.
- **Respect the historical-artifact guardrail:** `app_docs/` and `specs/` contain the old name in retrospective records; the issue's Guardrails section says leave them alone. Note (tradeoff): a literal repo-wide `grep -rn 'agent-alignment-proto' .` will still report those `app_docs/`/`specs/` hits. The acceptance criterion is satisfied for the **live documentation surface** (what readers install from); the exclusion is intentional per guardrail and noted for the human reviewer.
- **No contract change:** The capability manifest is `merge_strategy: external` (supervised). This plan does not alter the human-in-the-loop contract — drive checks green, label `agent`, stop for human review.

## Verification
Execute every command to validate the bug is fixed with zero regressions. Run from the worktree root (`/home/runner/work/docs/docs/trees/5d35b6cb`).

**Reproduce before / confirm after:**
- Before the fix, `grep -rn 'agent-alignment-proto' changelog.mdx protocols/overview.mdx guides/upgrading-to-0-5.mdx` shows the broken bare name (and the `pypi.org/project/agent-alignment-proto/` URL). Each of those `pip install agent-alignment-proto…` lines 404s on PyPI.
- After the fix, the same grep shows **only** `agent-alignment-protocol`, and `grep -rn 'agent-alignment-protocolcol' .` returns nothing.

```bash
# Live-docs offenders must be gone (zero output):
grep -rn 'agent-alignment-proto\b' . --include='*.mdx' --include='*.md' | grep -vE '(^|/)(app_docs|specs|node_modules|\.git)/'

# No corruption from prefix-replace (zero output):
grep -rn 'agent-alignment-protocolcol' .

# AIP package references unchanged (count identical to pre-fix snapshot):
grep -rc 'agent-integrity-proto' . --include='*.mdx' --include='*.md'
```

- `.mnemom/capability.yaml` **lint** verb — `npm run check:redirects` (redirect integrity).
- `.mnemom/capability.yaml` **typecheck** verb — `echo "(no typecheck for MDX docs)"` (no-op).
- `.mnemom/capability.yaml` **test** verb — `npm ci && npm run check:doc-examples` (doc↔OpenAPI example validator).
- `.mnemom/capability.yaml` **build** verb — `echo "(Mintlify-hosted build; validated by CI)"` (no-op).
- Required check **`Validate Mintlify Docs`** — `mintlify broken-links` must pass (the PyPI URL change keeps the link valid; no internal links affected).

## Known Limitations / Follow-ups

- This is a prose/MDX + reference-table edit only; no code, dependencies, or config change. Not a UI/UX-facing change (manifest `ux_path_globs` is `images/**` only), so no E2E test or UX-scenario evidence is required.
- The bare name still appears in `app_docs/feature-e6a00177-onboarding-docs-nits.md` and the `specs/adw/` planning files by design (historical artifacts, per issue Guardrails). If a future pass wants a truly clean repo-wide grep, those would need a separate, explicitly-authorized cleanup — flagged for the human reviewer.
- Public-docs supervised workflow: open the PR, drive `Validate Mintlify Docs` green, apply the `agent` label, and **stop for human review** — no autonomous merge into the public docs.
