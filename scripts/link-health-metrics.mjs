#!/usr/bin/env node
/**
 * link-health-metrics.mjs — append-only, machine-readable internal-link-health
 * TREND artifact.
 *
 * The sibling `link-health-report.mjs` renders an ADVISORY per-group broken-%
 * table to `$GITHUB_STEP_SUMMARY` on every run, but that table is ephemeral —
 * it vanishes with the job, so there is no way to answer "is `guides/` link rot
 * getting worse over time?". This script closes that gap: it wraps the SAME
 * `computeLinkHealth(root)` core (imported verbatim, single source of truth so
 * the trend row can never disagree with the advisory table) into one dated JSON
 * row and appends it as a single line to `metrics/link-health.jsonl`.
 *
 * This is a SAFE-ADDITIVE / observability-only change: no product behavior, no
 * API contract, no UX surface. The JSONL artifact is data, not an MDX page — it
 * is never rendered by Mintlify.
 *
 * Intended to run on SCHEDULED (non-PR) runs only. The row is committed to a
 * DEDICATED `metrics` branch by the (separately-authored, operator-owned)
 * workflow, NEVER to `main` — Mintlify auto-deploys on push to `main`
 * (see AGENTS.md), so keeping the trend off `main` avoids deploy noise.
 * `.github/workflows/**` is a NEVER-AUTO path; the ready-to-paste workflow YAML
 * is documented in the PR description, not committed here.
 *
 * Unlike the always-exit-0 advisory report, this WRITE path fails CLOSED: any
 * invariant violation or scan error exits non-zero so a scheduled run never
 * commits corrupt/misleading data (and the failure surfaces a useful signal).
 *
 * Node built-ins only, so no `npm ci` is required — sibling to
 * `link-health-report.mjs` / `check-links-local.mjs`.
 */

import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

import { computeLinkHealth } from "./link-health-report.mjs";

// ── Pure helpers (no I/O — exported for the test suite) ───────────────────────

// Round to 1 decimal. Shared by buildRow and assertRowInvariants so the
// write-time pct invariant is a STRICT equality (both sides pass through the
// exact same helper — no last-ULP drift on repeating-decimal ratios).
export function round1(n) {
  return Math.round(n * 10) / 10;
}

// Shape a computeLinkHealth() result into one trend row.
//   { date, generated_at, total_links, broken, pct, by_group: { <group>: { total, broken, pct } } }
// `date` (YYYY-MM-DD) is the daily trend key; `generated_at` is a full ISO-8601
// millisecond timestamp so two consecutive runs produce two distinct rows.
export function buildRow(result, { date, generatedAt }) {
  const by_group = {};
  for (const g of result.groups) {
    by_group[g.group] = {
      total: g.total,
      broken: g.broken,
      pct: round1(g.pct),
    };
  }
  return {
    date,
    generated_at: generatedAt,
    total_links: result.totals.total,
    broken: result.totals.broken,
    pct: round1(result.totals.pct),
    by_group,
  };
}

// Write-time invariants — throw a descriptive Error if the row is inconsistent,
// so the CLI can fail closed (MNE-438 counter correctness / MNE-442 fail-closed).
export function assertRowInvariants(row) {
  const {
    date,
    generated_at: generatedAt,
    total_links: total,
    broken,
    pct,
    by_group: byGroup,
  } = row;

  if (!Number.isInteger(total) || total < 0)
    throw new Error(`total_links must be a non-negative integer, got ${total}`);
  if (!Number.isInteger(broken) || broken < 0)
    throw new Error(`broken must be a non-negative integer, got ${broken}`);
  if (broken > total)
    throw new Error(
      `broken (${broken}) must be <= total_links (${total}) — numerator cannot exceed denominator`,
    );

  // by-group counters must correspond to the top-line totals (no count falling
  // into the wrong bucket), and each group's pct must match its own counts.
  let groupTotal = 0;
  let groupBroken = 0;
  for (const [name, g] of Object.entries(byGroup ?? {})) {
    if (!Number.isInteger(g.total) || g.total < 0)
      throw new Error(`by_group.${name}.total must be a non-negative integer, got ${g.total}`);
    if (!Number.isInteger(g.broken) || g.broken < 0)
      throw new Error(`by_group.${name}.broken must be a non-negative integer, got ${g.broken}`);
    if (g.broken > g.total)
      throw new Error(`by_group.${name}.broken (${g.broken}) must be <= total (${g.total})`);
    const expectedGroupPct = g.total === 0 ? 0 : round1((g.broken / g.total) * 100);
    if (g.pct !== expectedGroupPct)
      throw new Error(
        `by_group.${name}.pct (${g.pct}) !== expected ${expectedGroupPct} for broken=${g.broken}/total=${g.total}`,
      );
    groupTotal += g.total;
    groupBroken += g.broken;
  }
  if (groupTotal !== total)
    throw new Error(`sum of by_group.total (${groupTotal}) !== total_links (${total})`);
  if (groupBroken !== broken)
    throw new Error(`sum of by_group.broken (${groupBroken}) !== broken (${broken})`);

  // pct must match the counts exactly (0 on an empty tree — no divide-by-zero).
  const expectedPct = total === 0 ? 0 : round1((broken / total) * 100);
  if (pct !== expectedPct)
    throw new Error(`pct (${pct}) !== expected ${expectedPct} for broken=${broken}/total=${total}`);

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`date must match YYYY-MM-DD, got ${JSON.stringify(date)}`);
  if (typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt)))
    throw new Error(`generated_at must be a valid ISO-8601 timestamp, got ${JSON.stringify(generatedAt)}`);
}

