// demo/src/scripts/run-showcase.ts
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir, access } from 'node:fs/promises';
import chalk from 'chalk';

import { ReviewPipeline } from '../core/pipeline.js';
import { ContextCollector, loadScenarioFiles } from '../core/layers/context-collector.js';
import { DeterministicGate } from '../core/layers/deterministic-gate.js';
import { AIQuickScan } from '../core/layers/ai-quick-scan.js';
import { AIDeepReview } from '../core/layers/ai-deep-review.js';
import { AIClient } from '../core/ai/client.js';
import { GitHubOps } from '../core/github/operations.js';
import type { ReviewContext, ScenarioConfig } from '../core/types.js';
import type { ShowcaseResults, ShowcaseScenario, LiveReviews } from '../types/showcase.js';

import { scenario as metaInsecureAiClient } from '../scenarios/meta/insecure-ai-client/scenario.js';
import { scenario as metaBrokenGate } from '../scenarios/meta/broken-deterministic-gate/scenario.js';
import { scenario as metaHollowTests } from '../scenarios/meta/hollow-test-suite/scenario.js';
import { scenario as standalonePayment } from '../scenarios/standalone/payment-service/scenario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const live = process.argv.includes('--live');

const SCENARIOS: Array<{
  config: ScenarioConfig;
  language: string;
  type: 'metacircular' | 'standalone';
  bugDescription: string;
}> = [
  {
    config: metaInsecureAiClient,
    language: 'TypeScript',
    type: 'metacircular',
    bugDescription: 'Hardcoded API key, PII in logs, retry without backoff',
  },
  {
    config: metaBrokenGate,
    language: 'TypeScript',
    type: 'metacircular',
    bugDescription: 'Weakened SQL check, timing-unsafe compare, SSRF rule disabled',
  },
  {
    config: metaHollowTests,
    language: 'TypeScript',
    type: 'metacircular',
    bugDescription: '15 tests mocking their own subjects — zero behavioral assertions',
  },
  {
    config: standalonePayment,
    language: 'Python',
    type: 'standalone',
    bugDescription: 'SQL injection via f-string, card data in logs, weak JWT secret',
  },
];

function detectRepo(): { owner: string; repo: string } {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return { owner: m[1], repo: m[2] };
  } catch {}
  throw new Error('Could not detect GitHub repo. Set VCR_DEMO_REPO=owner/repo');
}

async function runScenario(
  s: (typeof SCENARIOS)[0],
  ai: AIClient,
  gh: GitHubOps | null,
): Promise<ShowcaseScenario> {
  const scenarioDir = join(__dirname, '..', 'scenarios', s.config.name);
  const files = await loadScenarioFiles(scenarioDir, s.config.files);

  let pr = {
    number: 0,
    url: '(local)',
    branch: s.config.branch,
    title: s.config.prTitle,
    body: s.config.prBody ?? '',
    filesChanged: files.length,
    linesAdded: files.reduce((n, f) => n + f.linesChanged, 0),
    linesRemoved: 0,
  };

  if (gh && live && s.type === 'metacircular') {
    const fileContents: Record<string, string> = {};
    for (const f of files) fileContents[f.path] = f.content;
    pr = await gh.setupScenario(s.config, fileContents);
  }

  const context: ReviewContext = {
    scenario: s.config.name,
    pr,
    diff: '',
    files,
    previousLayers: [],
  };

  const layers = [
    new ContextCollector(),
    new DeterministicGate(),
    new AIQuickScan(ai, s.config.name),
    new AIDeepReview(ai, s.config.name),
  ];

  const pipeline = new ReviewPipeline(layers, []);
  const report = await pipeline.run(context);

  if (gh && live && s.type === 'metacircular') {
    await gh.postFindings(pr, report);
  }

  const layerMap = Object.fromEntries(report.layers.map((l) => [l.layer, l]));
  const bySev = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of report.layers.flatMap((l) => l.findings)) {
    const sev = f.severity as keyof typeof bySev;
    if (sev in bySev) bySev[sev]++;
  }

  const l2 = report.layers.find((l) => l.layer === 2);
  const l3 = report.layers.find((l) => l.layer === 3);

  return {
    name: s.config.name,
    title: s.config.title || s.config.name,
    language: s.language,
    type: s.type,
    prTitle: s.config.prTitle,
    prUrl: live && s.type === 'metacircular' ? pr.url : null,
    bugDescription: s.bugDescription,
    findings: report.layers.flatMap((l) => l.findings),
    layerCosts: {
      l0: layerMap[0]?.metrics.costUsd ?? 0,
      l1: layerMap[1]?.metrics.costUsd ?? 0,
      l2: layerMap[2]?.metrics.costUsd ?? 0,
      l3: layerMap[3]?.metrics.costUsd ?? 0,
    },
    layerDurations: {
      l0: layerMap[0]?.metrics.durationMs ?? 0,
      l1: layerMap[1]?.metrics.durationMs ?? 0,
      l2: layerMap[2]?.metrics.durationMs ?? 0,
      l3: layerMap[3]?.metrics.durationMs ?? 0,
    },
    summary: {
      totalFindings: report.summary.totalFindings,
      bySeverity: bySev,
      costUsd: report.summary.totalCostUsd,
      durationMs: report.summary.totalDurationMs,
      l3Triggered: !!l3 && (l2?.gate?.proceed ?? false),
    },
    reviewedAt: new Date().toISOString(),
  };
}

