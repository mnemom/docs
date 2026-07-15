#!/usr/bin/env node
/**
 * check-compliance-coverage.mjs — ties compliance CLAIMS to resolving evidence.
 *
 * guides/compliance.mdx states Mnemom's posture framework by framework in the
 * "Status at a glance" table. The page's own legend defines the honesty
 * contract: a **Supported** row "means we implement the controls today WITH
 * PUBLISHED EVIDENCE." Nothing enforces that today — a Supported row can cite an
 * evidence link that 404s (page deleted/renamed) or cite no internal evidence at
 * all, and the claim ships looking backed when it is not.
 *
 * This script closes that gap. For every row that CLAIMS an implemented control
 * (status ∈ REQUIRE_EVIDENCE — see below), it asserts the "Evidence / reference"
 * cell carries at least one INTERNAL link that fully resolves: the destination
 * page exists in this docs tree, and — when the link carries a `#fragment` — that
 * fragment resolves to a real heading anchor on the destination page.
 *
 * Division of labour with the sibling validators (same contract, same style):
 *   - check-links-local.mjs / `mint broken-links` — does a linked PAGE exist?
 *   - check-anchors.mjs — does a deep link's `#fragment` resolve to a heading?
 *     (checks EVERY fragment link in the tree, including this page's.)
 *   - check-compliance-coverage.mjs (this file) — does every SUPPORTED
 *     compliance claim actually carry ≥1 resolving internal evidence link?
 * The anchor machinery here is deliberately consistent with check-anchors.mjs:
 * it reuses that module's exported `extractAnchors`, and it percent-decodes a
 * fragment before the anchor lookup (mirroring check-anchors.mjs line ~230),
 * tolerating a malformed `%`-sequence by falling back to the raw fragment.
 *
 * Exits 0 when every claim is backed, 1 on any unbacked claim / unknown status
 * (or a failed self-test / read error), 2 on bad CLI usage. No new dependencies.
 */

import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

import { extractAnchors } from "./check-anchors.mjs";

// The compliance page whose claims are validated, relative to the docs root.
const COMPLIANCE_PAGE = "guides/compliance.mdx";

// Known status vocabulary: hardcoded from the page legend ("Supported",
// "Readiness assessment in progress", "Not on roadmap") PLUS every status value
// observed in the table rows ("Partial", "Not in scope"). The validator does NOT
// auto-derive this set — a new status word must be added here deliberately, so an
// accidental typo ("Suported") surfaces as an unknown-status failure rather than
// silently escaping the evidence requirement.
const KNOWN_STATUSES = new Set([
  "Supported",
  "Readiness assessment in progress",
  "Not on roadmap",
  "Partial",
  "Not in scope",
]);

// Statuses that assert an implemented control TODAY and therefore must be backed
// by published evidence. Grounded in the page legend: only "Supported" is defined
// as "we implement the controls today with published evidence." The other
// statuses describe work-in-progress ("Readiness assessment in progress") or the
// absence of a commitment ("Not on roadmap" / "Not in scope"), which the page
// legitimately leaves without an evidence link ("—" / plain text).
const REQUIRE_EVIDENCE = new Set(["Supported"]);

// Failure reason vocabulary (one reason per failing row).
const REASON_NO_LINK = "no internal evidence link";
const REASON_PAGE_NOT_FOUND = "page not found";
const REASON_MISSING_ANCHOR = "missing anchor";
const REASON_UNKNOWN_STATUS = "unknown status";

// ── Page index ────────────────────────────────────────────────────────────────
// Mirrors check-anchors.mjs: walk the docs tree for published .mdx pages and map
// every internal route to its file (folding `/index`). Repo-internal .md notes
// are intentionally out of scope — those are not rendered pages.
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

// ── Table parsing (exported for --self-test) ──────────────────────────────────
// Split one Markdown table row into trimmed cells, dropping the outer pipes.
function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