// Append one row as a single JSONL line, creating the parent dir (and the file)
// if absent — first-deploy / cold-start safe.
export function appendRow(filePath, row) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(row) + "\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const HELP = `Usage: link-health-metrics.mjs [--print] [--file path] [--root path] [--date YYYY-MM-DD]
  Compute internal-link health for the docs tree and append one dated JSON row
  to metrics/link-health.jsonl (observability-only trend artifact).

  --print          Dry run: compute + validate + print the row JSON to stdout,
                   NO write. Takes precedence over --file (when both are given,
                   the row is printed and no file is written).
  --file <path>    Output JSONL path (default: metrics/link-health.jsonl at repo root).
  --root <path>    Docs tree to scan (default: repo root).
  --date <date>    Override the trend date (YYYY-MM-DD; default: today, UTC).
  -h, --help       Show this help.

  Fails CLOSED: exits non-zero on any invariant violation or scan error.`;

function main() {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const args = argv.slice(2);

  let print = false;
  let root = repoRoot;
  let filePath = null; // resolved to the default (repo-root-relative) below
  let date = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--print") {
      print = true;
    } else if (a === "--root") {
      if (i + 1 >= args.length) {
        console.error("--root requires a path argument");
        exit(2);
      }
      root = resolve(args[++i]);
    } else if (a === "--file") {
      if (i + 1 >= args.length) {
        console.error("--file requires a path argument");
        exit(2);
      }
      filePath = resolve(args[++i]);
    } else if (a === "--date") {
      if (i + 1 >= args.length) {
        console.error("--date requires a YYYY-MM-DD argument");
        exit(2);
      }
      date = args[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(HELP);
      exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      exit(2);
    }
  }

  if (filePath === null) filePath = resolve(repoRoot, "metrics/link-health.jsonl");

  let result;
  try {
    result = computeLinkHealth(root);
  } catch (err) {
    // Fail CLOSED (this is a WRITE path, not the advisory report): surface a
    // useful signal and exit non-zero rather than silently writing nothing.
    console.error(`::error::link-health-metrics could not scan ${root}: ${err.message}`);
    exit(1);
  }

  let row;
  try {
    row = buildRow(result, { date, generatedAt: new Date().toISOString() });
    assertRowInvariants(row);
  } catch (err) {
    console.error(`::error::link-health-metrics invariant violation: ${err.message}`);
    exit(1);
  }

  // --print takes precedence over --file: print the exact JSONL line, no write.
  if (print) {
    console.log(JSON.stringify(row));
    exit(0);
  }

  try {
    appendRow(filePath, row);
  } catch (err) {
    console.error(`::error::link-health-metrics could not write ${filePath}: ${err.message}`);
    exit(1);
  }
  console.log(
    `link-health-metrics: wrote row date=${row.date} total=${row.total_links} broken=${row.broken} pct=${row.pct}`,
  );
  exit(0);
}

// Run the CLI only when invoked as the entrypoint, so the test file can import
// the helpers above without triggering a scan/write.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
