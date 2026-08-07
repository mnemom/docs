/**
 * strip-html-tags.test.mjs — unit suite for the shared loop-until-stable
 * inline-HTML-tag stripper (`scripts/lib/strip-html-tags.mjs`).
 *
 * Covers the logic both call sites (api-reference-drift.mjs, check-anchors.mjs)
 * now share: the nested-tag reproducer a SINGLE pass would leave behind
 * (`<<script>script>` → `<script>` in one pass; MNE-3528 / CodeQL
 * js/incomplete-multi-character-sanitization) and byte-identical parity with
 * the old greedy single-pass strip on well-formed, non-nested input.
 *
 * Fixtures use only obvious non-credential placeholders (MNE-339).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { stripHtmlTags } from "./strip-html-tags.mjs";

test("nested tag: single pass would leave a residual tag, the loop removes it", () => {
  // One pass of /<[^<>]*>/g on this leaves "<script>"; loop-until-stable clears it.
  assert.equal(stripHtmlTags("<<script>script>"), "");
});

test("nested tag: interleaved case is fully stripped", () => {
  assert.equal(stripHtmlTags("<scr<script>ipt>"), "");
});

test("well-formed input: byte-identical to the intent of the old single-pass strip", () => {
  assert.equal(stripHtmlTags("<b>ok</b>"), "ok");
  assert.equal(stripHtmlTags('<a href="x">t</a>'), "t");
  assert.equal(stripHtmlTags("plain text"), "plain text");
  assert.equal(stripHtmlTags("<div><span>hi</span></div>"), "hi");
});

test("empty tag <> is stripped (the * pattern's documented behavior change)", () => {
  // The old greedy `[^>]+` (with +) left `<>` in place; the innermost `[^<>]*`
  // (with *) strips it. No real heading/description contains `<>`, so this
  // change is inert on the committed tree — the assertion pins it as a contract.
  assert.equal(stripHtmlTags("<>"), "");
});
