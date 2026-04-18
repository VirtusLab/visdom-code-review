import { Octokit } from '@octokit/rest';
import { join } from 'node:path';

import type { ReviewContext, PRMetadata, Finding } from './types.js';
import { buildReport } from './pipeline.js';
import { ContextCollector } from './layers/context-collector.js';
import { DeterministicGate } from './layers/deterministic-gate.js';
import { AIQuickScan } from './layers/ai-quick-scan.js';
import { AIDeepReview } from './layers/ai-deep-review.js';
import { PRFetcher } from './pr-fetcher.js';
import type { AIClient } from './ai/client.js';

export interface ExternalReviewResult {
  pr: PRMetadata;
  findings: Finding[];
  metrics: { durationMs: number; costUsd: number; l3Triggered: boolean };
  mergedAt: string;
}

export class ExternalReviewer {
  private fetcher: PRFetcher;
  private octokit: Octokit;
  private ai: AIClient;

  constructor(opts: { token: string; cacheDir: string; ai: AIClient; octokit?: Octokit }) {
    this.fetcher = new PRFetcher({ token: opts.token, cacheDir: join(opts.cacheDir, 'prs') });
    this.octokit = opts.octokit ?? new Octokit({ auth: opts.token });
    this.ai = opts.ai;
  }

  async reviewPR(prUrl: string): Promise<ExternalReviewResult> {
    const start = Date.now();
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) throw new Error(`Invalid PR URL: ${prUrl}`);
    const [, owner, repo, numStr] = match;
    const prNumber = parseInt(numStr, 10);

    const fetched = await this.fetcher.fetch(prUrl);

    const prData = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });
    const mergedAt = prData.data.merged_at ?? new Date().toISOString();

    const scenario = `external-${owner}-${repo}-${prNumber}`;
    const context: ReviewContext = {
      scenario,
      pr: fetched.meta,
      diff: fetched.diff,
      files: fetched.files,
      previousLayers: [],
    };

    const layers = [
      new ContextCollector(),
      new DeterministicGate(),
      new AIQuickScan(this.ai, scenario),
      new AIDeepReview(this.ai, scenario),
    ];

    for (const layer of layers) {
      try {
        const result = await layer.analyze(context);
        context.previousLayers.push(result);
        if (result.gate && !result.gate.proceed) break;
      } catch (err) {
        console.error(`Layer ${layer.layer} (${layer.name}) failed: ${(err as Error).message}`);
        break;
      }
    }
    const l3Triggered = context.previousLayers.some(r => r.layer === 3);

    const report = buildReport(context);
    const findings = report.layers.flatMap(l => l.findings);
    const costUsd = report.summary.totalCostUsd;

    return {
      pr: fetched.meta,
      findings,
      metrics: { durationMs: Date.now() - start, costUsd, l3Triggered },
      mergedAt,
    };
  }

  async listMergedPRs(owner: string, repo: string, opts: { count?: number; since?: string }): Promise<string[]> {
    const response = await this.octokit.pulls.list({
      owner,
      repo,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      // GitHub API max per_page is 100; since filter may miss older PRs in busy repos
      per_page: 100,
    });

    let prs = response.data.filter(pr => pr.merged_at !== null);

    if (opts.since) {
      const sinceDate = new Date(opts.since);
      prs = prs.filter(pr => new Date(pr.merged_at!) >= sinceDate);
    }

    if (opts.count) {
      prs = prs.slice(0, opts.count);
    }

    return prs.map(pr => `https://github.com/${owner}/${repo}/pull/${pr.number}`);
  }
}
