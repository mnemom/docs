import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

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

const brokenLinks = [];
const internalLinkRe = /\[.*?\]\((\/?[a-z][^)#\s]*)(#[^)]+)?\)/gi;

for (const f of mdxFiles) {
  const content = readFileSync(f, 'utf-8');
  const rel = relative(root, f);
  let m;
  while ((m = internalLinkRe.exec(content)) !== null) {
    const href = m[1];
    if (href.startsWith('/') && !href.startsWith('//') && !href.includes('.')) {
      const normalized = href.replace(/\/$/, '');
      if (!pages.has(normalized) && !pages.has(normalized + '/index')) {
        brokenLinks.push({ file: rel, href });
      }
    }
  }
}

if (brokenLinks.length === 0) {
  console.log('No broken internal page links found.');
} else {
  console.log('Potentially broken internal links:');
  for (const b of brokenLinks) {
    console.log(`  ${b.file}: ${b.href}`);
  }
}
console.log(`Scanned ${mdxFiles.length} MDX/MD files.`);
