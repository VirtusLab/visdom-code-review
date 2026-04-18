import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const FRAMES_DIR = '/tmp/vcr-demo-frames';
const OUTPUT_GIF = path.resolve('public/demo.gif');
// Use IPv6 loopback since the Astro dev server binds to ::1 on macOS
// Base path /visdom-code-review/ is configured in astro.config.mjs
const BASE_URL = 'http://[::1]:4321/visdom-code-review';

async function captureFrames() {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  fs.readdirSync(FRAMES_DIR).forEach(f => fs.unlinkSync(path.join(FRAMES_DIR, f)));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 700 });

  console.log('Loading demo page...');
  await page.goto(`${BASE_URL}/demo/`, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for inline scripts to create the triage buttons
  await page.waitForSelector('.triage-pr-btn', { timeout: 10000 });
  console.log('Triage buttons ready.');

  let frame = 0;
  const save = async () => {
    const p = path.join(FRAMES_DIR, `frame-${String(frame++).padStart(4, '0')}.png`);
    await page.screenshot({ path: p, clip: { x: 0, y: 0, width: 1200, height: 700 } });
  };

  // Scroll to triage section — use the section container so the heading is visible
  await page.evaluate(() => {
    const el = document.querySelector('.demo-triage-section');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    window.scrollBy(0, -10);
  });
  await page.waitForTimeout(300);

  // 2s pause on initial state — 10 frames at 5fps
  for (let i = 0; i < 10; i++) { await save(); await page.waitForTimeout(200); }

  // Click "Securing the AI Client" (first scenario)
  const btns = await page.$$('.triage-pr-btn');
  if (btns[0]) { await btns[0].click(); await page.waitForTimeout(200); }
  for (let i = 0; i < 12; i++) { await save(); await page.waitForTimeout(200); }

  // Click "Hollow Test Suite" (third scenario)
  if (btns[2]) { await btns[2].click(); await page.waitForTimeout(200); }
  for (let i = 0; i < 12; i++) { await save(); await page.waitForTimeout(200); }

  // Click "Payment Service" (fourth scenario)
  if (btns[3]) { await btns[3].click(); await page.waitForTimeout(200); }
  for (let i = 0; i < 12; i++) { await save(); await page.waitForTimeout(200); }

  await browser.close();
  console.log(`Captured ${frame} frames`);
}

function framesToGif() {
  console.log('Converting frames to GIF...');
  execSync(
    `/opt/homebrew/bin/ffmpeg -y -framerate 5 -i "${FRAMES_DIR}/frame-%04d.png" ` +
    `-vf "fps=5,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" ` +
    `"${OUTPUT_GIF}"`,
    { stdio: 'inherit' }
  );
  fs.rmSync(FRAMES_DIR, { recursive: true });
  const stat = fs.statSync(OUTPUT_GIF);
  console.log(`GIF saved: ${OUTPUT_GIF} (${Math.round(stat.size / 1024)}KB)`);
}

async function main() {
  await captureFrames();
  framesToGif();
}

main().catch(err => { console.error(err); process.exit(1); });
