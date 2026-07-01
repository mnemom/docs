#!/usr/bin/env node
// scripts/generate-api-reference.mjs — project the committed customer-facing
// OpenAPI slice into Mintlify api-reference endpoint pages + navigation.
//
// Each customer-facing operation becomes a generated page:
//     ---
//     title: "<operation summary>"
//     openapi: "<METHOD> <bare path>"
//     ---
// (bare path: the spec keys paths without the /v1 prefix, which lives in
//  servers[0].url). This makes the reference a drift-proof projection — pages
//  can never document an endpoint the contract doesn't define.
//
// Idempotent: skips ops that already have a page (by openapi-directive key OR by
// filename, so hand-written pages like the GDPR-erasure narratives are
// preserved). Skips deliberately-held endpoints (see HELD).
//
// Usage:  node scripts/generate-api-reference.mjs           (write pages + nav)
//         node scripts/generate-api-reference.mjs --dry-run (report only)
//         node scripts/generate-api-reference.mjs --check   (orphan-drift audit;
//             exit 1 if any endpoint page's openapi: directive resolves to no
//             spec operation — i.e. it documents an endpoint the committed
//             contract no longer defines. Advisory: opt-in, not wired into a
//             required gate. Catches drift the add/refresh passes can't, since
//             those only project ops that DO exist.)

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(ROOT, "api-reference", "openapi.json");
const ENDPOINT_DIR = join(ROOT, "api-reference", "endpoint");
const DOCS_JSON = join(ROOT, "docs.json");
const DRY = process.argv.includes("--dry-run");
const CHECK = process.argv.includes("--check");
const METHODS = ["get", "post", "put", "patch", "delete"]; // also = display order within a resource

// Endpoints intentionally NOT published (tracked in Linear). Keys are "METHOD /path".
const HELD = new Set([
  "POST /safe-house/ingest-pattern", // MNE-122 — customer pattern contribution, post-GA security review
  "POST /safe-house/patterns", // MNE-122
  // MNE-128: cbd evaluations un-held — superseded by the /safe-house/outbound/ alias (mnemom-api#721); cbd ops are now deprecated-excluded.
  // MNE-137: recipes/{recipeId}/report un-held — its summary was scrubbed of "(AEGIS-6)" (mnemom-api#711, deployed).
]);

// A page is a generated stub (safe to refresh its title from the spec) iff it has
// ONLY title + optional description + openapi frontmatter and no body.
// Hand-written pages (e.g. the GDPR-erasure narratives) have a body and are
// never overwritten. The description: line is optional so the refresh pass
// picks up the 472 existing stubs that were generated before descriptions were
// added (migration-safe).
const STUB_RE = /^---\ntitle: .*\n(?:description: .*\n)?openapi: "[^"]*"\n---\s*$/;

// Derive a ≤160-char plain-text description from an OpenAPI operation.
// Prefers op.description (prose) over op.summary (already used as title).
// Falls back to op.summary so pages with only a summary still get a value.
function descriptionFor(op) {
  const raw = (op.description || op.summary || "").trim();
  if (!raw) return "";
  const plain = raw
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\n+/g, " ")
    .trim();
  const first = plain.split(/(?<=[.!?])\s+/)[0] || plain;
  return first.length <= 160 ? first : first.slice(0, 157) + "...";
}

// API Reference tab group order (core product first; legacy/housekeeping last;
// "Blog" forced last). Groups not listed keep their relative order after these.
const GROUP_ORDER = [
  "API Reference", "Auth", "OAuth", "Agents", "Alignment", "Protection", "Postures", "Unified cards",
  "Enforcement", "Governance", "Risk", "Drift", "Integrity", "Checkpoints", "Verification",
  "Reputation", "Team Reputation", "Teams", "Organizations", "Licensing", "Billing",
  "Tools", "Catalog", "Notifications", "Webhook Notifications", "AIP Webhooks",
  "Transparency", "Attestation", "A2A", "Recipes", "Sideband", "Traces", "Analyze",
  "Reclassification", "Intelligence", "Policy", "On-Chain", "Transactions",
  "Conscience Values", "Agent Containment", "Agent Runtime", "Safe House", "Trust & Network (AEGIS)",
];

