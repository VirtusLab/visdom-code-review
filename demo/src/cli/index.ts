import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

import type { CLIOptions, ReviewContext } from '../core/types.js';
import { ReviewPipeline } from '../core/pipeline.js';
import { ContextCollector, loadScenarioFiles } from '../core/layers/context-collector.js';
import { DeterministicGate } from '../core/layers/deterministic-gate.js';
import { AIQuickScan } from '../core/layers/ai-quick-scan.js';
import { AIDeepReview } from '../core/layers/ai-deep-review.js';
import { AIClient } from '../core/ai/client.js';
import { GitHubOps } from '../core/github/operations.js';
import { TerminalReporter, renderHeader, renderPRCreated, renderLayerStart, renderLayerComplete, renderCleanupHint } from '../core/reporter/terminal.js';
import { scenario as perfectPR } from '../scenarios/perfect-pr/scenario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = { 'perfect-pr': perfectPR } as const;

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  return {
    live: args.includes('--live'),
    local: args.includes('--local'),
    cleanup: args.includes('--cleanup'),
    list: args.includes('--list'),
    scenario: args.find((a) => !a.startsWith('--')) ?? 'perfect-pr',
  };
}

function detectRepo(): { owner: string; repo: string } {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    const sshMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
    const httpMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (httpMatch) return { owner: httpMatch[1], repo: httpMatch[2] };
  } catch {}
  throw new Error(
    'Could not detect GitHub repo from git remote. ' +
    'Set VCR_DEMO_REPO=owner/repo or ensure you are in a git repo with a GitHub remote.'
  );
}

function getGitHubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf-8' }).trim();
  } catch {}
  throw new Error(
    'No GitHub token found. Set GITHUB_TOKEN or install/authenticate gh CLI.'
  );
}

async function main() {
  const opts = parseArgs();

  // --list
  if (opts.list) {
    console.log(chalk.bold('\nAvailable scenarios:\n'));
    for (const [name, s] of Object.entries(SCENARIOS)) {
      console.log(`  ${chalk.green(name.padEnd(20))} ${s.description}`);
    }
    console.log('');
    return;
  }

  const scenarioConfig = SCENARIOS[opts.scenario as keyof typeof SCENARIOS];
  if (!scenarioConfig) {
    console.error(chalk.red(`Unknown scenario: ${opts.scenario}`));
    console.error(`Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  // --cleanup
  if (opts.cleanup) {
    const { owner, repo } = process.env.VCR_DEMO_REPO
      ? { owner: process.env.VCR_DEMO_REPO.split('/')[0], repo: process.env.VCR_DEMO_REPO.split('/')[1] }
      : detectRepo();
    const token = getGitHubToken();
    const gh = new GitHubOps({ token, owner, repo });

    console.log(chalk.dim(`Cleaning up ${scenarioConfig.branch}...`));

    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${scenarioConfig.branch}`,
      state: 'open',
    });

    for (const pr of prs) {
      await gh.cleanup(scenarioConfig.branch, pr.number);
      console.log(chalk.green(`✓ Closed PR #${pr.number} and deleted branch`));
    }

    if (prs.length === 0) {
      try {
        await octokit.git.deleteRef({ owner, repo, ref: `heads/${scenarioConfig.branch}` });
        console.log(chalk.green(`✓ Deleted branch ${scenarioConfig.branch}`));
      } catch {
        console.log(chalk.dim('No open PRs or branches to clean up.'));
      }
    }
    return;
  }

  // === Main demo flow ===

  renderHeader(scenarioConfig.title, scenarioConfig.description);

  // Load scenario files
  const scenarioDir = join(__dirname, '..', 'scenarios', scenarioConfig.name);
  const files = await loadScenarioFiles(scenarioDir, scenarioConfig.files);

  // Setup AI client
  const cacheDir = join(__dirname, '..', '..', 'cache');
  const ai = new AIClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    cacheDir,
    live: opts.live,
  });

  // Setup GitHub (unless --local)
  let pr = {
    number: 0,
    url: '(local mode — no PR created)',
    branch: scenarioConfig.branch,
    title: scenarioConfig.prTitle,
    filesChanged: files.length,
    linesAdded: files.reduce((sum, f) => sum + f.linesChanged, 0),
    linesRemoved: 0,
  };

  let gh: GitHubOps | null = null;

  if (!opts.local) {
    const { owner, repo } = process.env.VCR_DEMO_REPO
      ? { owner: process.env.VCR_DEMO_REPO.split('/')[0], repo: process.env.VCR_DEMO_REPO.split('/')[1] }
      : detectRepo();
    const token = getGitHubToken();
    gh = new GitHubOps({ token, owner, repo });

    const fileContents: Record<string, string> = {};
    for (const f of files) {
      fileContents[f.path] = f.content;
    }

    process.stdout.write(chalk.dim('→ Creating PR... '));
    pr = await gh.setupScenario(scenarioConfig, fileContents);
    renderPRCreated(pr.url);
  } else {
    console.log(chalk.dim('→ Local mode — skipping GitHub PR creation'));
    console.log('');
  }

  // Build context
  const context: ReviewContext = {
    scenario: scenarioConfig.name,
    pr,
    diff: '',
    files,
    previousLayers: [],
  };

  // Build pipeline
  const layers = [
    new ContextCollector(),
    new DeterministicGate(),
    new AIQuickScan(ai, scenarioConfig.name),
    new AIDeepReview(ai, scenarioConfig.name),
  ];

  const reporters = [new TerminalReporter()];
  const pipeline = new ReviewPipeline(layers, reporters);

  // Wire up live progress events
  pipeline.on('layer:start', (e: any) => renderLayerStart(e.layer, e.name));
  pipeline.on('layer:complete', (e: any) => renderLayerComplete(e.result));

  // Run pipeline
  const report = await pipeline.run(context);

  // Post findings to GitHub
  if (gh && !opts.local) {
    process.stdout.write(chalk.dim('→ Posting findings to PR... '));
    await gh.postFindings(pr, report);
    console.log(chalk.green('✓'));
    console.log(`  ${chalk.underline(pr.url)}`);
    console.log('');
    renderCleanupHint();
  }
}

main().catch((err) => {
  console.error(chalk.red(`\n✗ ${err.message}`));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
