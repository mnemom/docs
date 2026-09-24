// Tests for the pricing-page ↔ rate-card gate (scripts/lib/ratecard.mjs).
// Run: npm run test:pricing-ratecard
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_PAGE_CLASSES,
  checkPageAgainstExtract,
  extractRatecard,
  pageRelevantDiff,
  parsePrice,
  pricingFields,
  usageMultiplier,
} from "./lib/ratecard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = readFileSync(join(ROOT, "pricing", "overview.mdx"), "utf8");
const SNAP = JSON.parse(readFileSync(join(ROOT, "scripts", "ratecard-snapshot.json"), "utf8"));

const problemsFor = (page, snap = SNAP) => checkPageAgainstExtract(page, snap);
const mustFail = (page, pattern, snap = SNAP) => {
  const problems = problemsFor(page, snap);
  assert.ok(problems.length > 0, "expected the gate to fail");
  assert.ok(problems.some((p) => pattern.test(p)), `no problem matched ${pattern}:\n${problems.join("\n")}`);
};
const clone = (o) => JSON.parse(JSON.stringify(o));

test("the committed page matches the committed snapshot", () => {
  assert.deepEqual(problemsFor(PAGE), []);
});

test("the snapshot is the pinned card and prices the gateway at 5x", () => {
  assert.equal(SNAP.version, "v2026-09-gateway");
  assert.equal(SNAP.peg.usd_per_mu, 0.01);
  assert.equal(usageMultiplier(SNAP.usage_margin_pct), 5);
  const by = Object.fromEntries(SNAP.classes.map((c) => [c.class, c]));
  for (const c of ["gateway.turn.governed", "gateway.sh.check", "gateway.context.fold", "kernel.observer.trace-analysis"]) {
    assert.equal(by[c].model, "usage", c);
  }
  assert.equal(by["analyze.checkpoint"].rate_mu, 5);
  assert.equal(by["analyze.zk-proof"].rate_mu, 100);
  assert.equal(by["rg.run.person-card"].rate_mu, 24900);
  assert.equal(by["rg.run.company-card"].rate_mu, 49900);
  for (const c of ["kernel.anchoring.base-l2", "kernel.egress.webhook", "kernel.egress.email"]) {
    assert.equal(by[c].rate_mu, 0, c);
  }
});

test("a changed fixed price on the page fails", () => {
  mustFail(PAGE.replace("| 5 μ per checkpoint |", "| 6 μ per checkpoint |"), /analyze\.checkpoint shows 6 μ but the rate card says 5 μ/);
  mustFail(PAGE.replace("24,900 μ ($249)", "19,900 μ ($199)"), /rg\.run\.person-card shows 19900 μ/);
});

test("a changed rate on the rate card fails the unchanged page", () => {
  const snap = clone(SNAP);
  snap.classes.find((c) => c.class === "analyze.zk-proof").rate_mu = 150;
  mustFail(PAGE, /analyze\.zk-proof shows 100 μ but the rate card says 150 μ/, snap);
});

