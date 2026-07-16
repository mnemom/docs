/**
 * Shared spec loader — ADR-054.
 *
 * The customer-facing OpenAPI document is served live from
 * `https://api.mnemom.ai/openapi.json`. ADR-054's canonical intent is the
 * **committed-snapshot** one: `api-reference/openapi.json` is committed and is
 * the source of truth for `generate-api-reference.mjs` and
 * `check-internal-refs.mjs`; `scripts/sync-openapi.mjs` re-syncs it from the
 * live surface and `.github/workflows/openapi-freshness.yml` git-diffs it, so
 * drift is DETECTED (see also `scripts/check-slice-freshness.mjs`), not
 * "impossible by construction". Scripts read the spec through `loadSpec()`
 * here, which:
 *
 *   1. If `OPENAPI_SPEC_PATH` env var is set, reads that local file.
 *      Used by CI workflows that want to validate against a specific
 *      build (e.g., a PR-deployed mnemom-api preview).
 *   2. Otherwise fetches `OPENAPI_SPEC_URL` (default
 *      https://api.mnemom.ai/openapi.json) and parses the JSON.
 *
 * Returns a Promise<object>. Callers awaiting at top-level need their
 * file to be an ESM .mjs (which all our scripts already are).
 */
import { existsSync, readFileSync } from "node:fs";

const DEFAULT_URL = "https://api.mnemom.ai/openapi.json";

export async function loadSpec() {
  const localPath = process.env.OPENAPI_SPEC_PATH;
  if (localPath) {
    if (!existsSync(localPath)) {
      throw new Error(
        `OPENAPI_SPEC_PATH=${localPath} was set but the file does not exist.`,
      );
    }
    return JSON.parse(readFileSync(localPath, "utf8"));
  }

  const url = process.env.OPENAPI_SPEC_URL || DEFAULT_URL;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch OpenAPI spec from ${url}: ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}
