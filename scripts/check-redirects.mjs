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
 *   5. Reconciles every non-default locale navigation block (fr/es/…,
 *      derived generically from `navigation.languages`) against the files
 *      on disk — only a handful of the 600+ pages are localized, so nothing
 *      else keeps the localized nav in sync:
 *        (a) every page listed in a locale's nav block has a content file
 *            on disk;
 *        (b) every redirect whose destination lands inside a locale resolves
 *            to a page navigable *through that locale's nav block* (stricter
 *            than the file-exists check in step 3); a redirect entering a
 *            locale with no navigable block fails closed;
 *        (c) every `<locale>/**` content file on disk is listed in that
 *            locale's nav block — no orphan localized files.
 *
 * Sibling to `check-doc-examples.mjs` / `check-spec-examples.mjs` and
 * follows the same contract:
 *
 *   Exits 0 on clean. Exits 1 on any integrity failure. Exits 2 on bad
 *   CLI usage.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
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
  if (resolves(slug)) {
    if (verbose) console.log(`✓ ${source} → ${destination}`);
  } else {
    failures.push(
      `redirect "${source}" → "${destination}" points at a page that does not exist (resolved slug: "${slug}")`,
    );
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

// ── Locale navigation completeness ───────────────────────────────────────
// Only a handful of the 600+ pages are localized (fr/es), and nothing else
// asserts the localized navigation stays in sync with the files on disk: a
// renamed/deleted localized page leaves a dangling nav entry, and a new
// localized file can ship without ever being linked into its nav block.
// Locales are derived generically from `navigation.languages` (every entry
// not marked `default`) — never hard-coded.
const languages = Array.isArray(docs.navigation?.languages)
  ? docs.navigation.languages
  : [];
const localeLangs = languages.filter(
  (l) => l && typeof l.language === "string" && l.default !== true,
);

// locale code → set of page slugs declared in that language block
const localePages = new Map();
for (const lang of localeLangs) {
  const localeSet = new Set();
  collectPagesInto(lang, localeSet);
  localePages.set(lang.language, localeSet);
}

// Recursively list every file under `dir` (absolute paths); [] if absent.
function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full));
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

let localizedPageCount = 0;
let orphanCount = 0;

// (a) every localized nav entry must have a content file on disk.
for (const [locale, localeSet] of localePages) {
  localizedPageCount += localeSet.size;
  for (const slug of localeSet) {
    if (fileExists(slug)) {
      if (verbose) console.log(`✓ ${locale} nav entry: ${slug}`);
    } else {
      failures.push(
        `locale "${locale}" nav entry "${slug}" has no content file on disk ` +
          `(expected ${slug}.mdx|.md or ${slug}/index.mdx|.md)`,
      );
    }
  }
}

// (b) every redirect whose DESTINATION lands inside a known locale must
// resolve to a page navigable through that locale's nav block. Destination
// prefix is the primary classifier: it matches the acceptance criterion
// exactly and never misfires on a cross-locale "exit" redirect.
const localeOfSlug = (slug) => {
  for (const locale of localePages.keys()) {
    if (slug === locale || slug.startsWith(`${locale}/`)) return locale;
  }
  return null;
};
for (const r of redirects) {
  const destination = r?.destination;
  if (typeof destination !== "string" || destination === "") continue;
  if (isExternal(destination) || isWildcard(destination)) continue;
  const destSlug = toSlug(destination);
  const locale = localeOfSlug(destSlug);
  if (locale && !localePages.get(locale).has(destSlug)) {
    failures.push(
      `redirect "${r.source}" → "${destination}" targets locale "${locale}" ` +
        `but "${destSlug}" is not a navigable page in that locale's nav block`,
    );
  }
}

// (b, edge case) a redirect entering a *declared* locale whose nav block is
// empty must fail closed rather than silently pass. Kept orthogonal to the
// destination check above so a legitimate cross-locale redirect is never
// mistaken for a broken localized one.
for (const r of redirects) {
  const source = r?.source;
  if (typeof source !== "string" || source === "") continue;
  const seg = toSlug(source).split("/")[0];
  if (localePages.has(seg) && localePages.get(seg).size === 0) {
    failures.push(
      `redirect "${source}" enters locale "${seg}" but that locale has no ` +
        `navigable pages in its language block`,
    );
  }
}

// (c) every localized file on disk must be listed in its locale's nav block.
for (const [locale, localeSet] of localePages) {
  for (const full of walkFiles(resolve(docsRoot, locale))) {
    if (!/\.mdx?$/i.test(full)) continue;
    const rel = relative(docsRoot, full).replace(/\\/g, "/");
    const raw = rel.replace(/\.mdx?$/i, "");
    const collapsed = raw.replace(/\/index$/, "");
    if (!localeSet.has(raw) && !localeSet.has(collapsed)) {
      orphanCount++;
      failures.push(
        `orphan localized file "${rel}" exists on disk but is not listed in ` +
          `the "${locale}" navigation block`,
      );
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n✗ check-redirects: ${failures.length} problem(s) found:`);
  for (const f of failures) console.error(`  - ${f}`);
  exit(1);
}

console.log(
  `✓ check-redirects: ${redirects.length} redirect(s) OK; ` +
    `root → /introduction verified; ${localePages.size} locale(s) reconciled ` +
    `(${localizedPageCount} localized pages, ${orphanCount} orphans).`,
);
exit(0);
