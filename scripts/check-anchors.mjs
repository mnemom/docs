#!/usr/bin/env node
/**
 * check-anchors.mjs — in-page #fragment (deep-link) anchor validator.
 *
 * `mint broken-links` and check-links-local.mjs validate that a linked PAGE
 * exists; neither validates the `#fragment` half of a deep link, and
 * check-redirects.mjs explicitly strips `#anchor` before resolving. So a
 * cross-page deep link like changelog.mdx's
 *   [Agent identity](/concepts/agent-identity#registration)
 * — or a same-page `[jump](#stability-guarantee)` — can point at a heading that
 * was renamed or removed and ship silently broken. This script closes that gap.
 *
 * It:
 *   1. Walks the docs tree for published .mdx pages (skipping dot-dirs +
 *      node_modules) and builds a page index mapping every internal route
 *      (`/concepts/agent-identity`, with `/index` folded) to its file. Only
 *      .mdx is scanned: those are the pages Mintlify renders (all of docs.json's
 *      nav is .mdx). Repo-internal .md artifacts (specs/, app_docs/, AGENTS.md)
 *      are working notes, not rendered pages, and quote example links in prose,
 *      so they are intentionally out of scope.
 *   2. For each page, extracts the set of heading anchors a Markdown renderer
 *      would emit — ATX headings only, OUTSIDE YAML frontmatter and fenced code
 *      blocks — slugified with a GitHub-slugger-compatible algorithm and the
 *      duplicate-suffix (`-1`, `-2`) disambiguation GitHub applies.
 *   3. Extracts internal links carrying a `#fragment` — both Markdown
 *      `[text](/path#frag)` / `[text](#frag)` and JSX `href="…#frag"` — and,
 *      when the destination resolves to a local page, asserts the fragment is
 *      one of that page's anchors. Same-page links (`#frag`) resolve against the
 *      current file. Links whose page does NOT resolve are left to
 *      check-links-local.mjs (page existence is that gate's job, not ours).
 *
 * Reports file / link / missing-anchor for every unresolved fragment.
 *
 * Sibling to check-path-references.mjs / check-links-local.mjs; same contract:
 *   Exits 0 when every fragment resolves, 1 on any unresolved anchor (or a
 *   failed self-test / read error), 2 on bad CLI usage. No new dependencies —
 *   the slugifier is inlined.
 *
 * Known limitation: the inlined slugifier targets GitHub-slugger semantics.
 * Mintlify's renderer (@sindresorhus/slugify under the hood) agrees for the
 * ASCII headings in this tree, but the two diverge on non-ASCII characters
 * (e.g. a `§`-prefixed heading yields no clean anchor under EITHER, so such a
 * deep link is correctly flagged), on separator collapsing, and on the
 * duplicate-heading counter (GitHub `-1`, Mintlify `-2`). No current link hits
 * those cases; revisit the slugifier if non-ASCII or duplicate-target headings
 * are linked.
 */

import {
  readFileSync,
  readdirSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import { stripHtmlTags } from "./lib/strip-html-tags.mjs";

// ── Slugifier ──────────────────────────────────────────────────────────────
// GitHub-slugger-compatible: lowercase, strip a fixed punctuation set, spaces
// → hyphens. Underscores and existing hyphens are preserved (so `agent_hash`
// stays intact). Kept in sync with github-slugger's regex so the anchors we
// compute match what Mintlify renders for this tree's ASCII headings.
const SLUG_STRIP =
  /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~\u2019]/g;

export function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(SLUG_STRIP, "")
    .replace(/ /g, "-");
}

// Reduce a raw heading line to its rendered text before slugifying: drop the
// leading `#`s and any ATX closing `#`s, unwrap images/links to their text,
// and strip inline HTML tags. Formatting markers (`*`, backticks, …) are left
// for SLUG_STRIP to remove.
function headingText(rawLine) {
  let t = rawLine.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "");
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // images → alt text
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // links → link text
  t = stripHtmlTags(t); // inline HTML tags (loop-until-stable; MNE-3528)
  return t.trim();
}

// ── Heading / anchor extraction ──────────────────────────────────────────────
// Returns the Set of anchors a renderer would emit for a page: ATX headings
// outside YAML frontmatter and fenced code blocks, slugified, with GitHub's
// duplicate-suffix disambiguation.
export function extractAnchors(content) {
  const anchors = new Set();
  const seen = new Map(); // base slug → times used (for -1/-2 suffixing)
  const lines = content.split(/\r?\n/);

  let i = 0;
  // Skip a leading YAML frontmatter block (`---` … `---`).
  if (lines[0] !== undefined && lines[0].trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    if (i < lines.length) i++; // consume the closing fence
  }

  let fence = null; // active code-fence marker (``` or ~~~) or null
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue; // inside a code block — never a heading

    const h = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (!h) continue;

    const anchor = slugify(headingText(line));
    if (!anchor) continue;

    const n = seen.get(anchor) ?? 0;
    seen.set(anchor, n + 1);
    anchors.add(n === 0 ? anchor : `${anchor}-${n}`);
  }
  return anchors;
}

