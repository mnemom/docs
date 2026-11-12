// scripts/lib/code-facts.mjs: shared logic for the docs ↔ code-facts gate (MNE-9916).
//
// Some docs pages state a value that code decides: the default a new agent is
// born with, how a knob composes across scopes, the HTTP status a block returns,
// which provider doors policy reads tools on. Those values used to be typed into
// prose by hand, and nothing failed when the code changed.
//
// mnemom-api and mnemom-platform now each generate a `code-facts.json` from the
// real constants and functions (schema `mnemom-code-facts/1`), and fail their
// own CI while that file is stale:
//
//   mnemom/mnemom-api       code-facts.json          (src/composition/code-facts.ts)
//   mnemom/mnemom-platform  gateway/code-facts.json  (gateway/src/code-facts.ts)
//
// Both repos are private, so the facts are vendored here as
// scripts/code-facts-snapshot.json. Two scripts use this module so they can
// never disagree about what a fact or an annotation means:
//
//   scripts/sync-code-facts.mjs  builds the snapshot from the two source files
//                                  and, with --check, fails if it has drifted
//                                  from their main branches.
//   scripts/check-code-facts.mjs offline, fails if an annotated page claims a
//                                  value the snapshot contradicts.
//
// A page opts in with an MDX comment (not rendered by Mintlify) anywhere in the
// file. Its payload is a comma-separated list of claims, each one a fact id, the
// literal the page asserts, and a quoted phrase from the page that states it:
//
//   {/* code-facts: api.new_agent.grace_period_hours=0 "born with a grace period of 0 hours" */}
//
// The literal is a number, true, false, or a bare word (a string such as
// observe). The phrase must appear in the page body (code-facts comments
// removed, whitespace collapsed), so an annotation cannot outlive the sentence
// it guards: rewrite the sentence and the annotation must be rewritten with it.

export const CODE_FACTS_SCHEMA = "mnemom-code-facts/1";

// Where each repo's generated file lives, and the id prefix its facts must use.
export const SOURCES = [
  { repo: "mnemom/mnemom-api", path: "code-facts.json", prefix: "api." },
  { repo: "mnemom/mnemom-platform", path: "gateway/code-facts.json", prefix: "gateway." },
];

const ANNOTATION_RE = /\{\/\*\s*code-facts:([\s\S]*?)\*\/\}/g;
const FACT_ID_RE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
// One claim: id=literal "phrase", then a comma or the end of the payload.
const CLAIM_RE = /\s*([^\s=,"]+)\s*=\s*([^\s=,"]+)\s+"([^"]*)"\s*(?:,|$)/y;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const WORD_RE = /^[A-Za-z_][A-Za-z0-9_./-]*$/;

/** A malformed annotation or source file: a usage error (exit 2), not drift. */
export class CodeFactsError extends Error {}

const isFactValue = (v) => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/** Reads a page literal as the JSON value it asserts. */
export function parseLiteral(token) {
  if (token === "true") return true;
  if (token === "false") return false;
  if (NUMBER_RE.test(token)) return Number(token);
  if (WORD_RE.test(token)) return token;
  throw new CodeFactsError(`literal ${JSON.stringify(token)} is not a number, true, false, or a bare word`);
}

const collapse = (s) => s.replace(/\s+/g, " ").trim();

/**
 * Every code-facts claim on a page, in order.
 * @returns {{id: string, literal: string, value: string|number|boolean, phrase: string}[]}
 */
export function parseAnnotations(text) {
  const claims = [];
  for (const m of text.matchAll(ANNOTATION_RE)) {
    const payload = m[1].trim();
    if (!payload) throw new CodeFactsError("empty code-facts annotation");
    CLAIM_RE.lastIndex = 0;
    while (CLAIM_RE.lastIndex < payload.length) {
      const at = CLAIM_RE.lastIndex;
      const c = CLAIM_RE.exec(payload);
      if (!c) {
        throw new CodeFactsError(
          `cannot parse code-facts claim at ${JSON.stringify(payload.slice(at, at + 60))}: expected <fact id>=<literal> "<phrase>"`,
        );
      }
      const [, id, literal, phrase] = c;
      if (!FACT_ID_RE.test(id)) throw new CodeFactsError(`${JSON.stringify(id)} is not a fact id`);
      if (!collapse(phrase)) throw new CodeFactsError(`claim ${id} has an empty phrase`);
      claims.push({ id, literal, value: parseLiteral(literal), phrase: collapse(phrase) });
    }
  }
  return claims;
}

/**
 * Problems with one page against the snapshot's facts. Empty when every claim
 * names a known fact, asserts its current value, and quotes a phrase the page
 * still contains. Throws CodeFactsError on a malformed annotation.
 */
