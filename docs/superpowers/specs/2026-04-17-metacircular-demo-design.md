# Metacircular Demo Design

**Date:** 2026-04-17  
**Status:** Approved  
**Author:** Artur Skowronski (brainstormed with Claude)

## Goal

Create a compelling, client-facing demo of VCR (Visdom Code Review) that runs on the `visdom-code-review` repository itself — metacircularly. Every PR on this repo is reviewed by VCR. The demo makes this visible, verifiable, and emotionally compelling for both executives and engineers.

The tagline: **"We don't show you a toy demo. VCR reviews its own codebase on every pull request."**

---

## Approach: Metacircular Showcase (Option C)

Lead with the "visdom created with visdom" story. The primary evidence is real GitHub PRs with real VCR findings posted as comments. Standalone scenarios exist as supporting material.

**Not chosen:** Stats-first (A) or Replay-mode (B) — metacircular authenticity is more compelling than animated charts.

---

## Scenarios

### Metacircular (3 — changes to this repo's TypeScript code)

**1. `demo/meta/insecure-ai-client`**
- PR title: "feat: add retry and caching to AI client"
- Bugs: hardcoded API key in source, full prompt logged to stdout (PII), retry loop without backoff (thundering herd)
- VCR catches: L1 detects hardcoded secret (SEC-001) + PII log (SEC-003); L3 catches missing timeout, broken retry counter
- Total: 4 findings (1 critical, 2 high, 1 medium)
- Branch: `demo/meta/insecure-ai-client`

**2. `demo/meta/broken-deterministic-gate`**
- PR title: "refactor: clean up deterministic gate patterns"
- Bugs: SQL injection check weakened (SELECT only, not INSERT/UPDATE), timing-unsafe JWT compare added, SSRF rule accidentally commented out, regex flag removed breaking multiline diffs
- VCR catches: L1 finds weakened SQL regex (LOGIC-003); L2 flags security regression; L3 finds 4 more regressions in the layer that was supposed to prevent them
- Total: 7 findings (2 critical, 3 high, 2 medium)
- Branch: `demo/meta/broken-deterministic-gate`

**3. `demo/meta/hollow-test-suite`**
- PR title: "test: add comprehensive pipeline layer tests"
- Bugs: 15 tests that each mock their subject and assert spy calls only — zero behavioral assertions, coverage theater at 100%
- VCR catches: L2 circular test detection; L3 test quality lens finds 13/15 circular + zero integration tests
- Total: 5 findings (0 critical, 3 high, 2 medium)
- Branch: `demo/meta/hollow-test-suite`

### Standalone (1 — Python, different domain)

