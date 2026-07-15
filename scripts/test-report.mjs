import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "generate-api-reference.mjs");

function runReport(ops) {
  const dir = mkdtempSync(join(tmpdir(), "test-report-"));
  mkdirSync(join(dir, "api-reference"), { recursive: true });
  mkdirSync(join(dir, "scripts"));

  const spec = {
    openapi: "3.0.0",
    info: { title: "Test", version: "1.0" },
    servers: [{ url: "https://api.test.com/v1" }],
    paths: {},
  };
  for (const { method, path: p, op } of ops) {
    spec.paths[p] ||= {};
    spec.paths[p][method] = op;
  }
  writeFileSync(join(dir, "api-reference", "openapi.json"), JSON.stringify(spec));
  copyFileSync(SCRIPT, join(dir, "scripts", "generate-api-reference.mjs"));

  execFileSync(process.execPath, [
    join(dir, "scripts", "generate-api-reference.mjs"),
    "--report",
  ], { stdio: ["ignore", "ignore", "ignore"] });

  return JSON.parse(
    readFileSync(join(dir, "api-reference", ".coverage-manifest.json"), "utf8"),
  );
}

test("HELD op is classified as held", () => {
  const m = runReport([
    { method: "post", path: "/safe-house/ingest-pattern", op: { summary: "Held op", tags: ["Safe House"] } },
  ]);
  assert.deepEqual(m.held, ["POST /safe-house/ingest-pattern"]);
  assert.deepEqual(m.generated, []);
  assert.deepEqual(m.excluded.deprecated, []);
});

test("deprecated op is classified as excluded.deprecated", () => {
  const m = runReport([
    { method: "get", path: "/things/{id}", op: { summary: "Old thing", deprecated: true, tags: ["Things"], security: [{ ApiKeyAuth: [] }] } },
  ]);
  assert.deepEqual(m.excluded.deprecated, ["GET /things/{id}"]);
  assert.deepEqual(m.generated, []);
  assert.deepEqual(m.held, []);
});

test("CookieAuth-only op is classified as excluded.dashboard-session", () => {
  const m = runReport([
    { method: "get", path: "/dashboard/prefs", op: { summary: "Prefs", tags: ["Dashboard"], security: [{ CookieAuth: [] }] } },
  ]);
  assert.deepEqual(m.excluded["dashboard-session"], ["GET /dashboard/prefs"]);
  assert.deepEqual(m.generated, []);
  assert.deepEqual(m.held, []);
});

test("NON_API op is classified as excluded.non-api", () => {
  const m = runReport([
    { method: "post", path: "/contact/submit", op: { summary: "Contact form", tags: ["Contact"], security: [{ ApiKeyAuth: [] }] } },
  ]);
  assert.deepEqual(m.excluded["non-api"], ["POST /contact/submit"]);
  assert.deepEqual(m.generated, []);
  assert.deepEqual(m.held, []);
});

test("plain op is classified as generated", () => {
  const m = runReport([
    { method: "get", path: "/widgets", op: { summary: "List widgets", tags: ["Widgets"], security: [{ ApiKeyAuth: [] }] } },
  ]);
  assert.deepEqual(m.generated, ["GET /widgets"]);
  assert.deepEqual(m.held, []);
  assert.deepEqual(m.excluded.deprecated, []);
  assert.deepEqual(m.excluded["dashboard-session"], []);
  assert.deepEqual(m.excluded["non-api"], []);
});

test("HELD wins over deprecated when both conditions are true", () => {
  const m = runReport([
    { method: "post", path: "/safe-house/ingest-pattern", op: { summary: "Held+deprecated", deprecated: true, tags: ["Safe House"] } },
  ]);
  assert.deepEqual(m.held, ["POST /safe-house/ingest-pattern"]);
  assert.deepEqual(m.excluded.deprecated, []);
});
