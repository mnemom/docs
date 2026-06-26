import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const IMG_DIR = '/home/runner/work/docs/docs/trees/4bdbc488/agents/4bdbc488/reviewer/review_img';
mkdirSync(IMG_DIR, { recursive: true });

const BASE = 'http://localhost:4121';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

// Wait for server to be responsive
let attempts = 0;
while (attempts < 20) {
  try {
    await page.goto(BASE + '/concepts/risk-assessment', { timeout: 5000, waitUntil: 'networkidle' });
    break;
  } catch (e) {
    attempts++;
    await new Promise(r => setTimeout(r, 2000));
  }
}

// Screenshot 1: The new proof lifecycle section
await page.goto(BASE + '/concepts/risk-assessment', { waitUntil: 'networkidle' });
// Scroll to the ZK proofs section
await page.evaluate(() => {
  const el = document.querySelector('[id="proof-lifecycle-and-fail-open-behavior"]') ||
             document.querySelector('[id="zero-knowledge-proofs"]');
  if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
});
await page.screenshot({ path: `${IMG_DIR}/01_proof_lifecycle_section.png`, fullPage: false });
console.log('Screenshot 1 taken');

// Screenshot 2: API reference proof_status description
await page.goto(BASE + '/api-reference/risk-overview', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const el = document.querySelector('[id="get-proof"]') ||
             document.querySelector('[id="assess-individual-risk"]');
  if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
});
await page.screenshot({ path: `${IMG_DIR}/02_api_reference_proof_status.png`, fullPage: false });
console.log('Screenshot 2 taken');

await browser.close();
console.log('Done');
