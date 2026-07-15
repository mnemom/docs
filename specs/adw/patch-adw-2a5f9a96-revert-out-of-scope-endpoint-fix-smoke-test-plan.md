# Spec — Patch: Revert out-of-scope endpoint edit; replace live-tree smoke test with fixture

- **Status:** Draft
- **Branch:** feature-issue-277-adw-2a5f9a96-wire-generate-api-reference-mjs-check-in
- **Location:** `api-reference/endpoint/get-auth-me-personal-org.mdx`, `scripts/generate-api-reference.test.mjs`, `app_docs/feature-2a5f9a96-api-reference-drift-gate.md`
- **Related docs:** `app_docs/feature-2a5f9a96-api-reference-drift-gate.md`, `scripts/generate-api-reference.test.mjs`, `scripts/lib/api-reference-drift.mjs`

## Problem / Objective
**Original Spec:** N/A (ADW 2a5f9a96 implementation)
**Issue:** Two blocking review findings:
1. `api-reference/endpoint/get-auth-me-personal-org.mdx` was edited (description frontmatter changed) in violation of the issue's explicit scope guard: "Do not edit any .mdx file under api-reference/endpoint/". The MNE-413 exception does not apply — this is not a mandatory ADW pipeline artifact.
2. The smoke test at line 171-175 of `generate-api-reference.test.mjs` asserts `exit 0` against the real committed tree, which only passes because of the (now-reverted) out-of-scope endpoint edit. The changed description has no covering fixture test that would fail on the OLD description — the description edit itself is what causes the smoke test to pass.

**Solution:**
1. Revert `get-auth-me-personal-org.mdx` to its original committed description.
2. Remove the live-tree smoke test (`"smoke: '--check' exits 0 on the committed tree (no drift)"`) — the live tree has known description drift deferred to a follow-up PR, so a live-tree exit-0 assertion cannot hold without the out-of-scope edit.
3. Add a fixture-based in-memory test that asserts `computeDrift` reports `refreshed === 1` when only the description drifts (title unchanged). This covers the drift-detection behavior the smoke test was masking.
4. Update the feature doc to remove the claim that the endpoint description was reconciled, noting the deferral instead.

## Approach & Changes

### Files to Modify

- `api-reference/endpoint/get-auth-me-personal-org.mdx` — revert description (1 line)
- `scripts/generate-api-reference.test.mjs` — remove live-tree smoke test (lines 171-175); add description-only-drift fixture test (~9 lines)
- `app_docs/feature-2a5f9a96-api-reference-drift-gate.md` — remove the bullet claiming the endpoint description was reconciled; note deferral

### Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Revert `api-reference/endpoint/get-auth-me-personal-org.mdx`
- Change the `description:` line from:
  `"Returns the authenticated user's personal-org-of-one (per ADR-044 Piece 1)."`
  back to the original:
  `"Returns the authenticated user's personal organization — the auto-provisioned org-of-one that scopes their individual resources."`
- Leave `title:` and `openapi:` untouched; the file remains a 5-line stub.

### Step 2: Replace the live-tree smoke test in `generate-api-reference.test.mjs`
- **Remove** the test block at lines 171-175:
  ```javascript
  test("smoke: `--check` exits 0 on the committed tree (no drift)", () => {
    const r = spawnSync(process.execPath, [CLI, "--check"], { encoding: "utf8" });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /✓ no drift/);
  });
  ```
- **Add** a new fixture-based test immediately before the existing `"'--check' exits non-zero..."` test (line 177), covering description-only drift detection:
  ```javascript
  test("committed stub whose description-only drifted (title unchanged) → refreshed === 1", () => {
    const opOld = widgetOp(); // no description field; descriptionFor falls back to summary
    const opNew = { ...opOld, description: "A precise technical description for widgets." };
    const r = run({
      spec: { paths: { "/widgets": { get: opNew } } },
      pages: { "get-widgets.mdx": stubBody("List widgets", "get", "/widgets", opOld) },
      docs: docsWith([{ group: "Tools", pages: ["api-reference/endpoint/get-widgets"] }]),
    });
    assert.equal(r.refreshed, 1, "description-only drift must trigger a refresh");
    assert.equal(r.written, 0, "page already exists — not a new write");
  });
  ```
- Net test count remains 15 (1 removed, 1 added).

### Step 3: Update `app_docs/feature-2a5f9a96-api-reference-drift-gate.md`
- In the "Files Modified" bullet list, remove (or replace) the line:
  `- \`api-reference/endpoint/get-auth-me-personal-org.mdx\`: Reconciled the \`description\` field to match the current spec summary so the committed tree passes the gate.`
- Replace with a note such as:
  `- \`api-reference/endpoint/get-auth-me-personal-org.mdx\`: NOT modified. Known description drift between the committed page and the current spec is deferred to a follow-up reconciliation PR (scope guard: api-reference/endpoint/** files are out of scope for this issue).`
- Also update the "What Was Built" bullet "A reconciled endpoint description so the committed tree passes the gate." — remove this bullet, as it is no longer accurate.

## Key Decisions & Rationale
**Lines of code to change:** ~15 (1 in endpoint file, ~10 in test file, ~4 in feature doc)
**Risk level:** low — reverting a single frontmatter line; swapping one test for an equivalent fixture test
**Testing required:** Run `npm run test:api-reference`; expect all 15 tests to pass. Confirm `npm run check:api-reference-drift` exits non-zero (expected — known description drift on personal-org endpoint is deferred; the gate script is available but not yet wired as a blocking CI step).

## Verification

Execute every command to validate the patch is complete with zero regressions.

1. **Test suite passes:**
   ```bash
   node --test scripts/generate-api-reference.test.mjs
   ```
   All 15 tests must pass (the removed smoke test is replaced by the description-drift fixture test).

2. **Endpoint file reverted correctly:**
   ```bash
   grep "description:" api-reference/endpoint/get-auth-me-personal-org.mdx
   ```
   Must output: `description: "Returns the authenticated user's personal organization — the auto-provisioned org-of-one that scopes their individual resources."`

3. **Drift gate exits non-zero (expected — known deferred drift):**
   ```bash
   node scripts/generate-api-reference.mjs --check; echo "exit: $?"
   ```
   Must exit non-zero reporting description drift on the personal-org endpoint. This is expected and correct; the gate is accurate. The follow-up PR will reconcile this description and re-enable the live-tree exit-0 assertion.

4. **No out-of-scope files touched:**
   ```bash
   git diff --name-only HEAD
   ```
   Must not list any file under `api-reference/endpoint/` other than `get-auth-me-personal-org.mdx` (which is being reverted, not newly modified). The only endpoint file change is the revert.

## Known Limitations / Follow-ups
- The `check:api-reference-drift` npm script will exit non-zero after this patch because of the deferred description drift on `get-auth-me-personal-org.mdx`. A follow-up PR should run `node scripts/generate-api-reference.mjs` and commit the refreshed endpoint stubs (for ALL endpoints with description drift, not just this one), then restore a live-tree smoke test asserting exit 0 once the tree is fully reconciled.
- The live-tree integration smoke test (asserting `--check` exits 0 on the committed tree) is intentionally absent until the description drift backlog is cleared.
