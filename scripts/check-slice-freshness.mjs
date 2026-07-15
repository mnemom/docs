#!/usr/bin/env node
/**
 * check-slice-freshness.mjs — committed-slice vs live OpenAPI drift check.
 *
 * The committed `api-reference/openapi.json` slice is the source of truth for
 * `generate-api-reference.mjs` (endpoint pages + nav) and
 * `check-internal-refs.mjs`. `openapi-freshness.yml` re-syncs + git-diffs it,
 * but that gate only triggers on a schedule (Mondays) or on PRs touching
 * `api-reference/openapi.json` / `scripts/sync-openapi.mjs` — so a PR that
 * edits `api-reference/endpoint/**` pages or `docs.json` WITHOUT touching
 * `openapi.json` never revalidates the committed slice against production, and
 * can ship pages describing a slice that has since drifted.
 *
 * This read-only check closes that gap: it reads the committed slice, fetches
 * (or reads) the live customer slice, and emits the explicit diff line
 *   `committed-slice vs live: N paths added / M removed / K changed (ops +A / -R)`
 * plus a machine-readable JSON payload. It NEVER writes any file and NEVER
 * auto-commits — it preserves the human-review contract `openapi-freshness.yml`
 * already documents; a human runs `node scripts/sync-openapi.mjs &&
 * node scripts/generate-api-reference.mjs` and opens a refresh PR.
 *
 * The normalization/diff logic lives in `scripts/lib/openapi-slice.mjs` — the
 * SAME lib `sync-openapi.mjs` uses — so this check can never disagree with the
 * Monday gate. Uses only Node built-ins (global `fetch`, `AbortController`,
 * `node:fs`) — no dependency, no lockfile change.
 *
 * This is on-demand / CLI tooling; wiring it into a workflow path trigger is a
 * separate operator PR (a new/modified `.github/workflows/**` file is a
 * NEVER-AUTO surface for this lane). See specs/docs-validators-health.md for
 * the exact wiring hook.
 *
 * ── Exit-code contract ──────────────────────────────────────────────────
 *   Default (strict / blocking):
 *     0 = FRESH        — committed slice byte-matches live (0/0/0 drift).
 *     1 = DRIFT        — committed slice differs from live (≥1 added/removed/
 *                        changed). Signal to re-sync + open a refresh PR.
 *     2 = CANNOT VERIFY — committed file missing/unparseable, live
 *                         fetch/HTTP/JSON error, live leaked staff paths, or
 *                         live had no paths. Fails CLOSED — never "fresh".
 *   `--soft` (advisory):
 *     0 = FRESH or DRIFT — drift is downgraded to an advisory warning; the
 *                          diff line is still printed (satisfies the
 *                          "emit an explicit diff line" AC without blocking).
 *     2 = CANNOT VERIFY  — UNCHANGED from strict: a genuine inability to
 *                          reach/parse live still surfaces as 2 even in soft
 *                          mode, so soft never silently masks a broken live
 *                          endpoint. `1` is never returned in `--soft` mode.
 *
 * Flags:
 *   --soft               Downgrade DRIFT (exit 1) to an advisory (exit 0).
 *   --url <url>          Live slice URL (default MNEMOM_OPENAPI_URL or
 *                        https://api.mnemom.ai/openapi.json).
 *   --spec-path <file>   Read the live slice from a local file instead of the
 *                        network (offline testing; also OPENAPI_SPEC_PATH).
 *   --timeout <ms>       Per-request timeout (default 8000).
 *   --verbose            Pretty-print the JSON payload.
 *   --help, -h           Show usage and exit 0.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";

import { assertCustomerOnly, diffSlices } from "./lib/openapi-slice.mjs";

const DEFAULT_URL = "https://api.mnemom.ai/openapi.json";
const COMMITTED = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "api-reference",
  "openapi.json",
);

// ── CLI ────────────────────────────────────────────────────────────────────
const args = argv.slice(2);
let soft = false;
let verbose = false;
let url = env.MNEMOM_OPENAPI_URL || DEFAULT_URL;
let specPath = env.OPENAPI_SPEC_PATH || null;
let timeout = 8000;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const needsValue = (flag) => {
    if (i + 1 >= args.length) {
      stderr.write(`${flag} requires a value\n`);
      exit(2);
    }
    return args[++i];
  };
  if (arg === "--soft") soft = true;
  else if (arg === "--verbose") verbose = true;
  else if (arg === "--url") url = needsValue("--url");
  else if (arg === "--spec-path") specPath = needsValue("--spec-path");
  else if (arg === "--timeout") {
    const raw = needsValue("--timeout");
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      stderr.write(`--timeout must be a positive number of milliseconds (got "${raw}")\n`);
      exit(2);
    }
    timeout = parsed;
  } else if (arg === "--help" || arg === "-h") {
    stdout.write(
      "Usage: check-slice-freshness.mjs [--soft] [--url <url>] [--spec-path <file>]\n" +
        "                                 [--timeout <ms>] [--verbose]\n" +
        "\n" +
        "Revalidates the committed api-reference/openapi.json slice against the live\n" +
        "customer slice and prints the drift line + JSON payload. Read-only; never\n" +
        "writes or auto-commits.\n" +
        "\n" +
        "Exit codes — default (strict):\n" +
        "  0  FRESH        committed slice byte-matches live (0/0/0)\n" +
        "  1  DRIFT        committed slice differs — re-sync + open a refresh PR\n" +
        "  2  CANNOT VERIFY  committed file / live fetch / staff-leak / empty-live\n" +
        "                    error — fails closed, never reported as fresh\n" +
        "Exit codes — --soft (advisory):\n" +
        "  0  FRESH or DRIFT  drift downgraded to advisory; diff line still printed\n" +
        "  2  CANNOT VERIFY   unchanged from strict (never masks a broken live)\n",
    );
    exit(0);
  } else {
    stderr.write(`Unknown flag: ${arg}\n`);
    exit(2);
  }
}

// Fail closed (exit 2, CANNOT VERIFY) with a clear message.
function cannotVerify(message) {
  stderr.write(`check-slice-freshness: cannot verify — ${message}\n`);
  exit(2);
}

// ── Read the committed slice ────────────────────────────────────────────────
// If it can't be read/parsed we must NOT report "fresh" — fail closed.
if (!existsSync(COMMITTED)) {
  cannotVerify(`committed slice ${COMMITTED} does not exist`);
}
let committed;
try {
  committed = JSON.parse(readFileSync(COMMITTED, "utf8"));
} catch (err) {
  cannotVerify(`committed slice ${COMMITTED} is unparseable: ${err.message}`);
}

// ── Resolve the live slice (local file or network) ──────────────────────────
async function fetchLive(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(target, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      cannotVerify(`fetch ${target} -> ${res.status}`);
    }
    try {
      return await res.json();
    } catch (err) {
      cannotVerify(`live slice from ${target} is not valid JSON: ${err.message}`);
    }
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timeout after ${timeout}ms` : err?.message || String(err);
    cannotVerify(`fetch ${target} failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

let live;
if (specPath) {
  if (!existsSync(specPath)) {
    cannotVerify(`--spec-path ${specPath} does not exist`);
  }
  try {
    live = JSON.parse(readFileSync(specPath, "utf8"));
  } catch (err) {
    cannotVerify(`--spec-path ${specPath} is unparseable: ${err.message}`);
  }
} else {
  live = await fetchLive(url);
}

// ── Guards on the live slice (fail closed) ──────────────────────────────────
// Staff-path leak → refuse (mirrors sync-openapi's refuse).
try {
  assertCustomerOnly(live);
} catch (err) {
  cannotVerify(err.message);
}
// Cold-start / bad-fetch: an empty/absent live `paths` must NOT render as
// "everything removed" (a giant false drift) NOR as "fresh" (MNE-442).
if (!live?.paths || Object.keys(live.paths).length === 0) {
  cannotVerify("live spec has no paths — refusing to compare (likely a bad fetch)");
}

// ── Diff + report ───────────────────────────────────────────────────────────
const diff = diffSlices(committed, live);
const verdict = diff.byteEqual ? "fresh" : "drift";
const checkedAt = new Date().toISOString();

const payload = {
  verdict,
  byteEqual: diff.byteEqual,
  pathsAdded: diff.pathsAdded,
  pathsRemoved: diff.pathsRemoved,
  pathsChanged: diff.pathsChanged,
  opsAdded: diff.opsAdded,
  opsRemoved: diff.opsRemoved,
  summaryLine: diff.summaryLine,
  checkedAt,
};

// ALWAYS print the human diff line (satisfies the AC) + JSON payload.
stdout.write(diff.summaryLine + "\n");
stdout.write(JSON.stringify(payload, null, verbose ? 2 : 0) + "\n");

if (verdict === "drift" && soft) {
  stderr.write(
    "check-slice-freshness: DRIFT (advisory — --soft) — run " +
      "'node scripts/sync-openapi.mjs && node scripts/generate-api-reference.mjs' " +
      "and open a refresh PR.\n",
  );
} else if (verdict === "drift") {
  stderr.write(
    "check-slice-freshness: DRIFT — the committed slice is stale vs the live " +
      "customer surface. Run 'node scripts/sync-openapi.mjs && " +
      "node scripts/generate-api-reference.mjs' and open a refresh PR.\n",
  );
}

// Strict: 0 fresh / 1 drift. Soft: 0 for both (CANNOT VERIFY already exited 2).
exit(verdict === "drift" && !soft ? 1 : 0);
