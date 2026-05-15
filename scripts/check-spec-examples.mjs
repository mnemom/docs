#!/usr/bin/env node
/**
 * check-spec-examples.mjs — T5-3 specification-page audit gate.
 *
 * For every YAML / JSON / JSONC fenced block in `specifications/*.mdx`:
 *
 *   1. Parse it (syntax check) and report any malformed example.
 *   2. If the page has a known canonical schema in
 *      `PAGE_SCHEMA` AND the example is "complete" (not a skeleton
 *      with `{ ... }` placeholders), validate it against the
 *      dereferenced schema via Ajv 2020.
 *
 * This is the docs-side equivalent of the production validator that
 * mnemom-api runs on these payloads — the same Ajv compile against
 * the same component schemas in `api-reference/openapi.json`. Skeleton
 * examples that intentionally elide sub-objects (the load-bearing
 * documentation pattern on schema pages) are detected and skipped
 * with a notice.
 *
 * Sibling to:
 *   - `check-doc-examples.mjs` (T5-1) — validates curl bodies / response
 *     examples on customer guide pages against `requestBody` /
 *     `responses[code]` schemas.
 *   - `check-openapi-drift.mjs` — validates the path-set sync between
 *     docs and mnemom-api source-of-truth.
 *
 * Exits 0 on clean. Exits 1 on parse failure or schema failure that
 * isn't on the `KNOWN_SPEC_DRIFT` allowlist.
 */

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

import {
  resolveScope,
  extractFencedBlocks,
} from "./lib/doc-examples-extract.mjs";

// ── CLI ──────────────────────────────────────────────────────────────────
const args = argv.slice(2);
let scope = "specifications";
let verbose = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--scope") scope = args[++i];
  else if (args[i] === "--verbose") verbose = true;
  else if (args[i] === "--help" || args[i] === "-h") {
    console.log("Usage: check-spec-examples.mjs [--scope dir] [--verbose]");
    exit(0);
  } else {
    console.error(`Unknown flag: ${args[i]}`);
    exit(2);
  }
}

// ── Page → canonical schema map ──────────────────────────────────────────
//
// Spec pages whose YAML/JSON examples should validate against a specific
// component schema in `api-reference/openapi.json`. Pages absent from
// this map are still scanned for syntax errors but skip schema validation.
//
// As T5-3 follow-ons add more schemas to openapi.json (or the docs side
// publishes standalone JSON Schema files for the orphan types — trust
// posture, pending advisories, team templates, agent preview), add the
// mapping here.
const PAGE_SCHEMA = {
  "specifications/alignment-card-schema.mdx": "UnifiedAlignmentCard",
  "specifications/protection-card-schema.mdx": "UnifiedProtectionCard",
};

// ── Known-drift allowlist ────────────────────────────────────────────────
//
// Same shape as KNOWN_DRIFT in check-doc-examples. Each entry matches a
// (file, exampleStartLine, errorKeyword) tuple. Skeleton-style examples
// are detected and skipped automatically — this allowlist is for real
// validation failures that we know about and intend to fix in a follow-on
// (typically T5-3 v2 when a schema gets published).
const KNOWN_SPEC_DRIFT = [];

function knownDriftEntry(file, line, keyword) {
  return KNOWN_SPEC_DRIFT.find(
    (e) => e.file === file && e.line === line && e.keyword === keyword,
  );
}

