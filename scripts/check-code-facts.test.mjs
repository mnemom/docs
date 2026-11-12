// Tests for the docs ↔ code-facts gate (scripts/lib/code-facts.mjs, MNE-9916).
// Run: npm run test:code-facts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CODE_FACTS_SCHEMA,
  CodeFactsError,
  SOURCES,
  buildSnapshot,
  checkPage,
  diffFacts,
  parseAnnotations,
  parseLiteral,
  serializeSnapshot,
  validateSourceDoc,
} from "./lib/code-facts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_PATH = join(ROOT, "scripts", "code-facts-snapshot.json");
const SNAPSHOT_TEXT = readFileSync(SNAPSHOT_PATH, "utf8");
const SNAP = JSON.parse(SNAPSHOT_TEXT);
const COMPOSITION = readFileSync(join(ROOT, "concepts", "card-composition.mdx"), "utf8");
const clone = (o) => JSON.parse(JSON.stringify(o));

const run = (script, args = [], env = {}) =>
  spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

/** Each repo's code-facts.json as the snapshot recorded it. */
function sourceDocs(snap = SNAP) {
  return SOURCES.map((source) => ({
    schema: CODE_FACTS_SCHEMA,
    repo: source.repo,
    facts: Object.fromEntries(
      Object.entries(snap.facts)
        .filter(([, f]) => f.repo === source.repo)
        .map(([id, { value, source: file, symbol, summary }]) => [id, { value, source: file, symbol, summary }]),
    ),
  }));
}

function tmp() {
  return mkdtempSync(join(tmpdir(), "code-facts-"));
}

test("every annotated page in the committed tree matches the committed snapshot", () => {
  const r = run("check-code-facts.mjs");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /claim\(s\) on \d+ page\(s\) match/);
});

test("the snapshot is exactly what buildSnapshot makes of its own sources", () => {
  const rebuilt = buildSnapshot(SOURCES.map((source, i) => ({ source, ref: SNAP.sources[i].ref, doc: sourceDocs()[i] })));
  assert.equal(serializeSnapshot(rebuilt), SNAPSHOT_TEXT);
  for (const source of SOURCES) {
    assert.ok(Object.keys(SNAP.facts).some((id) => id.startsWith(source.prefix)), `no ${source.prefix} facts`);
  }
});

test("literals read as the JSON value they assert", () => {
  assert.equal(parseLiteral("true"), true);
  assert.equal(parseLiteral("false"), false);
  assert.equal(parseLiteral("403"), 403);
  assert.equal(parseLiteral("0.05"), 0.05);
  assert.equal(parseLiteral("observe"), "observe");
  assert.throws(() => parseLiteral("24h)"), CodeFactsError);
});

test("annotations parse into claims, phrases may hold commas and pipes", () => {
  const claims = parseAnnotations(
    '{/* code-facts: api.a.b=0 "born with 0, not 24", gateway.c.d=403 "returns | 403" */}\n{/* code-facts: api.e.f=observe "x" */}',
  );
  assert.deepEqual(
    claims.map((c) => [c.id, c.value, c.phrase]),
    [
      ["api.a.b", 0, "born with 0, not 24"],
      ["gateway.c.d", 403, "returns | 403"],
      ["api.e.f", "observe", "x"],
    ],
  );
  assert.deepEqual(parseAnnotations("{/* concept-fields: a, b */}"), []);
});

test("a malformed annotation is a usage error, and the CLI exits 2", () => {
  for (const bad of [
    "{/* code-facts: */}",
    '{/* code-facts: api.a.b "no literal" */}',
    "{/* code-facts: api.a.b=0 no quotes */}",
    '{/* code-facts: api.a.b=0 "" */}',
    '{/* code-facts: Nope=0 "x" */}',
  ]) {
    assert.throws(() => parseAnnotations(bad), CodeFactsError, bad);
  }
  const dir = tmp();
  try {
    writeFileSync(join(dir, "page.mdx"), '{/* code-facts: api.a.b "x" */}\n');
    const r = run("check-code-facts.mjs", [], { CODE_FACTS_ROOT: dir });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /page\.mdx: cannot parse/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a page that contradicts the code fails, naming both values and the source", () => {
  // Alex's 11-10 finding: docs said new agents get a 24h grace, code stamps 0.
  const page = 'New agents get a 24-hour grace period.\n{/* code-facts: api.new_agent.grace_period_hours=24 "a 24-hour grace period" */}\n';
  const problems = checkPage(page, SNAP.facts, "p.mdx");
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /asserts api\.new_agent\.grace_period_hours=24, but the code says 0/);
  assert.match(problems[0], /src\/composition\/new-agent-defaults\.ts withNewAgentEnforcement/);

  const flipped = COMPOSITION.replace("false_wins=true", "false_wins=false");
  assert.notEqual(flipped, COMPOSITION);
  assert.match(checkPage(flipped, SNAP.facts, "c.mdx").join("\n"), /but the code says true/);
});

