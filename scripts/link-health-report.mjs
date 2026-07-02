#!/usr/bin/env node
/**
 * link-health-report.mjs — advisory internal-link health report, grouped by
 * top-level docs area.
 *
 * `mint broken-links` (and `check-links-local.mjs`) validate internal page
 * links as a flat pass/fail: either every link resolves or the build fails.
 * Neither tells you WHERE the rot concentrates — "3% of the links in
 * `guides/` are broken" is a far more actionable signal than "the build is
 * red." This report closes that gap.
 *
 * It reuses `check-links-local.mjs`' internal-link discovery and resolution
 * verbatim (walk `.mdx`/`.md`, build the navigable page set, extract
 * markdown + JSX `href` links, resolve `<slug>` and `<slug>/index`), then
 * aggregates the results by each file's TOP-LEVEL directory (guides/,
 * concepts/, specifications/, quickstart/, gateway/, protocols/,
 * api-reference/, … — data-driven, so a new area needs no edit here; files at
 * the repo root are bucketed under `(root)`). It emits a Markdown table
 *
 *     | Group | Total links | Broken | % broken |
 *
 * ("Total links" = internal PAGE links, the ones brokenness is defined over)
 * to `$GITHUB_STEP_SUMMARY` when running in CI, or to stdout locally.
 *
 * This report is ADVISORY: it ALWAYS exits 0 (it never blocks a build) so it
 * can render the table on every run regardless of link health. The blocking
 * gate remains `mint broken-links`. Exits 2 only on bad CLI usage.
 *
 * Node built-ins only, so no `npm ci` is required — sibling to
 * `check-links-local.mjs` / `check-nav-pages.mjs`.
 */

import {
  readFileSync,
  readdirSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { argv, env, exit } from "node:process";

// ── Link discovery / resolution (modeled on check-links-local.mjs) ───────────

function walkDir(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkDir(full, out);
    else if (stat.isFile() && (entry.endsWith(".mdx") || entry.endsWith(".md")))
      out.push(full);
  }
  return out;
}

