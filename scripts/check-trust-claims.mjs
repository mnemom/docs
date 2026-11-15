#!/usr/bin/env node
/**
 * check-trust-claims.mjs — Trust-surface claims regression gate (issue #620, card G).
 *
 * The three public Trust-surface endpoint pages (`GET /trust/iocs`,
 * `GET /trust/advisories`, `GET /trust/advisories/{slug}`) carry a
 * hand-written `<Note>` body (below the generated frontmatter — see
 * `AGENTS.md` on not hand-editing generated `api-reference/` pages) stating
 * three facts: the endpoints are read-only today, the real gateway rate
 * limit (100 requests/minute per IP, MNE-240), and — for the IoC feed only
 * — that the STIX bundle is not cryptographically signed today.
 *
 * This script guards against those facts silently regressing (e.g. a future
 * edit that drops the read-only language, or reintroduces an un-hedged
 * "signed feed" claim, or a stale rate-limit number creeping back in).
 * It does NOT detect a future *correct* change to the real limit or signing
 * status — only regression to a previously-disproven or dropped claim.
 *
 * Follows the house pattern used by scripts/check-nav-pages.mjs and
 * scripts/check-internal-refs.mjs: an exported pure check function, a
 * `--self-test` mode with inline fixtures, and a thin CLI `main()`.
 * Exit codes: 0 clean, 1 violation, 2 usage error.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { argv, exit } from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Target pages, relative to the repo root. `signed` rules only apply to the
// IoC feed — there is no analogous "signed" claim anywhere about advisories.
export const TARGET_FILES = [
  { rel: "api-reference/endpoint/get-trust-iocs.mdx", checkSigned: true },
  { rel: "api-reference/endpoint/get-trust-advisories.mdx", checkSigned: false },
  { rel: "api-reference/endpoint/get-trust-advisories-slug.mdx", checkSigned: false },
];

const READ_ONLY_RE = /read[- ]only/i;
const RATE_LIMIT_RE = /100\s+requests[\s/]minute|100\s+requests\s+per\s+minute/i;
const STALE_RATE_LIMIT_RE = /\b1 req(?:uest)?s?\s*\/\s*(sec|second|min|minute)\b/i;
const SIGNED_CLAIM_RE = /\bis\s+(?:cryptographically\s+)?signed\b/i;
const SIGNED_FEED_RE = /\bsigned\s+(?:stix\s+)?(?:feed|bundle)\b/i;

/**
 * Checks a single page's text against the claim rules. Returns an array of
 * failure strings (empty when the page is clean).
 */
export function checkPageText(text, { checkSigned }) {
  const failures = [];
  if (!READ_ONLY_RE.test(text)) {
    failures.push('does not mention "read-only" (or "read only")');
  }
  if (!RATE_LIMIT_RE.test(text)) {
    failures.push('does not state the "100 requests/minute" rate limit');
  }
  if (STALE_RATE_LIMIT_RE.test(text)) {
    failures.push("re-introduces a stale/disproven rate-limit figure (e.g. \"1 request per second/minute\")");
  }
  if (checkSigned && (SIGNED_CLAIM_RE.test(text) || SIGNED_FEED_RE.test(text))) {
    failures.push('re-introduces an un-hedged "is signed" / "signed feed" claim');
  }
  return failures;
}

/**
 * Core check (exported shape for --self-test). `readFile(rel)` returns the
 * text content for a repo-relative path — injectable so --self-test can run
 * against in-memory fixtures instead of disk.
 */
export function checkTrustClaims({ readFile = (rel) => readFileSync(join(ROOT, rel), "utf8"), files = TARGET_FILES } = {}) {
  const failures = [];
  let checked = 0;
  for (const { rel, checkSigned } of files) {
    checked++;
    const text = readFile(rel);
    for (const reason of checkPageText(text, { checkSigned })) {
      failures.push(`${rel}: ${reason}`);
    }
  }
  return { checked, failures };
}

