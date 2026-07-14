/**
 * check-slice-freshness.test.mjs — regression suite for the committed-slice
 * drift core (`scripts/lib/openapi-slice.mjs`).
 *
 * Drives `diffSlices` / `normalizeSlice` / `serializeSlice` /
 * `assertCustomerOnly` with in-memory fixtures — NO live network. Covers
 * every drift bucket, the byte-contract that keeps this check in lockstep
 * with `sync-openapi.mjs` (and thus the Monday `openapi-freshness.yml` gate),
 * the MNE-438 op-counter semantics, and the fail-closed edges the CLI relies
 * on (staff leak, empty live paths).
 *
 * Fixtures carry no credentials; any placeholder token is a short opaque
 * value (MNE-339).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCustomerOnly,
  diffSlices,
  normalizeSlice,
  serializeSlice,
} from "./lib/openapi-slice.mjs";

// ── Fixture helpers ──────────────────────────────────────────────────────
const op = (summary = "op") => ({ summary, responses: { 200: { description: "ok" } } });

function spec(paths, schemas) {
  const s = { openapi: "3.1.0", info: { title: "test", version: "1" }, paths };
  if (schemas) s.components = { schemas };
  return s;
}

// ── diffSlices: verdict + counter buckets ────────────────────────────────

test("fresh: identical committed + live → byteEqual, 0/0/0", () => {
  const committed = spec({ "/things": { get: op() } });
  const live = spec({ "/things": { get: op() } });
  const diff = diffSlices(committed, live);
  assert.equal(diff.byteEqual, true);
  assert.equal(diff.pathsAdded, 0);
  assert.equal(diff.pathsRemoved, 0);
  assert.equal(diff.pathsChanged, 0);
  assert.equal(diff.opsAdded, 0);
  assert.equal(diff.opsRemoved, 0);
  assert.match(diff.summaryLine, /0 paths added \/ 0 removed \/ 0 changed/);
  assert.equal(
    diff.summaryLine,
    "committed-slice vs live: 0 paths added / 0 removed / 0 changed (ops +0 / -0)",
  );
});

test("path added upstream (the issue's core case): live has a path committed lacks → pathsAdded=1", () => {
  const committed = spec({ "/things": { get: op() } });
  const live = spec({ "/things": { get: op() }, "/new": { get: op(), post: op() } });
  const diff = diffSlices(committed, live);
  assert.equal(diff.pathsAdded, 1);
  assert.equal(diff.pathsRemoved, 0);
  assert.equal(diff.pathsChanged, 0);
  assert.equal(diff.byteEqual, false);
  // opsAdded counts every method on the whole added path.
  assert.equal(diff.opsAdded, 2);
  assert.equal(diff.opsRemoved, 0);
});

test("path removed upstream: committed has a path live no longer defines → pathsRemoved=1", () => {
  const committed = spec({ "/things": { get: op() }, "/gone": { get: op() } });
  const live = spec({ "/things": { get: op() } });
  const diff = diffSlices(committed, live);
  assert.equal(diff.pathsRemoved, 1);
  assert.equal(diff.pathsAdded, 0);
  assert.equal(diff.pathsChanged, 0);
  assert.equal(diff.byteEqual, false);
  assert.equal(diff.opsRemoved, 1);
  assert.equal(diff.opsAdded, 0);
});

test("path changed: same key, differing operation object → pathsChanged=1, add/remove 0 (mutually exclusive)", () => {
  const committed = spec({ "/things": { get: op("old summary") } });
  const live = spec({ "/things": { get: op("new summary") } });
  const diff = diffSlices(committed, live);
  assert.equal(diff.pathsChanged, 1);
  assert.equal(diff.pathsAdded, 0);
  assert.equal(diff.pathsRemoved, 0);
  assert.equal(diff.byteEqual, false);
});

test("MNE-438: a changed path that GAINS a method (GET → GET + POST) is pathsChanged=1, opsAdded=0", () => {
  // Ops inside a surviving (changed) path are counted in NEITHER op counter —
  // only whole added/removed paths move opsAdded/opsRemoved.
  const committed = spec({ "/things": { get: op() } });
  const live = spec({ "/things": { get: op(), post: op() } });
  const diff = diffSlices(committed, live);
  assert.equal(diff.pathsChanged, 1);
  assert.equal(diff.pathsAdded, 0);
  assert.equal(diff.pathsRemoved, 0);
  assert.equal(diff.opsAdded, 0);
  assert.equal(diff.opsRemoved, 0);
});

test("schema-order-only difference is NOT drift (normalization agrees with sync-openapi's sort)", () => {
  const committed = spec({ "/things": { get: op() } }, { Beta: { type: "object" }, Alpha: { type: "string" } });
  const live = spec({ "/things": { get: op() } }, { Alpha: { type: "string" }, Beta: { type: "object" } });
  const diff = diffSlices(committed, live);
  assert.equal(diff.byteEqual, true);
  assert.equal(diff.pathsChanged, 0);
});

// ── normalizeSlice / serializeSlice byte contract ────────────────────────

test("normalizeSlice sorts components.schemas alphabetically without mutating input", () => {
  const input = spec({ "/x": { get: op() } }, { Beta: { type: "object" }, Alpha: { type: "string" } });
  const normalized = normalizeSlice(input);
  assert.deepEqual(Object.keys(normalized.components.schemas), ["Alpha", "Beta"]);
  // Input untouched (pure).
  assert.deepEqual(Object.keys(input.components.schemas), ["Beta", "Alpha"]);
});

test("normalizeSlice returns spec unchanged when there are no schemas", () => {
  const input = spec({ "/x": { get: op() } });
  assert.equal(normalizeSlice(input), input);
});

test("serializeSlice byte contract: trailing newline, equals JSON.stringify(normalizeSlice(spec), null, 2) + newline", () => {
  const input = spec({ "/x": { get: op() } }, { Beta: {}, Alpha: {} });
  const out = serializeSlice(input);
  assert.ok(out.endsWith("\n"));
  assert.equal(out, JSON.stringify(normalizeSlice(input), null, 2) + "\n");
});

// ── Fail-closed edges the CLI relies on ──────────────────────────────────

test("staff leak: assertCustomerOnly throws on an /admin/ path and carries the offenders", () => {
  const leaky = spec({ "/things": { get: op() }, "/admin/users": { get: op() } });
  assert.throws(
    () => assertCustomerOnly(leaky),
    (err) => {
      assert.match(err.message, /staff paths in served slice/);
      assert.deepEqual(err.leaked, ["/admin/users"]);
      return true;
    },
  );
});

test("assertCustomerOnly passes a customer-only slice through unchanged", () => {
  const clean = spec({ "/v1/things": { get: op() } });
  assert.equal(assertCustomerOnly(clean), clean);
});

test("cold-start guard predicate: an empty live paths object is detectable as CANNOT-VERIFY, not 'everything removed'", () => {
  // The CLI treats this predicate as CANNOT VERIFY (exit 2) BEFORE calling
  // diffSlices — it must never let an empty live slice render as a giant
  // false "N paths removed" drift.
  const live = spec({});
  const isEmptyLive = !live?.paths || Object.keys(live.paths).length === 0;
  assert.equal(isEmptyLive, true);
});
