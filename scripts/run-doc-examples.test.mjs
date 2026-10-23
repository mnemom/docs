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

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
    // Ensure no test cell token is inherited so any valid-flag path stops at the
    // "secret not configured" exit(0) branch instead of hitting the network.
    env: { ...process.env, MNEMOM_TEST_TOKEN: "" },
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

// ── CLI coverage output (dry-run + local spec, network-free) ─────────────
const FIXTURE_SPEC = join(__dirname, "test-fixtures/minimal-openapi.json");

function runCliWithSpec(cliArgs, extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...cliArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      MNEMOM_TEST_TOKEN: "",
      OPENAPI_SPEC_PATH: FIXTURE_SPEC,
      // Under Actions the child would append its coverage table to the job's
      // real step summary (run-doc-examples.mjs, `if (summaryPath)`).
      GITHUB_STEP_SUMMARY: "",
      ...extraEnv,
    },
  });
}

test("CLI --dry-run + local spec: coverage one-liner appears on stdout", () => {
  const r = runCliWithSpec(["--dry-run"]);
  assert.equal(r.status, 0, `unexpected exit ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /Executor coverage:/);
  // MDX files are scanned with the empty fixture (no paths), so every curl
  // example is skipped as 'spec path not matched' — skip-reason output must appear.
  assert.match(r.stdout, /Skipped by reason:/);
});

test("CLI --dry-run + local spec: exit 0 with default floor (0)", () => {
  const r = runCliWithSpec(["--dry-run"]);
  assert.equal(r.status, 0);
});

test("CLI --dry-run + local spec: exit 0 (warn-only) when floor tripped", () => {
  // With an empty spec, coverage is 0%; a floor of 50 is above coverage.
  // AC requires warn-only (exit 0), not exit 1.
  const r = runCliWithSpec(["--dry-run", "--min-executed-pct", "50"]);
  assert.equal(r.status, 0, `expected exit 0 (warn-only) but got ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, /warning/i);
});

test("CLI --dry-run + local spec: no skip reasons emitted when list is empty", () => {
  // Use --scope "" to produce a zero-file scan (plan=0, skipped=0) so the
  // skip-reason loop has nothing to emit. The empty spec alone is insufficient
  // because the script still scans all MDX files and skips every example as
  // "spec path not matched".
  const r = runCliWithSpec(["--dry-run", "--scope", ""]);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes("Skipped by reason:"), "no skip-reason lines when nothing was skipped");
});

// ── Target + secret contract (MNE-8861, docs#607 follow-up) ─────────────────
// The nightly job must reach the test cell, never api-staging (being shut down
// under MNE-7971), and must skip with a named notice when its secret is absent.
// A one-page MDX scope and a one-path spec, both written to a temp dir, give a
// single planned GET whose retargeted URL --dry-run --verbose prints. Network-
// free: --dry-run stops before any request, and the token-absent run exits
// before loadSpec().
const TARGET_DIR = mkdtempSync(join(tmpdir(), "run-doc-examples-target-"));
const TARGET_PAGE = join(TARGET_DIR, "page.mdx");
const TARGET_SPEC = join(TARGET_DIR, "openapi.json");
writeFileSync(TARGET_PAGE, "```bash\ncurl https://api.mnemom.ai/v1/health\n```\n");
writeFileSync(
  TARGET_SPEC,
  JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Target fixture", version: "0.0.0" },
    paths: { "/health": { get: { responses: { 200: { description: "ok" } } } } },
  }),
);
after(() => rmSync(TARGET_DIR, { recursive: true, force: true }));

// The retired names are set on purpose: the runner must not read them.
function runTarget(cliArgs, extraEnv = {}) {
  const env = {
    ...process.env,
    MNEMOM_TEST_TOKEN: "",
    MNEMOM_STAGING_BASE_URL: "https://api-staging.mnemom.ai/v1",
    MNEMOM_STAGING_TOKEN: "not-a-real-token",
    OPENAPI_SPEC_PATH: TARGET_SPEC,
    GITHUB_STEP_SUMMARY: "", // keep the child's table out of the job summary
    ...extraEnv,
  };
  if (!("MNEMOM_TEST_BASE_URL" in extraEnv)) delete env.MNEMOM_TEST_BASE_URL;
  return spawnSync(process.execPath, [SCRIPT, "--scope", TARGET_PAGE, ...cliArgs], {
    encoding: "utf8",
    env,
  });
}