// ── Link extraction ──────────────────────────────────────────────────────────
// Pulls internal links that carry a `#fragment` out of one document.
// Returns [{ page, fragment, raw }] where `page` is the internal route (no
// fragment) or null for a same-page link. External/mailto/relative-file links
// and fragment-less links are skipped.
export function extractFragmentLinks(content) {
  const out = [];
  const push = (href) => {
    const hashIdx = href.indexOf("#");
    if (hashIdx < 0) return; // no fragment — not our concern
    const pageRaw = href.slice(0, hashIdx);
    const fragment = href.slice(hashIdx + 1);
    if (!fragment) return; // bare "#" / empty fragment
    if (pageRaw === "") {
      out.push({ page: null, fragment, raw: href }); // same-page link
      return;
    }
    // Only absolute internal routes ("/…") are resolvable here; external URLs,
    // protocol-relative "//", and relative file links are out of scope.
    if (!pageRaw.startsWith("/") || pageRaw.startsWith("//")) return;
    out.push({ page: pageRaw, fragment, raw: href });
  };

  let m;
  // Markdown: [text](target) — target up to whitespace or ")". A link title
  // ([t](/p "title")) ends the URL at the space, which is what we want.
  const mdRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = mdRe.exec(content)) !== null) push(m[1]);
  // JSX/MDX: href="target" or href='target'.
  const jsxRe = /href=["']([^"']+)["']/g;
  while ((m = jsxRe.exec(content)) !== null) push(m[1]);

  return out;
}

// ── Page index ────────────────────────────────────────────────────────────────
function collectDocs(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && entry.endsWith(".mdx")) files.push(full);
    }
  };
  walk(root);
  return files;
}

// route ("/concepts/agent-identity") → absolute file path. `/index` pages are
// registered under both their explicit path and their directory route.
function buildPageIndex(files, root) {
  const index = new Map();
  for (const f of files) {
    const rel = relative(root, f).replace(/\.mdx$/, "");
    const route = "/" + rel.split(/[/\\]/).join("/");
    index.set(route, f);
    if (route.endsWith("/index")) index.set(route.slice(0, -"/index".length), f);
  }
  return index;
}

// ── Core check (exported for --self-test) ─────────────────────────────────────
// Pure of process.exit / console so it can be exercised against fixtures.
export function checkAnchors({ root }) {
  const files = collectDocs(root);
  const pageIndex = buildPageIndex(files, root);
  const anchorCache = new Map(); // file → Set<anchor>

  const anchorsFor = (file) => {
    let set = anchorCache.get(file);
    if (!set) {
      set = extractAnchors(readFileSync(file, "utf8"));
      anchorCache.set(file, set);
    }
    return set;
  };

  const broken = [];
  let checked = 0;

  for (const file of files) {
    const rel = relative(root, file);
    const content = readFileSync(file, "utf8");
    for (const link of extractFragmentLinks(content)) {
      let targetFile;
      if (link.page === null) {
        targetFile = file; // same-page fragment
      } else {
        const route = link.page.replace(/\/$/, "");
        targetFile = pageIndex.get(route) ?? pageIndex.get(route + "/index");
        if (!targetFile) continue; // page existence is check-links-local's job
      }
      checked++;
      // Normalize percent-encoding; a malformed `%` sequence is left as-is.
      let anchor;
      try {
        anchor = decodeURIComponent(link.fragment);
      } catch {
        anchor = link.fragment;
      }
      if (!anchorsFor(targetFile).has(anchor)) {
        broken.push({
          file: rel,
          link: link.raw,
          page: link.page ?? "(same page)",
          fragment: anchor,
        });
      }
    }
  }

  return { scanned: files.length, checked, broken };
}

