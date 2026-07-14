/**
 * probe-docs-origin-edge.test.mjs — regression suite for the origin-vs-edge
 * attribution core (`scripts/lib/origin-edge-attribution.mjs`).
 *
 * Drives `classifyAttribution` with mocked observation objects — NO live
 * network. Reproduces incident 980582706 (origin 403 faithfully proxied by
 * a healthy Cloudflare edge → `origin-fault`) and the failure-mode edges,
 * including the cold-start/no-data path that must never report `healthy`.
 *
 * Header fixtures use obvious placeholders (MNE-339) — no real / real-
 * looking credential-shaped values.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyAttribution,
  hasCloudflareEdgeMarkers,
  hasOriginMarkers,
} from "./lib/origin-edge-attribution.mjs";

// Placeholder header fixtures (MNE-339 — not real credentials).
const CF_MARKERS = { "cf-ray": "dummy-cf-ray", "cf-cache-status": "DYNAMIC" };
const VERCEL_MARKERS = { "x-vercel-id": "iad1::dummy", server: "Vercel" };

// ── classifyAttribution: verdict branches ───────────────────────────────

test("incident reproduction: origin 403 proxied through a healthy edge → origin-fault", () => {
  const result = classifyAttribution({
    edge: { ok: false, status: 403, headers: CF_MARKERS },
    origin: { ok: false, status: 403, headers: VERCEL_MARKERS },
  });
  assert.equal(result.verdict, "origin-fault");
  assert.equal(result.confidence, "high");
  assert.equal(result.edgeHealthy, false);
  assert.equal(result.originHealthy, false);
  // Payload is self-explaining: supporting headers echo the drivers.
  assert.equal(result.supportingHeaders.edge["cf-ray"], "dummy-cf-ray");
  assert.equal(result.supportingHeaders.edge.status, 403);
  assert.equal(result.supportingHeaders.origin.status, 403);
});

test("edge fault: edge network error / timeout while origin-direct ok → edge-fault", () => {
  const result = classifyAttribution({
    edge: { ok: false, status: null, headers: {}, error: "timeout after 8000ms" },
    origin: { ok: true, status: 200, headers: VERCEL_MARKERS },
  });
  assert.equal(result.verdict, "edge-fault");
  assert.equal(result.confidence, "high");
  assert.equal(result.edgeHealthy, false);
  assert.equal(result.originHealthy, true);
  assert.equal(result.supportingHeaders.edge.error, "timeout after 8000ms");
});

test("edge fault: edge 502 with no Cloudflare markers while origin-direct ok → edge-fault", () => {
  const result = classifyAttribution({
    edge: { ok: false, status: 502, headers: {} },
    origin: { ok: true, status: 200, headers: VERCEL_MARKERS },
  });
  assert.equal(result.verdict, "edge-fault");
  assert.equal(result.originHealthy, true);
});

test("edge fault: edge 503 with CF markers while origin-direct ok → edge-fault (high, CF-marker reason)", () => {
  const result = classifyAttribution({
    edge: { ok: false, status: 503, headers: CF_MARKERS },
    origin: { ok: true, status: 200, headers: VERCEL_MARKERS },
  });
  assert.equal(result.verdict, "edge-fault");
  assert.equal(result.confidence, "high");
  assert.match(result.reason, /the edge returned a failure/i);
});

test("healthy: edge 200 + origin 200 → healthy", () => {
  const result = classifyAttribution({
    edge: { ok: true, status: 200, headers: CF_MARKERS },
    origin: { ok: true, status: 200, headers: VERCEL_MARKERS },
  });
  assert.equal(result.verdict, "healthy");
  assert.equal(result.confidence, "high");
  assert.equal(result.edgeHealthy, true);
  assert.equal(result.originHealthy, true);
});

test("both-down: edge 502 (CF markers) + origin 503 diverging statuses → both-down", () => {
  const result = classifyAttribution({
    edge: { ok: false, status: 502, headers: CF_MARKERS },
    origin: { ok: false, status: 503, headers: VERCEL_MARKERS },
  });
  assert.equal(result.verdict, "both-down");
  assert.equal(result.confidence, "high");
  assert.equal(result.edgeHealthy, false);
  assert.equal(result.originHealthy, false);
});

test("both-down mixed: edge 502 (HTTP) + origin network error (status null) diverge → both-down", () => {
  const result = classifyAttribution({
    edge: { ok: false, status: 502, headers: CF_MARKERS },
    origin: { ok: false, status: null, headers: {}, error: "getaddrinfo ENOTFOUND" },
  });
  assert.equal(result.verdict, "both-down");
  assert.equal(result.supportingHeaders.origin.error, "getaddrinfo ENOTFOUND");
});

test("edge-ok but origin failing (possible stale cache) → origin-fault (medium)", () => {
  const result = classifyAttribution({
    edge: { ok: true, status: 200, headers: CF_MARKERS },
    origin: { ok: false, status: 403, headers: VERCEL_MARKERS },
  });
  assert.equal(result.verdict, "origin-fault");
  assert.equal(result.confidence, "medium");
  assert.equal(result.edgeHealthy, true);
  assert.equal(result.originHealthy, false);
  assert.match(result.reason, /cached/i);
});

test("cold-start / no-data: origin-direct not probed → indeterminate, never healthy", () => {
  const result = classifyAttribution({
    edge: { ok: true, status: 200, headers: CF_MARKERS },
    origin: null,
  });
  assert.equal(result.verdict, "indeterminate");
  assert.notEqual(result.verdict, "healthy");
  assert.equal(result.confidence, "low");
  assert.match(result.reason, /escalate manually/i);
});

test("edge failing + origin not probed → indeterminate, never healthy", () => {
  const result = classifyAttribution({
    edge: { ok: false, status: 403, headers: CF_MARKERS },
    origin: null,
  });
  assert.equal(result.verdict, "indeterminate");
  assert.match(result.reason, /escalate manually/i);
});

test("matching failure status but NO Cloudflare markers → indeterminate (cannot confirm proxy)", () => {
  const result = classifyAttribution({
    edge: { ok: false, status: 403, headers: {} },
    origin: { ok: false, status: 403, headers: VERCEL_MARKERS },
  });
  assert.equal(result.verdict, "indeterminate");
  assert.match(result.reason, /no Cloudflare markers/i);
});

test("edge not probed at all → indeterminate", () => {
  const result = classifyAttribution({
    edge: null,
    origin: { ok: true, status: 200, headers: VERCEL_MARKERS },
  });
  assert.equal(result.verdict, "indeterminate");
});

test("observedAt is echoed through to the verdict", () => {
  const result = classifyAttribution({
    edge: { ok: true, status: 200, headers: CF_MARKERS },
    origin: { ok: true, status: 200, headers: VERCEL_MARKERS },
    observedAt: "2026-07-14T00:00:00.000Z",
  });
  assert.equal(result.observedAt, "2026-07-14T00:00:00.000Z");
});

// ── Header helpers ───────────────────────────────────────────────────────

test("hasCloudflareEdgeMarkers: true on cf-ray or cf-cache-status, false otherwise", () => {
  assert.equal(hasCloudflareEdgeMarkers({ "cf-ray": "dummy-cf-ray" }), true);
  assert.equal(hasCloudflareEdgeMarkers({ "cf-cache-status": "HIT" }), true);
  // Case-insensitive.
  assert.equal(hasCloudflareEdgeMarkers({ "CF-Ray": "dummy-cf-ray" }), true);
  assert.equal(hasCloudflareEdgeMarkers({ server: "Vercel" }), false);
  assert.equal(hasCloudflareEdgeMarkers({}), false);
  assert.equal(hasCloudflareEdgeMarkers(null), false);
});

test("hasOriginMarkers: true on x-vercel-id or non-Cloudflare server, false on Cloudflare", () => {
  assert.equal(hasOriginMarkers({ "x-vercel-id": "iad1::dummy" }), true);
  assert.equal(hasOriginMarkers({ server: "Vercel" }), true);
  assert.equal(hasOriginMarkers({ server: "cloudflare" }), false);
  assert.equal(hasOriginMarkers({}), false);
  assert.equal(hasOriginMarkers(null), false);
});
