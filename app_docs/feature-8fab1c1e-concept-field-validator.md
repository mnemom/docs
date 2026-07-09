# Concept-Behavior Field Validator

**ADW ID:** 8fab1c1e
**Date:** 2026-07-09
**Plan-Spec:** specs/adw/issue-284-adw-8fab1c1e-concept-field-validator-plan.md

## Overview

Concept pages describe platform behavior in prose while naming concrete API field and verb identifiers inline (`bounded_actions`, `forbidden_actions`, `category`, `autonomy.bounded_actions`, etc.). When one of those identifiers is renamed in the OpenAPI spec, the concept narrative silently keeps asserting the stale name. This feature adds an opt-in CI gate (`check:concept-fields`) that validates every identifier a concept page claims against the live OpenAPI spec, closing the exact drift gap behind regression #222.

## What Was Built

- A new validation script, `scripts/check-concept-fields.mjs`, that audits API identifiers cited in concept prose against the OpenAPI spec.
- A per-page **opt-in annotation** mechanism: pages enumerate the exact identifiers to validate via a single MDX comment (`{/* concept-fields: ... */}`) placed near the top of the file.
- Two independent checks per opted-in page: an **honesty check** (every listed identifier must actually appear backticked in the body) and a **spec check** (every identifier must resolve against the spec's schema identifier set).
- A new npm script `check:concept-fields` wired into `package.json`.
- Opt-in annotations added to four concept pages: `agent-cards.mdx`, `ap-traces.mdx`, `integrity-checkpoints.mdx`, and `value-coherence.mdx`.

## Technical Implementation

### Files Modified

- `scripts/check-concept-fields.mjs`: New 299-line validator. Loads the OpenAPI spec via the shared `_load-spec.mjs` loader (ADR-054/055), builds a flat identifier set by walking `components.schemas` for every `properties` key and `enum` string value, then validates each opted-in page's enumerated identifiers.
- `package.json`: Added the `check:concept-fields` script entry.
- `concepts/agent-cards.mdx`: Added annotation for `autonomy`, `bounded_actions`, `forbidden_actions`, `conscience`, `autonomy.bounded_actions`, `autonomy.forbidden_actions`, `values.declared`.
- `concepts/ap-traces.mdx`: Added annotation for `card_id`, `category`, `bounded_actions`, `forbidden_actions`, `values_applied`, `queryable`.
- `concepts/integrity-checkpoints.mdx`: Added annotation for `bounded_actions`, `linked_trace_id`, `thinking_block_hash`, `boundary_violation`, `review_needed`.
- `concepts/value-coherence.mdx`: Added annotation for `conflicts_with`, `timestamp`.

### Key Changes

- **Opt-in by enumeration.** A page participates only if it carries a `{/* concept-fields: id1, id2, ... */}` MDX comment within the first 40 lines (the `HEAD_LINES` head-window contract). This mirrors the sibling `check-spec-examples.mjs` (`t5-3:full-example`) opt-in philosophy — default off, explicit on — which keeps the check false-positive-free and guarantees a clean exit 0 on the current tree.
- **Two-layer validation.** The *honesty check* ensures a listed identifier is actually backticked in the page body (catching stale annotations / manifest rot, MNE-440). The *spec check* resolves each identifier against the flat spec identifier set; a dotted identifier (`autonomy.bounded_actions`) resolves iff every dot-separated segment is present in the set.
- **Fail-closed semantics (MNE-442).** Exit `2` on any usage error, malformed identifier, unreachable spec, or an empty schema set — the check never silently passes when it cannot actually validate.
- **Identifier grammar.** Accepted identifiers are snake_case, optionally dotted (`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`), which naturally excludes CamelCase schema names and prose words.
- **Flat-set caveat.** Dotted-segment resolution is flat, not structural ($ref-following) — each segment is validated independently against the global set, so the check is most meaningful for domain-specific identifiers rather than generic tokens like `name`/`type`. Structural resolution is noted as a follow-up.

## How to Use

1. Run the checker across the default `concepts` scope:
   ```bash
   npm run check:concept-fields
   ```
2. To opt a concept page into validation, add an MDX comment immediately after the frontmatter block (within the first 40 lines), listing the API identifiers the page cites:
   ```mdx
   {/* concept-fields: bounded_actions, forbidden_actions, category */}
   ```
3. Ensure each listed identifier is actually backticked somewhere in the page body (e.g. `` `bounded_actions` ``), or the honesty check will flag it as a stale annotation.
4. Optional flags:
   - `--scope <dir|file,csv>` — override the default `concepts` scope.
   - `--verbose` — print a per-page, per-identifier ✓/✗ breakdown.
   - `--help` / `-h` — usage.

## Configuration

- **`OPENAPI_SPEC_PATH`** — environment override consumed by the shared `_load-spec.mjs` loader (ADR-054/055) to point at a local spec instead of the live URL.
- **Annotation head-window** — the opt-in comment must appear within the first `HEAD_LINES` (40) lines; annotations placed lower are not seen and the page is treated as un-annotated.

## Testing

- Run the validator directly: `npm run check:concept-fields` (add `--verbose` to inspect each identifier's resolution).
- Exit codes: `0` = all opted-in identifiers resolve and all annotations are honest; `1` = one or more stale identifiers or stale annotations (each reported with `file:line`); `2` = usage error / malformed identifier / spec unreachable or empty (fail closed).
- Regression scenario to confirm: rename or remove a validated identifier from the spec (or from a page body) and re-run — the gate should exit `1` and name the offending `file:line`.

## Notes

- This validator is a documentation-drift gate; a passing result proves the enumerated identifiers exist as `properties`/`enum` names in the spec and are backticked in the page — it does not prove structural (parent→child) correctness for dotted identifiers. Prefer specific, domain identifiers in annotations when the goal is drift detection.
- Sibling checks share the same idiom and are worth reading together: `check-spec-examples.mjs` (T5-3, validates whole fenced example blocks) and `check-doc-examples.mjs` (T5-1, validates curl path/method/body).
- Follow-up: structural ($ref-following) resolution of dotted identifiers, so a leaf segment is validated against its actual parent container rather than the global flat set.
