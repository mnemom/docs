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
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCustomerOnly,
  diffSlices,
  normalizeSlice,
  serializeSlice,
} from "./lib/openapi-slice.mjs";

const CLI = fileURLToPath(new URL("./check-slice-freshness.mjs", import.meta.url));
const COMMITTED = fileURLToPath(new URL("../api-reference/openapi.json", import.meta.url));

// Spawn the real CLI against a local live-spec fixture (no network) and return
// its exit code + captured streams. Exercises the actual exit-code contract
// and guard ordering, not a re-implementation of the predicate.
function runCli(liveSpecPath, extraArgs = []) {
  const r = spawnSync("node", [CLI, "--spec-path", liveSpecPath, ...extraArgs], {
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

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

// ── CLI exit-code contract (real subprocess, no network) ─────────────────
// These spawn the actual script so they exercise the guard ORDERING and exit
// codes — a test that only recomputed a predicate would pass even if the guard
// were removed or reordered after the diff call.

test("CLI: empty live paths → exit 2 (CANNOT VERIFY), diff bypassed, no false 'removed' drift", () => {
  const dir = mkdtempSync(join(tmpdir(), "slice-freshness-"));
  try {
    const empty = join(dir, "empty.json");
    writeFileSync(empty, JSON.stringify({ openapi: "3.1.0", info: { title: "t", version: "1" }, paths: {} }));
    // Strict AND soft must both fail closed on an unusable live spec.
    for (const args of [[], ["--soft"]]) {
      const r = runCli(empty, args);
      assert.equal(r.code, 2, `expected exit 2 for args ${JSON.stringify(args)}`);
      assert.match(r.stderr, /live spec has no paths/);
      // The guard fires BEFORE diffSlices — no drift summary is emitted, so an
      // empty live slice is never rendered as a giant false "N paths removed".
      assert.doesNotMatch(r.stdout, /committed-slice vs live:/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: live == committed slice → exit 0 (FRESH) + 0/0/0 diff line", () => {
  const r = runCli(COMMITTED);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /committed-slice vs live: 0 paths added \/ 0 removed \/ 0 changed/);
});

test("CLI: drifting live spec → exit 1 (strict) but exit 0 (--soft), diff line printed in both", () => {
  const dir = mkdtempSync(join(tmpdir(), "slice-freshness-"));
  try {
    const drift = join(dir, "drift.json");
    writeFileSync(
      drift,
      JSON.stringify({ openapi: "3.1.0", info: { title: "t", version: "1" }, paths: { "/only-here-live": { get: { responses: { 200: { description: "ok" } } } } } }),
    );
    const strict = runCli(drift);
    assert.equal(strict.code, 1);
    assert.match(strict.stdout, /committed-slice vs live:/);
    const soft = runCli(drift, ["--soft"]);
    assert.equal(soft.code, 0);
    assert.match(soft.stdout, /committed-slice vs live:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: staff-path leak in live spec → exit 2 (CANNOT VERIFY)", () => {
  const dir = mkdtempSync(join(tmpdir(), "slice-freshness-"));
  try {
    const staff = join(dir, "staff.json");
    writeFileSync(
      staff,
      JSON.stringify({ openapi: "3.1.0", info: { title: "t", version: "1" }, paths: { "/admin/x": { get: {} } } }),
    );
    const r = runCli(staff);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /staff paths in served slice/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: missing live spec file → exit 2 (CANNOT VERIFY)", () => {
  const r = runCli(join(tmpdir(), "does-not-exist-slice.json"));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /does not exist/);
});