test("a gateway fact contradiction fails too (OpenAI Responses tools)", () => {
  const page = 'Policy reads tools on every OpenAI request.\n{/* code-facts: gateway.policy.reads_declared_tools.openai_responses=true "every OpenAI request" */}\n';
  assert.match(checkPage(page, SNAP.facts).join("\n"), /but the code says false \(mnemom\/mnemom-platform /);
});

test("an unknown fact id fails", () => {
  const page = 'x\n{/* code-facts: gateway.policy.proof_boundary_cap=5 "x" */}\n';
  assert.match(checkPage(page, SNAP.facts).join("\n"), /gateway\.policy\.proof_boundary_cap is not a code fact/);
});

test("an annotation whose phrase was rewritten away fails", () => {
  const rewritten = COMPOSITION.replace("**Strictest wins (`false` over `true`)**", "**Most permissive wins**");
  assert.notEqual(rewritten, COMPOSITION);
  assert.match(checkPage(rewritten, SNAP.facts).join("\n"), /the phrase "Strictest wins \(`false` over `true`\)" .* no longer on the page/);
  // The phrase must be in the body, not only inside the annotation itself.
  assert.match(checkPage('{/* code-facts: api.new_agent.grace_period_hours=0 "zero" */}', SNAP.facts).join("\n"), /no longer on the page/);
});

test("a stale snapshot is detected: value, source, symbol, added and removed facts", () => {
  const live = clone(SNAP.facts);
  assert.deepEqual(diffFacts(SNAP.facts, live), []);
  live["api.new_agent.grace_period_hours"].value = 24;
  live["gateway.safe_house.canary_block.http_status"].symbol = "renamedBuilder";
  live["api.new_agent.added"] = { ...live["api.new_agent.autonomy_mode"] };
  delete live["api.new_agent.integrity_mode"];
  live["api.new_agent.autonomy_mode"].summary = "reworded";
  const drift = diffFacts(SNAP.facts, live).join("\n");
  assert.match(drift, /api\.new_agent\.grace_period_hours value is 0 in the snapshot, 24 in code/);
  assert.match(drift, /canary_block\.http_status symbol/);
  assert.match(drift, /api\.new_agent\.added is generated but missing/);
  assert.match(drift, /api\.new_agent\.integrity_mode is in the snapshot but no longer generated/);
  assert.doesNotMatch(drift, /autonomy_mode summary/);
});

test("sync --check exits 1 on a stale snapshot and 0 on a fresh one", () => {
  const dir = tmp();
  try {
    const [api, platform] = sourceDocs();
    const write = (name, doc) => {
      const p = join(dir, name);
      writeFileSync(p, JSON.stringify(doc));
      return p;
    };
    const args = (a, p) => ["--check", "--api-file", a, "--platform-file", p, "--ref", "test"];
    const fresh = run("sync-code-facts.mjs", args(write("api.json", api), write("gw.json", platform)));
    assert.equal(fresh.status, 0, fresh.stderr);

    const changed = clone(platform);
    changed.facts["gateway.safe_house.canary_block.http_status"].value = 409;
    const stale = run("sync-code-facts.mjs", args(write("api.json", api), write("gw2.json", changed)));
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /canary_block\.http_status value is 403 in the snapshot, 409 in code/);
    assert.equal(readFileSync(SNAPSHOT_PATH, "utf8"), SNAPSHOT_TEXT, "--check must not write");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a page checked against a stale snapshot fails in the CLI (exit 1)", () => {
  const dir = tmp();
  try {
    const snap = clone(SNAP);
    snap.facts["api.compose.allow_unmapped_tools.false_wins"].value = false;
    const p = join(dir, "snap.json");
    writeFileSync(p, JSON.stringify(snap));
    const r = run("check-code-facts.mjs", [], { CODE_FACTS_SNAPSHOT: p });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /card-composition\.mdx: .* but the code says false/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("source files are validated: schema, repo, id prefix, value type", () => {
  const [api] = sourceDocs();
  const source = SOURCES[0];
  validateSourceDoc(api, source);
  const bad = (mutate) => {
    const d = clone(api);
    mutate(d);
    return () => validateSourceDoc(d, source);
  };
  assert.throws(bad((d) => (d.schema = "mnemom-code-facts/0")), /schema/);
  assert.throws(bad((d) => (d.repo = "mnemom/other")), /names repo/);
  assert.throws(bad((d) => (d.facts["gateway.x.y"] = d.facts["api.new_agent.autonomy_mode"])), /must be an id under api\./);
  assert.throws(bad((d) => (d.facts["api.new_agent.autonomy_mode"].value = null)), /value/);
  assert.throws(bad((d) => delete d.facts["api.new_agent.autonomy_mode"].symbol), /no symbol/);
});

test("pages are found below subdirectories, and pages without annotations are skipped", () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "plain.mdx"), "no claims here\n");
    writeFileSync(join(dir, "a", "b", "deep.mdx"), 'Born with 0 hours.\n{/* code-facts: api.new_agent.grace_period_hours=24 "Born with 0 hours." */}\n');
    const r = run("check-code-facts.mjs", [], { CODE_FACTS_ROOT: dir });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /a\/b\/deep\.mdx: .* but the code says 0/);
    assert.match(r.stderr, /on 1 annotated page/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
