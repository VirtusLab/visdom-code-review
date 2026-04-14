import chalk from 'chalk';
import type { TriageReport } from '../evaluator.js';

export function renderTriageReport(triage: TriageReport): void {
  console.log('');
  console.log(chalk.bold('════════════════════════════════════════════════════════'));
  console.log(chalk.bold('  TRIAGE REPORT — Engineering Evaluation'));
  console.log(chalk.bold('════════════════════════════════════════════════════════'));
  console.log('');

  // === Classification Summary ===
  console.log(chalk.bold('  Finding Classification (CR-Bench)'));
  console.log(chalk.dim('  ─────────────────────────────────'));
  const bugBar = '█'.repeat(triage.bugHits);
  const validBar = '█'.repeat(triage.validSuggestions);
  const noiseBar = '█'.repeat(triage.noise);
  console.log(`  ${chalk.green('Bug hits:')}\t${triage.bugHits}\t${chalk.green(bugBar)}`);
  console.log(`  ${chalk.cyan('Valid suggestions:')}\t${triage.validSuggestions}\t${chalk.cyan(validBar)}`);
  console.log(`  ${chalk.red('Noise:')}\t\t${triage.noise}\t${chalk.red(noiseBar)}`);
  console.log('');

  // === Core Metrics ===
  console.log(chalk.bold('  Core Metrics'));
  console.log(chalk.dim('  ─────────────────────────────────'));
  const metrics: [string, string, string][] = [
    ['Precision', formatPct(triage.precision), triage.precision >= 0.8 ? chalk.green('●') : triage.precision >= 0.6 ? chalk.yellow('●') : chalk.red('●')],
    ['Recall', formatPct(triage.recall), triage.recall >= 0.8 ? chalk.green('●') : triage.recall >= 0.6 ? chalk.yellow('●') : chalk.red('●')],
    ['F1 Score', formatPct(triage.f1), triage.f1 >= 0.7 ? chalk.green('●') : triage.f1 >= 0.5 ? chalk.yellow('●') : chalk.red('●')],
    ['Usefulness Rate', formatPct(triage.usefulnessRate), triage.usefulnessRate >= 0.8 ? chalk.green('●') : triage.usefulnessRate >= 0.6 ? chalk.yellow('●') : chalk.red('●')],
    ['Signal Ratio', formatPct(triage.signalRatio), triage.signalRatio >= 0.8 ? chalk.green('●') : triage.signalRatio >= 0.6 ? chalk.yellow('●') : chalk.red('●')],
    ['SNR', `${triage.snr.toFixed(1)}:1`, triage.snr >= 5 ? chalk.green('●') : triage.snr >= 2 ? chalk.yellow('●') : chalk.red('●')],
    ['False Positive Rate', formatPct(triage.fpr), triage.fpr <= 0.05 ? chalk.green('●') : triage.fpr <= 0.15 ? chalk.yellow('●') : chalk.red('●')],
  ];

  for (const [label, value, indicator] of metrics) {
    console.log(`  ${indicator} ${label.padEnd(20)} ${chalk.bold(value)}`);
  }
  console.log('');

  // === SNR Rating ===
  const ratingColor = triage.snrRating === 'excellent' ? chalk.green :
    triage.snrRating === 'good' ? chalk.cyan :
    triage.snrRating === 'acceptable' ? chalk.yellow : chalk.red;
  console.log(`  SNR Rating: ${ratingColor(triage.snrRating.toUpperCase())}`);
  console.log('');

  // === Per-Layer Breakdown ===
  console.log(chalk.bold('  Per-Layer Breakdown'));
  console.log(chalk.dim('  ─────────────────────────────────'));
  console.log(chalk.dim('  Layer'.padEnd(30) + 'Hits'.padEnd(8) + 'Noise'.padEnd(8) + 'Prec'.padEnd(8) + 'Cost'));
  for (const l of triage.layerBreakdown) {
    const name = `L${l.layer} ${l.name}`;
    console.log(
      `  ${name.padEnd(28)} ${String(l.bugHits).padEnd(8)}${String(l.noise).padEnd(8)}${formatPct(l.precision).padEnd(8)}$${l.costUsd.toFixed(2)}`
    );
  }
  console.log('');

  // === Cost Efficiency ===
  console.log(chalk.bold('  Cost Efficiency'));
  console.log(chalk.dim('  ─────────────────────────────────'));
  console.log(`  Total cost:         $${triage.totalCost.toFixed(2)}`);
  console.log(`  Cost per bug hit:   $${triage.costPerBugHit.toFixed(3)}`);
  console.log(`  Cost per finding:   $${triage.costPerFinding.toFixed(3)}`);
  console.log('');

  // === Missed Ground Truth ===
  if (triage.missed.length > 0) {
    console.log(chalk.bold.yellow(`  Missed Ground Truth (${triage.missed.length})`));
    console.log(chalk.dim('  ─────────────────────────────────'));
    for (const m of triage.missed) {
      const tierLabel = m.tier === 1 ? chalk.red('T1') : chalk.yellow('T2');
      console.log(`  ${tierLabel} ${chalk.dim(m.id)} ${m.title}`);
      console.log(`     ${chalk.dim(m.file)}`);
    }
    console.log('');
  } else {
    console.log(chalk.green('  All ground truth entries detected'));
    console.log('');
  }

  // === Thresholds Reference ===
  console.log(chalk.dim('  Reference thresholds:'));
  console.log(chalk.dim('  Precision >=80% good | FPR <=5% excellent, <=15% acceptable'));
  console.log(chalk.dim('  Signal Ratio >=80% good, >=60% acceptable | SNR >=5:1 excellent'));
  console.log(chalk.dim('  Methodology: CR-Bench (arxiv:2603.11078), SNR framework'));
  console.log('');
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
