#!/usr/bin/env node
/**
 * probe-docs-origin-edge.mjs — Origin-vs-edge attribution probe for
 * docs.mnemom.ai.
 *
 * At alert time, tells an on-call responder whether a docs outage (e.g. a
 * sustained HTTP 403) is a Mintlify *origin* fault or a Cloudflare
 * *edge/DNS* fault, and attaches the supporting response headers — so the
 * manual triage that cost ≈5.5 min during incident 980582706 is done for
 * free. See `scripts/lib/origin-edge-attribution.mjs` for the pure
 * classification core.
 *
 * This is on-demand tooling — NOT a scheduled CI workflow (a new/modified
 * GitHub Actions workflow is a NEVER-AUTO surface for this lane). A human
 * may later wire it into CI or ops-responder.
 *
 * All network I/O lives here; all decision logic lives in the library.
 * Uses only Node built-ins (global `fetch`, `AbortController`) — no
 * dependency, no lockfile change.
 *
 * It performs two requests:
 *   1. edge   — the public URL (through Cloudflare).
 *   2. origin — the configurable origin-direct endpoint (no origin
 *               hostname is hard-coded; it is public config, no secrets).
 * It builds an observation object per request, calls `classifyAttribution`,
 * prints a machine-readable JSON payload, and exits per the contract below.
 * A network failure is a data point, not a crash — it is never rethrown.
 *
 *   Exits 0 when the verdict is `healthy`.
 *   Exits 1 for any attributed-down / indeterminate verdict.
 *   Exits 2 on bad CLI usage.
 *
 * Flags:
 *   --url <url>          Public edge URL (default https://docs.mnemom.ai/).
 *   --origin-url <url>   Origin-direct URL to probe. If omitted, origin
 *                        health is unknown (→ indeterminate).
 *   --origin-host <host> Host header to send to the edge IP when probing
 *                        origin-direct via --url's host (alternative to
 *                        --origin-url).
 *   --timeout <ms>       Per-request timeout (default 8000).
 *   --verbose            Also print a human-readable line and pretty JSON.
 *   --help, -h           Show usage and exit 0.
 */

import { argv, exit } from "node:process";

import { classifyAttribution } from "./lib/origin-edge-attribution.mjs";

// ── CLI ──────────────────────────────────────────────────────────────────
const args = argv.slice(2);
let url = "https://docs.mnemom.ai/";
let originUrl = null;
let originHost = null;
let timeout = 8000;
let verbose = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const needsValue = (flag) => {
    if (i + 1 >= args.length) {
      console.error(`${flag} requires a value`);
      exit(2);
    }
    return args[++i];
  };
  if (arg === "--verbose") verbose = true;
  else if (arg === "--url") url = needsValue("--url");
  else if (arg === "--origin-url") originUrl = needsValue("--origin-url");
  else if (arg === "--origin-host") originHost = needsValue("--origin-host");
  else if (arg === "--timeout") {
    const raw = needsValue("--timeout");
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      console.error(`--timeout must be a positive number of milliseconds (got "${raw}")`);
      exit(2);
    }
    timeout = parsed;
  } else if (arg === "--help" || arg === "-h") {
    console.log(
      "Usage: probe-docs-origin-edge.mjs [--url <url>] [--origin-url <url>]\n" +
        "                                 [--origin-host <host>] [--timeout <ms>] [--verbose]\n" +
        "\n" +
        "Attributes a docs.mnemom.ai outage to the Cloudflare edge or the\n" +
        "Mintlify origin. Exits 0 (healthy), 1 (attributed-down/indeterminate),\n" +
        "or 2 (bad CLI usage).",
    );
    exit(0);
  } else {
    console.error(`Unknown flag: ${arg}`);
    exit(2);
  }
}

// ── Network I/O ────────────────────────────────────────────────────────────
// Extract only the headers the classifier reads — never dump full bodies.
const HEADERS_OF_INTEREST = ["cf-ray", "cf-cache-status", "x-vercel-id", "server"];

function pickHeaders(headers) {
  const out = {};
  for (const key of HEADERS_OF_INTEREST) {
    const value = headers.get(key);
    if (value != null) out[key] = value;
  }
  return out;
}

/**
 * Perform one probe and return an observation object
 * `{ ok, status, headers, error }`. A network error / timeout is
 * normalized to `{ ok: false, status: null, headers: {}, error }` — a data
 * point, never a thrown rejection.
 */
async function probe(target, { host } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const init = { redirect: "manual", signal: controller.signal };
    if (host) init.headers = { Host: host };
    const response = await fetch(target, init);
    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      headers: pickHeaders(response.headers),
      error: null,
    };
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timeout after ${timeout}ms` : err?.message || String(err);
    return { ok: false, status: null, headers: {}, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
const observedAt = new Date().toISOString();

const edge = await probe(url);

let origin = null;
if (originUrl) {
  origin = await probe(originUrl);
} else if (originHost) {
  // Probe origin-direct by sending the origin Host header to the public URL.
  origin = await probe(url, { host: originHost });
}
// If neither --origin-url nor --origin-host was supplied, origin stays null
// (not probed) → the classifier reports `indeterminate`, never `healthy`.

const attribution = classifyAttribution({ edge, origin, observedAt });

const payload = { url, originUrl, originHost, edge, origin, ...attribution };

console.log(JSON.stringify(payload, null, verbose ? 2 : 0));

if (verbose) {
  console.error(
    `\n${attribution.verdict} (${attribution.confidence}) — ${attribution.reason}\n` +
      `  edge:   ${edge.status ?? edge.error ?? "?"}${edge.ok ? " (ok)" : ""}\n` +
      `  origin: ${origin ? `${origin.status ?? origin.error ?? "?"}${origin.ok ? " (ok)" : ""}` : "not probed"}`,
  );
}

exit(attribution.verdict === "healthy" ? 0 : 1);
