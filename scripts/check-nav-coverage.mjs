#!/usr/bin/env node
/**
 * check-nav-coverage.mjs — search-index coverage auditor (file → nav).
 *
 * docs.json sets `seo.indexing = "navigable"`, so Mintlify indexes ONLY
 * pages reachable from `navigation`. A customer-facing page that exists on
 * disk but is absent from navigation therefore ships silently unsearchable —
 * no build error, no broken link, just an invisible page. `mint broken-links`
 * won't catch it, and `check-nav-pages.mjs` checks the OPPOSITE direction
 * (every nav slug has a backing file). This script closes the remaining gap
 * from the other side: every customer-facing file on disk must be navigated
 * (or an explicit, intentional exception).
 *
 * Relationship to siblings — the three gates are disjoint:
 *   • check-redirects.mjs   — redirect destinations resolve; locale nav/file parity.
 *   • check-nav-pages.mjs   — nav → file: every navigable slug has a content file.
 *   • check-nav-coverage.mjs — file → nav: every customer-facing file is navigated.
 *
 * It:
 *   1. Parses docs.json (also a syntax check) and walks the whole
 *      `navigation` tree (tabs / dropdowns / anchors / groups / pages, nested
 *      arbitrarily) to build the set of navigable page slugs — the same
 *      generic `collectPagesInto` walk check-redirects/check-nav-pages use.
 *   2. Enumerates every customer-facing `.mdx`/`.md` file under the docs root,
 *      where "customer-facing" EXCLUDES, structurally:
 *        - internal / asset / tooling directories (app_docs, specs,
 *          node_modules, .git, .github, scripts, snippets, images, logo, lib);
 *        - non-default LOCALE trees (fr/, es/, …) — derived data-driven from
 *          `navigation.languages`, NOT hard-coded, so a future locale needs no
 *          edit here; locale nav/file parity is owned by check-redirects.mjs;
 *        - underscore-prefixed files AND directories (Mintlify's convention
 *          for design docs / drafts / snippet partials that are never pages);
 *        - repo-root meta files (AGENTS.md, SECURITY.md, README*).
 *   3. For every remaining page, asserts its slug is navigable. A file
 *      `<slug>.mdx|.md` and `<slug>/index.mdx|.md` both normalize to `<slug>`
 *      (Mintlify serves `foo/index.mdx` at `/foo`). Any page that is neither
 *      navigated nor listed in the allowlist is reported as an ORPHAN, named.
 *   4. Honours an explicit allowlist (scripts/nav-coverage-allowlist.json) of
 *      intentional exceptions, matched by either page slug or repo-relative
 *      file path. The allowlist is for residual exceptions ONLY — never
 *      allowlist a genuine customer page to silence the gate; navigate it.
 *
 * Sibling to check-nav-pages.mjs; same contract: exits 0 on clean, 1 on any
 * coverage failure, 2 on bad CLI usage. Node built-ins only (no deps).
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

// Directories that never contain customer-facing, navigable pages. Matched by
// directory NAME at any depth (the conventional "ignore node_modules anywhere"
// approach). app_docs/ and specs/ are internal feature specs; images/, logo/
// are assets; scripts/, lib/, node_modules, .git, .github are tooling;
// snippets/ is Mintlify reusable content (not pages).
const EXCLUDE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".github",
  "scripts",
  "snippets",
  "images",
  "logo",
  "lib",
  "app_docs",
  "specs",
]);

// Repo-root files that are meta, not documentation pages. Matched only at the
// docs root (depth 0), case-insensitively.
const isRootMetaFile = (rel) =>
  !rel.includes("/") && /^(agents\.md|security\.md|readme)/i.test(rel);

// ── Allowlist ────────────────────────────────────────────────────────────────
// Returns a Set of intentional exceptions (page slugs and/or repo-relative
// file paths). A missing/unreadable file is treated as an empty allowlist so
// the gate stays usable in trees that don't ship one (e.g. self-test fixtures).
export function loadAllowlist(allowlistPath) {
  if (!allowlistPath || !existsSync(allowlistPath)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(allowlistPath, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : (parsed.allow ?? []);
    return new Set(entries.filter((e) => typeof e === "string"));
  } catch {
    return new Set(); // malformed allowlist must not mask real orphans
  }
}

// ── Core check (exported shape for --self-test) ──────────────────────────────
// Returns { navPages, candidates, checked, excluded, allowlisted, orphans }
// for the given docs.json path. `orphans` is an array of { file, slug }.
export function checkNavCoverage(docsPath, { allowlistPath } = {}) {
  const docs = JSON.parse(readFileSync(docsPath, "utf8"));
  const docsRoot = dirname(resolve(docsPath));

  // Generic walk of the navigation tree (identical idiom to sibling gates):
  // page slugs are the strings inside any `pages` array, at any depth.
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
  const navPages = new Set();
  collectPagesInto(docs.navigation ?? {}, navPages);

  // Non-default locale codes (data-driven, NOT hard-coded) — same derivation
  // as check-redirects/check-nav-pages. The default language (en) is served at
  // the root; every other language is a locale tree owned by check-redirects.
  const localeCodes = new Set();
  for (const lang of docs.navigation?.languages ?? []) {
    if (typeof lang?.language === "string" && !lang?.default) {
      localeCodes.add(lang.language);
    }
  }

  const allow = loadAllowlist(allowlistPath);

  // A page is navigated if its slug is listed, or listed in `<slug>/index`
  // form (Mintlify serves foo/index.mdx at /foo; nav may spell it either way).
  const isNavigated = (slug) => navPages.has(slug) || navPages.has(`${slug}/index`);
  // `guides/setup.mdx` and `guides/setup/index.mdx` both → `guides/setup`.
  const toSlug = (rel) => rel.replace(/\.(mdx|md)$/, "").replace(/\/index$/, "");

  // Recursively enumerate candidate .mdx/.md files, pruning excluded dirs.
  const candidates = [];
  const walk = (absDir, relDir) => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith("_")) continue; // snippet/partial dirs
        if (localeCodes.has(childRel.split("/")[0])) continue; // top-level locale tree
        walk(join(absDir, entry.name), childRel);
      } else if (/\.(mdx|md)$/.test(entry.name)) {
        candidates.push(childRel);
      }
    }
  };
  walk(docsRoot, "");

  const orphans = [];
  let checked = 0;
  let excluded = 0;
  let allowlisted = 0;
  for (const rel of candidates) {
    const base = basename(rel);
    if (base.startsWith("_")) { excluded++; continue; } // design docs / drafts
    if (isRootMetaFile(rel)) { excluded++; continue; } // AGENTS/SECURITY/README

    const slug = toSlug(rel);
    if (allow.has(rel) || allow.has(slug)) { allowlisted++; continue; }

    checked++;
    if (!isNavigated(slug)) orphans.push({ file: rel, slug });
  }

  return {
    navPages: navPages.size,
    candidates: candidates.length,
    checked,
    excluded,
    allowlisted,
    orphans,
  };
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Builds throwaway fixtures in a temp dir and asserts the gate FLAGS a
// customer-facing page absent from nav, and PASSES a tree whose only unnavigated
// files are internal (app_docs/specs), locale-prefixed, underscore-prefixed,
// root-meta, or explicitly allowlisted.
function selfTest() {
  let pass = 0;
  let fail = 0;
  const assert = (name, cond) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}`); }
  };

  const root = mkdtempSync(join(tmpdir(), "nav-coverage-selftest-"));
  const writeDocs = (nav, name = "docs.json") => {
    const p = join(root, name);
    writeFileSync(p, JSON.stringify({ seo: { indexing: "navigable" }, navigation: nav }, null, 2));
    return p;
  };
  const touch = (rel) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "# fixture\n");
  };
  const writeAllow = (list, name = "allow.json") => {
    const p = join(root, name);
    writeFileSync(p, JSON.stringify({ allow: list }, null, 2));
    return p;
  };

  // Content tree shared by the cases below.
  touch("introduction.mdx");            // navigated
  touch("guides/setup/index.mdx");      // navigated (index form → /guides/setup)
  touch("guides/orphan.mdx");           // customer-facing, NOT navigated → orphan
  touch("app_docs/internal-spec.mdx");  // internal dir → excluded
  touch("specs/wire-format.md");        // internal dir → excluded
  touch("api-reference/_DESIGN-notes.md"); // underscore file → excluded
  touch("_drafts/wip.mdx");             // underscore dir → excluded
  touch("AGENTS.md");                   // root meta → excluded
  touch("SECURITY.md");                 // root meta → excluded
  touch("fr/introduction.mdx");         // locale tree → excluded

  const nav = {
    languages: [
      { language: "en", default: true, tabs: [{ pages: ["introduction", "guides/setup"] }] },
      { language: "fr", tabs: [{ pages: ["fr/introduction"] }] },
    ],
  };

  // 1) Dirty: the orphaned customer page is flagged, and nothing else is.
  const dirtyDocs = writeDocs(nav);
  const r1 = checkNavCoverage(dirtyDocs); // no allowlist
  assert("orphaned customer page → exactly 1 orphan", r1.orphans.length === 1);
  assert("orphan names guides/orphan", r1.orphans.some((o) => o.file === "guides/orphan.mdx"));
  assert("navigated page (introduction) NOT flagged", !r1.orphans.some((o) => o.slug === "introduction"));
  assert("index-form navigated page (guides/setup) NOT flagged", !r1.orphans.some((o) => o.slug === "guides/setup"));
  assert("internal app_docs/ page NOT flagged", !r1.orphans.some((o) => o.file.startsWith("app_docs/")));
  assert("internal specs/ page NOT flagged", !r1.orphans.some((o) => o.file.startsWith("specs/")));
  assert("underscore file NOT flagged", !r1.orphans.some((o) => o.file.includes("_DESIGN")));
  assert("underscore dir NOT flagged", !r1.orphans.some((o) => o.file.startsWith("_drafts/")));
  assert("root meta (AGENTS/SECURITY) NOT flagged", !r1.orphans.some((o) => o.file === "AGENTS.md" || o.file === "SECURITY.md"));
  assert("locale-tree page NOT flagged", !r1.orphans.some((o) => o.file.startsWith("fr/")));

  // 2) Allowlisted: the same orphan, but declared intentional → clean.
  const allowBySlug = writeAllow(["guides/orphan"], "allow-slug.json");
  const r2 = checkNavCoverage(dirtyDocs, { allowlistPath: allowBySlug });
  assert("allowlisted-by-slug orphan → 0 orphans", r2.orphans.length === 0);
  assert("allowlisted count reflects the exception", r2.allowlisted === 1);

  const allowByPath = writeAllow(["guides/orphan.mdx"], "allow-path.json");
  const r3 = checkNavCoverage(dirtyDocs, { allowlistPath: allowByPath });
  assert("allowlisted-by-file-path orphan → 0 orphans", r3.orphans.length === 0);

  // 3) Clean: navigate the erstwhile orphan → 0 orphans with no allowlist.
  const cleanNav = {
    languages: [
      { language: "en", default: true, tabs: [{ pages: ["introduction", "guides/setup", "guides/orphan"] }] },
      { language: "fr", tabs: [{ pages: ["fr/introduction"] }] },
    ],
  };
  const cleanDocs = writeDocs(cleanNav, "docs-clean.json");
  const r4 = checkNavCoverage(cleanDocs);
  assert("fully-navigated tree → 0 orphans", r4.orphans.length === 0);
  assert("checked count counts only customer-facing pages (3)", r4.checked === 3);
  assert("excluded count counts internal/meta files", r4.excluded >= 3);

  // 4) A malformed allowlist must NOT mask a real orphan.
  const badAllow = join(root, "bad-allow.json");
  writeFileSync(badAllow, "{ not json");
  const r5 = checkNavCoverage(dirtyDocs, { allowlistPath: badAllow });
  assert("malformed allowlist does not hide the orphan", r5.orphans.length === 1);

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const args = argv.slice(2);
  let verbose = false;
  let docsPath = fileURLToPath(new URL("../docs.json", import.meta.url));
  let allowlistPath = fileURLToPath(new URL("nav-coverage-allowlist.json", import.meta.url));
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verbose") verbose = true;
    else if (args[i] === "--self-test") {
      exit(selfTest() ? 0 : 1);
    } else if (args[i] === "--docs") {
      if (i + 1 >= args.length) { console.error("--docs requires a path argument"); exit(2); }
      docsPath = args[++i];
    } else if (args[i] === "--allowlist") {
      if (i + 1 >= args.length) { console.error("--allowlist requires a path argument"); exit(2); }
      allowlistPath = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(
        "Usage: check-nav-coverage.mjs [--docs path/to/docs.json] [--allowlist path/to/allowlist.json] [--verbose] [--self-test]",
      );
      exit(0);
    } else {
      console.error(`Unknown flag: ${args[i]}`);
      exit(2);
    }
  }

  let result;
  try {
    result = checkNavCoverage(docsPath, { allowlistPath });
  } catch (err) {
    console.error(`✗ Could not read/parse ${docsPath}: ${err.message}`);
    exit(1);
  }

  if (result.orphans.length > 0) {
    console.error(
      `\n✗ check-nav-coverage: ${result.orphans.length} customer-facing page(s) exist on disk but are NOT in docs.json navigation`,
    );
    console.error(
      `  (seo.indexing='navigable' means these ship silently unsearchable — navigate them, or add an intentional exception to scripts/nav-coverage-allowlist.json):`,
    );
    for (const o of result.orphans) console.error(`  - ${o.file}  (slug: ${o.slug})`);
    exit(1);
  }
  if (verbose) {
    console.log(
      `nav pages: ${result.navPages}; candidate files: ${result.candidates}; ` +
        `customer-facing checked: ${result.checked}; excluded (internal/meta): ${result.excluded}; ` +
        `allowlisted: ${result.allowlisted}`,
    );
  }
  console.log(
    `✓ check-nav-coverage: all ${result.checked} customer-facing page(s) are navigated (searchable).`,
  );
  exit(0);
}

main();
