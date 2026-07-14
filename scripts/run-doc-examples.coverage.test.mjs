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
  parseMinExecutedPct,
} from "./lib/coverage-summary.mjs";

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "run-doc-examples.mjs");
const REPO_ROOT = join(__dirname, "..");

function mkIntegrationEnv() {
  const dir = mkdtempSync(join(tmpdir(), "run-doc-eg-test-"));
  // Minimal spec: no paths → every curl gets spec-path-unmatched → executedPct = 0
  writeFileSync(join(dir, "openapi.json"), JSON.stringify({ paths: {} }));
  // One GET example in a bash block — no credential-shaped values (MNE-339)
  writeFileSync(
    join(dir, "fixture.mdx"),
    "```bash\ncurl https://api.mnemom.ai/v1/agents\n```\n",
  );
  return dir;
}

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

// ── parseMinExecutedPct: every branch (floor config parsing) ────────────────
//
// Directly exercises the exit-2 classification and — critically — the
// empty-string path GitHub Actions produces for an unset repo variable, which
// MUST resolve to no-floor rather than exit 2 (which would kill the nightly
// job) or a silent floor of 0.

test("parseMinExecutedPct: unset (null/undefined) → no floor", () => {
  assert.deepEqual(parseMinExecutedPct(null), { ok: true, value: null });
  assert.deepEqual(parseMinExecutedPct(undefined), { ok: true, value: null });
});

test("parseMinExecutedPct: empty / whitespace-only → no floor (GitHub unset repo var)", () => {
  assert.deepEqual(parseMinExecutedPct(""), { ok: true, value: null });
  assert.deepEqual(parseMinExecutedPct("   "), { ok: true, value: null });
  assert.deepEqual(parseMinExecutedPct("\t\n"), { ok: true, value: null });
});

test("parseMinExecutedPct: non-numeric → config error (maps to exit 2)", () => {
  for (const bad of ["abc", "90x", "%", "NaN"]) {
    const r = parseMinExecutedPct(bad);
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
    assert.match(r.error, /between 0 and 100/);
  }
});

test("parseMinExecutedPct: out-of-range (<0 or >100) → config error", () => {
  assert.equal(parseMinExecutedPct("-1").ok, false);
  assert.equal(parseMinExecutedPct("101").ok, false);
  assert.equal(parseMinExecutedPct(-0.1).ok, false);
  assert.equal(parseMinExecutedPct(100.5).ok, false);
});

test("parseMinExecutedPct: valid values (incl. 0, 100, boundaries) → parsed number", () => {
  assert.deepEqual(parseMinExecutedPct("0"), { ok: true, value: 0 });
  assert.deepEqual(parseMinExecutedPct("100"), { ok: true, value: 100 });
  assert.deepEqual(parseMinExecutedPct("50"), { ok: true, value: 50 });
  assert.deepEqual(parseMinExecutedPct("33.3"), { ok: true, value: 33.3 });
  // Surrounding whitespace is trimmed before parsing.
  assert.deepEqual(parseMinExecutedPct(" 90 "), { ok: true, value: 90 });
  // Accepts a numeric argument (the --min-executed-pct flag value is a string,
  // but the function is robust to a number too).
  assert.deepEqual(parseMinExecutedPct(75), { ok: true, value: 75 });
});

// ── Integration: wiring in run-doc-examples.mjs (child-process) ──────────────
//
// These tests exercise branches in the top-level script that cannot be reached
// by importing coverage-summary.mjs alone. They spawn a real child process with
// a minimal temp spec (no paths → all examples are spec-path-unmatched,
// executedPct = 0) so no network call or live fixture is required.

test("floor-breach emits ::warning:: annotation with correct percentage format", () => {
  const dir = mkIntegrationEnv();
  try {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--dry-run", "--min-executed-pct", "99", "--scope", join(dir, "fixture.mdx")],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, OPENAPI_SPEC_PATH: join(dir, "openapi.json") },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.ok(
      r.stdout.includes(
        "::warning::Live doc-example coverage 0.0% is below the configured floor of 99%",
      ),
      `expected ::warning:: annotation in stdout\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GITHUB_STEP_SUMMARY appendFileSync error emits ::notice:: annotation", () => {
  const dir = mkIntegrationEnv();
  try {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--dry-run", "--scope", join(dir, "fixture.mdx")],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          OPENAPI_SPEC_PATH: join(dir, "openapi.json"),
          GITHUB_STEP_SUMMARY: dir, // directory → appendFileSync throws EISDIR
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.ok(
      r.stdout.includes("::notice::Could not write coverage summary to GITHUB_STEP_SUMMARY:"),
      `expected ::notice:: annotation in stdout\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
