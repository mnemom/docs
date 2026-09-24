#!/usr/bin/env node
// scripts/check-pricing-ratecard.mjs — the pricing page must match the rate card.
//
// Offline and secret-free, so it runs on every PR (including forks). It compares
// the prices stated in pricing/overview.mdx — the table rows between the
// `<!-- pricing-ratecard:start -->` / `<!-- pricing-ratecard:end -->` markers, plus
// the peg, the margin and the "N× measured" multiplier anywhere on the page —
// with scripts/ratecard-snapshot.json, the committed extract of the rate card.
// It also fails on wording from the retired pricing model (Safe House "bundled"
// into the turn, flat per-request dollar prices, subscriptions).
//
// Whether the snapshot itself still matches the rate card on mnemom-billing main
// is a separate, token-gated check: `node scripts/sync-ratecard.mjs --check`.
//
// Exit 0 when the page matches, 1 with a list of problems when it does not.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkPageAgainstExtract } from "./lib/ratecard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = process.env.PRICING_PAGE || join(ROOT, "pricing", "overview.mdx");
const SNAPSHOT = process.env.RATECARD_SNAPSHOT || join(ROOT, "scripts", "ratecard-snapshot.json");

const extract = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const problems = checkPageAgainstExtract(readFileSync(PAGE, "utf8"), extract);

if (problems.length) {
  process.stderr.write(`check-pricing-ratecard: pricing/overview.mdx does not match rate card ${extract.version}:\n`);
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.exit(1);
}
process.stderr.write(`check-pricing-ratecard: pricing/overview.mdx matches rate card ${extract.version}\n`);
