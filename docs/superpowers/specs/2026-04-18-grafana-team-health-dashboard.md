# Grafana Team Health Dashboard — Quality Pulse

**Date:** 2026-04-18  
**Status:** Approved

## Goal

Replace the current benchmark-results dashboard (`vcr-demo-results.json`) with a "Quality Pulse" dashboard that looks like real production monitoring for a tech lead overseeing code review across multiple repositories.

## Context

The Grafana instance at `vcr-grafana.fly.dev` uses the Grafana TestData datasource (CSV content embedded in dashboard JSON). All data is static but must look realistic and tell a coherent story.

## Audience

Tech lead / principal engineer tracking code quality trends across services.

## Repositories (fictional, realistic names)

| Repo | Language | Story |
|------|----------|-------|
| `api-gateway` | TypeScript | Improving: 12 → 6 findings/week over 12w |
| `auth-service` | Go | Consistently clean: 2–3/week |
| `payment-processor` | Java | Had spike at week 8 (15 findings), resolved to 8 |
| `data-pipeline` | Python | Rising concern: 4 → 10/week (should trigger action) |
| `frontend-app` | React/TS | Stable medium: 5–7/week |

## Dashboard Layout (8 panels)

### Row 1 — Hero stats (4 stat panels, single row)
- **Findings this week** — total across all repos: 38
- **Critical findings this week** — 3
- **PR coverage** — % of PRs reviewed by VCR: 94%
- **Week-over-week trend** — findings delta: ↓ -12%

### Row 2 — Timeseries (full width)
- **"Findings per week — all repos"** — 12 weeks of data, one line per repo
- data-pipeline line styled red (highest/rising), auth-service styled green (lowest/stable)

### Row 3 — Two bar charts side by side
- **Left: Severity breakdown per repo** — stacked barchart, Critical/High/Medium/Low
- **Right: Finding category per repo** — barchart, categories: Security / Correctness / Performance / Maintainability

### Row 4 — Coverage + table
- **Left: PR coverage % per repo** — horizontal barchart
- **Right: Top 5 finding types** — table with columns: Finding Type, Count, Repos Affected

## Data

All panels use `grafana-testdata-datasource` with `csv_content` scenario. Data is embedded directly in the dashboard JSON — no external datasource needed.

### Timeseries dates
12 weeks ending 2026-04-14 (Mon):
`2026-01-19, 2026-01-26, 2026-02-02, 2026-02-09, 2026-02-16, 2026-02-23, 2026-03-02, 2026-03-09, 2026-03-16, 2026-03-23, 2026-03-30, 2026-04-06`

### Per-repo findings (timeseries)
```
api-gateway:       12, 11, 10, 9, 9, 8, 8, 7, 7, 6, 6, 6
auth-service:       3,  2,  3, 2, 2, 3, 2, 3, 2, 2, 3, 2
payment-processor:  7,  7,  8, 8, 9,10,11,15,12,10, 9, 8
data-pipeline:      4,  4,  5, 5, 6, 6, 7, 7, 8, 9,10,10
frontend-app:       6,  5,  6, 7, 6, 5, 6, 6, 7, 6, 5, 6
```

### Severity per repo (current week)
```
Repo,Critical,High,Medium,Low
api-gateway,0,2,3,1
auth-service,0,0,2,0
payment-processor,1,3,3,1
data-pipeline,2,4,3,1
frontend-app,0,1,4,1
```

### Category per repo (current week)
```
Repo,Security,Correctness,Performance,Maintainability
api-gateway,1,3,1,1
auth-service,0,2,0,0
payment-processor,2,3,2,1
data-pipeline,3,4,2,1
frontend-app,0,3,1,2
```

### PR coverage % per repo
```
Repo,Coverage
api-gateway,98
auth-service,100
payment-processor,92
data-pipeline,89
frontend-app,96
```

### Top finding types (table)
```
Finding Type,Count,Repos
Missing input validation,18,"api-gateway, data-pipeline, payment-processor"
Unhandled async error,12,"api-gateway, frontend-app"
Insecure data exposure,9,"data-pipeline, payment-processor"
Race condition risk,7,data-pipeline
Missing rate limiting,5,api-gateway
```

## Implementation

1. Rewrite `demo/grafana/dashboards/vcr-team-health.json` with the new panels
2. Remove `vcr-demo-results.json` references from provisioning and fly.toml
3. Update `GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH` in fly.toml to point to `vcr-team-health.json`
4. Deploy to fly.io (`fly deploy` from `demo/grafana/`)
5. Update screenshot `public/screenshots/grafana-dashboard.png`

## Out of scope
- Real datasource integration (stays TestData)
- Authentication / per-user views
- Alerting rules
- Dashboard variables / filters