// ── Ajv + deref ──────────────────────────────────────────────────────────
const spec = JSON.parse(readFileSync("api-reference/openapi.json", "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

function derefRef(refStr, root) {
  if (!refStr.startsWith("#/")) return null;
  const segs = refStr.slice(2).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = root;
  for (const s of segs) {
    if (cur == null) return null;
    cur = cur[s];
  }
  return cur ?? null;
}
function deref(node, root) {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => deref(n, root));
  if (typeof node.$ref === "string") {
    const target = derefRef(node.$ref, root);
    return target == null ? node : deref(target, root);
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(v, root);
  return out;
}

const validatorCache = new Map();
function getSchemaValidator(schemaName) {
  if (validatorCache.has(schemaName)) return validatorCache.get(schemaName);
  const schema = spec.components?.schemas?.[schemaName];
  if (!schema) {
    validatorCache.set(schemaName, null);
    return null;
  }
  let v;
  try {
    v = ajv.compile(deref(schema, spec));
  } catch (err) {
    v = { __compileError: err.message };
  }
  validatorCache.set(schemaName, v);
  return v;
}

// ── Annotation-driven validation control ─────────────────────────────────
//
// Spec pages use fenced YAML/JSON blocks for three different purposes:
//
//   1. Full canonical examples — should validate against the page's
//      schema. Opt in via a `# t5-3:full-example` (YAML) or
//      `// t5-3:full-example` (JSON) comment on the first line. Optionally
//      override the schema: `# t5-3:full-example=CustomSchemaName`.
//
//   2. Partial-section / illustrative skeletons — show one sub-object's
//      structure with `{ ... }` placeholders elsewhere, or use literal
//      `<uuid>` / `${VAR}` strings. The walker parses these for syntax
//      but skips schema validation.
//
//   3. Pseudo-schema notation — uses `|` for enum alternatives or other
//      shapes that aren't strict YAML/JSON. Opt out via
//      `# t5-3:skip-parse` (YAML) or `// t5-3:skip-parse` (JSON) on the
//      first line.
//
// Default (no annotation): parse-check only. Today's state: zero
// examples opt in to schema validation; subsequent T5-3 follow-ons add
// `t5-3:full-example` annotations to canonical examples one at a time,
// burning down whatever validation drift surfaces.
// Annotations match anywhere on the line after the comment marker, so
// authors can add a free-text trailing rationale: `# t5-3:skip-parse — pseudo-schema`.
const FULL_RE = /^\s*(?:#|\/\/)\s*t5-3:full-example(?:=(\w+))?(?:\s|$)/;
const SKIP_PARSE_RE = /^\s*(?:#|\/\/)\s*t5-3:skip-parse(?:\s|$)/;

function readAnnotations(raw) {
  const firstLines = raw.split("\n").slice(0, 3);
  let fullExample = null;
  let skipParse = false;
  for (const line of firstLines) {
    const m = line.match(FULL_RE);
    if (m) fullExample = { schemaOverride: m[1] ?? null };
    if (SKIP_PARSE_RE.test(line)) skipParse = true;
  }
  return { fullExample, skipParse };
}

// State-aware JSONC comment stripper: removes `//` line comments and
// `/* block */` comments while preserving content inside `"..."` strings
// (so `"https://..."` survives intact).
function stripJsoncComments(s) {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      if (c === "\\" && i + 1 < s.length) {
        out += c + s[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function looksSkeleton(raw, type) {
  if (raw.includes("{ ... }")) return true;
  if (raw.includes("<uuid>")) return true;
  if (/\$\{[A-Z_][A-Z0-9_]*\}/.test(raw)) return true;
  if (type === "json" && raw.includes('"..."')) return true;
  return false;
}

// ── Parse + validate ─────────────────────────────────────────────────────
const files = resolveScope(scope);
const parseFailures = [];
const validationFailures = [];
const knownDrift = [];
const skeletonCount = new Map();
const passCount = new Map();
let totalBlocks = 0;
let totalValidated = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const block of extractFencedBlocks(source)) {
    const lang = (block.tag || "").toLowerCase();
    const isYaml = lang === "yaml";
    const isJson = lang === "json" || lang === "jsonc";
    if (!isYaml && !isJson) continue;
    totalBlocks++;

    const annotations = readAnnotations(block.body);

    // Skip parse check for explicit pseudo-schema notation.
    if (annotations.skipParse) {
      skeletonCount.set(file, (skeletonCount.get(file) ?? 0) + 1);
      continue;
    }

    // Skeleton-shaped JSON / YAML (containing `{ ... }`, `<uuid>`, etc.)
    // would fail parse; recognize before attempting it. Schema validation
    // is by definition off for skeletons (they wouldn't validate anyway).
    if (!annotations.fullExample && looksSkeleton(block.body, lang)) {
      skeletonCount.set(file, (skeletonCount.get(file) ?? 0) + 1);
      continue;
    }

    // Strip annotation lines + JSONC `// comment` + `/* block */` for
    // clean parsing. JSONC stripping is string-aware so `//` inside
    // URL string values ("https://...") survives.
    let raw = block.body
      .replace(FULL_RE, "")
      .replace(SKIP_PARSE_RE, "");
    if (lang === "jsonc") raw = stripJsoncComments(raw);

    let value;
    try {
      value = isYaml ? parseYaml(raw) : JSON.parse(raw);
    } catch (err) {
      parseFailures.push({ file, line: block.line, lang, error: err.message });
      continue;
    }

    // Schema validation is opt-in via annotation. Without the
    // `t5-3:full-example` marker, we stop at parse-check.
    if (!annotations.fullExample) {
      if (looksSkeleton(block.body, lang)) {
        skeletonCount.set(file, (skeletonCount.get(file) ?? 0) + 1);
      } else {
        passCount.set(file, (passCount.get(file) ?? 0) + 1);
      }
      continue;
    }

    const schemaName = annotations.fullExample.schemaOverride ?? PAGE_SCHEMA[file];
    if (!schemaName) {
      parseFailures.push({
        file,
        line: block.line,
        lang,
        error: `t5-3:full-example annotation present but no schema available — add a schemaOverride or map this file in PAGE_SCHEMA`,
      });
      continue;
    }

    const validator = getSchemaValidator(schemaName);
    if (!validator) {
      console.error(`Schema ${schemaName} not found in openapi.json — fix PAGE_SCHEMA mapping`);
      exit(2);
    }
    if (validator.__compileError) {
      console.error(`Schema ${schemaName} failed to compile: ${validator.__compileError}`);
      exit(2);
    }
    totalValidated++;
    const ok = validator(value);
    if (ok) {
      passCount.set(file, (passCount.get(file) ?? 0) + 1);
    } else {
      for (const e of validator.errors ?? []) {
        const allow = knownDriftEntry(file, block.line, e.keyword);
        const entry = {
          file,
          line: block.line,
          schema: schemaName,
          keyword: e.keyword,
          instancePath: e.instancePath || "(root)",
          schemaPath: e.schemaPath,
          message: e.message ?? "",
          allowKey: allow ? `${allow.file}|${allow.line}|${allow.keyword}` : null,
        };
        if (allow) knownDrift.push(entry);
        else validationFailures.push(entry);
      }
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────
console.log(`Scanned ${files.length} spec file(s).`);
console.log(`Extracted ${totalBlocks} YAML/JSON example block(s).`);
console.log(`Validated ${totalValidated} against canonical schemas; ${[...skeletonCount.values()].reduce((a, b) => a + b, 0)} skeletons skipped.`);

if (verbose) {
  for (const file of files) {
    const passes = passCount.get(file) ?? 0;
    const skeletons = skeletonCount.get(file) ?? 0;
    const schema = PAGE_SCHEMA[file] ?? "(no schema mapping)";
    console.log(`  ${file}: ${passes} ✓ + ${skeletons} skeleton  [${schema}]`);
  }
}

if (parseFailures.length > 0) {
  console.log();
  console.log(`❌ ${parseFailures.length} parse failure(s):`);
  for (const f of parseFailures) {
    console.log(`  ${f.file}:${f.line} [${f.lang}] — ${f.error}`);
  }
}

if (validationFailures.length > 0) {
  console.log();
  console.log(`❌ ${validationFailures.length} schema validation failure(s):`);
  for (const f of validationFailures) {
    console.log(`  ${f.file}:${f.line} [${f.schema}]`);
    console.log(`    ${f.keyword} at ${f.instancePath} — ${f.message}`);
    console.log(`    schemaPath=${f.schemaPath}`);
  }
}

if (knownDrift.length > 0) {
  console.log();
  console.log(`Known spec drift (allowlisted): ${knownDrift.length}`);
  for (const f of knownDrift) {
    console.log(`  ${f.file}:${f.line} [${f.schema}] ${f.keyword}`);
  }
}

const seenTuples = new Set(knownDrift.map((d) => d.allowKey).filter(Boolean));
const stale = KNOWN_SPEC_DRIFT.filter(
  (e) => !seenTuples.has(`${e.file}|${e.line}|${e.keyword}`),
);
if (stale.length > 0) {
  console.log();
  console.log(`⚠ ${stale.length} stale KNOWN_SPEC_DRIFT entr${stale.length === 1 ? "y" : "ies"} — remove from scripts/check-spec-examples.mjs.`);
}

if (parseFailures.length === 0 && validationFailures.length === 0 && stale.length === 0) {
  console.log();
  console.log("✓ All spec examples parse cleanly; all schema-validated examples pass.");
  exit(0);
}
exit(1);
