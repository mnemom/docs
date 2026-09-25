// scripts/lib/ratecard.mjs — shared logic for the pricing-page ↔ rate-card gate.
//
// The public pricing page (pricing/overview.mdx) is hand-written, but every price
// on it comes from Mnemom's rate card: a versioned YAML file in the private
// mnemom/mnemom-billing repo (ratecards/<version>.yaml). Two scripts use this
// module so they can never disagree about what a price means:
//
//   scripts/sync-ratecard.mjs          — fetches a rate-card YAML, reduces it to
//                                        the small public extract committed at
//                                        scripts/ratecard-snapshot.json, and (with
//                                        --check) fails if the committed extract has
//                                        drifted from mnemom-billing main.
//   scripts/check-pricing-ratecard.mjs — offline: fails if the pricing page's
//                                        prices differ from the committed extract.
//
// The extract deliberately keeps only customer-facing fields (peg, usage margin,
// the card-level overdraft switch, and each class's rate model / unit / list rate). Provider cost tables, notes and
// internal commentary in the YAML are dropped: this docs repo is public.

import { parse as parseYaml } from "yaml";

export const RATECARD_REPO = "mnemom/mnemom-billing";

// Sentinels bounding the machine-checked region of the pricing page. Only table
// rows inside this region are parsed; prose elsewhere on the page is free text.
// In MDX the markers sit inside a JSX comment: {/* <!-- pricing-ratecard:start --> */}.
export const REGION_START = "<!-- pricing-ratecard:start -->";
export const REGION_END = "<!-- pricing-ratecard:end -->";

// Classes the page MUST list. These are the classes a customer can be charged for
// today, plus the non-LLM classes the page promises are free. Dropping one from
// the page is a failure, not a silent omission.
export const REQUIRED_PAGE_CLASSES = [
  "gateway.turn.governed",
  "gateway.sh.check",
  "gateway.context.fold",
  "kernel.observer.trace-analysis",
  "analyze.checkpoint",
  "analyze.zk-proof",
  "rg.run.person-card",
  "rg.run.company-card",
  "kernel.anchoring.base-l2",
  "kernel.egress.webhook",
  "kernel.egress.email",
];

// Wording from the retired pricing model that must not come back: Safe House
// "bundled" into the turn, flat per-request dollar prices, and plan subscriptions.
export const FORBIDDEN_PATTERNS = [
  { label: "'bundled' (Safe House and fold are billed as their own lines)", re: /\bbundled?\b/i },
  { label: "subscription wording (there are no plans to subscribe to)", re: /subscri(?:be|ption)/i },
  {
    label: "flat per-request dollar price",
    re: /\$\s?\d[\d.,]*\s*(?:per|\/|a|an|each)\s*(?:request|turn|call|check|screen|query)\b/i,
  },
];

// How long an unused lot of μ lasts. This is not on the rate card: it is ledger
// behaviour in mnemom-billing (server/src/ledger/engine.ts expireRetailCredits and
// the nightly sweep in server/src/index.ts: `latest_usage_at + interval '12 months'`).
// `sync-ratecard.mjs --check` re-reads that code on billing main and fails if the
// interval changes, so this constant cannot silently go stale.
export const LOT_EXPIRY_MONTHS = 12;

// A decimal number as written on the page: "24,900", "0.04", "1".
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const num = (t) => Number(t.replace(/,/g, ""));
// Money on the page is compared at 1e-9 of a dollar so float noise never matters.
const sameMoney = (a, b) => Math.abs(a - b) < 1e-9;

const CLASS_ID_RE = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/;

function fail(msg) {
  throw new Error(msg);
}

/**
 * Reduce a rate-card YAML document to the committed public extract.
 * @param {string} yamlText
 * @param {{ path: string, ref: string }} source
 */
