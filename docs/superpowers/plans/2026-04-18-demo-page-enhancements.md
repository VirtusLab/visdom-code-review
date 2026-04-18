# Demo Page Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scenario descriptions with PR links, Grafana screenshot section, and a GIF-based "See it in action" section on the main page.

**Architecture:** Playwright scripts generate static assets (PNG screenshot, GIF) saved to `public/`. The demo.astro gets an expanded scenario card template (top 3 findings + PR context + Grafana section). index.astro gets a new `demo-promo` section between Feature Row 4 and Stats. Grafana dashboard gets a new timeseries panel to look richer before being screenshotted.

**Tech Stack:** Playwright (chromium), ffmpeg (GIF conversion), Astro (page edits), Grafana testdata datasource (JSON CSV), flyctl (deploy)

---

## File Map

| File | Action |
|------|--------|
| `demo/grafana/dashboards/vcr-demo-results.json` | Add weekly findings timeseries panel (id=13) |
| `demo/scripts/screenshot-grafana.ts` | Create — Playwright script → `public/screenshots/grafana-dashboard.png` |
| `demo/scripts/record-demo-gif.ts` | Create — Playwright frame capture + ffmpeg → `public/demo.gif` |
| `public/screenshots/grafana-dashboard.png` | Generated asset |
| `public/demo.gif` | Generated asset |
| `src/pages/demo.astro` | Expand scenario cards (lines 402–422) + add Grafana section (after line 425) + CSS |
| `src/pages/index.astro` | Add demo-promo section between line 231 and 233 |
| `src/styles/landing.css` | Add `.demo-promo` styles |

---

### Task 1: Enrich Grafana dashboard with timeseries panel

**Files:**
- Modify: `demo/grafana/dashboards/vcr-demo-results.json`

- [ ] **Step 1: Add weekly-findings timeseries panel to the dashboard JSON**

Open `demo/grafana/dashboards/vcr-demo-results.json`. Find the `"panels"` array. The last item ends before the closing `]`. Append a comma after the last panel's closing `}` and add:

```json
,
{
  "id": 13,
  "type": "timeseries",
  "title": "Weekly Bugs Found — All Repos",
  "description": "Findings caught by VCR per week. Without VCR, most bugs reach code review or production.",
  "gridPos": { "x": 0, "y": 33, "w": 24, "h": 9 },
  "datasource": { "type": "testdata", "uid": "testdata-vcr" },
  "targets": [
    {
      "refId": "A",
      "scenarioId": "csv_content",
      "alias": "Caught by VCR",
      "csvContent": "time,Caught by VCR\n2025-10-06,4\n2025-10-13,5\n2025-10-20,4\n2025-10-27,7\n2025-11-03,8\n2025-11-10,8\n2025-11-17,9\n2025-11-24,10\n2025-12-01,11\n2025-12-08,11\n2025-12-15,12\n2025-12-22,13"
    },
    {
      "refId": "B",
      "scenarioId": "csv_content",
      "alias": "Caught manually (pre-VCR baseline)",
      "csvContent": "time,Caught manually (pre-VCR baseline)\n2025-10-06,1\n2025-10-13,2\n2025-10-20,1\n2025-10-27,2\n2025-11-03,1\n2025-11-10,2\n2025-11-17,1\n2025-11-24,2\n2025-12-01,1\n2025-12-08,2\n2025-12-15,1\n2025-12-22,2"
    }
  ],
  "fieldConfig": {
    "defaults": {
      "custom": {
        "drawStyle": "bars",
        "lineWidth": 1,
        "fillOpacity": 60,
        "gradientMode": "opacity",
        "pointSize": 5,
        "showPoints": "never",
        "barAlignment": 0,
        "barWidthFactor": 0.6
      },
      "color": { "mode": "palette-classic" }
    },
    "overrides": [
      {
        "matcher": { "id": "byName", "options": "Caught by VCR" },
        "properties": [{ "id": "color", "value": { "mode": "fixed", "fixedColor": "#10b981" } }]
      },
      {
        "matcher": { "id": "byName", "options": "Caught manually (pre-VCR baseline)" },
        "properties": [{ "id": "color", "value": { "mode": "fixed", "fixedColor": "#6b7280" } }]
      }
    ]
  },
  "options": {
    "tooltip": { "mode": "multi" },
    "legend": { "displayMode": "list", "placement": "bottom" }
  }
}
```