// Extract internal link targets from both markdown and JSX/MDX syntax.
// (Verbatim behavior from check-links-local.mjs so results stay consistent.)
function extractInternalLinks(content) {
  const links = [];
  let m;
  // Markdown-style: [text](/path) — path before optional fragment
  const mdRe = /\[.*?\]\((\/?[a-z][^)#\s]*)(#[^)]+)?\)/gi;
  while ((m = mdRe.exec(content)) !== null) {
    links.push(m[1]);
  }
  // JSX/MDX href attribute: href="/path" or href='/path' — strip fragment
  const jsxRe = /href=["'](\/[^"']+)/gi;
  while ((m = jsxRe.exec(content)) !== null) {
    const raw = m[1];
    const hashIdx = raw.indexOf("#");
    links.push(hashIdx >= 0 ? raw.slice(0, hashIdx) : raw);
  }
  return links;
}

function isInternalPath(href) {
  return href.startsWith("/") && !href.startsWith("//") && !href.includes(".");
}

// Top-level group for a repo-relative path: first path segment, or "(root)"
// for a file that sits directly at the docs root.
function groupOf(relPath) {
  const parts = relPath.split(sep);
  return parts.length > 1 ? parts[0] : "(root)";
}

// ── Core check (exported for --self-test) ────────────────────────────────────
// Walks `root`, resolves every internal page link, and aggregates per
// top-level group. Returns:
//   { groups: [{ group, total, broken, pct }], totals: { total, broken, pct },
//     filesScanned }
// where `total` counts internal PAGE links (the ones brokenness is defined
// over) and `pct` is broken/total*100 (0 when total is 0). Groups are sorted
// alphabetically for deterministic output.
export function computeLinkHealth(root) {
  const mdxFiles = walkDir(root, []);

  // Navigable page set: each file's slug, and its "/index"-collapsed form is
  // matched at resolve time (same as check-links-local.mjs).
  const pages = new Set();
  for (const f of mdxFiles) {
    const rel = relative(root, f).replace(/\.(mdx|md)$/, "");
    pages.add("/" + rel.split(sep).join("/"));
  }

  const resolvesLink = (href) => {
    const normalized = href.replace(/\/$/, "");
    return pages.has(normalized) || pages.has(normalized + "/index");
  };

  // group → { total, broken }
  const byGroup = new Map();
  const bump = (group, brokenDelta) => {
    let g = byGroup.get(group);
    if (!g) {
      g = { total: 0, broken: 0 };
      byGroup.set(group, g);
    }
    g.total += 1;
    g.broken += brokenDelta;
  };

  for (const f of mdxFiles) {
    const rel = relative(root, f);
    const group = groupOf(rel);
    const content = readFileSync(f, "utf-8");
    for (const href of extractInternalLinks(content)) {
      if (!isInternalPath(href)) continue;
      bump(group, resolvesLink(href) ? 0 : 1);
    }
  }

  const pct = (broken, total) => (total === 0 ? 0 : (broken / total) * 100);

  const groups = [...byGroup.entries()]
    .map(([group, { total, broken }]) => ({
      group,
      total,
      broken,
      pct: pct(broken, total),
    }))
    .sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0));

  const total = groups.reduce((s, g) => s + g.total, 0);
  const broken = groups.reduce((s, g) => s + g.broken, 0);

  return {
    groups,
    totals: { total, broken, pct: pct(broken, total) },
    filesScanned: mdxFiles.length,
  };
}

// ── Render ───────────────────────────────────────────────────────────────────
const fmtPct = (n) => `${n.toFixed(1)}%`;

// GitHub-flavored Markdown table. Numeric columns are right-aligned. A final
// bold "All" row carries the overall total. Groups with zero broken links are
// still listed so the table is a complete inventory every run.
export function renderTable(result) {
  const lines = [];
  lines.push("### 🔗 Internal link health by top-level group");
  lines.push("");
  lines.push(
    "_Advisory report — does not block the build. \"Total links\" counts internal page links (the links `mint broken-links` validates)._",
  );
  lines.push("");
  lines.push("| Group | Total links | Broken | % broken |");
  lines.push("| :--- | ---: | ---: | ---: |");
  for (const g of result.groups) {
    lines.push(
      `| ${g.group} | ${g.total} | ${g.broken} | ${fmtPct(g.pct)} |`,
    );
  }
  const t = result.totals;
  lines.push(`| **All** | **${t.total}** | **${t.broken}** | **${fmtPct(t.pct)}** |`);
  lines.push("");
  lines.push(`_Scanned ${result.filesScanned} MDX/MD file(s)._`);
  return lines.join("\n");
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Builds a throwaway fixture tree with a KNOWN broken link and asserts the
// computed per-group and overall percentages match by hand.
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

  const root = mkdtempSync(join(tmpdir(), "link-health-selftest-"));
  const touch = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  };

  // Fixture tree (pages that EXIST): guides/a, guides/b, concepts/c, introduction.
  //
  //  guides/a.mdx      → 2 internal page links: /guides/b (OK), /guides/missing (BROKEN)
  //  guides/b.mdx      → 1 internal page link:  /concepts/c (OK)
  //  concepts/c.mdx    → 2 links: /introduction (OK, root page) + [ext](https://x.com) (skipped, not internal)
  //  introduction.mdx  → 1 internal page link:  /concepts/nope (BROKEN)  [root group]
  //
  // Expected:
  //   guides       : total 3, broken 1  → 33.3%
  //   concepts     : total 1, broken 0  →  0.0%
  //   (root)       : total 1, broken 1  → 100.0%
  //   All          : total 5, broken 2  → 40.0%
  touch(
    "guides/a.mdx",
    "See [b](/guides/b) and [gone](/guides/missing).\n",
  );
  touch("guides/b.mdx", 'Read <a href="/concepts/c">concepts</a>.\n');
  touch(
    "concepts/c.mdx",
    "Back to [intro](/introduction) or [ext](https://example.com/x).\n",
  );
  touch("introduction.mdx", "Broken [x](/concepts/nope).\n");

  const r = computeLinkHealth(root);
  const byName = Object.fromEntries(r.groups.map((g) => [g.group, g]));

  assert("three groups discovered", r.groups.length === 3);
  assert("guides total = 3", byName.guides?.total === 3);
  assert("guides broken = 1", byName.guides?.broken === 1);
  assert(
    "guides % broken ≈ 33.3",
    Math.abs(byName.guides.pct - (1 / 3) * 100) < 1e-9,
  );
  assert("concepts total = 1", byName.concepts?.total === 1);
  assert("concepts broken = 0 (external link excluded)", byName.concepts?.broken === 0);
  assert("(root) group holds root-level file", byName["(root)"]?.total === 1);
  assert("(root) broken = 1 → 100%", byName["(root)"]?.broken === 1 && Math.abs(byName["(root)"].pct - 100) < 1e-9);
  assert("overall total = 5", r.totals.total === 5);
  assert("overall broken = 2", r.totals.broken === 2);
  assert("overall % broken = 40.0", Math.abs(r.totals.pct - 40) < 1e-9);
  assert("groups sorted alphabetically", r.groups.map((g) => g.group).join(",") === "(root),concepts,guides");

  // Rendered table is well-formed Markdown and carries the computed numbers.
  const table = renderTable(r);
  assert("table has header row", table.includes("| Group | Total links | Broken | % broken |"));
  assert("table renders guides 33.3%", table.includes("| guides | 3 | 1 | 33.3% |"));
  assert("table renders All row 40.0%", table.includes("| **All** | **5** | **2** | **40.0%** |"));

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const args = argv.slice(2);
  let verbose = false;
  // Default root = repo root (one level up from scripts/), so the report works
  // regardless of the current working directory.
  let root = fileURLToPath(new URL("..", import.meta.url));
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verbose") verbose = true;
    else if (args[i] === "--self-test") {
      exit(selfTest() ? 0 : 1);
    } else if (args[i] === "--root") {
      if (i + 1 >= args.length) {
        console.error("--root requires a path argument");
        exit(2);
      }
      root = resolve(args[++i]);
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(
        "Usage: link-health-report.mjs [--root path] [--verbose] [--self-test]\n" +
          "  Advisory report: internal-link health by top-level group. Always exits 0.\n" +
          "  Writes a Markdown table to $GITHUB_STEP_SUMMARY if set, else stdout.",
      );
      exit(0);
    } else {
      console.error(`Unknown flag: ${args[i]}`);
      exit(2);
    }
  }

  let result;
  try {
    result = computeLinkHealth(root);
  } catch (err) {
    // Advisory report: even an unexpected error must not fail the build. Surface
    // it as a note and still exit 0.
    console.log(`::warning::link-health-report could not scan ${root}: ${err.message}`);
    exit(0);
  }

  const table = renderTable(result);
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, table + "\n");
    if (verbose) console.log(`Wrote link-health table to $GITHUB_STEP_SUMMARY (${summaryPath}).`);
    // Also echo a one-line summary to the log so it's visible without opening
    // the run summary.
    console.log(
      `link-health: ${result.totals.broken}/${result.totals.total} internal link(s) broken (${fmtPct(result.totals.pct)}) across ${result.groups.length} group(s).`,
    );
  } else {
    console.log(table);
  }
  exit(0); // Advisory: always succeed.
}

main();
