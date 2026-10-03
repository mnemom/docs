// Tests for the pricing-page ↔ rate-card gate (scripts/lib/ratecard.mjs).
// Run: npm run test:pricing-ratecard
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INFERENCE_SHARE_CLASS,
  REQUIRED_PAGE_CLASSES,
  classMultiplier,
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

const AGENT = ["gateway.context.fold", "gateway.goal.judge", "gateway.goal.intent"];
const GOVERNANCE = ["gateway.turn.governed", "gateway.sh.check", "kernel.observer.trace-analysis"];

test("the snapshot is the pinned card: every gateway call at cost, a 4% share over all of them (scope all)", () => {
  assert.equal(SNAP.version, "v2026-10-share");
  assert.equal(SNAP.peg.usd_per_mu, 0.01);
  assert.equal(SNAP.inference_share_bps, 400);
  assert.equal(SNAP.inference_share_scope, "all");
  const by = Object.fromEntries(SNAP.classes.map((c) => [c.class, c]));
  for (const c of [...AGENT, ...GOVERNANCE]) {
    assert.equal(by[c].model, "usage", c);
    assert.equal(by[c].bucket, AGENT.includes(c) ? "agent" : "governance", c);
    assert.equal(classMultiplier(by[c], SNAP), 1, c);
  }
  assert.equal(by[INFERENCE_SHARE_CLASS].model, "usage");
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

test("a changed cost multiplier on the rate card fails the unchanged page", () => {
  const snap = clone(SNAP);
  snap.classes.find((c) => c.class === "gateway.goal.judge").cogs_multiplier = 5;
  mustFail(PAGE, /gateway\.goal\.judge says 1× but its cogs_multiplier is 5×/, snap);
});

test("a class with no cogs_multiplier falls back to the card margin, and a margin may be quoted only then", () => {
  const legacy = clone(SNAP);
  delete legacy.classes.find((c) => c.class === "gateway.context.fold").cogs_multiplier;
  mustFail(PAGE, /gateway\.context\.fold says 1× but the rate card's margin implies 5×/, legacy);
  // On the at-cost card no class is priced from the margin, so quoting one fails.
  mustFail(PAGE + "\nThat is an 80% margin.\n", /80% margin, but no class on rate card v2026-10-share is priced from the card margin/);
  const margin = clone(legacy);
  margin.usage_margin_pct = 0.75;
  mustFail(PAGE + "\nThat is an 80% margin.\n", /80% margin; the rate card margin is 75%/, margin);
});

test("the inference share: the page's percentage must be the card's", () => {
  const snap = clone(SNAP);
  snap.inference_share_bps = 500;
  mustFail(PAGE, /gateway\.turn\.inference-share says 4% but the rate card's inference share is 5%/, snap);
  mustFail(PAGE, /quotes a 4% inference share; the rate card's is 5%/, snap);
  mustFail(PAGE, /worked example uses a 4% share; the rate card's is 5%/, snap);
  mustFail(PAGE + "\nAgent sessions pay 3% of the forwarded inference spend.\n", /quotes a 3% inference share; the rate card's is 4%/);
  const none = clone(SNAP);
  delete none.inference_share_bps;
  delete none.inference_share_scope;
  mustFail(PAGE, /inference-share is listed but rate card v2026-10-share carries no inference_share_bps/, none);
  mustFail(
    PAGE.replace("4% of the forwarded inference spend, less the request's measured charges |", "Measured model cost |"),
    /gateway\.turn\.inference-share must read "4% of the forwarded inference spend/,
  );
});

test("every usage class on the card must be on the page", () => {
  const page = PAGE.split("\n").filter((l) => !l.includes("`gateway.goal.intent`")).join("\n");
  mustFail(page, /usage class gateway\.goal\.intent on rate card v2026-10-share is missing/);
  const share = PAGE.split("\n").filter((l) => !l.includes("`gateway.turn.inference-share`")).join("\n");
  mustFail(share, /usage class gateway\.turn\.inference-share on rate card v2026-10-share is missing/);
});

test("a usage class shown with a fixed price fails", () => {
  mustFail(
    PAGE.replace("| `gateway.context.fold` | Measured model cost |", "| `gateway.context.fold` | 1 μ per fold |"),
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
  mustFail(PAGE.replace("`v2026-10-share`", "v2026-10-share"), /must name the rate card version/);
});

test("a wrong peg anywhere on the page fails", () => {
  mustFail(PAGE.replace("1 μ = $0.01 USD", "1 μ = $0.02 USD"), /1 μ = \$0\.02; the rate card peg is \$0\.01/);
});

test("a wrong multiplier in prose fails", () => {
  mustFail(PAGE + "\nEach call is charged at 3× its measured cost.\n", /states 3× measured cost; the rate card charges 1×/);
});

test("retired pricing wording fails", () => {
  mustFail(PAGE + "\nSafe House is bundled into every governed turn.\n", /retired pricing wording — 'bundled'/);
  mustFail(PAGE + "\nEach governed turn costs $0.05 per request.\n", /flat per-request dollar price/);
  mustFail(PAGE + "\nPick a monthly subscription.\n", /subscription wording/);
});

test("review mutation (a): a stale dollar figure beside a μ price fails", () => {
  mustFail(PAGE.replace("24,900 μ ($249)", "24,900 μ ($299)"), /rg\.run\.person-card shows 24900 μ as \$299; at the peg that is \$249/);
  mustFail(PAGE.replace("24,900 μ ($249)", "24,900 μ ($299)"), /24900 μ is \$249 at the peg, not \$299/);
  mustFail(PAGE.replace("49,900 μ ($499)", "49,900 μ ($599)"), /49900 μ is \$499 at the peg, not \$599/);
  mustFail(PAGE.replace("$0.0004 (0.04 μ)", "$0.004 (0.04 μ)"), /0\.04 μ is \$0\.0004 at the peg, not \$0\.004/);
  // and a μ-only re-price on the rate card leaves the page's dollar figure stale:
  const snap = clone(SNAP);
  snap.classes.find((c) => c.class === "rg.run.person-card").rate_mu = 29900;
  mustFail(PAGE.replace("24,900 μ ($249)", "29,900 μ ($249)"), /shows 29900 μ as \$249; at the peg that is \$299/, snap);
});

test("review mutation (b): trailing text after a price fails", () => {
  mustFail(PAGE.replace("| `kernel.egress.webhook` | Free |", "| `kernel.egress.webhook` | Free, then 1 μ each |"), /cannot read the price "Free, then 1 μ each"/);
  mustFail(
    PAGE.replace("Measured model cost of the level 2 call |", "Measured model cost of every call, including level 1 |"),
    /cannot read the price "Measured model cost of every call, including level 1" for gateway\.sh\.check/,
  );
});

test("a fixed price with the wrong unit fails", () => {
  mustFail(PAGE.replace("| 5 μ per checkpoint |", "| 5 μ per batch |"), /analyze\.checkpoint is priced per batch; the rate card unit is checkpoint/);
});

test("review mutation (c): wrong worked-example arithmetic fails", () => {
  mustFail(PAGE.replace("At 1× that is 0.2 μ", "At 1× that is 0.3 μ"), /1× 0\.2 μ is 0\.3 μ; it is 0\.2 μ/);
  mustFail(PAGE.replace("At 1× that is 3 μ", "At 5× that is 15 μ"), /worked example uses 5×; the rate card charges 1×/);
  mustFail(PAGE.replace("10 μ in total", "10.24 μ in total"), /total is 10\.24 μ but its charges add up to 10 μ/);
  mustFail(PAGE.replace("### A worked example", "### An example"), /must keep a "### A worked example" section/);
  mustFail(PAGE.replace(/At\s+1× that is/g, "Once more that is").replace("4% of that is", "A share of"), /no "At N× that is C μ" step/);
});

test("review mutation (c): the worked example's inference share is checked", () => {
  mustFail(PAGE.replace("4% of that is 10 μ", "4% of that is 12 μ"), /4% of 250 μ is 12 μ; it is 10 μ/);
  mustFail(PAGE.replace("the larger of the two, 10 μ", "the larger of the two, 13 μ"), /larger of 10 μ and 3\.24 μ is 10 μ, not 13 μ/);
  mustFail(PAGE.replace("a 6.76 μ inference-share line", "a 7 μ inference-share line"), /inference-share line is 7 μ; it is 6\.76 μ/);
  // Scope all: governance is inside the comparison, so a larger fold plus governance
  // beats the share and there is no share line.
  const cogsWins = PAGE.replace("$0.03 (3 μ). At 1× that is 3 μ", "$0.15 (15 μ). At 1× that is 15 μ");
  mustFail(cogsWins, /larger of 10 μ and 15\.24 μ is 15\.24 μ, not 10 μ/);
});

test("review mutation (c): a wrong expiry period fails", () => {
  mustFail(PAGE.replace("12-month expiry", "24-month expiry"), /says 24 months; unused lots expire after 12 months/);
  mustFail(PAGE.replace(/12 months/g, "a year").replace(/12-month/g, "one-year"), /must state that unused μ expires after 12 months/);
});

test("the snapshot carries the card's overdraft switch", () => {
  assert.equal(SNAP.overdraft, false);
});

test("overdraft:false — permissive overdraft wording fails", () => {
  const permissive =
    "A turn that is already running when the balance runs out is allowed to finish and is charged in full, so a balance can end slightly below zero.";
  mustFail(PAGE.replace("To avoid a gap", permissive + "\n\nTo avoid a gap"), /sets overdraft: false, but the page says: "A turn that is already running/);
  mustFail(PAGE + "\nYour balance may go negative for a moment.\n", /sets overdraft: false, but the page says/);
  mustFail(PAGE + "\nWe offer a small overdraft on request.\n", /sets overdraft: false, but the page says/);
  mustFail(PAGE.replace(/never goes below 0 μ/g, "stays positive"), /must say the balance "never goes below 0"/);
});

test("overdraft:true — promising no overdraft fails; absent (legacy) is not checked", () => {
  const allow = clone(SNAP);
  allow.overdraft = true;
  mustFail(PAGE, /allows overdraft, but the page says/, allow);
  const legacy = clone(SNAP);
  legacy.overdraft = null;
  assert.deepEqual(problemsFor(PAGE + "\nA balance can dip below zero.\n", legacy), []);
});

test("parsePrice reads each price form", () => {
  assert.deepEqual(parsePrice("Free"), { kind: "free" });
  assert.deepEqual(parsePrice("**5× measured model cost** of the level 2 call"), { kind: "usage", multiplier: 5 });
  assert.deepEqual(parsePrice("5x measured model cost"), { kind: "usage", multiplier: 5 });
  assert.deepEqual(parsePrice("49,900 μ ($499) per completed run"), { kind: "fixed", mu: 49900, usd: 499, unit: "run" });
  assert.deepEqual(parsePrice("100 µ per proof"), { kind: "fixed", mu: 100, unit: "proof" });
  assert.deepEqual(parsePrice("5 μ"), { kind: "fixed", mu: 5 });
  assert.deepEqual(parsePrice("Measured model cost"), { kind: "usage", multiplier: 1 });
  assert.deepEqual(parsePrice("Measured model cost of the level 2 call"), { kind: "usage", multiplier: 1 });
  assert.deepEqual(parsePrice("4% of the forwarded inference spend, less the request's agent charges"), { kind: "share", pct: 4, against: "agent" });
  assert.deepEqual(parsePrice("4% of the forwarded inference spend, less the request's measured charges"), { kind: "share", pct: 4, against: "measured" });
  assert.equal(parsePrice("about a cent").kind, "unparseable");
});

test("inference_share_scope: the share row and the prose must say what the 4% is compared against", () => {
  // Scope all (the pinned card): the row nets the measured charges, and no sentence may
  // put governance on top. Observer trace analysis may (it runs later, off the request).
  mustFail(
    PAGE.replace("less the request's measured charges |", "less the request's agent charges |"),
    /must read "4% of the forwarded inference spend, less the request's measured charges" \(inference_share_scope all\)/,
  );
  mustFail(
    PAGE + "\nGovernance, when on, is charged at measured cost on top.\n",
    /nets governance inside the inference-share comparison \(scope all\), but the page says: ".*Governance, when on/,
  );
  assert.deepEqual(problemsFor(PAGE + "\nObserver trace analysis is charged on top.\n"), []);
  // Scope agent: the row nets agent charges only, and the page must say governance is on top.
  const agent = clone(SNAP);
  agent.inference_share_scope = "agent";
  mustFail(PAGE, /less the request's agent charges" \(inference_share_scope agent\)/, agent);
  mustFail(PAGE, /bills governance on top of the inference-share comparison \(scope agent\); the page must say so/, agent);
  // An absent scope is billing's default, agent.
  const absent = clone(SNAP);
  delete absent.inference_share_scope;
  mustFail(PAGE, /\(inference_share_scope agent\)/, absent);
});

test("parsePrice reads the whole cell, not a prefix", () => {
  for (const cell of [
    "Free, then 1 μ each",
    "Free for now",
    "5× measured model cost of every call, including level 1",
    "5× measured model cost, minimum 1 μ",
    "5 μ per checkpoint, plus 1 μ per item",
    "5 μ or more",
    "Measured model cost, plus 1 μ",
    "4% of the forwarded inference spend",
    "4% of the forwarded inference spend, less the request's agent charges, minimum 1 μ",
  ]) {
    assert.equal(parsePrice(cell).kind, "unparseable", cell);
  }
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

test("extractRatecard reads overdraft and rejects a non-boolean", () => {
  const src = { path: "p", ref: "r" };
  assert.equal(extractRatecard(YAML, src).overdraft, null);
  assert.equal(extractRatecard(YAML.replace("usage_margin_pct: 0.80", "usage_margin_pct: 0.80\noverdraft: false"), src).overdraft, false);
  assert.throws(() => extractRatecard(YAML.replace("usage_margin_pct: 0.80", "usage_margin_pct: 0.80\noverdraft: maybe"), src), /overdraft must be true or false/);
});

test("extractRatecard reads the inference share, buckets and multipliers only when the card sets them", () => {
  const src = { path: "p", ref: "r" };
  assert.equal("inference_share_bps" in extractRatecard(YAML, src), false);
  assert.equal("bucket" in extractRatecard(YAML, src).classes[1], false);
  const shared = YAML.replace("usage_margin_pct: 0.80", "usage_margin_pct: 0.80\ninference_share_bps: 400\ninference_share_scope: agent").replace(
    "unit: turn,",
    "unit: turn, bucket: governance, cogs_multiplier: 1,",
  );
  const ex = extractRatecard(shared, src);
  assert.equal(ex.inference_share_bps, 400);
  assert.equal(ex.inference_share_scope, "agent");
  assert.deepEqual(ex.classes.find((c) => c.class === "gateway.turn.governed"), {
    class: "gateway.turn.governed",
    model: "usage",
    unit: "turn",
    rate_mu: null,
    bucket: "governance",
    cogs_multiplier: 1,
  });
  assert.throws(() => extractRatecard(shared.replace("inference_share_bps: 400", "inference_share_bps: 0"), src), /inference_share_bps/);
  assert.throws(() => extractRatecard(shared.replace("scope: agent", "scope: some"), src), /inference_share_scope/);
  assert.throws(() => extractRatecard(shared.replace("bucket: governance", "bucket: other"), src), /bucket/);
  assert.throws(() => extractRatecard(shared.replace("cogs_multiplier: 1", "cogs_multiplier: 0.5"), src), /cogs_multiplier/);
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
  b.overdraft = true;
  const d = pageRelevantDiff(SNAP, b, REQUIRED_PAGE_CLASSES);
  assert.ok(d.includes("overdraft false → true"), d.join("\n"));
  assert.ok(d.some((x) => x.startsWith("gateway.sh.check: usage governance 1× → free_counted 0 μ")), d.join("\n"));
  const share = clone(SNAP);
  share.inference_share_bps = 500;
  share.classes.find((c) => c.class === "gateway.goal.judge").cogs_multiplier = 2;
  const ds = pageRelevantDiff(SNAP, share, ["gateway.goal.judge"]);
  assert.ok(ds.includes("inference_share_bps 400 → 500"), ds.join("\n"));
  assert.ok(ds.includes("gateway.goal.judge: usage agent 1× → usage agent 2×"), ds.join("\n"));
  assert.ok(d.some((x) => x.startsWith("usage_margin_pct")), d.join("\n"));
});

test("pricingFields ignores provenance so a re-sync from another ref is not drift", () => {
  const b = clone(SNAP);
  b.source.ref = "main";
  assert.deepEqual(pricingFields(b), pricingFields(SNAP));
});
