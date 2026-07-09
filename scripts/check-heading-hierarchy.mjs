#!/usr/bin/env node
// scripts/check-heading-hierarchy.mjs — single-<h1>-per-page guard (issue #281).
//
// Mintlify renders each page's frontmatter `title:` as its `<h1>`. A page that
// ALSO opens with a markdown `# Heading` therefore emits TWO `<h1>` elements —
// which breaks the document outline and fails heading-hierarchy accessibility
// checks (WCAG 1.3.1). Screen-reader users and any consumer of the outline
// expect exactly one `<h1>` per page. Nothing in the existing toolchain catches
// this, so once fixed it can silently regress; this gate keeps it fixed.
//
// It walks the five scoped customer-facing content directories, strips YAML
// frontmatter and fenced code blocks exactly as scripts/check-anchors.mjs does,
// and fails if any page contains a fence-stripped, single-`#` ATX heading.
//
// Sibling to check-anchors.mjs / check-img-alt.mjs / check-frontmatter-
// description.mjs and follows the same contract: exits 0 on clean, 1 on any
// violation, 2 on bad CLI usage. `--verbose` lists every checked page and every
// flagged line; `--self-test` runs inline assertions without touching the
// filesystem; `--help` prints usage.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Scoped dirs ─────────────────────────────────────────────────────────────
// Exactly the five issue-declared customer-facing content directories. NOT
// api-reference/ (generated — do not hand-edit), es//fr/ (locale mirrors),
// app_docs//gateway/ (internal). Those double-<h1> pages are a tracked
// follow-up, intentionally out of this issue's declared file scope.
const SCOPED = [
  join(ROOT, "concepts"),
  join(ROOT, "guides"),
  join(ROOT, "protocols"),
  join(ROOT, "specifications"),
  join(ROOT, "quickstart"),
];

// ── Collect *.mdx / *.md pages ──────────────────────────────────────────────
function walkMdx(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkMdx(p, out);
    else if (e.endsWith(".mdx") || e.endsWith(".md")) out.push(p);
  }
  return out;
}

