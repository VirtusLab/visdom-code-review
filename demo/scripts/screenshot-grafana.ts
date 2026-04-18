import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const outputPath = path.resolve('public/screenshots/grafana-dashboard.png');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  console.log('Opening Grafana dashboard...');
  // Navigate directly to the VCR Team Health dashboard by UID
  await page.goto('https://vcr-grafana.fly.dev/d/vcr-team-health', { waitUntil: 'load', timeout: 90000 });

  // Wait for Grafana panels to render (cold start may take a while)
  console.log('Waiting for panels to render...');
  await page.waitForTimeout(12000);

  await page.screenshot({ path: outputPath, fullPage: false });
  await browser.close();

  const stat = fs.statSync(outputPath);
  console.log(`Screenshot saved: ${outputPath} (${Math.round(stat.size / 1024)}KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
