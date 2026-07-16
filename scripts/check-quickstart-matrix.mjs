#!/usr/bin/env node
/**
 * check-quickstart-matrix.mjs — quickstart coverage-matrix gate.
 *
 * Asserts that every provider × auth-header × integration-path (× SDK-language)
 * combination the quickstart set CLAIMS to support also ships a WORKED,
 * copy-pasteable example. A coverage hole — a provider auth header advertised in
 * a table but with no runnable curl, or an integration path missing one provider
 * — is caught here instead of silently shipping a doc a reader cannot follow.
 *
 * The asserted-supported set is DERIVED from the docs (never hard-coded, so it
 * cannot go stale):
 *   · Provider → auth-header, from the `model-coverage:supported` sentinel table
 *     in quickstart/gateway.mdx (Anthropic → x-api-key, OpenAI → Authorization,
 *     Gemini → x-goog-api-key). The gateway PATH segment is the lowercased
 *     provider name (/anthropic, /openai, /gemini) — derived algorithmically, not
 *     parsed from the unsentimented path table.
 *   · SDK languages, from the Install <CodeGroup> fence labels in
 *     quickstart/sdk-direct.mdx (Python, TypeScript).
 *
 * The documented-example set is derived by extracting fenced code blocks from
 * each quickstart page and:
 *   · curl paths (gateway, self-hosted): a provider cell is covered when a curl
 *     targets that provider's path segment AND carries its required auth header.
 *   · sdk-direct: a language cell is covered when at least one fenced block of
 *     that language contains a recognizable SDK operation (an SDK import or a
 *     verify/check/detect/AlignmentCard/APTrace call) — not merely any block of
 *     that language, so an install snippet or deprecation notice alone never
 *     satisfies coverage.
 *
 * FAILS CLOSED (exit 1, explicit error) if any source region/table is missing or
 * a fence extractor yields zero blocks — a dropped table or a broken extractor
 * must never pass vacuously.
 *
 * Sibling to check-model-coverage.mjs / check-sdk-quickstart.mjs; same contract:
 *   Exits 0 clean. Exits 1 on any uncovered cell, a missing source region, zero
 *   extracted blocks, or a failed self-test. Exits 2 on bad CLI usage.
 *
 * No new dependency: Node ≥22 `node:*` + reuse of the correct extractCurls /
 * parseCurl primitives from scripts/lib/doc-examples-extract.mjs. The shared
 * column-0 fence detector there is deliberately NOT reused for block splitting:
 * quickstart fences are indented inside <Step>/<CodeGroup> MDX tags, so a local
 * indentation-tolerant extractor (modeled on check-sdk-quickstart.mjs) is used.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

import { extractCurls, parseCurl } from "./lib/doc-examples-extract.mjs";

// ── Configuration ────────────────────────────────────────────────────────────
const SENTINEL_START = "<!-- model-coverage:supported:start -->";
const SENTINEL_END = "<!-- model-coverage:supported:end -->";

// Shell fence tags whose bodies may carry a curl (mirrors doc-examples-extract's
// BASH_TAGS, which is module-local there).
const SHELL_TAGS = new Set(["bash", "sh", "shell", "curl", "console"]);

// The three integration paths and their source pages.
const GATEWAY_PAGE = "quickstart/gateway.mdx";
const SDK_DIRECT_PAGE = "quickstart/sdk-direct.mdx";
const SELF_HOSTED_PAGE = "quickstart/self-hosted.mdx";

const scriptDir = () => dirname(fileURLToPath(import.meta.url));

// ── Indentation-tolerant fenced-block extraction ─────────────────────────────
// Returns every fenced code block with its language tag, display label (the
// token after the tag, e.g. `Python` in "```bash Python"), start line, and
// body with the common indent stripped. Trims leading whitespace before the
// fence test so fences nested inside <Step>/<CodeGroup> MDX tags are seen (the
// shared column-0 detector in doc-examples-extract.mjs misses these). Modeled on
// scripts/check-sdk-quickstart.mjs.
export function extractFencedBlocks(source) {
  const blocks = [];
  const lines = source.split("\n");
  let inFence = false;
  let lang = "";
  let label = "";
  let fenceIndent = "";
  let buf = [];
  let openLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!inFence && trimmed.startsWith("```")) {
      fenceIndent = line.slice(0, line.length - trimmed.length);
      const info = trimmed.slice(3).trim().split(/\s+/);
      lang = (info[0] ?? "").toLowerCase();
      label = info.slice(1).join(" ");
      inFence = true;
      buf = [];
      openLine = i + 1;
    } else if (inFence && trimmed.startsWith("```") && trimmed.trim() === "```") {
      blocks.push({ lang, label, line: openLine, body: buf.join("\n") });
      inFence = false;
    } else if (inFence) {
      const content = line.startsWith(fenceIndent) ? line.slice(fenceIndent.length) : line;
      buf.push(content);
    }
  }
  return blocks;
}

// ── Sentinel region extraction ───────────────────────────────────────────────
// Text between the first start/end sentinels, or null when absent/unterminated
// (which the caller treats as a fail-closed error).
export function extractSentinelRegion(text) {
  const start = text.indexOf(SENTINEL_START);
  if (start === -1) return null;
  const end = text.indexOf(SENTINEL_END, start + SENTINEL_START.length);
  if (end === -1) return null;
  return text.slice(start + SENTINEL_START.length, end);
}

// ── Asserted-supported derivation ────────────────────────────────────────────
// Normalize an auth-header cell (e.g. "`Authorization: Bearer`", "`x-api-key`")
// to its lowercase header NAME (the part before any ":"): authorization,
// x-api-key, x-goog-api-key.
function normalizeAuthHeader(cell) {
  return cell.replace(/`/g, "").split(":")[0].trim().toLowerCase();
}

function isTableSeparator(line) {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line);
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

// Parse the supported-providers table inside the sentinel region into
// Map<providerName, { authHeader, pathSegment }>. The path segment is derived
// ALGORITHMICALLY as the lowercased provider name (Anthropic → anthropic), not
// parsed from the unsentimented gateway-path table.
export function parseProviderTable(regionText) {
  const providers = new Map();
  for (const rawLine of regionText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || isTableSeparator(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    const provider = cells[0];
    // Skip the header row.
    if (provider.toLowerCase() === "provider") continue;
    if (!provider) continue;
    const authHeader = normalizeAuthHeader(cells[cells.length - 1]);
    if (!authHeader) continue;
    providers.set(provider, { authHeader, pathSegment: provider.toLowerCase() });
  }
  return providers;
}

// Region between the `## Install` heading and the next `## ` heading.
function installRegion(text) {
  const m = /^##\s+Install\s*$/m.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length);
  const nextHeading = after.search(/^##\s+/m);
  return nextHeading === -1 ? after : after.slice(0, nextHeading);
}

// SDK languages from the Install <CodeGroup> fence labels (Python, TypeScript),
// lowercased.
export function parseInstallLanguages(text) {
  const region = installRegion(text);
  if (region === null) return new Set();
  const langs = new Set();
  for (const b of extractFencedBlocks(region)) {
    const label = b.label.trim().toLowerCase();
    if (label) langs.add(label);
  }
  return langs;
}

// ── Documented-example derivation ────────────────────────────────────────────
// The provider a curl targets, from the first path segment of its URL, or null.
function providerFromUrl(url, providers) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const first = (pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
  if (!first) return null;
  for (const [name, info] of providers) {
    if (info.pathSegment === first) return name;
  }
  return null;
}

function curlHasHeader(headers, authHeaderName) {
  return headers.some((h) => h.split(":")[0].trim().toLowerCase() === authHeaderName);
}

// Set<providerName> covered by worked curls on a curl-bearing page. Fails closed
// if the fence extractor yields zero shell blocks.
function coveredProvidersFromCurls(file, text, providers) {
  const blocks = extractFencedBlocks(text).filter((b) => SHELL_TAGS.has(b.lang));
  if (blocks.length === 0) {
    throw new Error(`${file}: zero shell code blocks extracted — fail-closed (a dropped example or broken fence extractor must never pass vacuously).`);
  }
  const covered = new Set();
  for (const b of blocks) {
    for (const invocation of extractCurls(b.body)) {
      const parsed = parseCurl(invocation);
      if (!parsed) continue;
      const provider = providerFromUrl(parsed.url, providers);
      if (!provider) continue;
      const { authHeader } = providers.get(provider);
      if (curlHasHeader(parsed.headers, authHeader)) covered.add(provider);
    }
  }
  return covered;
}

// A recognizable SDK operation: an SDK package import or a core operation call.
// Keeps the sdk-direct coverage bar concrete — an install snippet or a
// deprecation notice alone does not satisfy it (design-review advisory).
const SDK_OPERATION = new RegExp(
  [
    "@mnemom/agent-(?:alignment|integrity)-protocol", // TS package imports
    "\\bfrom\\s+(?:aap|aip)\\s+import\\b", // Python SDK imports
    "\\b(?:verify_?[tT]race|check_?[iI]ntegrity|check_?[cC]oherence|detect_?[dD]rift|build_?[sS]ignal|trace_decision)\\b", // core ops
    "\\b(?:AlignmentCard|APTrace)\\b", // core constructors
  ].join("|"),
);

export function isSdkOperationBlock(body) {
  return SDK_OPERATION.test(body);
}

// Set<language> covered by an SDK-operation block of that language. Fails closed
// if the page yields zero code blocks.
function coveredSdkLanguages(file, text, languages) {
  const blocks = extractFencedBlocks(text);
  if (blocks.length === 0) {
    throw new Error(`${file}: zero code blocks extracted — fail-closed.`);
  }
  const covered = new Set();
  for (const lang of languages) {
    if (blocks.some((b) => b.lang === lang && isSdkOperationBlock(b.body))) {
      covered.add(lang);
    }
  }
  return covered;
}

// ── Core check (pure; exported for --self-test) ──────────────────────────────
// `pages` is { gateway, sdkDirect, selfHosted } with each = { file, text }.
// Throws (fail-closed) on a missing sentinel region, an empty asserted set, or
// zero extracted blocks on any page. Otherwise returns the computed matrix.
export function checkQuickstartMatrix({ pages }) {
  const region = extractSentinelRegion(pages.gateway.text);
  if (region === null) {
    throw new Error(
      `${pages.gateway.file}: model-coverage:supported sentinel region missing — fail-closed (cannot derive the asserted provider set).`,
    );
  }
  const providers = parseProviderTable(region);
  if (providers.size === 0) {
    throw new Error(`${pages.gateway.file}: no providers parsed from the supported-providers table — fail-closed.`);
  }

  const languages = parseInstallLanguages(pages.sdkDirect.text);
  if (languages.size === 0) {
    throw new Error(`${pages.sdkDirect.file}: no SDK languages parsed from the Install <CodeGroup> — fail-closed.`);
  }

  const documented = {
    gateway: coveredProvidersFromCurls(pages.gateway.file, pages.gateway.text, providers),
    "self-hosted": coveredProvidersFromCurls(pages.selfHosted.file, pages.selfHosted.text, providers),
    "sdk-direct": coveredSdkLanguages(pages.sdkDirect.file, pages.sdkDirect.text, languages),
  };

  // Build the asserted cell set: gateway × provider, self-hosted × provider,
  // sdk-direct × language.
  const cells = [];
  for (const [name, info] of providers) {
    for (const path of ["gateway", "self-hosted"]) {
      cells.push({
        path,
        kind: "provider",
        name,
        authHeader: info.authHeader,
        pathSegment: info.pathSegment,
        missing: `worked curl on /${info.pathSegment}/* carrying the ${info.authHeader} auth header`,
      });
    }
  }
  for (const lang of languages) {
    cells.push({
      path: "sdk-direct",
      kind: "language",
      name: lang,
      missing: `a ${lang} SDK-operation code block`,
    });
  }

  for (const cell of cells) {
    cell.covered = documented[cell.path].has(cell.name);
  }

  const uncovered = cells.filter((c) => !c.covered);
  const total = cells.length;
  const covered = total - uncovered.length;

  return { providers, languages, cells, uncovered, covered, total, ok: uncovered.length === 0 };
}

// ── Rendering ────────────────────────────────────────────────────────────────
function renderMatrix(result) {
  const rows = result.cells.map((c) => {
    const dim = c.kind === "provider" ? c.name : `${c.name} (SDK)`;
    const evidence =
      c.kind === "provider" ? `/${c.pathSegment}/* + ${c.authHeader}` : "SDK-operation block";
    return `  [${c.covered ? "✓" : "✗"}] ${c.path.padEnd(12)} ${dim.padEnd(20)} ${evidence}`;
  });
  return [
    "Quickstart coverage matrix (path × provider/language × evidence):",
    ...rows,
    `\n  covered ${result.covered}/${result.total} asserted cells`,
  ].join("\n");
}

// ── Self-test ────────────────────────────────────────────────────────────────
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

  const supported = [
    "{/* <!-- model-coverage:supported:start --> */}",
    "| Provider | Models | Auth Header |",
    "|----------|--------|-------------|",
    "| Anthropic | Claude X | `x-api-key` |",
    "| OpenAI | GPT-Y | `Authorization: Bearer` |",
    "{/* <!-- model-coverage:supported:end --> */}",
  ].join("\n");

  // (a) An INDENTED fence (4-space, inside a simulated <Step>) must be parsed —
  //     the regression guard for the column-0 fence bug.
  const indented = [
    "<Step title=\"Make an API call\">",
    "    ```bash",
    "    curl https://gateway.mnemom.ai/anthropic/v1/messages \\",
    "      -H \"x-api-key: $ANTHROPIC_API_KEY\" \\",
    "      -d '{\"model\":\"x\"}'",
    "    ```",
    "</Step>",
  ].join("\n");
  const indentedBlocks = extractFencedBlocks(indented);
  assert("indented fence parsed into a block", indentedBlocks.length === 1);
  assert(
    "indented fence body left-aligned + curl recovered",
    indentedBlocks[0].body.includes("curl https://gateway.mnemom.ai/anthropic/v1/messages"),
  );

  const sdkDirect = {
    file: "sdk-direct.mdx",
    text: [
      "## Install",
      "<CodeGroup>",
      "```bash Python",
      "pip install agent-alignment-protocol",
      "```",
      "```bash TypeScript",
      "npm install @mnemom/agent-alignment-protocol",
      "```",
      "</CodeGroup>",
      "",
      "## Usage",
      "```python Python",
      "from aap import verify_trace",
      "result = verify_trace(t, c)",
      "```",
      "```typescript TypeScript",
      "import { verifyTrace } from '@mnemom/agent-alignment-protocol';",
      "const result = verifyTrace(t, c);",
      "```",
    ].join("\n"),
  };

  // Install labels → asserted SDK-language set.
  const langs = parseInstallLanguages(sdkDirect.text);
  assert("Install <CodeGroup> labels → {python, typescript}", langs.has("python") && langs.has("typescript") && langs.size === 2);

  const gatewayCovered = {
    file: "gateway.mdx",
    text: [
      supported,
      "",
      "<Step title=\"Make an API call\">",
      "    ```bash",
      "    curl https://gateway.mnemom.ai/anthropic/v1/messages \\",
      "      -H \"x-api-key: $ANTHROPIC_API_KEY\" \\",
      "      -d '{\"model\":\"x\"}'",
      "    ```",
      "",
      "    ```bash",
      "    curl https://gateway.mnemom.ai/openai/v1/chat/completions \\",
      "      -H \"Authorization: Bearer $OPENAI_API_KEY\" \\",
      "      -d '{\"model\":\"y\"}'",
      "    ```",
      "</Step>",
    ].join("\n"),
  };
  const selfHostedCovered = {
    file: "self-hosted.mdx",
    text: [
      "<Step title=\"Connect an agent\">",
      "    ```bash",
      "    curl http://localhost:8787/anthropic/v1/messages \\",
      "      -H \"x-api-key: $ANTHROPIC_API_KEY\" \\",
      "      -d '{\"model\":\"x\"}'",
      "    ```",
      "",
      "    ```bash",
      "    curl http://localhost:8787/openai/v1/chat/completions \\",
      "      -H \"Authorization: Bearer $OPENAI_API_KEY\" \\",
      "      -d '{\"model\":\"y\"}'",
      "    ```",
      "</Step>",
    ].join("\n"),
  };

  // (c) Fully-covered mini-matrix → ok, 0 uncovered, counters correspond.
  const clean = checkQuickstartMatrix({
    pages: { gateway: gatewayCovered, sdkDirect, selfHosted: selfHostedCovered },
  });
  assert("fully-covered mini-matrix → ok", clean.ok && clean.uncovered.length === 0);
  assert("path segment derived from provider name (openai)", clean.cells.some((c) => c.pathSegment === "openai"));
  assert(
    "counter correctness: covered + uncovered === total",
    clean.covered + clean.uncovered.length === clean.total,
  );
  assert("total = providers×2 + languages", clean.total === 2 * 2 + 2);

  // (b) Auth-header mismatch/absent on a provider curl → cell flagged uncovered,
  //     exactly once.
  const selfHostedBadAuth = {
    file: "self-hosted.mdx",
    text: selfHostedCovered.text.replace(
      "Authorization: Bearer $OPENAI_API_KEY",
      "x-api-key: $OPENAI_API_KEY",
    ),
  };
  const mismatch = checkQuickstartMatrix({
    pages: { gateway: gatewayCovered, sdkDirect, selfHosted: selfHostedBadAuth },
  });
  const badCells = mismatch.uncovered.filter((c) => c.path === "self-hosted" && c.name === "OpenAI");
  assert("wrong auth header → (self-hosted, OpenAI) uncovered", !mismatch.ok && badCells.length === 1);

  // sdk-direct coverage bar: a language with only an install snippet (no SDK
  // operation) is NOT covered.
  const sdkNoTsOp = {
    file: "sdk-direct.mdx",
    text: sdkDirect.text.replace(
      ["```typescript TypeScript", "import { verifyTrace } from '@mnemom/agent-alignment-protocol';", "const result = verifyTrace(t, c);", "```"].join("\n"),
      ["```typescript TypeScript", "// deprecation notice, no SDK operation", "console.log('hi');", "```"].join("\n"),
    ),
  };
  const tsHole = checkQuickstartMatrix({
    pages: { gateway: gatewayCovered, sdkDirect: sdkNoTsOp, selfHosted: selfHostedCovered },
  });
  assert(
    "typescript block without an SDK operation → (sdk-direct, typescript) uncovered",
    !tsHole.ok && tsHole.uncovered.some((c) => c.path === "sdk-direct" && c.name === "typescript"),
  );

  // (d) Missing sentinel region → fail-closed (throws), never a vacuous pass.
  let threwOnMissingSentinel = false;
  try {
    checkQuickstartMatrix({
      pages: {
        gateway: { file: "gateway.mdx", text: "No sentinels here.\n<Step>\n  ```bash\n  curl x\n  ```\n</Step>" },
        sdkDirect,
        selfHosted: selfHostedCovered,
      },
    });
  } catch {
    threwOnMissingSentinel = true;
  }
  assert("missing sentinel region → fail-closed (throws)", threwOnMissingSentinel);

  // Fail-closed on zero shell blocks on a curl page.
  let threwOnZeroBlocks = false;
  try {
    checkQuickstartMatrix({
      pages: {
        gateway: gatewayCovered,
        sdkDirect,
        selfHosted: { file: "self-hosted.mdx", text: "Just prose, no code blocks." },
      },
    });
  } catch {
    threwOnZeroBlocks = true;
  }
  assert("zero shell blocks on a curl page → fail-closed (throws)", threwOnZeroBlocks);

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(
    [
      "Usage: check-quickstart-matrix.mjs [options]",
      "",
      "Asserts every provider × auth-header × integration-path (× SDK-language)",
      "the quickstart claims to support also ships a worked, copy-pasteable example.",
      "",
      "Options:",
      "  --root <dir>   Docs root (default: repo root, resolved from scripts/).",
      "  --print        Render the full coverage matrix to stdout.",
      "  --self-test    Run built-in fixtures and exit.",
      "  --help, -h     Show this help.",
      "",
      "Exits 0 clean; 1 on an uncovered cell / missing source region / zero",
      "extracted blocks / self-test failure; 2 on bad CLI usage.",
    ].join("\n"),
  );
}