**4. `demo/standalone/payment-service`**
- PR title: "feat: add payment processing endpoint"
- Language: Python FastAPI
- Bugs: SQL injection via f-string, card number logged in plaintext (PCI violation), JWT secret = "secret", no rate limiting on `/charge`
- VCR catches: L1 hits SQL injection + hardcoded secret; L2 adds PII/card log; L3 finds rate limiting gap + idempotency issue
- Total: 4 findings (2 critical, 2 high)
- Mode: local only (no GitHub PR — standalone scenarios don't run against this repo)

---

## Data Pipeline

### Scripts

**`demo/scripts/run-showcase.ts`**
- Runs all 4 scenarios using existing pipeline infrastructure
- Modes: `--local` (no GitHub PR) or `--live` (creates real GitHub PRs, posts findings as comments)
- Outputs `demo/results/showcase.json`
- Run once locally to generate initial state; committed to repo

**`demo/results/showcase.json`** — committed, read by Astro at build time:
```json
{
  "generatedAt": "2026-04-17T...",
  "scenarios": [
    {
      "name": "meta/insecure-ai-client",
      "title": "Securing the AI Client",
      "prTitle": "feat: add retry and caching to AI client",
      "prUrl": "https://github.com/VirtusLab/visdom-code-review/pull/47",
      "findings": [...],
      "summary": {
        "totalFindings": 4,
        "bySeverity": { "critical": 1, "high": 2, "medium": 1 },
        "costUsd": 0.44,
        "durationMs": 91000,
        "l3Triggered": true
      }
    }
  ],
  "aggregate": {
    "totalFindings": 20,
    "bySeverity": { "critical": 5, "high": 10, "medium": 5 },
    "avgCostUsd": 0.39,
    "avgDurationMs": 82000,
    "l3TriggerRate": 1.0
  }
}
```

### GitHub Actions

**`.github/workflows/vcr-review.yml`**
- Trigger: `pull_request` (opened, synchronize, reopened)
- Steps: checkout → install deps → run VCR in local mode → post findings as PR comment
- Requires: `ANTHROPIC_API_KEY` secret in repo settings
- Output: structured PR comment with findings grouped by layer + severity
- This is the live metacircular piece — all real PRs to this repo get VCR review

**`.github/workflows/vcr-showcase.yml`**
- Trigger: weekly cron (`0 9 * * 1`) + `workflow_dispatch` (manual)
- Steps: run all 4 scenarios with `--live` flag → commit updated `showcase.json` → trigger Astro redeploy
- Purpose: keep website metrics fresh from real runs

---

## Website: `demo.astro` Sections

### Section 1 — Metacircular Hero
- Headline: "Visdom Created with Visdom"
- Subtext: "VCR reviews its own codebase on every PR. Not a toy example."
- CTA button: "See last PR review on GitHub" (links to most recent VCR comment)
- Stat strip: aggregate numbers from `showcase.json` (findings, avg cost, avg time)

### Section 2 — Live PR Ticker
- Shows last 3–5 PRs reviewed by VCR
- Each row: PR number · title · finding count (colored by max severity) · cost · duration · link to GitHub
- Data: **two sources merged at build time**:
  - `demo/results/showcase.json` — the 3 metacircular demo PRs (always present, initial state)
  - `demo/results/live-reviews.json` — real PRs reviewed by the `vcr-review.yml` action (empty until first real PR, grows over time)
- The ticker shows the most recent 5 entries from both sources, sorted by date
- `live-reviews.json` is written by `vcr-review.yml` on each real PR: appends `{ prNumber, prTitle, prUrl, findings summary, costUsd, durationMs, reviewedAt }`

### Section 3 — 4 Metrics Charts (Chart.js, CDN)
All charts use data from `showcase.json`. No external dependencies.

**Chart 1 — Findings by Severity (stacked bar)**
- X: scenario names; Y: count
- Colors: critical=#ef4444, high=#f59e0b, medium=#3b82f6, low=#6b7280
- Grounded in: real run output

**Chart 2 — Cost Per Layer (horizontal bar)**
- Bars: L0 ($0), L1 ($0), L2 (~$0.02), L3 (~$0.40)
- Annotation: "L3 runs only for HIGH/CRITICAL PRs (30–50% trigger rate)"
- Grounded in: real layer metrics from `LayerMetrics.costUsd`

**Chart 3 — F1 Score vs Market (horizontal bar)**
- VCR 43% (honest, advisor judge, 50 PRs) vs CodeRabbit 39–51%, Qodo 60%, Cubic 62%, Propel 64%
- VCR bar highlighted green; note: "We publish our real numbers including where we fall short"
- Grounded in: `docs/architecture-decisions.md` benchmark section

**Chart 4 — 4x Hidden Tax Breakdown (donut)**
- Segments: AI licenses 5%, compute 24%, tokens 22%, human review overhead 49%
- Center: "18x reported budget"
- Grounded in: `guide/leaders.astro` cost breakdown

### Section 4 — PR Triage Flow (interactive)
- Scenario selector (tabs): 4 demo PRs + "Without VCR" comparison
- Click any PR → trace path through L0 → L1 → L2 → L3
- Each layer node shows: findings, cost, gate decision
- "Why these findings?" toggle at each layer with explanation text
- Data: read from `showcase.json` findings + hardcoded layer explanations

### Section 5 — Timeline: When Does the Human Enter?
- Swim lane diagram: VCR Pipeline / GitHub / Human — across time axis
- Time scale: compressed (first 2min = 40% width, remainder = 60%)
- Events: layer blocks, finding markers, first human engagement marker
- Click any event → detail panel shows what happened and **why the human was needed at that specific moment**
- "Without VCR" tab shows: 24h wait, human starts from scratch, 12 of 14 bugs missed
- Data split: **layer timing** (durationMs per layer) comes from `showcase.json`; **narrative content** (human engagement timing, "why" explanations, "Without VCR" comparison) is hardcoded in the component — it's editorial content, not metrics

### Section 6 — Scenario Cards (4 cards)
- Grid 2×2: metacircular cards (purple label) + standalone card (amber label)
- Each card: scenario title, bug types, severity pills, cost, duration, link to GitHub PR
- Data: `showcase.json`

### Existing sections below (unchanged)
- Grafana Docker setup
- "Connect to your real repo" guide
- CTA

---

## File Changes Required

```
demo/
  src/
    scenarios/
      meta/
        insecure-ai-client/
          scenario.ts
          files/src/core/ai/client.ts       ← intentionally buggy version
        broken-deterministic-gate/
          scenario.ts
          files/src/core/layers/deterministic-gate.ts
        hollow-test-suite/
          scenario.ts
          files/test/pipeline.test.ts
      standalone/
        payment-service/
          scenario.ts
          files/payment/routes.py
          files/payment/models.py
    cli/
      index.ts                              ← add 4 new scenarios to SCENARIOS map
    scripts/
      run-showcase.ts                       ← NEW: runs all scenarios, writes showcase.json
  results/
    showcase.json                           ← NEW: committed initial state

.github/
  workflows/
    vcr-review.yml                          ← NEW: run VCR on every PR
    vcr-showcase.yml                        ← NEW: weekly refresh of showcase.json

src/
  pages/
    demo.astro                              ← REPLACE: new 6-section layout
```

---

## Constraints

- **No new npm dependencies** for the website. Charts via Chart.js CDN (already in place).
- **Standalone payment service** runs in local mode only — Python files reviewed by VCR, no GitHub PR created.
- **Initial state committed** so demo works on day one without running live API calls.
- **VCR review action** requires `ANTHROPIC_API_KEY` secret — document in README that this is needed to activate.
- **Scenario files** contain intentional bugs. Each file must have a comment at the top: `// DEMO SCENARIO — intentional vulnerabilities for VCR demonstration`.
- **Demo PR lifecycle**: when `run-showcase.ts --live` runs, it creates GitHub PRs on branches `demo/meta/*`. These PRs are **left open** as permanent demonstration PRs — clients can visit them and see real VCR findings. The `--cleanup` flag closes and deletes them. The showcase.json records the PR URL so the website can link directly.
- **Benchmark data** (Chart 3) is hardcoded from `architecture-decisions.md` — not from `showcase.json`. It's stable benchmark data, not per-run metrics.

---

## Success Criteria

1. `npm run demo:showcase` runs all 4 scenarios locally and writes `showcase.json`
2. `npm run demo:showcase -- --live` creates real GitHub PRs with VCR findings posted as comments
3. `demo.astro` page renders all 6 sections with real data from `showcase.json`
4. All 4 Chart.js charts render with correct data
5. Triage flow and timeline visualizations are interactive (click events work)
6. GitHub Action triggers on PR open and posts VCR findings as a PR comment
7. A client can open a PR link from the demo page and see real VCR findings on GitHub