// ── Core: find top-level `#` headings (exported for --self-test) ─────────────
// Ported from check-anchors.mjs `extractAnchors`: skip a leading `---…---` YAML
// frontmatter block, track an active code-fence marker (``` / ~~~), and never
// treat a line inside a fence as a heading. Returns [{ line, text }] for every
// fence-stripped, single-`#` ATX heading found.
//
// A single-`#` heading matches /^#\s+\S/ — one `#` followed immediately by
// whitespace then non-whitespace. `##`/`###`/etc. cannot match because their
// SECOND character is `#`, not whitespace; `#NoSpace` cannot match because no
// whitespace follows the `#`.
//
// Known limitation (matches check-anchors.mjs): only fenced (``` / ~~~) code
// blocks are recognized, not 4-space-indented code. Docs here use fenced blocks
// throughout, so a `#`-prefixed line in an indented block is not a concern.
export function findTopLevelHeadings(content) {
  const hits = [];
  const lines = content.split(/\r?\n/);

  let i = 0;
  // Skip a leading YAML frontmatter block (`---` … `---`).
  if (lines[0] !== undefined && lines[0].trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    if (i < lines.length) i++; // consume the closing fence
  }

  let fence = null; // active code-fence marker (` or ~) or null
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

    if (/^#\s+\S/.test(line)) {
      hits.push({ line: i + 1, text: line.replace(/^#\s+/, "").trim() });
    }
  }
  return hits;
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Fixture strings only — no filesystem access.
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
  const count = (body) => findTopLevelHeadings(body).length;

  assert(
    "leading '# Heading' outside frontmatter is flagged",
    count("---\ntitle: Foo\n---\n\n# Heading\n\nBody.") === 1,
  );
  assert(
    "'## Heading' (H2) is not flagged",
    count("---\ntitle: Foo\n---\n\n## Heading\n") === 0,
  );
  assert(
    "'### Heading' (H3) is not flagged",
    count("---\ntitle: Foo\n---\n\n### Heading\n") === 0,
  );
  assert(
    "'# comment' inside a ```bash fence is not flagged",
    count("---\ntitle: Foo\n---\n\n```bash\n# a comment\necho hi\n```\n") === 0,
  );
  assert(
    "'#' line inside the YAML frontmatter block is not flagged",
    count("---\ntitle: Foo\n# not a heading — inside frontmatter\n---\n\nBody.") === 0,
  );
  assert(
    "'#NoSpace' (no space after #) is not flagged",
    count("---\ntitle: Foo\n---\n\n#NoSpace\n") === 0,
  );
  assert(
    "page with only H2+ and a frontmatter title is not flagged",
    count("---\ntitle: Foo\n---\n\n## One\n\n### Two\n\nBody.") === 0,
  );
  assert(
    "top-level '#' appearing after body text (not line 1) is flagged",
    count("---\ntitle: Foo\n---\n\nSome intro prose.\n\n# Late heading\n") === 1,
  );
  assert(
    "'# heading' inside an indented/nested ``` fence is not flagged",
    count("---\ntitle: Foo\n---\n\n<Steps>\n  ```\n  # inside a nested fence\n  ```\n</Steps>\n") === 0,
  );
  assert(
    "'# heading' inside a ~~~-delimited fence is not flagged",
    count("---\ntitle: Foo\n---\n\n~~~\n# inside a tilde fence\n~~~\n") === 0,
  );
  assert(
    "reported line number and text are correct",
    (() => {
      const hits = findTopLevelHeadings("---\ntitle: Foo\n---\n\n# Trust Recovery\n");
      return hits.length === 1 && hits[0].line === 5 && hits[0].text === "Trust Recovery";
    })(),
  );

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(
    [
      "Usage: check-heading-hierarchy.mjs [options]",
      "",
      "Fails if any scoped content page opens with a fence-stripped, single-'#'",
      "ATX heading — a duplicate <h1> alongside the frontmatter title.",
      "",
      "Options:",
      "  --verbose     List every checked page and every flagged line.",
      "  --self-test   Run built-in fixtures and exit.",
      "  --help, -h    Show this help.",
      "",
      "Exits 0 when every scoped page has a single <h1>, 1 on any violation.",
    ].join("\n"),
  );
}

function main() {
  const args = argv.slice(2);
  let verbose = false;
  let selftest = false;
  for (const arg of args) {
    if (arg === "--verbose") verbose = true;
    else if (arg === "--self-test") selftest = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      exit(0);
    } else {
      console.error(`Unknown flag: ${arg}`);
      exit(2);
    }
  }

  if (selftest) exit(selfTest() ? 0 : 1);

  // ── Scan ────────────────────────────────────────────────────────────────────
  const violations = [];
  let scanned = 0;

  for (const dir of SCOPED) {
    if (!existsSync(dir)) continue;
    for (const file of walkMdx(dir)) {
      scanned++;
      const rel = relative(ROOT, file);
      const hits = findTopLevelHeadings(readFileSync(file, "utf8"));
      if (verbose && hits.length === 0) console.log(`✓ ${rel}`);
      for (const h of hits) {
        const msg = `${rel}:${h.line} — top-level '#' heading (duplicates the frontmatter <h1>): ${h.text}`;
        violations.push(msg);
        if (verbose) console.log(`✗ ${msg}`);
      }
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  if (violations.length > 0) {
    console.error(
      `\n✗ check-heading-hierarchy: ${violations.length} page(s) open with a duplicate top-level '#' heading:`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "\nThe frontmatter title: already renders the <h1>; drop the markdown '#' (or demote it to '##').",
    );
    exit(1);
  }

  console.log(
    `✓ check-heading-hierarchy: ${scanned} page(s) checked; every scoped page has a single <h1>.`,
  );
  exit(0);
}

// Run the CLI only when executed directly, not when imported — so the exported
// core function can be unit-exercised without triggering a full scan.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
