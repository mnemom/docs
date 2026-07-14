/**
 * origin-edge-attribution.mjs — Pure origin-vs-edge attribution core.
 *
 * Captures the manual triage that incident 980582706 (engagement
 * E-e9bb436b) had to do by hand: a Mintlify SaaS *origin* returned
 * `403 Forbidden` for docs.mnemom.ai while the Cloudflare *edge* was
 * healthy and faithfully proxying that 403 to clients. Diagnosis cost
 * ≈5.5 min of hand-separating a healthy edge from a broken origin. This
 * module encodes that classification once so any caller (a responder at
 * the terminal, or later ops-responder/CI) gets the attribution for free.
 *
 * Pure functions, no side effects, no global state, no network, no
 * `process`. The CLI wrapper (`scripts/probe-docs-origin-edge.mjs`) does
 * all network I/O and wraps these with its own exit-code contract; tests
 * drive `classifyAttribution` directly with mocked observation objects.
 *
 * ── Observation object shape ────────────────────────────────────────────
 * `classifyAttribution` consumes plain observation objects (never live
 * `Response`s), one for the `edge` probe and one for the `origin` probe:
 *
 *   { ok, status, headers, error }
 *
 *   - `ok`     — boolean; true for a 2xx/3xx response, false otherwise.
 *   - `status` — HTTP status number, OR `null` for a network error
 *                (timeout, DNS failure, connection refused). Network
 *                errors are ALWAYS normalized to the `status: null`
 *                sentinel so a "one side HTTP error, other side network
 *                error" pair is detected as diverging statuses rather than
 *                silently collapsing into `indeterminate`.
 *   - `headers`— plain object of the response headers the classifier reads
 *                (`cf-ray`, `cf-cache-status`, `x-vercel-id`, `server`).
 *                Lookups are case-insensitive.
 *   - `error`  — network-error message string when the request never got
 *                an HTTP response, else absent/null.
 *
 * A `null`/`undefined` observation (or one carrying no `ok`, `status`, or
 * `error` signal at all) means that side was NOT probed — its health is
 * UNKNOWN, which classifies as `indeterminate`, never `healthy`. This is
 * distinct from a network error, which IS an observation (the side is
 * unreachable — a data point).
 */

