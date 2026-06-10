const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = '/home/runner/work/docs/docs/trees/e02adf2e/agents/e02adf2e/reviewer/review_img';
const CHROME_PATH = '/home/runner/.cache/puppeteer/chrome/linux-127.0.6533.72/chrome-linux64/chrome';

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  await page.setViewportSize({ width: 1280, height: 900 });

  console.log('Navigating to http://localhost:4115/quickstart/self-hosted ...');
  try {
    await page.goto('http://localhost:4115/quickstart/self-hosted', { waitUntil: 'networkidle', timeout: 20000 });
  } catch (e) {
    console.log('networkidle timed out, proceeding...');
    await page.waitForTimeout(2000);
  }

  // 1. Full-page screenshot
  const s1 = path.join(OUTPUT_DIR, '01_self_hosted_top.png');
  await page.screenshot({ path: s1, fullPage: true });
  console.log('Saved:', s1);

  // 2. Environment variables section - scroll to it
  const s2 = path.join(OUTPUT_DIR, '02_self_hosted_env_vars.png');
  let found2 = false;
  const envTerms = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'environment variable', 'Environment Variables', 'Environment variables'];
  for (const term of envTerms) {
    try {
      const loc = page.locator(`text=${term}`).first();
      const count = await loc.count();
      if (count > 0) {
        await loc.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        found2 = true;
        console.log('Found env section via:', term);
        break;
      }
    } catch(e) {}
  }
  if (!found2) {
    console.log('Env section not found by text, using scroll 35%');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: s2 });
  console.log('Saved:', s2);

  // 3. Health check response section
  const s3 = path.join(OUTPUT_DIR, '03_self_hosted_health_response.png');
  let found3 = false;
  const healthTerms = ['health', 'Health check', '/health', 'health check response', 'status.*ok'];
  for (const term of healthTerms) {
    try {
      const loc = page.locator(`text=${term}`).first();
      const count = await loc.count();
      if (count > 0) {
        await loc.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        found3 = true;
        console.log('Found health section via:', term);
        break;
      }
    } catch(e) {}
  }
  if (!found3) {
    console.log('Health section not found by text, using scroll 60%');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6));
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: s3 });
  console.log('Saved:', s3);

  // 4. Data residency section
  const s4 = path.join(OUTPUT_DIR, '04_data_residency.png');
  let found4 = false;
  const dataTerms = ['Data residency', 'data residency', 'Data Residency', 'residency'];
  for (const term of dataTerms) {
    try {
      const loc = page.locator(`text=${term}`).first();
      const count = await loc.count();
      if (count > 0) {
        await loc.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        found4 = true;
        console.log('Found data residency section via:', term);
        break;
      }
    } catch(e) {}
  }
  if (!found4) {
    console.log('Data residency section not found, using scroll 85%');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.85));
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: s4 });
  console.log('Saved:', s4);

  await browser.close();
  console.log('Done.');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
