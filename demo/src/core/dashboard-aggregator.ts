import type { ExternalReviewResult } from './external-reviewer.js';

export interface DashboardOutput {
  repo: string;
  generatedAt: string;
  prsReviewed: number;
  prsTotal: number;
  timeseries: Array<{ week: string; findings: number }>;
  severity: { critical: number; high: number; medium: number; low: number };
  categories: { security: number; correctness: number; performance: number; maintainability: number };
  coverage: { reviewed: number; total: number; pct: number };
  topFindings: Array<{ title: string; count: number; files: string[] }>;
}

export interface GrafanaCSV {
  timeseries_csv: string;
  severity_csv: string;
  categories_csv: string;
  coverage_csv: string;
  top_findings_csv: string;
}

function getWeekMonday(isoDate: string): string {
  const d = new Date(isoDate);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function mapCategory(category: string): keyof DashboardOutput['categories'] {
  const c = category.toLowerCase();
  if (c === 'security') return 'security';
  if (c === 'performance') return 'performance';
  if (['correctness', 'null-safety', 'error-handling', 'concurrency', 'resource'].includes(c)) return 'correctness';
  return 'maintainability';
}

export class DashboardAggregator {
  aggregate(results: ExternalReviewResult[], opts: { owner: string; repo: string }): DashboardOutput {
    const allFindings = results.flatMap(r => r.findings);

    const severity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of allFindings) severity[f.severity]++;

    const categories = { security: 0, correctness: 0, performance: 0, maintainability: 0 };
    for (const f of allFindings) categories[mapCategory(f.category)]++;

    const weekMap = new Map<string, number>();
    for (const r of results) {
      const week = getWeekMonday(r.mergedAt);
      weekMap.set(week, (weekMap.get(week) ?? 0) + r.findings.length);
    }
    const timeseries = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, findings]) => ({ week, findings }));

    const byTitle = new Map<string, { count: number; files: Set<string> }>();
    for (const f of allFindings) {
      if (!byTitle.has(f.title)) byTitle.set(f.title, { count: 0, files: new Set() });
      const entry = byTitle.get(f.title)!;
      entry.count++;
      entry.files.add(f.file);
    }
    const topFindings = Array.from(byTitle.entries())
      .map(([title, { count, files }]) => ({ title, count, files: Array.from(files) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      repo: `${opts.owner}/${opts.repo}`,
      generatedAt: new Date().toISOString(),
      prsReviewed: results.length,
      prsTotal: results.length,
      timeseries,
      severity,
      categories,
      coverage: { reviewed: results.length, total: results.length, pct: 100 },
      topFindings,
    };
  }

  toCsvContent(output: DashboardOutput): GrafanaCSV {
    const timeseries_csv = 'time,findings\n' +
      output.timeseries.map(t => `${t.week},${t.findings}`).join('\n');

    const { critical, high, medium, low } = output.severity;
    const severity_csv = `Critical,High,Medium,Low\n${critical},${high},${medium},${low}`;

    const { security, correctness, performance, maintainability } = output.categories;
    const categories_csv = `Security,Correctness,Performance,Maintainability\n${security},${correctness},${performance},${maintainability}`;

    const coverage_csv = `value\n${output.coverage.pct}`;

    const top_findings_csv = 'Finding Type,Count\n' +
      output.topFindings.map(f => `${f.title},${f.count}`).join('\n');

    return { timeseries_csv, severity_csv, categories_csv, coverage_csv, top_findings_csv };
  }
}
