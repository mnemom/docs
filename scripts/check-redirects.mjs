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
let docsPath = fileURLToPath(new URL("../docs.json", import.meta.url));
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--verbose") verbose = true;
  else if (args[i] === "--docs") {
    if (i + 1 >= args.length) {
      console.error("--docs requires a path argument");
      exit(2);
    }
    docsPath = args[++i];
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(
      "Usage: check-redirects.mjs [--docs path/to/docs.json] [--verbose]",
    );
    exit(0);
  } else {
    console.error(`Unknown flag: ${args[i]}`);
    exit(2);
  }
}

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

// `/foo/bar#sec?x=1` (redirect destination) → `foo/bar` (page slug form)
const toSlug = (dest) =>
  dest
    .split(/[#?]/)[0]
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
const isWildcard = (s) => s.includes(":") || s.includes("*");
const isExternal = (s) => /^https?:\/\//.test(s);

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
  `✓ check-redirects: ${redirects.length} redirect(s) OK; root → /introduction verified${localeSummary}.`,
);
exit(0);