// Not part of the programmatic product API — the web app / website surface.
// (CookieAuth-only endpoints are excluded structurally below.)
const NON_API = new Set([
  "POST /contact/submit", // marketing site contact form
  "POST /auth/sessions/revoke-via-email", // email-link account-security flow (website, not API)
]);

// The reference documents the PROGRAMMATIC product API. We exclude:
//  - deprecated ops (their canonical replacements are projected; we're migrating off, MNE-115)
//  - CookieAuth-only ops (dashboard session surface, not programmatic API)
//  - the NON_API website endpoints above
// Public (no-auth) PRODUCT endpoints — reputation badges, transparency log, tools
// registry, catalog, JWKS, public plans — ARE part of the API and are kept.
function exclusionReason(key, op, secStr) {
  if (op.deprecated) return "deprecated";
  if (/CookieAuth/.test(secStr) && !/ApiKeyAuth|BearerAuth|LicenseJwtAuth|AgentAuth/.test(secStr)) return "dashboard-session";
  if (NON_API.has(key)) return "non-api";
  return null;
}

// Tag -> nav group name. Default: the tag itself. Handles casing dupes + the
// few hand-curated group names that don't equal their tag.
const TAG_TO_GROUP = {
  Orgs: "Organizations",
  tools: "Tools",
  Network: "Trust & Network (AEGIS)",
  Trust: "Trust & Network (AEGIS)",
};
// Big tags whose group nests pages under scope sub-groups (agent/org/team/platform).
const SCOPE_NESTED = new Set(["Alignment", "Protection"]);
const SCOPE_LABEL = { agent: "Agent scope", org: "Org scope", team: "Team scope", platform: "Platform scope" };

const slug = (m, p) => `${m}-${p.replace(/[{}]/g, "").replace(/_/g, "-").split("/").filter(Boolean).join("-")}`;
const groupFor = (tag) => TAG_TO_GROUP[tag] || tag || "Misc";
const scopeOf = (p) => {
  const seg = (p.split("/")[2] || "").replace(/[{}]/g, ""); // /alignment/<scope>/...
  return SCOPE_LABEL[seg] || "General";
};

const spec = JSON.parse(readFileSync(SPEC, "utf8"));

// Already-projected: by openapi-directive key AND by filename (preserves hand-written pages).
const existingFiles = new Set(readdirSync(ENDPOINT_DIR).filter((f) => f.endsWith(".mdx")));
const projectedKeys = new Set();
const directiveByFile = new Map(); // file -> "METHOD path" (for the orphan audit)
for (const f of existingFiles) {
  const m = readFileSync(join(ENDPOINT_DIR, f), "utf8").match(/^openapi:\s*"([A-Z]+)\s+([^"]+)"/m);
  if (m) {
    projectedKeys.add(`${m[1]} ${m[2]}`);
    directiveByFile.set(f, { method: m[1], path: m[2] });
  }
}

