// Tests for the Trust-surface claims regression gate (scripts/check-trust-claims.mjs,
// issue #620 card G). Run: npm run test:trust-claims
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkPageText, checkTrustClaims, TARGET_FILES } from "./check-trust-claims.mjs";

const CLEAN_IOC = `---\ntitle: "x"\n---\n\n<Note>\n**Read-only today.** There is no API to submit indicators. Requests share\nthe global per-IP gateway limit: 100 requests/minute per IP. The STIX\nbundle is not cryptographically signed today — signing is planned.\n</Note>\n`;
const CLEAN_ADVISORY = `---\ntitle: "x"\n---\n\n<Note>\n**Read-only today.** This endpoint only supports GET. Requests share the\nglobal per-IP gateway limit: 100 requests/minute per IP.\n</Note>\n`;

test("TARGET_FILES names the three Trust-surface endpoint pages, IoC scoped for signing", () => {
  assert.deepEqual(
    TARGET_FILES.map((f) => f.rel),
    [
      "api-reference/endpoint/get-trust-iocs.mdx",
      "api-reference/endpoint/get-trust-advisories.mdx",
      "api-reference/endpoint/get-trust-advisories-slug.mdx",
    ],
  );
  assert.equal(TARGET_FILES.find((f) => f.rel.includes("iocs")).checkSigned, true);
  assert.ok(TARGET_FILES.filter((f) => f.rel.includes("advisories")).every((f) => f.checkSigned === false));
});

test("a fully-compliant fixture set has zero failures", () => {
  const result = checkTrustClaims({
    readFile: (rel) => (rel.includes("iocs") ? CLEAN_IOC : CLEAN_ADVISORY),
  });
  assert.equal(result.checked, 3);
  assert.deepEqual(result.failures, []);
});

test("the committed real pages pass the gate", () => {
  const result = checkTrustClaims();
  assert.equal(result.checked, 3, result.failures.join("\n"));
  assert.deepEqual(result.failures, []);
});

test("missing 'read-only' phrasing fails, attributed to the right file", () => {
  const result = checkTrustClaims({
    readFile: (rel) => (rel.includes("get-trust-iocs") ? CLEAN_IOC.replace(/Read-only today\./, "") : CLEAN_ADVISORY),
  });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /^api-reference\/endpoint\/get-trust-iocs\.mdx:.*read-only/);
});

test("missing the 100 requests/minute figure fails on every file it's missing from", () => {
  const result = checkTrustClaims({
    readFile: () => CLEAN_ADVISORY.replace("100 requests/minute per IP", "a generous limit"),
  });
  assert.equal(result.failures.length, 3);
  for (const f of result.failures) assert.match(f, /100 requests\/minute/);
});

test("a stale/disproven rate-limit figure re-appearing fails", () => {
  const result = checkPageText(`${CLEAN_ADVISORY}\n(previously: 1 req/sec)`, { checkSigned: false });
  assert.equal(result.length, 1);
  assert.match(result[0], /stale\/disproven/);
});

test("an un-hedged 'is signed' claim on the IoC page fails", () => {
  const text = CLEAN_IOC.replace("is not cryptographically signed today", "is cryptographically signed");
  const result = checkPageText(text, { checkSigned: true });
  assert.ok(result.some((f) => /signed/.test(f)));
});

test("an un-hedged 'signed feed' / 'signed bundle' claim on the IoC page fails", () => {
  for (const phrase of ["this is a signed feed", "a signed bundle is returned"]) {
    const result = checkPageText(`${CLEAN_IOC}\n${phrase}`, { checkSigned: true });
    assert.ok(result.some((f) => /signed/.test(f)), phrase);
  }
});

test("our own negated phrasing ('is not ... signed') does not false-positive", () => {
  assert.deepEqual(checkPageText(CLEAN_IOC, { checkSigned: true }), []);
});

test("the signed-claim rule only applies when checkSigned is true (advisory pages)", () => {
  assert.deepEqual(checkPageText(`${CLEAN_ADVISORY}\nis signed`, { checkSigned: false }), []);
});
