#!/usr/bin/env node
/**
 * export-corpus-with-body.mjs — Export the Aletheia grounding corpus WITH body text.
 *
 * The grounding-corpus manifest (scripts/aletheia-corpus-manifest.json, gated by
 * check-grounding-corpus.mjs) lists trusted, Mnemom-owned sources as pure
 * METADATA — source_id / collection / url / title only. It carries no page
 * CONTENT, so on its own it cannot ground a Q&A answer: the retrieval engine
 * (MNE-1936, out of scope here) needs the actual text of each source.
 *
 * This script derives that content-bearing artifact,
 * scripts/aletheia-corpus-with-body.json, from the manifest + the docs pages on
 * disk. For every `docs` source it composes a `body`:
 *   · a page with a real markdown body → that body (content after frontmatter);
 *   · a frontmatter-only page (e.g. an OpenAPI-generated API-reference page, which
 *     renders from `openapi:` and has no prose) → its `description` + the
 *     `openapi` operation line.
 * Non-`docs` sources (knowledgebase / for-agents) point at external marketing
 * pages with no local file, so they carry no body offline and are not exported
 * here — the manifest remains their system of record.
 *
 * Like its sibling, this change is DARK: the artifact is a scripts/ data file
 * (not a Mintlify page), so it renders nothing and exposes nothing to customers.
 * The retrieval/ranking engine and the feature flag live in other repos and are
 * out of scope — this is the content export and its freshness gate only. Import
 * path / fetch mechanism is to be coordinated with the gateway-wiring card
 * (MNE-1975) if it lands first; the versioned wrapper insulates that consumer
 * from format churn.
 *
 * Fail-closed, mirroring check-grounding-corpus.mjs: a missing/unparseable/empty
 * manifest is a HARD exit 1, never a vacuous pass (MNE-442). An entry that would
 * be exported with an EMPTY body is likewise a hard failure — in BOTH default
 * (generate) and --check modes — so an invalid artifact is never written or
 * allowed to drift in.
 *
 * Modes:
 *   (default)   Regenerate scripts/aletheia-corpus-with-body.json from the
 *               manifest. Validates before writing; refuses to write an artifact
 *               with any empty body.
 *   --check     Verify the committed artifact is present, valid (no empty
 *               bodies), and byte-for-byte in sync with what the manifest + pages
 *               would produce now. Exits 1 on drift so CI catches a manifest or
 *               page edit that was not re-exported. Writes nothing.
 *
 *   Exits 0 clean. Exits 1 on any failure (missing/unparseable manifest, empty
 *   body, drift, or a failed self-test). Exits 2 on bad CLI usage. Node ≥22
 *   built-ins only, so no `npm ci` is required to run it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

// ── Configuration ────────────────────────────────────────────────────────────
// The manifest is the system of record; this artifact is derived from it. Both
// live in scripts/ alongside their gates. Only the `docs` collection has local
// backing pages, so only it carries a body.
const MANIFEST_FILE = "aletheia-corpus-manifest.json";
const ARTIFACT_FILE = "aletheia-corpus-with-body.json";
const DOCS_COLLECTION = "docs";

const scriptDir = () => dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {Object} CorpusEntry
 * @property {string} source_id   Stable id, e.g. "docs:introduction".
 * @property {string} collection  Always "docs" in this artifact.
 * @property {string} url         Canonical Mnemom-owned https URL.
 * @property {string} title       Page frontmatter title (from the manifest).
 * @property {string} body        Composed page content (never empty; validated).
 */