test("a changed margin on the rate card fails the unchanged page", () => {
  const snap = clone(SNAP);
  snap.usage_margin_pct = 0.75; // 4x
  mustFail(PAGE, /says 5× but the rate card's margin implies 4×/, snap);
  mustFail(PAGE, /80% margin; the rate card margin is 75%/, snap);
});

test("a usage class shown with a fixed price fails", () => {
  mustFail(
    PAGE.replace("| `gateway.context.fold` | 5× measured model cost |", "| `gateway.context.fold` | 1 μ per fold |"),
    /gateway\.context\.fold is usage-priced/,
  );
});

test("a free class shown with a price fails", () => {
  mustFail(PAGE.replace("| `kernel.egress.webhook` | Free |", "| `kernel.egress.webhook` | 1 μ per delivery |"), /kernel\.egress\.webhook is free on the rate card/);
});

test("a class moving from free to charged on the rate card fails", () => {
  const snap = clone(SNAP);
  Object.assign(snap.classes.find((c) => c.class === "kernel.egress.email"), { model: "metered", rate_mu: 1 });
  mustFail(PAGE, /kernel\.egress\.email shows free but the rate card says 1 μ/, snap);
});

test("dropping a required class from the page fails", () => {
  const page = PAGE.split("\n").filter((l) => !l.includes("`kernel.observer.trace-analysis`")).join("\n");
  mustFail(page, /required class kernel\.observer\.trace-analysis is missing/);
});

test("every required class is on the committed page", () => {
  for (const c of REQUIRED_PAGE_CLASSES) assert.ok(PAGE.includes("`" + c + "`"), c);
});

test("an unknown or duplicated class fails", () => {
  const extra = "| Something new | `gateway.made.up` | Free |\n";
  mustFail(PAGE.replace("| Email delivery |", extra + "| Email delivery |"), /gateway\.made\.up is not a class/);
  const dup = "| Again | `kernel.egress.email` | Free |\n";
  mustFail(PAGE.replace("| Email delivery |", dup + "| Email delivery |"), /kernel\.egress\.email is listed more than once/);
});

test("a missing or doubled checked region fails closed", () => {
  mustFail(PAGE.replace("<!-- pricing-ratecard:start -->", ""), /exactly one/);
  mustFail(PAGE + "\n{/* <!-- pricing-ratecard:end --> */}\n", /exactly one/);
});

test("the region must name the snapshot's rate card version", () => {
  mustFail(PAGE.replace("`v2026-09-gateway`", "v2026-09-gateway"), /must name the rate card version/);
});

test("a wrong peg anywhere on the page fails", () => {
  mustFail(PAGE.replace("1 μ = $0.01 USD", "1 μ = $0.02 USD"), /1 μ = \$0\.02; the rate card peg is \$0\.01/);
});

test("a wrong multiplier in prose fails", () => {
  mustFail(PAGE.replace("**5× its measured model cost**", "**3× its measured model cost**"), /states 3× measured cost/);
});

test("retired pricing wording fails", () => {
  mustFail(PAGE + "\nSafe House is bundled into every governed turn.\n", /retired pricing wording — 'bundled'/);
  mustFail(PAGE + "\nEach governed turn costs $0.05 per request.\n", /flat per-request dollar price/);
  mustFail(PAGE + "\nPick a monthly subscription.\n", /subscription wording/);
});

test("parsePrice reads each price form", () => {
  assert.deepEqual(parsePrice("Free"), { kind: "free" });
  assert.deepEqual(parsePrice("**5× measured model cost** of the L2 call"), { kind: "usage", multiplier: 5 });
  assert.deepEqual(parsePrice("5x measured model cost"), { kind: "usage", multiplier: 5 });
  assert.deepEqual(parsePrice("49,900 μ ($499) per completed run"), { kind: "fixed", mu: 49900 });
  assert.deepEqual(parsePrice("100 µ per proof"), { kind: "fixed", mu: 100 });
  assert.equal(parsePrice("about a cent").kind, "unparseable");
});

test("usageMultiplier maps margin to a whole multiplier or throws", () => {
  assert.equal(usageMultiplier(0.8), 5);
  assert.equal(usageMultiplier(0.75), 4);
  assert.equal(usageMultiplier(0), 1);
  assert.throws(() => usageMultiplier(0.7), /non-integer/);
  assert.throws(() => usageMultiplier(null), /no usage_margin_pct/);
});

const YAML = `
version: v-test
effectiveAt: "2026-10-01T00:00:00Z"
peg: { mu_usd: 0.01, mmu_per_mu: 1000 }
usage_margin_pct: 0.80
classes:
  - { class: gateway.turn.governed, model: usage, unit: turn, notes: "internal" }
  - { class: analyze.checkpoint, model: metered, unit: checkpoint, rate_mu: 5 }
  - { class: kernel.egress.email, model: free_counted, rate_mu: 0 }
provider_cost_table:
  anthropic: { claude-haiku-4-5: { in_usd_per_m: 1.0, out_usd_per_m: 5.0 } }
`;

test("extractRatecard keeps only public pricing fields", () => {
  const ex = extractRatecard(YAML, { path: "ratecards/v-test.yaml", ref: "main" });
  assert.equal(ex.version, "v-test");
  assert.equal(ex.usage_margin_pct, 0.8);
  assert.deepEqual(ex.classes.map((c) => c.class), ["analyze.checkpoint", "gateway.turn.governed", "kernel.egress.email"]);
  const json = JSON.stringify(ex);
  assert.ok(!json.includes("provider_cost_table") && !json.includes("haiku") && !json.includes("internal"));
  assert.equal(ex.classes.find((c) => c.class === "gateway.turn.governed").rate_mu, null);
});

test("extractRatecard rejects malformed cards", () => {
  const src = { path: "p", ref: "r" };
  assert.throws(() => extractRatecard(YAML.replace("unit: turn,", "unit: turn, rate_mu: 5,"), src), /must not carry rate_mu/);
  assert.throws(() => extractRatecard(YAML.replace("rate_mu: 5 }", "}"), src), /no numeric rate_mu/);
  assert.throws(() => extractRatecard(YAML.replace("usage_margin_pct: 0.80", "usage_margin_pct: 1.2"), src), /usage_margin_pct/);
  assert.throws(() => extractRatecard(YAML.replace("version: v-test", ""), src), /missing `version`/);
});

test("a card without usage_margin_pct extracts as null margin", () => {
  const ex = extractRatecard(YAML.replace("usage_margin_pct: 0.80\n", ""), { path: "p", ref: "r" });
  assert.equal(ex.usage_margin_pct, null);
});

test("pageRelevantDiff sees changes to listed classes only", () => {
  const b = clone(SNAP);
  b.classes.find((c) => c.class === "coherence.report").rate_mu = 99; // not on the page
  assert.deepEqual(pageRelevantDiff(SNAP, b, REQUIRED_PAGE_CLASSES), []);
  Object.assign(b.classes.find((c) => c.class === "gateway.sh.check"), { model: "free_counted", rate_mu: 0 });
  b.usage_margin_pct = 0.75;
  const d = pageRelevantDiff(SNAP, b, REQUIRED_PAGE_CLASSES);
  assert.ok(d.some((x) => x.startsWith("gateway.sh.check: usage → free_counted 0 μ")), d.join("\n"));
  assert.ok(d.some((x) => x.startsWith("usage_margin_pct")), d.join("\n"));
});

test("pricingFields ignores provenance so a re-sync from another ref is not drift", () => {
  const b = clone(SNAP);
  b.source.ref = "main";
  assert.deepEqual(pricingFields(b), pricingFields(SNAP));
});
