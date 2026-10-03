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
// the card-level overdraft switch, the inference share and its scope, and each
// class's rate model / unit / list rate / bucket / cost multiplier). Provider cost
// tables, notes and internal commentary in the YAML are dropped: this docs repo is
// public.

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

// The per-request inference-share class. It is `model: usage` on the card, but it
// is priced by the share rule (a percentage of the customer's forwarded inference
// spend), never as a multiple of measured model cost.
export const INFERENCE_SHARE_CLASS = "gateway.turn.inference-share";

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

  const bps = doc.inference_share_bps ?? null;
  if (bps !== null && !(Number.isInteger(bps) && bps >= 1 && bps <= 10000)) {
    fail(`rate card ${doc.version}: inference_share_bps must be an integer in [1, 10000], got ${bps}`);
  }
  const scope = doc.inference_share_scope ?? null;
  if (scope !== null && scope !== "agent" && scope !== "all") {
    fail(`rate card ${doc.version}: inference_share_scope must be agent or all, got ${JSON.stringify(scope)}`);
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
    const out = { class: c.class, model: c.model, unit: c.unit ?? null, rate_mu: rate };
    // Bucket and cost multiplier only appear on cards that set them, so an older
    // card's extract keeps its exact shape.
    if (c.bucket !== undefined) {
      if (c.bucket !== "agent" && c.bucket !== "governance") {
        fail(`rate card ${doc.version}: ${c.class} has bucket ${JSON.stringify(c.bucket)}`);
      }
      out.bucket = c.bucket;
    }
    if (c.cogs_multiplier !== undefined) {
      if (!(typeof c.cogs_multiplier === "number" && c.cogs_multiplier >= 1)) {
        fail(`rate card ${doc.version}: ${c.class} cogs_multiplier must be a number >= 1`);
      }
      out.cogs_multiplier = c.cogs_multiplier;
    }
    return out;
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
    ...(bps !== null ? { inference_share_bps: bps, inference_share_scope: scope } : {}),
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

/**
 * The multiplier on measured model cost one usage class is charged at: its own
 * `cogs_multiplier` when the card sets one, otherwise the card margin's.
 */
export function classMultiplier(cls, extract) {
  if (cls.cogs_multiplier !== undefined) return cls.cogs_multiplier;
  return usageMultiplier(extract.usage_margin_pct);
}

/** Every multiplier a cost-priced usage class on this card is charged at. */
function multipliersInUse(extract) {
  const out = new Set();
  for (const c of extract.classes) {
    if (c.model !== "usage" || c.class === INFERENCE_SHARE_CLASS) continue;
    try {
      out.add(classMultiplier(c, extract));
    } catch {
      /* reported by the per-row check */
    }
  }
  return out;
}

/** True when some cost-priced usage class falls back to the card margin. */
function marginInUse(extract) {
  return extract.classes.some((c) => c.model === "usage" && c.class !== INFERENCE_SHARE_CLASS && c.cogs_multiplier === undefined);
}

// Trailing text a usage-priced cell may carry after "N× measured model cost".
// Anything else after the price is rejected, so a cell cannot state a charge
// (e.g. "…, including level 1") that the parser would otherwise ignore.
const USAGE_SUFFIXES = ["", " of the level 2 call"];

/**
 * Parse the price cell of a pricing-page table row. The WHOLE cell must be one of:
 *   Free
 *   N× measured model cost[ of the level 2 call]
 *   Measured model cost[ of the level 2 call]          (at cost: 1×)
 *   P% of the forwarded inference spend, less the request's agent charges   (scope agent)
 *   P% of the forwarded inference spend, less the request's measured charges (scope all)
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
  const atCost = text.match(/^(?:at\s+)?measured model cost(.*)$/i);
  if (atCost && USAGE_SUFFIXES.includes(atCost[1].toLowerCase())) return { kind: "usage", multiplier: 1 };
  const share = text.match(new RegExp(String.raw`^(${NUM})%\s+of the forwarded inference spend, less the request's (agent|measured) charges$`, "i"));
  if (share) return { kind: "share", pct: num(share[1]), against: share[2].toLowerCase() };
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

  // The card margin's multiplier, when some usage class is priced from it.
  let multiplier = null;
  if (marginInUse(extract)) {
    try {
      multiplier = usageMultiplier(extract.usage_margin_pct);
    } catch (e) {
      problems.push(e.message);
    }
  }
  const allowedMultipliers = multipliersInUse(extract);
  const sharePct = extract.inference_share_bps != null ? extract.inference_share_bps / 100 : null;

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
    if (cls.class === INFERENCE_SHARE_CLASS) {
      if (sharePct === null) {
        problems.push(`line ${row.line}: ${row.class} is listed but rate card ${extract.version} carries no inference_share_bps`);
      } else if (price.kind !== "share" || price.against !== SHARE_AGAINST[shareScope(extract)]) {
        problems.push(
          `line ${row.line}: ${row.class} must read "${sharePct}% of the forwarded inference spend, less the request's ${SHARE_AGAINST[shareScope(extract)]} charges" (inference_share_scope ${shareScope(extract)})`,
        );
      } else if (!sameMoney(price.pct, sharePct)) {
        problems.push(`line ${row.line}: ${row.class} says ${price.pct}% but the rate card's inference share is ${sharePct}%`);
      }
    } else if (cls.model === "usage") {
      let want = null;
      try {
        want = classMultiplier(cls, extract);
      } catch {
        /* margin problem already reported */
      }
      if (price.kind !== "usage") {
        problems.push(`line ${row.line}: ${row.class} is usage-priced on the rate card; the page must say "${want}× measured model cost"`);
      } else if (want !== null && price.multiplier !== want) {
        const why = cls.cogs_multiplier !== undefined ? "its cogs_multiplier is" : "the rate card's margin implies";
        problems.push(`line ${row.line}: ${row.class} says ${price.multiplier}× but ${why} ${want}×`);
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
  // Every class a customer can be charged for by usage must be on the page, so a
  // new usage class (or the inference share) cannot ship unlisted.
  for (const c of extract.classes) {
    if (c.model === "usage" && !onPage.has(c.class) && !REQUIRED_PAGE_CLASSES.includes(c.class)) {
      problems.push(`usage class ${c.class} on rate card ${extract.version} is missing from the checked region`);
    }
  }

  // Page-wide facts stated in prose.
  const pegs = [...mdx.matchAll(/1\s*[μµ]\s*=\s*\$\s?([0-9.]+)/g)].map((m) => Number(m[1]));
  if (pegs.length === 0) problems.push(`the page must state the peg as "1 μ = $${extract.peg.usd_per_mu}"`);
  for (const p of pegs) {
    if (p !== extract.peg.usd_per_mu) problems.push(`the page states 1 μ = $${p}; the rate card peg is $${extract.peg.usd_per_mu}`);
  }
  // A margin may only be quoted when some class is actually priced from it.
  for (const m of mdx.matchAll(/(\d+)%\s+(?:gross\s+)?margin/gi)) {
    if (!marginInUse(extract) || extract.usage_margin_pct === null) {
      problems.push(`the page states a ${m[1]}% margin, but no class on rate card ${extract.version} is priced from the card margin`);
    } else if (Number(m[1]) !== Math.round(extract.usage_margin_pct * 100)) {
      problems.push(`the page states a ${m[1]}% margin; the rate card margin is ${Math.round(extract.usage_margin_pct * 100)}%`);
    }
  }
  if (allowedMultipliers.size > 0) {
    const shown = [...allowedMultipliers].sort((a, b) => a - b).join("× or ") + "×";
    for (const m of mdx.matchAll(/(\d+)\s*[×x]\s+(?:the\s+|its\s+)?measured\b/gi)) {
      if (!allowedMultipliers.has(Number(m[1]))) problems.push(`the page states ${m[1]}× measured cost; the rate card charges ${shown}`);
    }
  }
  // Every "P% of … inference" in prose must be the card's inference share.
  for (const m of mdx.matchAll(new RegExp(String.raw`(${NUM})%\s+(?:of\s+)?(?:the\s+|your\s+|its\s+)?(?:customer's\s+)?(?:forwarded\s+)?inference\b`, "gi"))) {
    if (sharePct === null) problems.push(`line ${lineOf(mdx, m.index)}: the page quotes a ${m[1]}% inference share; rate card ${extract.version} has none`);
    else if (!sameMoney(num(m[1]), sharePct)) problems.push(`line ${lineOf(mdx, m.index)}: the page quotes a ${m[1]}% inference share; the rate card's is ${sharePct}%`);
  }

  problems.push(...checkMoneyPairs(mdx, extract));
  problems.push(...checkWorkedExample(mdx, allowedMultipliers, sharePct));
  problems.push(...checkOverdraftWording(mdx, extract));
  problems.push(...checkShareScopeWording(mdx, extract));
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
 * The worked example's arithmetic. In the section under WORKED_EXAMPLE_HEADING:
 *   - each "At N× that is C μ" must use a multiplier the rate card charges and
 *     equal N × the most recent measured cost written as "(B μ)";
 *   - "P% of that is S μ" (the inference share) must use the card's share and
 *     equal P% of the most recent "(B μ)";
 *   - "the larger of the two, X μ" must be max(that share, the charges stated
 *     since it), and replaces them in the running total;
 *   - "a Y μ inference-share line" must be X minus those charges;
 *   - "T μ in total" must be the running total.
 * The section is required and must contain at least one step, so rewording it
 * out of the checked shape fails rather than going unchecked.
 */
export function checkWorkedExample(mdx, allowedMultipliers, sharePct = null) {
  const start = mdx.indexOf(WORKED_EXAMPLE_HEADING);
  if (start === -1) return [`the page must keep a "${WORKED_EXAMPLE_HEADING}" section (its arithmetic is checked)`];
  const rest = mdx.slice(start + WORKED_EXAMPLE_HEADING.length);
  const next = rest.search(/\n#{1,3} /);
  const section = next === -1 ? rest : rest.slice(0, next);
  const base = start + WORKED_EXAMPLE_HEADING.length;
  const where = (i) => `line ${lineOf(mdx, base + i)}`;
  const allowed = allowedMultipliers instanceof Set ? allowedMultipliers : new Set(allowedMultipliers == null ? [] : [allowedMultipliers]);

  const events = [
    ...[...section.matchAll(new RegExp(String.raw`\((${NUM})\s*[μµ]\)`, "g"))].map((m) => ({ at: m.index, cost: num(m[1]) })),
    ...[...section.matchAll(new RegExp(String.raw`At\s+(\d+)\s*[×x]\s+that\s+is\s+(${NUM})\s*[μµ]`, "g"))].map((m) => ({
      at: m.index,
      n: Number(m[1]),
      charge: num(m[2]),
    })),
    ...[...section.matchAll(new RegExp(String.raw`(${NUM})%\s+of\s+that\s+is\s+(${NUM})\s*[μµ]`, "g"))].map((m) => ({
      at: m.index,
      pct: num(m[1]),
      share: num(m[2]),
    })),
    ...[...section.matchAll(new RegExp(String.raw`the\s+larger\s+of\s+the\s+two,\s+(${NUM})\s*[μµ]`, "g"))].map((m) => ({ at: m.index, larger: num(m[1]) })),
    ...[...section.matchAll(new RegExp(String.raw`a\s+(${NUM})\s*[μµ]\s+inference-share\s+line`, "g"))].map((m) => ({ at: m.index, topUp: num(m[1]) })),
    ...[...section.matchAll(new RegExp(String.raw`(${NUM})\s*[μµ]\s+in\s+total`, "g"))].map((m) => ({ at: m.index, total: num(m[1]) })),
  ].sort((a, b) => a.at - b.at);

  const problems = [];
  let cost = null;
  let charges = [];
  let share = null; // { target, from } while a share is open
  let lastAgent = null; // { larger, agentSum } after "the larger of the two"
  let steps = 0;
  let totals = 0;
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  for (const e of events) {
    if (e.cost !== undefined) cost = e.cost;
    else if (e.charge !== undefined) {
      steps++;
      if (allowed.size > 0 && !allowed.has(e.n)) problems.push(`${where(e.at)}: the worked example uses ${e.n}×; the rate card charges ${[...allowed].join("× or ")}×`);
      if (cost === null) problems.push(`${where(e.at)}: the worked example charges ${e.charge} μ with no "(N μ)" measured cost before it`);
      else if (!sameMoney(e.n * cost, e.charge)) problems.push(`${where(e.at)}: the worked example says ${e.n}× ${cost} μ is ${e.charge} μ; it is ${+(e.n * cost).toFixed(10)} μ`);
      charges.push(e.charge);
      cost = null;
    } else if (e.share !== undefined) {
      steps++;
      if (sharePct === null) problems.push(`${where(e.at)}: the worked example applies a ${e.pct}% inference share; the rate card has none`);
      else if (!sameMoney(e.pct, sharePct)) problems.push(`${where(e.at)}: the worked example uses a ${e.pct}% share; the rate card's is ${sharePct}%`);
      if (cost === null) problems.push(`${where(e.at)}: the worked example's share has no "(N μ)" inference cost before it`);
      else if (!sameMoney((e.pct / 100) * cost, e.share)) problems.push(`${where(e.at)}: the worked example says ${e.pct}% of ${cost} μ is ${e.share} μ; it is ${+((e.pct / 100) * cost).toFixed(10)} μ`);
      share = { target: e.share, from: charges.length };
      cost = null;
    } else if (e.larger !== undefined) {
      if (share === null) {
        problems.push(`${where(e.at)}: "the larger of the two" with no inference share before it`);
        continue;
      }
      const agentSum = sum(charges.slice(share.from));
      const want = Math.max(share.target, agentSum);
      if (!sameMoney(e.larger, want)) problems.push(`${where(e.at)}: the larger of ${share.target} μ and ${+agentSum.toFixed(10)} μ is ${+want.toFixed(10)} μ, not ${e.larger} μ`);
      charges = [...charges.slice(0, share.from), e.larger];
      lastAgent = { larger: e.larger, agentSum };
      share = null;
    } else if (e.topUp !== undefined) {
      if (lastAgent === null) problems.push(`${where(e.at)}: an inference-share line with no "the larger of the two" before it`);
      else if (!sameMoney(e.topUp, Math.max(0, lastAgent.larger - lastAgent.agentSum))) {
        problems.push(`${where(e.at)}: the inference-share line is ${e.topUp} μ; it is ${+Math.max(0, lastAgent.larger - lastAgent.agentSum).toFixed(10)} μ`);
      }
    } else {
      totals++;
      if (share !== null) problems.push(`${where(e.at)}: the worked example states a total before saying which of the share and the agent charges is larger`);
      const s = sum(charges);
      if (!sameMoney(s, e.total)) problems.push(`${where(e.at)}: the worked example total is ${e.total} μ but its charges add up to ${+s.toFixed(10)} μ`);
    }
  }
  if (steps === 0) problems.push(`the worked example has no "At N× that is C μ" step to check`);
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

// What the share is netted against, by the card's inference_share_scope. An absent
// scope is the billing default, agent.
const SHARE_AGAINST = { agent: "agent", all: "measured" };
const shareScope = (extract) => extract.inference_share_scope ?? "agent";

const OUTSIDE_THE_MAX = /\b(?:on top|outside the comparison)\b/i;
const GOVERNANCE_TOPIC = /\b(?:governance|integrity analysis|Safe House)\b/i;

/**
 * The prose must say which charges the 4% is compared against. Scope `all` nets
 * governance too, so no sentence may put governance (the integrity analysis, Safe
 * House) on top of the comparison; observer trace analysis is the one thing that
 * stays on top, because it runs later with no request to attach to, so a sentence
 * about it is allowed. Scope `agent` must say governance is charged on top.
 */
export function checkShareScopeWording(mdx, extract) {
  if (extract.inference_share_bps == null) return [];
  const problems = [];
  const all = sentences(mdx);
  const outside = all.filter((s) => OUTSIDE_THE_MAX.test(s) && GOVERNANCE_TOPIC.test(s) && !/\bobserver\b/i.test(s));
  if (shareScope(extract) === "all") {
    for (const s of outside) {
      problems.push(`rate card ${extract.version} nets governance inside the inference-share comparison (scope all), but the page says: "${s.trim()}"`);
    }
  } else if (outside.length === 0) {
    problems.push(`rate card ${extract.version} bills governance on top of the inference-share comparison (scope agent); the page must say so`);
  }
  return problems;
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
  if ((a.inference_share_bps ?? null) !== (b.inference_share_bps ?? null)) {
    diffs.push(`inference_share_bps ${a.inference_share_bps ?? null} → ${b.inference_share_bps ?? null}`);
  }
  if ((a.inference_share_scope ?? null) !== (b.inference_share_scope ?? null)) {
    diffs.push(`inference_share_scope ${a.inference_share_scope ?? null} → ${b.inference_share_scope ?? null}`);
  }
  const am = new Map(a.classes.map((c) => [c.class, c]));
  const bm = new Map(b.classes.map((c) => [c.class, c]));
  for (const id of classes) {
    const x = am.get(id);
    const y = bm.get(id);
    const fmt = (c) =>
      c
        ? `${c.model}${c.rate_mu === null ? "" : ` ${c.rate_mu} μ`}` +
          `${c.bucket === undefined ? "" : ` ${c.bucket}`}${c.cogs_multiplier === undefined ? "" : ` ${c.cogs_multiplier}×`}`
        : "absent";
    if (fmt(x) !== fmt(y)) diffs.push(`${id}: ${fmt(x)} → ${fmt(y)}`);
  }
  return diffs;
}
