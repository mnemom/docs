#!/usr/bin/env node
/**
 * check-redirects.mjs — redirect-table integrity gate.
 *
 * Mintlify's `mint broken-links` validates links that appear in page
 * content, but it does NOT inspect the `redirects` array in docs.json.
 * Nothing else does either — so a redirect whose destination points at a
 * page that doesn't exist, or the silent loss of the root (`/`) redirect,
 * ships unnoticed. This script closes that gap.
 *
 * For docs.json it:
 *
 *   1. Parses docs.json (also a syntax check).
 *   2. Walks the whole `navigation` tree (tabs / dropdowns / anchors /
 *      groups / pages, nested arbitrarily) to build the set of navigable
 *      page slugs.
 *   3. For every `redirects[]` entry whose `destination` is internal
 *      (external `https://…` destinations are skipped) and contains no
 *      `:param` / `*` wildcard, asserts the destination is REACHABLE —
 *      i.e. it is a navigable page OR a content file exists on disk for
 *      it (`<slug>.mdx|.md` or `<slug>/index.mdx|.md`). Any `#anchor` or
 *      `?query` suffix is ignored. Reachability (not nav membership) is
 *      the real test: Mintlify serves unlisted `.mdx` files, and a page
 *      listed as `foo/index` is served at `/foo`.
 *   4. Asserts the regression invariant behind the "root lands on
 *      for-agents instead of introduction" bug: a redirect from `/` to
 *      `/introduction` exists, and `introduction` is a navigable page.
 *   5. Validates multi-locale parity for every ENFORCED locale — derived
 *      data-driven from `navigation.languages` (each non-default language;
 *      currently fr, es), NOT a hard-coded list, so a future locale (e.g.
 *      `de`) is covered with no edit here. For each enforced locale it
 *      asserts: (a) every page listed in that locale's navigation has a
 *      content file on disk; (b) every redirect whose destination is
 *      locale-prefixed lands on a page navigable within that locale (keyed
 *      off the destination's own prefix, so a cross-locale hop /fr → /es is
 *      checked against es); and (c) every `.mdx`/`.md` file under
 *      `<docsRoot>/<locale>` is listed in that locale's navigation — i.e.
 *      no orphaned translation that ships but is unreachable.
 *
 * Sibling to `check-doc-examples.mjs` / `check-spec-examples.mjs` and
 * follows the same contract:
 *
 *   Exits 0 on clean. Exits 1 on any integrity failure. Exits 2 on bad
 *   CLI usage.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

// ── CLI ──────────────────────────────────────────────────────────────────
const args = argv.slice(2);
let verbose = false;
let selfTest = false;
let allowChains = false;
let docsPath = fileURLToPath(new URL("../docs.json", import.meta.url));
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--verbose") verbose = true;
  else if (args[i] === "--self-test") selfTest = true;
  else if (args[i] === "--allow-chains") allowChains = true;
  else if (args[i] === "--docs") {
    if (i + 1 >= args.length) {
      console.error("--docs requires a path argument");
      exit(2);
    }
    docsPath = args[++i];
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(
      "Usage: check-redirects.mjs [--docs path/to/docs.json] [--verbose] [--allow-chains] [--self-test]",
    );
    exit(0);
  } else {
    console.error(`Unknown flag: ${args[i]}`);
    exit(2);
  }
}

// ── Pure path/graph helpers (shared by the live check and --self-test) ───────
// These are dependency-free and side-effect-free so the --self-test block can
// call them directly against in-memory fixtures, with no docs.json on disk.

// `/foo/bar#sec?x=1` (redirect source or destination) → `foo/bar` (slug form).
const toSlug = (dest) =>
  dest
    .split(/[#?]/)[0]
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
const isWildcard = (s) => s.includes(":") || s.includes("*");
const isExternal = (s) => /^https?:\/\//.test(s);
// Render a normalized slug back as a path for human-readable reports. The root
// redirect's source "/" normalizes to "" — show it as "/".
const asPath = (slug) => (slug === "" ? "/" : `/${slug}`);

// Build a directed graph (sourceSlug → destSlug) from the redirect table,
// considering ONLY internal, non-wildcard, non-empty entries: external
// destinations leave the site and wildcard sources/destinations are patterns,
// not concrete nodes — neither can form an in-repo resolvable hop, so including
// them would produce false-positive chains/cycles. Sources are normalized with
// the same `toSlug` as destinations so "/quickstart" (a source) and
// "/quickstart" (a destination pointing back) compare equal. If two redirects
// share a normalized source, the Map would silently overwrite the first — that
// collision is itself a defect, so it is recorded in `duplicates` and surfaced
// as a failure rather than lost (MNE-438).
function buildRedirectGraph(redirects) {
  const graph = new Map(); // sourceSlug → destSlug
  const duplicates = []; // { source, first, second }
  for (const r of redirects ?? []) {
    const source = r?.source;
    const destination = r?.destination;
    if (typeof source !== "string" || source === "") continue;
    if (typeof destination !== "string" || destination === "") continue;
    if (isExternal(source) || isExternal(destination)) continue;
    if (isWildcard(source) || isWildcard(destination)) continue;
    const s = toSlug(source);
    const d = toSlug(destination);
    if (graph.has(s)) {
      duplicates.push({ source: s, first: graph.get(s), second: d });
      continue; // keep the first mapping; the collision is reported separately
    }
    graph.set(s, d);
  }
  return { graph, duplicates };
}

// Detect every cycle in the graph (including self-loops A → A). Each node has
// out-degree ≤ 1 (a source maps to exactly one destination), so we follow the
// single successor edge from each unvisited source; revisiting a node already on
// the current path is a back-edge = cycle. Cycles are normalized (rotated to
// start at their lexicographically smallest node) and de-duplicated so A→B→A and
// B→A→B report once. Returns an array of node lists (the cycle members).
function detectCycles(graph) {
  const BLACK = 2; // fully explored — no undiscovered cycle reachable from here
  const state = new Map();
  const cycles = [];
  const seen = new Set();

  const rotateMin = (nodes) => {
    let m = 0;
    for (let i = 1; i < nodes.length; i++) if (nodes[i] < nodes[m]) m = i;
    return [...nodes.slice(m), ...nodes.slice(0, m)];
  };

  for (const start of graph.keys()) {
    if (state.get(start) === BLACK) continue;
    const path = [];
    const indexOnPath = new Map();
    let node = start;
    while (node !== undefined && graph.has(node)) {
      if (indexOnPath.has(node)) {
        const cyc = path.slice(indexOnPath.get(node));
        const norm = rotateMin(cyc);
        const key = norm.join("→");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(norm);
        }
        break;
      }
      if (state.get(node) === BLACK) break; // joined an already-explored region
      indexOnPath.set(node, path.length);
      path.push(node);
      node = graph.get(node);
    }
    for (const n of path) state.set(n, BLACK);
  }
  return cycles;
}

// Detect chains: any source whose destination is itself a source (i.e. the hop
// lands on another redirect, causing a browser double-hop). A node that belongs
// to a cycle is NEVER also reported as a chain — cycles are reported separately,
// so each node is classified as exactly one of cycle / chain / clean, with no
// double-counting (MNE-438). For each chain the terminal (first non-source
// destination) is computed by walking the graph, guarded against cycles and
// re-visits so the walk always terminates. Returns
// `{ source, path, via, terminal }` where `path` is the full node sequence from
// source to terminal inclusive (so a 4+ node chain reports every hop, not just
// the first), and `via` is the intermediate nodes only.
function detectChains(graph, cycleNodes) {
  const chains = [];
  for (const [source, dest] of graph) {
    if (cycleNodes.has(source)) continue; // owned by cycle classification
    if (!graph.has(dest)) continue; // dest is a terminal → single hop, not a chain
    const path = [source];
    const visited = new Set([source]);
    let node = dest;
    while (graph.has(node) && !visited.has(node) && !cycleNodes.has(node)) {
      path.push(node);
      visited.add(node);
      node = graph.get(node);
    }
    path.push(node); // the terminal (or the guarded cycle/re-visit boundary)
    chains.push({ source, path, via: path.slice(1, -1), terminal: node });
  }
  return chains;
}

// Mode dispatch for chains, factored out so --self-test can assert BOTH arms in
// a single run regardless of which CLI flag was passed (MNE-414): default mode
// FAILs (chains → failures[]), --allow-chains downgrades to a WARN (chains →
// warnings[], reporting the flattened terminal for the operator to apply).
// Cycles are NOT routed through here — they FAIL unconditionally in every mode.
function classifyChains(chains, allow) {
  const failures = [];
  const warnings = [];
  for (const chain of chains) {
    const rendered = chain.path.map(asPath).join(" → ");
    if (allow) {
      warnings.push(
        `⚠ redirect chain: ${rendered}; flatten source "${asPath(chain.source)}" directly to "${asPath(chain.terminal)}"`,
      );
    } else {
      failures.push(
        `redirect chain: ${rendered} — a multi-hop redirect double-hops; flatten source "${asPath(chain.source)}" directly to "${asPath(chain.terminal)}" (or run with --allow-chains to downgrade to a warning)`,
      );
    }
  }
  return { failures, warnings };
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Exercises the pure detectors above against in-memory fixtures — no docs.json
// on disk. Mirrors the sibling gates' `--self-test` convention: prints ✓/✗ per
// assertion and exits non-zero on any failure. `total` is incremented only for
// assertions actually evaluated so pass===total stays exact (MNE-438).
function runSelfTest() {
  let pass = 0;
  let total = 0;
  const assert = (name, cond) => {
    total++;
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      console.error(`  ✗ ${name}`);
    }
  };
  // Classify a fixture through the full pipeline (graph → cycles → chains) the
  // same way the live check does, so the assertions test the real code path.
  const classify = (redirects) => {
    const { graph, duplicates } = buildRedirectGraph(redirects);
    const cycles = detectCycles(graph);
    const cycleNodes = new Set(cycles.flat());
    const chains = detectChains(graph, cycleNodes);
    return { graph, duplicates, cycles, chains };
  };

  // 1) Clean table → no chains, no cycles (no false positive).
  {
    const r = classify([
      { source: "/", destination: "/introduction" },
      { source: "/quickstart", destination: "/quickstart/overview" },
    ]);
    assert("clean table → 0 chains", r.chains.length === 0);
    assert("clean table → 0 cycles", r.cycles.length === 0);
    assert("clean table → 0 duplicate sources", r.duplicates.length === 0);
  }

  // 2) Chained pair /a → /b → /c → exactly 1 chain (terminal /c), 0 cycles.
  //    Assert BOTH modes here so a single --self-test run covers each arm,
  //    independent of the CLI flag (MNE-414): default = FAIL, --allow-chains
  //    = WARN.
  {
    const r = classify([
      { source: "/a", destination: "/b" },
      { source: "/b", destination: "/c" },
    ]);
    assert("chained pair → exactly 1 chain", r.chains.length === 1);
    assert("chained pair → 0 cycles", r.cycles.length === 0);
    assert(
      "chained pair → chain source /a, terminal /c",
      r.chains[0]?.source === "a" && r.chains[0]?.terminal === "c",
    );
    assert(
      "chained pair → path is /a → /b → /c",
      r.chains[0]?.path.join(",") === "a,b,c",
    );
    const def = classifyChains(r.chains, false);
    assert(
      "chained pair → default mode FAILs (1 failure, 0 warnings)",
      def.failures.length === 1 && def.warnings.length === 0,
    );
    const allow = classifyChains(r.chains, true);
    assert(
      "chained pair → --allow-chains WARNs (0 failures, 1 warning)",
      allow.failures.length === 0 && allow.warnings.length === 1,
    );
  }

  // 3) 2-node loop /a → /b → /a → exactly 1 cycle, 0 chains (loop nodes must
  //    NOT also be reported as a chain). Cycle detection has no mode parameter,
  //    so it FAILs regardless of --allow-chains.
  {
    const r = classify([
      { source: "/a", destination: "/b" },
      { source: "/b", destination: "/a" },
    ]);
    assert("2-node loop → exactly 1 cycle", r.cycles.length === 1);
    assert("2-node loop → 0 chains (not double-classified)", r.chains.length === 0);
  }

  // 4) Self-loop /a → /a → exactly 1 cycle.
  {
    const r = classify([{ source: "/a", destination: "/a" }]);
    assert("self-loop → exactly 1 cycle", r.cycles.length === 1);
    assert("self-loop → 0 chains", r.chains.length === 0);
  }

  // 5) External / wildcard endpoints are excluded from the graph (no false
  //    positive), and duplicate normalized sources are surfaced.
  {
    const r = classify([
      { source: "/a", destination: "https://example.com/b" },
      { source: "/x/*", destination: "/y" },
      { source: "/p/:id", destination: "/q" },
    ]);
    assert("external/wildcard endpoints excluded → 0 chains", r.chains.length === 0);
    assert("external/wildcard endpoints excluded → 0 cycles", r.cycles.length === 0);
    const dup = classify([
      { source: "/a", destination: "/b" },
      { source: "/a", destination: "/c" },
    ]);
    assert("duplicate normalized source → recorded", dup.duplicates.length === 1);
  }

  // 6) Empty table → 0/0 clean.
  {
    const r = classify([]);
    assert("empty table → 0 chains, 0 cycles", r.chains.length === 0 && r.cycles.length === 0);
  }

  console.log(`\nself-test: ${pass}/${total} assertions passed`);
  return pass === total;
}

// --self-test short-circuits BEFORE any docs.json load so it runs hermetically
// in CI/locally regardless of the live redirect table (mirrors
// check-internal-refs.mjs).
if (selfTest) exit(runSelfTest() ? 0 : 1);

// ── Load & parse ───────────────────────────────────────────────────────────
let docs;
try {
  docs = JSON.parse(readFileSync(docsPath, "utf8"));
} catch (err) {
  console.error(`✗ Could not read/parse ${docsPath}: ${err.message}`);
  exit(1);
}
const docsRoot = dirname(resolve(docsPath));

// ── Collect navigable page slugs ─────────────────────────────────────────
// Generic walk of the navigation tree: page slugs are the strings inside
// any `pages` array, at any depth (tabs, dropdowns, anchors, groups, …).
function collectPagesInto(node, set) {
  if (Array.isArray(node)) {
    for (const child of node) collectPagesInto(child, set);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "pages" && Array.isArray(value)) {
        for (const p of value) {
          if (typeof p === "string") set.add(p);
          else collectPagesInto(p, set); // nested group object inside `pages`
        }
      } else {
        collectPagesInto(value, set);
      }
    }
  }
}
const pages = new Set();
collectPagesInto(docs.navigation ?? {}, pages);

if (pages.size === 0) {
  console.error("✗ No navigable pages found — is `navigation` present?");
  exit(1);
}

// ── Enforced locales (data-driven, NOT a hard-coded fr/es list) ──────────────
// `navigation.languages` carries one entry per language. The default language
// (en) is served at the docs root with no path prefix; every OTHER language is
// an "enforced locale" whose navigation, on-disk files, and redirects must stay
// in parity. Deriving the set from `navigation.languages` means a future locale
// (e.g. `de`) is covered automatically — no change to this script (MNE-414).
const localeNav = new Map(); // locale code → Set<navigable page slug>
for (const lang of docs.navigation?.languages ?? []) {
  const code = lang?.language;
  if (typeof code !== "string" || lang?.default) continue; // skip default (en)
  const set = new Set();
  collectPagesInto(lang, set);
  localeNav.set(code, set);
}
const enforcedLocales = [...localeNav.keys()];

// A destination resolves if it is a navigable page, or a content file
// exists for it on disk — Mintlify serves `<slug>.mdx` directly and maps
// `<slug>/index.mdx` to `/<slug>`.
const fileExists = (slug) =>
  [`${slug}.mdx`, `${slug}.md`, `${slug}/index.mdx`, `${slug}/index.md`].some(
    (rel) => existsSync(resolve(docsRoot, rel)),
  );
const resolves = (slug) => pages.has(slug) || fileExists(slug);

// A slug is navigable within a locale if it (or its `/index` form, served at
// the bare path) appears in that locale's navigation set.
const navigableInLocale = (set, slug) =>
  set.has(slug) || set.has(`${slug}/index`);

// ── Validate redirect destinations ─────────────────────────────────────────
const redirects = docs.redirects ?? [];
const failures = [];

for (const r of redirects) {
  const source = r?.source;
  const destination = r?.destination;
  if (typeof destination !== "string" || destination === "") {
    failures.push(
      `redirect with source "${source}" has a missing or non-string destination`,
    );
    continue;
  }
  if (isExternal(destination)) {
    if (verbose) console.log(`· skip (external): ${source} → ${destination}`);
    continue;
  }
  if (isWildcard(destination)) {
    if (verbose) console.log(`· skip (wildcard): ${source} → ${destination}`);
    continue;
  }
  const slug = toSlug(destination);
  const reachable = resolves(slug);
  if (reachable) {
    if (verbose) console.log(`✓ ${source} → ${destination}`);
  } else {
    failures.push(
      `redirect "${source}" → "${destination}" points at a page that does not exist (resolved slug: "${slug}")`,
    );
  }
  // Locale parity (assertion b): when a redirect's DESTINATION is locale-
  // prefixed it must land on a page that is navigable within THAT locale's nav
  // set. Keyed off the destination's own prefix, so a cross-locale hop
  // (/fr → /es/…) is checked against the destination locale (es). If the
  // destination's first segment is NOT an enforced locale (e.g.
  // /fr/old → /introduction), skip this check — the general reachability
  // assertion above already validates such a redirect. Only run when the
  // destination resolves, to avoid double-reporting an already-missing page.
  const destLocale = slug.split("/")[0];
  if (
    reachable &&
    localeNav.has(destLocale) &&
    !navigableInLocale(localeNav.get(destLocale), slug)
  ) {
    failures.push(
      `redirect "${source}" → "${destination}" targets locale "${destLocale}" but "${slug}" is not a navigable page in that locale's navigation`,
    );
  }
}

// ── Graph invariants: chains & cycles across the whole redirect table ─────────
// The per-entry loop above validates each redirect in isolation; this pass adds
// invariants over the redirect table as a directed graph. Cycles FAIL
// unconditionally (an infinite redirect / 404). Chains FAIL by default and
// downgrade to a WARN under --allow-chains (reporting the flattened terminal for
// the operator to apply — the script never rewrites docs.json).
const { graph: redirectGraph, duplicates: dupSources } =
  buildRedirectGraph(redirects);
for (const dup of dupSources) {
  failures.push(
    `duplicate redirect source "${asPath(dup.source)}" maps to both "${asPath(dup.first)}" and "${asPath(dup.second)}" — a source may have only one destination`,
  );
}
const redirectCycles = detectCycles(redirectGraph);
for (const cyc of redirectCycles) {
  const rendered = [...cyc, cyc[0]].map(asPath).join(" → ");
  failures.push(
    `redirect cycle detected: ${rendered} — an infinite redirect / 404 for users`,
  );
}
const cycleNodeSet = new Set(redirectCycles.flat());
const redirectChains = detectChains(redirectGraph, cycleNodeSet);
const { failures: chainFailures, warnings: chainWarnings } = classifyChains(
  redirectChains,
  allowChains,
);
for (const f of chainFailures) failures.push(f);
for (const w of chainWarnings) console.warn(w);
if (
  verbose &&
  dupSources.length === 0 &&
  redirectCycles.length === 0 &&
  redirectChains.length === 0
) {
  console.log(
    `✓ graph OK: ${redirectGraph.size} internal redirect(s), no chains/cycles`,
  );
}

// ── Locale nav ⇄ file parity (assertions a & c) ──────────────────────────────
// For every enforced locale: (a) each page in its navigation has a content
// file on disk, and (c) each content file under `<docsRoot>/<locale>` is
// reachable from that locale's navigation (no orphaned translation). We walk
// one tree per enforced-locale code (NOT a hard-coded fr/es pair) so coverage
// tracks the localeNav Map. Both `.mdx` and `.md` are scanned — consistent
// with fileExists(), which resolves either — so a stray `<locale>/foo.md`
// translation is caught too.
const walkLocaleFiles = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkLocaleFiles(p, out);
    else if (entry.endsWith(".mdx") || entry.endsWith(".md")) out.push(p);
  }
  return out;
};
// `<docsRoot>/fr/quickstart/overview.mdx` → `fr/quickstart/overview` (slug form)
const fileToSlug = (rel) =>
  rel
    .split(sep)
    .join("/")
    .replace(/\.mdx?$/, "");

for (const [locale, navSet] of localeNav) {
  // (a) nav → file: a navigated locale page with no content file on disk.
  for (const slug of navSet) {
    if (!fileExists(slug)) {
      failures.push(
        `locale "${locale}" navigation lists "${slug}" but no content file exists for it (expected ${slug}.mdx|.md or ${slug}/index.mdx|.md)`,
      );
    }
  }
  // (c) file → nav: a locale content file on disk that no navigation lists.
  const localeDir = resolve(docsRoot, locale);
  if (existsSync(localeDir)) {
    for (const file of walkLocaleFiles(localeDir)) {
      const slug = fileToSlug(relative(docsRoot, file));
      const collapsed = slug.replace(/\/index$/, "");
      if (!navSet.has(slug) && !navSet.has(collapsed)) {
        failures.push(
          `locale file "${slug}" exists under "${locale}/" but is not listed in the "${locale}" navigation (orphaned translation)`,
        );
      }
    }
  }
}

// ── Regression invariant: root → introduction ───────────────────────────────
// Guards the "docs root opens for-agents instead of introduction" bug.
const rootRedirect = redirects.find((r) => r?.source === "/");
if (!rootRedirect) {
  failures.push(
    'missing root redirect: expected a redirect with source "/" and destination "/introduction" so the docs root lands on the Introduction page (Mintlify otherwise serves the first navigation tab, currently "For AI Agents")',
  );
} else if (toSlug(rootRedirect.destination ?? "") !== "introduction") {
  failures.push(
    `root redirect points at "${rootRedirect.destination}", expected "/introduction"`,
  );
} else if (!pages.has("introduction")) {
  failures.push(
    'root redirect targets "/introduction" but "introduction" is not a navigable page',
  );
} else if (verbose) {
  console.log('✓ root invariant: "/" → "/introduction" (introduction is navigable)');
}

// ── Report ───────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n✗ check-redirects: ${failures.length} problem(s) found:`);
  for (const f of failures) console.error(`  - ${f}`);
  exit(1);
}

const localeSummary = enforcedLocales.length
  ? `; locale nav/file parity OK (${enforcedLocales.join(", ")})`
  : "";
console.log(
  `✓ check-redirects: ${redirects.length} redirect(s) OK; root → /introduction verified; no chains/cycles${localeSummary}.`,
);
exit(0);
