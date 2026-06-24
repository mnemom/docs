/**
 * staff-surface.mjs — canonical staff/internal surface definition (ADR-054).
 *
 * Mirror of `mnemom-api openapi/customer-facing.ts::{STAFF_PREFIXES,STAFF_PATHS}`.
 * Single source of truth for both the doc-example walker (check-doc-examples.mjs)
 * and the OpenAPI slice syncer (sync-openapi.mjs). Update here when mnemom-api
 * adds a new internal namespace; the change propagates to both consumers automatically.
 *
 * Note: doc paths arriving here are normalized with the `/v1` base stripped, so
 * `/internal/` covers the `/v1/internal/` variant. STAFF_PREFIXES includes both
 * forms for robustness against un-normalized paths (e.g. raw spec keys).
 */

export const STAFF_PREFIXES = ["/admin/", "/arena/", "/internal/", "/v1/internal/", "/sonar/", "/rb2b/"];

export const STAFF_PATHS = new Set([
  "/auth/send-email-hook",
  "/billing/webhooks/stripe",
  "/contact/notify",
  "/on-chain/anchor-root",
  "/on-chain/publish-scores",
  "/health",
]);

/**
 * Returns true if `path` belongs to the staff/internal surface.
 * Covers both prefix-based namespaces (STAFF_PREFIXES) and exact-path
 * entries (STAFF_PATHS) — both dimensions of the staff surface.
 */
export function isStaffPath(path) {
  if (STAFF_PATHS.has(path)) return true;
  return STAFF_PREFIXES.some((pre) => path.startsWith(pre));
}
