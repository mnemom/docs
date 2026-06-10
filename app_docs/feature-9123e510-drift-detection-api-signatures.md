# Fix Drift Detection API Signatures in Docs

**ADW ID:** 9123e510
**Date:** 2026-06-10
**Plan-Spec:** specs/adw/issue-223-adw-9123e510-fix-drift-detection-api-signatures-plan.md

## Overview

The documentation showed incorrect call signatures and result shapes for the drift-detection APIs (`detectDrift` / `detect_drift` in the Agent Alignment Protocol and `detectIntegrityDrift` / `detect_integrity_drift` in the Agent Integrity Protocol). This change corrects every example across the docs so the code matches the actual SDK behavior: positional arguments, streaming per-checkpoint integrity calls, and flattened alert attributes.

## What Was Built

- Corrected `detectDrift` (TypeScript) and `detect_drift` (Python) call signatures in all quickstart and concept docs
- Corrected `detectIntegrityDrift` / `detect_integrity_drift` usage to the streaming `(state, checkpoint, window)` form that returns a `(state, alert)` pair per checkpoint
- Flattened alert attribute access — removed the non-existent `alert.analysis.*` nesting in favor of direct `alert.*` fields, and fixed TS camelCase fields (`agentId`, `driftDirection`, `similarityScore`, `sustainedTraces`)
- Synced the localized Spanish and French quickstart copies to match the English source

## Technical Implementation

### Files Modified

- `concepts/drift-detection.mdx`: Switched `detectDrift` to positional args (`detectDrift(card, traces, 0.30, 3)`); rewrote both Python and TypeScript integrity-drift examples to call `detect_integrity_drift` / `detectIntegrityDrift` per checkpoint with an explicit drift state and a sliding checkpoint window
- `guides/multi-agent-setup.mdx`: Replaced the object-style `detectDrift({ traces, card, ... })` call with the positional signature
- `protocols/aap/quickstart.mdx`: Changed `detect_drift(card_dict, traces)` to keyword args `detect_drift(traces=traces, card=card_dict)`; flattened `alert.analysis.*` to `alert.*` and replaced the per-indicator block with `alert.trace_ids`
- `protocols/aip/quickstart.mdx`: Rewrote the integrity-drift loop to call `detect_integrity_drift(state, checkpoint, manager.get_checkpoints())` inside the checkpoint loop and act on the returned per-checkpoint alert
- `quickstart/sdk-direct.mdx`: Fixed both Python and TypeScript `detect_drift` examples — keyword args for Python, and camelCase alert fields (`agentId`, `driftDirection`, `similarityScore`, `sustainedTraces`) for TypeScript
- `es/quickstart/sdk-direct.mdx`, `fr/quickstart/sdk-direct.mdx`: Applied the same `detect_drift`/`detectDrift` fixes to the localized quickstarts to keep them in sync with English

### Key Changes

- **Alignment drift call shape:** `detectDrift` now takes positional arguments `(card, traces, similarityThreshold, sustainedThreshold)` in TypeScript; the Python `detect_drift` example uses keyword arguments `traces=` and `card=`.
- **Integrity drift is streaming, not batched:** instead of adding all checkpoints and then calling `detect_integrity_drift(manager.get_state())` once, each checkpoint is passed through `detect_integrity_drift(state, checkpoint, window)`, which returns an updated `state` and an optional `alert` to handle immediately.
- **Drift state is threaded explicitly:** TypeScript uses `createDriftState()` and reassigns `driftState` each iteration; Python initializes `state = None` and reassigns it from the returned tuple.
- **Alert attributes are flat:** removed the `alert.analysis.*` indirection. Fields are accessed directly (`alert.drift_direction`, `alert.similarity_score`, `alert.sustained_traces`, `alert.trace_ids`), with camelCase variants in TypeScript.
- **Localization parity:** the Spanish and French SDK quickstarts were updated identically so translated examples don't drift from the corrected English source.

## How to Use

These are documentation-only corrections. To consume the updated examples:

1. Open the relevant quickstart or concept page (e.g. `quickstart/sdk-direct.mdx`, `concepts/drift-detection.mdx`).
2. For alignment drift, call `detectDrift(card, traces, 0.30, 3)` (TypeScript) or `detect_drift(traces=traces, card=card_dict)` (Python) and read alert fields directly off each `alert`.
3. For integrity drift, initialize a drift state, then for each checkpoint call `detect_integrity_drift(state, checkpoint, window)` / `detectIntegrityDrift(driftState, checkpoint, window)`, reassign the returned state, and handle the returned alert if present.

## Configuration

No configuration changes. The `similarityThreshold` (0.30) and `sustainedThreshold` (3) values shown in the alignment-drift example are illustrative call arguments, not environment settings.

## Testing

- Run the docs example checker: `npm run check:doc-examples` (validates the code samples embedded in the docs).
- Build/preview locally with Mintlify (`mintlify dev`) to confirm the MDX renders.
- Spot-check the modified pages — `concepts/drift-detection.mdx`, `guides/multi-agent-setup.mdx`, `protocols/aap/quickstart.mdx`, `protocols/aip/quickstart.mdx`, and the `quickstart/sdk-direct.mdx` set (en/es/fr) — to confirm code blocks match the SDK API.

## Notes

- This is a correctness fix for documentation only; no SDK or runtime code was changed.
- The localized `es/` and `fr/` quickstarts were kept in sync, but only the SDK-direct page was affected; if other translated pages contain drift-detection snippets they should be reviewed separately.
