/**
 * executor-coverage.mjs — pure helpers for REPORTING the live doc-example
 * executor's coverage (issue #380).
 *
 * The live executor (`run-doc-examples.mjs`) discovers every safe-to-run
 * `curl https://api.mnemom.ai/v1/*` example in the docs, then splits them
 * into an executable `plan` (actually run against staging) and a `skipped`
 * list (missing fixtures, write ops, unresolved placeholders, …). "Executor
 * coverage" is the share of DISCOVERED examples the executor actually runs
 * live. A high skip rate silently erodes the value of the live check without
 * ever failing it — this module makes that erosion visible in the run summary
 * and, when opted into, gate-able via a CLI floor.
 *
 * All helpers are pure (no I/O, no `process`/`env` reads) so the sibling test
 * suite can exercise them directly. The floor threshold is passed in from the
 * CLI ONLY — it is never read from the environment. `$GITHUB_STEP_SUMMARY`
 * (read by the consumer) is the OUTPUT DESTINATION, not the policy input.
 *
 * Node built-ins only, sibling to `doc-examples-extract.mjs`.
 */

// Default floor when --min-executed-pct is omitted. Zero means "report only,
// never gate": the executor stays non-blocking by default, and a floor is an
// explicit opt-in.
export const DEFAULT_MIN_EXECUTED_PCT = 0;

// Round to 1 decimal place. Shared by computeExecutorCoverage and the render
// helper so the reported pct and the floor comparison see the exact same
// value (no last-ULP drift on repeating-decimal ratios like 1/3).
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Parse the `--min-executed-pct` CLI value into a number in [0, 100].
 *
 *   - `null`      → DEFAULT_MIN_EXECUTED_PCT (the flag was omitted entirely)
 *   - `undefined` → invalid (throws): the flag was passed with no trailing
 *                   value (`args[++i]` yields undefined when it is the last
 *                   token). This is a usage error, NOT a silent default —
 *                   the design-review advisory calls this out explicitly.
 *   - "" / whitespace-only string → invalid (throws): `Number("")` coerces to
 *                   0, so blank input is rejected BEFORE the numeric coercion.
 *   - non-numeric or out-of-range → invalid (throws)
 */
export function parseMinExecutedPct(raw) {
  if (raw === null) return DEFAULT_MIN_EXECUTED_PCT;
  if (raw === undefined) {
    throw new Error("--min-executed-pct requires a value");
  }
  if (typeof raw === "string" && raw.trim() === "") {
    throw new Error("--min-executed-pct requires a non-empty numeric value");
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(
      `--min-executed-pct must be a number in [0, 100], got: ${raw}`,
    );
  }
  return n;
}

/**
 * Compute executor coverage from the executed/skipped split.
 *
 *   executed   = # examples actually run live (the executor's `plan.length`)
 *   skipped    = # discovered examples NOT run (skipped.length)
 *   discovered = executed + skipped
 *   pct        = executed / discovered * 100, rounded to 1 dp
 *
 * Cold-start / no-data edge (MNE-441/-442): when NOTHING was discovered
 * (discovered === 0, which implies executed === 0) there is no division to
 * do — pct is defined as 0, not 100. This fails CLOSED against any positive
 * floor (0 < floor ⇒ gate trips and surfaces "0% executed") rather than
 * silently reporting full coverage for an empty run.
 */
export function computeExecutorCoverage({ executed, skipped }) {
  const discovered = executed + skipped;
  const pct = discovered === 0 ? 0 : round1((executed / discovered) * 100);
  return { executed, skipped, discovered, pct };
}

/**
 * Is coverage at or above the floor? Both operands pass through round1 (pct
 * already rounded by computeExecutorCoverage) so the comparison is exact.
 * Default floor 0 ⇒ always met (report-only).
 */
export function coverageFloorMet(pct, floor) {
  return pct >= floor;
}

// Group a skipped list into { reason-category → count }. The executor's skip
// reasons carry per-example detail after a colon (e.g. "needs fixture for path
// segment(s): agent-xyz"); grouping on the text BEFORE the first colon keeps
// the breakdown to a handful of stable categories instead of one row per
// unique placeholder.
export function summarizeSkipReasons(skipped) {
  const counts = new Map();
  for (const s of skipped) {
    const reason = typeof s?.reason === "string" ? s.reason : "(unknown)";
    const category = reason.split(":")[0].trim() || "(unknown)";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  // Descending by count, then alphabetical for a deterministic ordering.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
}

const fmtPct = (n) => `${n.toFixed(1)}%`;

/**
 * Render a GitHub-flavored Markdown coverage report for `$GITHUB_STEP_SUMMARY`
 * (or stdout). Mirrors the table idiom of `link-health-report.mjs`: numeric
 * columns right-aligned, an italic caption, a plain-text (no-emoji) heading.
 */
export function renderCoverageSummary({
  executed,
  skipped,
  discovered,
  pct,
  floor,
  floorMet,
  skippedItems = [],
}) {
  const lines = [];
  lines.push("### Live doc-example executor coverage");
  lines.push("");
  lines.push(
    "_Share of discovered `curl` examples the live executor runs against staging. A high skip rate (missing fixtures, write ops, unresolved placeholders) erodes the check without failing it._",
  );
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| :--- | ---: |");
  lines.push(`| Executed | ${executed} |`);
  lines.push(`| Skipped | ${skipped} |`);
  lines.push(`| Discovered | ${discovered} |`);
  lines.push(`| Coverage | ${fmtPct(pct)} |`);
  lines.push(`| Floor (\`--min-executed-pct\`) | ${fmtPct(floor)} |`);
  lines.push(`| Verdict | ${floorMet ? "pass" : "below floor"} |`);

  const reasons = summarizeSkipReasons(skippedItems);
  if (reasons.length > 0) {
    lines.push("");
    lines.push("**Skipped by reason**");
    lines.push("");
    lines.push("| Reason | Count |");
    lines.push("| :--- | ---: |");
    for (const { category, count } of reasons) {
      lines.push(`| ${category} | ${count} |`);
    }
  }

  return lines.join("\n");
}
