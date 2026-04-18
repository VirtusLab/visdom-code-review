import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardAggregator } from '../core/dashboard-aggregator.js';
import type { ExternalReviewResult } from '../core/external-reviewer.js';
import { ExternalReviewer } from '../core/external-reviewer.js';
import type { Octokit } from '@octokit/rest';

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
    assert.equal(csv.categories_csv, 'Security,Correctness,Performance,Maintainability\n1,0,0,0');
    assert.equal(csv.coverage_csv, `value\n${out.coverage.pct}`);
    assert.equal(csv.top_findings_csv, 'Finding Type,Count\n"SQLi",1');
  });

  test('aggregate shifts non-Monday mergedAt to that week Monday', () => {
    // 2026-01-21 is a Wednesday — should map to Monday 2026-01-19
    const results = [makeResult(1, '2026-01-21T15:00:00Z', [{ severity: 'low', category: 'security', title: 'X', file: 'f.ts' }])];
    const out = agg.aggregate(results, { owner: 'a', repo: 'b' });
    assert.equal(out.timeseries[0].week, '2026-01-19T00:00:00Z');
  });

  test('aggregate shifts Sunday mergedAt to previous Monday', () => {
    // 2026-01-25 is a Sunday — should map to Monday 2026-01-19
    const results = [makeResult(1, '2026-01-25T08:00:00Z', [{ severity: 'high', category: 'correctness', title: 'Y', file: 'g.ts' }])];
    const out = agg.aggregate(results, { owner: 'a', repo: 'b' });
    assert.equal(out.timeseries[0].week, '2026-01-19T00:00:00Z');
  });
});

describe('ExternalReviewer.listMergedPRs', () => {
  function makeMockOctokit(prs: Array<{ number: number; merged_at: string | null }>) {
    return {
      pulls: {
        list: async () => ({ data: prs }),
        get: async () => ({ data: { merged_at: '2026-01-19T00:00:00Z' } }),
      },
    } as unknown as Octokit;
  }

  test('filters out unmerged PRs', async () => {
    const mockOctokit = makeMockOctokit([
      { number: 1, merged_at: '2026-01-19T00:00:00Z' },
      { number: 2, merged_at: null },
      { number: 3, merged_at: '2026-01-20T00:00:00Z' },
    ]);
    const reviewer = new ExternalReviewer({ token: 'tok', cacheDir: '/tmp/test', ai: null as any, octokit: mockOctokit });
    const urls = await reviewer.listMergedPRs('a', 'b', {});
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes('/pull/1'));
    assert.ok(urls[1].includes('/pull/3'));
  });

  test('applies count limit', async () => {
    const mockOctokit = makeMockOctokit([
      { number: 1, merged_at: '2026-01-19T00:00:00Z' },
      { number: 2, merged_at: '2026-01-20T00:00:00Z' },
      { number: 3, merged_at: '2026-01-21T00:00:00Z' },
    ]);
    const reviewer = new ExternalReviewer({ token: 'tok', cacheDir: '/tmp/test', ai: null as any, octokit: mockOctokit });
    const urls = await reviewer.listMergedPRs('a', 'b', { count: 2 });
    assert.equal(urls.length, 2);
  });

  test('applies since filter', async () => {
    const mockOctokit = makeMockOctokit([
      { number: 1, merged_at: '2026-01-10T00:00:00Z' },
      { number: 2, merged_at: '2026-02-01T00:00:00Z' },
    ]);
    const reviewer = new ExternalReviewer({ token: 'tok', cacheDir: '/tmp/test', ai: null as any, octokit: mockOctokit });
    const urls = await reviewer.listMergedPRs('a', 'b', { since: '2026-01-15' });
    assert.equal(urls.length, 1);
    assert.ok(urls[0].includes('/pull/2'));
  });
});
