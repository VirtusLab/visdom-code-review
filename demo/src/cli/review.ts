import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

import { ExternalReviewer } from '../core/external-reviewer.js';
import { DashboardAggregator } from '../core/dashboard-aggregator.js';
import type { ExternalReviewResult } from '../core/external-reviewer.js';
import type { DashboardOutput } from '../core/dashboard-aggregator.js';
import { AIClient } from '../core/ai/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getGitHubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execSync('gh auth token', { encoding: 'utf-8' }).trim(); } catch { /* ignore */ }
  throw new Error('No GitHub token. Set GITHUB_TOKEN or run: gh auth login');
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const mode = args[0]; // 'pr' or 'repo'

  if (!mode || (mode !== 'pr' && mode !== 'repo')) {
    console.error(chalk.red('Usage:'));
    console.error('  npm run review pr <url>');
    console.error('  npm run review repo <owner/repo> [--count=N] [--since=YYYY-MM-DD] [--live]');
    process.exit(1);
  }

  const token = getGitHubToken();
  const cacheDir = join(__dirname, '..', '..', 'cache', 'external');
  await mkdir(join(cacheDir, 'prs'), { recursive: true });

  const ai = new AIClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    cacheDir: join(cacheDir, 'ai'),
    live,
  });
  const reviewer = new ExternalReviewer({ token, cacheDir, ai });
  const aggregator = new DashboardAggregator();

  if (mode === 'pr') {
    const prUrl = args[1];
    if (!prUrl) { console.error(chalk.red('Missing PR URL')); process.exit(1); }
    console.log(chalk.dim(`Reviewing ${prUrl}...`));
    const result = await reviewer.reviewPR(prUrl);
    printPRResult(result);
    return;
  }

  // repo mode
  const repoArg = args[1];
  if (!repoArg || !repoArg.includes('/')) { console.error(chalk.red('Expected owner/repo e.g. torvalds/linux')); process.exit(1); }
  const [owner, repo] = repoArg.split('/');
  const count = args.find(a => a.startsWith('--count='))?.split('=')[1];
  const since = args.find(a => a.startsWith('--since='))?.split('=')[1];

  const resultsFile = join(cacheDir, `${owner}-${repo}-results.json`);
  const dashboardFile = join(cacheDir, `${owner}-${repo}-dashboard.json`);

  let allResults: ExternalReviewResult[] = existsSync(resultsFile)
    ? JSON.parse(await readFile(resultsFile, 'utf-8'))
    : [];
  const reviewedNums = new Set(allResults.map(r => r.pr.number));

  const prUrls = await reviewer.listMergedPRs(owner, repo, {
    count: count ? parseInt(count, 10) : undefined,
    since,
  });

  const newUrls = prUrls.filter(url => {
    const num = parseInt(url.split('/').pop()!, 10);
    return !reviewedNums.has(num);
  });

  console.log(chalk.bold(`\nRepo: ${owner}/${repo}`));
  console.log(chalk.dim(`${prUrls.length} merged PRs found, ${newUrls.length} new to review\n`));

  for (let i = 0; i < newUrls.length; i++) {
    const url = newUrls[i];
    const num = url.split('/').pop();
    process.stdout.write(chalk.cyan(`[${i + 1}/${newUrls.length}]`) + ` Reviewing PR #${num}...`);
    const result = await reviewer.reviewPR(url);
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
    console.log(
      chalk.cyan(`[${i + 1}/${newUrls.length}]`) +
      ` PR #${num} — ${result.pr.title.slice(0, 50)} · ` +
      chalk.yellow(`${result.findings.length} findings`) +
      chalk.dim(` · $${result.metrics.costUsd.toFixed(3)}`)
    );
    allResults.push(result);
    await writeFile(resultsFile, JSON.stringify(allResults, null, 2));
  }

  const dashboard = aggregator.aggregate(allResults, { owner, repo, totalPrs: prUrls.length });
  const csv = aggregator.toCsvContent(dashboard);
  await writeFile(dashboardFile, JSON.stringify({ ...dashboard, grafana: csv }, null, 2));

  printRepoSummary(dashboard);
  console.log(chalk.dim(`\nResults: ${resultsFile}`));
  console.log(chalk.dim(`Dashboard: ${dashboardFile}`));
}

function printPRResult(result: ExternalReviewResult) {
  const { pr, findings, metrics } = result;
  console.log(chalk.bold(`\nPR #${pr.number} — ${pr.title}`));
  console.log(chalk.dim(`${pr.filesChanged} files, +${pr.linesAdded}/-${pr.linesRemoved} lines\n`));

  if (findings.length === 0) {
    console.log(chalk.green('✓ No findings'));
  } else {
    for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
      const group = findings.filter(f => f.severity === sev);
      if (group.length === 0) continue;
      const colors = { critical: chalk.red, high: chalk.yellow, medium: chalk.cyan, low: chalk.dim };
      console.log(colors[sev](`\n${sev.toUpperCase()} (${group.length})`));
      for (const f of group) console.log(`  • ${f.title} [${f.file}]`);
    }
  }

  console.log(chalk.dim(`\nDuration: ${(metrics.durationMs / 1000).toFixed(1)}s · Cost: $${metrics.costUsd.toFixed(4)} · L3: ${metrics.l3Triggered ? 'yes' : 'no'}`));
}

function printRepoSummary(d: DashboardOutput) {
  console.log(chalk.bold('\n┌─ Summary ──────────────────────────────┐'));
  console.log(`│  PRs reviewed: ${String(d.prsReviewed).padEnd(24)}│`);
  console.log(`│  Critical: ${String(d.severity.critical).padEnd(28)}│`);
  console.log(`│  High:     ${String(d.severity.high).padEnd(28)}│`);
  console.log(`│  Medium:   ${String(d.severity.medium).padEnd(28)}│`);
  console.log(`│  Low:      ${String(d.severity.low).padEnd(28)}│`);
  if (d.topFindings.length > 0) {
    console.log(chalk.bold('├─ Top findings ─────────────────────────┤'));
    for (const f of d.topFindings.slice(0, 5)) {
      console.log(`│  ${String(f.count).padStart(2)}x ${f.title.slice(0, 34).padEnd(34)}│`);
    }
  }
  console.log(chalk.bold('└────────────────────────────────────────┘'));
}

main().catch(err => { console.error(chalk.red(err.message)); process.exit(1); });
