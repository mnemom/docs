const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = '/home/runner/work/docs/docs/trees/e02adf2e/agents/e02adf2e/reviewer/review_img';

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  await page.setViewportSize({ width: 1280, height: 900 });

  console.log('Navigating to http://localhost:4115/quickstart/self-hosted ...');
  try {
    await page.goto('http://localhost:4115/quickstart/self-hosted', { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log('networkidle timed out, proceeding after 3s wait...');
    await page.waitForTimeout(3000);
  }

  // 1. Full-page screenshot
  const s1 = path.join(OUTPUT_DIR, '01_self_hosted_top.png');
  await page.screenshot({ path: s1, fullPage: true });
  console.log('Saved:', s1);

  // 2. Environment variables section
  const s2 = path.join(OUTPUT_DIR, '02_self_hosted_env_vars.png');
  let envSection = null;
  // Try to find env var section by heading text
  const headings = ['environment variable', 'env var', 'configuration', 'configure'];
  for (const h of headings) {
    try {
      envSection = await page.locator(`text=/${h}/i`).first();
      if (await envSection.count() > 0) break;
    } catch(e) {}
  }

  if (envSection) {
    try {
      await envSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    } catch(e) {}
  } else {
    // scroll down to ~40% of page
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.4));
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: s2 });
  console.log('Saved:', s2);

  // 3. Health check response section
  const s3 = path.join(OUTPUT_DIR, '03_self_hosted_health_response.png');
  let healthSection = null;
  const healthTerms = ['health check', 'health response', '/health', 'healthcheck'];
  for (const h of healthTerms) {
    try {
      const loc = page.locator(`text=/${h}/i`).first();
      if (await loc.count() > 0) {
        healthSection = loc;
        break;
      }
    } catch(e) {}
  }

  if (healthSection) {
    try {
      await healthSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    } catch(e) {}
  } else {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.65));
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: s3 });
  console.log('Saved:', s3);

  // 4. Data residency section
  const s4 = path.join(OUTPUT_DIR, '04_data_residency.png');
  let dataSection = null;
  const dataTerms = ['data residency', 'residency', 'data region'];
  for (const h of dataTerms) {
    try {
      const loc = page.locator(`text=/${h}/i`).first();
      if (await loc.count() > 0) {
        dataSection = loc;
        break;
      }
    } catch(e) {}
  }

  if (dataSection) {
    try {
      await dataSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    } catch(e) {}
  } else {
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