// A GFM header separator row: every cell is dashes with optional alignment colons.
function isSeparatorRow(line) {
  if (!line.includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

// Locate the "Status at a glance" table by its header columns (robust to column
// reordering): the header row must expose a Framework, a Status, and an Evidence
// column. Returns { statusIdx, frameworkIdx, evidenceIdx, rows: [{framework,
// status, evidence}] } or null if no such table exists.
export function parseStatusTable(content) {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    const header = lines[i];
    if (!header.includes("|")) continue;
    if (!isSeparatorRow(lines[i + 1])) continue;

    const headers = splitRow(header);
    const frameworkIdx = headers.findIndex((h) => /framework/i.test(h));
    const statusIdx = headers.findIndex((h) => /status/i.test(h));
    const evidenceIdx = headers.findIndex((h) => /evidence/i.test(h));
    if (frameworkIdx < 0 || statusIdx < 0 || evidenceIdx < 0) continue;

    const rows = [];
    for (let j = i + 2; j < lines.length; j++) {
      const line = lines[j];
      if (!line.includes("|")) break; // table ended
      if (isSeparatorRow(line)) continue;
      const cells = splitRow(line);
      if (cells.length <= Math.max(frameworkIdx, statusIdx, evidenceIdx)) continue;
      rows.push({
        framework: cells[frameworkIdx],
        // Strip bold markers: "**Supported**" → "Supported".
        status: cells[statusIdx].replace(/\*\*/g, "").trim(),
        evidence: cells[evidenceIdx],
      });
    }
    return { frameworkIdx, statusIdx, evidenceIdx, rows };
  }
  return null;
}

// ── Evidence-link extraction (exported for --self-test) ───────────────────────
// Pull INTERNAL Markdown links out of an evidence cell. Returns [{page,
// fragment, raw}]. External URLs (https://…, //…), relative-file links, and
// bare same-page fragments are not internal evidence and are skipped.
export function extractInternalLinks(cell) {
  const out = [];
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(cell)) !== null) {
    const href = m[1];
    const hashIdx = href.indexOf("#");
    const page = hashIdx < 0 ? href : href.slice(0, hashIdx);
    const fragment = hashIdx < 0 ? "" : href.slice(hashIdx + 1);
    if (!page.startsWith("/") || page.startsWith("//")) continue; // not an internal route
    out.push({ page, fragment, raw: href });
  }
  return out;
}

// Resolve one internal link against the page index + anchor sets.
// Returns { ok: true } or { ok: false, reason }.
function resolveLink(link, pageIndex, anchorsFor) {
  const route = link.page.replace(/\/$/, "");
  const targetFile = pageIndex.get(route) ?? pageIndex.get(route + "/index");
  if (!targetFile) return { ok: false, reason: REASON_PAGE_NOT_FOUND };
  if (!link.fragment) return { ok: true };
  // Percent-decode before anchor lookup (matches check-anchors.mjs); a malformed
  // `%`-sequence throws in decodeURIComponent, so fall back to the raw fragment.
  let anchor;
  try {
    anchor = decodeURIComponent(link.fragment);
  } catch {
    anchor = link.fragment;
  }
  if (anchorsFor(targetFile).has(anchor)) return { ok: true };
  return { ok: false, reason: REASON_MISSING_ANCHOR };
}

// Evaluate one require-evidence row. Returns a failure object or null (row backed).
// A row is backed when AT LEAST ONE of its internal evidence links resolves; a
// cell with links but none resolving yields exactly ONE failure whose reason is
// "page not found" when no page resolved at all, else "missing anchor".
function evaluateRow(row, pageIndex, anchorsFor) {
  const links = extractInternalLinks(row.evidence);
  if (links.length === 0) {
    return { framework: row.framework, status: row.status, reason: REASON_NO_LINK };
  }
  const results = links.map((l) => resolveLink(l, pageIndex, anchorsFor));
  if (results.some((r) => r.ok)) return null; // backed
  const anchorReached = results.some((r) => r.reason === REASON_MISSING_ANCHOR);
  return {
    framework: row.framework,
    status: row.status,
    reason: anchorReached ? REASON_MISSING_ANCHOR : REASON_PAGE_NOT_FOUND,
  };
}