// ── Self-test ──────────────────────────────────────────────────────────────
// Builds a throwaway doc tree in a temp dir and asserts each anchor class is
// classified correctly, then confirms the slugifier matches a real production
// heading (the /concepts/agent-identity#registration link cited in the issue).
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

  // Fixture tree: a target page with real headings + a page whose links point
  // at both real and non-existent anchors, cross-page and same-page.
  const root = mkdtempSync(join(tmpdir(), "check-anchors-selftest-"));
  const mkdoc = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };

  mkdoc(
    "concepts/target.mdx",
    [
      "---",
      "title: Target",
      "# a hash inside frontmatter must not become an anchor",
      "---",
      "",
      "# Target page",
      "",
      "## Stability guarantee",
      "",
      "```bash",
      "# New ID format — a heading-shaped line inside a code fence",
      "echo hi",
      "```",
      "",
      "## Registration",
      "",
      "## Registration", // duplicate → second slug is `registration-1`
      "",
      "## Nested <<b>b>tag section", // nested inline HTML → rendered text "Nested tag section" (MNE-3528)
    ].join("\n"),
  );

  mkdoc(
    "changelog.mdx",
    [
      "# Changelog",
      "",
      "See [Target](/concepts/target#registration) for details.", // valid cross-page
      "See [Dupe](/concepts/target#registration-1) too.", // valid duplicate anchor
      "See [Nested](/concepts/target#nested-tag-section) too.", // valid — nested-tag heading strips cleanly
      "Jump to [Changelog](#changelog).", // valid same-page
      "Broken [ref](/concepts/target#does-not-exist).", // BROKEN cross-page
      "Broken [self](#no-such-section).", // BROKEN same-page
      "In a fence the anchor must be absent:",
      "[fenced](/concepts/target#new-id-format).", // BROKEN — heading was inside a code fence
      "External [x](https://example.com/page#frag) is ignored.", // ignored (external)
      "Page-only [y](/concepts/target) is ignored.", // ignored (no fragment)
    ].join("\n"),
  );

  const r = checkAnchors({ root });
  const isBroken = (frag) => r.broken.some((b) => b.fragment === frag);

  assert("scanned both fixture pages", r.scanned === 2);
  assert("valid cross-page anchor #registration resolves", !isBroken("registration"));
  assert(
    "duplicate heading disambiguates to #registration-1",
    !isBroken("registration-1"),
  );
  assert(
    "nested-tag heading strips to #nested-tag-section and resolves",
    !isBroken("nested-tag-section"),
  );
  assert("valid same-page anchor #changelog resolves", !isBroken("changelog"));
  assert("non-existent cross-page anchor is reported", isBroken("does-not-exist"));
  assert("non-existent same-page anchor is reported", isBroken("no-such-section"));
  assert(
    "heading-shaped line inside a code fence is NOT an anchor",
    isBroken("new-id-format"),
  );
  assert(
    "frontmatter '#'-comment does not become an anchor",
    !extractAnchors(readFileSync(join(root, "concepts/target.mdx"), "utf8")).has(
      "a-hash-inside-frontmatter-must-not-become-an-anchor",
    ),
  );
  assert("external and fragment-less links are ignored", r.broken.length === 3);

  // Real-file assertion (CWD-independent via import.meta.url): the production
  // heading `## Registration` in concepts/agent-identity.mdx must slugify to the
  // `registration` anchor that changelog.mdx's deep link targets.
  const realPath = new URL("../concepts/agent-identity.mdx", import.meta.url);
  const realAnchors = extractAnchors(readFileSync(realPath, "utf8"));
  assert(
    "real concepts/agent-identity.mdx exposes #registration",
    realAnchors.has("registration"),
  );

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(
    [
      "Usage: check-anchors.mjs [options]",
      "",
      "Validates that every internal deep link's `#fragment` resolves to a real",
      "heading anchor on its destination page (same-page and cross-page).",
      "",
      "Options:",
      "  --root <dir>    Docs root (default: repo root, resolved from scripts/).",
      "  --self-test     Run built-in fixtures and exit.",
      "  --help, -h      Show this help.",
      "",
      "Exits 0 when every fragment resolves, 1 on any unresolved anchor.",
    ].join("\n"),
  );
}

function main() {
  const args = argv.slice(2);
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  let root = resolve(scriptDir, "..");

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--self-test") exit(selfTest() ? 0 : 1);
    else if (a === "--root") {
      if (i + 1 >= args.length) {
        console.error("--root requires a path argument");
        exit(2);
      }
      root = resolve(args[++i]);
    } else if (a === "--help" || a === "-h") {
      printHelp();
      exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      exit(2);
    }
  }

  let result;
  try {
    result = checkAnchors({ root });
  } catch (err) {
    console.error(`✗ check-anchors failed: ${err.message}`);
    exit(1);
  }

  const { scanned, checked, broken } = result;

  if (broken.length > 0) {
    console.log(`\n✗ ${broken.length} unresolved anchor fragment(s):`);
    for (const b of broken) {
      console.log(`  ${b.file}: ${b.link}`);
      console.log(`      → no anchor "#${b.fragment}" on ${b.page}`);
    }
  }

  console.log(
    `\nscanned ${scanned} page(s); checked ${checked} fragment link(s), ${broken.length} unresolved.`,
  );

  if (broken.length > 0) {
    console.error(
      `\n✗ check-anchors: ${broken.length} deep link(s) point at a missing heading anchor.`,
    );
    exit(1);
  }
  console.log("✓ check-anchors: every deep-link fragment resolves.");
  exit(0);
}

// Run the CLI only when executed directly, not when imported — so the exported
// core functions can be unit-exercised.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
