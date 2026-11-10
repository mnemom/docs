#!/usr/bin/env node
// scripts/sync-code-facts.mjs: refresh (or verify) the vendored code facts (MNE-9916).
//
// mnemom-api and mnemom-platform are PRIVATE, so docs CI cannot read their
// generated code-facts.json files with the default GITHUB_TOKEN. Instead the
// facts are vendored: this script merges both files into
// scripts/code-facts-snapshot.json, which is committed. Annotated pages are then
// checked against that file offline on every PR (scripts/check-code-facts.mjs).
//
// Usage:
//   node scripts/sync-code-facts.mjs --api-file <path> --platform-file <path> --ref <label>
//       Build the snapshot from local files (e.g. checkouts of both repos).
//       --ref records where they came from (a branch, sha, or PR). --api-ref and
//       --platform-ref label one source each instead.
//   node scripts/sync-code-facts.mjs [--ref <git ref>] [--api-ref <ref>] [--platform-ref <ref>]
//       Fetch both files through the GitHub API (main unless a ref is given,
//       the per-repo flags win over --ref, e.g. to read two open PR branches).
//       Needs a token that can read both repos in GH_TOKEN or GITHUB_TOKEN.
//   node scripts/sync-code-facts.mjs --check [same ref flags]
//       Fetch both files and write nothing. Exit 1 if a fact was added,
//       removed, or changed its value, source, or symbol since the snapshot was
//       written. This is what the scheduled workflow runs.
//
// Exit codes: 0 ok, 1 drift, 2 usage / fetch / parse error.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SOURCES, buildSnapshot, diffFacts, serializeSnapshot, validateSnapshot } from "./lib/code-facts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "scripts", "code-facts-snapshot.json");
const FLAG = { "mnemom/mnemom-api": "--api", "mnemom/mnemom-platform": "--platform" };

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) usage(`${name} needs a value`);
  return v;
}

function usage(msg) {
  process.stderr.write(`sync-code-facts: ${msg}\n`);
  process.exit(2);
}

async function fetchFile(repo, path, ref) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) usage(`reading ${repo} needs a token in GH_TOKEN or GITHUB_TOKEN`);
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
    headers: {
      accept: "application/vnd.github.raw",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "mnemom-docs-sync-code-facts",
    },
  });
  if (res.status === 404) usage(`${path} not found on ${repo}@${ref}`);
  if (!res.ok) usage(`GET ${repo}/${path}@${ref} -> ${res.status}`);
  return res.text();
}

async function load() {
  const ref = arg("--ref");
  const local = SOURCES.map((s) => arg(`${FLAG[s.repo]}-file`));
  if (local.some(Boolean)) {
    if (!local.every(Boolean)) usage("--api-file and --platform-file go together");
    const refs = SOURCES.map((s) => arg(`${FLAG[s.repo]}-ref`) || ref);
    if (!refs.every(Boolean)) usage("local files need --ref <label> (or --api-ref and --platform-ref) to record where they came from");
    return SOURCES.map((source, i) => ({ source, ref: refs[i], doc: JSON.parse(readFileSync(resolve(local[i]), "utf8")) }));
  }
  const out = [];
  for (const source of SOURCES) {
    const live = arg(`${FLAG[source.repo]}-ref`) || ref || "main";
    out.push({ source, ref: live, doc: JSON.parse(await fetchFile(source.repo, source.path, live)) });
  }
  return out;
}

async function main() {
  const snap = buildSnapshot(await load());
  if (!process.argv.includes("--check")) {
    writeFileSync(SNAPSHOT, serializeSnapshot(snap));
    process.stderr.write(`sync-code-facts: wrote ${SNAPSHOT} (${Object.keys(snap.facts).length} facts)\n`);
    return;
  }
  const committed = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  validateSnapshot(committed);
  const drift = diffFacts(committed.facts, snap.facts);
  const where = snap.sources.map((s) => `${s.repo}:${s.path}@${s.ref}`).join(", ");
  if (drift.length) {
    for (const d of drift) process.stderr.write(`::error::${d}\n`);
    process.stderr.write(
      `sync-code-facts: scripts/code-facts-snapshot.json is stale against ${where}. ` +
        "Re-run `node scripts/sync-code-facts.mjs`, then `npm run check:code-facts`, and fix any page it flags.\n",
    );
    process.exit(1);
  }
  process.stderr.write(`sync-code-facts: snapshot matches ${where}\n`);
}

try {
  await main();
} catch (e) {
  usage(e.message);
}