export function checkPage(text, facts, file = "page") {
  const claims = parseAnnotations(text);
  if (claims.length === 0) return [];
  const body = collapse(text.replace(ANNOTATION_RE, " "));
  const problems = [];
  for (const claim of claims) {
    const fact = facts[claim.id];
    if (!fact) {
      problems.push(`${file}: ${claim.id} is not a code fact (see scripts/code-facts-snapshot.json)`);
      continue;
    }
    if (fact.value !== claim.value) {
      problems.push(
        `${file}: "${claim.phrase}" asserts ${claim.id}=${claim.literal}, but the code says ${JSON.stringify(fact.value)} ` +
          `(${fact.repo} ${fact.source} ${fact.symbol}). Fix the page, then the annotation.`,
      );
    }
    if (!body.includes(claim.phrase)) {
      problems.push(`${file}: the phrase "${claim.phrase}" annotated for ${claim.id} is no longer on the page`);
    }
  }
  return problems;
}

/** Throws unless `doc` is a well-formed code-facts file from `source`. */
export function validateSourceDoc(doc, source) {
  const where = `${source.repo}:${source.path}`;
  if (doc?.schema !== CODE_FACTS_SCHEMA) throw new CodeFactsError(`${where} schema is ${JSON.stringify(doc?.schema)}, expected ${CODE_FACTS_SCHEMA}`);
  if (doc.repo !== source.repo) throw new CodeFactsError(`${where} names repo ${JSON.stringify(doc.repo)}`);
  if (!doc.facts || typeof doc.facts !== "object" || Array.isArray(doc.facts)) throw new CodeFactsError(`${where} has no facts object`);
  for (const [id, f] of Object.entries(doc.facts)) {
    if (!FACT_ID_RE.test(id) || !id.startsWith(source.prefix)) throw new CodeFactsError(`${where} fact ${JSON.stringify(id)} must be an id under ${source.prefix}`);
    if (!isFactValue(f?.value)) throw new CodeFactsError(`${where} fact ${id} has a value that is not a string, number, or boolean`);
    for (const k of ["source", "symbol", "summary"]) {
      if (typeof f[k] !== "string" || !f[k]) throw new CodeFactsError(`${where} fact ${id} has no ${k}`);
    }
  }
}

/**
 * The committed snapshot built from each source repo's file.
 * @param {{source: {repo: string, path: string, prefix: string}, ref: string, doc: object}[]} inputs
 */
export function buildSnapshot(inputs) {
  const facts = {};
  for (const { source, doc } of inputs) {
    validateSourceDoc(doc, source);
    for (const [id, f] of Object.entries(doc.facts)) {
      facts[id] = { value: f.value, repo: source.repo, source: f.source, symbol: f.symbol, summary: f.summary };
    }
  }
  const sorted = Object.fromEntries(Object.keys(facts).sort().map((id) => [id, facts[id]]));
  return {
    _note:
      "Vendored code facts, generated by scripts/sync-code-facts.mjs from each repo's code-facts.json. Do not hand-edit: re-run the sync script. Pages that opt in with a code-facts MDX comment are checked against this file by scripts/check-code-facts.mjs, and this file is checked against mnemom-api and mnemom-platform main by the scheduled 'Code facts' workflow.",
    schema: CODE_FACTS_SCHEMA,
    sources: inputs.map(({ source, ref }) => ({ repo: source.repo, path: source.path, ref })),
    facts: sorted,
  };
}

/** The snapshot's exact bytes: two-space JSON plus a trailing newline. */
export const serializeSnapshot = (snap) => `${JSON.stringify(snap, null, 2)}\n`;

/** Throws unless `snap` is a well-formed snapshot. */
export function validateSnapshot(snap) {
  if (snap?.schema !== CODE_FACTS_SCHEMA) throw new CodeFactsError(`snapshot schema is ${JSON.stringify(snap?.schema)}, expected ${CODE_FACTS_SCHEMA}`);
  if (!snap.facts || typeof snap.facts !== "object") throw new CodeFactsError("snapshot has no facts object");
  for (const [id, f] of Object.entries(snap.facts)) {
    if (!isFactValue(f?.value)) throw new CodeFactsError(`snapshot fact ${id} has no string, number, or boolean value`);
  }
}

/**
 * Differences that make the snapshot stale against freshly built facts: a fact
 * added, removed, or with a changed value, source, or symbol. Summary wording
 * is not drift.
 */
export function diffFacts(committed, live) {
  const out = [];
  for (const id of Object.keys(committed)) {
    if (!(id in live)) out.push(`${id} is in the snapshot but no longer generated`);
  }
  for (const [id, f] of Object.entries(live)) {
    const c = committed[id];
    if (!c) {
      out.push(`${id} is generated but missing from the snapshot`);
      continue;
    }
    for (const k of ["value", "source", "symbol"]) {
      if (c[k] !== f[k]) out.push(`${id} ${k} is ${JSON.stringify(c[k])} in the snapshot, ${JSON.stringify(f[k])} in code`);
    }
  }
  return out;
}
