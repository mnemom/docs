import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const mdxFiles = [];

function walkDir(dir) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
        walkDir(full);
      } else if (stat.isFile() && (entry.endsWith('.mdx') || entry.endsWith('.md'))) {
        mdxFiles.push(full);
      }
    }
  } catch(e) {}
}

walkDir(root);

const pages = new Set();
for (const f of mdxFiles) {
  const rel = relative(root, f).replace(/\.(mdx|md)$/, '');
  pages.add('/' + rel);
}

// Extract internal link targets from both markdown and JSX/MDX syntax.
function extractInternalLinks(content) {
  const links = [];
  let m;
  // Markdown-style: [text](/path) — path before optional fragment
  const mdRe = /\[.*?\]\((\/?[a-z][^)#\s]*)(#[^)]+)?\)/gi;
  while ((m = mdRe.exec(content)) !== null) {
    links.push(m[1]);
  }
  // JSX/MDX href attribute: href="/path" or href='/path' — strip fragment
  const jsxRe = /href=["'](\/[^"']+)/gi;
  while ((m = jsxRe.exec(content)) !== null) {
    const raw = m[1];
    const hashIdx = raw.indexOf('#');
    links.push(hashIdx >= 0 ? raw.slice(0, hashIdx) : raw);
  }
  return links;
}

function isInternalPath(href) {
  return href.startsWith('/') && !href.startsWith('//') && !href.includes('.');
}

// ── Broken link check ─────────────────────────────────────────────────────────
const brokenLinks = [];

for (const f of mdxFiles) {
  const content = readFileSync(f, 'utf-8');
  const rel = relative(root, f);
  for (const href of extractInternalLinks(content)) {
    if (isInternalPath(href)) {
      const normalized = href.replace(/\/$/, '');
      if (!pages.has(normalized) && !pages.has(normalized + '/index')) {
        brokenLinks.push({ file: rel, href });
      }
    }
  }
}

if (brokenLinks.length === 0) {
  console.log('✓ No broken internal page links found.');
} else {
  console.log('Potentially broken internal links:');
  for (const b of brokenLinks) {
    console.log(`  ${b.file}: ${b.href}`);
  }
}

// ── Cross-locale link check ──────────────────────────────────────────────────
// For pages under fr/ or es/, every internal link whose target has no
// same-locale translation is a "locale leak". Intentional EN fallbacks must be
// listed in locale-link-allowlist.json with a reason; everything else is an
// error. The allowlist is meant to shrink over time as sections get translated.

const allowlistPath = join(__dirname, 'locale-link-allowlist.json');
let allowlist = [];
if (existsSync(allowlistPath)) {
  allowlist = JSON.parse(readFileSync(allowlistPath, 'utf-8'));
}

// Build fast lookup: "locale:target"
const allowSet = new Set();
for (const entry of allowlist) {
  const locales = entry.locales ?? [entry.locale];
  for (const locale of locales) {
    allowSet.add(`${locale}:${entry.target}`);
  }
}

const LOCALES = ['fr', 'es'];
const leakMap = new Map(); // key "locale:target" → first occurrence details

for (const f of mdxFiles) {
  const rel = relative(root, f);
  const locale = LOCALES.find(l => rel.startsWith(l + '/'));
  if (!locale) continue;

  const content = readFileSync(f, 'utf-8');
  for (const href of extractInternalLinks(content)) {
    if (!isInternalPath(href)) continue;
    const normalized = href.replace(/\/$/, '');
    // Skip links that already target this locale's subtree
    if (normalized.startsWith('/' + locale + '/')) continue;
    // Check whether a same-locale version of this page exists
    const localizedPath = '/' + locale + normalized;
    if (pages.has(localizedPath) || pages.has(localizedPath + '/index')) continue;
    const key = `${locale}:${normalized}`;
    if (!allowSet.has(key) && !leakMap.has(key)) {
      leakMap.set(key, { file: rel, href: normalized, locale });
    }
  }
}

const leaks = [...leakMap.values()];

if (leaks.length === 0) {
  console.log('✓ No unallowlisted cross-locale links found.');
} else {
  console.log(`\n✗ ${leaks.length} cross-locale link(s) not in allowlist:`);
  for (const l of leaks) {
    console.log(`  [${l.locale}] ${l.file}: ${l.href}`);
  }
  console.log(
    '\n  Fix: add these to scripts/locale-link-allowlist.json with a reason,\n' +
    '  or update the localized page to use the same-locale equivalent.'
  );
}

console.log(`\nScanned ${mdxFiles.length} MDX/MD files.`);

if (leaks.length > 0) process.exit(1);
