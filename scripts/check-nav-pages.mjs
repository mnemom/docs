#!/usr/bin/env node
/**
 * check-nav-pages.mjs — navigation → page-existence gate.
 *
 * `check-redirects.mjs` validates the inverse direction (redirect
 * destinations resolve to navigable pages) and locale nav⇄file parity for
 * the ENFORCED locales (fr, es). Nothing, however, asserts that every page
 * slug in the DEFAULT (en) `navigation` has a backing content file on disk.
 * A nav slug can point at a missing or since-deleted file and Mintlify
 * renders a dead nav item (e.g. the four orphan `/admin-security-advisories`
 * entries this gate was written for). This script closes that gap.
 *
 * It:
 *   1. Parses docs.json (also a syntax check).
 *   2. Walks the whole `navigation` tree (tabs / dropdowns / anchors /
 *      groups / pages, nested arbitrarily) to build the set of navigable
 *      page slugs — the same generic walk `check-redirects.mjs` uses.
 *   3. For every navigable slug, asserts a content file exists on disk:
 *      `<slug>.mdx|.md` or `<slug>/index.mdx|.md` (Mintlify serves an
 *      unlisted `.mdx` directly and maps `<slug>/index.mdx` to `/<slug>`).
 *      Locale-prefixed slugs (first segment = an ENFORCED locale, derived
 *      data-driven from `navigation.languages`, NOT a hard-coded fr/es
 *      list) are SKIPPED here — `check-redirects.mjs` owns locale nav/file
 *      parity, so the two gates stay disjoint and a future locale (e.g.
 *      `de`) needs no edit here.
 *
 * Complements `mint broken-links`, which only checks in-content links, not
 * nav membership. Sibling to `check-redirects.mjs` and follows the same
 * contract: exits 0 on clean, 1 on any integrity failure, 2 on bad CLI
 * usage.
 */

import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

