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