// ── Core check (exported for --self-test) ─────────────────────────────────────
// Pure of process.exit / console so it can be exercised against fixtures.
export function checkComplianceCoverage({ root, page }) {
  const pageFile = page ?? join(root, ...COMPLIANCE_PAGE.split("/"));
  const content = readFileSync(pageFile, "utf8");
  const table = parseStatusTable(content);
  if (!table) {
    throw new Error(`could not locate the compliance status table in ${relative(root, pageFile)}`);
  }

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

  const failures = [];
  let requiredRows = 0;
  let backedRows = 0;

  for (const row of table.rows) {
    if (!KNOWN_STATUSES.has(row.status)) {
      // Unknown/unidentified status is an explicit failure — it must NOT slip
      // past the evidence requirement by falling into a generic "skip" branch.
      failures.push({ framework: row.framework, status: row.status, reason: REASON_UNKNOWN_STATUS });
      continue;
    }
    if (!REQUIRE_EVIDENCE.has(row.status)) continue; // known status that carries no control claim
    requiredRows++;
    const failure = evaluateRow(row, pageIndex, anchorsFor);
    if (failure) failures.push(failure);
    else backedRows++;
  }

  return { totalRows: table.rows.length, requiredRows, backedRows, failures };
}

// ── Self-test ──────────────────────────────────────────────────────────────
// Builds a throwaway doc tree in a temp dir and asserts each row class is
// classified correctly, then confirms the REAL guides/compliance.mdx passes.
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

  const root = mkdtempSync(join(tmpdir(), "check-compliance-selftest-"));
  const mkdoc = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };

  // A real target page with two headings → anchors `stability-guarantee`,
  // `gdpr-overview`.
  mkdoc(
    "concepts/target.mdx",
    ["---", "title: Target", "---", "", "# Target page", "", "## Stability guarantee", "", "## GDPR overview", ""].join("\n"),
  );

  // A fixture compliance page exercising every row class.
  mkdoc(
    "guides/compliance.mdx",
    [
      "---",
      "title: Compliance",
      "---",
      "",
      "## Status at a glance",
      "",
      "| Framework | Status | What that means today | Evidence / reference |",
      "|---|---|---|---|",
      "| Valid supported | **Supported** | x | [Target](/concepts/target) |",
      "| Supported multi | **Supported** | x | [Dead](/no-such) and [Live](/concepts/target#stability-guarantee) |",
      "| No link | **Supported** | x | SOC 2 readiness |",
      "| External only | **Supported** | x | [site](https://example.com/x) |",
      "| Dead single | **Supported** | x | [Gone](/no-such-page) |",
      "| Two dead | **Supported** | x | [Missing A](/no-such-page) and [Missing B](/also-missing) |",
      "| Bad anchor | **Supported** | x | [Anchor](/concepts/target#nope) |",
      "| Pct anchor | **Supported** | x | [Enc](/concepts/target#stability%2Dguarantee) |",
      "| Malformed pct | **Supported** | x | [Bad](/concepts/target#bad%zz) |",
      "| Not required | **Not on roadmap** | x | — |",
      "| Unknown vocab | **Frobnicated** | x | [Target](/concepts/target) |",
    ].join("\n"),
  );

  const r = checkComplianceCoverage({ root });
  const failFor = (fw) => r.failures.filter((f) => f.framework === fw);
  const reasonFor = (fw) => (failFor(fw)[0] ? failFor(fw)[0].reason : null);

  assert("valid supported row with a resolving link passes", failFor("Valid supported").length === 0);
  assert("multiple links: one resolving link backs the row", failFor("Supported multi").length === 0);
  assert("supported row with no internal link fails 'no internal evidence link'", reasonFor("No link") === REASON_NO_LINK);
  assert("external-only evidence counts as no internal link", reasonFor("External only") === REASON_NO_LINK);
  assert("supported row with a dead page fails 'page not found'", reasonFor("Dead single") === REASON_PAGE_NOT_FOUND);
  // Symmetric MNE-438 case: two dead links in one cell → one failure, reason
  // 'page not found' (NOT 'no internal evidence link' — links were present).
  assert("two dead links fail 'page not found', not 'no internal evidence link'", reasonFor("Two dead") === REASON_PAGE_NOT_FOUND);
  assert("two dead links produce exactly one failure for the row", failFor("Two dead").length === 1);
  assert("resolving page but bad fragment fails 'missing anchor'", reasonFor("Bad anchor") === REASON_MISSING_ANCHOR);
  assert("percent-encoded fragment is decoded before anchor lookup", failFor("Pct anchor").length === 0);
  assert("malformed %-sequence falls back to raw fragment (no crash)", reasonFor("Malformed pct") === REASON_MISSING_ANCHOR);
  assert("non-required status with no evidence is not required", failFor("Not required").length === 0);
  assert("unknown status word fails 'unknown status'", reasonFor("Unknown vocab") === REASON_UNKNOWN_STATUS);
  assert("counters correspond: backedRows + required-failures === requiredRows", r.backedRows + r.failures.filter((f) => f.reason !== REASON_UNKNOWN_STATUS).length === r.requiredRows);

  // Real-file assertion (CWD-independent via import.meta.url): the shipped
  // guides/compliance.mdx must have every Supported claim backed today.
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const real = checkComplianceCoverage({ root: repoRoot });
  assert(
    `real ${COMPLIANCE_PAGE}: every claim backed (${real.backedRows}/${real.requiredRows})`,
    real.failures.length === 0,
  );

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(
    [
      "Usage: check-compliance-coverage.mjs [options]",
      "",
      "Asserts that every 'Supported' row in guides/compliance.mdx's status table",
      "carries at least one internal evidence link that resolves (page exists, and",
      "any #fragment resolves to a real heading anchor).",
      "",
      "Options:",
      "  --root <dir>    Docs root (default: repo root, resolved from scripts/).",
      "  --page <file>   Compliance page to validate (default: <root>/guides/compliance.mdx).",
      "  --self-test     Run built-in fixtures and exit.",
      "  --help, -h      Show this help.",
      "",
      "Exits 0 when every claim is backed, 1 on any unbacked claim / unknown status.",
    ].join("\n"),
  );
}