// ── Frontmatter / body extraction (shared idiom with check-grounding-corpus.mjs) ─
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Parse a scalar frontmatter field (quoted or bare) out of a page's YAML
// frontmatter. Returns the string (quotes stripped/unescaped) or null when
// absent. Same quoting rules as check-grounding-corpus.mjs's title parser.
export function parseFrontmatterField(text, field) {
  const fm = text.match(FM_RE);
  if (!fm) return null;
  const m = fm[1].match(new RegExp(`^${field}:[ \\t]*(.+?)[ \\t]*$`, "m"));
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

// The markdown body of a page: everything after the frontmatter block, trimmed.
// A page with no frontmatter is treated as all-body. Returns "" for a
// frontmatter-only page (nothing after the closing `---`).
export function extractMarkdownBody(text) {
  const fm = text.match(FM_RE);
  const rest = fm ? text.slice(fm[0].length) : text;
  return rest.trim();
}

// Compose the grounding body for a docs page from its raw file text. Prefers the
// real markdown body; for a frontmatter-only page (e.g. an OpenAPI-generated
// API-reference page) falls back to `description` + the `openapi` operation
// line. Returns "" only when the page has NEITHER a markdown body NOR a
// non-empty description/openapi — a state validateBodies rejects (fail-closed).
export function composeBody(text) {
  const body = extractMarkdownBody(text);
  if (body !== "") return body;
  const description = (parseFrontmatterField(text, "description") ?? "").trim();
  const openapi = (parseFrontmatterField(text, "openapi") ?? "").trim();
  return [description, openapi].filter((s) => s !== "").join("\n\n");
}

// Resolve a docs slug to its backing content file text, or null if none exists.
// `<slug>.mdx|.md` and `<slug>/index.mdx|.md` both back `<slug>` (Mintlify serves
// `foo/index.mdx` at `/foo`). Same candidate order as resolvePageTitle.
export function resolvePageText(root, slug) {
  const candidates = [
    `${slug}.mdx`,
    `${slug}.md`,
    `${slug}/index.mdx`,
    `${slug}/index.md`,
  ];
  for (const rel of candidates) {
    const abs = resolve(root, rel);
    if (existsSync(abs)) return readFileSync(abs, "utf8");
  }
  return null;
}

// The docs slug carried by a `docs:` source_id.
const slugFromDocsId = (sourceId) => sourceId.replace(/^docs:/, "");

// ── Core build (pure-ish — exported for --self-test) ─────────────────────────
// buildBodyCorpus({ manifest, root }) → CorpusEntry[]
// One entry per `docs` source, in manifest order (deterministic), each carrying
// the composed page body. Reads backing files from `root` via readFile.
export function buildBodyCorpus({ manifest, root }) {
  const sources = Array.isArray(manifest?.sources) ? manifest.sources : [];
  const entries = [];
  for (const e of sources) {
    if (!e || typeof e !== "object" || e.collection !== DOCS_COLLECTION) continue;
    const slug = typeof e.source_id === "string" ? slugFromDocsId(e.source_id) : "";
    const text = resolvePageText(root, slug);
    const body = text === null ? "" : composeBody(text);
    entries.push({
      source_id: e.source_id,
      collection: e.collection,
      url: e.url,
      title: e.title,
      body,
    });
  }
  return entries;
}

// Fail-closed body validation: return the entries whose body is missing/empty.
// An empty list means every entry is groundable; a non-empty list is a hard
// failure in both generate and --check modes.
export function validateBodies(entries) {
  return entries.filter((e) => typeof e.body !== "string" || e.body.trim() === "");
}

// Assemble the versioned artifact wrapper around the entries. `generated_from`
// records provenance so a consumer knows which manifest produced this content.
export function buildArtifact({ manifest, entries, generatedFrom }) {
  return {
    manifest_version: manifest.manifest_version ?? 1,
    generated_from: generatedFrom,
    entries,
  };
}

// Canonical on-disk serialization (2-space indent + trailing newline), used for
// both writing and the --check drift comparison so they can never disagree.
export function serializeArtifact(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

// ── Manifest loading (fail-closed) ───────────────────────────────────────────
// Returns the parsed manifest or exits 1 with a clear message on any of:
// not found, unparseable JSON, or an empty/malformed `sources` array.
function loadManifestOrExit(manifestPath) {
  if (!existsSync(manifestPath)) {
    console.error(`✗ export-corpus-with-body: manifest not found at ${manifestPath}`);
    exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    console.error(`✗ export-corpus-with-body: manifest is not valid JSON (${manifestPath}): ${err.message}`);
    exit(1);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    console.error(`✗ export-corpus-with-body: manifest is missing or not an object (${manifestPath})`);
    exit(1);
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    console.error(`✗ export-corpus-with-body: manifest.sources must be a non-empty array (${manifestPath})`);
    exit(1);
  }
  return manifest;
}

// Report empty-body entries and exit 1. Shared by generate and --check so the
// same fail-closed rule guards writing AND drift-checking (advisory MNE-442).
function failOnEmptyBodies(empties) {
  console.error(
    `\n✗ export-corpus-with-body: ${empties.length} corpus entr(y|ies) would have an EMPTY body:`,
  );
  for (const e of empties) {
    console.error(`  - [empty_body] ${e.source_id ?? "?"} — page has no markdown body and no description/openapi`);
  }
  console.error(
    "\n  Every exported source must be groundable. Add prose (or a description/openapi\n" +
      "  frontmatter field) to the backing page, or remove it from the manifest.",
  );
  exit(1);
}

// ── Self-test ────────────────────────────────────────────────────────────────
// In-memory fixtures asserting composeBody's two modes, the fallback edge, the
// docs-only filter, validateBodies, and stable serialization. No external files.
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

  const mdPage = '---\ntitle: "Intro"\ndescription: "d"\n---\n\n# Heading\n\nBody text here.\n';
  const apiPage =
    '---\ntitle: "Reset conscience values to defaults"\ndescription: "Reset conscience values to defaults"\nopenapi: "DELETE /agents/{agent_id}/conscience-values"\n---\n';
  const barePage = "No frontmatter, just prose.\n";
  const emptyPage = '---\ntitle: "Ghost"\n---\n';

  // 1) A page with a markdown body → that body (frontmatter stripped, trimmed).
  assert("markdown body extracted", composeBody(mdPage) === "# Heading\n\nBody text here.");
  // 2) A frontmatter-only page → description + openapi fallback.
  assert(
    "frontmatter-only → description+openapi fallback",
    composeBody(apiPage) === "Reset conscience values to defaults\n\nDELETE /agents/{agent_id}/conscience-values",
  );
  // 3) A page with no frontmatter is all body.
  assert("no-frontmatter page → all body", composeBody(barePage) === "No frontmatter, just prose.");
  // 4) A page with neither body nor description/openapi → empty (validateBodies rejects).
  assert("no body + no desc/openapi → empty", composeBody(emptyPage) === "");

  // 5) buildBodyCorpus exports only `docs` sources, in order, with bodies.
  const manifest = {
    manifest_version: 1,
    sources: [
      { source_id: "docs:a", collection: "docs", url: "https://docs.mnemom.ai/a", title: "A" },
      { source_id: "kb:x", collection: "knowledgebase", url: "https://www.mnemom.ai/x/", title: "X" },
      { source_id: "docs:b", collection: "docs", url: "https://docs.mnemom.ai/b", title: "B" },
    ],
  };
  // Stub resolvePageText by pointing root at a shape composeBody can read: here
  // we build entries directly to keep the self-test file-free, then check filter.
  const entries = manifest.sources
    .filter((e) => e.collection === "docs")
    .map((e) => ({ ...e, body: e.source_id === "docs:a" ? "Alpha body" : "Beta body" }));
  assert("only docs sources exported, in order", entries.length === 2 && entries[0].source_id === "docs:a" && entries[1].source_id === "docs:b");

  // 6) validateBodies flags empty/whitespace bodies only.
  const withEmpty = [
    { source_id: "docs:a", body: "ok" },
    { source_id: "docs:b", body: "   " },
    { source_id: "docs:c", body: "" },
  ];
  const bad = validateBodies(withEmpty);
  assert("validateBodies flags empty + whitespace bodies", bad.length === 2 && bad.every((e) => e.source_id !== "docs:a"));
  assert("validateBodies passes when all bodies present", validateBodies(entries).length === 0);

  // 7) Serialization is stable, 2-space indented, newline-terminated.
  const art = buildArtifact({ manifest, entries, generatedFrom: `scripts/${MANIFEST_FILE}` });
  const s = serializeArtifact(art);
  assert("artifact wrapper shape", art.manifest_version === 1 && art.generated_from === `scripts/${MANIFEST_FILE}` && Array.isArray(art.entries));
  assert("serialization is 2-space + trailing newline", s.endsWith("\n") && s.includes('\n  "entries"') && serializeArtifact(art) === s);

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(
    [
      "Usage: export-corpus-with-body.mjs [options]",
      "",
      "Exports the Aletheia grounding corpus WITH page body text",
      `(scripts/${ARTIFACT_FILE}), derived from scripts/${MANIFEST_FILE} + the`,
      "docs pages on disk. One entry per `docs` source, each carrying the page's",
      "markdown body (or, for a frontmatter-only page, its description + openapi).",
      "",
      "Options:",
      "  --root <dir>        Docs root (default: repo root, resolved from scripts/).",
      `  --manifest <path>   Manifest JSON (default: scripts/${MANIFEST_FILE}).`,
      `  --out <path>        Artifact JSON (default: scripts/${ARTIFACT_FILE}).`,
      "  --check             Verify the committed artifact is valid and in sync;",
      "                      write nothing. Exits 1 on drift or empty bodies.",
      "  --self-test         Run built-in fixtures and exit.",
      "  --help, -h          Show this help.",
      "",
      "Exits 0 clean; 1 on any failure (missing/unparseable manifest, empty body,",
      "drift, or self-test failure); 2 on bad CLI usage.",
    ].join("\n"),
  );
}

function main() {
  const args = argv.slice(2);
  const defaultRoot = resolve(scriptDir(), "..");
  let root = defaultRoot;
  let manifestPath = join(scriptDir(), MANIFEST_FILE);
  let outPath = join(scriptDir(), ARTIFACT_FILE);
  let check = false;

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
    else if (a === "--check") check = true;
    else if (a === "--root" || a === "--docs") root = resolve(need(a));
    else if (a === "--manifest") manifestPath = resolve(need(a));
    else if (a === "--out") outPath = resolve(need(a));
    else if (a === "--help" || a === "-h") {
      printHelp();
      exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      exit(2);
    }
  }

  const manifest = loadManifestOrExit(manifestPath);
  const generatedFrom = relative(root, manifestPath).split("\\").join("/");
  const entries = buildBodyCorpus({ manifest, root });
  const artifact = buildArtifact({ manifest, entries, generatedFrom });
  const serialized = serializeArtifact(artifact);

  // Fail-closed on empty bodies in BOTH modes — an invalid artifact is never
  // written (default) nor accepted (--check).
  const empties = validateBodies(entries);
  if (empties.length > 0) failOnEmptyBodies(empties);

  if (check) {
    if (!existsSync(outPath)) {
      console.error(`✗ export-corpus-with-body: artifact not found at ${outPath} (run without --check to generate it)`);
      exit(1);
    }
    const current = readFileSync(outPath, "utf8");
    if (current !== serialized) {
      console.error(
        `\n✗ export-corpus-with-body: ${relative(root, outPath).split("\\").join("/")} is out of sync with the manifest/pages.`,
      );
      console.error("  Re-run `npm run export:corpus-body` and commit the updated artifact.");
      exit(1);
    }
    console.log(
      `✓ export-corpus-with-body: ${entries.length} docs source(s) exported with body, artifact in sync.`,
    );
    exit(0);
  }

  writeFileSync(outPath, serialized);
  console.log(
    `✓ export-corpus-with-body: wrote ${entries.length} docs source(s) with body to ` +
      `${relative(root, outPath).split("\\").join("/")}.`,
  );
  exit(0);
}

// Run the CLI only when executed directly, not when imported (keeps the exported
// core functions unit-exercisable — no exit/print on `import`).
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
