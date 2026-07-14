/**
 * link-health-metrics.test.mjs — regression suite for the link-health TREND
 * artifact core (`scripts/link-health-metrics.mjs`).
 *
 * Drives the exported pure helpers (buildRow / assertRowInvariants / appendRow /
 * round1) with hand-built computeLinkHealth-shaped fixtures — NO live scan.
 * Covers row shaping + pct rounding, counter-correspondence invariants (MNE-438),
 * fail-closed invariant violations (MNE-442), the cold-start/empty-tree edge
 * (no divide-by-zero), and the append round-trip that proves two consecutive
 * runs produce two distinct rows.
 *
 * Fixtures are link/count data only — no credential-shaped values (MNE-339).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  round1,
  buildRow,
  assertRowInvariants,
  appendRow,
} from "./link-health-metrics.mjs";

// A well-formed computeLinkHealth-shaped result: guides 1/3 broken (a repeating
// decimal ratio — pins the strict-equality pct invariant against last-ULP drift),
// concepts 0/1, (root) 1/1. Totals: 2/5.
function sampleResult() {
  const pct = (broken, total) => (total === 0 ? 0 : (broken / total) * 100);
  const groups = [
    { group: "(root)", total: 1, broken: 1, pct: pct(1, 1) },
    { group: "concepts", total: 1, broken: 0, pct: pct(0, 1) },
    { group: "guides", total: 3, broken: 1, pct: pct(1, 3) },
  ];
  return {
    groups,
    totals: { total: 5, broken: 2, pct: pct(2, 5) },
    filesScanned: 4,
  };
}

const META = { date: "2026-07-14", generatedAt: "2026-07-14T06:00:03.412Z" };

// ── round1 ────────────────────────────────────────────────────────────────

test("round1 rounds to a single decimal place", () => {
  assert.equal(round1((1 / 3) * 100), 33.3);
  assert.equal(round1(40), 40);
  assert.equal(round1(0), 0);
  assert.equal(round1((2 / 3) * 100), 66.7);
});

// ── buildRow: shape / counts / rounding ─────────────────────────────────────

test("buildRow maps totals, rounds pct, and shapes by_group", () => {
  const row = buildRow(sampleResult(), META);

  assert.equal(row.date, "2026-07-14");
  assert.equal(row.generated_at, "2026-07-14T06:00:03.412Z");
  assert.equal(row.total_links, 5);
  assert.equal(row.broken, 2);
  assert.equal(row.pct, 40); // round1(2/5*100)

  assert.deepEqual(Object.keys(row.by_group).sort(), ["(root)", "concepts", "guides"]);
  assert.deepEqual(row.by_group.guides, { total: 3, broken: 1, pct: 33.3 });
  assert.deepEqual(row.by_group.concepts, { total: 1, broken: 0, pct: 0 });
  assert.deepEqual(row.by_group["(root)"], { total: 1, broken: 1, pct: 100 });
});

// ── assertRowInvariants: passes on well-formed rows ─────────────────────────

test("assertRowInvariants passes on a well-formed row", () => {
  const row = buildRow(sampleResult(), META);
  assert.doesNotThrow(() => assertRowInvariants(row));
});

test("assertRowInvariants passes on a repeating-decimal ratio (strict pct equality does not flap)", () => {
  // broken=1, total=3 → the pct invariant compares round1(1/3*100) on both
  // sides; the shared helper guarantees strict equality, no last-ULP drift.
  const pct = (b, t) => (t === 0 ? 0 : (b / t) * 100);
  const result = {
    groups: [{ group: "guides", total: 3, broken: 1, pct: pct(1, 3) }],
    totals: { total: 3, broken: 1, pct: pct(1, 3) },
    filesScanned: 1,
  };
  const row = buildRow(result, META);
  assert.equal(row.pct, 33.3);
  assert.doesNotThrow(() => assertRowInvariants(row));
});

// ── assertRowInvariants: fails closed ───────────────────────────────────────

test("assertRowInvariants throws when broken > total_links", () => {
  const row = buildRow(sampleResult(), META);
  row.broken = row.total_links + 1;
  assert.throws(() => assertRowInvariants(row), /broken .* must be <= total_links/);
});

test("assertRowInvariants throws when by_group totals do not sum to total_links", () => {
  const row = buildRow(sampleResult(), META);
  row.total_links = 99; // group totals still sum to 5, so 5 !== 99
  assert.throws(() => assertRowInvariants(row), /sum of by_group\.total/);
});

test("assertRowInvariants throws when by_group brokens do not sum to broken", () => {
  const row = buildRow(sampleResult(), META);
  row.broken = 3; // <= total_links, but group brokens still sum to 2
  assert.throws(() => assertRowInvariants(row), /sum of by_group\.broken/);
});

test("assertRowInvariants throws when pct is inconsistent with the counts", () => {
  const row = buildRow(sampleResult(), META);
  row.pct = 99.9; // does not match round1(2/5*100) = 40
  assert.throws(() => assertRowInvariants(row), /pct .* !== expected/);
});

test("assertRowInvariants throws on a malformed date", () => {
  const row = buildRow(sampleResult(), META);
  row.date = "07/14/2026";
  assert.throws(() => assertRowInvariants(row), /date must match YYYY-MM-DD/);
});

test("assertRowInvariants throws on an invalid generated_at", () => {
  const row = buildRow(sampleResult(), META);
  row.generated_at = "not-a-timestamp";
  assert.throws(() => assertRowInvariants(row), /generated_at must be a valid/);
});

// ── Cold start / empty tree ─────────────────────────────────────────────────

test("empty tree → total 0, pct 0, invariants pass (no divide-by-zero)", () => {
  const result = { groups: [], totals: { total: 0, broken: 0, pct: 0 }, filesScanned: 0 };
  const row = buildRow(result, META);
  assert.equal(row.total_links, 0);
  assert.equal(row.broken, 0);
  assert.equal(row.pct, 0);
  assert.deepEqual(row.by_group, {});
  assert.doesNotThrow(() => assertRowInvariants(row));
});

// ── appendRow round-trip ────────────────────────────────────────────────────

test("appendRow writes one valid JSONL line, then a second distinct line (append-only)", () => {
  const dir = mkdtempSync(join(tmpdir(), "link-health-metrics-"));
  const file = join(dir, "link-health.jsonl");

  const row1 = buildRow(sampleResult(), {
    date: "2026-07-14",
    generatedAt: "2026-07-14T06:00:00.000Z",
  });
  appendRow(file, row1);

  let lines = readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), row1);

  // A second run with a different generated_at appends a genuinely distinct row.
  const row2 = buildRow(sampleResult(), {
    date: "2026-07-14",
    generatedAt: "2026-07-14T06:05:00.000Z",
  });
  appendRow(file, row2);

  lines = readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  const [a, b] = lines.map((l) => JSON.parse(l));
  assert.equal(a.date, b.date); // same daily trend key
  assert.notEqual(a.generated_at, b.generated_at); // but distinct rows
  assert.notDeepEqual(a, b);
});

test("appendRow creates a missing parent directory / file (cold start)", () => {
  const dir = mkdtempSync(join(tmpdir(), "link-health-metrics-"));
  const file = join(dir, "nested", "does-not-exist", "link-health.jsonl");
  assert.equal(existsSync(file), false);

  const row = buildRow(sampleResult(), META);
  appendRow(file, row);

  assert.equal(existsSync(file), true);
  const lines = readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), row);
});