export function extractRatecard(yamlText, source) {
  const doc = parseYaml(yamlText);
  if (!doc || typeof doc !== "object") fail("rate card: not a YAML mapping");
  if (typeof doc.version !== "string" || !doc.version) fail("rate card: missing `version`");
  if (typeof doc.effectiveAt !== "string") fail(`rate card ${doc.version}: missing \`effectiveAt\``);
  const peg = doc.peg || {};
  if (typeof peg.mu_usd !== "number") fail(`rate card ${doc.version}: missing \`peg.mu_usd\``);
  if (!Array.isArray(doc.classes) || doc.classes.length === 0) fail(`rate card ${doc.version}: no \`classes\``);

  if (doc.overdraft !== undefined && typeof doc.overdraft !== "boolean") {
    fail(`rate card ${doc.version}: overdraft must be true or false, got ${JSON.stringify(doc.overdraft)}`);
  }
  // Absent means the legacy behaviour (per-class overage allowlist in the ledger);
  // recorded as null so it is distinguishable from an explicit true.
  const overdraft = typeof doc.overdraft === "boolean" ? doc.overdraft : null;

  const margin = doc.usage_margin_pct ?? null;
  if (margin !== null && !(typeof margin === "number" && margin >= 0 && margin < 1)) {
    fail(`rate card ${doc.version}: usage_margin_pct must be a number in [0, 1), got ${margin}`);
  }

  const seen = new Set();
  const classes = doc.classes.map((c) => {
    if (!c || typeof c.class !== "string") fail(`rate card ${doc.version}: class entry without \`class\``);
    if (seen.has(c.class)) fail(`rate card ${doc.version}: duplicate class ${c.class}`);
    seen.add(c.class);
    if (typeof c.model !== "string") fail(`rate card ${doc.version}: ${c.class} has no \`model\``);
    const rate = c.rate_mu ?? null;
    if (c.model === "usage") {
      if (rate !== null) fail(`rate card ${doc.version}: usage class ${c.class} must not carry rate_mu`);
    } else if (typeof rate !== "number") {
      fail(`rate card ${doc.version}: ${c.model} class ${c.class} has no numeric rate_mu`);
    }
    return { class: c.class, model: c.model, unit: c.unit ?? null, rate_mu: rate };
  });
  classes.sort((a, b) => a.class.localeCompare(b.class));

  return {
    _note:
      "Public extract of a Mnemom rate card, generated by scripts/sync-ratecard.mjs. Do not hand-edit: " +
      "re-run the sync script. pricing/overview.mdx is checked against this file by " +
      "scripts/check-pricing-ratecard.mjs, and this file is checked against the rate card on the " +
      "billing repo's main branch by the scheduled 'Pricing rate card' workflow.",
    source: { repo: RATECARD_REPO, path: source.path, ref: source.ref },
    version: doc.version,
    effective_at: doc.effectiveAt,
    peg: { usd_per_mu: peg.mu_usd, mmu_per_mu: peg.mmu_per_mu ?? null },
    usage_margin_pct: margin,
    overdraft,
    classes,
  };
}

export function serializeExtract(extract) {
  return JSON.stringify(extract, null, 2) + "\n";
}

/** Everything in an extract that affects a price, i.e. all but provenance. */
export function pricingFields(extract) {
  const { _note, source, ...rest } = extract;
  return rest;
}

/**
 * The charge multiplier on measured model cost implied by a gross-margin target:
 * charge = cost / (1 - margin). 0.80 → 5. Must come out a whole number, because
 * the page states it as "N×".
 */
export function usageMultiplier(margin) {
  if (margin === null || margin === undefined) {
    fail("rate card has no usage_margin_pct, so the page cannot state a usage multiplier");
  }
  const m = 1 / (1 - margin);
  const r = Math.round(m);
  if (Math.abs(m - r) > 1e-9) fail(`usage_margin_pct ${margin} gives a non-integer multiplier ${m}`);
  return r;
}

// Trailing text a usage-priced cell may carry after "N× measured model cost".
// Anything else after the price is rejected, so a cell cannot state a charge
// (e.g. "…, including level 1") that the parser would otherwise ignore.
const USAGE_SUFFIXES = ["", " of the level 2 call"];

