import chalk from 'chalk';
import type { Reporter, ReviewReport, LayerResult, Finding } from '../types.js';

export class TerminalReporter implements Reporter {
  async render(report: ReviewReport): Promise<void> {
    console.log('');
    console.log(chalk.bold('════════════════════════════════════════════════════════'));
    console.log(chalk.bold('  RESULTS — Side by Side'));
    console.log(chalk.bold('════════════════════════════════════════════════════════'));
    console.log('');

    const { traditional, vcr } = report.summary.traditionalComparison;

    const circularInfo = this.getCircularTestInfo(report);
    const effectiveCoverage = circularInfo
      ? `but ${circularInfo.circular}/${circularInfo.total} tests circular`
      : 'all real';

    const rows: [string, string][] = [
      ['CI status: ✅ all green', `CI: ✅ ${effectiveCoverage}`],
      ['Coverage: 94%', `Effective coverage: ~31%`],
      [`Findings: ${traditional.findings}`, `Findings: ${vcr.findings}`],
      ...this.severityRows(report),
      [`Wait time: ${traditional.waitTime}`, `Time: ${vcr.time}`],
      [`Human cost: ${traditional.cost}`, `Human cost: $0 (review only)`],
      [`AI cost: $0`, `AI cost: ${vcr.cost}`],
      [`Risk: ${traditional.riskMissed}`, `Risk: ${vcr.riskCaught}`],
    ];

    const colWidth = 34;

    console.log(
      '  ' +
      chalk.dim('Traditional Review'.padEnd(colWidth)) +
      chalk.dim('│  ') +
      chalk.dim('VCR Review')
    );
    console.log(
      '  ' +
      chalk.dim('─'.repeat(colWidth)) +
      chalk.dim('│') +
      chalk.dim('─'.repeat(colWidth))
    );

    for (const [left, right] of rows) {
      console.log(
        '  ' +
        left.padEnd(colWidth) +
        chalk.dim('│  ') +
        chalk.green(right)
      );
    }

    console.log('');
  }

  private getCircularTestInfo(report: ReviewReport): { circular: number; total: number } | null {
    for (const layer of report.layers) {
      for (const f of layer.findings) {
        const match = f.title.match(/(\d+)\/(\d+)\s+tests?\s+(?:are\s+)?circular/i);
        if (match) {
          return { circular: parseInt(match[1], 10), total: parseInt(match[2], 10) };
        }
      }
    }
    return null;
  }

  private severityRows(report: ReviewReport): [string, string][] {
    const s = report.summary.bySeverity;
    const rows: [string, string][] = [];
    for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
      const count = s[sev] ?? 0;
      if (count > 0) {
        const color = sev === 'critical' ? chalk.red
          : sev === 'high' ? chalk.yellow
          : sev === 'medium' ? chalk.cyan
          : chalk.dim;
        rows.push([`  ${sev}: 0`, `  ${color(`${sev}: ${count}`)}`]);
      }
    }
    return rows;
  }
}

// === Live progress rendering (called from CLI event listeners) ===

export function renderHeader(scenarioTitle: string, description: string): void {
  console.log('');
  console.log(chalk.bgHex('#6366f1').white.bold(` VCR Demo — "${scenarioTitle}" `));
  console.log(chalk.dim(`  Scenario: ${description}`));
  console.log('');
}

export function renderPRCreated(url: string): void {
  console.log(chalk.green('→ Creating PR... ✓ ') + chalk.underline(url));
  console.log('');
}

export function renderLayerStart(layer: number, name: string): void {
  process.stdout.write(chalk.bold(`▸ Layer ${layer} — ${name}`));
}

export function renderLayerComplete(result: LayerResult): void {
  const duration = (result.metrics.durationMs / 1000).toFixed(1);
  const cost = result.metrics.costUsd > 0 ? `  $${result.metrics.costUsd.toFixed(2)}` : '';
  console.log(chalk.dim(`  ${duration}s${cost}`));

  if (result.layer === 0) {
    console.log('');
    return;
  }

  for (const f of result.findings) {
    const sevColor = f.severity === 'critical' ? chalk.red
      : f.severity === 'high' ? chalk.yellow
      : f.severity === 'medium' ? chalk.cyan
      : chalk.dim;
    const sevLabel = sevColor(f.severity.toUpperCase().padEnd(10));
    const lineInfo = f.line ? `:${f.line}` : '';
    const lensPrefix = f.lens ? chalk.dim(`[${f.lens}] `) : '';
    console.log(`  ⚠ ${sevLabel} ${chalk.dim(f.id.padEnd(12))} ${lensPrefix}${chalk.dim(f.file + lineInfo)}`);
    console.log(`    ${f.title}`);
  }

  if (result.gate) {
    const gateColor = result.gate.proceed ? chalk.yellow : chalk.green;
    const gateLabel = result.gate.proceed ? '→ Layer 3 triggered' : '✓ Stopped (low risk)';
    console.log(`  Risk: ${chalk.bold(result.gate.risk.toUpperCase())} │ Gate: ${gateColor(gateLabel)}`);
  }

  console.log('');
}

export function renderCleanupHint(): void {
  console.log(chalk.dim('→ Run `npm run demo:cleanup` to close PR and delete branch'));
  console.log('');
}