// ── Core check (exported shape for --self-test) ──────────────────────────────
// Returns { pages, checked, skipped, failures } for the given docs.json path.
export function checkNavPages(docsPath) {
  const docs = JSON.parse(readFileSync(docsPath, "utf8"));
  const docsRoot = dirname(resolve(docsPath));

  // Generic walk of the navigation tree: page slugs are the strings inside
  // any `pages` array, at any depth (tabs / dropdowns / anchors / groups).
  const collectPagesInto = (node, set) => {
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
  };
  const pages = new Set();
  collectPagesInto(docs.navigation ?? {}, pages);

  if (pages.size === 0) {
    return { pages: 0, checked: 0, skipped: 0, failures: ["No navigable pages found — is `navigation` present?"] };
  }

  // Enforced locales (data-driven, NOT hard-coded) — same derivation as
  // check-redirects.mjs. The default language (en) is served at the root; its
  // nav→file existence is what THIS gate owns. Every other language is an
  // enforced locale whose nav/file parity check-redirects.mjs owns, so we skip
  // locale-prefixed slugs to keep the two gates disjoint.
  const localeCodes = new Set();
  for (const lang of docs.navigation?.languages ?? []) {
    if (typeof lang?.language === "string" && !lang?.default) {
      localeCodes.add(lang.language);
    }
  }

  const fileExists = (slug) =>
    [`${slug}.mdx`, `${slug}.md`, `${slug}/index.mdx`, `${slug}/index.md`].some(
      (rel) => existsSync(resolve(docsRoot, rel)),
    );

  const failures = [];
  let checked = 0;
  let skipped = 0;
  for (const slug of pages) {
    if (localeCodes.has(slug.split("/")[0])) {
      skipped++; // locale-prefixed: owned by check-redirects.mjs
      continue;
    }
    checked++;
    if (!fileExists(slug)) {
      failures.push(
        `navigation lists "${slug}" but no content file exists for it (expected ${slug}.mdx|.md or ${slug}/index.mdx|.md)`,
      );
    }
  }
  return { pages: pages.size, checked, skipped, failures };
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Builds throwaway fixtures in a temp dir and asserts the gate FAILS on a nav
// entry with no backing file and PASSES when every nav page has one (incl. the
// `<slug>/index.mdx` form and a skipped locale-prefixed slug).
function selfTest() {
  let pass = 0;
  let fail = 0;
  const assert = (name, cond) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}`); }
  };

  const root = mkdtempSync(join(tmpdir(), "nav-pages-selftest-"));
  const writeDocs = (nav) => {
    const p = join(root, "docs.json");
    writeFileSync(p, JSON.stringify({ navigation: nav }, null, 2));
    return p;
  };
  const touch = (rel) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "# fixture\n");
  };

  // Backing files: introduction.mdx, guides/setup/index.mdx (index form).
  touch("introduction.mdx");
  touch("guides/setup/index.mdx");
  touch("fr/introduction.mdx"); // locale file (should be skipped regardless)

  // 1) Clean tree: every checked nav page has a file → 0 failures.
  const clean = writeDocs({
    languages: [
      { language: "en", default: true, tabs: [{ pages: ["introduction", "guides/setup"] }] },
      { language: "fr", tabs: [{ pages: ["fr/introduction"] }] },
    ],
  });
  const r1 = checkNavPages(clean);
  assert("clean tree → 0 failures", r1.failures.length === 0);
  assert("clean tree → checked 2 en pages", r1.checked === 2);
  assert("clean tree → skipped 1 locale page", r1.skipped === 1);
  assert("index-form slug resolves via <slug>/index.mdx", !r1.failures.some((f) => f.includes("guides/setup")));

  // 2) Missing file: nav lists a page with no file → exactly that failure.
  const dirty = writeDocs({
    languages: [
      { language: "en", default: true, tabs: [{ pages: ["introduction", "concepts/ghost-page"] }] },
    ],
  });
  const r2 = checkNavPages(dirty);
  assert("missing-file page → 1 failure", r2.failures.length === 1);
  assert("failure names the orphan slug", r2.failures.some((f) => f.includes("concepts/ghost-page")));
  assert("failure does NOT flag the page that exists", !r2.failures.some((f) => f.includes('"introduction"')));

  // 3) Locale-only miss is NOT this gate's job: an en nav that only references
  //    a missing LOCALE page passes here (check-redirects owns it).
  const localeMiss = writeDocs({
    languages: [
      { language: "en", default: true, tabs: [{ pages: ["introduction"] }] },
      { language: "es", tabs: [{ pages: ["es/nonexistent"] }] },
    ],
  });
  const r3 = checkNavPages(localeMiss);
  assert("locale-prefixed miss is skipped (0 failures here)", r3.failures.length === 0);

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const args = argv.slice(2);
  let verbose = false;
  let docsPath = fileURLToPath(new URL("../docs.json", import.meta.url));
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verbose") verbose = true;
    else if (args[i] === "--self-test") {
      exit(selfTest() ? 0 : 1);
    } else if (args[i] === "--docs") {
      if (i + 1 >= args.length) { console.error("--docs requires a path argument"); exit(2); }
      docsPath = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: check-nav-pages.mjs [--docs path/to/docs.json] [--verbose] [--self-test]");
      exit(0);
    } else {
      console.error(`Unknown flag: ${args[i]}`);
      exit(2);
    }
  }

  let result;
  try {
    result = checkNavPages(docsPath);
  } catch (err) {
    console.error(`✗ Could not read/parse ${docsPath}: ${err.message}`);
    exit(1);
  }

  if (result.failures.length > 0) {
    console.error(`\n✗ check-nav-pages: ${result.failures.length} problem(s) found:`);
    for (const f of result.failures) console.error(`  - ${f}`);
    exit(1);
  }
  if (verbose) console.log(`checked ${result.checked} nav page(s); skipped ${result.skipped} locale-prefixed slug(s)`);
  console.log(`✓ check-nav-pages: ${result.checked} navigable page(s) all resolve to a content file.`);
  exit(0);
}

main();
