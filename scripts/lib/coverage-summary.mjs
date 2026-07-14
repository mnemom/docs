/**
 * coverage-summary.mjs — Pure live-executor coverage aggregation (issue #380).
 *
 * `run-doc-examples.mjs` classifies every matched doc curl example into a
 * `plan` (executable — attempted live) or a `skipped` list (with a per-example
 * reason). This module turns those two lists into an executed / skipped-by-
 * reason / executed% summary so a silent regression toward zero real execution
 * is visible in the nightly job rather than invisible.
 *
 * Pure functions, no side effects, no global state, no network, no `process`,
 * no `Date.now`/`Math.random`. The CLI wrapper (`scripts/run-doc-examples.mjs`)
 * owns all I/O — it prints `renderCoverageText` to stdout and appends
 * `renderCoverageMarkdown` to `$GITHUB_STEP_SUMMARY`. Tests drive
 * `buildCoverageSummary` directly with fixture `plan`/`skipped` arrays.
 *
 * ── Skip-reason vocabulary ───────────────────────────────────────────────
 * Grouping is by a fixed `reasonClass` enum tagged at push time in the
 * executor — NOT by parsing the dynamic human `reason` string (which embeds
 * segment/placeholder names). The vocabulary below is the complete, closed
 * set of skip causes the executor produces today. `buildCoverageSummary`
 * fails closed on an unknown class: a newly-added skip cause must be
 * classified explicitly rather than silently absorbed into a catch-all
 * bucket (MNE-438 / MNE-440).
 */

// Ordered, frozen list so `byReason` is deterministic and the full vocabulary
// is always represented (count 0 when unused).
export const SKIP_REASON_CLASSES = Object.freeze([
  Object.freeze({ class: "spec-path-unmatched", label: "spec path not matched" }),
  Object.freeze({
    class: "write-op-not-allowlisted",
    label: "write op (not in WRITE_ALLOWLIST / --include-writes off)",
  }),
  Object.freeze({ class: "needs-fixture", label: "needs fixture for path segment(s)" }),
  Object.freeze({ class: "unresolved-placeholder", label: "unresolved placeholder(s)" }),
]);

const KNOWN_CLASSES = new Set(SKIP_REASON_CLASSES.map((c) => c.class));

/**
 * Aggregate `plan` + `skipped` into a coverage summary.
 *
 * @param {object}   input
 * @param {Array}    input.plan     — executable examples (each attempted live).
 * @param {Array}    input.skipped  — skipped examples; each MUST carry a
 *                                    `reasonClass` from SKIP_REASON_CLASSES.
 * @param {?number}  input.minPct   — optional warn-only coverage floor (0–100),
 *                                    or null when unset.
 * @returns {{executed:number, skippedTotal:number, total:number,
 *            executedPct:?number, byReason:Array<{class:string,label:string,count:number}>,
 *            floor:{minPct:?number, breached:boolean}}}
 */
export function buildCoverageSummary({ plan = [], skipped = [], minPct = null } = {}) {
  const executed = plan.length; // planned === attempted in a live run.
  const skippedTotal = skipped.length;
  const total = executed + skippedTotal;

  // Cold-start / no-data: no examples found → executed% is undefined (N/A),
  // never a divide-by-zero and never a false 0% (MNE-439 / MNE-442).
  const executedPct = total === 0 ? null : (executed / total) * 100;

  // Count every skip into its declared class. Fail closed on an unknown
  // class so a new skip cause can never be silently mis-bucketed (MNE-438).
  const counts = new Map(SKIP_REASON_CLASSES.map((c) => [c.class, 0]));
  for (const s of skipped) {
    const cls = s?.reasonClass;
    if (!KNOWN_CLASSES.has(cls)) {
      throw new Error(
        `Unknown skip reasonClass ${JSON.stringify(cls)}; every skip must map to a declared SKIP_REASON_CLASSES entry.`,
      );
    }
    counts.set(cls, counts.get(cls) + 1);
  }
  const byReason = SKIP_REASON_CLASSES.map((c) => ({
    class: c.class,
    label: c.label,
    count: counts.get(c.class),
  }));

  // Floor is warn-only and never trips on cold start or when unset.
  const breached = minPct != null && executedPct != null && executedPct < minPct;

  return {
    executed,
    skippedTotal,
    total,
    executedPct,
    byReason,
    floor: { minPct: minPct ?? null, breached },
  };
}

function formatPct(pct) {
  return pct.toFixed(1);
}

/**
 * Render the summary as a plain-text block for stdout (every run).
 */
export function renderCoverageText(summary) {
  const lines = [];
  if (summary.total === 0) {
    lines.push("Coverage: 0 doc examples found");
  } else {
    lines.push(
      `Coverage: ${summary.executed}/${summary.total} executed (${formatPct(summary.executedPct)}%)`,
    );
  }
  for (const r of summary.byReason) {
    lines.push(`skipped[${r.class}]: ${r.count}`);
  }
  return lines.join("\n");
}

/**
 * Render the summary as a GitHub-flavored markdown section for
 * `$GITHUB_STEP_SUMMARY`. Sentence-case heading, no emoji.
 */
export function renderCoverageMarkdown(summary) {
  const lines = [];
  lines.push("## Live doc-example coverage");
  lines.push("");
  if (summary.total === 0) {
    lines.push("No doc examples matched — coverage N/A.");
  } else {
    lines.push(
      `${summary.executed}/${summary.total} examples executed (${formatPct(summary.executedPct)}%); ${summary.skippedTotal} skipped.`,
    );
  }
  lines.push("");
  lines.push("| Skip reason | Count |");
  lines.push("| --- | --- |");
  for (const r of summary.byReason) {
    lines.push(`| ${r.label} | ${r.count} |`);
  }
  if (summary.floor.minPct != null) {
    lines.push("");
    const observed = summary.executedPct == null ? "N/A" : `${formatPct(summary.executedPct)}%`;
    const state = summary.floor.breached
      ? "below floor (warn-only — run verdict unaffected)"
      : "at or above floor";
    lines.push(`Coverage floor: ${summary.floor.minPct}% — observed ${observed} (${state}).`);
  }
  return lines.join("\n");
}

/**
 * Parse an optional coverage-floor value (issue #380). PURE — no `process`,
 * no I/O; the CLI wrapper (`run-doc-examples.mjs`) maps the result to its
 * `console.error` + `exit(2)` usage-error contract, keeping this module
 * side-effect-free and unit-testable.
 *
 * Semantics:
 *   - `null` / `undefined` / empty / whitespace-only → `{ ok: true, value: null }`
 *     (unset = no floor). GitHub Actions passes `""` for an unset repo
 *     variable, which MUST resolve to no-floor, NOT a parse error — otherwise
 *     every nightly run with the variable unconfigured would exit 2.
 *   - a finite number in `[0, 100]` → `{ ok: true, value: n }`.
 *   - anything else (non-numeric, e.g. `"abc"`/`"90x"`, or out of range,
 *     e.g. `-1`/`101`) → `{ ok: false, error }` (a config error).
 *
 * @param {?string|number} raw
 * @returns {{ok: true, value: ?number} | {ok: false, error: string}}
 */
export function parseMinExecutedPct(raw) {
  if (raw == null) return { ok: true, value: null };
  const trimmed = String(raw).trim();
  if (trimmed === "") return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return {
      ok: false,
      error: `Invalid coverage floor "${raw}" (--min-executed-pct / MNEMOM_DOC_EXAMPLES_MIN_EXECUTED_PCT): expected a number between 0 and 100.`,
    };
  }
  return { ok: true, value: n };
}