/**
 * Parse the price cell of a pricing-page table row. The WHOLE cell must be one of:
 *   Free
 *   N× measured model cost[ of the level 2 call]
 *   N μ[ ($X)][ per [completed ]<unit>]
 * Anything else is "unparseable", which the gate reports as a failure.
 */
export function parsePrice(cell) {
  const text = cell
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (/^free$/i.test(text)) return { kind: "free" };
  const usage = text.match(/^(\d+)\s*[×x]\s+(?:the\s+)?measured model cost(.*)$/i);
  if (usage && USAGE_SUFFIXES.includes(usage[2].toLowerCase())) return { kind: "usage", multiplier: Number(usage[1]) };
  const fixed = text.match(new RegExp(String.raw`^(${NUM})\s*[μµ](?:\s*\(\$(${NUM})\))?(?:\s+per\s+(?:completed\s+)?([a-z][a-z-]*))?$`));
  if (fixed) {
    const out = { kind: "fixed", mu: num(fixed[1]) };
    if (fixed[2] !== undefined) out.usd = num(fixed[2]);
    if (fixed[3] !== undefined) out.unit = fixed[3];
    return out;
  }
  return { kind: "unparseable", text };
}

function splitRow(line) {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  if (cells.every((c) => /^:?-{3,}:?$/.test(c))) return null; // separator row
  return cells;
}

/**
 * Extract the machine-checked region and its priced rows from the page.
 * @returns {{ region: string, rows: Array<{class: string, price: string, line: number}> }}
 */
