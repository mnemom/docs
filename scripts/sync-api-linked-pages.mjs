#!/usr/bin/env node
// scripts/sync-api-linked-pages.mjs: refresh (or verify) scripts/api-linked-pages.json (MNE-10095).
//
// mnemom-api is PRIVATE, so docs CI cannot read it with the default
// GITHUB_TOKEN. The list of docs pages its Org Scan report links is vendored
// instead: this script reads the api files named in SOURCES
// (scripts/lib/api-linked-pages.mjs), keeps every https://docs.mnemom.ai/<page>
// link in them, and writes the list. scripts/check-api-linked-pages.mjs then
// checks the list against the docs tree offline on every PR.
//
// Usage:
//   node scripts/sync-api-linked-pages.mjs --api-dir <path> --ref <label>
//       Build the list from a local mnemom-api checkout. --ref records where it
//       came from (a branch, sha, or PR).
//   node scripts/sync-api-linked-pages.mjs [--ref <git ref>]
//       Fetch the files through the GitHub API (main unless a ref is given).
//       Needs a token that can read mnemom-api in GH_TOKEN or GITHUB_TOKEN.
//   node scripts/sync-api-linked-pages.mjs --check [same flags]
//       Write nothing. Exit 1 if the api links a page the list does not hold,
//       or the list holds one the api no longer links. This is what the
//       scheduled workflow runs.
//
// Exit codes: 0 ok, 1 drift, 2 usage / fetch / parse error.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { API_REPO, SOURCES, buildList, diffLists, serializeList, validateList } from "./lib/api-linked-pages.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIST = process.env.API_LINKED_PAGES_LIST || join(ROOT, "scripts", "api-linked-pages.json");

function usage(msg) {
  process.stderr.write(`sync-api-linked-pages: ${msg}\n`);
  process.exit(2);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) usage(`${name} needs a value`);
  return v;
}

async function fetchFile(path, ref) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) usage(`reading ${API_REPO} needs a token in GH_TOKEN or GITHUB_TOKEN`);
  const res = await fetch(`https://api.github.com/repos/${API_REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
    headers: {
      accept: "application/vnd.github.raw",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "mnemom-docs-sync-api-linked-pages",
    },
  });
  if (res.status === 404) usage(`${path} not found on ${API_REPO}@${ref}`);
  if (!res.ok) usage(`GET ${API_REPO}/${path}@${ref} -> ${res.status}`);
  return res.text();
}

async function load() {
  const dir = arg("--api-dir");
  const ref = arg("--ref");
  if (dir) {
    if (!ref) usage("--api-dir needs --ref <label> to record where the files came from");
    return { ref, inputs: SOURCES.map((path) => ({ path, text: readFileSync(resolve(dir, path), "utf8") })) };
  }
  const live = ref || "main";
  const inputs = [];
  for (const path of SOURCES) inputs.push({ path, text: await fetchFile(path, live) });
  return { ref: live, inputs };
}

async function main() {
  const { ref, inputs } = await load();
  const list = buildList(inputs, ref);
  if (!process.argv.includes("--check")) {
    writeFileSync(LIST, serializeList(list));
    process.stderr.write(`sync-api-linked-pages: wrote ${LIST} (${Object.keys(list.pages).length} pages)\n`);
    return;
  }
  const committed = JSON.parse(readFileSync(LIST, "utf8"));
  validateList(committed);
  const drift = diffLists(committed, list);
  if (drift.length) {
    for (const d of drift) process.stderr.write(`::error::${d}\n`);
    process.stderr.write(
      `sync-api-linked-pages: scripts/api-linked-pages.json is stale against ${API_REPO}@${ref}. ` +
        "Re-run `node scripts/sync-api-linked-pages.mjs`, then `npm run check:api-linked-pages`.\n",
    );
    process.exit(1);
  }
  process.stderr.write(`sync-api-linked-pages: list matches ${API_REPO}@${ref}\n`);
}

try {
  await main();
} catch (e) {
  usage(e.message);
}