function main() {
  const args = argv.slice(2);
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  let root = resolve(scriptDir, "..");
  let page = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--self-test") exit(selfTest() ? 0 : 1);
    else if (a === "--root") {
      if (i + 1 >= args.length) {
        console.error("--root requires a path argument");
        exit(2);
      }
      root = resolve(args[++i]);
    } else if (a === "--page") {
      if (i + 1 >= args.length) {
        console.error("--page requires a path argument");
        exit(2);
      }
      page = resolve(args[++i]);
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
    result = checkComplianceCoverage({ root, page });
  } catch (err) {
    console.error(`✗ check-compliance-coverage failed: ${err.message}`);
    exit(1);
  }

  const { totalRows, requiredRows, backedRows, failures } = result;

  if (failures.length > 0) {
    console.log(`\n✗ ${failures.length} compliance claim(s) not backed by resolving evidence:`);
    for (const f of failures) {
      console.log(`  ${f.framework} [${f.status}]`);
      console.log(`      → ${f.reason}`);
    }
  }

  console.log(
    `\nscanned ${totalRows} row(s); ${backedRows}/${requiredRows} claim(s) backed, ${failures.length} failure(s).`,
  );

  if (failures.length > 0) {
    console.error(
      `\n✗ check-compliance-coverage: ${failures.length} compliance claim(s) lack resolving evidence.`,
    );
    exit(1);
  }
  console.log("✓ check-compliance-coverage: every supported compliance claim is backed by resolving evidence.");
  exit(0);
}

// Run the CLI only when executed directly, not when imported — so the exported
// core functions can be unit-exercised.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
