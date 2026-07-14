/**
 * run-doc-examples.coverage.test.mjs — regression suite for the live-executor
 * coverage aggregation core (`scripts/lib/coverage-summary.mjs`, issue #380).
 *
 * Drives `buildCoverageSummary` / renderers with fixture `plan`/`skipped`
 * arrays — NO live network, NO top-level script execution. Covers the mixed
 * case, the cold-start (zero examples) edge that must not divide by zero or
 * falsely warn, the all-skipped zero-executed case, full-vocabulary coverage,
 * and the fail-closed unknown-class guard.
 *
 * Fixture objects are plain `{ file, line, method, url, reasonClass }` shapes
 * with obvious placeholders — no credential-shaped values (MNE-339).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SKIP_REASON_CLASSES,
  buildCoverageSummary,
  renderCoverageText,
  renderCoverageMarkdown,
} from "./lib/coverage-summary.mjs";

// ── Fixture builders ───────────────────────────────────────────────────────
function planItem(i) {
  return { file: `guides/example-${i}.mdx`, line: i, method: "GET", url: `https://api-staging.example/thing/${i}` };
}
function skipItem(reasonClass, i) {
  return {
    file: `guides/example-${i}.mdx`,
    line: i,
    method: "GET",
    url: `https://api-staging.example/thing/${i}`,
    reason: `placeholder reason for ${reasonClass}`,
    reasonClass,
  };
}

// ── buildCoverageSummary: mixed set ─────────────────────────────────────────

test("mixed plan/skipped set → correct totals, executedPct, and per-reason counts", () => {
  const plan = [planItem(1), planItem(2)];
  const skipped = [
    skipItem("needs-fixture", 3),
    skipItem("needs-fixture", 4),
    skipItem("unresolved-placeholder", 5),
    skipItem("write-op-not-allowlisted", 6),
  ];
  const summary = buildCoverageSummary({ plan, skipped });

  assert.equal(summary.executed, 2);
  assert.equal(summary.skippedTotal, 4);
  assert.equal(summary.total, 6);
  assert.equal(Number(summary.executedPct.toFixed(1)), 33.3);

  const counts = Object.fromEntries(summary.byReason.map((r) => [r.class, r.count]));
  assert.equal(counts["needs-fixture"], 2);
  assert.equal(counts["unresolved-placeholder"], 1);
  assert.equal(counts["write-op-not-allowlisted"], 1);
  assert.equal(counts["spec-path-unmatched"], 0);
});

// ── Cold start / no data ─────────────────────────────────────────────────────

test("cold start: empty plan + empty skipped → executedPct null, total 0, floor never breached", () => {
  const summary = buildCoverageSummary({ plan: [], skipped: [], minPct: 90 });
  assert.equal(summary.total, 0);
  assert.equal(summary.executedPct, null);
  assert.equal(summary.floor.breached, false); // must not divide-by-zero or falsely warn
  // Every declared reason class still present at count 0.
  assert.equal(summary.byReason.length, SKIP_REASON_CLASSES.length);
  for (const r of summary.byReason) assert.equal(r.count, 0);
  // Text render says "0 doc examples found", not "0%".
  assert.match(renderCoverageText(summary), /0 doc examples found/);
});

// ── Zero executed, all skipped ──────────────────────────────────────────────

test("all-skipped, zero executed → executedPct 0; floor breached iff minPct > 0", () => {
  const skipped = [skipItem("needs-fixture", 1), skipItem("unresolved-placeholder", 2)];

  const noFloor = buildCoverageSummary({ plan: [], skipped });
  assert.equal(noFloor.executed, 0);
  assert.equal(noFloor.executedPct, 0);
  assert.equal(noFloor.floor.breached, false); // minPct == null → no warn

  const withFloor = buildCoverageSummary({ plan: [], skipped, minPct: 50 });
  assert.equal(withFloor.floor.breached, true);
  assert.equal(withFloor.floor.minPct, 50);
});

test("floor exactly at executedPct is NOT breached (strict less-than)", () => {
  const summary = buildCoverageSummary({
    plan: [planItem(1)],
    skipped: [skipItem("needs-fixture", 2)],
    minPct: 50,
  }); // executedPct === 50
  assert.equal(summary.executedPct, 50);
  assert.equal(summary.floor.breached, false);
});

// ── Full vocabulary ─────────────────────────────────────────────────────────

test("every declared reason class appears in byReason even with count 0", () => {
  const summary = buildCoverageSummary({ plan: [planItem(1)], skipped: [] });
  const classes = summary.byReason.map((r) => r.class);
  for (const c of SKIP_REASON_CLASSES) {
    assert.ok(classes.includes(c.class), `expected ${c.class} in byReason`);
  }
});

// ── Fail closed on an unknown class ─────────────────────────────────────────

test("unknown reasonClass throws (fail-closed — a new skip cause must be classified)", () => {
  assert.throws(
    () => buildCoverageSummary({ plan: [], skipped: [skipItem("brand-new-cause", 1)] }),
    /Unknown skip reasonClass/,
  );
});

// ── Renderers ────────────────────────────────────────────────────────────────

test("renderCoverageText: header + one line per reason class", () => {
  const summary = buildCoverageSummary({
    plan: [planItem(1), planItem(2), planItem(3)],
    skipped: [skipItem("needs-fixture", 4)],
  });
  const text = renderCoverageText(summary);
  assert.match(text, /Coverage: 3\/4 executed \(75\.0%\)/);
  for (const c of SKIP_REASON_CLASSES) {
    assert.match(text, new RegExp(`skipped\\[${c.class}\\]:`));
  }
});

test("renderCoverageMarkdown: heading, table, and floor line when configured", () => {
  const summary = buildCoverageSummary({
    plan: [planItem(1)],
    skipped: [skipItem("needs-fixture", 2), skipItem("needs-fixture", 3)],
    minPct: 90,
  });
  const md = renderCoverageMarkdown(summary);
  assert.match(md, /## Live doc-example coverage/);
  assert.match(md, /\| Skip reason \| Count \|/);
  assert.match(md, /needs fixture for path segment\(s\) \| 2/);
  assert.match(md, /Coverage floor: 90% — observed 33\.3% \(below floor/);
});

test("renderCoverageMarkdown: no floor line when floor unset; cold start says N/A", () => {
  const summary = buildCoverageSummary({ plan: [], skipped: [] });
  const md = renderCoverageMarkdown(summary);
  assert.doesNotMatch(md, /Coverage floor/);
  assert.match(md, /coverage N\/A/);
});
