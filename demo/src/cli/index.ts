import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

import type { CLIOptions, ReviewContext } from '../core/types.js';
import { ReviewPipeline, buildReport } from '../core/pipeline.js';
import { ContextCollector, loadScenarioFiles } from '../core/layers/context-collector.js';
import { DeterministicGate } from '../core/layers/deterministic-gate.js';
import { AIQuickScan } from '../core/layers/ai-quick-scan.js';
import { AIDeepReview } from '../core/layers/ai-deep-review.js';
import { AIClient } from '../core/ai/client.js';
import { GitHubOps } from '../core/github/operations.js';
import { TerminalReporter, renderHeader, renderPRCreated, renderLayerStart, renderLayerComplete, renderCleanupHint } from '../core/reporter/terminal.js';
import { Narrator, PaceMode } from '../core/narrator.js';
import { scenario as perfectPR } from '../scenarios/perfect-pr/scenario.js';
import { scenario as metaInsecureAiClient } from '../scenarios/meta/insecure-ai-client/scenario.js';
import { scenario as metaBrokenGate } from '../scenarios/meta/broken-deterministic-gate/scenario.js';
import { scenario as metaHollowTests } from '../scenarios/meta/hollow-test-suite/scenario.js';
import { scenario as standalonePayment } from '../scenarios/standalone/payment-service/scenario.js';
import { runBench, renderBenchResult } from '../core/bench.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = {
  'perfect-pr': perfectPR,
  'meta/insecure-ai-client': metaInsecureAiClient,
  'meta/broken-deterministic-gate': metaBrokenGate,
  'meta/hollow-test-suite': metaHollowTests,
  'standalone/payment-service': standalonePayment,
} as const;

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const narrate = args.includes('--narrate');
  const interactive = args.includes('--interactive');
  const bench = args.includes('--bench');
  const triage = args.includes('--triage');
  return {
    live: args.includes('--live'),
    local: args.includes('--local') || narrate || interactive,
    cleanup: args.includes('--cleanup'),
    list: args.includes('--list'),
    scenario: args.find((a) => !a.startsWith('--')) ?? 'perfect-pr',
    narrate,
    interactive,
    triage,
    bench: bench || triage,
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

function getPaceMode(opts: CLIOptions): PaceMode {
  if (opts.interactive) return 'interactive';
  if (opts.narrate) return 'auto';
  return 'none';
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

  const narrator = new Narrator(getPaceMode(opts));

  renderHeader(scenarioConfig.title, scenarioConfig.description);

  // Load scenario files
  const scenarioDir = join(__dirname, '..', 'scenarios', scenarioConfig.name);
  const files = await loadScenarioFiles(scenarioDir, scenarioConfig.files);

  // === Narrated intro ===
  await narrator.heading('The Setup');
  await narrator.narrate(
    'A developer opens a pull request: "feat: add user authentication service."\n' +
    'The PR adds login/register endpoints, JWT auth, password hashing, and 12 tests.\n' +
    'CI is green. Coverage is 94%. Commit messages are clean.'
  );

  await narrator.narrate(
    "Let's look at the code the same way a reviewer would see it."
  );

  // Show key files
  const controller = files.find(f => f.path.includes('auth.controller'));
  if (controller) {
    await narrator.showCode(controller.path, controller.content);
    await narrator.narrate(
      'Clean REST controller. Async/await. Error handling. Typed request/response.\n' +
      'Nothing obviously wrong at a glance.'
    );
  }

  const service = files.find(f => f.path.includes('auth.service'));
  if (service) {
    await narrator.showCode(service.path, service.content);
    await narrator.narrate(
      'Business logic separated from HTTP layer. Bcrypt for passwords. JWT for tokens.\n' +
      'Follows the patterns you expect.'
    );
  }

  const testFile = files.find(f => f.path.includes('auth.test'));
  if (testFile) {
    await narrator.showCode(testFile.path, testFile.content);
    await narrator.narrate(
      '12 tests. Mocked dependencies. Good describe/it structure.\n' +
      '94% line coverage. All green.'
    );
  }

  await narrator.challenge('Would you approve this PR?');

  await narrator.separator();
  await narrator.heading("Let's see what VCR finds");
  await narrator.narrate(
    'VCR runs this PR through 4 layers — from zero-cost deterministic checks\n' +
    'to AI-powered deep analysis. Each layer adds depth. Cost scales with risk.'
  );

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
    body: scenarioConfig.prBody ?? '',
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

  // Build layers
  const layers = [
    new ContextCollector(),
    new DeterministicGate(),
    new AIQuickScan(ai, scenarioConfig.name),
    new AIDeepReview(ai, scenarioConfig.name),
  ];

  // Layer narration texts
  const layerNarration: Record<number, { before: string; after: string }> = {
    0: {
      before: 'Layer 0 collects context: file classifications, diff, metadata.\nZero cost. Pure data preparation.',
      after: 'Context ready. Files classified: auth code marked as critical.',
    },
    1: {
      before: 'Layer 1 is the deterministic gate. Zero AI. Zero cost.\nRegex pattern matching for known vulnerability patterns.\nThis layer CANNOT be fooled by prompt injection or hallucination.',
      after: 'Already found issues — and we haven\'t spent a single token on AI yet.\nA secret in the env file. SQL injection. Timing-unsafe comparison. Weak RNG.',
    },
    2: {
      before: 'Layer 2: first contact with AI. Claude Haiku — fast, cheap ($0.02).\nClassifies risk level. Detects circular test patterns.\nThis is the economic hinge: only HIGH+ risk triggers the expensive Layer 3.',
      after: 'CRITICAL risk. And the big finding: 8 of 12 tests are circular.\nThey mock everything and test nothing. That 94% coverage? Meaningless.\nGate decision: proceed to deep review.',
    },
    3: {
      before: 'Layer 3: deep review with Claude Sonnet. Three lenses run in parallel:\n  - Security: OWASP Top 10, crypto, auth patterns\n  - Architecture: coupling, testability, data exposure\n  - Test quality: what the tests actually verify\nThis is the expensive layer (~$0.40) — but it only runs for risky PRs.',
      after: 'The full picture emerges. bcrypt cost factor 4 — brute-forceable.\nJWT accepts algorithm "none" — tokens can be forged.\nThe model returns password hashes to every caller.\nTests assert spy calls, not actual behavior.',
    },
  };

  const reporters = [new TerminalReporter()];

  if (narrator.mode !== 'none') {
    // Manual orchestration with narration between layers
    for (const layer of layers) {
      const narr = layerNarration[layer.layer];
      if (narr) await narrator.narrate(narr.before);

      renderLayerStart(layer.layer, layer.name);
      const result = await layer.analyze(context);
      context.previousLayers.push(result);
      renderLayerComplete(result);

      if (narr) {
        await narrator.narrate(narr.after);
        await narrator.separator();
      }

      if (result.gate && !result.gate.proceed) break;
    }

    // Build report and render via reporter
    const report = buildReport(context);
    for (const reporter of reporters) {
      await reporter.render(report);
    }

    // Post-pipeline narration
    await narrator.heading('The Verdict');
    await narrator.narrate(
      'A traditional code review would have seen: CI green, 94% coverage, clean code.\n' +
      'A senior engineer — if available within 24-48 hours — might catch one or two issues.\n' +
      'VCR found 14 issues in under 2 minutes for $0.44.'
    );
    await narrator.narrate(
      'The most dangerous finding: the tests provide a false sense of security.\n' +
      'They pass, they show high coverage, but they verify nothing.\n' +
      'This PR would ship an authentication bypass to production.'
    );

    // Post findings to GitHub (won't happen in narrated mode since local is implied, but kept for completeness)
    if (gh && !opts.local) {
      process.stdout.write(chalk.dim('→ Posting findings to PR... '));
      await gh.postFindings(pr, report);
      console.log(chalk.green('✓'));
      console.log(`  ${chalk.underline(pr.url)}`);
      console.log('');
      renderCleanupHint();
    }

    // Bench evaluation
    if (opts.bench) {
      const benchGTPath = join(__dirname, '..', '..', 'bench', 'ground-truth', 'perfect-pr.json');
      const benchOutputDir = join(__dirname, '..', '..', 'bench', 'results');
      const judgeMode = opts.live && process.env.ANTHROPIC_API_KEY ? 'llm' as const : 'keyword' as const;

      const benchResult = await runBench(report, judgeMode === 'llm' ? ai : null, {
        scenario: scenarioConfig.name,
        groundTruthPath: benchGTPath,
        judgeMode,
        outputDir: benchOutputDir,
      });

      renderBenchResult(benchResult);
    }
  } else {
    // Standard mode — use pipeline as before
    const pipeline = new ReviewPipeline(layers, reporters);
    pipeline.on('layer:start', (e: any) => renderLayerStart(e.layer, e.name));
    pipeline.on('layer:complete', (e: any) => renderLayerComplete(e.result));

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

    // Bench evaluation
    if (opts.bench) {
      const benchGTPath = join(__dirname, '..', '..', 'bench', 'ground-truth', 'perfect-pr.json');
      const benchOutputDir = join(__dirname, '..', '..', 'bench', 'results');
      const judgeMode = opts.live && process.env.ANTHROPIC_API_KEY ? 'llm' as const : 'keyword' as const;

      const benchResult = await runBench(report, judgeMode === 'llm' ? ai : null, {
        scenario: scenarioConfig.name,
        groundTruthPath: benchGTPath,
        judgeMode,
        outputDir: benchOutputDir,
      });

      renderBenchResult(benchResult);
    }
  }

  narrator.close();
}

main().catch((err) => {
  console.error(chalk.red(`\n✗ ${err.message}`));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