function main() {
  const args = argv.slice(2);
  let root = resolve(scriptDir(), "..");
  let doPrint = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--self-test") exit(selfTest() ? 0 : 1);
    else if (a === "--print") doPrint = true;
    else if (a === "--root" || a === "--docs") {
      if (i + 1 >= args.length) {
        console.error(`${a} requires a path argument`);
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

  const load = (rel) => {
    const p = resolve(root, rel);
    if (!existsSync(p)) {
      console.error(`✗ check-quickstart-matrix: page not found at ${p}`);
      exit(1);
    }
    return { file: rel, text: readFileSync(p, "utf8") };
  };

  const pages = {
    gateway: load(GATEWAY_PAGE),
    sdkDirect: load(SDK_DIRECT_PAGE),
    selfHosted: load(SELF_HOSTED_PAGE),
  };

  let result;
  try {
    result = checkQuickstartMatrix({ pages });
  } catch (err) {
    console.error(`✗ check-quickstart-matrix: ${err.message}`);
    exit(1);
  }

  if (doPrint) console.log(renderMatrix(result));

  if (!result.ok) {
    console.error(`\n✗ check-quickstart-matrix: ${result.uncovered.length} uncovered cell(s):`);
    for (const c of result.uncovered) {
      const label = c.kind === "provider" ? `${c.path} × ${c.name} (${c.authHeader})` : `${c.path} × ${c.name}`;
      console.error(`    - ${label} — missing ${c.missing}`);
    }
    console.error(`\n  covered ${result.covered}/${result.total} asserted cells.`);
    exit(1);
  }

  console.log(
    `✓ check-quickstart-matrix: all ${result.total} asserted cells covered ` +
      `(${result.providers.size} provider(s) × {gateway, self-hosted} + ${result.languages.size} SDK language(s)).`,
  );
  exit(0);
}

// Run the CLI only when executed directly, not when imported (keeps the exported
// core functions unit-exercisable — no exit/print on `import`).
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
