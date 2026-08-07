/**
 * strip-html-tags.mjs — loop-until-stable inline-HTML-tag stripper for
 * build-time doc tooling (api-reference-drift.mjs, check-anchors.mjs).
 *
 * Why loop-until-stable: a SINGLE pass of a single-tag regex can, on
 * nested/overlapping tags, remove an inner match and leave two fragments that
 * re-join into a fresh tag the one pass never revisits. With the conventional
 * innermost-tag pattern `/<[^<>]*>/g` (a match can never span a nested `<`),
 * the canonical reproducer `<<script>script>` strips to `<script>` in one pass
 * — a residual tag survives. Applying the replace repeatedly until the string
 * stops changing (fixed point) removes that residue.
 *
 * This is the CodeQL-documented remediation for
 * `js/incomplete-multi-character-sanitization` (findings #16/#14; MNE-3528).
 *
 * On well-formed, non-nested input (every real heading / OpenAPI description in
 * this repo) the output is byte-identical to the prior single-pass greedy
 * `/<[^>]+>/g` strip both call sites used before — the loop only changes
 * behavior on nested tags (and on an empty `<>`, which the old `+` pattern left
 * and the `*` pattern here strips).
 *
 * Scope note: this is a lightweight regex over REPO-CONTROLLED markdown/OpenAPI
 * prose, not a full HTML parser and not a defense against untrusted input. If a
 * caller ever ingests untrusted HTML (none does today), replace this with a
 * real sanitizer here — the single shared place that change lands.
 */

// Innermost single tag: the `[^<>]` class stops at the next `<` or `>`, so a
// match is always exactly one tag and the loop can reveal residue a greedy
// pattern would hide.
const TAG_RE = /<[^<>]*>/g;

export function stripHtmlTags(text) {
  let out = String(text);
  let prev;
  do {
    prev = out;
    out = out.replace(TAG_RE, "");
  } while (out !== prev);
  return out;
}
