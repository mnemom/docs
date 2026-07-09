#!/usr/bin/env node
/**
 * check-concept-fields.mjs — concept-prose API-identifier audit gate.
 *
 * Concept pages assert concrete API field/verb names in prose and inline
 * code — `bounded_actions`, `forbidden_actions`, `category`,
 * `autonomy.bounded_actions`, etc. When one of those identifiers is
 * renamed in the OpenAPI spec, the concept narrative is left asserting a
 * stale name with nothing to catch it (the exact shape of regression
 * #222, where an action field was renamed).
 *
 * This check closes that gap. A concept page opts in with a single MDX
 * comment near its top that ENUMERATES exactly the identifiers to
 * validate. The annotation is an MDX comment (not rendered by Mintlify)
 * whose payload is a comma-separated identifier list — an opening
 * `{` + slash + asterisk, then `concept-fields: bounded_actions,
 * forbidden_actions, category`, then a closing asterisk + slash + `}`.
 * See the `concept-fields:` example on any of the four annotated concept
 * pages for the exact literal syntax.
 *
 * For each opted-in page the script runs two checks:
 *
 *   1. Honesty check — every listed identifier must actually appear
 *      backticked (`identifier`) somewhere in the page body. A listed-
 *      but-absent identifier is a "stale annotation" (the manifest must
 *      not silently rot — MNE-440).
 *   2. Spec check — every listed identifier must resolve against the set
 *      of identifiers in the live OpenAPI spec (loaded via
 *      `_load-spec.mjs`, ADR-054/055). The set is built by walking
 *      `components.schemas` and collecting every `properties` key and
 *      every `enum` string value. A dotted identifier
 *      (`autonomy.bounded_actions`) resolves iff EVERY dot-separated
 *      segment is in the set.
 *
 * Sibling to (read these for the shared idiom):
 *   - `check-spec-examples.mjs` (T5-3) — validates whole fenced YAML/JSON
 *     example blocks against a component schema. This script mirrors its
 *     opt-in philosophy (`t5-3:full-example`): default off, explicit
 *     enumeration on, which keeps the check false-positive-free.
 *   - `check-doc-examples.mjs` (T5-1) — validates curl path/method/body.
 *
 * Opt-in / enumeration rationale: enumerating identifiers per page
 * (rather than scanning every backtick and maintaining an ignore-list)
 * is the strongest false-positive guard and the only design that
 * GUARANTEES a clean exit 0 on the current tree — SDK-only verbs and
 * conceptual prose terms (`verify_trace`, `hash_chain`, `action_type`,
 * confirmed absent from the committed spec) are simply never opted in.
 *
 * Head-window contract: the opt-in annotation must appear within the
 * first HEAD_LINES (40) lines of the file — place it immediately after
 * the frontmatter block. An annotation below that window is not seen and
 * the page is treated as un-annotated (skipped).
 *
 * Flat-set caveat (what a passing result does and does NOT prove):
 * dotted-segment resolution is FLAT, not structural — each segment is
 * validated independently against the single global identifier set, not
 * by following `$ref` from the parent container. For a dotted identifier
 * whose leaf segment is a common property name (e.g. `name`, `type`),
 * the check passes regardless of whether that leaf actually belongs to
 * the named parent. Structural ($ref-following) resolution is a
 * follow-up. Consequently the flat-set check is most meaningful for
 * DOMAIN-SPECIFIC identifiers (`bounded_actions`, `forbidden_actions`,
 * `category`, `autonomy`) — generic tokens like `name`/`type` (present
 * as a property in many unrelated schemas) trivially pass the spec check
 * and derive their drift signal from the honesty check (annotation-vs-
 * body), not from spec-structure coverage. Prefer specific identifiers
 * in page annotations when the goal is drift detection.
 *
 * Exit codes:
 *   0 — all opted-in identifiers resolve and all annotations are honest.
 *   1 — one or more stale identifiers OR stale annotations (each with
 *       file:line).
 *   2 — usage error / unknown flag / malformed identifier / spec
 *       unreachable or empty (fail closed — never a silent pass, MNE-442).
 */

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

import { resolveScope } from "./lib/doc-examples-extract.mjs";
import { loadSpec } from "./_load-spec.mjs";

// ── CLI ──────────────────────────────────────────────────────────────────
const args = argv.slice(2);
let scope = "concepts";
let verbose = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--scope") scope = args[++i];
  else if (args[i] === "--verbose") verbose = true;
  else if (args[i] === "--help" || args[i] === "-h") {
    console.log(
      "Usage: check-concept-fields.mjs [--scope dir|file,csv] [--verbose]",
    );
    exit(0);
  } else {
    console.error(`Unknown flag: ${args[i]}`);
    exit(2);
  }
}

// ── Constants ──────────────────────────────────────────────────────────────
// How many lines from the file head are scanned for the opt-in annotation.
// Frontmatter blocks run ~6 lines; 40 leaves generous room to place the
// annotation right after the frontmatter close.
const HEAD_LINES = 40;

// A page opts in via an MDX comment (not rendered by Mintlify). The payload
// is a comma-separated identifier list. Matched per head line, non-greedily
// up to the closing `*/}`.
const ANNOTATION_RE = /\{\/\*\s*concept-fields:\s*(.+?)\s*\*\/\}/;

// Accepted identifier grammar: snake_case, optionally dotted. Naturally
// excludes CamelCase schema names, Capitalized prose words, and phrases.
const IDENTIFIER_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

