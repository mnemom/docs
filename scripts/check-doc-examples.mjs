#!/usr/bin/env node
/**
 * check-doc-examples.mjs — Doc-as-spec static walker.
 *
 * Extracts every `curl https://api.mnemom.ai/v1/...` invocation from
 * fenced bash code blocks in customer-facing MDX pages and asserts:
 *
 *   1. The URL path corresponds to a real path in api-reference/openapi.json
 *      (after normalizing shell-var, all-caps, and example-ID placeholders
 *      to the spec's `{param}` slots).
 *   2. The HTTP method on that path is declared in the spec.
 *
 * This is the first layer of Track 5's doc-as-spec CI (T5-1, v1). It is
 * the docs-side complement of the four-layer leading-teams contract-drift
 * defense built out by Track 4 (spec inheritance + static walker + runtime
 * enforce + OTel-derived auto-patcher in mnemom-api). The runtime guarantees
 * api-reference/openapi.json is exhaustive and enforced; this walker
 * guarantees every documented endpoint corresponds to a real one.
 *
 * Out of scope for v1 (deliberate follow-ons):
 *  - JSON body validation against requestBody schemas (needs Ajv + a $ref
 *    resolver; deferred to T5-1 layer 2).
 *  - Live execution against staging (needs credential handling, idempotency
 *    discipline, cleanup; deferred to T5-1 layer 3).
 *  - gateway.mnemom.ai/* URLs (passthrough, no first-party spec).
 *  - JSON / YAML / Python / TypeScript fenced blocks (out of grammar for v1;
 *    spec-page YAML examples are T5-3's territory).
 *
 * Exits 0 when every extracted call matches the spec.
 * Exits 1 with a per-file report on any drift.
 *
 * Flags:
 *   --scope <dirs>   Comma-separated list of top-level dirs to walk.
 *                    Default: quickstart,guides,concepts,specifications,
 *                    protocols,gateway,for-agents,migration,pricing.
 *   --verbose        Also list the calls that passed (audit aid).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

// ── CLI parsing ──────────────────────────────────────────────────────────
const args = argv.slice(2);
// Default scope = all customer-facing tabs from docs.json plus the
// repo-root MDX files (introduction, changelog). api-reference/ is
// excluded — those pages are auto-generated from openapi.json by Mintlify
// and would trivially round-trip.
let scope = "introduction.mdx,changelog.mdx,quickstart,guides,concepts,specifications,protocols,gateway,for-agents,migration,pricing";
let verbose = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--scope") scope = args[++i];
  else if (args[i] === "--verbose") verbose = true;
  else if (args[i] === "--help" || args[i] === "-h") {
    console.log("Usage: check-doc-examples.mjs [--scope dir1,dir2] [--verbose]");
    exit(0);
  } else {
    console.error(`Unknown flag: ${args[i]}`);
    exit(2);
  }
}
const scopeDirs = scope.split(",").map((s) => s.trim()).filter(Boolean);

// ── Known-drift allowlist ────────────────────────────────────────────────
//
// T5-1 ships green by allowlisting drift findings whose remediation belongs
// to a different T5 sub-track (concept-page audit T5-2, guide audit T5-4,
// or an upstream spec gap to address in mnemom-api). Each entry is a
// (file, method, normalized-path) tuple. Matching entries are still
// reported as "known drift" but do NOT fail the build. Removing an entry
// is the signal that the underlying doc has been fixed.
//
// As T5-2/T5-4 PRs land, every removed entry tightens this CI gate by
// one finding. The end state for T5 is an empty list.
//
// Normalized path = the path the walker computes (no /v1 prefix, trailing
// slash trimmed, percent-decoded segments). See pathSegmentsFromUrl.
const KNOWN_DRIFT = [
  // quickstart/safe-house-protection.mdx — six examples reference a
  // per-agent /safe-house/* shape that doesn't exist; the spec has
  // /safe-house/quarantine/{quarantine_id}/release|report (org-scoped),
  // /safe-house/stats, etc. Owner: T5-4 guide audit; the whole quickstart
  // needs to be rewritten against the real safe-house surface.
  { file: "quickstart/safe-house-protection.mdx", method: "PUT", path: "/agents/{agent_id}/safe-house/config", owner: "T5-4" },
  { file: "quickstart/safe-house-protection.mdx", method: "GET", path: "/agents/{agent_id}/safe-house/stats", owner: "T5-4" },
  { file: "quickstart/safe-house-protection.mdx", method: "GET", path: "/agents/{agent_id}/safe-house/quarantine/{quarantine_id}", owner: "T5-4" },
  { file: "quickstart/safe-house-protection.mdx", method: "POST", path: "/agents/{agent_id}/safe-house/quarantine/{quarantine_id}/release", owner: "T5-4" },
  { file: "quickstart/safe-house-protection.mdx", method: "POST", path: "/agents/{agent_id}/safe-house/quarantine/{quarantine_id}/discard", owner: "T5-4" },
  // guides/api-versioning.mdx — references the pre-ADR-039 unified
  // /agents/{agent_id}/card endpoint. Post-ADR-039 the surface is split
  // into /alignment-card and /protection-card. Owner: T5-2 concept-page
  // audit (the same page rewrite should drop the legacy field
  // mentions per the T5-2 acceptance criteria).
  { file: "guides/api-versioning.mdx", method: "GET", path: "/agents/{agent_id}/card", owner: "T5-2" },
  // concepts/agent-identity.mdx — same legacy /card reference, two
  // distinct example IDs in the same fenced block.
  { file: "concepts/agent-identity.mdx", method: "GET", path: "/agents/{agent_id}/card", owner: "T5-2" },
  // gateway/org-card-templates.mdx — references /agents/{agent_id}/
  // org-card-exempt which doesn't exist in the spec. Two examples
  // (PUT to set, GET to check) — both resolve to the same tuple after
  // method+path normalization on the GET side because the doc actually
  // uses PUT twice. Owner: T5-4 guide audit.
  { file: "gateway/org-card-templates.mdx", method: "PUT", path: "/agents/{agent_id}/org-card-exempt", owner: "T5-4" },
];

// KNOWN_DRIFT entries use templated paths (e.g., `/agents/{agent_id}/card`)
// so a single entry covers every example variant (`$AGENT_ID`,
// `mnm-550e8...`, `smolt-...`). Match the entry's template against the
// walker's literal segments the same way matchSpecPath does.
function templatePathMatchesSegments(templatePath, segments) {
  const tSegs = templatePath.split("/").filter(Boolean);
  if (tSegs.length !== segments.length) return false;
  for (let i = 0; i < tSegs.length; i++) {
    const t = tSegs[i];
    if (t.startsWith("{") && t.endsWith("}")) continue;
    if (t !== segments[i]) return false;
  }
  return true;
}

function knownDriftEntry(file, method, segments) {
  return KNOWN_DRIFT.find(
    (e) =>
      e.file === file &&
      e.method === method &&
      templatePathMatchesSegments(e.path, segments),
  );
}

// ── Load spec ────────────────────────────────────────────────────────────
const spec = JSON.parse(readFileSync("api-reference/openapi.json", "utf8"));
const specPaths = Object.keys(spec.paths ?? {});

// Pre-tokenize the spec's paths once. Each entry: { raw, segments[], methods[] }.
const specIndex = specPaths.map((raw) => {
  const segments = raw.split("/").filter(Boolean);
  const methods = Object.keys(spec.paths[raw]).filter((k) =>
    ["get", "post", "put", "patch", "delete", "head", "options"].includes(k),
  );
  return { raw, segments, methods };
});

// ── Walk MDX files ───────────────────────────────────────────────────────
function walkMdx(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walkMdx(full, acc);
    else if (entry.endsWith(".mdx") || entry.endsWith(".md")) acc.push(full);
  }
  return acc;
}

const files = scopeDirs.flatMap((d) => {
  try {
    const s = statSync(d);
    if (s.isFile()) return d.endsWith(".mdx") || d.endsWith(".md") ? [d] : [];
    if (s.isDirectory()) return walkMdx(d);
  } catch {
    // Missing scope target — silent skip (lets the default include
    // forward-compat additions before they exist on disk).
    return [];
  }
  return [];
});

// ── Extract bash code blocks ─────────────────────────────────────────────
//
// Fenced code blocks open with ``` followed by a language tag (and
// optionally a label like "bash cURL"). We accept the block as "bash"
// when the first token after the fence is bash, sh, or curl.
function extractBashBlocks(source) {
  const blocks = [];
  const lines = source.split("\n");
  let inFence = false;
  let isBash = false;
  let buf = [];
  let openLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (!inFence) {
        const tag = line.slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        inFence = true;
        isBash = ["bash", "sh", "shell", "curl", "console"].includes(tag);
        buf = [];
        openLine = i + 1;
      } else {
        if (isBash) blocks.push({ line: openLine, body: buf.join("\n") });
        inFence = false;
        isBash = false;
      }
    } else if (inFence && isBash) {
      buf.push(line);
    }
  }
  return blocks;
}

// ── Extract curl invocations from a bash block ───────────────────────────
//
// Curl commands can span many lines via `\` continuation. We first
// rejoin continuations into single logical lines, then scan for tokens
// starting with `curl`.
function extractCurls(blockBody) {
  // Rejoin trailing-backslash continuations into one logical line per curl.
  const logical = blockBody
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const curls = [];
  for (const line of logical) {
    // Heredoc'd request bodies (`-d @-` patterns etc.) aren't used in
    // our docs grammar; simple inline -d '...' / -d "..." covers what
    // exists. A curl line may have semicolons or `&&` joiners; split
    // on those before parsing.
    for (const piece of splitShellTokens(line)) {
      const trimmed = piece.trim();
      if (trimmed.startsWith("curl ") || trimmed === "curl") {
        curls.push(trimmed);
      }
    }
  }
  return curls;
}

function splitShellTokens(line) {
  // Split a logical line on `;`, `&&`, `||` while respecting single/double
  // quoted segments. Returns the resulting pieces.
  const out = [];
  let depth = { sq: false, dq: false };
  let buf = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !depth.dq) depth.sq = !depth.sq;
    else if (c === '"' && !depth.sq) depth.dq = !depth.dq;
    if (!depth.sq && !depth.dq) {
      if (c === ";") {
        out.push(buf);
        buf = "";
        continue;
      }
      if ((c === "&" && line[i + 1] === "&") || (c === "|" && line[i + 1] === "|")) {
        out.push(buf);
        buf = "";
        i++;
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

// ── Parse a single curl invocation ───────────────────────────────────────
//
// Returns { method, url } when the curl targets api.mnemom.ai/v1/*. Returns
// null when the URL is out of scope (gateway, localhost, GitHub, etc.) or
// when we can't recover a URL.
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
function parseCurl(invocation) {
  // Tokenize respecting quoted segments.
  const tokens = shellTokenize(invocation);
  if (tokens[0] !== "curl") return null;

  let method = "GET";
  let url = null;

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-X" || t === "--request") {
      const m = (tokens[++i] ?? "").toUpperCase();
      if (HTTP_METHODS.has(m)) method = m;
    } else if (t.startsWith("-X")) {
      const m = t.slice(2).toUpperCase();
      if (HTTP_METHODS.has(m)) method = m;
    } else if (t === "-H" || t === "--header") {
      i++; // skip header arg
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary") {
      i++; // skip body; if no explicit method was set, default-to-POST
      if (method === "GET") method = "POST";
    } else if (t === "-u" || t === "--user" || t === "-A" || t === "--user-agent") {
      i++;
    } else if (t === "-o" || t === "--output" || t === "--cookie" || t === "-b") {
      i++;
    } else if (t.startsWith("--")) {
      // long flag with attached value (`--data-urlencode=foo`) or boolean
      if (t.includes("=") === false && (t === "--silent" || t === "--fail" || t === "--location" || t === "--include" || t === "--verbose")) {
        // boolean flag; nothing to skip
      } else if (!t.includes("=")) {
        // long flag with separate value
        i++;
      }
    } else if (t.startsWith("-")) {
      // short combined flags like -sSL — boolean, no skip
    } else if (!url && (t.startsWith("http://") || t.startsWith("https://"))) {
      url = t;
    }
  }
  return url ? { method, url } : null;
}

function shellTokenize(line) {
  const out = [];
  let buf = "";
  let sq = false;
  let dq = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !dq) {
      sq = !sq;
      continue;
    }
    if (c === '"' && !sq) {
      dq = !dq;
      continue;
    }
    if (c === "\\" && (i + 1) < line.length && !sq) {
      buf += line[++i];
      continue;
    }
    if (/\s/.test(c) && !sq && !dq) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
    } else {
      buf += c;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// ── Normalize a URL path against the spec ────────────────────────────────
//
// Strip scheme/host/query/fragment, drop the `/v1` prefix, tokenize. Then
// search specIndex for the unique entry with same segment-count where every
// non-`{...}` segment matches literally. Multiple matches are allowed only
// if `{param}` slots disambiguate; otherwise we return all candidates so
// the caller can flag ambiguity (rare in practice).
function pathSegmentsFromUrl(url) {
  let path;
  try {
    const u = new URL(url);
    if (u.hostname !== "api.mnemom.ai") return { skip: true, reason: `host=${u.hostname}` };
    path = u.pathname;
  } catch {
    return { skip: true, reason: "unparseable" };
  }

  if (path.startsWith("/v1/")) path = path.slice(3); // keep leading slash
  else if (path === "/v1") path = "/";
  else return { skip: true, reason: "not /v1/*" };

  // Trim trailing slash unless root.
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  // URL parsing percent-encodes literal `{` / `}`. The docs grammar lets
  // pages use `{agent_id}` to show the URL shape (illustrative templates),
  // and that should match the spec's `{agent_id}` slot directly. Decode
  // each segment so the matcher sees the original characters.
  const segs = path
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  return { skip: false, segments: segs };
}

function matchSpecPath(segments) {
  const candidates = [];
  for (const entry of specIndex) {
    if (entry.segments.length !== segments.length) continue;
    let ok = true;
    let paramCount = 0;
    for (let i = 0; i < segments.length; i++) {
      const specSeg = entry.segments[i];
      if (specSeg.startsWith("{") && specSeg.endsWith("}")) {
        paramCount++;
        continue; // {param} matches anything (including placeholders and literal IDs)
      }
      if (specSeg !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) candidates.push({ entry, paramCount });
  }
  if (candidates.length === 0) return null;
  // Prefer the most-specific match (fewest `{param}` slots). This is well
  // defined because the spec doesn't overload a literal segment against a
  // parameter at the same position in two distinct entries with equal
  // specificity (verified by manual inspection of openapi.json).
  candidates.sort((a, b) => a.paramCount - b.paramCount);
  return candidates[0].entry;
}

// ── Walk + validate ──────────────────────────────────────────────────────
const failures = [];
const knownDrift = [];
const passes = [];
let totalCurls = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const block of extractBashBlocks(source)) {
    for (const curl of extractCurls(block.body)) {
      const parsed = parseCurl(curl);
      if (!parsed) continue;
      totalCurls++;
      const { method, url } = parsed;
      const norm = pathSegmentsFromUrl(url);
      if (norm.skip) {
        // Out-of-scope host (gateway.*, localhost, etc.) — silently skip.
        // The four-layer T4 defense covers api.mnemom.ai/v1; gateway has
        // no first-party spec and is a passthrough.
        continue;
      }
      const normalizedPath = "/" + norm.segments.join("/");
      const matched = matchSpecPath(norm.segments);
      if (!matched) {
        const allow = knownDriftEntry(file, method, norm.segments);
        const entry = { file, line: block.line, method, path: normalizedPath, curl: clip(curl), reason: `no spec path matches ${method} /v1${normalizedPath}`, allowKey: allow ? `${allow.file}|${allow.method}|${allow.path}` : null, owner: allow?.owner };
        if (allow) knownDrift.push(entry);
        else failures.push(entry);
        continue;
      }
      const m = method.toLowerCase();
      if (!matched.methods.includes(m)) {
        const allow = knownDriftEntry(file, method, norm.segments);
        const entry = { file, line: block.line, method, path: matched.raw, curl: clip(curl), reason: `method ${method} not declared on ${matched.raw} (spec has: ${matched.methods.map((x) => x.toUpperCase()).join(", ") || "none"})`, allowKey: allow ? `${allow.file}|${allow.method}|${allow.path}` : null, owner: allow?.owner };
        if (allow) knownDrift.push(entry);
        else failures.push(entry);
        continue;
      }
      passes.push({ file, line: block.line, method, path: matched.raw });
    }
  }
}

function clip(s) {
  return s.length > 140 ? s.slice(0, 137) + "..." : s;
}

// ── Report ───────────────────────────────────────────────────────────────
const fileCount = files.length;
console.log(`Scanned ${fileCount} MDX file(s) across [${scopeDirs.join(", ")}].`);
console.log(`Extracted ${totalCurls} curl invocation(s) targeting api.mnemom.ai/v1/*.`);

if (verbose) {
  for (const p of passes) {
    console.log(`  ✓ ${p.method.padEnd(6)} ${p.path}   (${p.file}:${p.line})`);
  }
}

if (knownDrift.length > 0) {
  console.log();
  console.log(`Known drift (allowlisted; tracked under T5-2 / T5-4): ${knownDrift.length}`);
  const byFile = new Map();
  for (const f of knownDrift) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.method} ${f.path}  [${f.owner ?? "?"}]`);
    }
  }
}

// Detect stale KNOWN_DRIFT entries — present in the allowlist but no
// longer matched by any extracted example. These should be removed.
const seenTuples = new Set(knownDrift.map((d) => d.allowKey).filter(Boolean));
const stale = KNOWN_DRIFT.filter(
  (e) => !seenTuples.has(`${e.file}|${e.method}|${e.path}`),
);

if (failures.length === 0 && stale.length === 0) {
  console.log();
  console.log(`✓ ${passes.length} curl example(s) match a documented endpoint; ${knownDrift.length} known-drift allowlisted.`);
  exit(0);
}

if (failures.length > 0) {
  console.log();
  console.log(`❌ ${failures.length} NEW doc example(s) drift from api-reference/openapi.json:\n`);
  const byFile = new Map();
  for (const f of failures) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const f of list) {
      console.log(`    line ${f.line}: ${f.reason}`);
      console.log(`      ${f.curl}`);
    }
    console.log();
  }
  console.log("Each failure is one of:");
  console.log("  - the doc references an endpoint that doesn't exist in the spec");
  console.log("    (likely a rename or removal — fix the doc to match openapi.json),");
  console.log("  - the doc uses a method the spec doesn't declare on that path");
  console.log("    (likely a method-not-allowed drift — fix the doc),");
  console.log("  - the spec is missing an endpoint that should be there");
  console.log("    (rare after T4-4; if real, fix mnemom-api/openapi.json first).");
  console.log();
  console.log("If this finding is the same drift as an existing KNOWN_DRIFT");
  console.log("entry, the existing entry's normalized path may not match — recheck");
  console.log("file/method/path against the extracted form shown above.");
}

if (stale.length > 0) {
  console.log();
  console.log(`⚠ ${stale.length} stale KNOWN_DRIFT entr${stale.length === 1 ? "y" : "ies"} — remove from scripts/check-doc-examples.mjs:`);
  for (const e of stale) {
    console.log(`  - ${e.file}: ${e.method} ${e.path}  [${e.owner}]`);
  }
  console.log();
  console.log("A stale entry means the underlying doc drift is resolved.");
  console.log("Removing the entry tightens the gate.");
}

exit(1);
