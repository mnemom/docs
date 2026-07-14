/**
 * openapi-slice.mjs — Pure OpenAPI customer-slice normalization + diff core.
 *
 * The committed `api-reference/openapi.json` is a snapshot of the deployed
 * customer-facing slice (`GET https://api.mnemom.ai/openapi.json`). Two
 * callers depend on the SAME definition of "the committed slice":
 *
 *   1. `scripts/sync-openapi.mjs` — writes the file (and CI git-diffs it in
 *      `.github/workflows/openapi-freshness.yml`, the Monday freshness gate).
 *   2. `scripts/check-slice-freshness.mjs` — the read-only drift check that
 *      revalidates the committed slice against the live surface for PRs the
 *      Monday gate's narrow trigger would otherwise miss.
 *
 * This module owns that ONE normalization so the two callers can never
 * disagree: the staff-leak guard, the `components.schemas` alphabetical
 * sort, the exact serialized byte string, and the pure path/op diff.
 *
 * Pure functions, no side effects, no global state, no network, no
 * `process`, no `fs`. The CLIs do all I/O and wrap these; tests drive them
 * directly with in-memory fixtures.
 *
 * ── Counter semantics (MNE-438) ─────────────────────────────────────────
 * `diffSlices` buckets every path into exactly one of added / removed /
 * changed / unchanged (mutually exclusive):
 *
 *   - `pathsAdded`   — path present in LIVE but not in COMMITTED.
 *   - `pathsRemoved` — path present in COMMITTED but not in LIVE.
 *   - `pathsChanged` — path present in BOTH, but its serialized path-item
 *                      object differs (a method/summary/schema change).
 *   - unchanged      — path present in BOTH and byte-identical → counted in
 *                      NONE of the above.
 *
 * `opsAdded` = sum of HTTP methods (get/put/post/delete/patch) across the
 * `pathsAdded` paths only (live side). `opsRemoved` = the same across the
 * `pathsRemoved` paths only (committed side). Operations INSIDE a
 * `pathsChanged` path are counted in NEITHER op counter — the path-level
 * `pathsChanged` signal is what a maintainer acts on; a path that merely
 * gains a new HTTP method (GET → GET + POST) is reported as
 * `pathsChanged = 1, opsAdded = 0`, not as an added op. This keeps the
 * `(ops +A / -R)` summary honest: it counts ops on whole paths that
 * appeared or vanished, never per-method churn inside a surviving path.
 */

// HTTP operation verbs an OpenAPI path-item object may carry.
const HTTP_METHODS = ["get", "put", "post", "delete", "patch"];

// Mirrors the staff-leak guard in `scripts/sync-openapi.mjs`: the served
// slice must be customer-only (mnemom-api filters staff paths server-side
// per ADR-054 — no /admin, /arena, /internal, /sonar, /rb2b, /v1/internal).
const STAFF_PATH = /^\/(admin|arena|internal|sonar|rb2b)\/|^\/v1\/internal\//;

/**
 * Throw a labeled error if the slice leaks staff paths. Fails LOUDLY rather
 * than letting a staff surface be committed or compared as "customer". The
 * thrown error carries the offending paths on `.leaked` so a caller can
 * render them. Returns the (unmodified) spec on success for chaining.
 */
export function assertCustomerOnly(spec) {
  const leaked = Object.keys(spec?.paths || {}).filter((p) => STAFF_PATH.test(p));
  if (leaked.length) {
    const err = new Error(
      `refusing — staff paths in served slice: ${leaked.join(", ")}`,
    );
    err.leaked = leaked;
    throw err;
  }
  return spec;
}

/**
 * Return a copy of the spec with `components.schemas` sorted alphabetically
 * — the one mutation `sync-openapi.mjs` applies before writing. Pure: the
 * input object is never mutated (a shallow copy is returned, and the
 * `components` / `schemas` sub-objects are rebuilt). Specs without
 * `components.schemas` are returned as-is.
 */
export function normalizeSlice(spec) {
  if (!spec?.components?.schemas) return spec;
  const schemas = Object.fromEntries(
    Object.entries(spec.components.schemas).sort(([a], [b]) => a.localeCompare(b)),
  );
  return { ...spec, components: { ...spec.components, schemas } };
}

/**
 * Return the EXACT committed-file byte string for a spec:
 * `JSON.stringify(normalizeSlice(spec), null, 2) + "\n"`. This is the single
 * source of truth for the committed bytes — `sync-openapi.mjs` writes it and
 * `diffSlices` compares it, so the drift check can never disagree with the
 * `git diff --exit-code` in `openapi-freshness.yml`.
 */
export function serializeSlice(spec) {
  return JSON.stringify(normalizeSlice(spec), null, 2) + "\n";
}

// Count the HTTP operations declared on a single path-item object.
function countOps(pathItem) {
  if (!pathItem || typeof pathItem !== "object") return 0;
  return HTTP_METHODS.filter((m) => pathItem[m]).length;
}

/**
 * Compare a committed spec against a live spec, purely.
 *
 * Returns `{ pathsAdded, pathsRemoved, pathsChanged, opsAdded, opsRemoved,
 * byteEqual, summaryLine }`. See the module header for counter semantics.
 *
 * `byteEqual` = `serializeSlice(committedSpec) === serializeSlice(liveSpec)`
 * — the boolean drift verdict that matches `openapi-freshness.yml`'s
 * git-diff semantics exactly (true ⇔ no drift ⇔ 0/0/0).
 *
 * This function assumes BOTH specs are real parsed objects with a non-empty
 * `paths`; the CLI validates that first (MNE-442) so an empty live spec is
 * NEVER silently rendered here as "everything removed".
 */
export function diffSlices(committedSpec, liveSpec) {
  const committedPaths = committedSpec?.paths || {};
  const livePaths = liveSpec?.paths || {};
  const committedKeys = Object.keys(committedPaths);
  const liveKeys = Object.keys(livePaths);
  const committedSet = new Set(committedKeys);
  const liveSet = new Set(liveKeys);

  const addedKeys = liveKeys.filter((k) => !committedSet.has(k));
  const removedKeys = committedKeys.filter((k) => !liveSet.has(k));
  const changedKeys = liveKeys.filter(
    (k) =>
      committedSet.has(k) &&
      JSON.stringify(livePaths[k]) !== JSON.stringify(committedPaths[k]),
  );

  const pathsAdded = addedKeys.length;
  const pathsRemoved = removedKeys.length;
  const pathsChanged = changedKeys.length;
  // opsAdded/opsRemoved count ops on WHOLE added/removed paths only — ops
  // inside a changed path are deliberately counted in neither (MNE-438).
  const opsAdded = addedKeys.reduce((n, k) => n + countOps(livePaths[k]), 0);
  const opsRemoved = removedKeys.reduce((n, k) => n + countOps(committedPaths[k]), 0);

  const byteEqual = serializeSlice(committedSpec) === serializeSlice(liveSpec);

  const summaryLine =
    `committed-slice vs live: ${pathsAdded} paths added / ${pathsRemoved} removed / ` +
    `${pathsChanged} changed (ops +${opsAdded} / -${opsRemoved})`;

  return {
    pathsAdded,
    pathsRemoved,
    pathsChanged,
    opsAdded,
    opsRemoved,
    byteEqual,
    summaryLine,
  };
}
