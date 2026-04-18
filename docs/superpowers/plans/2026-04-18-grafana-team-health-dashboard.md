# Grafana Team Health Dashboard — Quality Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace benchmark-results dashboard with a "Quality Pulse" dashboard showing realistic team health metrics for a tech lead across 5 repos.

**Architecture:** Rewrite `demo/grafana/dashboards/vcr-team-health.json` (deployed to `/etc/grafana-dashboards/` on fly.io via Dockerfile COPY). Update fly.toml to point home dashboard at `vcr-team-health.json`. All data is static CSV embedded in dashboard JSON using Grafana TestData datasource.

**Tech Stack:** Grafana 11.5.0, TestData datasource (csv_content scenario), fly.io

---

### Task 1: Update fly.toml home dashboard path

**Files:**
- Modify: `demo/grafana/fly.toml`

- [ ] **Step 1: Edit fly.toml**

Change line 12 from:
```toml
GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH = "/etc/grafana-dashboards/vcr-demo-results.json"
```
To:
```toml
GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH = "/etc/grafana-dashboards/vcr-team-health.json"
```

- [ ] **Step 2: Commit**

```bash
git add demo/grafana/fly.toml
git commit -m "fix(grafana): set vcr-team-health as home dashboard"
```

---

### Task 2: Rewrite vcr-team-health.json dashboard

**Files:**
- Modify: `demo/grafana/dashboards/vcr-team-health.json`

This is a 9-panel dashboard. Replace the entire file with the JSON below.

**Story the data tells:**
- `api-gateway` (TS): improving 12→6 findings/week ✅
- `auth-service` (Go): consistently clean 2-3/week ✅
- `payment-processor` (Java): had spike at week 8 (15), resolved to 8 ⚠️→✅
- `data-pipeline` (Python): rising concern 4→10 🔴 (tech lead should act)
- `frontend-app` (React/TS): stable 5-7/week ─

- [ ] **Step 1: Write the dashboard JSON**

Overwrite `demo/grafana/dashboards/vcr-team-health.json` with:

```json
{
  "annotations": { "list": [] },
  "editable": false,
  "graphTooltip": 1,
  "links": [],
  "refresh": "",
  "schemaVersion": 38,
  "tags": ["vcr"],
  "time": { "from": "now-12w", "to": "now" },
  "timepicker": {},
  "timezone": "browser",
  "title": "VCR — Quality Pulse",
  "uid": "vcr-team-health",
  "version": 2,
  "panels": [
    {
      "id": 1,
      "title": "Findings This Week",
      "type": "stat",
      "gridPos": { "h": 4, "w": 6, "x": 0, "y": 0 },
      "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "thresholds" },
          "thresholds": { "mode": "absolute", "steps": [{ "color": "blue", "value": null }] },
          "unit": "short"
        },
        "overrides": []
      },
      "options": {
        "colorMode": "value",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "auto",
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "textMode": "auto"
      },
      "targets": [
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "A",
          "scenarioId": "csv_content",
          "csvContent": "value\n38"
        }
      ]
    },
    {
      "id": 2,
      "title": "Critical Findings This Week",
      "type": "stat",
      "gridPos": { "h": 4, "w": 6, "x": 6, "y": 0 },
      "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "thresholds" },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "green", "value": null },
              { "color": "orange", "value": 2 },
              { "color": "red", "value": 5 }
            ]
          },
          "unit": "short"
        },
        "overrides": []
      },
      "options": {
        "colorMode": "background",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "auto",
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "textMode": "auto"
      },
      "targets": [
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "A",
          "scenarioId": "csv_content",
          "csvContent": "value\n3"
        }
      ]
    },
    {
      "id": 3,
      "title": "PR Coverage",
      "type": "stat",
      "gridPos": { "h": 4, "w": 6, "x": 12, "y": 0 },
      "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "thresholds" },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "orange", "value": 80 },
              { "color": "green", "value": 90 }
            ]
          },
          "unit": "percent",
          "max": 100,
          "min": 0
        },
        "overrides": []
      },
      "options": {
        "colorMode": "value",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "auto",
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "textMode": "auto"
      },
      "targets": [
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "A",
          "scenarioId": "csv_content",
          "csvContent": "value\n94"
        }
      ]
    },
    {
      "id": 4,
      "title": "Week-over-Week Change",
      "type": "stat",
      "gridPos": { "h": 4, "w": 6, "x": 18, "y": 0 },
      "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "thresholds" },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "green", "value": null },
              { "color": "orange", "value": 0 },
              { "color": "red", "value": 10 }
            ]
          },
          "unit": "percent",
          "custom": {}
        },
        "overrides": []
      },
      "options": {
        "colorMode": "value",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "auto",
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "textMode": "value_and_name"
      },
      "targets": [
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "A",
          "scenarioId": "csv_content",
          "csvContent": "value\n-12"
        }
      ]
    },
    {
      "id": 5,
      "title": "Findings Per Week — All Repos (12 weeks)",
      "type": "timeseries",
      "gridPos": { "h": 10, "w": 24, "x": 0, "y": 4 },
      "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "palette-classic" },
          "custom": {
            "lineWidth": 2,
            "fillOpacity": 8,
            "showPoints": "auto",
            "spanNulls": false
          },
          "unit": "short"
        },
        "overrides": [
          {
            "matcher": { "id": "byName", "options": "data-pipeline" },
            "properties": [{ "id": "color", "value": { "fixedColor": "#e05151", "mode": "fixed" } }]
          },
          {
            "matcher": { "id": "byName", "options": "auth-service" },
            "properties": [{ "id": "color", "value": { "fixedColor": "#37872d", "mode": "fixed" } }]
          }
        ]
      },
      "options": {
        "legend": { "calcs": ["last", "max"], "displayMode": "table", "placement": "bottom" },
        "tooltip": { "mode": "multi", "sort": "desc" }
      },
      "targets": [
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "A",
          "scenarioId": "csv_content",
          "csvContent": "time,api-gateway\n2026-01-19T00:00:00Z,12\n2026-01-26T00:00:00Z,11\n2026-02-02T00:00:00Z,10\n2026-02-09T00:00:00Z,9\n2026-02-16T00:00:00Z,9\n2026-02-23T00:00:00Z,8\n2026-03-02T00:00:00Z,8\n2026-03-09T00:00:00Z,7\n2026-03-16T00:00:00Z,7\n2026-03-23T00:00:00Z,6\n2026-03-30T00:00:00Z,6\n2026-04-06T00:00:00Z,6"
        },
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "B",
          "scenarioId": "csv_content",
          "csvContent": "time,auth-service\n2026-01-19T00:00:00Z,3\n2026-01-26T00:00:00Z,2\n2026-02-02T00:00:00Z,3\n2026-02-09T00:00:00Z,2\n2026-02-16T00:00:00Z,2\n2026-02-23T00:00:00Z,3\n2026-03-02T00:00:00Z,2\n2026-03-09T00:00:00Z,3\n2026-03-16T00:00:00Z,2\n2026-03-23T00:00:00Z,2\n2026-03-30T00:00:00Z,3\n2026-04-06T00:00:00Z,2"
        },
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "C",
          "scenarioId": "csv_content",
          "csvContent": "time,payment-processor\n2026-01-19T00:00:00Z,7\n2026-01-26T00:00:00Z,7\n2026-02-02T00:00:00Z,8\n2026-02-09T00:00:00Z,8\n2026-02-16T00:00:00Z,9\n2026-02-23T00:00:00Z,10\n2026-03-02T00:00:00Z,11\n2026-03-09T00:00:00Z,15\n2026-03-16T00:00:00Z,12\n2026-03-23T00:00:00Z,10\n2026-03-30T00:00:00Z,9\n2026-04-06T00:00:00Z,8"
        },
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "D",
          "scenarioId": "csv_content",
          "csvContent": "time,data-pipeline\n2026-01-19T00:00:00Z,4\n2026-01-26T00:00:00Z,4\n2026-02-02T00:00:00Z,5\n2026-02-09T00:00:00Z,5\n2026-02-16T00:00:00Z,6\n2026-02-23T00:00:00Z,6\n2026-03-02T00:00:00Z,7\n2026-03-09T00:00:00Z,7\n2026-03-16T00:00:00Z,8\n2026-03-23T00:00:00Z,9\n2026-03-30T00:00:00Z,10\n2026-04-06T00:00:00Z,10"
        },
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "E",
          "scenarioId": "csv_content",
          "csvContent": "time,frontend-app\n2026-01-19T00:00:00Z,6\n2026-01-26T00:00:00Z,5\n2026-02-02T00:00:00Z,6\n2026-02-09T00:00:00Z,7\n2026-02-16T00:00:00Z,6\n2026-02-23T00:00:00Z,5\n2026-03-02T00:00:00Z,6\n2026-03-09T00:00:00Z,6\n2026-03-16T00:00:00Z,7\n2026-03-23T00:00:00Z,6\n2026-03-30T00:00:00Z,5\n2026-04-06T00:00:00Z,6"
        }
      ]
    },
    {
      "id": 6,
      "title": "Severity Breakdown Per Repo (current week)",
      "type": "barchart",
      "gridPos": { "h": 10, "w": 12, "x": 0, "y": 14 },
      "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "palette-classic" },
          "custom": { "lineWidth": 1, "fillOpacity": 80 },
          "unit": "short"
        },
        "overrides": [
          { "matcher": { "id": "byName", "options": "Critical" }, "properties": [{ "id": "color", "value": { "fixedColor": "#e05151", "mode": "fixed" } }] },
          { "matcher": { "id": "byName", "options": "High" }, "properties": [{ "id": "color", "value": { "fixedColor": "#ff9900", "mode": "fixed" } }] },
          { "matcher": { "id": "byName", "options": "Medium" }, "properties": [{ "id": "color", "value": { "fixedColor": "#fade2a", "mode": "fixed" } }] },
          { "matcher": { "id": "byName", "options": "Low" }, "properties": [{ "id": "color", "value": { "fixedColor": "#73bf69", "mode": "fixed" } }] }
        ]
      },
      "options": {
        "barWidth": 0.7,
        "groupWidth": 0.7,
        "legend": { "displayMode": "list", "placement": "bottom" },
        "stacking": "normal",
        "tooltip": { "mode": "multi", "sort": "desc" },
        "xField": "Repo"
      },
      "targets": [
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "A",
          "scenarioId": "csv_content",
          "csvContent": "Repo,Critical,High,Medium,Low\napi-gateway,0,2,3,1\nauth-service,0,0,2,0\npayment-processor,1,3,3,1\ndata-pipeline,2,4,3,1\nfrontend-app,0,1,4,1"
        }
      ]
    },
    {
      "id": 7,
      "title": "Findings by Category Per Repo (current week)",
      "type": "barchart",
      "gridPos": { "h": 10, "w": 12, "x": 12, "y": 14 },
      "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "palette-classic" },
          "custom": { "lineWidth": 1, "fillOpacity": 80 },
          "unit": "short"
        },
        "overrides": []
      },
      "options": {
        "barWidth": 0.7,
        "groupWidth": 0.7,
        "legend": { "displayMode": "list", "placement": "bottom" },
        "stacking": "normal",
        "tooltip": { "mode": "multi", "sort": "desc" },
        "xField": "Repo"
      },
      "targets": [
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "A",
          "scenarioId": "csv_content",
          "csvContent": "Repo,Security,Correctness,Performance,Maintainability\napi-gateway,1,3,1,1\nauth-service,0,2,0,0\npayment-processor,2,3,2,1\ndata-pipeline,3,4,2,1\nfrontend-app,0,3,1,2"
        }
      ]
    },
    {
      "id": 8,
      "title": "PR Coverage % Per Repo",
      "type": "barchart",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 24 },
      "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "thresholds" },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "orange", "value": 85 },
              { "color": "green", "value": 95 }
            ]
          },
          "unit": "percent",
          "min": 0,
          "max": 100,
          "custom": { "fillOpacity": 80 }
        },
        "overrides": []
      },
      "options": {
        "barWidth": 0.6,
        "groupWidth": 0.7,
        "legend": { "displayMode": "list", "placement": "bottom" },
        "stacking": "none",
        "tooltip": { "mode": "single", "sort": "none" },
        "xField": "Repo",
        "colorByField": "Coverage %"
      },
      "targets": [
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "A",
          "scenarioId": "csv_content",
          "csvContent": "Repo,Coverage %\napi-gateway,98\nauth-service,100\npayment-processor,92\ndata-pipeline,89\nfrontend-app,96"
        }
      ]
    },
    {
      "id": 9,
      "title": "Top Finding Types (last 4 weeks)",
      "type": "table",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 24 },
      "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "thresholds" },
          "custom": { "align": "auto", "displayMode": "auto" },
          "thresholds": { "mode": "absolute", "steps": [{ "color": "green", "value": null }] }
        },
        "overrides": [
          {
            "matcher": { "id": "byName", "options": "Count" },
            "properties": [
              { "id": "custom.displayMode", "value": "color-background" },
              {
                "id": "thresholds",
                "value": {
                  "mode": "absolute",
                  "steps": [
                    { "color": "green", "value": null },
                    { "color": "orange", "value": 8 },
                    { "color": "red", "value": 15 }
                  ]
                }
              }
            ]
          }
        ]
      },
      "options": {
        "footer": { "show": false },
        "showHeader": true,
        "sortBy": [{ "desc": true, "displayName": "Count" }]
      },
      "targets": [
        {
          "datasource": { "type": "grafana-testdata-datasource", "uid": "testdata-vcr" },
          "refId": "A",
          "scenarioId": "csv_content",
          "csvContent": "Finding Type,Count,Repos Affected\nMissing input validation,18,\"api-gateway, data-pipeline, payment-processor\"\nUnhandled async error,12,\"api-gateway, frontend-app\"\nInsecure data exposure,9,\"data-pipeline, payment-processor\"\nRace condition risk,7,data-pipeline\nMissing rate limiting,5,api-gateway"
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Validate JSON is well-formed**

```bash
python3 -c "import json; json.load(open('demo/grafana/dashboards/vcr-team-health.json')); print('JSON valid')"
```

Expected: `JSON valid`

- [ ] **Step 3: Commit**

```bash
git add demo/grafana/dashboards/vcr-team-health.json
git commit -m "feat(grafana): rewrite dashboard as Quality Pulse team health view"
```

---

### Task 3: Deploy to fly.io and verify

**Files:** none (deployment only)

- [ ] **Step 1: Deploy from demo/grafana/**

```bash
cd demo/grafana && fly deploy --wait-timeout 120
```

Expected output ends with: `Visit your newly deployed app at https://vcr-grafana.fly.dev/`