// ── Self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0;
  let fail = 0;
  const assert = (name, cond) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}`); }
  };

  const CLEAN_IOC = `---\ntitle: "x"\n---\n\n<Note>\n**Read-only today.** There is no API to submit indicators. Requests share\nthe global per-IP gateway limit: 100 requests/minute per IP. The STIX\nbundle is not cryptographically signed today — signing is planned.\n</Note>\n`;
  const CLEAN_ADVISORY = `---\ntitle: "x"\n---\n\n<Note>\n**Read-only today.** This endpoint only supports GET. Requests share the\nglobal per-IP gateway limit: 100 requests/minute per IP.\n</Note>\n`;

  // 1) Fully-compliant fixtures → 0 failures.
  const cleanRun = checkTrustClaims({
    readFile: (rel) => (rel.includes("iocs") ? CLEAN_IOC : CLEAN_ADVISORY),
  });
  assert("compliant fixtures → 0 failures", cleanRun.failures.length === 0);
  assert("compliant fixtures → checked 3 files", cleanRun.checked === 3);

  // 2) Missing "read-only" → exactly that rule fails, for that file only.
  const noReadOnly = checkTrustClaims({
    readFile: (rel) => (rel.includes("get-trust-iocs") ? CLEAN_IOC.replace(/Read-only today\./, "") : CLEAN_ADVISORY),
  });
  assert("missing read-only phrase → 1 failure", noReadOnly.failures.length === 1);
  assert("failure names read-only rule", /does not mention "read-only"/.test(noReadOnly.failures[0]));
  assert("failure attributes the iocs file", noReadOnly.failures[0].startsWith("api-reference/endpoint/get-trust-iocs.mdx"));

  // 3) Missing rate-limit figure.
  const noRateLimit = checkTrustClaims({
    readFile: () => CLEAN_ADVISORY.replace("100 requests/minute per IP", "a generous limit"),
  });
  assert("missing rate limit → 3 failures (one per file)", noRateLimit.failures.length === 3);
  assert("failure names rate-limit rule", noRateLimit.failures.every((f) => /100 requests\/minute/.test(f)));

  // 4) Stale/disproven rate-limit figure re-appears.
  const staleRateLimit = checkTrustClaims({
    readFile: () => `${CLEAN_ADVISORY}\n(previously: 1 req/sec)`,
  });
  assert("stale figure regression → flagged", staleRateLimit.failures.some((f) => /stale\/disproven/.test(f)));

  // 5) Un-hedged signing claim on the IoC page → flagged.
  const signedClaim = checkTrustClaims({
    readFile: (rel) => (rel.includes("get-trust-iocs") ? CLEAN_IOC.replace("is not cryptographically signed today", "is cryptographically signed") : CLEAN_ADVISORY),
  });
  assert("un-hedged signed claim on iocs page → flagged", signedClaim.failures.some((f) => f.includes("get-trust-iocs") && /signed/.test(f)));

  // 6) Negated phrasing ("is not ... signed") must NOT false-positive.
  assert("negated 'not ... signed' phrasing does not trip the signed-claim rule", checkPageText(CLEAN_IOC, { checkSigned: true }).length === 0);

  // 7) "signed feed"/"signed bundle" claim also flagged (second pattern).
  const signedFeedClaim = checkPageText(`${CLEAN_IOC}\nThis is a signed feed.`, { checkSigned: true });
  assert('"signed feed" claim → flagged', signedFeedClaim.some((f) => /signed/.test(f)));

  // 8) The signed-claim rule is scoped to the IoC page only — an advisory
  //    page is never checked for it, even with checkSigned: false.
  assert("advisory pages are not checked for the signed-claim rule", checkPageText(`${CLEAN_ADVISORY}\nis signed`, { checkSigned: false }).length === 0);

  console.log(`\nself-test: ${pass}/${pass + fail} assertions passed`);
  return fail === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Only run when executed directly (`node scripts/check-trust-claims.mjs`),
// never when imported by the test harness — importing must not trigger exit().
function main() {
  const args = argv.slice(2);
  if (args.includes("--self-test")) {
    exit(selfTest() ? 0 : 1);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: check-trust-claims.mjs [--self-test] [--help]");
    exit(0);
  }
  if (args.length > 0) {
    console.error(`Unknown flag: ${args[0]}`);
    exit(2);
  }

  let result;
  try {
    result = checkTrustClaims();
  } catch (err) {
    console.error(`✗ Could not read a target page: ${err.message}`);
    exit(1);
  }

  if (result.failures.length > 0) {
    console.error(`\n✗ check-trust-claims: ${result.failures.length} problem(s) found:`);
    for (const f of result.failures) console.error(`  - ${f}`);
    exit(1);
  }
  console.log(`✓ check-trust-claims: ${result.checked} Trust-surface page(s) state read-only, rate-limit, and signing facts correctly.`);
  exit(0);
}

const isMain = argv[1] && import.meta.url === pathToFileURL(argv[1]).href;
if (isMain) main();
