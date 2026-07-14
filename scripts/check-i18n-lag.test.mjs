/**
 * check-i18n-lag.test.mjs — regression suite for the i18n translation-lag
 * detector's pure fingerprint/compare core (`scripts/check-i18n-lag.mjs`).
 *
 * Drives the exported helpers with in-memory MDX fixtures — NO filesystem
 * writes, NO network. Proves the fingerprint tracks the two structure-bearing
 * invariants a translation must preserve (heading set + fenced-code bodies) and
 * deliberately ignores prose and frontmatter, so translators localize wording
 * freely without tripping the gate, while a heading/code drift is caught.
 *
 * Fixtures use obvious placeholder content (MNE-339) — no credential-shaped
 * values.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  stripFrontmatter,
  extractHeadings,
  extractFencedBlocks,
  computeFingerprint,
  readFrontmatterField,
  compareFingerprint,
  setFrontmatterField,
  runCheck,
  countersConsistent,
  computeExitCode,
} from "./check-i18n-lag.mjs";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EN = [
  "---",
  'title: "Overview"',
  'description: "Pick the right path"',
  "---",
  "",
  "# Choose your path",
  "",
  "Some English prose here.",
  "",
  "## Create your account",
  "",
  "More prose.",
  "",
  "```bash",
  "mnemom login --org demo",
  "```",
  "",
].join("\n");

// Same structure, prose fully localized, frontmatter localized → in sync.
const FR = [
  "---",
  'title: "Vue d\'ensemble"',
  'description: "Choisissez le bon chemin"',
  "---",
  "",
  "# Choisissez votre chemin",
  "",
  "Du texte en français ici.",
  "",
  "## Créer votre compte",
  "",
  "Encore du texte.",
  "",
  "```bash",
  "mnemom login --org demo",
  "```",
  "",
].join("\n");

// ── stripFrontmatter ─────────────────────────────────────────────────────────

test("stripFrontmatter separates YAML frontmatter from body", () => {
  const { frontmatter, body } = stripFrontmatter(EN);
  assert.match(frontmatter, /title: "Overview"/);
  assert.doesNotMatch(body, /title:/);
  assert.match(body, /# Choose your path/);
});

test("stripFrontmatter on a page with no frontmatter returns empty frontmatter", () => {
  const { frontmatter, body } = stripFrontmatter("# Just a heading\n");
  assert.equal(frontmatter, "");
  assert.equal(body, "# Just a heading\n");
});

// ── extractHeadings ──────────────────────────────────────────────────────────

test("extractHeadings returns ordered ATX heading texts", () => {
  const { body } = stripFrontmatter(EN);
  assert.deepEqual(extractHeadings(body), ["Choose your path", "Create your account"]);
});

test("extractHeadings ignores `#` inside fenced code blocks", () => {
  const body = "# Real heading\n\n```python\n# just a comment\n#### not a heading\n```\n";
  assert.deepEqual(extractHeadings(body), ["Real heading"]);
});

// ── extractFencedBlocks ──────────────────────────────────────────────────────

test("extractFencedBlocks returns ordered {lang, body} entries", () => {
  const { body } = stripFrontmatter(EN);
  const blocks = extractFencedBlocks(body);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lang, "bash");
  assert.equal(blocks[0].body, "mnemom login --org demo");
});

test("extractFencedBlocks strips common indentation of MDX-nested fences (<Step>)", () => {
  const body = [
    "<Step>",
    "  ```python",
    "  value = compute()",
    "  ```",
    "</Step>",
  ].join("\n");
  const blocks = extractFencedBlocks(body);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lang, "python");
  assert.equal(blocks[0].body, "value = compute()");
});

// ── computeFingerprint ───────────────────────────────────────────────────────

test("computeFingerprint returns a sha256:<hex> digest", () => {
  const fp = computeFingerprint(EN);
  assert.match(fp, /^sha256:[0-9a-f]{64}$/);
});

test("identical structure → equal fingerprints (in sync)", () => {
  assert.equal(computeFingerprint(EN), computeFingerprint(EN));
});

test("prose-only change → equal fingerprint (translators localize prose freely)", () => {
  const proseChanged = EN.replace("Some English prose here.", "Totally rewritten prose paragraph.");
  assert.equal(computeFingerprint(proseChanged), computeFingerprint(EN));
});

test("frontmatter-only change → equal fingerprint (frontmatter stripped first)", () => {
  // Same body, different frontmatter — a page's own frontmatter must not feed
  // its fingerprint, so the digest is unchanged.
  const fmChanged = EN.replace('title: "Overview"', 'title: "A completely different title"');
  assert.equal(computeFingerprint(fmChanged), computeFingerprint(EN));
});

test("a legitimately-translated page differs from EN → live structural diff would false-positive", () => {
  // FR localizes heading text and prose, so its own fingerprint differs from
  // EN's. This is precisely why the gate records the EN baseline in frontmatter
  // rather than comparing the two pages' live fingerprints.
  assert.notEqual(computeFingerprint(FR), computeFingerprint(EN));
});

test("heading text changed → different fingerprint (stale)", () => {
  const headingChanged = EN.replace("# Choose your path", "# Choose your integration path");
  assert.notEqual(computeFingerprint(headingChanged), computeFingerprint(EN));
});

test("new heading added → different fingerprint (stale)", () => {
  const added = EN.replace("More prose.", "More prose.\n\n## Verify your setup\n");
  assert.notEqual(computeFingerprint(added), computeFingerprint(EN));
});

test("fenced-code body changed → different fingerprint (stale)", () => {
  const codeChanged = EN.replace("mnemom login --org demo", "mnemom login --org production");
  assert.notEqual(computeFingerprint(codeChanged), computeFingerprint(EN));
});

// ── readFrontmatterField ─────────────────────────────────────────────────────

test("readFrontmatterField reads source_fingerprint (unquoted)", () => {
  const fm = 'title: "Overview"\nsource_fingerprint: sha256:abc123\nicon: "compass"';
  assert.equal(readFrontmatterField(fm, "source_fingerprint"), "sha256:abc123");
});

test("readFrontmatterField returns null when the key is absent", () => {
  assert.equal(readFrontmatterField('title: "Overview"', "source_fingerprint"), null);
});

test("readFrontmatterField returns null when the value is empty", () => {
  assert.equal(readFrontmatterField("source_fingerprint: ", "source_fingerprint"), null);
});

// ── compareFingerprint ───────────────────────────────────────────────────────

test("compareFingerprint match → in-sync", () => {
  const fp = computeFingerprint(EN);
  assert.equal(compareFingerprint(fp, fp).status, "in-sync");
});

test("compareFingerprint mismatch → stale", () => {
  const fp = computeFingerprint(EN);
  assert.equal(compareFingerprint(fp, "sha256:0000").status, "stale");
});

test("compareFingerprint absent/empty recorded → missing (drives fail-closed errors branch)", () => {
  const fp = computeFingerprint(EN);
  assert.equal(compareFingerprint(fp, null).status, "missing");
  assert.equal(compareFingerprint(fp, "").status, "missing");
});

// ── setFrontmatterField (--write helper) ─────────────────────────────────────

test("setFrontmatterField inserts source_fingerprint when absent, preserving other keys", () => {
  const out = setFrontmatterField(EN, "source_fingerprint", "sha256:new");
  const { frontmatter } = stripFrontmatter(out);
  assert.equal(readFrontmatterField(frontmatter, "source_fingerprint"), "sha256:new");
  assert.equal(readFrontmatterField(frontmatter, "title"), "Overview");
  // Body untouched.
  assert.equal(stripFrontmatter(out).body, stripFrontmatter(EN).body);
});

test("setFrontmatterField replaces an existing source_fingerprint in place", () => {
  const seeded = setFrontmatterField(EN, "source_fingerprint", "sha256:old");
  const updated = setFrontmatterField(seeded, "source_fingerprint", "sha256:new");
  const { frontmatter } = stripFrontmatter(updated);
  assert.equal(readFrontmatterField(frontmatter, "source_fingerprint"), "sha256:new");
  // No duplicate key introduced.
  assert.equal((updated.match(/source_fingerprint:/g) || []).length, 1);
});

test("setFrontmatterField creates a frontmatter block when the page has none", () => {
  const out = setFrontmatterField("# Bare page\n", "source_fingerprint", "sha256:x");
  const { frontmatter, body } = stripFrontmatter(out);
  assert.equal(readFrontmatterField(frontmatter, "source_fingerprint"), "sha256:x");
  assert.match(body, /# Bare page/);
});

// ── End-to-end: recorded baseline drives the verdict ─────────────────────────

test("recorded EN fingerprint matches → in sync; after EN edit → stale", () => {
  const recorded = computeFingerprint(EN);
  assert.equal(compareFingerprint(computeFingerprint(EN), recorded).status, "in-sync");
  const enEdited = EN.replace("# Choose your path", "# Choose your path now");
  assert.equal(compareFingerprint(computeFingerprint(enEdited), recorded).status, "stale");
});

// ── Orchestration loop (runCheck) — mock filesystem, no writes/subprocess ────
//
// Each scenario injects `listPages` (page descriptors) and `readFile` (an
// in-memory path→content map that throws on absent paths, like fs.readFileSync),
// so the exact branch each localized page takes inside the main loop is asserted
// at the loop level — not just via the pure helpers (review finding 3a(b)).

const ROOT = "/root";

// A localized page that records `fp` as its EN baseline. `fp` omitted → no
// source_fingerprint key at all (the untracked-translation case).
function localizedPage(fp) {
  return fp === undefined
    ? FR
    : setFrontmatterField(FR, "source_fingerprint", fp);
}

// Build { listPages, readFile } for a single fr/quickstart/overview.mdx page.
// `enSrc` is the EN counterpart content; pass `enSrc: null` to simulate a
// missing/unreadable EN file (readFile throws for it).
function singlePageFixture({ locSrc, enSrc }) {
  const enRel = "quickstart/overview.mdx";
  const rel = `fr/${enRel}`;
  const abs = `${ROOT}/${rel}`;
  const enAbs = `${ROOT}/${enRel}`;
  const files = { [abs]: locSrc };
  if (enSrc !== null) files[enAbs] = enSrc;
  const listPages = () => [{ locale: "fr", abs, rel, enRel }];
  const readFile = (p) => {
    if (p in files) return files[p];
    throw new Error(`ENOENT: no such file, open '${p}'`);
  };
  return { root: ROOT, listPages, readFile };
}

test("runCheck: clean page (recorded fingerprint matches EN) → in-sync, exit 0", () => {
  const fx = singlePageFixture({ locSrc: localizedPage(computeFingerprint(EN)), enSrc: EN });
  const r = runCheck(fx);
  assert.equal(r.exitCode, 0);
  assert.equal(r.checked, 1);
  assert.equal(r.inSync, 1);
  assert.equal(r.stale, 0);
  assert.equal(r.errors, 0);
  assert.equal(r.invariantOk, true);
});

test("runCheck: EN edited since translation → routes to stale (not errors), exit 1", () => {
  // Baseline recorded against the ORIGINAL EN; EN then gains a heading.
  const recorded = computeFingerprint(EN);
  const enEdited = EN.replace("## Create your account", "## Create your organization account");
  const fx = singlePageFixture({ locSrc: localizedPage(recorded), enSrc: enEdited });
  const r = runCheck(fx);
  assert.equal(r.exitCode, 1);
  assert.equal(r.stale, 1);
  assert.equal(r.errors, 0);
  assert.equal(r.inSync, 0);
  assert.equal(r.staleReports.length, 1);
  assert.match(r.staleReports[0], /fr\/quickstart\/overview\.mdx/);
  assert.match(r.staleReports[0], /EN source quickstart\/overview\.mdx changed/);
});

test("runCheck: missing source_fingerprint → routes to errors (NOT stale), exit 1, names the file", () => {
  // This is the fail-closed invariant: a null/untracked case must increment
  // `errors`, never fall through to `stale` or `inSync`.
  const fx = singlePageFixture({ locSrc: localizedPage(undefined), enSrc: EN });
  const r = runCheck(fx);
  assert.equal(r.exitCode, 1);
  assert.equal(r.errors, 1);
  assert.equal(r.stale, 0);
  assert.equal(r.inSync, 0);
  assert.equal(r.errorReports.length, 1);
  assert.match(r.errorReports[0], /fr\/quickstart\/overview\.mdx/);
  assert.match(r.errorReports[0], /no source_fingerprint/);
});

test("runCheck: EN counterpart missing/unreadable → errors (fail closed, cannot verify), exit 1", () => {
  const fx = singlePageFixture({ locSrc: localizedPage(computeFingerprint(EN)), enSrc: null });
  const r = runCheck(fx);
  assert.equal(r.exitCode, 1);
  assert.equal(r.errors, 1);
  assert.equal(r.stale, 0);
  assert.match(r.errorReports[0], /EN counterpart quickstart\/overview\.mdx missing\/unreadable/);
});

test("runCheck: cold-start (zero localized pages) → coldStart, exit 1", () => {
  const r = runCheck({ root: ROOT, listPages: () => [], readFile: () => "" });
  assert.equal(r.exitCode, 1);
  assert.equal(r.coldStart, true);
  assert.equal(r.checked, 0);
});

test("runCheck: counters partition checked exactly across a mixed batch", () => {
  const recorded = computeFingerprint(EN);
  const enEdited = EN.replace("# Choose your path", "# Choose your path v2");
  const files = {
    // in-sync
    [`${ROOT}/fr/a.mdx`]: setFrontmatterField(FR, "source_fingerprint", recorded),
    [`${ROOT}/a.mdx`]: EN,
    // stale (EN changed)
    [`${ROOT}/fr/b.mdx`]: setFrontmatterField(FR, "source_fingerprint", recorded),
    [`${ROOT}/b.mdx`]: enEdited,
    // error (no fingerprint)
    [`${ROOT}/fr/c.mdx`]: FR,
    [`${ROOT}/c.mdx`]: EN,
  };
  const pages = [
    { locale: "fr", abs: `${ROOT}/fr/a.mdx`, rel: "fr/a.mdx", enRel: "a.mdx" },
    { locale: "fr", abs: `${ROOT}/fr/b.mdx`, rel: "fr/b.mdx", enRel: "b.mdx" },
    { locale: "fr", abs: `${ROOT}/fr/c.mdx`, rel: "fr/c.mdx", enRel: "c.mdx" },
  ];
  const r = runCheck({
    root: ROOT,
    listPages: () => pages,
    readFile: (p) => {
      if (p in files) return files[p];
      throw new Error("ENOENT");
    },
  });
  assert.equal(r.checked, 3);
  assert.equal(r.inSync, 1);
  assert.equal(r.stale, 1);
  assert.equal(r.errors, 1);
  assert.equal(r.invariantOk, true);
  assert.equal(r.exitCode, 1);
});

// ── Counter/exit-code invariants (MNE-438) ───────────────────────────────────

test("countersConsistent: true iff inSync + stale + errors === checked", () => {
  assert.equal(countersConsistent({ inSync: 1, stale: 1, errors: 1, checked: 3 }), true);
  assert.equal(countersConsistent({ inSync: 10, stale: 0, errors: 0, checked: 10 }), true);
  assert.equal(countersConsistent({ inSync: 1, stale: 1, errors: 1, checked: 5 }), false);
});

test("computeExitCode: violated invariant → 1 (exercises the invariant-violation branch)", () => {
  assert.equal(computeExitCode({ inSync: 1, stale: 1, errors: 1, checked: 5 }), 1);
});

test("computeExitCode: consistent + clean → 0; consistent + stale/errors → 1", () => {
  assert.equal(computeExitCode({ inSync: 12, stale: 0, errors: 0, checked: 12 }), 0);
  assert.equal(computeExitCode({ inSync: 10, stale: 2, errors: 0, checked: 12 }), 1);
  assert.equal(computeExitCode({ inSync: 10, stale: 0, errors: 2, checked: 12 }), 1);
});