export function parsePricingPage(mdx) {
  const starts = mdx.split(REGION_START).length - 1;
  const ends = mdx.split(REGION_END).length - 1;
  if (starts !== 1 || ends !== 1) {
    fail(`pricing page must contain exactly one ${REGION_START} … ${REGION_END} region (found ${starts} start, ${ends} end)`);
  }
  const startIdx = mdx.indexOf(REGION_START);
  const endIdx = mdx.indexOf(REGION_END);
  if (endIdx < startIdx) fail("pricing page region end marker comes before its start marker");
  const firstLine = mdx.slice(0, startIdx).split("\n").length;
  const region = mdx.slice(startIdx + REGION_START.length, endIdx);

  const rows = [];
  region.split("\n").forEach((line, i) => {
    const cells = splitRow(line);
    if (!cells) return;
    const ids = cells
      .map((c) => c.match(/^`([^`]+)`$/))
      .filter(Boolean)
      .map((m) => m[1])
      .filter((id) => CLASS_ID_RE.test(id));
    if (ids.length === 0) return; // header row or a row that names no class
    if (ids.length > 1) fail(`pricing page line ${firstLine + i}: a row names more than one class (${ids.join(", ")})`);
    rows.push({ class: ids[0], price: cells[cells.length - 1], line: firstLine + i });
  });
  return { region, rows };
}

/**
 * Compare the pricing page to a rate-card extract.
 * @returns {string[]} human-readable problems; empty means the page matches.
 */
export function checkPageAgainstExtract(mdx, extract) {
  const problems = [];
  let parsed;
  try {
    parsed = parsePricingPage(mdx);
  } catch (e) {
    return [e.message];
  }
  const { region, rows } = parsed;
  const byClass = new Map(extract.classes.map((c) => [c.class, c]));

  if (!region.includes("`" + extract.version + "`")) {
    problems.push(`the checked region must name the rate card version \`${extract.version}\``);
  }

  let multiplier = null;
  try {
    multiplier = usageMultiplier(extract.usage_margin_pct);
  } catch (e) {
    if (extract.classes.some((c) => c.model === "usage")) problems.push(e.message);
  }

  const onPage = new Set();
  for (const row of rows) {
    if (onPage.has(row.class)) {
      problems.push(`line ${row.line}: ${row.class} is listed more than once`);
      continue;
    }
    onPage.add(row.class);
    const cls = byClass.get(row.class);
    if (!cls) {
      problems.push(`line ${row.line}: ${row.class} is not a class on rate card ${extract.version}`);
      continue;
    }
    const price = parsePrice(row.price);
    if (price.kind === "unparseable") {
      problems.push(`line ${row.line}: cannot read the price "${price.text}" for ${row.class}`);
      continue;
    }
    if (cls.model === "usage") {
      if (price.kind !== "usage") {
        problems.push(`line ${row.line}: ${row.class} is usage-priced on the rate card; the page must say "${multiplier}× measured model cost"`);
      } else if (multiplier !== null && price.multiplier !== multiplier) {
        problems.push(`line ${row.line}: ${row.class} says ${price.multiplier}× but the rate card's margin implies ${multiplier}×`);
      }
    } else if (cls.rate_mu === 0) {
      if (price.kind !== "free") problems.push(`line ${row.line}: ${row.class} is free on the rate card; the page must say "Free"`);
    } else if (price.kind !== "fixed" || price.mu !== cls.rate_mu) {
      const shown = price.kind === "fixed" ? `${price.mu} μ` : price.kind;
      problems.push(`line ${row.line}: ${row.class} shows ${shown} but the rate card says ${cls.rate_mu} μ`);
    } else {
      if (price.usd !== undefined && !sameMoney(price.usd, cls.rate_mu * extract.peg.usd_per_mu)) {
        problems.push(
          `line ${row.line}: ${row.class} shows ${price.mu} μ as $${price.usd}; at the peg that is $${cls.rate_mu * extract.peg.usd_per_mu}`,
        );
      }
      if (price.unit !== undefined && cls.unit && price.unit !== cls.unit) {
        problems.push(`line ${row.line}: ${row.class} is priced per ${price.unit}; the rate card unit is ${cls.unit}`);
      }
    }
  }

  for (const req of REQUIRED_PAGE_CLASSES) {
    if (!onPage.has(req)) problems.push(`required class ${req} is missing from the checked region`);
  }

  // Page-wide facts stated in prose.
  const pegs = [...mdx.matchAll(/1\s*[μµ]\s*=\s*\$\s?([0-9.]+)/g)].map((m) => Number(m[1]));
  if (pegs.length === 0) problems.push(`the page must state the peg as "1 μ = $${extract.peg.usd_per_mu}"`);
  for (const p of pegs) {
    if (p !== extract.peg.usd_per_mu) problems.push(`the page states 1 μ = $${p}; the rate card peg is $${extract.peg.usd_per_mu}`);
  }
  if (extract.usage_margin_pct !== null) {
    const want = Math.round(extract.usage_margin_pct * 100);
    for (const m of mdx.matchAll(/(\d+)%\s+(?:gross\s+)?margin/gi)) {
      if (Number(m[1]) !== want) problems.push(`the page states a ${m[1]}% margin; the rate card margin is ${want}%`);
    }
    if (multiplier !== null) {
      for (const m of mdx.matchAll(/(\d+)\s*[×x]\s+(?:the\s+|its\s+)?measured\b/gi)) {
        if (Number(m[1]) !== multiplier) problems.push(`the page states ${m[1]}× measured cost; the rate card implies ${multiplier}×`);
      }
    }
  }

  problems.push(...checkMoneyPairs(mdx, extract));
  problems.push(...checkWorkedExample(mdx, multiplier));
  problems.push(...checkOverdraftWording(mdx, extract));
  problems.push(...checkExpiryWording(mdx));

  const lines = mdx.split("\n");
  for (const { label, re } of FORBIDDEN_PATTERNS) {
    lines.forEach((line, i) => {
      if (re.test(line)) problems.push(`line ${i + 1}: retired pricing wording — ${label}`);
    });
  }

  return problems;
}

const lineOf = (mdx, index) => mdx.slice(0, index).split("\n").length;

/**
 * Every "N μ ($X)", "N μ (worth $X …)" and "$X (N μ)" on the page must agree with
 * the peg, so a μ-only re-price cannot leave a stale dollar figure beside it.
 */
