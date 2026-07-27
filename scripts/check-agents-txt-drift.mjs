#!/usr/bin/env node
/**
 * check-agents-txt-drift.mjs — drift gate between agents.txt and for-agents/index.mdx.
 *
 * Launch commitment #8 (documented in AGENTS.md and for-agents/index.mdx) is that
 * docs.mnemom.ai exposes machine-readable agent surfaces including agents.txt at the
 * docs root. This script keeps those two artifacts in sync.
 *
 * It checks two directions:
 *   1. agents.txt → for-agents: every URL in agents.txt Key: URL lines must appear
 *      somewhere in for-agents/index.mdx. A URL present in agents.txt but absent from
 *      the for-agents page is a stale entry (undocumented surface claim).
 *   2. for-agents anchors → agents.txt: every URL in the "## Machine-readable anchors"
 *      section of for-agents/index.mdx must appear in agents.txt. A machine-readable
 *      surface documented for agents but absent from agents.txt is a drift finding.
 *
 * Exit contract:
 *   0 — no drift findings
 *   1 — one or more drift findings (or file read error)
 *   2 — bad CLI usage
 *
 * Flags:
 *   --agents-txt <path>   Path to agents.txt (default: <repo-root>/agents.txt)
 *   --for-agents <path>   Path to for-agents/index.mdx (default: <repo-root>/for-agents/index.mdx)
 *   --self-test           Run in-memory fixture tests, no disk reads
 *
 * Advisory (MNE-414): if the "## Machine-readable anchors" heading is renamed or removed,
 * the script emits a WARNING to stderr and exits 0 (no false positives), making the empty
 * section visible rather than silently passing.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = argv.slice(2);
let selfTest = false;
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
let agentsTxtPath = resolve(repoRoot, 'agents.txt');
let forAgentsPath = resolve(repoRoot, 'for-agents/index.mdx');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--self-test') {
    selfTest = true;
  } else if (args[i] === '--agents-txt') {
    if (i + 1 >= args.length) {
      console.error('--agents-txt requires a path argument');
      exit(2);
    }
    agentsTxtPath = args[++i];
  } else if (args[i] === '--for-agents') {
    if (i + 1 >= args.length) {
      console.error('--for-agents requires a path argument');
      exit(2);
    }
    forAgentsPath = args[++i];
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(
      'Usage: check-agents-txt-drift.mjs [--agents-txt <path>] [--for-agents <path>] [--self-test]',
    );
    exit(0);
  } else {
    console.error(`Unknown flag: ${args[i]}`);
    exit(2);
  }
}

// ── Pure helpers (used by both live check and --self-test) ───────────────────

/**
 * Extract https:// URLs from Key: URL lines in agents.txt content.
 * Comment lines (starting with #) and blank lines are ignored.
 */
function parseAgentsTxt(content) {
  const urls = new Set();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    const match = trimmed.match(/^[A-Za-z0-9_-]+:\s+(https?:\/\/\S+)$/);
    if (match) urls.add(match[1]);
  }
  return urls;
}

/**
 * Extract ALL https:// URLs appearing anywhere in for-agents/index.mdx content.
 * Used for direction 1 (stale-entry check): agents.txt URLs must appear somewhere here.
 */
