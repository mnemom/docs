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
 *
 * Sibling to `check-doc-examples.mjs` / `check-spec-examples.mjs` and
 * follows the same contract:
 *
 *   Exits 0 on clean. Exits 1 on any integrity failure. Exits 2 on bad
 *   CLI usage.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
const pages = new Set();
function collectPages(node) {
  if (Array.isArray(node)) {
    for (const child of node) collectPages(child);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "pages" && Array.isArray(value)) {
        for (const p of value) {
          if (typeof p === "string") pages.add(p);
          else collectPages(p); // nested group object inside `pages`
        }
      } else {
        collectPages(value);
      }
    }
  }
}
collectPages(docs.navigation ?? {});

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

// ── Report ───────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n✗ check-redirects: ${failures.length} problem(s) found:`);
  for (const f of failures) console.error(`  - ${f}`);
  exit(1);
}

console.log(
  `✓ check-redirects: ${redirects.length} redirect(s) OK; root → /introduction verified.`,
);
exit(0);