async function main() {
  const cacheDir = join(__dirname, '..', '..', 'cache');
  const resultsDir = join(__dirname, '..', '..', 'results');
  await mkdir(resultsDir, { recursive: true });

  const ai = new AIClient({ apiKey: process.env.ANTHROPIC_API_KEY, cacheDir, live });

  let gh: GitHubOps | null = null;
  if (live) {
    const { owner, repo } = process.env.VCR_DEMO_REPO
      ? {
          owner: process.env.VCR_DEMO_REPO.split('/')[0],
          repo: process.env.VCR_DEMO_REPO.split('/')[1],
        }
      : detectRepo();
    const token =
      process.env.GITHUB_TOKEN ??
      execSync('gh auth token', { encoding: 'utf-8' }).trim();
    gh = new GitHubOps({ token, owner, repo });
  }

  const scenarios: ShowcaseScenario[] = [];

  for (const s of SCENARIOS) {
    console.log(chalk.dim(`\n→ Running ${s.config.name}...`));
    try {
      const result = await runScenario(s, ai, gh);
      scenarios.push(result);
      console.log(
        chalk.green(`  ✓ ${result.summary.totalFindings} findings, $${result.summary.costUsd.toFixed(2)}`),
      );
    } catch (err: unknown) {
      console.error(chalk.red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  const bySev = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of scenarios.flatMap((s) => s.findings)) {
    const sev = f.severity as keyof typeof bySev;
    if (sev in bySev) bySev[sev]++;
  }

  const results: ShowcaseResults = {
    generatedAt: new Date().toISOString(),
    scenarios,
    aggregate: {
      totalFindings: scenarios.flatMap((s) => s.findings).length,
      bySeverity: bySev,
      avgCostUsd:
        scenarios.length > 0
          ? scenarios.reduce((n, s) => n + s.summary.costUsd, 0) / scenarios.length
          : 0,
      avgDurationMs:
        scenarios.length > 0
          ? scenarios.reduce((n, s) => n + s.summary.durationMs, 0) / scenarios.length
          : 0,
      l3TriggerRate:
        scenarios.length > 0
          ? scenarios.filter((s) => s.summary.l3Triggered).length / scenarios.length
          : 0,
    },
  };

  await writeFile(join(resultsDir, 'showcase.json'), JSON.stringify(results, null, 2));
  console.log(chalk.green('\n✓ showcase.json written'));

  const liveReviewsPath = join(resultsDir, 'live-reviews.json');
  try {
    await access(liveReviewsPath);
  } catch {
    const empty: LiveReviews = { reviews: [] };
    await writeFile(liveReviewsPath, JSON.stringify(empty, null, 2));
    console.log(chalk.green('✓ live-reviews.json created'));
  }
}

main().catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