// --check: orphan-drift audit. Every endpoint page carrying an openapi: directive
// must resolve to a real operation in the committed spec. A page whose directive
// matches no spec op documents an endpoint the contract no longer defines — it
// renders as a broken/empty reference page (e.g. a stub left behind when an op was
// removed from the published slice; the add/refresh passes never delete these).
// Advisory: opt-in flag, exits 1 so a (non-required) CI step can surface it.
if (CHECK) {
  const orphans = [];
  for (const [f, { method, path }] of directiveByFile) {
    const op = (spec.paths?.[path] || {})[method.toLowerCase()];
    if (!op) orphans.push(`${f}: ${method} ${path}`);
  }
  if (orphans.length) {
    process.stderr.write(
      `generate-api-reference --check: ${orphans.length} ORPHAN directive(s) — ` +
        `endpoint page(s) reference an operation absent from the committed spec:\n  ` +
        orphans.sort().join("\n  ") +
        `\nRemove the stale page(s) + their docs.json nav refs, or restore the op upstream.\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`generate-api-reference --check: ✓ all ${directiveByFile.size} directive pages resolve to a spec op.\n`);
  process.exit(0);
}

// Collect ops to generate.
const toGen = []; // {key, method, path, tag, group, scope, slug, title}
const flagged = [];
const excluded = { deprecated: [], "dashboard-session": [], "non-api": [], held: [] };
for (const [path, item] of Object.entries(spec.paths || {})) {
  for (const m of METHODS) {
    const op = item[m];
    if (!op) continue;
    const key = `${m.toUpperCase()} ${path}`;
    if (projectedKeys.has(key)) continue;
    const sl = slug(m, path);
    if (existingFiles.has(`${sl}.mdx`)) continue; // hand-written / already present
    if (HELD.has(key)) {
      excluded.held.push(key);
      continue;
    }
    const sec = (op.security || spec.security || []).map((o) => Object.keys(o).join("+")).join("|") || "none";
    const reason = exclusionReason(key, op, sec);
    if (reason) {
      excluded[reason].push(key);
      continue;
    }
    const tag = (op.tags || ["Misc"])[0];
    const title = (op.summary || "").trim();
    if (!title) flagged.push({ key, tag, flags: "EMPTY_TITLE" });
    if (sec === "none") flagged.push({ key, tag, flags: "public(no-auth)" });
    toGen.push({ key, method: m, path, tag, group: groupFor(tag), scope: scopeOf(path), slug: sl, title: title || op.operationId || key, op });
  }
}

// Write new pages.
let written = 0;
for (const o of toGen) {
  const file = join(ENDPOINT_DIR, `${o.slug}.mdx`);
  const desc = descriptionFor(o.op);
  const body = `---\ntitle: ${JSON.stringify(o.title)}\n${desc ? `description: ${JSON.stringify(desc)}\n` : ""}openapi: ${JSON.stringify(`${o.method.toUpperCase()} ${o.path}`)}\n---\n`;
  if (!DRY && !existsSync(file)) writeFileSync(file, body);
  written++;
}

// Refresh existing generated stubs whose title drifted from the current spec
// summary (e.g. after a sync). Hand-written pages (non-stub) are left untouched.
let refreshed = 0;
for (const [path, item] of Object.entries(spec.paths || {})) {
  for (const m of METHODS) {
    const op = item[m];
    if (!op) continue;
    const key = `${m.toUpperCase()} ${path}`;
    if (HELD.has(key)) continue;
    const file = join(ENDPOINT_DIR, `${slug(m, path)}.mdx`);
    if (!existsSync(file)) continue;
    const cur = readFileSync(file, "utf8");
    if (!STUB_RE.test(cur)) continue; // hand-written page — never overwrite
    const title = (op.summary || "").trim() || op.operationId || key;
    const desc = descriptionFor(op);
    const body = `---\ntitle: ${JSON.stringify(title)}\n${desc ? `description: ${JSON.stringify(desc)}\n` : ""}openapi: ${JSON.stringify(`${m.toUpperCase()} ${path}`)}\n---\n`;
    if (cur !== body) {
      if (!DRY) writeFileSync(file, body);
      refreshed++;
    }
  }
}

// ---- Navigation ----
const docs = JSON.parse(readFileSync(DOCS_JSON, "utf8"));
const allTabs = docs.navigation.tabs
  ?? docs.navigation.languages?.find((l) => l.default)?.tabs
  ?? docs.navigation.languages?.[0]?.tabs ?? [];
const tab = allTabs.find((t) => t.tab === "API Reference");
const pagePath = (sl) => `api-reference/endpoint/${sl}`;
const methodRank = (k) => METHODS.indexOf(k.split(" ")[0].toLowerCase());
const sortOps = (a, b) => (a.path === b.path ? methodRank(a.key) - methodRank(b.key) : a.path < b.path ? -1 : 1);

// Group generated ops by target group.
const byGroup = {};
for (const o of toGen) (byGroup[o.group] ||= []).push(o);

const findGroup = (name) => tab.groups.find((g) => g.group === name);
const ensureGroup = (name) => {
  let g = findGroup(name);
  if (!g) {
    g = { group: name, pages: [] };
    tab.groups.push(g);
  }
  return g;
};
const allPagesIn = (g) => {
  // flatten nested sub-groups for dedup
  const out = [];
  const walk = (pages) => pages.forEach((p) => (typeof p === "string" ? out.push(p) : walk(p.pages || [])));
  walk(g.pages || []);
  return new Set(out);
};

let added = 0;
for (const [name, ops] of Object.entries(byGroup)) {
  const g = ensureGroup(name);
  const have = allPagesIn(g);
  ops.sort(sortOps);
  if (SCOPE_NESTED.has(ops[0].tag)) {
    // nest under scope sub-groups, in a stable scope order
    const order = ["Agent scope", "Org scope", "Team scope", "Platform scope", "General"];
    const byScope = {};
    for (const o of ops) (byScope[o.scope] ||= []).push(o);
    for (const scope of order) {
      const list = (byScope[scope] || []).filter((o) => !have.has(pagePath(o.slug)));
      if (!list.length) continue;
      let sub = (g.pages || []).find((p) => typeof p === "object" && p.group === scope);
      if (!sub) {
        sub = { group: scope, pages: [] };
        g.pages.push(sub);
      }
      for (const o of list) {
        sub.pages.push(pagePath(o.slug));
        added++;
      }
    }
  } else {
    for (const o of ops) {
      if (have.has(pagePath(o.slug))) continue;
      g.pages.push(pagePath(o.slug));
      added++;
    }
  }
}

// De-dup: a page referenced in more than one group is kept only in its first
// occurrence (in final group order), fixing pre-existing double-listings.
const orderIdx = (name) => {
  const i = GROUP_ORDER.indexOf(name);
  return i === -1 ? GROUP_ORDER.length : i;
};
tab.groups.sort((a, b) => orderIdx(a.group) - orderIdx(b.group) || (a.group === "Blog" ? 1 : b.group === "Blog" ? -1 : 0));
const seenPages = new Set();
let deduped = 0;
const prune = (pages) =>
  pages.filter((p) => {
    if (typeof p === "object") {
      p.pages = prune(p.pages || []);
      return p.pages.length > 0;
    }
    if (seenPages.has(p)) {
      deduped++;
      return false;
    }
    seenPages.add(p);
    return true;
  });
for (const g of tab.groups) g.pages = prune(g.pages || []);

if (!DRY) writeFileSync(DOCS_JSON, JSON.stringify(docs, null, 2) + "\n");

// ---- Report ----
const groupCounts = Object.entries(byGroup)
  .map(([g, o]) => `${g} (+${o.length})`)
  .sort();
process.stderr.write(
  `generate-api-reference${DRY ? " [dry-run]" : ""}:\n` +
    `  pages ${DRY ? "would write" : "written"}: ${written}\n`+
    `  titles refreshed: ${refreshed}\n`+
    `` +
    `  nav pages added: ${added}\n` +
    `  groups touched (${groupCounts.length}):\n    ${groupCounts.join("\n    ")}\n` +
    `  EXCLUDED — deprecated:${excluded.deprecated.length} dashboard-session:${excluded["dashboard-session"].length} non-api:${excluded["non-api"].length} held:${excluded.held.length}\n` +
    `    deprecated: ${excluded.deprecated.join(", ") || "—"}\n` +
    `    dashboard-session: ${excluded["dashboard-session"].join(", ") || "—"}\n` +
    `    non-api: ${excluded["non-api"].join(", ") || "—"}\n` +
    (flagged.length ? `  public (no-auth) product endpoints kept (${flagged.length}):\n    ${flagged.map((f) => `${f.key}`).join("\n    ")}\n` : "  flagged: none\n"),
);
