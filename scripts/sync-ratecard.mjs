#!/usr/bin/env node
// scripts/sync-ratecard.mjs — refresh (or verify) the committed rate-card extract.
//
// The rate card lives in the PRIVATE mnemom/mnemom-billing repo, so docs CI cannot
// read it with the default GITHUB_TOKEN. Instead the prices are vendored: this
// script reduces one rate-card YAML to scripts/ratecard-snapshot.json (public
// fields only — see scripts/lib/ratecard.mjs), which is committed. The pricing
// page is then checked against that file offline on every PR.
//
// Usage:
//   node scripts/sync-ratecard.mjs --file <path/to/ratecard.yaml> --ref <label>
//       Build the extract from a local YAML (e.g. a mnemom-billing checkout).
//   node scripts/sync-ratecard.mjs [--path ratecards/<v>.yaml] [--ref <git ref>]
//       Fetch the YAML from mnemom/mnemom-billing through the GitHub API. Needs a
//       token that can read that repo in GH_TOKEN or GITHUB_TOKEN. --path defaults
//       to the path recorded in the current snapshot; --ref defaults to main.
//   node scripts/sync-ratecard.mjs --check [--ref <git ref>]
//       Fetch from mnemom-billing (main unless --ref names another ref, e.g. the
//       head of a rate-card PR) and write nothing. Exit 1 if
//         (a) the pinned rate card on main no longer matches the snapshot, or
//         (b) the rate card that is in force LAST (latest effectiveAt on main)
//             changes a price the page shows (peg, margin, overdraft, or a
//             listed class), or
//         (c) the ledger code the page's expiry section describes has changed:
//             the lot expiry interval in server/src/ledger/engine.ts is no longer
//             LOT_EXPIRY_MONTHS, or server/src/ledger/holds.ts now resets a lot's
//             clock on settle (the page documents that it does not).
//       This is what the scheduled workflow runs.
//
// Exit codes: 0 ok, 1 drift, 2 usage / fetch / parse error.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import {
  LOT_EXPIRY_MONTHS,
  RATECARD_REPO,
  REQUIRED_PAGE_CLASSES,
  extractRatecard,
  pageRelevantDiff,
  parsePricingPage,
  pricingFields,
  serializeExtract,
} from "./lib/ratecard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "scripts", "ratecard-snapshot.json");
const PAGE = join(ROOT, "pricing", "overview.mdx");

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) usage(`${name} needs a value`);
  return v;
}

function usage(msg) {
  process.stderr.write(`sync-ratecard: ${msg}\n`);
  process.exit(2);
}

function readSnapshot() {
  try {
    return JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  } catch {
    return null;
  }
}