// ── Header helpers ──────────────────────────────────────────────────────
// Case-insensitive header lookup — CLI callers lowercase keys, but keep the
// helpers robust to any casing so fixtures/tests stay readable.
function pick(headers, name) {
  if (!headers || typeof headers !== "object") return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

const present = (v) => v !== undefined && v !== null && String(v).trim() !== "";

/**
 * True when the response carries Cloudflare edge markers — `cf-ray` or
 * `cf-cache-status`. Their presence is the signal that the response
 * actually transited the Cloudflare edge (so an origin failure proxied
 * through it can be attributed to the origin, not the edge).
 */
export function hasCloudflareEdgeMarkers(headers) {
  return present(pick(headers, "cf-ray")) || present(pick(headers, "cf-cache-status"));
}

/**
 * True when the response looks like it came from the Mintlify/Vercel
 * origin — an `x-vercel-id` header, or a `server` header that is NOT
 * Cloudflare (a bare origin response would not be served by `cloudflare`).
 */
export function hasOriginMarkers(headers) {
  if (present(pick(headers, "x-vercel-id"))) return true;
  const server = pick(headers, "server");
  return present(server) && !String(server).toLowerCase().includes("cloudflare");
}

// ── Observation predicates ──────────────────────────────────────────────
// A side was actually probed (its health is KNOWN) when the observation
// carries an `ok` boolean, a status, or a network error. A missing/empty
// observation means the side was not attempted → health unknown.
function isObserved(obs) {
  return (
    obs != null &&
    typeof obs === "object" &&
    (typeof obs.ok === "boolean" || obs.status != null || present(obs.error))
  );
}

const isHealthy = (obs) => obs != null && obs.ok === true;

// Two statuses "match" only when BOTH are concrete HTTP codes and equal.
// A network error (status null) never matches — mixed network-error /
// HTTP-error pairs therefore count as diverging (→ both-down), never a
// clean proxied-through (→ origin-fault).
const statusesMatch = (edge, origin) =>
  typeof edge?.status === "number" &&
  typeof origin?.status === "number" &&
  edge.status === origin.status;

// ── supportingHeaders — self-explaining evidence for the verdict ─────────
function collectSupportingHeaders(edge, origin) {
  const side = (obs, keys) => {
    const out = {};
    if (obs?.status != null) out.status = obs.status;
    if (present(obs?.error)) out.error = obs.error;
    for (const key of keys) {
      const value = pick(obs?.headers, key);
      if (present(value)) out[key] = value;
    }
    return out;
  };
  return {
    edge: side(edge, ["cf-ray", "cf-cache-status", "server"]),
    origin: side(origin, ["x-vercel-id", "server"]),
  };
}

function verdict(name, confidence, edge, origin, reason, observedAt) {
  return {
    verdict: name,
    confidence,
    edgeHealthy: isHealthy(edge),
    originHealthy: isHealthy(origin),
    reason,
    supportingHeaders: collectSupportingHeaders(edge, origin),
    observedAt: observedAt ?? null,
  };
}

/**
 * Classify a docs outage as an origin fault, an edge/DNS fault, both down,
 * or indeterminate, from an `edge` and an `origin` observation.
 *
 * Fails CLOSED on ambiguity: any non-`healthy` verdict is a caller-side
 * exit-1 signal, and a side with unknown health is NEVER reported as
 * `healthy`.
 *
 * Every branch is enumerated explicitly (MNE-438/MNE-439/MNE-442):
 *   - `healthy`        — edge ok AND origin ok.
 *   - `origin-fault`   — (incident) edge failing + Cloudflare markers +
 *                        edge status equals origin status + that status is
 *                        a failure: the edge faithfully proxies an origin
 *                        failure. High confidence.
 *   - `origin-fault`   — edge ok (2xx/3xx) but origin failing: the origin
 *                        is broken though the edge appears healthy — the
 *                        edge may be serving a stale cache hit. Medium
 *                        confidence (the more actionable label than a
 *                        silent `indeterminate`).
 *   - `edge-fault`     — edge errored/timed out or returned a failure while
 *                        origin-direct is ok: the edge/DNS layer is at
 *                        fault.
 *   - `both-down`      — edge failure AND origin failure with diverging
 *                        statuses (including a mixed network-error /
 *                        HTTP-error pair) — not a clean proxied-through.
 *   - `indeterminate`  — insufficient signal (a side not probed, or both
 *                        failing with matching status but no Cloudflare
 *                        markers to confirm a proxied-through). Escalate
 *                        manually; never reported as `healthy`.
 */
export function classifyAttribution({ edge, origin, observedAt } = {}) {
  const edgeObserved = isObserved(edge);
  const originObserved = isObserved(origin);
  const edgeHealthy = isHealthy(edge);
  const originHealthy = isHealthy(origin);

  // No edge signal at all — cannot assess. Fail closed.
  if (!edgeObserved) {
    return verdict(
      "indeterminate",
      "low",
      edge,
      origin,
      "edge was not probed — attribution indeterminate, escalate manually",
      observedAt,
    );
  }

  // Both sides healthy.
  if (edgeHealthy && originHealthy) {
    return verdict(
      "healthy",
      "high",
      edge,
      origin,
      "edge and origin both returned a healthy status",
      observedAt,
    );
  }

  // Edge healthy but origin failing — origin is broken though the edge
  // still serves 2xx/3xx (a CDN may serve a cached 200 for a short window
  // after the origin starts failing). More actionable than indeterminate.
  if (edgeHealthy && originObserved && !originHealthy) {
    return verdict(
      "origin-fault",
      "medium",
      edge,
      origin,
      "origin-direct is failing while the edge still returns a healthy status — the edge may be serving a cached response; treat the origin as the fault",
      observedAt,
    );
  }

  // Edge healthy but origin unknown — cannot confirm origin health.
  if (edgeHealthy && !originObserved) {
    return verdict(
      "indeterminate",
      "low",
      edge,
      origin,
      "edge is healthy but origin-direct was not probed — origin health unknown, escalate manually",
      observedAt,
    );
  }

  // ── From here the edge is NOT healthy. ──────────────────────────────
  // Edge broken while origin-direct is ok → the edge/DNS layer is at fault.
  if (originObserved && originHealthy) {
    const marker = hasCloudflareEdgeMarkers(edge?.headers)
      ? "the edge returned a failure"
      : "the edge request errored/returned a failure with no Cloudflare markers";
    return verdict(
      "edge-fault",
      "high",
      edge,
      origin,
      `${marker} while origin-direct is healthy — the edge/DNS layer is at fault`,
      observedAt,
    );
  }

  // Edge broken and origin unknown — cannot attribute. Fail closed.
  if (!originObserved) {
    return verdict(
      "indeterminate",
      "low",
      edge,
      origin,
      "edge is failing but origin-direct was not probed — origin health unknown, escalate manually",
      observedAt,
    );
  }

  // ── Edge broken AND origin broken (both observed). ──────────────────
  if (statusesMatch(edge, origin)) {
    // Matching failure status. If Cloudflare markers confirm the response
    // transited the edge, the edge is faithfully proxying an origin
    // failure — the incident case.
    if (hasCloudflareEdgeMarkers(edge?.headers)) {
      return verdict(
        "origin-fault",
        "high",
        edge,
        origin,
        `edge and origin both returned ${edge.status} with Cloudflare markers present — the edge is faithfully proxying an origin failure`,
        observedAt,
      );
    }
    // Matching status but no Cloudflare markers to confirm a proxy — cannot
    // distinguish origin-fault from a coincidental double failure.
    return verdict(
      "indeterminate",
      "low",
      edge,
      origin,
      `edge and origin both returned ${edge.status} but no Cloudflare markers are present to confirm a proxied-through — attribution indeterminate, escalate manually`,
      observedAt,
    );
  }

  // Statuses diverge (including a mixed network-error / HTTP-error pair) —
  // not a clean proxied-through; both layers are impaired.
  return verdict(
    "both-down",
    "high",
    edge,
    origin,
    "edge and origin are both failing with diverging statuses (including mixed network-error/HTTP-error) — not a clean proxied-through; both layers are impaired",
    observedAt,
  );
}