// ── Spec identifier set ────────────────────────────────────────────────────
// ADR-054/055: spec loaded from the live URL (or OPENAPI_SPEC_PATH override).
// Wrap so a fetch/read failure fails closed with a clear message (MNE-442),
// rather than a bare rejected top-level await.
let spec;
try {
  spec = await loadSpec();
} catch (err) {
  console.error(`Failed to load OpenAPI spec: ${err.message}`);
  exit(2);
}

// Recursively collect every `properties` key and every `enum` string value
// across `components.schemas` into a single Set. Guarded so a spec with no
// schemas yields a defined (empty) set rather than throwing.
function buildSpecIdentifierSet(schemas) {
  const set = new Set();
  function walk(node) {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node.properties && typeof node.properties === "object") {
      for (const key of Object.keys(node.properties)) set.add(key);
    }
    if (Array.isArray(node.enum)) {
      for (const v of node.enum) if (typeof v === "string") set.add(v);
    }
    for (const v of Object.values(node)) walk(v);
  }
  walk(schemas);
  return set;
}

const specSet = buildSpecIdentifierSet(spec.components?.schemas ?? {});

// Empty set = cold-start / spec present but no schemas. Fail closed: there
// is nothing to validate against, so exit non-zero with a clear reason
// rather than pass every identifier or silently pass (MNE-442).
if (specSet.size === 0) {
  console.error(
    "OpenAPI spec has no schema identifiers (components.schemas empty) — cannot validate concept fields.",
  );
  exit(2);
}

// ── Annotation parsing ─────────────────────────────────────────────────────
// Returns { identifiers, line } for the first `concept-fields:` annotation in
// the file head, or null if the page does not opt in. `line` is the 1-based
// line number of the annotation (used as the reporting fallback).
function readConceptFieldsAnnotation(file, source) {
  const headLines = source.split("\n").slice(0, HEAD_LINES);
  for (let i = 0; i < headLines.length; i++) {
    const m = headLines[i].match(ANNOTATION_RE);
    if (!m) continue;
    const identifiers = [];
    const seen = new Set();
    for (const token of m[1].split(",").map((t) => t.trim()).filter(Boolean)) {
      if (!IDENTIFIER_RE.test(token)) {
        console.error(
          `${file}: malformed concept-fields identifier "${token}" (expected snake_case, optionally dotted).`,
        );
        exit(2);
      }
      if (!seen.has(token)) {
        seen.add(token);
        identifiers.push(token);
      }
    }
    return { identifiers, line: i + 1 };
  }
  return null;
}

// First 1-based line on which `identifier` appears backticked, else null.
function backtickLine(source, identifier) {
  const needle = "`" + identifier + "`";
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return null;
}

// ── Scan ───────────────────────────────────────────────────────────────────
const files = resolveScope(scope);
const staleIdentifiers = []; // { file, line, identifier, segment }
const staleAnnotations = []; // { file, line, identifier }
const perPage = []; // { file, identifiers: [{ identifier, ok, resolves, honest }] }
let optedInPages = 0;
let skippedPages = 0;
let totalValidated = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const annotation = readConceptFieldsAnnotation(file, source);
  if (!annotation) {
    skippedPages++;
    continue;
  }
  optedInPages++;

  const pageIdentifiers = [];
  for (const identifier of annotation.identifiers) {
    const btLine = backtickLine(source, identifier);
    const honest = btLine !== null;
    if (!honest) {
      staleAnnotations.push({
        file,
        line: annotation.line,
        identifier,
      });
    }

    const missingSegment = identifier
      .split(".")
      .find((seg) => !specSet.has(seg));
    const resolves = missingSegment === undefined;
    if (!resolves) {
      staleIdentifiers.push({
        file,
        line: btLine ?? annotation.line,
        identifier,
        segment: missingSegment,
      });
    }

    if (honest && resolves) totalValidated++;
    pageIdentifiers.push({ identifier, ok: honest && resolves, resolves, honest });
  }
  perPage.push({ file, identifiers: pageIdentifiers });
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`Scanned ${files.length} concept file(s).`);
console.log(
  `${optedInPages} opted-in page(s); ${skippedPages} skipped (no annotation).`,
);
console.log(`Validated ${totalValidated} identifier(s) against the spec.`);

if (verbose) {
  for (const page of perPage) {
    console.log(`  ${page.file}:`);
    for (const id of page.identifiers) {
      const marker = id.ok ? "✓" : "✗";
      const detail = id.ok
        ? ""
        : ` (${!id.honest ? "not backticked in body" : ""}${!id.honest && !id.resolves ? "; " : ""}${!id.resolves ? "not in spec" : ""})`;
      console.log(`    ${marker} ${id.identifier}${detail}`);
    }
  }
}

if (staleAnnotations.length > 0) {
  console.log();
  console.log(
    `❌ ${staleAnnotations.length} stale annotation(s) — listed but not backticked in the page body:`,
  );
  for (const s of staleAnnotations) {
    console.log(`  ${s.file}:${s.line} — ${s.identifier}`);
  }
}

if (staleIdentifiers.length > 0) {
  console.log();
  console.log(
    `❌ ${staleIdentifiers.length} stale identifier(s) — not resolvable in the OpenAPI spec:`,
  );
  for (const s of staleIdentifiers) {
    console.log(
      `  ${s.file}:${s.line} — ${s.identifier} (segment "${s.segment}" not a property/enum in spec)`,
    );
  }
}

if (staleAnnotations.length === 0 && staleIdentifiers.length === 0) {
  console.log();
  console.log(
    "✓ All opted-in concept identifiers resolve in the spec and appear in their page body.",
  );
  exit(0);
}
exit(1);
