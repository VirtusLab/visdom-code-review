# External PR Review Tool — Design Spec

**Date:** 2026-04-18  
**Status:** Approved

## Goal

Add a production-quality `review` CLI to the demo toolset that can review arbitrary GitHub PRs and batch-scan repos, generating both raw findings and Grafana-ready dashboard metrics with historical timeseries.

## Approach

Thin CLI entrypoint + two core services. Pattern follows `bench-martian.ts` exactly.

## File Structure

```
demo/src/
  cli/
    review.ts                    ← new entrypoint (~80 lines, arg parsing only)
  core/
    external-reviewer.ts         ← new: PRFetcher + ReviewPipeline wrapper
    dashboard-aggregator.ts      ← new: findings[] → Grafana csvContent + metrics JSON
demo/cache/
  external/                      ← new cache dir for external PR reviews
demo/package.json                ← add "review": "tsx src/cli/review.ts"
```

## CLI Interface

```bash
# Single PR — pretty terminal output (same chalk style as existing demo)
npm run review pr https://github.com/owner/repo/pull/46

# Batch repo — last N merged PRs
npm run review repo owner/repo --count 10

# Batch repo — since date
npm run review repo owner/repo --since 2026-01-01

# Batch repo — combined filters
npm run review repo owner/repo --count 20 --since 2026-02-01
```

Terminal output for `repo`: `[3/10] Reviewing PR #46 — feat: inline kernels...` progress, then summary table.

## Output Files (repo mode)

Both always written:

```
cache/external/<owner>-<repo>-results.json    ← raw findings per PR
cache/external/<owner>-<repo>-dashboard.json  ← Grafana-ready metrics
```

## Dashboard Metrics Schema

`<owner>-<repo>-dashboard.json`:

```json
{
  "repo": "owner/repo",
  "generatedAt": "2026-04-18T...",
  "prsReviewed": 18,
  "prsTotal": 20,
  "timeseries": [
    { "week": "2026-01-19T00:00:00Z", "findings": 7 },
    { "week": "2026-01-26T00:00:00Z", "findings": 4 }
  ],
  "severity": { "critical": 3, "high": 12, "medium": 18, "low": 6 },
  "categories": { "security": 8, "correctness": 14, "performance": 5, "maintainability": 12 },
  "coverage": { "reviewed": 18, "total": 20, "pct": 90 },
  "topFindings": [
    { "title": "Missing input validation", "count": 5, "files": ["src/Foo.java"] }
  ],
  "grafana": {
    "timeseries_csv": "time,findings\n2026-01-19T00:00:00Z,7\n...",
    "severity_csv": "Critical,High,Medium,Low\n3,12,18,6",
    "categories_csv": "Security,Correctness,Performance,Maintainability\n8,14,5,12",
    "coverage_csv": "value\n90",
    "top_findings_csv": "Finding Type,Count\nMissing input validation,5\n..."
  }
}
```

## Core Modules

### `external-reviewer.ts`

```typescript
export interface ExternalReviewResult {
  pr: PRMetadata;
  findings: Finding[];
  metrics: { durationMs: number; costUsd: number; l3Triggered: boolean };
  mergedAt: string; // ISO date from GitHub API
}

export class ExternalReviewer {
  constructor(opts: { token: string; cacheDir: string; ai: AIClient })
  async reviewPR(prUrl: string): Promise<ExternalReviewResult>
  async listMergedPRs(owner: string, repo: string, opts: { count?: number; since?: string }): Promise<string[]>
}
```

Reuses `PRFetcher`, `ReviewPipeline`, all 4 layers unchanged.

### `dashboard-aggregator.ts`

```typescript
export class DashboardAggregator {
  aggregate(results: ExternalReviewResult[], opts: { owner: string; repo: string }): DashboardOutput
  toCsvContent(output: DashboardOutput): GrafanaCSV
}
```

Weeks computed as ISO Monday of the PR's `mergedAt` date. Categories mapped from `finding.category` field (existing values in findings).

## History Accumulation

`results.json` uses append-by-PR-number: if a PR is already in cache (keyed by PR number), it is skipped on re-run. New PRs are reviewed and appended. Dashboard JSON is regenerated from full results on every run.

## Out of Scope

- Updating Grafana dashboard JSON automatically (manual step: copy csvContent)
- Authentication beyond `gh auth token` / `GITHUB_TOKEN`
- Review of non-merged PRs in batch mode
- Parallel PR review (sequential, rate-limit safe)
