#!/usr/bin/env node
/**
 * seed-staging-fixtures.mjs — T5-1.3 v2.
 *
 * Idempotently ensures the staging fixtures the live executor needs are
 * present in the staging environment, and writes their IDs into
 * `scripts/staging-fixtures.json` so the executor can substitute them
 * into doc curl examples.
 *
 * Run manually (not in CI). Requires:
 *   MNEMOM_STAGING_TOKEN     — staging-scoped service-account or PAT
 *   MNEMOM_STAGING_BASE_URL  — optional; default https://api.staging.mnemom.ai/v1
 *
 * Behavior:
 *   - `GET /v1/auth/me` to discover the user's default org_id.
 *   - List webhooks for that org. If one with name="mnemom-doc-fixtures"
 *     exists, reuse it. Otherwise create one pointing at the receiver
 *     specified by --webhook-receiver (default: https://webhook.site/...
 *     known-good test sink; override with a real test endpoint).
 *   - List teams for that org. If one with name="mnemom-doc-fixtures"
 *     exists, reuse it. Otherwise skip (team-create requires a card,
 *     out of scope for v2 v1).
 *   - Write the resolved IDs into scripts/staging-fixtures.json under
 *     `.values.{ORG_ID, WEBHOOK_ENDPOINT_ID, TEAM_ID, AGENT_ID}`.
 *
 * Output is JSON-only on stdout — pipe into the fixtures file:
 *   node scripts/seed-staging-fixtures.mjs > scripts/staging-fixtures.json
 *
 * Or with --apply, the script updates the file in place.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { env, argv, exit } from "node:process";

const args = argv.slice(2);
let apply = false;
let webhookReceiver = "https://webhook.site/00000000-0000-0000-0000-000000000000";
let fixtureName = "mnemom-doc-fixtures";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--apply") apply = true;
  else if (a === "--webhook-receiver") webhookReceiver = args[++i];
  else if (a === "--fixture-name") fixtureName = args[++i];
  else if (a === "--help" || a === "-h") {
    console.log("Usage: seed-staging-fixtures.mjs [--apply] [--webhook-receiver url] [--fixture-name name]");
    console.log();
    console.log("Without --apply, prints the resolved fixtures as JSON on stdout.");
    console.log("With --apply, writes scripts/staging-fixtures.json directly.");
    exit(0);
  }
}

const token = env.MNEMOM_STAGING_TOKEN;
const base = (env.MNEMOM_STAGING_BASE_URL ?? "https://api.staging.mnemom.ai/v1").replace(/\/$/, "");
if (!token) {
  console.error("MNEMOM_STAGING_TOKEN is required");
  exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { __raw: text };
  }
  if (res.status >= 400) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return json;
}

// ── 1. Identify the staging user + their default org ─────────────────────
const me = await api("GET", "/auth/me");
const orgId = me.default_org_id ?? me.org_id ?? me.user?.default_org_id;
if (!orgId) {
  throw new Error("Could not resolve org_id from /auth/me; check response shape against the spec.");
}

// ── 2. Find-or-create the doc-fixtures webhook endpoint ──────────────────
const webhooks = await api("GET", `/orgs/${orgId}/webhooks`);
const existingHook = (webhooks.endpoints ?? webhooks.data ?? webhooks).find?.(
  (w) => w.description === fixtureName || w.name === fixtureName,
);

let webhookEndpointId = existingHook?.endpoint_id ?? existingHook?.id;
if (!webhookEndpointId) {
  const created = await api("POST", `/orgs/${orgId}/webhooks`, {
    url: webhookReceiver,
    description: fixtureName,
    event_types: ["integrity.violation"],
  });
  webhookEndpointId = created.endpoint_id ?? created.id;
}

// ── 3. Find an existing agent on this user (do not create, since
//        agent provisioning is identity-bound and creating one here would
//        consume the staging user's agent quota). The first agent visible
//        is fine for read-only doc examples.
let agentId = null;
try {
  const agents = await api("GET", "/agents");
  const first = (agents.agents ?? agents.data ?? agents)[0];
  agentId = first?.agent_id ?? first?.id ?? null;
} catch {
  // No agents on this account — leave AGENT_ID unset; doc examples that
  // need it will skip with "unresolved placeholder."
}

// ── 4. Find an existing team (don't create — needs a team card which
//        is a separate fixture problem)
let teamId = null;
try {
  const teams = await api("GET", `/orgs/${orgId}/teams`);
  const first = (teams.teams ?? teams.data ?? teams)[0];
  teamId = first?.team_id ?? first?.id ?? null;
} catch {
  // No teams — same as agents above.
}

// ── 5. Emit / write fixtures ─────────────────────────────────────────────
const existing = existsSync("scripts/staging-fixtures.json")
  ? (() => {
      try {
        return JSON.parse(readFileSync("scripts/staging-fixtures.json", "utf8"));
      } catch {
        return {};
      }
    })()
  : {};

const merged = {
  ...existing,
  _README: existing._README ?? "Staging fixtures for T5-1.3 live executor. Populated by scripts/seed-staging-fixtures.mjs; safe to commit (test entity IDs only, no secrets).",
  values: {
    ...(existing.values ?? {}),
    ORG_ID: orgId,
    WEBHOOK_ENDPOINT_ID: webhookEndpointId,
    ...(agentId ? { AGENT_ID: agentId } : {}),
    ...(teamId ? { TEAM_ID: teamId } : {}),
  },
};

if (apply) {
  writeFileSync("scripts/staging-fixtures.json", JSON.stringify(merged, null, 2) + "\n");
  console.error(`Wrote scripts/staging-fixtures.json:`);
  console.error(`  ORG_ID = ${orgId}`);
  console.error(`  WEBHOOK_ENDPOINT_ID = ${webhookEndpointId}`);
  if (agentId) console.error(`  AGENT_ID = ${agentId}`);
  if (teamId) console.error(`  TEAM_ID = ${teamId}`);
} else {
  process.stdout.write(JSON.stringify(merged, null, 2) + "\n");
}
