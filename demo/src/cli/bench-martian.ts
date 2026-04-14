import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

import type { ReviewContext } from '../core/types.js';
import { buildReport } from '../core/pipeline.js';
import { ContextCollector } from '../core/layers/context-collector.js';
import { DeterministicGate } from '../core/layers/deterministic-gate.js';
import { AIQuickScan } from '../core/layers/ai-quick-scan.js';
import { AIDeepReview } from '../core/layers/ai-deep-review.js';
import { AIClient } from '../core/ai/client.js';
import { PRFetcher } from '../core/pr-fetcher.js';
import { judgeFinding, judgeByKeywords } from '../core/judge.js';
import type { JudgeVerdict } from '../core/judge.js';
import { writeFile, mkdir } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface MartianGT {
  scenario: string;
  version: string;
  source: string;
  license: string;
  language: string;
  domain: string;
  prs: Array<{
    title: string;
    url: string;
    entries: Array<{
      id: string;
      tier: 1 | 2;
      severity: string;
      title: string;
      description: string;
    }>;
  }>;
  stats: { totalPRs: number; totalEntries: number };
}

interface PRBenchResult {
  pr: { title: string; url: string; filesChanged: number };
  groundTruth: number;
  findings: number;
  bugHits: number;
  validSuggestions: number;
  noise: number;
  precision: number;
  recall: number;
  f1: number;
  costUsd: number;
  verdicts: JudgeVerdict[];
  missed: string[];
  error?: string;
}

interface RepoSummary {
  repo: string;
  language: string;
  domain: string;
  prs: number;
  totalGT: number;
  totalFindings: number;
  bugHits: number;
  validSuggestions: number;
  noise: number;
  precision: number;
  recall: number;
  f1: number;
  usefulnessRate: number;
  snr: number;
  fpr: number;
  totalCostUsd: number;
  perPR: PRBenchResult[];
  errors: number;
}

function getGitHubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execSync('gh auth token', { encoding: 'utf-8' }).trim(); } catch { /* ignore */ }
  throw new Error('No GitHub token. Set GITHUB_TOKEN or authenticate gh CLI.');
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const repoFilter = args.find(a => !a.startsWith('--'));
  const maxPRs = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] ?? '0', 10) || Infinity;

  console.log(chalk.bold('\n┌──────────────────────────────────────────────────────┐'));
  console.log(chalk.bold('│  VCR BENCH — Martian Code Review Benchmark           │'));
  console.log(chalk.bold('└──────────────────────────────────────────────────────┘\n'));

  // Setup
  const token = getGitHubToken();
  const prCacheDir = join(__dirname, '..', '..', 'bench', 'cache', 'prs');
  const aiCacheDir = join(__dirname, '..', '..', 'cache');
  const fetcher = new PRFetcher({ token, cacheDir: prCacheDir });
  const ai = new AIClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    cacheDir: aiCacheDir,
    live,
  });

  // Load ground truth files
  const gtDir = join(__dirname, '..', '..', 'bench', 'ground-truth', 'martian');
  const gtFiles = (await readdir(gtDir)).filter(f => f.endsWith('.json') && f !== 'index.json');

  const allSummaries: RepoSummary[] = [];

  for (const gtFile of gtFiles) {
    const repoName = gtFile.replace('.json', '');
    if (repoFilter && repoName !== repoFilter) continue;

    const gt: MartianGT = JSON.parse(await readFile(join(gtDir, gtFile), 'utf-8'));
    console.log(chalk.bold(`\n▸ ${gt.scenario} (${gt.language}, ${gt.domain})`));
    console.log(chalk.dim(`  ${gt.stats.totalPRs} PRs, ${gt.stats.totalEntries} golden comments\n`));

    const perPR: PRBenchResult[] = [];
    let repoErrors = 0;

    const prsToRun = gt.prs.slice(0, maxPRs);

    for (let i = 0; i < prsToRun.length; i++) {
      const prGT = prsToRun[i];
      const prLabel = `[${i + 1}/${prsToRun.length}]`;

      process.stdout.write(chalk.dim(`  ${prLabel} ${prGT.title.slice(0, 60)}... `));

      try {
        // Fetch PR
        const fetched = await fetcher.fetch(prGT.url);

        // Build context
        const context: ReviewContext = {
          scenario: `martian-${repoName}-pr${i}`,
          pr: fetched.meta,
          diff: fetched.diff,
          files: fetched.files,
          previousLayers: [],
        };

        // Run pipeline (layers 0-3)
        const layers = [
          new ContextCollector(),
          new DeterministicGate(),
          new AIQuickScan(ai, `martian/${repoName}/pr-${fetched.meta.number}`),
          new AIDeepReview(ai, `martian/${repoName}/pr-${fetched.meta.number}`),
        ];

        for (const layer of layers) {
          try {
            const result = await layer.analyze(context);
            context.previousLayers.push(result);
            if (result.gate && !result.gate.proceed) break;
          } catch {
            // AI layers fail without API key — continue with deterministic layers only
            break;
          }
        }

        const report = buildReport(context);

        // Judge findings against this PR's golden comments
        const allFindings = report.layers.flatMap(l => l.findings);
        const verdicts: JudgeVerdict[] = [];

        // Adapt GT entries to match judge interface (add file/category fields)
        const gtEntries = prGT.entries.map(e => ({
          ...e,
          file: '*', // Martian GT has no file paths
          category: e.severity.toLowerCase(),
        }));

        for (const finding of allFindings) {
          let verdict: JudgeVerdict;
          if (live && process.env.ANTHROPIC_API_KEY) {
            verdict = await judgeFinding(ai, finding, gtEntries, `martian-${repoName}-pr${i}`);
          } else {
            verdict = judgeByKeywords(finding, gtEntries);
          }
          verdicts.push(verdict);
        }

        const bugHits = verdicts.filter(v => v.classification === 'bug-hit').length;
        const validSuggestions = verdicts.filter(v => v.classification === 'valid-suggestion').length;
        const noise = verdicts.filter(v => v.classification === 'noise').length;
        const matchedGTIds = new Set(verdicts.filter(v => v.matchedGroundTruth).map(v => v.matchedGroundTruth!));
        const missed = prGT.entries.filter(e => !matchedGTIds.has(e.id)).map(e => e.id);

        const precision = allFindings.length > 0 ? bugHits / allFindings.length : 0;
        const recall = prGT.entries.length > 0 ? matchedGTIds.size / prGT.entries.length : 0;
        const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

        const prResult: PRBenchResult = {
          pr: { title: prGT.title, url: prGT.url, filesChanged: fetched.meta.filesChanged },
          groundTruth: prGT.entries.length,
          findings: allFindings.length,
          bugHits,
          validSuggestions,
          noise,
          precision,
          recall,
          f1,
          costUsd: report.summary.totalCostUsd,
          verdicts,
          missed,
        };

        perPR.push(prResult);

        const recallStr = recall >= 0.8 ? chalk.green(`${(recall * 100).toFixed(0)}%`) :
          recall >= 0.5 ? chalk.yellow(`${(recall * 100).toFixed(0)}%`) :
          chalk.red(`${(recall * 100).toFixed(0)}%`);

        console.log(`${allFindings.length} findings, ${bugHits} hits, recall ${recallStr}`);

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`ERROR: ${msg.slice(0, 80)}`));
        perPR.push({
          pr: { title: prGT.title, url: prGT.url, filesChanged: 0 },
          groundTruth: prGT.entries.length,
          findings: 0, bugHits: 0, validSuggestions: 0, noise: 0,
          precision: 0, recall: 0, f1: 0, costUsd: 0,
          verdicts: [], missed: prGT.entries.map(e => e.id),
          error: msg,
        });
        repoErrors++;
      }
    }

    // Aggregate repo metrics
    const successful = perPR.filter(p => !p.error);
    const totalGT = successful.reduce((s, p) => s + p.groundTruth, 0);
    const totalFindings = successful.reduce((s, p) => s + p.findings, 0);
    const totalBugHits = successful.reduce((s, p) => s + p.bugHits, 0);
    const totalValid = successful.reduce((s, p) => s + p.validSuggestions, 0);
    const totalNoise = successful.reduce((s, p) => s + p.noise, 0);
    const totalCost = successful.reduce((s, p) => s + p.costUsd, 0);
    const totalMatched = successful.reduce((s, p) => s + p.groundTruth - p.missed.length, 0);

    const repoPrecision = totalFindings > 0 ? totalBugHits / totalFindings : 0;
    const repoRecall = totalGT > 0 ? totalMatched / totalGT : 0;
    const repoF1 = repoPrecision + repoRecall > 0 ? 2 * (repoPrecision * repoRecall) / (repoPrecision + repoRecall) : 0;
    const repoUsefulness = totalFindings > 0 ? (totalBugHits + totalValid) / totalFindings : 0;
    const repoSNR = (totalBugHits + totalValid) / Math.max(totalNoise, 1);
    const repoFPR = totalFindings > 0 ? totalNoise / totalFindings : 0;

    allSummaries.push({
      repo: repoName,
      language: gt.language,
      domain: gt.domain,
      prs: successful.length,
      totalGT,
      totalFindings,
      bugHits: totalBugHits,
      validSuggestions: totalValid,
      noise: totalNoise,
      precision: repoPrecision,
      recall: repoRecall,
      f1: repoF1,
      usefulnessRate: repoUsefulness,
      snr: repoSNR,
      fpr: repoFPR,
      totalCostUsd: totalCost,
      perPR,
      errors: repoErrors,
    });
  }

  // === Print aggregate report ===
  console.log('\n' + chalk.bold('════════════════════════════════════════════════════════'));
  console.log(chalk.bold('  VCR BENCH — Aggregate Results'));
  console.log(chalk.bold('════════════════════════════════════════════════════════\n'));

  // Per-repo table
  console.log(chalk.dim('  Repo'.padEnd(22) + 'Lang'.padEnd(8) + 'PRs'.padEnd(6) + 'GT'.padEnd(6) + 'Hits'.padEnd(6) + 'Noise'.padEnd(7) + 'Prec'.padEnd(7) + 'Recall'.padEnd(8) + 'F1'.padEnd(7) + 'Cost'));
  console.log(chalk.dim('  ' + '─'.repeat(78)));

  for (const s of allSummaries) {
    console.log(
      `  ${s.repo.padEnd(20)} ${s.language.padEnd(8)}${String(s.prs).padEnd(6)}${String(s.totalGT).padEnd(6)}` +
      `${String(s.bugHits).padEnd(6)}${String(s.noise).padEnd(7)}` +
      `${pct(s.precision).padEnd(7)}${pct(s.recall).padEnd(8)}${pct(s.f1).padEnd(7)}$${s.totalCostUsd.toFixed(2)}`
    );
  }

  // Grand totals
  const grand = {
    prs: allSummaries.reduce((s, r) => s + r.prs, 0),
    gt: allSummaries.reduce((s, r) => s + r.totalGT, 0),
    findings: allSummaries.reduce((s, r) => s + r.totalFindings, 0),
    hits: allSummaries.reduce((s, r) => s + r.bugHits, 0),
    valid: allSummaries.reduce((s, r) => s + r.validSuggestions, 0),
    noise: allSummaries.reduce((s, r) => s + r.noise, 0),
    cost: allSummaries.reduce((s, r) => s + r.totalCostUsd, 0),
    errors: allSummaries.reduce((s, r) => s + r.errors, 0),
  };

  const grandPrecision = grand.findings > 0 ? grand.hits / grand.findings : 0;
  const grandMatched = allSummaries.reduce((s, r) => s + r.totalGT * r.recall, 0);
  const grandRecall = grand.gt > 0 ? grandMatched / grand.gt : 0;
  const grandF1 = grandPrecision + grandRecall > 0 ? 2 * (grandPrecision * grandRecall) / (grandPrecision + grandRecall) : 0;

  console.log(chalk.dim('  ' + '─'.repeat(78)));
  console.log(chalk.bold(
    `  ${'TOTAL'.padEnd(20)} ${''.padEnd(8)}${String(grand.prs).padEnd(6)}${String(grand.gt).padEnd(6)}` +
    `${String(grand.hits).padEnd(6)}${String(grand.noise).padEnd(7)}` +
    `${pct(grandPrecision).padEnd(7)}${pct(grandRecall).padEnd(8)}${pct(grandF1).padEnd(7)}$${grand.cost.toFixed(2)}`
  ));

  if (grand.errors > 0) {
    console.log(chalk.yellow(`\n  ⚠ ${grand.errors} PR(s) failed to fetch or analyze`));
  }

  // Save aggregate result
  const resultDir = join(__dirname, '..', '..', 'bench', 'results');
  await mkdir(resultDir, { recursive: true });
  const resultFile = join(resultDir, `martian-${repoFilter ?? 'all'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(resultFile, JSON.stringify({ summaries: allSummaries, grand: { ...grand, precision: grandPrecision, recall: grandRecall, f1: grandF1 } }, null, 2));
  console.log(chalk.dim(`\n  Results saved to: ${resultFile}\n`));
}

function pct(v: number): string { return `${(v * 100).toFixed(0)}%`; }

main().catch(err => {
  console.error(chalk.red(`\n✗ ${err.message}`));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