export function checkMoneyPairs(mdx, extract) {
  const problems = [];
  const peg = extract.peg.usd_per_mu;
  const muThenUsd = new RegExp(String.raw`(${NUM})\s*[μµ]\s*\((?:worth\s+)?\$\s?(${NUM})`, "g");
  const usdThenMu = new RegExp(String.raw`\$\s?(${NUM})\s*\((${NUM})\s*[μµ]\)`, "g");
  const pairs = [
    ...[...mdx.matchAll(muThenUsd)].map((m) => ({ mu: num(m[1]), usd: num(m[2]), at: m.index, text: m[0] })),
    ...[...mdx.matchAll(usdThenMu)].map((m) => ({ usd: num(m[1]), mu: num(m[2]), at: m.index, text: m[0] })),
  ];
  for (const p of pairs) {
    if (!sameMoney(p.mu * peg, p.usd)) {
      problems.push(`line ${lineOf(mdx, p.at)}: "${p.text.trim()}" — ${p.mu} μ is $${+(p.mu * peg).toFixed(10)} at the peg, not $${p.usd}`);
    }
  }
  return problems;
}

const WORKED_EXAMPLE_HEADING = "### A worked example";

/**
 * The worked example's arithmetic. In the section under WORKED_EXAMPLE_HEADING,
 * each "At N× that is C μ" must use the rate card's multiplier and equal N × the
 * most recent measured cost written as "(B μ)"; "T μ in total" must be the sum of
 * those charges. The section is required and must contain at least one step, so
 * rewording it out of the checked shape fails rather than going unchecked.
 */
export function checkWorkedExample(mdx, multiplier) {
  const start = mdx.indexOf(WORKED_EXAMPLE_HEADING);
  if (start === -1) return [`the page must keep a "${WORKED_EXAMPLE_HEADING}" section (its arithmetic is checked)`];
  const rest = mdx.slice(start + WORKED_EXAMPLE_HEADING.length);
  const next = rest.search(/\n#{1,3} /);
  const section = next === -1 ? rest : rest.slice(0, next);
  const base = start + WORKED_EXAMPLE_HEADING.length;
  const where = (i) => `line ${lineOf(mdx, base + i)}`;

  const events = [
    ...[...section.matchAll(new RegExp(String.raw`\((${NUM})\s*[μµ]\)`, "g"))].map((m) => ({ at: m.index, cost: num(m[1]) })),
    ...[...section.matchAll(new RegExp(String.raw`At\s+(\d+)\s*[×x]\s+that\s+is\s+(${NUM})\s*[μµ]`, "g"))].map((m) => ({
      at: m.index,
      n: Number(m[1]),
      charge: num(m[2]),
    })),
    ...[...section.matchAll(new RegExp(String.raw`(${NUM})\s*[μµ]\s+in\s+total`, "g"))].map((m) => ({ at: m.index, total: num(m[1]) })),
  ].sort((a, b) => a.at - b.at);

  const problems = [];
  let cost = null;
  const charges = [];
  let totals = 0;
  for (const e of events) {
    if (e.cost !== undefined) cost = e.cost;
    else if (e.charge !== undefined) {
      if (multiplier !== null && e.n !== multiplier) problems.push(`${where(e.at)}: the worked example uses ${e.n}×; the rate card implies ${multiplier}×`);
      if (cost === null) problems.push(`${where(e.at)}: the worked example charges ${e.charge} μ with no "(N μ)" measured cost before it`);
      else if (!sameMoney(e.n * cost, e.charge)) problems.push(`${where(e.at)}: the worked example says ${e.n}× ${cost} μ is ${e.charge} μ; it is ${+(e.n * cost).toFixed(10)} μ`);
      charges.push(e.charge);
      cost = null;
    } else {
      totals++;
      const sum = charges.reduce((a, b) => a + b, 0);
      if (!sameMoney(sum, e.total)) problems.push(`${where(e.at)}: the worked example total is ${e.total} μ but its charges add up to ${+sum.toFixed(10)} μ`);
    }
  }
  if (charges.length === 0) problems.push(`the worked example has no "At N× that is C μ" step to check`);
  if (totals === 0) problems.push(`the worked example has no "T μ in total" line to check`);
  return problems;
}

// Split prose into sentences. Lines are joined first because MDX paragraphs wrap.
function sentences(mdx) {
  return mdx
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/);
}

