# Demo Page Enhancements — Design

**Date:** 2026-04-18  
**Status:** Approved

## Goal

Make the demo page and main page visually compelling and evidence-backed:
- Show real scenario context (what each PR changed, what VCR found)
- Link directly to GitHub PRs and live Grafana dashboard
- Embed a short GIF of the interactive triage flow on the main page
- Screenshot Grafana for reliable embedding (avoids cold-start iframe spinner)

---

## 1. Demo Page — Scenario Cards (Section 6)

**Location:** existing `demo-scenarios-grid` in `demo.astro`

Each card gets:
- **PR context line** — 1 sentence describing what the PR was changing
- **Top findings** — up to 3 findings with severity badges (critical/high/medium/low)
- **GitHub PR button** — "View PR #N on GitHub →" for metacircular scenarios (PR #1, #2, #3); Payment Service has no PR (standalone, omit button)

PR mapping:
- Securing the AI Client → PR #1: https://github.com/VirtusLab/visdom-code-review/pull/1
- Refactoring the Gate → PR #2: https://github.com/VirtusLab/visdom-code-review/pull/2
- Hollow Test Suite → PR #3: https://github.com/VirtusLab/visdom-code-review/pull/3

PR context descriptions (written from the scenario findings):
- **PR #1 Securing the AI Client** — "A refactor that introduced an Anthropic SDK wrapper — VCR caught a hardcoded API key, missing retry backoff, and overly broad exception handling."
- **PR #2 Refactoring the Gate** — "A rewrite of the deterministic gate regex patterns — VCR found SQL injection vectors in the new rule matchers, a fire-and-forget async bug, and a null dereference."
- **PR #3 Hollow Test Suite** — "A test coverage expansion that looked green — VCR's L2 flagged circular mock-on-mock patterns covering 0 real behaviors."
- **Payment Service (standalone)** — "A Python payment service PR — VCR found SQL injection, plaintext card/CVV logging, and a hardcoded secret key."

---

## 2. Demo Page — Grafana Section (New Section 7)

**Location:** after Section 6 (Scenario Cards), before `</BaseLayout>`

Contents:
- Label: "LIVE METRICS DASHBOARD"
- Heading: "Team health — measured on every PR"
- Static screenshot of `vcr-grafana.fly.dev` dashboard (saved to `public/screenshots/grafana-dashboard.png`)
- Screenshot is wrapped in `<a href="https://vcr-grafana.fly.dev" target="_blank">` — clicking opens live Grafana
- Subtext: "Anonymous read access · updates on every PR · powered by Grafana on fly.io"

**Grafana data seeding:**
Check the dashboard's datasource. If it uses a JSON/CSV static datasource, populate with representative timeseries:
- PR Cycle Time: declining trend 240min → 45min over 8 weeks
- Avg Cost/PR: stable ~$0.03
- False Positive Rate: 8%
- Acceptance Rate: 91%
- ITS (Issue Tracking Score) gauge: 0.82
- CPI (Code Performance Index) gauge: 0.78

---

## 3. Main Page — "See it in action" Section

**Location:** `index.astro` after Feature Row 2 (Risk classification), before the stat cards / FAQ

Contents:
- Label: "SEE IT IN ACTION"
- Heading: "Interactive demo — real PRs, real findings"
- `<img src="/demo.gif" alt="VCR triage demo">` — the recorded GIF
- Button: `<a href="/demo/">Explore the demo →</a>` (internal link, NOT blank)
- Secondary link: `<a href="https://vcr-grafana.fly.dev" target="_blank">Live Grafana dashboard ↗</a>`

---

## 4. GIF Recording

**Tool:** Playwright + ffmpeg (convert PNG frames to GIF via palette)  
**Script:** `demo/scripts/record-demo-gif.ts`  
**Output:** `public/demo.gif`  
**Duration:** ~8 seconds  
**Sequence:**
1. Open `http://localhost:4321/demo/` (dev server)
2. Wait for page to render
3. Scroll to Section 4 (Triage)
4. Click "Hollow Test Suite" scenario button
5. Wait for triage diagram to animate
6. Highlight L2 findings (pause 1s)
7. Capture ~40 frames at 5fps → convert to GIF

**Resolution:** 1200×700px viewport, crop to triage section

---

## 5. Grafana Screenshot

**Tool:** Playwright  
**Script:** `demo/scripts/screenshot-grafana.ts`  
**Source:** `https://vcr-grafana.fly.dev` (live, anonymous access)  
**Output:** `public/screenshots/grafana-dashboard.png`  
**Steps:**
1. Open Grafana URL, wait for dashboard to fully render (wait for `.panel-container` elements)
2. Take fullpage=false screenshot at 1400×900
3. Save to public/

---

## File Changes

| File | Change |
|------|--------|
| `src/pages/demo.astro` | Expand scenario cards + add Grafana section |
| `src/pages/index.astro` | Add "See it in action" section with GIF |
| `src/styles/landing.css` | Styles for new index section |
| `public/screenshots/grafana-dashboard.png` | Grafana screenshot (generated) |
| `public/demo.gif` | Demo animation (generated) |
| `demo/scripts/screenshot-grafana.ts` | Playwright screenshot script |
| `demo/scripts/record-demo-gif.ts` | Playwright GIF recording script |

---

## Out of Scope

- Real-time data streaming to Grafana
- Iframe embed of Grafana (cold-start problem)
- Animated Grafana screenshots
