import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardAggregator } from '../core/dashboard-aggregator.js';
import type { ExternalReviewResult } from '../core/external-reviewer.js';

function makeResult(prNum: number, mergedAt: string, findings: Array<{ severity: string; category: string; title: string; file: string }>): ExternalReviewResult {
  return {
    pr: { number: prNum, url: `https://github.com/a/b/pull/${prNum}`, branch: 'main', title: `PR ${prNum}`, body: '', filesChanged: 1, linesAdded: 10, linesRemoved: 5 },
    findings: findings.map((f, i) => ({
      id: `L1-${i}`, severity: f.severity as 'critical' | 'high' | 'medium' | 'low',
      category: f.category, file: f.file, title: f.title, description: 'd', layer: 1, confidence: 0.9,
    })),
    metrics: { durationMs: 1000, costUsd: 0.01, l3Triggered: false },
    mergedAt,
  };
}

describe('DashboardAggregator', () => {
  const agg = new DashboardAggregator();

  test('aggregate counts PRs and findings', () => {
    const results = [
      makeResult(1, '2026-01-19T12:00:00Z', [{ severity: 'critical', category: 'security', title: 'SQLi', file: 'Foo.java' }]),
      makeResult(2, '2026-01-21T12:00:00Z', [{ severity: 'high', category: 'correctness', title: 'Null deref', file: 'Bar.java' }]),
    ];
    const out = agg.aggregate(results, { owner: 'a', repo: 'b' });
    assert.equal(out.repo, 'a/b');
    assert.equal(out.prsReviewed, 2);
    assert.equal(out.severity.critical, 1);
    assert.equal(out.severity.high, 1);
    assert.equal(out.severity.medium, 0);
    assert.equal(out.severity.low, 0);
    assert.equal(out.categories.security, 1);
    assert.equal(out.categories.correctness, 1);
  });

  test('aggregate groups findings by ISO week Monday', () => {
    const results = [
      makeResult(1, '2026-01-19T00:00:00Z', [{ severity: 'high', category: 'security', title: 'A', file: 'x.ts' }, { severity: 'low', category: 'security', title: 'B', file: 'y.ts' }]),
      makeResult(2, '2026-01-26T00:00:00Z', [{ severity: 'medium', category: 'correctness', title: 'C', file: 'z.ts' }]),
    ];
    const out = agg.aggregate(results, { owner: 'a', repo: 'b' });
    assert.equal(out.timeseries.length, 2);
    assert.equal(out.timeseries[0].week, '2026-01-19T00:00:00Z');
    assert.equal(out.timeseries[0].findings, 2);
    assert.equal(out.timeseries[1].week, '2026-01-26T00:00:00Z');
    assert.equal(out.timeseries[1].findings, 1);
  });

  test('aggregate maps unknown categories to maintainability', () => {
    const results = [makeResult(1, '2026-01-19T00:00:00Z', [{ severity: 'low', category: 'readability', title: 'X', file: 'f.ts' }])];
    const out = agg.aggregate(results, { owner: 'a', repo: 'b' });
    assert.equal(out.categories.maintainability, 1);
  });

  test('aggregate topFindings groups by title and collects files', () => {
    const results = [
      makeResult(1, '2026-01-19T00:00:00Z', [
        { severity: 'high', category: 'security', title: 'Missing validation', file: 'A.java' },
        { severity: 'high', category: 'security', title: 'Missing validation', file: 'B.java' },
        { severity: 'low', category: 'correctness', title: 'Null deref', file: 'C.java' },
      ]),
    ];
    const out = agg.aggregate(results, { owner: 'a', repo: 'b' });
    assert.equal(out.topFindings[0].title, 'Missing validation');
    assert.equal(out.topFindings[0].count, 2);
    assert.deepEqual(out.topFindings[0].files.sort(), ['A.java', 'B.java']);
  });

  test('toCsvContent generates correct CSV strings', () => {
    const results = [
      makeResult(1, '2026-01-19T00:00:00Z', [{ severity: 'critical', category: 'security', title: 'SQLi', file: 'F.java' }]),
    ];
    const out = agg.aggregate(results, { owner: 'a', repo: 'b' });
    const csv = agg.toCsvContent(out);
    assert.ok(csv.timeseries_csv.startsWith('time,findings\n'));
    assert.ok(csv.timeseries_csv.includes('2026-01-19T00:00:00Z,1'));
    assert.equal(csv.severity_csv, 'Critical,High,Medium,Low\n1,0,0,0');
    assert.ok(csv.categories_csv.startsWith('Security,Correctness,Performance,Maintainability\n'));
    assert.equal(csv.coverage_csv, `value\n${out.coverage.pct}`);
    assert.ok(csv.top_findings_csv.startsWith('Finding Type,Count\n'));
  });
});