- [ ] **Step 2: Verify home dashboard loads with correct title**

```bash
curl -s "https://vcr-grafana.fly.dev/api/dashboards/home" | python3 -c "import sys,json; d=json.load(sys.stdin); print('title:', d['dashboard']['title']); print('panels:', len(d['dashboard']['panels']))"
```

Expected:
```
title: VCR — Quality Pulse
panels: 9
```

- [ ] **Step 3: Commit** (fly.toml change from Task 1 should already be committed — nothing new here)

---

### Task 4: Update Grafana screenshot

**Files:**
- Modify: `public/screenshots/grafana-dashboard.png`

The screenshot on the demo page (`/demo`) shows `public/screenshots/grafana-dashboard.png`. It must be updated to reflect the new dashboard.

- [ ] **Step 1: Check if screenshot script exists**

```bash
ls demo/scripts/
```

- [ ] **Step 2: Run screenshot script**

```bash
cd /Users/askowronski/Projects/visdom-code-review && npx tsx demo/scripts/screenshot-grafana.ts
```

Expected: `public/screenshots/grafana-dashboard.png` updated.

- [ ] **Step 3: Commit**

```bash
git add public/screenshots/grafana-dashboard.png
git commit -m "fix(demo): update Grafana screenshot to Quality Pulse dashboard"
```