function parseForAgentsAllUrls(content) {
  const urls = new Set();
  const urlRegex = /https:\/\/[^\s"'()<>[\]`]+/g;
  let m;
  while ((m = urlRegex.exec(content)) !== null) {
    urls.add(m[0].replace(/[.,;:!?]+$/, ''));
  }
  return urls;
}

/**
 * Extract https:// URLs ONLY from the "## Machine-readable anchors" section of
 * for-agents/index.mdx (lines between that heading and the next ## heading).
 * Used for direction 2 (missing-entry check): anchor URLs must appear in agents.txt.
 */
function parseForAgentsAnchorUrls(content) {
  const urls = new Set();
  const lines = content.split('\n');
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+Machine-readable anchors/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s/.test(line)) {
      break;
    }
    if (inSection) {
      const urlMatch = line.match(/https:\/\/[^\s"'()<>[\]`]+/);
      if (urlMatch) {
        urls.add(urlMatch[0].replace(/[.,;:!?]+$/, ''));
      }
    }
  }
  return urls;
}

/**
 * Cross-check agents.txt against for-agents/index.mdx.
 * Returns { stale, missing, agentsCount, anchorCount }.
 *   stale:       URLs in agents.txt that do not appear anywhere in for-agents
 *   missing:     URLs in Machine-readable anchors section absent from agents.txt
 *   agentsCount: number of Key: URL entries in agents.txt
 *   anchorCount: number of URLs found in the Machine-readable anchors section
 */
function checkDrift(agentsTxtContent, forAgentsContent) {
  const agentsUrls = parseAgentsTxt(agentsTxtContent);
  const forAgentsAllUrls = parseForAgentsAllUrls(forAgentsContent);
  const anchorUrls = parseForAgentsAnchorUrls(forAgentsContent);

  const stale = [];
  for (const url of agentsUrls) {
    if (!forAgentsAllUrls.has(url)) {
      stale.push(url);
    }
  }

  const missing = [];
  for (const url of anchorUrls) {
    if (!agentsUrls.has(url)) {
      missing.push(url);
    }
  }

  return { stale, missing, agentsCount: agentsUrls.size, anchorCount: anchorUrls.size };
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Exercises the pure helpers above against in-memory fixtures — no disk reads.
// Follows the same pattern as check-redirects.mjs: prints ✓/✗ per assertion,
// exits non-zero on any failure.
function runSelfTest() {
  let pass = 0;
  let total = 0;
  const assert = (name, cond) => {
    total++;
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      console.error(`  ✗ ${name}`);
    }
  };

  // 1) Clean pair (no drift) → 0 findings.
  {
    const agentsTxt = [
      '# agents.txt',
      'Agents-txt: https://docs.example.com/agents.txt',
      'Openapi: https://api.example.com/openapi.json',
    ].join('\n');
    const forAgents = [
      '## Machine-readable anchors',
      '- agents.txt: https://docs.example.com/agents.txt',
      '- OpenAPI spec: https://api.example.com/openapi.json',
    ].join('\n');
    const r = checkDrift(agentsTxt, forAgents);
    assert('clean pair → 0 stale', r.stale.length === 0);
    assert('clean pair → 0 missing', r.missing.length === 0);
    assert('clean pair → agentsCount 2', r.agentsCount === 2);
    assert('clean pair → anchorCount 2', r.anchorCount === 2);
  }

  // 2) agents.txt has a URL not in for-agents → stale entry detected.
  {
    const agentsTxt = [
      'Agents-txt: https://docs.example.com/agents.txt',
      'Stale: https://docs.example.com/stale-url',
    ].join('\n');
    const forAgents = [
      '## Machine-readable anchors',
      '- https://docs.example.com/agents.txt',
    ].join('\n');
    const r = checkDrift(agentsTxt, forAgents);
    assert('stale entry → 1 stale finding', r.stale.length === 1);
    assert('stale entry → correct URL flagged', r.stale[0] === 'https://docs.example.com/stale-url');
    assert('stale entry → 0 missing', r.missing.length === 0);
  }

  // 3) for-agents anchors section has URL absent from agents.txt → missing entry detected.
  {
    const agentsTxt = [
      'Agents-txt: https://docs.example.com/agents.txt',
    ].join('\n');
    const forAgents = [
      '## Machine-readable anchors',
      '- Docs agents.txt: https://docs.example.com/agents.txt',
      '- OpenAPI spec: https://api.example.com/openapi.json',
    ].join('\n');
    const r = checkDrift(agentsTxt, forAgents);
    assert('missing entry → 0 stale', r.stale.length === 0);
    assert('missing entry → 1 missing finding', r.missing.length === 1);
    assert('missing entry → correct URL flagged', r.missing[0] === 'https://api.example.com/openapi.json');
  }

  // 4) Empty anchors section → 0 findings (no false positive).
  //    The agents.txt URL appears in the "other section" of for-agents, so it
  //    is not stale. The anchors section is empty so no missing entries either.
  {
    const agentsTxt = [
      'Agents-txt: https://docs.example.com/agents.txt',
    ].join('\n');
    const forAgents = [
      '## Machine-readable anchors',
      '',
      '## Some other section',
      'Text with https://docs.example.com/agents.txt here',
    ].join('\n');
    const r = checkDrift(agentsTxt, forAgents);
    assert('empty anchors section → 0 missing (no false positive)', r.missing.length === 0);
    assert('empty anchors section → 0 stale (URL appears in other section)', r.stale.length === 0);
    assert('empty anchors section → anchorCount 0', r.anchorCount === 0);
  }

  // 5) Comment lines and blank lines in agents.txt are ignored (not treated as URLs).
  {
    const agentsTxt = [
      '# This is a comment with https://comment.example.com/url',
      '',
      'Real: https://docs.example.com/agents.txt',
    ].join('\n');
    const forAgents = [
      '## Machine-readable anchors',
      '- https://docs.example.com/agents.txt',
    ].join('\n');
    const r = checkDrift(agentsTxt, forAgents);
    assert('comment URLs ignored → agentsCount 1', r.agentsCount === 1);
    assert('comment URLs ignored → 0 stale', r.stale.length === 0);
  }

  console.log(`\nself-test: ${pass}/${total} assertions passed`);
  return pass === total;
}

// --self-test short-circuits BEFORE any disk reads.
if (selfTest) exit(runSelfTest() ? 0 : 1);

// ── Live check ───────────────────────────────────────────────────────────────
let agentsTxtContent, forAgentsContent;
try {
  agentsTxtContent = readFileSync(agentsTxtPath, 'utf8');
} catch (err) {
  console.error(`✗ Could not read agents.txt at ${agentsTxtPath}: ${err.message}`);
  exit(1);
}
try {
  forAgentsContent = readFileSync(forAgentsPath, 'utf8');
} catch (err) {
  console.error(`✗ Could not read for-agents page at ${forAgentsPath}: ${err.message}`);
  exit(1);
}

const { stale, missing, agentsCount, anchorCount } = checkDrift(
  agentsTxtContent,
  forAgentsContent,
);

// Advisory (MNE-414): warn if anchors section is empty — heading may have been renamed.
if (anchorCount === 0) {
  console.warn(
    'WARNING: no URLs found in Machine-readable anchors section — heading may have changed',
  );
}

const findings = [];
for (const url of stale) {
  findings.push(
    `stale entry: "${url}" is in agents.txt but does not appear in for-agents/index.mdx`,
  );
}
for (const url of missing) {
  findings.push(
    `missing entry: "${url}" is in the Machine-readable anchors section of for-agents/index.mdx but absent from agents.txt`,
  );
}

if (findings.length > 0) {
  console.error(`\n✗ check-agents-txt-drift: ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  - ${f}`);
  exit(1);
}

console.log(
  `✓ check-agents-txt-drift: ${agentsCount} agents.txt URL(s), ${anchorCount} anchor URL(s), no drift.`,
);
exit(0);