async function gh(apiPath, accept) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) usage(`reading ${RATECARD_REPO} needs a token in GH_TOKEN or GITHUB_TOKEN`);
  const res = await fetch(`https://api.github.com/repos/${RATECARD_REPO}/${apiPath}`, {
    headers: {
      accept,
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "mnemom-docs-sync-ratecard",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) usage(`GET ${apiPath} -> ${res.status}`);
  return accept.endsWith("raw") ? res.text() : res.json();
}

const fetchFile = (path, ref) =>
  gh(`contents/${path}?ref=${encodeURIComponent(ref)}`, "application/vnd.github.raw");

async function check() {
  const snap = readSnapshot();
  if (!snap) usage(`cannot read ${SNAPSHOT}`);
  const ref = arg("--ref") || "main";
  const failures = [];

  const pinnedText = await fetchFile(snap.source.path, ref);
  if (pinnedText === null) {
    failures.push(
      `${snap.source.path} (the rate card the page is pinned to) is not on ${RATECARD_REPO}@${ref}. ` +
        "Either it has not merged yet or it was renamed.",
    );
  } else {
    const live = extractRatecard(pinnedText, { path: snap.source.path, ref });
    const a = JSON.stringify(pricingFields(snap));
    const b = JSON.stringify(pricingFields(live));
    if (a !== b) failures.push(`${snap.source.path} on ${ref} differs from scripts/ratecard-snapshot.json`);
  }

  // Which rate card is in force last? mu_rate_for is latest-effective-wins.
  const listing = (await gh(`contents/ratecards?ref=${ref}`, "application/vnd.github+json")) || [];
  let latest = null;
  for (const f of listing) {
    if (f.type !== "file" || !/\.ya?ml$/.test(f.name)) continue;
    const text = await fetchFile(f.path, ref);
    const doc = parseYaml(text);
    if (!doc?.effectiveAt) continue;
    if (!latest || doc.effectiveAt > latest.effectiveAt) latest = { effectiveAt: doc.effectiveAt, path: f.path, text };
  }
  if (latest && latest.path !== snap.source.path) {
    const latestExtract = extractRatecard(latest.text, { path: latest.path, ref });
    let pageClasses = REQUIRED_PAGE_CLASSES;
    try {
      pageClasses = parsePricingPage(readFileSync(PAGE, "utf8")).rows.map((r) => r.class);
    } catch {
      /* fall back to the required set; the offline page check reports the page error */
    }
    const diffs = pageRelevantDiff(snap, latestExtract, pageClasses);
    if (diffs.length) {
      failures.push(
        `${latest.path} (effective ${latest.effectiveAt}) changes prices the page shows: ${diffs.join("; ")}. ` +
          "Re-sync the snapshot from that card and update pricing/overview.mdx.",
      );
    } else {
      process.stderr.write(
        `sync-ratecard: latest card ${latest.path} (effective ${latest.effectiveAt}) keeps every price the page shows\n`,
      );
    }
  }

  failures.push(...(await checkLedgerFacts(ref)));

  if (failures.length) {
    for (const f of failures) process.stderr.write(`::error::${f}\n`);
    process.exit(1);
  }
  process.stderr.write(`sync-ratecard: snapshot ${snap.version} matches ${RATECARD_REPO}@${ref}\n`);
}

// The expiry section of the page is not on the rate card; it describes ledger code.
async function checkLedgerFacts(ref) {
  const failures = [];
  const engine = await fetchFile("server/src/ledger/engine.ts", ref);
  if (engine === null) {
    failures.push(`server/src/ledger/engine.ts is not on ${RATECARD_REPO}@${ref}; cannot confirm the ${LOT_EXPIRY_MONTHS}-month lot expiry`);
  } else {
    const months = [...engine.matchAll(/latest_usage_at \+ interval '(\d+) months?'/g)].map((m) => Number(m[1]));
    if (months.length === 0 || months.some((m) => m !== LOT_EXPIRY_MONTHS)) {
      failures.push(
        `lot expiry in server/src/ledger/engine.ts on ${ref} is ${months.length ? months.join("/") : "not found"} months; ` +
          `the page and LOT_EXPIRY_MONTHS say ${LOT_EXPIRY_MONTHS}`,
      );
    }
  }
  const holds = await fetchFile("server/src/ledger/holds.ts", ref);
  if (holds !== null && holds.includes("latest_usage_at")) {
    failures.push(
      `server/src/ledger/holds.ts on ${ref} now touches latest_usage_at; the page says a settled reservation does not ` +
        "restart a lot's expiry clock. Re-read the code and update 'When μ expires' in pricing/overview.mdx.",
    );
  }
  return failures;
}

async function write() {
  const file = arg("--file");
  let path = arg("--path");
  let ref = arg("--ref");
  let text;
  if (file) {
    if (!ref) usage("--file needs --ref <label> to record where the YAML came from");
    text = readFileSync(resolve(file), "utf8");
    path = path || `ratecards/${file.split("/").pop()}`;
  } else {
    path = path || readSnapshot()?.source?.path;
    if (!path) usage("no --path given and no snapshot to take it from");
    ref = ref || "main";
    text = await fetchFile(path, ref);
    if (text === null) usage(`${path} not found on ${RATECARD_REPO}@${ref}`);
  }
  const extract = extractRatecard(text, { path, ref });
  writeFileSync(SNAPSHOT, serializeExtract(extract));
  process.stderr.write(`sync-ratecard: wrote ${SNAPSHOT} from ${path}@${ref} (${extract.version}, ${extract.classes.length} classes)\n`);
}

try {
  if (process.argv.includes("--check")) await check();
  else await write();
} catch (e) {
  usage(e.message);
}
