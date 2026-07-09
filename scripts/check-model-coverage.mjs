#!/usr/bin/env node
/**
 * check-model-coverage.mjs — supported-model reconciliation gate.
 *
 * Two canonical surfaces name the models the v1 promise applies to:
 *   · quickstart/gateway.mdx        (Supported providers table)
 *   · concepts/provider-support.mdx (Supported-models cards + `supported_models:` YAML)
 *
 * They drifted apart (gateway listed GPT-5.2 / Gemini 3 Pro and omitted Opus 4.8
 * / GPT-5 Codex / o3), and nothing reconciled either page against the gateway's
 * `/models.json` registry it self-declares as the source of truth. `mint
 * broken-links` cannot catch this — it validates in-content LINKS, never the
 * MODEL NAMES asserted in prose/tables. This script closes that gap.
 *
 * It:
 *   1. Loads the model registry (see loadRegistry precedence below) and builds a
 *      supported-model index (ids + normalized marketing names).
 *   2. Extracts each page's ASSERTED-SUPPORTED model set from a deterministically
 *      delimited region bounded by HTML-comment sentinels:
 *        <!-- model-coverage:supported:start -->
 *        …authoritative supported-model list…
 *        <!-- model-coverage:supported:end -->
 *      Only text inside the sentinels is parsed; deprecation/passthrough tables,
 *      AIP footnotes, cost prose and curl examples elsewhere are ignored, so a
 *      passthrough `gemini-3-pro`/`gpt-4o` mention never gets mis-flagged.
 *   3. FAILS when either page (a) claims a model absent from the registry's
 *      SUPPORTED set (an "unknown claim"), (b) is missing its sentinel region
 *      (fail-closed — a dropped delimiter must not pass vacuously), or (c)
 *      disagrees with the other page (symmetric difference of claimed ids).
 *
 * Sibling to check-path-references.mjs / check-redirects.mjs; same contract:
 *   Exits 0 clean. Exits 1 on any failure (unknown claim, disagreement, missing
 *   sentinel region, registry hard-failure, or a failed self-test). Exits 2 on
 *   bad CLI usage.
 *
 * No new dependency: Node ≥22 (per `engines`) ships global `fetch`; everything
 * else is `node:*`.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { argv, env, exit } from "node:process";

// ── Configuration ────────────────────────────────────────────────────────────
const DEFAULT_REGISTRY_URL = "https://gateway.mnemom.ai/models.json";
const SENTINEL_START = "<!-- model-coverage:supported:start -->";
const SENTINEL_END = "<!-- model-coverage:supported:end -->";

// The two canonical pages whose supported-model regions must reconcile.
const PAGE_FILES = ["quickstart/gateway.mdx", "concepts/provider-support.mdx"];

const scriptDir = () => dirname(fileURLToPath(import.meta.url));
const DEFAULT_SNAPSHOT = () => join(scriptDir(), "model-registry-snapshot.json");

// ── Registry loading ─────────────────────────────────────────────────────────
// Resolves the registry in precedence order:
//   1. MODEL_REGISTRY_PATH env  → a local file (source: "local").
//   2. fetch(MODEL_REGISTRY_URL || default) → the live registry (source: "live").
//   3. the committed snapshot   → offline fallback (source: "snapshot").
//
// NOTE: this extends the `_load-spec.mjs` idiom (env-path override → live fetch)
// with a THIRD tier — the committed snapshot — because the registry gate must
// never fail in offline CI. `_load-spec.mjs` deliberately has only two tiers and
// throws on a network error, since the OpenAPI spec loader assumes network
// access; the registry loader here fails closed to a committed file instead.
// The live-fetch error is swallowed on purpose; only a missing/unparseable
// snapshot is a hard failure.
export async function loadRegistry({ env: e = env, fetchImpl = fetch, snapshotPath = DEFAULT_SNAPSHOT() } = {}) {
  // Tier 1 — explicit local file.
  if (e.MODEL_REGISTRY_PATH) {
    const p = resolve(e.MODEL_REGISTRY_PATH);
    if (!existsSync(p)) {
      throw new Error(`MODEL_REGISTRY_PATH=${p} was set but the file does not exist.`);
    }
    return { models: parseModels(readFileSync(p, "utf8"), p), source: "local" };
  }

  // Tier 2 — live registry (best-effort; a network error falls through).
  const url = e.MODEL_REGISTRY_URL || DEFAULT_REGISTRY_URL;
  try {
    const res = await fetchImpl(url);
    if (res && res.ok) {
      const text = await res.text();
      return { models: parseModels(text, url), source: "live" };
    }
  } catch {
    // Swallow: offline/flaky registry must never fail the gate; fall back.
  }

  // Tier 3 — committed snapshot (deterministic backstop).
  if (!existsSync(snapshotPath)) {
    throw new Error(
      `Registry unavailable: live fetch failed and no committed snapshot at ${snapshotPath}.`,
    );
  }
  return { models: parseModels(readFileSync(snapshotPath, "utf8"), snapshotPath), source: "snapshot" };
}

function parseModels(text, whence) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error(`Registry at ${whence} is not valid JSON: ${err.message}`);
  }
  if (!doc || !Array.isArray(doc.models)) {
    throw new Error(`Registry at ${whence} has no "models" array.`);
  }
  return doc.models;
}

// ── Registry index ───────────────────────────────────────────────────────────
// Normalize a marketing name for case/whitespace-insensitive matching.
export const normalizeName = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

// Builds resolution vocabularies from the registry's SUPPORTED entries.
//   supportedIds:   Set<string> of canonical ids (compared verbatim)
//   supportedNames: Set<string> of normalized marketing names
//   nameToId:       Map<normalizedName, id>
//   allKnown:       Set<string> of every id (supported + passthrough) for logging
export function buildRegistryIndex(models) {
  const supportedIds = new Set();
  const supportedNames = new Set();
  const nameToId = new Map();
  const allKnown = new Set();
  for (const m of models) {
    if (!m || typeof m.id !== "string") continue;
    allKnown.add(m.id);
    if (m.supported !== true) continue;
    supportedIds.add(m.id);
    if (typeof m.name === "string" && m.name.trim()) {
      const norm = normalizeName(m.name);
      supportedNames.add(norm);
      nameToId.set(norm, m.id);
    }
    // The id itself is also a resolvable name (covers pages that use the id as
    // its own display text, e.g. "o3").
    nameToId.set(normalizeName(m.id), m.id);
    supportedNames.add(normalizeName(m.id));
  }
  return { supportedIds, supportedNames, nameToId, allKnown };
}

// Resolve a single token (an id or marketing name) to a supported id, or null.
function resolveToken(token, index) {
  const t = String(token).trim();
  if (!t) return null;
  if (index.supportedIds.has(t)) return t;
  const norm = normalizeName(t);
  if (index.nameToId.has(norm)) return index.nameToId.get(norm);
  return null;
}

// ── Sentinel region extraction ───────────────────────────────────────────────
// Returns the text between the first start/end sentinels, or null when the
// region is absent/unterminated (which the caller treats as a fail-closed error).
export function extractSentinelRegion(text) {
  const start = text.indexOf(SENTINEL_START);
  if (start === -1) return null;
  const end = text.indexOf(SENTINEL_END, start + SENTINEL_START.length);
  if (end === -1) return null;
  return text.slice(start + SENTINEL_START.length, end);
}

// A residual token looks like a model claim: starts with a letter and contains a
// digit, built only from model-name characters (letters/digits/space/.-/). This
// deliberately excludes prose (parentheses, colons, slashes-with-words) so AIP
// or auth-header cells inside a wrapped table are never mis-flagged.
const MODEL_SHAPE = /^[A-Za-z][A-Za-z0-9][A-Za-z0-9.\-/ ]*\d[A-Za-z0-9.\-/ ]*$/;

// Build a boundary-aware, whitespace-tolerant matcher for a known marketing name
// so "GPT-5" matches "GPT-5," but NOT the longer unknown token "GPT-5.2".
function nameMatcher(name) {
  const escaped = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(`(?<![\\w.\\-/])${escaped}(?![\\w.\\-/])`, "gi");
}

// extractSupportedClaims(regionText, index) → { claimedIds:Set, unknownClaims:Set }
//
// Tokenization contract (deterministic; handles the mixed JSX + YAML region):
//   · YAML list items — lines matching /^\s*-\s+(candidate)/ — are one candidate
//     each (typically a canonical id). Resolve → claimed id, else → unknown claim.
//   · Marketing names — for every OTHER line, JSX attributes (key="value",
//     key={expr}) are stripped first so attribute values like title="Anthropic"
//     never register; then known supported names are consumed longest-first with
//     word boundaries. Any residual model-SHAPED fragment (on a line that carried
//     at least one known name) is an unknown claim, catching a stray "GPT-5.2".
export function extractSupportedClaims(regionText, index) {
  const claimedIds = new Set();
  const unknownClaims = new Set();

  // Longest-first so "GPT-5 Codex" is consumed before "GPT-5", "o3-mini" before "o3".
  const names = [...index.supportedNames]
    .map((norm) => ({ norm, id: index.nameToId.get(norm) }))
    .sort((a, b) => b.norm.length - a.norm.length);

  for (const rawLine of regionText.split(/\r?\n/)) {
    // YAML list item → a single candidate token.
    const li = rawLine.match(/^\s*-\s+(\S.*?)\s*$/);
    if (li) {
      const candidate = li[1].trim();
      const id = resolveToken(candidate, index);
      if (id) claimedIds.add(id);
      else unknownClaims.add(candidate);
      continue;
    }

    // Strip JSX attributes so their values can't be read as model tokens.
    let residual = rawLine
      .replace(/[\w-]+\s*=\s*"[^"]*"/g, " ")
      .replace(/[\w-]+\s*=\s*'[^']*'/g, " ")
      .replace(/[\w-]+\s*=\s*\{[^}]*\}/g, " ");

    // Consume known supported names (boundary-aware), collecting their ids.
    let foundKnown = false;
    for (const { norm, id } of names) {
      const re = nameMatcher(norm);
      if (re.test(residual)) {
        foundKnown = true;
        claimedIds.add(id);
        residual = residual.replace(nameMatcher(norm), " ");
      }
    }

    // Only hunt for unknown model-shaped tokens on lines that ARE a model list
    // (carried at least one known name) — prose lines are left alone.
    if (!foundKnown) continue;
    for (const cell of residual.split(/[|,]/)) {
      const frag = cell.trim();
      if (frag && MODEL_SHAPE.test(frag)) unknownClaims.add(frag);
    }
  }

  return { claimedIds, unknownClaims };
}

// ── Core check (exported for --self-test) ────────────────────────────────────
// Pure of process.exit / console so it can be exercised against throwaway
// fixtures. `pages` is [{ file, text }]; `registry` is { models, source }.
export function checkModelCoverage({ pages, registry }) {
  const index = buildRegistryIndex(registry.models);

  const perPage = pages.map(({ file, text }) => {
    const region = extractSentinelRegion(text);
    if (region === null) {
      return { file, sentinelMissing: true, claimedIds: new Set(), unknownClaims: new Set() };
    }
    const { claimedIds, unknownClaims } = extractSupportedClaims(region, index);
    return { file, sentinelMissing: false, claimedIds, unknownClaims };
  });

  // Cross-page disagreement = symmetric difference of claimed ids, computed only
  // across pages that actually have a region (a missing region is its own error).
  const present = perPage.filter((p) => !p.sentinelMissing);
  const disagreements = [];
  if (present.length >= 2) {
    const union = new Set();
    for (const p of present) for (const id of p.claimedIds) union.add(id);
    for (const id of [...union].sort()) {
      const onlyIn = present.filter((p) => !p.claimedIds.has(id)).map((p) => p.file);
      if (onlyIn.length > 0) {
        const claimedBy = present.filter((p) => p.claimedIds.has(id)).map((p) => p.file);
        disagreements.push({ id, claimedBy, missingFrom: onlyIn });
      }
    }
  }

  const ok =
    perPage.every((p) => !p.sentinelMissing && p.unknownClaims.size === 0) &&
    disagreements.length === 0;

  return { source: registry.source, pages: perPage, disagreements, ok };
}

// ── Self-test ────────────────────────────────────────────────────────────────
async function selfTest() {
  let pass = 0;
  let fail = 0;
  const assert = (name, cond) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.error(`  ✗ ${name}`);
    }
  };

  const registry = {
    source: "fixture",
    models: [
      { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "anthropic", supported: true },
      { id: "gpt-5", name: "GPT-5", provider: "openai", supported: true },
      { id: "gpt-5-codex", name: "GPT-5 Codex", provider: "openai", supported: true },
      { id: "o3", name: "o3", provider: "openai", supported: true },
      { id: "o3-mini", name: "o3-mini", provider: "openai", supported: true },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini", supported: true },
      // Passthrough (supported:false) — must never resolve as a supported claim.
      { id: "gemini-3-pro", name: "Gemini 3 Pro", provider: "gemini", supported: false },
    ],
  };

  const wrap = (body) => `${SENTINEL_START}\n${body}\n${SENTINEL_END}`;

  // A page that uses JSX cards + marketing names, incl. a JSX attribute whose
  // value must NOT be read as a model (the advisory false-positive scenario).
  const jsxPage = wrap(
    [
      '<CardGroup cols={3}>',
      '  <Card title="Anthropic" icon="brain">',
      '    Claude Opus 4.8',
      '  </Card>',
      '  <Card title="OpenAI" icon="microchip">',
      '    GPT-5',
      '    GPT-5 Codex',
      '  </Card>',
      '</CardGroup>',
    ].join("\n"),
  );
  // A second page expressing the SAME set via canonical ids in YAML.
  const yamlPage = wrap(
    ["```yaml", "supported_models:", "  - claude-opus-4-8", "  - gpt-5", "  - gpt-5-codex", "```"].join("\n"),
  );

  // 1) Happy path — two matching pages, 0 unknown, 0 disagreements.
  const clean = checkModelCoverage({ pages: [{ file: "jsx.mdx", text: jsxPage }, { file: "yaml.mdx", text: yamlPage }], registry });
  assert("clean pages → ok", clean.ok);
  assert("clean pages → 0 unknown claims", clean.pages.every((p) => p.unknownClaims.size === 0));
  assert("clean pages → 0 disagreements", clean.disagreements.length === 0);

  // 2) Marketing-name ↔ id equivalence: "Claude Opus 4.8" and `claude-opus-4-8`
  //    resolve to the same id, so the two pages agree.
  const jsxClaims = clean.pages.find((p) => p.file === "jsx.mdx").claimedIds;
  const yamlClaims = clean.pages.find((p) => p.file === "yaml.mdx").claimedIds;
  assert("marketing name resolves to canonical id", jsxClaims.has("claude-opus-4-8"));
  assert("id and name pages produce equal claim sets", [...jsxClaims].sort().join() === [...yamlClaims].sort().join());

  // 3) JSX-attribute false positive: title="Anthropic"/icon="brain" and cols={3}
  //    must produce ZERO unknown claims.
  const jsxOnly = checkModelCoverage({ pages: [{ file: "jsx.mdx", text: jsxPage }], registry });
  assert("JSX attributes yield 0 unknown claims", jsxOnly.pages[0].unknownClaims.size === 0);

  // 4) Case/whitespace-insensitive name match.
  const sloppy = checkModelCoverage({
    pages: [{ file: "sloppy.mdx", text: wrap("    claude  opus 4.8") }],
    registry,
  });
  assert("case/space-insensitive name match", sloppy.pages[0].claimedIds.has("claude-opus-4-8"));

  // 5) Unknown claim — a supported region asserting a registry-absent model.
  const unknownYaml = wrap(["```yaml", "supported_models:", "  - gpt-5", "  - gpt-5.2", "```"].join("\n"));
  const unknownTbl = wrap("| OpenAI | GPT-5, GPT-5.2 | Full | x-api-key |");
  const u1 = checkModelCoverage({ pages: [{ file: "u.mdx", text: unknownYaml }], registry });
  const u2 = checkModelCoverage({ pages: [{ file: "u2.mdx", text: unknownTbl }], registry });
  assert("unknown claim (YAML) → flagged", u1.pages[0].unknownClaims.has("gpt-5.2") && !u1.ok);
  assert("unknown claim (table) → flagged", u2.pages[0].unknownClaims.has("GPT-5.2") && !u2.ok);

  // 6) Passthrough not mis-flagged: a supported:false model named OUTSIDE the
  //    sentinel region is ignored entirely.
  const passthrough =
    wrap("    Claude Opus 4.8") + "\n\nElsewhere: gemini-3-pro is passthrough (Gemini 3 Pro).";
  const pt = checkModelCoverage({ pages: [{ file: "pt.mdx", text: passthrough }], registry });
  assert("passthrough mention outside region ignored", pt.pages[0].unknownClaims.size === 0 && pt.ok);
  assert("passthrough Gemini 3 Pro not claimed as supported", !pt.pages[0].claimedIds.has("gemini-3-pro"));

  // 7) Cross-page disagreement — same known-model set differs by one id.
  const pageA = wrap(["```yaml", "  - claude-opus-4-8", "  - gpt-5", "```"].join("\n"));
  const pageB = wrap(["```yaml", "  - claude-opus-4-8", "```"].join("\n"));
  const disagree = checkModelCoverage({ pages: [{ file: "a.mdx", text: pageA }, { file: "b.mdx", text: pageB }], registry });
  assert("differing pages → disagreement flagged", disagree.disagreements.some((d) => d.id === "gpt-5") && !disagree.ok);

  // 8) Missing sentinel region → hard FAIL (fail-closed).
  const noSentinel = checkModelCoverage({ pages: [{ file: "bare.mdx", text: "Just prose, no sentinels." }], registry });
  assert("missing sentinel region → hard fail", noSentinel.pages[0].sentinelMissing && !noSentinel.ok);

  // 9) Registry source fallback — an unreachable live URL falls back to the
  //    committed snapshot; source is reported; the run still completes.
  const root = mkdtempSync(join(tmpdir(), "model-cov-selftest-"));
  const snapshotPath = join(root, "snapshot.json");
  writeFileSync(snapshotPath, JSON.stringify({ models: registry.models }));
  const failingFetch = async () => {
    throw new Error("network down");
  };
  const fell = await loadRegistry({
    env: { MODEL_REGISTRY_URL: "https://invalid.invalid/models.json" },
    fetchImpl: failingFetch,
    snapshotPath,
  });
  assert("unreachable live URL falls back to snapshot", fell.source === "snapshot" && fell.models.length === registry.models.length);

  // 10) Local path override wins (source: local).
  const local = await loadRegistry({ env: { MODEL_REGISTRY_PATH: snapshotPath }, snapshotPath: DEFAULT_SNAPSHOT() });
  assert("MODEL_REGISTRY_PATH override → source local", local.source === "local");

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(
    [
      "Usage: check-model-coverage.mjs [options]",
      "",
      "Reconciles the supported-model claims in quickstart/gateway.mdx and",
      "concepts/provider-support.mdx against the gateway model registry.",
      "",
      "Options:",
      "  --root <dir>        Docs root (default: repo root, resolved from scripts/).",
      "  --registry <path>   Local registry JSON (overrides MODEL_REGISTRY_PATH env).",
      "  --self-test         Run built-in fixtures and exit.",
      "  --help, -h          Show this help.",
      "",
      "Registry resolution precedence: MODEL_REGISTRY_PATH (or --registry) →",
      "live fetch of MODEL_REGISTRY_URL (default " + DEFAULT_REGISTRY_URL + ") →",
      "committed scripts/model-registry-snapshot.json.",
      "",
      "Exits 0 clean; 1 on unknown claim / disagreement / missing sentinel region /",
      "registry hard-failure / self-test failure; 2 on bad CLI usage.",
    ].join("\n"),
  );
}

async function main() {
  const args = argv.slice(2);
  const defaultRoot = resolve(scriptDir(), "..");
  let root = defaultRoot;
  let registryPath = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const need = (flag) => {
      if (i + 1 >= args.length) {
        console.error(`${flag} requires a path argument`);
        exit(2);
      }
      return args[++i];
    };
    if (a === "--self-test") exit((await selfTest()) ? 0 : 1);
    else if (a === "--root" || a === "--docs") root = resolve(need(a));
    else if (a === "--registry") registryPath = resolve(need(a));
    else if (a === "--help" || a === "-h") {
      printHelp();
      exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      exit(2);
    }
  }

  // A --registry flag maps onto the MODEL_REGISTRY_PATH tier.
  const loaderEnv = registryPath ? { ...env, MODEL_REGISTRY_PATH: registryPath } : env;

  let registry;
  try {
    registry = await loadRegistry({ env: loaderEnv });
  } catch (err) {
    console.error(`✗ check-model-coverage: registry load failed: ${err.message}`);
    exit(1);
  }

  const pages = [];
  for (const rel of PAGE_FILES) {
    const p = resolve(root, rel);
    if (!existsSync(p)) {
      console.error(`✗ check-model-coverage: page not found at ${p}`);
      exit(1);
    }
    pages.push({ file: rel, text: readFileSync(p, "utf8") });
  }

  let result;
  try {
    result = checkModelCoverage({ pages, registry });
  } catch (err) {
    console.error(`✗ check-model-coverage failed: ${err.message}`);
    exit(1);
  }

  console.log(`registry source: ${result.source}`);
  for (const p of result.pages) {
    if (p.sentinelMissing) {
      console.error(`✗ sentinel region missing in ${p.file} (expected ${SENTINEL_START} … ${SENTINEL_END}).`);
      continue;
    }
    console.log(
      `  ${p.file}: ${p.claimedIds.size} supported claim(s)` +
        (p.unknownClaims.size ? `, ${p.unknownClaims.size} unknown` : ""),
    );
    if (p.unknownClaims.size) {
      for (const c of [...p.unknownClaims].sort()) {
        console.error(`    ✗ unknown claim (absent from registry's supported set): ${c}`);
      }
    }
  }

  if (result.disagreements.length) {
    console.error(`\n✗ ${result.disagreements.length} cross-page disagreement(s):`);
    for (const d of result.disagreements) {
      console.error(`    - ${d.id}: claimed by [${d.claimedBy.join(", ")}], missing from [${d.missingFrom.join(", ")}]`);
    }
  }

  if (!result.ok) {
    console.error("\n✗ check-model-coverage: pages are not reconciled against the registry.");
    exit(1);
  }
  console.log("\n✓ check-model-coverage: both pages reconciled against the registry's supported set.");
  exit(0);
}

// Run the CLI only when executed directly, not when imported (keeps the exported
// core functions unit-exercisable — no exit/print on `import`).
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
