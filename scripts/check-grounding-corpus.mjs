#!/usr/bin/env node
/**
 * check-grounding-corpus.mjs — Aletheia Q&A grounding-corpus manifest gate.
 *
 * Aletheia (the in-product Q&A assistant, MNE-1934) may ground answers ONLY on
 * a curated set of trusted, Mnemom-owned sources. Per the Constellation
 * repo-ownership rule ("docs = Q&A grounding corpus / trusted sources"), this
 * docs repo OWNS that list: scripts/aletheia-corpus-manifest.json. This gate
 * keeps the manifest honest, drift-proof, and non-leaking.
 *
 * This change is DARK: the manifest is a scripts/ data file (not a Mintlify
 * page), so it renders nothing and exposes nothing to customers. The retrieval/
 * ranking engine, the feature flag, and the Wassim/Alex allowlist live in other
 * repos and are out of scope — this is the manifest and its validation only.
 *
 * It enforces, fail-closed (a missing/empty/malformed manifest is a hard fail,
 * never a vacuous pass):
 *   1. Shape — `sources` is a non-empty array of well-formed entries.
 *   2. Non-empty `title` on every entry.
 *   3. Unique `source_id` across all entries (every duplicate is reported).
 *   4. URL ownership — each `url` is an absolute https:// URL whose host is in
 *      the hard-coded Mnemom-owned allowlist. This is what "resolves to a
 *      Mnemom-owned property" means in CI: a deterministic, offline check (a
 *      live fetch would make a BLOCKING gate flaky and non-reproducible).
 *   5. Collection coverage — at least one entry each in `docs`, `knowledgebase`,
 *      `for-agents`; exactly one `for-agents` entry pinned to the canonical URL.
 *   6. docs↔nav reconciliation — the `docs` collection must exactly equal the
 *      set of default-locale navigable pages from docs.json (a new docs page
 *      absent from the corpus, or a corpus entry pointing at a non-navigable
 *      slug, fails CI), and each docs entry's `title`/`url` must match the
 *      backing page's real frontmatter title / canonical URL.
 *
 * The owned-host allowlist is hard-coded HERE (not read from the manifest) so a
 * manifest edit can never widen the definition of "Mnemom-owned." `github.com`
 * is intentionally excluded: a private-repo GitHub URL must never enter a corpus
 * consumed by a repo that auto-deploys publicly (private-repo-topology leak
 * safety), aligning with the internal-reference gate.
 *
 * Sibling to check-model-coverage.mjs / check-nav-coverage.mjs; same contract:
 *   Exits 0 clean. Exits 1 on any failure (shape, duplicate id, non-owned URL,
 *   empty title, missing collection, docs↔nav drift, unparseable input, or a
 *   failed self-test). Exits 2 on bad CLI usage. Node ≥22 built-ins only.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

// ── Configuration ────────────────────────────────────────────────────────────
// Hard-coded, single source of truth for "Mnemom-owned." NOT read from the
// manifest, so a manifest edit can never widen ownership. `github.com` is
// intentionally ABSENT: a private-repo GitHub URL must never enter the corpus
// (private-repo-topology leak safety; aligns with the internal-reference gate).
export const OWNED_HOSTS = new Set([
  "docs.mnemom.ai",
  "www.mnemom.ai",
  "mnemom.ai",
  "api.mnemom.ai",
  "gateway.mnemom.ai",
]);

export const COLLECTIONS = ["docs", "knowledgebase", "for-agents"];
const DOCS_HOST = "docs.mnemom.ai";
// The one canonical `for-agents` source (the marketing site's agent hub).
export const FOR_AGENTS_URL = "https://www.mnemom.ai/for-agents";

const scriptDir = () => dirname(fileURLToPath(import.meta.url));

// ── docs.json navigation walk (shared idiom with check-nav-coverage.mjs) ──────
// Page slugs are the strings inside any `pages` array, at any depth (tabs /
// dropdowns / anchors / groups / nested group objects).
export function collectPagesInto(node, set) {
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

// The authoritative source list for the `docs` collection: the DEFAULT-locale
// (en) navigable pages only. Walking the full `navigation` tree would fold in
// the fr/es locale slugs (owned by check-redirects.mjs); the corpus is en-only.
// The `global` section carries only anchors (no pages), so it is skipped.
export function defaultLocaleNavSlugs(docs) {
  const languages = docs?.navigation?.languages ?? [];
  const def = languages.find((l) => l && l.default === true);
  const set = new Set();
  if (def) collectPagesInto(def, set);
  return set;
}

// ── Frontmatter title extraction ──────────────────────────────────────────────
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Parse the `title:` value out of a page's YAML frontmatter. Returns the string
// (quotes stripped/unescaped) or null when absent. Titles here are plain
// scalars (quoted or bare); this handles double/single-quoted and bare forms.
export function parseFrontmatterTitle(text) {
  const fm = text.match(FM_RE);
  if (!fm) return null;
  const m = fm[1].match(/^title:[ \t]*(.+?)[ \t]*$/m);
  if (!m) return null;
  const v = m[1].trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

// Resolve a slug to its backing content file and return its frontmatter title,
// or null if no file/title exists. `<slug>.mdx|.md` and `<slug>/index.mdx|.md`
// both back `<slug>` (Mintlify serves `foo/index.mdx` at `/foo`).
export function resolvePageTitle(root, slug) {
  const candidates = [
    `${slug}.mdx`,
    `${slug}.md`,
    `${slug}/index.mdx`,
    `${slug}/index.md`,
  ];
  for (const rel of candidates) {
    const abs = resolve(root, rel);
    if (existsSync(abs)) {
      return parseFrontmatterTitle(readFileSync(abs, "utf8"));
    }
  }
  return null;
}

// The canonical docs URL for a slug. A trailing `/index` is stripped because
// Mintlify serves `foo/index.mdx` at `/foo` (e.g. `for-agents/index` → /for-agents).
export function expectedDocsUrl(slug) {
  return `https://${DOCS_HOST}/${slug.replace(/\/index$/, "")}`;
}

// The docs slug carried by a `docs:` source_id (the reconciliation key).
const slugFromDocsId = (sourceId) => sourceId.replace(/^docs:/, "");

// ── Core check (pure — exported for --self-test) ─────────────────────────────
// checkCorpus({ manifest, navSlugs, pageTitles }) → { ok, errors }
//   · manifest   — the parsed manifest object (or null/garbage → hard fail).
//   · navSlugs   — Set<string> of default-locale navigable page slugs.
//   · pageTitles — { [slug]: string } frontmatter titles for those slugs.
// No process.exit / console here, so it can be exercised against fixtures.
export function checkCorpus({ manifest, navSlugs, pageTitles }) {
  const errors = [];
  const add = (code, detail) => errors.push({ code, detail });
  const nav = navSlugs instanceof Set ? navSlugs : new Set(navSlugs ?? []);
  const titles = pageTitles ?? {};

  // 1. Shape — fail closed on a missing/empty/malformed manifest.
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    add("empty_or_invalid_manifest", "manifest is missing or not an object");
    return { ok: false, errors };
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    add("empty_or_invalid_manifest", "manifest.sources must be a non-empty array");
    return { ok: false, errors };
  }

  const seenIds = new Map(); // source_id → count
  const collectionCounts = { docs: 0, knowledgebase: 0, "for-agents": 0 };
  const docsSlugs = new Set();

  for (let i = 0; i < manifest.sources.length; i++) {
    const e = manifest.sources[i];
    const where = `sources[${i}]`;
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      add("malformed_entry", `${where} is not an object`);
      continue;
    }

    // source_id — must be a non-empty string; track for uniqueness.
    if (typeof e.source_id !== "string" || e.source_id.trim() === "") {
      add("malformed_entry", `${where} has a missing/empty source_id`);
    } else {
      seenIds.set(e.source_id, (seenIds.get(e.source_id) ?? 0) + 1);
    }

    // 2. Non-empty title.
    if (typeof e.title !== "string" || e.title.trim() === "") {
      add("empty_title", `${where} (${e.source_id ?? "?"}) has a missing/empty title`);
    }

    // collection — must be one of the known collections.
    if (!COLLECTIONS.includes(e.collection)) {
      add(
        "bad_collection",
        `${where} (${e.source_id ?? "?"}) has collection "${e.collection}" (expected one of ${COLLECTIONS.join(", ")})`,
      );
    } else {
      collectionCounts[e.collection]++;
    }

    // 4. URL ownership — absolute https:// with an owned host.
    let host = null;
    if (typeof e.url !== "string" || e.url.trim() === "") {
      add("bad_url", `${where} (${e.source_id ?? "?"}) has a missing/empty url`);
    } else {
      let parsed;
      try {
        parsed = new URL(e.url);
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.protocol !== "https:") {
        add("bad_url", `${where} (${e.source_id ?? "?"}) url is not an absolute https:// URL: ${e.url}`);
      } else if (!OWNED_HOSTS.has(parsed.host)) {
        add(
          "non_owned_host",
          `${where} (${e.source_id ?? "?"}) url host "${parsed.host}" is not Mnemom-owned: ${e.url}`,
        );
      } else {
        host = parsed.host;
      }
    }

    // Collect docs slugs for reconciliation (only well-identified docs entries).
    if (e.collection === "docs" && typeof e.source_id === "string") {
      docsSlugs.add(slugFromDocsId(e.source_id));
    }

    // 5b. for-agents entries must equal the one canonical URL.
    if (e.collection === "for-agents" && typeof e.url === "string" && e.url !== FOR_AGENTS_URL) {
      add(
        "bad_for_agents_url",
        `${where} (${e.source_id ?? "?"}) for-agents url must be exactly ${FOR_AGENTS_URL}, got ${e.url}`,
      );
    }

    // 6b. docs entry title/url must match the backing page (only when navigable).
    if (e.collection === "docs" && typeof e.source_id === "string") {
      const slug = slugFromDocsId(e.source_id);
      if (nav.has(slug)) {
        const expectedTitle = titles[slug];
        if (typeof e.title === "string" && e.title !== expectedTitle) {
          add(
            "title_mismatch",
            `${where} (${e.source_id}) title "${e.title}" != page frontmatter title ${
              expectedTitle === undefined ? "(none found)" : `"${expectedTitle}"`
            }`,
          );
        }
        const wantUrl = expectedDocsUrl(slug);
        if (host !== null && e.url !== wantUrl) {
          add("docs_url_mismatch", `${where} (${e.source_id}) url "${e.url}" != canonical "${wantUrl}"`);
        }
      }
    }
  }

  // 3. Unique source_id — report every duplicate.
  for (const [id, count] of seenIds) {
    if (count > 1) add("duplicate_source_id", `source_id "${id}" appears ${count} times`);
  }

  // 5a. Collection coverage — at least one entry in each collection.
  for (const c of COLLECTIONS) {
    if (collectionCounts[c] === 0) add("empty_collection", `collection "${c}" has no entries`);
  }
  // Exactly one for-agents entry.
  if (collectionCounts["for-agents"] > 1) {
    add("too_many_for_agents", `expected exactly 1 for-agents entry, found ${collectionCounts["for-agents"]}`);
  }

  // 6a. docs↔nav reconciliation (exact parity).
  for (const slug of nav) {
    if (!docsSlugs.has(slug)) {
      add("missing_from_manifest", `navigable docs page "${slug}" is absent from the corpus manifest`);
    }
  }
  for (const slug of docsSlugs) {
    if (!nav.has(slug)) {
      add("not_navigable", `manifest docs entry "docs:${slug}" points at a non-navigable slug`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// Build the reconciliation inputs (navSlugs + pageTitles) from a docs.json path.
export function buildNavContext(docsPath) {
  const docs = JSON.parse(readFileSync(docsPath, "utf8"));
  const root = dirname(resolve(docsPath));
  const navSlugs = defaultLocaleNavSlugs(docs);
  const pageTitles = {};
  for (const slug of navSlugs) {
    const title = resolvePageTitle(root, slug);
    if (title !== null) pageTitles[slug] = title;
  }
  return { navSlugs, pageTitles };
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Throwaway in-memory fixtures asserting each rule fires and each clean case
// passes. Placeholder strings are obviously non-credential (secret-scan safe).
function selfTest() {
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
  const has = (r, code) => r.errors.some((e) => e.code === code);

  // A small navigable page universe shared by the fixtures.
  const navSlugs = new Set(["introduction", "guides/setup", "for-agents/index"]);
  const pageTitles = {
    introduction: "Introduction",
    "guides/setup": "Setup",
    "for-agents/index": "For AI Agents",
  };
  const docsEntry = (slug, title) => ({
    source_id: `docs:${slug}`,
    collection: "docs",
    url: expectedDocsUrl(slug),
    title: title ?? pageTitles[slug],
  });
  const forAgents = { source_id: "for-agents:www", collection: "for-agents", url: FOR_AGENTS_URL, title: "Mnemom for agents" };
  const kb = { source_id: "kb:alpha", collection: "knowledgebase", url: "https://www.mnemom.ai/methodology/", title: "Methodology" };
  const cleanDocs = [...navSlugs].map((s) => docsEntry(s));
  const cleanManifest = () => ({
    manifest_version: 1,
    sources: [...cleanDocs.map((e) => ({ ...e })), { ...kb }, { ...forAgents }],
  });

  // 1) Clean manifest covering all three collections → ok.
  const clean = checkCorpus({ manifest: cleanManifest(), navSlugs, pageTitles });
  assert("clean manifest → ok", clean.ok && clean.errors.length === 0);

  // 2) Duplicate source_id → flagged.
  const dupM = cleanManifest();
  dupM.sources.push({ ...kb });
  assert("duplicate source_id → flagged", has(checkCorpus({ manifest: dupM, navSlugs, pageTitles }), "duplicate_source_id"));

  // 3) Empty title → flagged.
  const emptyTitleM = cleanManifest();
  emptyTitleM.sources.find((e) => e.collection === "knowledgebase").title = "";
  assert("empty title → flagged", has(checkCorpus({ manifest: emptyTitleM, navSlugs, pageTitles }), "empty_title"));

  // 4) Non-Mnemom host → flagged; github.com URL → flagged (leak-safety).
  const badHostM = cleanManifest();
  badHostM.sources.find((e) => e.collection === "knowledgebase").url = "https://example.com/x";
  assert("non-Mnemom host → flagged", has(checkCorpus({ manifest: badHostM, navSlugs, pageTitles }), "non_owned_host"));
  const ghM = cleanManifest();
  ghM.sources.find((e) => e.collection === "knowledgebase").url = "https://github.com/mnemom/private-repo/blob/main/KNOWLEDGEBASE.md";
  assert("github.com URL → flagged (leak-safety)", has(checkCorpus({ manifest: ghM, navSlugs, pageTitles }), "non_owned_host"));

  // 5) Non-https URL → flagged.
  const httpM = cleanManifest();
  httpM.sources.find((e) => e.collection === "knowledgebase").url = "http://www.mnemom.ai/methodology/";
  assert("non-https URL → flagged", has(checkCorpus({ manifest: httpM, navSlugs, pageTitles }), "bad_url"));

  // 6) Missing a whole collection (no knowledgebase) → flagged.
  const noKbM = cleanManifest();
  noKbM.sources = noKbM.sources.filter((e) => e.collection !== "knowledgebase");
  assert("missing collection → flagged", has(checkCorpus({ manifest: noKbM, navSlugs, pageTitles }), "empty_collection"));

  // 7) Two for-agents entries → flagged; wrong for-agents URL → flagged.
  const twoFaM = cleanManifest();
  twoFaM.sources.push({ source_id: "for-agents:dup", collection: "for-agents", url: FOR_AGENTS_URL, title: "Dup" });
  assert("two for-agents entries → flagged", has(checkCorpus({ manifest: twoFaM, navSlugs, pageTitles }), "too_many_for_agents"));
  const wrongFaM = cleanManifest();
  wrongFaM.sources.find((e) => e.collection === "for-agents").url = "https://www.mnemom.ai/for-humans";
  assert("wrong for-agents URL → flagged", has(checkCorpus({ manifest: wrongFaM, navSlugs, pageTitles }), "bad_for_agents_url"));

  // 8) Docs page in nav but absent from manifest → missing_from_manifest.
  const missingM = cleanManifest();
  missingM.sources = missingM.sources.filter((e) => e.source_id !== "docs:guides/setup");
  assert(
    "nav page absent from manifest → missing_from_manifest",
    has(checkCorpus({ manifest: missingM, navSlugs, pageTitles }), "missing_from_manifest"),
  );

  // 9) Manifest docs entry whose slug isn't navigable → not_navigable.
  const ghostM = cleanManifest();
  ghostM.sources.push(docsEntry("concepts/ghost", "Ghost"));
  assert("non-navigable docs entry → not_navigable", has(checkCorpus({ manifest: ghostM, navSlugs, pageTitles }), "not_navigable"));

  // 10) Docs title ≠ frontmatter title → title_mismatch.
  const titleM = cleanManifest();
  titleM.sources.find((e) => e.source_id === "docs:introduction").title = "Wrong Title";
  assert("docs title mismatch → title_mismatch", has(checkCorpus({ manifest: titleM, navSlugs, pageTitles }), "title_mismatch"));

  // 10b) Docs url ≠ canonical → docs_url_mismatch.
  const urlM = cleanManifest();
  urlM.sources.find((e) => e.source_id === "docs:introduction").url = "https://docs.mnemom.ai/intro";
  assert("docs url mismatch → docs_url_mismatch", has(checkCorpus({ manifest: urlM, navSlugs, pageTitles }), "docs_url_mismatch"));

  // 11) Empty/absent manifest → hard fail (fail-closed).
  assert("empty sources → hard fail", !checkCorpus({ manifest: { sources: [] }, navSlugs, pageTitles }).ok);
  assert("null manifest → hard fail", !checkCorpus({ manifest: null, navSlugs, pageTitles }).ok);
  assert("non-object manifest → hard fail", !checkCorpus({ manifest: [], navSlugs, pageTitles }).ok);

  // 12) index-form slug reconciles and normalizes its URL to /for-agents.
  const idxEntry = cleanManifest().sources.find((e) => e.source_id === "docs:for-agents/index");
  assert("index-form docs entry url normalizes to /for-agents", idxEntry.url === "https://docs.mnemom.ai/for-agents");

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(
    [
      "Usage: check-grounding-corpus.mjs [options]",
      "",
      "Validates the Aletheia Q&A grounding-corpus manifest",
      "(scripts/aletheia-corpus-manifest.json): unique source_ids, Mnemom-owned",
      "https URLs, non-empty titles, collection coverage, and docs↔nav parity.",
      "",
      "Options:",
      "  --root <dir>        Docs root (default: repo root, resolved from scripts/).",
      "  --manifest <path>   Manifest JSON (default: scripts/aletheia-corpus-manifest.json).",
      "  --self-test         Run built-in fixtures and exit.",
      "  --help, -h          Show this help.",
      "",
      "Exits 0 clean; 1 on any validation failure or self-test failure; 2 on bad CLI usage.",
    ].join("\n"),
  );
}

function main() {
  const args = argv.slice(2);
  const defaultRoot = resolve(scriptDir(), "..");
  let root = defaultRoot;
  let manifestPath = join(scriptDir(), "aletheia-corpus-manifest.json");

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const need = (flag) => {
      if (i + 1 >= args.length) {
        console.error(`${flag} requires a path argument`);
        exit(2);
      }
      return args[++i];
    };
    if (a === "--self-test") exit(selfTest() ? 0 : 1);
    else if (a === "--root" || a === "--docs") root = resolve(need(a));
    else if (a === "--manifest") manifestPath = resolve(need(a));
    else if (a === "--help" || a === "-h") {
      printHelp();
      exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      exit(2);
    }
  }

  const docsPath = join(root, "docs.json");

  // Parse the manifest (fail-closed: a missing/unparseable manifest is a hard
  // fail, handled uniformly by checkCorpus via a null manifest).
  let manifest = null;
  if (!existsSync(manifestPath)) {
    console.error(`✗ check-grounding-corpus: manifest not found at ${manifestPath}`);
    exit(1);
  }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    console.error(`✗ check-grounding-corpus: manifest is not valid JSON (${manifestPath}): ${err.message}`);
    exit(1);
  }

  let navSlugs;
  let pageTitles;
  try {
    ({ navSlugs, pageTitles } = buildNavContext(docsPath));
  } catch (err) {
    console.error(`✗ check-grounding-corpus: could not read/parse ${docsPath}: ${err.message}`);
    exit(1);
  }

  const result = checkCorpus({ manifest, navSlugs, pageTitles });

  if (!result.ok) {
    console.error(`\n✗ check-grounding-corpus: ${result.errors.length} problem(s) in the grounding-corpus manifest:`);
    for (const e of result.errors) console.error(`  - [${e.code}] ${e.detail}`);
    console.error(
      "\n  The manifest is human-curated and human-reviewed; fix the entries above " +
        "(add/remove docs pages to match docs.json navigation, correct titles/URLs, " +
        "or supply a Mnemom-owned canonical URL).",
    );
    exit(1);
  }

  const total = manifest.sources.length;
  console.log(
    `✓ check-grounding-corpus: ${total} trusted source(s) valid ` +
      `(${navSlugs.size} docs pages reconciled against docs.json navigation).`,
  );
  exit(0);
}

// Run the CLI only when executed directly, not when imported (keeps the exported
// core functions unit-exercisable — no exit/print on `import`).
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
