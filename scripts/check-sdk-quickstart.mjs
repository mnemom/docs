#!/usr/bin/env node
/**
 * check-sdk-quickstart.mjs — SDK quickstart trace-verification integrity check.
 *
 * Parses the SDK-direct quickstart pages (en, es, fr) and asserts that:
 *   1. Every AlignmentCard snippet declares a bounded_actions list.
 *   2. Every APTrace snippet declares an action.name.
 *   3. The action.name value is present in the bounded_actions list.
 *
 * This gate prevents the regression from issue #222: action.name set to a
 * string not in bounded_actions causes verify_trace() to return verified=False
 * on the documented happy-path example (both SDKs match action.name, not
 * action.type, against bounded_actions).
 *
 * Exits 0 when all checks pass. Exits 1 with a per-file report on failures.
 */

import { readFileSync } from "node:fs";
import { exit } from "node:process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const TARGETS = [
  "quickstart/sdk-direct.mdx",
  "es/quickstart/sdk-direct.mdx",
  "fr/quickstart/sdk-direct.mdx",
];

// Extract all fenced code blocks from MDX source, keyed by language tag.
// Handles indented fences (e.g. inside <Step> / <CodeGroup> MDX components).
function extractFencedBlocks(source) {
  const blocks = [];
  const lines = source.split("\n");
  let inFence = false;
  let lang = "";
  let fenceIndent = "";
  let buf = [];
  let openLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!inFence && trimmed.startsWith("```")) {
      fenceIndent = line.slice(0, line.length - trimmed.length);
      lang = trimmed.slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      inFence = true;
      buf = [];
      openLine = i + 1;
    } else if (inFence && trimmed.startsWith("```") && trimmed.trim() === "```") {
      blocks.push({ lang, line: openLine, body: buf.join("\n") });
      inFence = false;
    } else if (inFence) {
      // Strip the common indentation prefix so content is left-aligned.
      const content = line.startsWith(fenceIndent)
        ? line.slice(fenceIndent.length)
        : line;
      buf.push(content);
    }
  }
  return blocks;
}

// Parse a bracketed list of quoted strings, e.g. `["a", "b", 'c']`.
function parseStringList(raw) {
  return [...raw.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

let failures = 0;

for (const rel of TARGETS) {
  const filePath = join(ROOT, rel);
  let src;
  try {
    src = readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`FAIL ${rel}: cannot read file — ${e.message}`);
    failures++;
    continue;
  }

  const blocks = extractFencedBlocks(src);
  const pyBlocks = blocks.filter((b) => b.lang === "python");
  const tsBlocks = blocks.filter((b) => b.lang === "typescript");

  for (const [label, langBlocks, baPattern, anPattern] of [
    [
      "Python",
      pyBlocks,
      // bounded_actions=["search", "compare", ...]
      /bounded_actions\s*=\s*\[([^\]]+)\]/,
      // name="recommend" inside an Action(...) call
      /\bname\s*=\s*["']([^"']+)["']/,
    ],
    [
      "TypeScript",
      tsBlocks,
      // bounded_actions: ['search', 'compare', ...]
      /bounded_actions\s*:\s*\[([^\]]+)\]/,
      // name: 'recommend' inside an action: { ... } object
      /\bname\s*:\s*['"]([^'"]+)['"]/,
    ],
  ]) {
    // Identify blocks by their structural role.
    const cardBlock = langBlocks.find((b) => b.body.includes("AlignmentCard"));
    const traceBlock = langBlocks.find((b) => b.body.includes("APTrace"));

    if (!cardBlock) {
      console.error(`FAIL ${rel} [${label}]: no AlignmentCard block found`);
      failures++;
      continue;
    }
    if (!traceBlock) {
      console.error(`FAIL ${rel} [${label}]: no APTrace block found`);
      failures++;
      continue;
    }

    const baMatch = baPattern.exec(cardBlock.body);
    if (!baMatch) {
      console.error(
        `FAIL ${rel} [${label}]: bounded_actions list not found in AlignmentCard block (line ${cardBlock.line})`,
      );
      failures++;
      continue;
    }
    const boundedActions = parseStringList(baMatch[1]);
    if (boundedActions.length === 0) {
      console.error(
        `FAIL ${rel} [${label}]: bounded_actions list is empty (line ${cardBlock.line})`,
      );
      failures++;
      continue;
    }

    const anMatch = anPattern.exec(traceBlock.body);
    if (!anMatch) {
      console.error(
        `FAIL ${rel} [${label}]: action.name not found in APTrace block (line ${traceBlock.line})`,
      );
      failures++;
      continue;
    }
    const actionName = anMatch[1];

    if (!boundedActions.includes(actionName)) {
      console.error(
        `FAIL ${rel} [${label}]: action.name="${actionName}" not in bounded_actions: ` +
          `[${boundedActions.map((s) => `"${s}"`).join(", ")}] — ` +
          `verify_trace() will return verified=False on this example`,
      );
      failures++;
    } else {
      console.log(
        `PASS ${rel} [${label}]: action.name="${actionName}" is in bounded_actions`,
      );
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  exit(1);
} else {
  console.log("\nAll SDK quickstart trace checks passed.");
  exit(0);
}
