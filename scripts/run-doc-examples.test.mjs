/**
 * run-doc-examples.test.mjs — regression suite for the live executor's
 * COVERAGE reporting + floor gate (issue #380).
 *
 * Two layers:
 *   1. Pure helpers (parseMinExecutedPct / computeExecutorCoverage /
 *      coverageFloorMet / summarizeSkipReasons / renderCoverageSummary) from
 *      `lib/executor-coverage.mjs`, driven with hand-built fixtures — NO scan,
 *      NO network. Covers the CLI-value contract (null → default, undefined →
 *      error, "" / whitespace → error, out-of-range → error), the cold-start /
 *      zero-discovered edge (no divide-by-zero; fails closed at 0%), the
 *      floor comparison, and the rendered summary shape.
 *   2. CLI branches (the flag parser) driven end-to-end via child_process
 *      against the real script — pins the --help usage line and every
 *      --min-executed-pct usage-error exit(2) path WITHOUT touching the
 *      network (all resolve before loadSpec()).
 *
 * Fixtures are counts + opaque skip strings only — no credential-shaped
 * values (MNE-339).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MIN_EXECUTED_PCT,
  parseMinExecutedPct,
  computeExecutorCoverage,
  coverageFloorMet,
  summarizeSkipReasons,
  renderCoverageSummary,
} from "./lib/executor-coverage.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "run-doc-examples.mjs");

// ── parseMinExecutedPct ──────────────────────────────────────────────────────

test("parseMinExecutedPct: null (flag omitted) → default floor", () => {
  assert.equal(parseMinExecutedPct(null), DEFAULT_MIN_EXECUTED_PCT);
  assert.equal(DEFAULT_MIN_EXECUTED_PCT, 0);
});

test("parseMinExecutedPct: valid numeric strings parse", () => {
  assert.equal(parseMinExecutedPct("0"), 0);
  assert.equal(parseMinExecutedPct("50"), 50);
  assert.equal(parseMinExecutedPct("100"), 100);
  assert.equal(parseMinExecutedPct("33.3"), 33.3);
});

test("parseMinExecutedPct: undefined (flag with no value) is rejected", () => {
  assert.throws(() => parseMinExecutedPct(undefined), /requires a value/);
});

test("parseMinExecutedPct: empty / whitespace-only string is rejected", () => {
  assert.throws(() => parseMinExecutedPct(""), /non-empty/);
  assert.throws(() => parseMinExecutedPct("   "), /non-empty/);
});

test("parseMinExecutedPct: non-numeric / out-of-range is rejected", () => {
  assert.throws(() => parseMinExecutedPct("abc"), /\[0, 100\]/);
  assert.throws(() => parseMinExecutedPct("-1"), /\[0, 100\]/);
  assert.throws(() => parseMinExecutedPct("101"), /\[0, 100\]/);
  assert.throws(() => parseMinExecutedPct("NaN"), /\[0, 100\]/);
});

// ── computeExecutorCoverage ──────────────────────────────────────────────────

test("computeExecutorCoverage: rounds pct to 1 dp", () => {
  const c = computeExecutorCoverage({ executed: 12, skipped: 30 });
  assert.deepEqual(c, { executed: 12, skipped: 30, discovered: 42, pct: 28.6 });
});

test("computeExecutorCoverage: full coverage", () => {
  const c = computeExecutorCoverage({ executed: 5, skipped: 0 });
  assert.equal(c.pct, 100);
  assert.equal(c.discovered, 5);
});

test("computeExecutorCoverage: cold-start (nothing discovered) → 0%, no divide-by-zero", () => {
  const c = computeExecutorCoverage({ executed: 0, skipped: 0 });
  assert.equal(c.discovered, 0);
  assert.equal(c.pct, 0);
  assert.ok(Number.isFinite(c.pct));
});

// ── coverageFloorMet ─────────────────────────────────────────────────────────

test("coverageFloorMet: floor comparison", () => {
  assert.equal(coverageFloorMet(28.6, 25), true);
  assert.equal(coverageFloorMet(50, 50), true); // at the floor passes
  assert.equal(coverageFloorMet(0, 0), true); // default floor never gates
  assert.equal(coverageFloorMet(0, 50), false); // cold-start fails a positive floor
  assert.equal(coverageFloorMet(24.9, 25), false);
});

// ── summarizeSkipReasons ─────────────────────────────────────────────────────

test("summarizeSkipReasons: groups by category before the colon, sorted desc", () => {
  const skipped = [
    { reason: "needs fixture for path segment(s): agent-xyz" },
    { reason: "needs fixture for path segment(s): team-abc" },
    { reason: "unresolved placeholder: FOO" },
    { reason: "write op — opt-in via --include-writes + WRITE_ALLOWLIST" },
    { reason: "needs fixture for path segment(s): org-1" },
  ];
  assert.deepEqual(summarizeSkipReasons(skipped), [
    { category: "needs fixture for path segment(s)", count: 3 },
    { category: "unresolved placeholder", count: 1 },
    { category: "write op — opt-in via --include-writes + WRITE_ALLOWLIST", count: 1 },
  ]);
});

test("summarizeSkipReasons: empty list → empty", () => {
  assert.deepEqual(summarizeSkipReasons([]), []);
});

// ── renderCoverageSummary ────────────────────────────────────────────────────

test("renderCoverageSummary: includes the metrics and verdict", () => {
  const c = computeExecutorCoverage({ executed: 12, skipped: 30 });
  const md = renderCoverageSummary({
    ...c,
    floor: 25,
    floorMet: coverageFloorMet(c.pct, 25),
    skippedItems: [{ reason: "needs fixture for path segment(s): x" }],
  });
  assert.match(md, /Live doc-example executor coverage/);
  assert.match(md, /28\.6%/);
  assert.match(md, /Floor/);
  assert.match(md, /pass/);
  assert.match(md, /Skipped by reason/);
  assert.match(md, /needs fixture for path segment\(s\)/);
});

test("renderCoverageSummary: below-floor verdict + no skip table when empty", () => {
  const c = computeExecutorCoverage({ executed: 1, skipped: 9 });
  const md = renderCoverageSummary({
    ...c,
    floor: 50,
    floorMet: coverageFloorMet(c.pct, 50),
    skippedItems: [],
  });
  assert.match(md, /below floor/);
  assert.ok(!md.includes("Skipped by reason"));
});

// ── CLI flag contract (network-free: all resolve before loadSpec) ────────────

function runCli(cliArgs) {
  return spawnSync(process.execPath, [SCRIPT, ...cliArgs], {
    encoding: "utf8",
    // Ensure no staging token is inherited so any valid-flag path stops at the
    // "secret not configured" exit(0) branch instead of hitting the network.
    env: { ...process.env, MNEMOM_STAGING_TOKEN: "" },
  });
}

test("CLI --help documents --min-executed-pct and exits 0", () => {
  const r = runCli(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--min-executed-pct/);
});

test("CLI --min-executed-pct with no value → usage error (exit 2)", () => {
  const r = runCli(["--min-executed-pct"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /requires a value/);
});

test("CLI --min-executed-pct with blank value → usage error (exit 2)", () => {
  const r = runCli(["--min-executed-pct", ""]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /non-empty/);
});

test("CLI --min-executed-pct with non-numeric value → usage error (exit 2)", () => {
  const r = runCli(["--min-executed-pct", "abc"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\[0, 100\]/);
});

test("CLI --min-executed-pct out of range → usage error (exit 2)", () => {
  const r = runCli(["--min-executed-pct", "150"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\[0, 100\]/);
});
