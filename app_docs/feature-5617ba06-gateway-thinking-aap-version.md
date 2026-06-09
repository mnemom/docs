# Gateway Thinking Block Callout & AAP Version Sync to 1.0.0

**ADW ID:** 5617ba06
**Date:** 2026-06-09
**Plan-Spec:** agents/5617ba06/plan/issue-217-adw-5617ba06-gateway-thinking-aap-version-plan.md

## Overview

This change documents a behavioral detail of the Mnemom Gateway — proxied responses now include a `thinking` content element alongside the standard `text` block — and bumps the documented Alignment Card schema version (`aap_version`) from the pre-release `0.1.0` to the stable `1.0.0` across all protocol and quickstart docs. It is a documentation-only update that keeps the published examples and reference material aligned with the current gateway behavior and AAP schema version.

## What Was Built

- A `<Note>` callout in the Gateway quickstart explaining that extended-thinking output appears as a `thinking` element in the proxied response `content` array, and that clients assuming text-only content should handle or ignore it.
- A repo-wide synchronization of the documented `aap_version` field from `"0.1.0"` to `"1.0.0"` across the AAP specification, architecture, security, quickstart, MCP-migration, A2A-integration docs, the AIP quickstart, and the SDK-direct quickstart.

## Technical Implementation

### Files Modified

- `quickstart/gateway.mdx`: Added a `<Note>` block after the model-support table explaining `thinking` content elements in proxied responses and that thinking tokens are billed as standard output tokens (intentional, cannot be disabled).
- `protocols/aap/specification.mdx`: Updated the `aap_version` reference example (field table + sample card) to `1.0.0`.
- `protocols/aap/architecture.mdx`: Updated the `AlignmentCard` schema diagram's `aap_version` value to `1.0.0`.
- `protocols/aap/security.mdx`: Updated the crypto-suite versioning example to `1.0.0`.
- `protocols/aap/quickstart.mdx`: Updated both `AlignmentCard(...)` examples to `1.0.0`.
- `protocols/aap/mcp-migration.mdx`: Updated both `SERVER_ALIGNMENT` examples to `1.0.0`.
- `protocols/aap/a2a-integration.mdx`: Updated the Agent Card and user/vendor agent-card examples to `1.0.0`.
- `protocols/aip/quickstart.mdx`: Updated the Alignment Card example to `1.0.0`.
- `quickstart/sdk-direct.mdx`: Updated the Python and TypeScript `AlignmentCard` examples to `1.0.0`.

### Key Changes

- The only functional documentation addition is the Gateway `thinking` block callout; every other edit is a string version bump (`0.1.0` → `1.0.0`).
- The version sync spans both JSON examples (`"aap_version": "1.0.0"`) and SDK code (Python `aap_version="1.0.0"`, TypeScript `aap_version: '1.0.0'`), keeping all language variants consistent.
- The Gateway note clarifies a client-compatibility concern: response `content` arrays may now contain a `thinking` element, so text-only consumers must be updated to handle or skip it.
- The note also documents the billing contract: thinking output tokens are billed as standard output tokens, and this behavior is intentional and cannot be disabled.

## How to Use

This is reference documentation; readers consume it as follows:

1. When integrating with the Mnemom Gateway, review the Gateway quickstart and account for `thinking` content elements in proxied responses.
2. When authoring an Alignment Card, use `aap_version: "1.0.0"` as shown in the updated examples.
3. Update any client code that assumes text-only content arrays to handle or ignore `thinking` blocks.

## Configuration

No configuration options are introduced. Note that the gateway's thinking behavior cannot be disabled — thinking output is intrinsic to Safe House / AIP real-time reasoning analysis.

## Testing

As a Mintlify docs change, verify with the project's docs tooling:

- Run the Mintlify build / link check (e.g. `mintlify dev` locally or the Mintlify Docs CI) to confirm the MDX renders and the `<Note>` component is valid.
- Confirm no remaining `0.1.0` references remain in the AAP/AIP docs: `git grep '0\.1\.0' protocols quickstart`.

## Notes

- Documentation-only change; no application code or runtime behavior is modified by these edits — they describe existing gateway behavior and the current AAP schema version.
- The `thinking` element appears only for reasoning-capable models routed through the gateway; non-reasoning models surface a synthetic clear verdict and legacy OpenAI reasoning models are unsupported, per the model-support table.