const OVERDRAFT_TOPIC = /\b(?:below (?:zero|0)|negative|overdraft|overdrawn|overdraw|credit line)\b/i;
const NEGATION = /\b(?:no|never|not|cannot|can't|won't|isn't|doesn't|don't)\b/i;
const NO_OVERDRAFT_STATEMENT = /\bnever goes below (?:zero|0)\b/i;

/**
 * When the card says overdraft: false, the page must say the balance never goes
 * below zero, and no sentence may talk about going below zero / a negative
 * balance / an overdraft without negating it. When the card allows overdraft,
 * the page must not promise that it never happens.
 */
export function checkOverdraftWording(mdx, extract) {
  const problems = [];
  const all = sentences(mdx);
  if (extract.overdraft === false) {
    if (!all.some((s) => NO_OVERDRAFT_STATEMENT.test(s))) {
      problems.push(`rate card ${extract.version} sets overdraft: false; the page must say the balance "never goes below 0"`);
    }
    for (const s of all) {
      if (OVERDRAFT_TOPIC.test(s) && !NEGATION.test(s)) {
        problems.push(`rate card ${extract.version} sets overdraft: false, but the page says: "${s.trim()}"`);
      }
    }
  } else if (extract.overdraft === true) {
    for (const s of all) {
      if (NO_OVERDRAFT_STATEMENT.test(s) || /\bno overdraft\b/i.test(s)) {
        problems.push(`rate card ${extract.version} allows overdraft, but the page says: "${s.trim()}"`);
      }
    }
  }
  return problems;
}

/** Every "N months" on the page must be the ledger's lot expiry, and one must be stated. */
export function checkExpiryWording(mdx) {
  const found = [...mdx.matchAll(/(\d+)[- ]months?\b/gi)];
  const problems = [];
  if (found.length === 0) problems.push(`the page must state that unused μ expires after ${LOT_EXPIRY_MONTHS} months`);
  for (const m of found) {
    if (Number(m[1]) !== LOT_EXPIRY_MONTHS) {
      problems.push(`line ${lineOf(mdx, m.index)}: the page says ${m[1]} months; unused lots expire after ${LOT_EXPIRY_MONTHS} months`);
    }
  }
  return problems;
}

/**
 * Differences between two extracts, restricted to what the page shows: the peg,
 * the usage margin, and the listed classes. Used to tell whether a newer rate
 * card on the billing repo would change a price the page states.
 */
export function pageRelevantDiff(a, b, classes) {
  const diffs = [];
  if (a.peg.usd_per_mu !== b.peg.usd_per_mu) diffs.push(`peg ${a.peg.usd_per_mu} → ${b.peg.usd_per_mu}`);
  if (a.usage_margin_pct !== b.usage_margin_pct) diffs.push(`usage_margin_pct ${a.usage_margin_pct} → ${b.usage_margin_pct}`);
  if ((a.overdraft ?? null) !== (b.overdraft ?? null)) diffs.push(`overdraft ${a.overdraft ?? null} → ${b.overdraft ?? null}`);
  const am = new Map(a.classes.map((c) => [c.class, c]));
  const bm = new Map(b.classes.map((c) => [c.class, c]));
  for (const id of classes) {
    const x = am.get(id);
    const y = bm.get(id);
    const fmt = (c) => (c ? `${c.model}${c.rate_mu === null ? "" : ` ${c.rate_mu} μ`}` : "absent");
    if (fmt(x) !== fmt(y)) diffs.push(`${id}: ${fmt(x)} → ${fmt(y)}`);
  }
  return diffs;
}