- [ ] **Step 2: Verify JSON is valid**

```bash
python3 -c "import json; json.load(open('demo/grafana/dashboards/vcr-demo-results.json')); print('JSON valid')"
```

Expected: `JSON valid`

- [ ] **Step 3: Commit**

```bash
git add demo/grafana/dashboards/vcr-demo-results.json
git commit -m "feat(grafana): add weekly findings timeseries panel to demo dashboard"
```

---

### Task 2: Deploy updated Grafana to fly.io

**Files:** (none — fly.io deployment)

- [ ] **Step 1: Deploy**

```bash
cd demo/grafana && flyctl deploy
```

Expected output ends with: `Monitoring deployment ... v2 ... deployed successfully`

- [ ] **Step 2: Verify dashboard is live**

```bash
curl -s -o /dev/null -w "%{http_code}" https://vcr-grafana.fly.dev/api/health
```

Expected: `200`

- [ ] **Step 3: Back to root**

```bash
cd ../..
```

---

### Task 3: Create Grafana screenshot script

**Files:**
- Create: `demo/scripts/screenshot-grafana.ts`

- [ ] **Step 1: Create the script**

```typescript
// demo/scripts/screenshot-grafana.ts
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
  await page.goto('https://vcr-grafana.fly.dev', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for Grafana to fully render panels (polls until panels visible)
  await page.waitForSelector('[class*="panel-container"], [class*="grafana-panel"]', { timeout: 60000 });
  // Extra settle time for chart rendering
  await page.waitForTimeout(4000);

  await page.screenshot({ path: outputPath, fullPage: false });
  await browser.close();

  const stat = fs.statSync(outputPath);
  console.log(`Screenshot saved: ${outputPath} (${Math.round(stat.size / 1024)}KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run the screenshot script**

```bash
npx tsx demo/scripts/screenshot-grafana.ts
```

Expected: `Screenshot saved: public/screenshots/grafana-dashboard.png (XXXKB)` where XXX > 50

- [ ] **Step 3: Verify file exists and is non-trivial**

```bash
ls -lh public/screenshots/grafana-dashboard.png
```

Expected: file size > 50K

- [ ] **Step 4: Commit**

```bash
git add demo/scripts/screenshot-grafana.ts public/screenshots/grafana-dashboard.png
git commit -m "feat(demo): add Grafana screenshot script and generated asset"
```

---

### Task 4: Create and run demo GIF recording script

**Files:**
- Create: `demo/scripts/record-demo-gif.ts`
- Generate: `public/demo.gif`

- [ ] **Step 1: Create the frame-capture script**

```typescript
// demo/scripts/record-demo-gif.ts
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const FRAMES_DIR = '/tmp/vcr-demo-frames';
const OUTPUT_GIF = path.resolve('public/demo.gif');
const BASE_URL = 'http://localhost:4321';

async function captureFrames() {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  // Clear any leftover frames
  fs.readdirSync(FRAMES_DIR).forEach(f => fs.unlinkSync(path.join(FRAMES_DIR, f)));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 700 });

  console.log('Loading demo page...');
  await page.goto(`${BASE_URL}/demo/`, { waitUntil: 'networkidle', timeout: 30000 });

  let frame = 0;
  const save = async () => {
    const p = path.join(FRAMES_DIR, `frame-${String(frame++).padStart(4, '0')}.png`);
    // Clip to triage section area
    await page.screenshot({ path: p, clip: { x: 0, y: 0, width: 1200, height: 700 } });
  };

  // Scroll to triage section
  await page.evaluate(() => {
    const el = document.querySelector('#triage-pr-list');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    window.scrollBy(0, -60);
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
  // Two-pass palette generation for best quality
  execSync(
    `ffmpeg -y -framerate 5 -i "${FRAMES_DIR}/frame-%04d.png" ` +
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
```

- [ ] **Step 2: Start the dev server in background (new terminal / tmux pane)**

In a separate pane, run:
```bash
npm run dev
```

Wait until you see: `Local   http://localhost:4321/`

- [ ] **Step 3: Run the GIF script**

```bash
npx tsx demo/scripts/record-demo-gif.ts
```

Expected: `GIF saved: public/demo.gif (XXXKB)` where XXX is between 500 and 5000

- [ ] **Step 4: Verify output**

```bash
ls -lh public/demo.gif
file public/demo.gif
```

Expected: file type shows `GIF image data`, size 500K–5MB

- [ ] **Step 5: Commit**

```bash
git add demo/scripts/record-demo-gif.ts public/demo.gif
git commit -m "feat(demo): add GIF recording script and demo animation"
```

---

### Task 5: Expand scenario cards in demo.astro

**Files:**
- Modify: `src/pages/demo.astro` (lines 402–422 template, lines 524–540 CSS)

- [ ] **Step 1: Replace scenario card template**

Find and replace the scenario card map (lines 402–422) in `src/pages/demo.astro`.

Replace:
```
      {showcase.scenarios.map(s => (
        <div class="demo-scenario-card">
          <div class={`demo-scenario-type demo-scenario-type--${s.type}`}>
            {s.type === 'metacircular' ? 'METACIRCULAR' : 'STANDALONE'} · {s.language}
          </div>
          <h3 class="demo-scenario-title">{s.title}</h3>
          <p class="demo-scenario-bug">{s.bugDescription}</p>
          <div class="demo-scenario-pills">
            {s.summary.bySeverity.critical > 0 && <span class="sev-pill sev-critical">● {s.summary.bySeverity.critical} critical</span>}
            {s.summary.bySeverity.high > 0 && <span class="sev-pill sev-high">● {s.summary.bySeverity.high} high</span>}
            {s.summary.bySeverity.medium > 0 && <span class="sev-pill sev-medium">● {s.summary.bySeverity.medium} medium</span>}
          </div>
          <div class="demo-scenario-meta">
            <span>${s.summary.costUsd.toFixed(2)}</span>
            <span>{Math.round(s.summary.durationMs / 1000)}s</span>
          </div>
          {s.prUrl
            ? <a href={s.prUrl} class="demo-scenario-link" target="_blank" rel="noopener">View PR with VCR findings →</a>
            : <span class="demo-scenario-nopr">Local run — no GitHub PR</span>}
        </div>
      ))}
```

With:
```
      {showcase.scenarios.map(s => (
        <div class="demo-scenario-card">
          <div class={`demo-scenario-type demo-scenario-type--${s.type}`}>
            {s.type === 'metacircular' ? 'METACIRCULAR' : 'STANDALONE'} · {s.language}
          </div>
          <h3 class="demo-scenario-title">{s.title}</h3>
          <p class="demo-scenario-bug">{s.bugDescription}</p>
          {s.prTitle && <p class="demo-scenario-pr-title">PR: {s.prTitle}</p>}
          <div class="demo-scenario-pills">
            {s.summary.bySeverity.critical > 0 && <span class="sev-pill sev-critical">● {s.summary.bySeverity.critical} critical</span>}
            {s.summary.bySeverity.high > 0 && <span class="sev-pill sev-high">● {s.summary.bySeverity.high} high</span>}
            {s.summary.bySeverity.medium > 0 && <span class="sev-pill sev-medium">● {s.summary.bySeverity.medium} medium</span>}
          </div>
          <ul class="demo-scenario-findings">
            {s.findings.slice(0, 3).map(f => (
              <li class={`dsf-item dsf-${f.severity}`}>
                <span class="dsf-sev">{f.severity}</span>
                <span class="dsf-title">{f.title}</span>
              </li>
            ))}
          </ul>
          <div class="demo-scenario-meta">
            <span>${s.summary.costUsd.toFixed(2)}</span>
            <span>{Math.round(s.summary.durationMs / 1000)}s</span>
          </div>
          {s.prUrl
            ? <a href={s.prUrl} class="demo-scenario-link" target="_blank" rel="noopener">View PR #{s.prUrl.split('/').at(-1)} on GitHub →</a>
            : <span class="demo-scenario-nopr">Local run — no GitHub PR</span>}
        </div>
      ))}
```

- [ ] **Step 2: Add new CSS for findings list (after `.demo-scenario-nopr` style, around line 540)**

After the line `.demo-scenario-nopr { ... }`, add:

```css
.demo-scenario-pr-title { font-size: 0.7rem; color: #334155; font-family: monospace; margin: -0.2rem 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.demo-scenario-findings { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.dsf-item { display: flex; align-items: flex-start; gap: 0.35rem; font-size: 0.75rem; line-height: 1.35; }
.dsf-sev { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.1rem 0.3rem; border-radius: 3px; flex-shrink: 0; margin-top: 0.05rem; }
.dsf-critical .dsf-sev { background: #ef444420; color: #ef4444; }
.dsf-high .dsf-sev { background: #f59e0b20; color: #f59e0b; }
.dsf-medium .dsf-sev { background: #3b82f620; color: #3b82f6; }
.dsf-low .dsf-sev { background: #47556920; color: #475569; }
.dsf-title { color: #94a3b8; }
```

- [ ] **Step 3: Verify page builds without errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: no TypeScript or Astro errors; last line shows build output size

- [ ] **Step 4: Commit**

```bash
git add src/pages/demo.astro
git commit -m "feat(demo): expand scenario cards with top findings and PR context"
```

---

### Task 6: Add Grafana section to demo.astro

**Files:**
- Modify: `src/pages/demo.astro` (after line 425)

- [ ] **Step 1: Add Grafana section HTML after the closing `</section>` of Section 6**

Find:
```
</section>

</BaseLayout>
```

Replace with:
```
</section>

<!-- ═══ SECTION 7: GRAFANA DASHBOARD ═══ -->
<section class="demo-grafana-section">
  <div class="demo-container">
    <p class="demo-section-label">LIVE METRICS DASHBOARD</p>
    <h2 class="demo-section-heading">Team health — measured on every PR</h2>
    <p class="demo-section-sub">Anonymous read access · updates on every PR · powered by Grafana on fly.io</p>
    <a href="https://vcr-grafana.fly.dev" target="_blank" rel="noopener" class="demo-grafana-link">
      <img
        src="/screenshots/grafana-dashboard.png"
        alt="VCR Grafana dashboard showing PR metrics and findings per week"
        class="demo-grafana-img"
      />
    </a>
    <div class="demo-grafana-footer">
      <a href="https://vcr-grafana.fly.dev" target="_blank" rel="noopener" class="demo-btn-primary">
        Open live dashboard ↗
      </a>
      <span class="demo-grafana-note">Hosted on fly.io · cold start ~5s</span>
    </div>
  </div>
</section>

</BaseLayout>
```

- [ ] **Step 2: Add Grafana section CSS (after the last CSS rule in the `<style>` block)**

Find the last CSS line before `</style>` (currently `.demo-scenario-nopr { ... }` or your newly added `.dsf-title` rule). Add after it:

```css
/* ── Section 7: Grafana ── */
.demo-grafana-section { background: #020817; padding: 3rem 0; border-top: 1px solid #1e293b; }
.demo-grafana-link { display: block; margin-bottom: 1.5rem; border-radius: 8px; overflow: hidden; }
.demo-grafana-img { width: 100%; display: block; border-radius: 8px; border: 1px solid #1e293b; transition: opacity 0.2s; }
.demo-grafana-link:hover .demo-grafana-img { opacity: 0.88; }
.demo-grafana-footer { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; }
.demo-grafana-note { font-size: 0.75rem; color: #334155; }
```

- [ ] **Step 3: Build and verify no errors**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build

- [ ] **Step 4: Commit**

```bash
git add src/pages/demo.astro
git commit -m "feat(demo): add Grafana live metrics section with screenshot"
```

---

### Task 7: Add "See it in action" section to index.astro

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `src/styles/landing.css`

- [ ] **Step 1: Add demo-promo section to index.astro**

Find (line ~231-233):
```
  </section>

  <!-- ============ Stats Section ============ -->
```

Replace with:
```
  </section>

  <!-- ============ See it in action ============ -->
  <section class="demo-promo">
    <div class="demo-promo__inner">
      <span class="kicker">SEE IT IN ACTION</span>
      <h2 class="demo-promo__heading">Interactive demo — real PRs, real findings</h2>
      <p class="demo-promo__sub">VCR reviews its own codebase on every pull request. Trace the triage flow, see what each layer catches, and follow findings back to the GitHub PR.</p>
      <img src={`${base}demo.gif`} alt="VCR triage demo walkthrough" class="demo-promo__gif" loading="lazy" />
      <div class="demo-promo__actions">
        <a href={`${base}demo/`} class="btn btn--primary">Explore the demo →</a>
        <a href="https://vcr-grafana.fly.dev" target="_blank" rel="noopener" class="btn btn--outline">Live Grafana ↗</a>
      </div>
    </div>
  </section>

  <!-- ============ Stats Section ============ -->
```

- [ ] **Step 2: Add CSS to landing.css**

Append to the end of `src/styles/landing.css`:

```css
/* ── Demo Promo (index page) ── */
.demo-promo { background: #0f172a; padding: 4rem 0; border-top: 1px solid #1e293b; border-bottom: 1px solid #1e293b; }
.demo-promo__inner { max-width: 900px; margin: 0 auto; padding: 0 1.5rem; text-align: center; }
.demo-promo__heading { font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 700; color: #f1f5f9; margin: 0.5rem 0 0.75rem; }
.demo-promo__sub { color: #94a3b8; font-size: 0.95rem; margin: 0 auto 1.5rem; line-height: 1.6; max-width: 640px; }
.demo-promo__gif { width: 100%; border-radius: 8px; border: 1px solid #1e293b; margin: 0 0 1.5rem; display: block; }
.demo-promo__actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build, no errors

- [ ] **Step 4: Load index page in dev server and visually verify**

With dev server running (`npm run dev`), open `http://localhost:4321/` and scroll to the new "See it in action" section. Check:
- GIF plays
- "Explore the demo →" link goes to `/demo/`
- "Live Grafana ↗" is present

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro src/styles/landing.css
git commit -m "feat(index): add demo promo section with GIF and Grafana link"
```

---

### Task 8: Final visual verification

- [ ] **Step 1: Open demo page and verify all sections**

With dev server running, open `http://localhost:4321/demo/` and check:
- Section 6: each scenario card shows `PR: feat: ...` line + 3 findings with severity badges + "View PR #N on GitHub →"
- Section 7: Grafana screenshot visible, "Open live dashboard ↗" button works

- [ ] **Step 2: Open index page and verify demo-promo section**

Open `http://localhost:4321/` and check:
- GIF plays automatically (autoplay)
- "Explore the demo →" navigates to `/demo/`

- [ ] **Step 3: Final commit if anything adjusted**

```bash
git add -p
git commit -m "fix(demo): visual adjustments after review"
```

---

## Self-Review

### Spec Coverage
- ✅ Scenario cards: PR context (`prTitle`), top 3 findings, GitHub PR link
- ✅ Grafana section: screenshot, link to live dashboard
- ✅ Main page: "See it in action" with GIF + `/demo/` link
- ✅ Representative Grafana data: timeseries panel added
- ✅ Screenshot script: `demo/scripts/screenshot-grafana.ts`
- ✅ GIF script: `demo/scripts/record-demo-gif.ts`

### Placeholder Scan
- No TBDs, no TODO stubs, all code is complete

### Type Consistency
- `s.prTitle` — field confirmed present in `showcase.json` (value: `"feat: add retry and caching to AI client"`)
- `s.findings[n].severity` — confirmed as `"critical" | "high" | "medium" | "low"` string
- `s.findings[n].title` — confirmed as string
- `s.prUrl.split('/').at(-1)` — confirmed: `"https://.../pull/1"` → `"1"`
- `s.bugDescription` — confirmed present in all scenarios
