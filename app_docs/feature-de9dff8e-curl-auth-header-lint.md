# Curl Auth-Header Lint for Doc-as-Spec Walker (T5-1.5)

**ADW ID:** de9dff8e
**Date:** 2026-06-29
**Plan-Spec:** N/A

## Overview

This feature extends the doc-as-spec CI walker (`scripts/check-doc-examples.mjs`) with a new lint layer (T5-1.5) that verifies every curl example targeting a secured API endpoint includes at least one authentication header matching the endpoint's declared OpenAPI security scheme. Alongside the new lint rule, eleven documentation files were corrected to carry the required auth headers they were previously missing.

## What Was Built

- **T5-1.5 auth-header lint layer** in `check-doc-examples.mjs` that checks curl examples against each operation's declared OpenAPI `security` requirements
- **`--no-auth` CLI flag** to skip auth-header validation (path + method + body only)
- **`KNOWN_AUTH_DRIFT` allowlist** (same shape as existing `KNOWN_DRIFT`) for pre-existing violations that cannot be fixed in the same PR
- **Stale allowlist detection** for `KNOWN_AUTH_DRIFT` entries that no longer match any curl
- **Summary line updates** to include auth check counts in pass/fail output
- **11 MDX doc fixes** adding missing `-H "Authorization: Bearer $TOKEN"` (or appropriate scheme header) to curl examples across concepts, guides, gateway, and protocol docs

## Technical Implementation

### Files Modified

- `scripts/check-doc-examples.mjs`: Core lint script — added T5-1.5 auth-header check (~120 lines net new): `effectiveOpSecurity()`, `headerSatisfiesScheme()`, `KNOWN_AUTH_DRIFT` allowlist, `knownAuthDriftEntry()`, auth check loop inside the main curl-walking loop, and stale-entry detection
- `concepts/agent-identity.mdx`: Added `Authorization: Bearer $TOKEN` to two curl examples (new/legacy agent ID fetch)
- `concepts/card-composition.mdx`: Added auth header to three curl examples (composition, sources, effective sub-resource)
- `for-agents/index.mdx`: Added auth header to agent-registration `POST /v1/agents` example
- `gateway/enforcement.mdx`: Added auth header to three `PUT /v1/agents/:id/settings` examples
- `guides/observability-setup.mdx`: Added auth header to three SSE stream curl examples
- `guides/card-composition.mdx`: Replaced `X-Mnemom-Api-Key` with `Authorization: Bearer` on agents list example
- `guides/gdpr-data-subject-rights.mdx`: Replaced `X-Mnemom-Api-Key` with `Authorization: Bearer` on org DELETE example
- `guides/improving-reputation.mdx`: Added auth header to two integrity stats curl examples
- `guides/team-management.mdx`: Added auth header to two team reputation curl examples
- `guides/trust-recovery.mdx`: Replaced `X-Mnemom-Api-Key` with `Authorization: Bearer` on webhook POST example
- `protocols/aap/reputation-methodology.mdx`: Added auth header to checkpoints fetch example

### Key Changes

- **Security scheme resolution** (`effectiveOpSecurity`): uses the operation-level `security` field if present, falling back to the spec-level `security` global; treats `security: []` and `security: [{}]` (empty-object alternative) as public endpoints that are skipped
- **Scheme matching** (`headerSatisfiesScheme`): handles `http/bearer` (case-insensitive `Authorization: Bearer <token>`) and `apiKey/header` (header name match from `def.name`) via OR semantics across all declared schemes
- **OR semantics**: any one of the operation's declared schemes satisfies the check; the lint fails only if none are present
- **Actionable error output**: on failure, prints the declared scheme names, the exact `-H` flag to add, and the offending curl snippet
- **`KNOWN_AUTH_DRIFT` starts empty**: all current examples were corrected in this PR; the allowlist exists as a safety valve for future incremental work

## How to Use

1. Run the existing lint script — auth checks are on by default:
   ```bash
   node scripts/check-doc-examples.mjs
   ```
2. To skip auth-header validation (path + method + body only):
   ```bash
   node scripts/check-doc-examples.mjs --no-auth
   ```
3. If CI surfaces a pre-existing curl that cannot be fixed immediately, add it to `KNOWN_AUTH_DRIFT` in `scripts/check-doc-examples.mjs`:
   ```js
   const KNOWN_AUTH_DRIFT = [
     { file: "guides/example.mdx", method: "get", path: "/v1/some/path", owner: "team-name" },
   ];
   ```
4. Remove stale `KNOWN_AUTH_DRIFT` entries when warned by the stale-entry detector.

## Configuration

No new environment variables or configuration files. The `--no-auth` flag is the only opt-out mechanism. The `KNOWN_AUTH_DRIFT` constant in `scripts/check-doc-examples.mjs` serves as the allowlist for known pre-existing drift.

## Testing

Run the doc-as-spec walker:
```bash
node scripts/check-doc-examples.mjs --verbose
```

The summary line now includes auth check counts, e.g.:
```
✓ 42 curl example(s) match a documented endpoint; … 18 auth-header(s) checked; 0 known auth-drift allowlisted.
```

Confirm `authFailures.length === 0` in CI output, and that `authChecked` is non-zero (proving the check ran against real secured operations).

## Notes

- Public endpoints (`security: []` or an OR-list containing an empty object `{}`) are correctly skipped — the lint only targets operations that require authentication.
- The three canonical scheme hints printed in failure messages (`Authorization: Bearer $TOKEN`, `X-Mnemom-Api-Key: $KEY`, `X-Mnemom-Agent-Proof: $KEY`) are derived dynamically from `spec.components.securitySchemes`, so they stay accurate as the OpenAPI spec evolves.
- Some doc examples previously used `X-Mnemom-Api-Key` on endpoints whose spec declares `BearerAuth`; these were corrected to `Authorization: Bearer $TOKEN` as part of this PR.
