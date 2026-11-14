#!/usr/bin/env node
// scripts/check-api-linked-pages.mjs: pages mnemom-api links must still resolve (MNE-10095).
//
// Offline and secret-free, so it runs on every PR (including forks). It reads
// scripts/api-linked-pages.json, the vendored list of docs pages the Org Scan
// report links, and fails when a listed page has no page file and no redirect
// in docs.json that ends at one. See scripts/lib/api-linked-pages.mjs for the
// two lists and how each is refreshed.
//
// Whether the list still matches mnemom-api main is a separate, token-gated
// check: `node scripts/sync-api-linked-pages.mjs --check`.
//
// Env overrides (used by the self-test): API_LINKED_PAGES_ROOT (docs root, holds
// docs.json and the pages), API_LINKED_PAGES_LIST (list path).
//
// Exit codes: 0 every page resolves, 1 a page does not, 2 a malformed list or
// docs.json.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkPages, validateList } from "./lib/api-linked-pages.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.API_LINKED_PAGES_ROOT || REPO;
const LIST = process.env.API_LINKED_PAGES_LIST || join(REPO, "scripts", "api-linked-pages.json");

try {
  const list = JSON.parse(readFileSync(LIST, "utf8"));
  validateList(list);
  const docs = JSON.parse(readFileSync(join(ROOT, "docs.json"), "utf8"));
  const problems = checkPages(list, docs, ROOT);
  if (problems.length) {
    process.stderr.write(`check-api-linked-pages: ${problems.length} page(s) mnemom-api links would not resolve:\n`);
    for (const p of problems) process.stderr.write(`::error::${p}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `check-api-linked-pages: ${Object.keys(list.pages).length} page(s) linked by ${list.repo}@${list.ref} resolve\n`,
  );
} catch (e) {
  process.stderr.write(`check-api-linked-pages: ${e.message}\n`);
  process.exit(2);
}