test("target: default base is the test cell, never api-staging", () => {
  const r = runTarget(["--dry-run", "--verbose"]);
  assert.equal(r.status, 0, `unexpected exit ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /Plan: 1 executable example\(s\)/);
  assert.match(r.stdout, /→ GET\s+https:\/\/api-az-test\.mnemom\.ai\/v1\/health\s/);
  assert.doesNotMatch(r.stdout, /api-staging/);
});

test("target: MNEMOM_TEST_BASE_URL overrides the default base", () => {
  const r = runTarget(["--dry-run", "--verbose"], {
    MNEMOM_TEST_BASE_URL: "https://example.test/v1",
  });
  assert.equal(r.status, 0, `unexpected exit ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /→ GET\s+https:\/\/example\.test\/v1\/health\s/);
});

test("target: --base-url overrides MNEMOM_TEST_BASE_URL", () => {
  const r = runTarget(["--dry-run", "--verbose", "--base-url", "https://flag.example.test/v1"], {
    MNEMOM_TEST_BASE_URL: "https://example.test/v1",
  });
  assert.equal(r.status, 0, `unexpected exit ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /→ GET\s+https:\/\/flag\.example\.test\/v1\/health\s/);
});

test("secret absent: names MNEMOM_TEST_TOKEN, exits 0, sends nothing", () => {
  const r = runTarget([]);
  assert.equal(r.status, 0, `unexpected exit ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /^MNEMOM_TEST_TOKEN is not set\./m);
  assert.match(r.stdout, /secret not configured/);
  // Exits before the plan is built, so no request line or host is printed.
  assert.doesNotMatch(r.stdout, /Plan:/);
  assert.doesNotMatch(r.stdout, /api-staging|MNEMOM_STAGING/);
});

// ── Fixture load (docs#616 follow-up) ───────────────────────────────────────
// The runner reads `scripts/test-cell-fixtures.json` relative to its cwd and
// treats ENOENT as "no fixtures" (run-doc-examples.mjs, Fixtures + auth), so a
// wrong path would silently skip every `{org_id}` example in the nightly run.
// Run from the repo root, as doc-examples-live.yml does, and assert `{org_id}`
// resolves to the committed ORG_ID; any other path leaves the example skipped
// with "needs fixture for path segment(s): {org_id}". Network-free (--dry-run).
const REPO_ROOT = join(__dirname, "..");
const FIXTURE_ORG_ID = JSON.parse(
  readFileSync(join(__dirname, "test-cell-fixtures.json"), "utf8"),
).values.ORG_ID;
const ORG_PAGE = join(TARGET_DIR, "org-page.mdx");
const ORG_SPEC = join(TARGET_DIR, "org-openapi.json");
writeFileSync(ORG_PAGE, "```bash\ncurl https://api.mnemom.ai/v1/orgs/{org_id}/members\n```\n");
writeFileSync(
  ORG_SPEC,
  JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Fixture-load fixture", version: "0.0.0" },
    paths: { "/orgs/{org_id}/members": { get: { responses: { 200: { description: "ok" } } } } },
  }),
);

test("fixtures: {org_id} resolves from scripts/test-cell-fixtures.json", () => {
  assert.equal(typeof FIXTURE_ORG_ID, "string");
  assert.ok(FIXTURE_ORG_ID.length > 0, "committed fixture file has no ORG_ID");
  const env = {
    ...process.env,
    MNEMOM_TEST_TOKEN: "",
    OPENAPI_SPEC_PATH: ORG_SPEC,
    GITHUB_STEP_SUMMARY: "",
  };
  delete env.MNEMOM_TEST_BASE_URL;
  const r = spawnSync(process.execPath, [SCRIPT, "--scope", ORG_PAGE, "--dry-run", "--verbose"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
  });
  assert.equal(r.status, 0, `unexpected exit ${r.status}\nstderr: ${r.stderr}`);
  assert.doesNotMatch(r.stdout, /needs fixture/);
  assert.match(r.stdout, /Plan: 1 executable example\(s\); 0 skipped\./);
  assert.ok(
    r.stdout.includes(`→ GET    https://api-az-test.mnemom.ai/v1/orgs/${FIXTURE_ORG_ID}/members `),
    `planned URL does not carry the committed ORG_ID\nstdout: ${r.stdout}`,
  );
});
