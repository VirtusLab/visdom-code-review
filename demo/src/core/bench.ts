import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReviewReport } from './types.js';
import type { LayerTriageMetrics } from './evaluator.js';
import type { GroundTruthJSON, GroundTruthEntryJSON, JudgeVerdict } from './judge.js';
import { judgeFinding, judgeByKeywords } from './judge.js';
import type { AIClient } from './ai/client.js';

export interface BenchConfig {
  scenario: string;
  groundTruthPath: string;
  judgeMode: 'llm' | 'keyword';
  outputDir: string;
}

export interface BenchResult {
  // Metadata
  meta: {
    scenario: string;
    timestamp: string;
    judgeMode: 'llm' | 'keyword';
    groundTruthVersion: string;
    pipelineDurationMs: number;
    judgeDurationMs: number;
  };

  // CR-Bench metrics
  metrics: {
    precision: number;
    recall: number;
    f1: number;
    usefulnessRate: number;
    signalRatio: number;
    snr: number;
    snrRating: string;
    fpr: number;
  };

  // Cost
  cost: {
    totalUsd: number;
    perBugHit: number;
    perFinding: number;
    judgeCostUsd: number;
  };

  // Counts
  counts: {
    totalFindings: number;
    bugHits: number;
    validSuggestions: number;
    noise: number;
    groundTruthTotal: number;
    groundTruthMatched: number;
  };

  // Per-layer
  layers: LayerTriageMetrics[];

  // Detailed verdicts (for debugging/review)
  verdicts: JudgeVerdict[];

  // Missed ground truth
  missed: GroundTruthEntryJSON[];
}

export async function runBench(
  report: ReviewReport,
  ai: AIClient | null,
  config: BenchConfig
): Promise<BenchResult> {
  const judgeStart = performance.now();

  // Load ground truth
  const gtRaw = await readFile(config.groundTruthPath, 'utf-8');
  const gt: GroundTruthJSON = JSON.parse(gtRaw);

  // Classify all findings
  const allFindings = report.layers.flatMap(l => l.findings);
  const verdicts: JudgeVerdict[] = [];

  for (const finding of allFindings) {
    let verdict: JudgeVerdict;
    if (config.judgeMode === 'llm' && ai) {
      verdict = await judgeFinding(ai, finding, gt.entries, config.scenario);
    } else {
      verdict = judgeByKeywords(finding, gt.entries);
    }
    verdicts.push(verdict);
  }

  const judgeDurationMs = performance.now() - judgeStart;

  // Compute metrics
  const bugHits = verdicts.filter(v => v.classification === 'bug-hit').length;
  const validSuggestions = verdicts.filter(v => v.classification === 'valid-suggestion').length;
  const noise = verdicts.filter(v => v.classification === 'noise').length;
  const totalFindings = allFindings.length;

  const matchedGTIds = new Set(verdicts.filter(v => v.matchedGroundTruth).map(v => v.matchedGroundTruth!));

  const precision = totalFindings > 0 ? bugHits / totalFindings : 0;
  const recall = gt.entries.length > 0 ? matchedGTIds.size / gt.entries.length : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  const usefulnessRate = totalFindings > 0 ? (bugHits + validSuggestions) / totalFindings : 0;
  const signalRatio = usefulnessRate;
  const snr = (bugHits + validSuggestions) / Math.max(noise, 1);
  const snrRating = signalRatio >= 0.9 ? 'excellent' : signalRatio >= 0.8 ? 'good' : signalRatio >= 0.6 ? 'acceptable' : 'poor';
  const fpr = totalFindings > 0 ? noise / totalFindings : 0;

  const totalCost = report.summary.totalCostUsd;
  const judgeCostUsd = verdicts.length * 0.002; // estimate for haiku judge calls

  // Per-layer
  const layers: LayerTriageMetrics[] = report.layers
    .filter(l => l.findings.length > 0)
    .map(l => {
      const layerVerdicts = verdicts.filter((_v, i) => allFindings[i].layer === l.layer);
      const layerBugHits = layerVerdicts.filter(v => v.classification === 'bug-hit').length;
      const layerNoise = layerVerdicts.filter(v => v.classification === 'noise').length;
      return {
        layer: l.layer,
        name: l.name,
        findings: l.findings.length,
        bugHits: layerBugHits,
        noise: layerNoise,
        precision: l.findings.length > 0 ? layerBugHits / l.findings.length : 0,
        costUsd: l.metrics.costUsd,
        durationMs: l.metrics.durationMs,
      };
    });

  const missed = gt.entries.filter(e => !matchedGTIds.has(e.id));

  const result: BenchResult = {
    meta: {
      scenario: config.scenario,
      timestamp: new Date().toISOString(),
      judgeMode: config.judgeMode,
      groundTruthVersion: gt.version,
      pipelineDurationMs: report.summary.totalDurationMs,
      judgeDurationMs,
    },
    metrics: { precision, recall, f1, usefulnessRate, signalRatio, snr, snrRating, fpr },
    cost: {
      totalUsd: totalCost,
      perBugHit: bugHits > 0 ? totalCost / bugHits : totalCost,
      perFinding: totalFindings > 0 ? totalCost / totalFindings : 0,
      judgeCostUsd: config.judgeMode === 'llm' ? judgeCostUsd : 0,
    },
    counts: {
      totalFindings,
      bugHits,
      validSuggestions,
      noise,
      groundTruthTotal: gt.entries.length,
      groundTruthMatched: matchedGTIds.size,
    },
    layers,
    verdicts,
    missed,
  };

  // Save to JSON
  await mkdir(config.outputDir, { recursive: true });
  const filename = `${config.scenario}-${config.judgeMode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(join(config.outputDir, filename), JSON.stringify(result, null, 2));

  return result;
}

export function renderBenchResult(result: BenchResult): void {
  console.log('');
  console.log('\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
  console.log('\u2502  VCR BENCH \u2014 Evaluation Results                     \u2502');
  console.log('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
  console.log('');
  console.log(`  Scenario:     ${result.meta.scenario}`);
  console.log(`  Judge:        ${result.meta.judgeMode}`);
  console.log(`  GT version:   ${result.meta.groundTruthVersion}`);
  console.log(`  Timestamp:    ${result.meta.timestamp}`);
  console.log('');
  console.log('  -- Metrics --');
  console.log(`  Precision:       ${pct(result.metrics.precision)}  ${dot(result.metrics.precision >= 0.8)}`);
  console.log(`  Recall:          ${pct(result.metrics.recall)}  ${dot(result.metrics.recall >= 0.8)}`);
  console.log(`  F1:              ${pct(result.metrics.f1)}  ${dot(result.metrics.f1 >= 0.7)}`);
  console.log(`  Usefulness:      ${pct(result.metrics.usefulnessRate)}  ${dot(result.metrics.usefulnessRate >= 0.8)}`);
  console.log(`  SNR:             ${result.metrics.snr.toFixed(1)}:1  [${result.metrics.snrRating}]`);
  console.log(`  FPR:             ${pct(result.metrics.fpr)}  ${dot(result.metrics.fpr <= 0.05)}`);
  console.log('');
  console.log('  -- Counts --');
  console.log(`  Bug hits:        ${result.counts.bugHits} / ${result.counts.totalFindings} findings`);
  console.log(`  GT matched:      ${result.counts.groundTruthMatched} / ${result.counts.groundTruthTotal}`);
  console.log(`  Valid:           ${result.counts.validSuggestions}`);
  console.log(`  Noise:           ${result.counts.noise}`);
  console.log('');
  console.log('  -- Cost --');
  console.log(`  Pipeline:        $${result.cost.totalUsd.toFixed(2)}`);
  console.log(`  Judge:           $${result.cost.judgeCostUsd.toFixed(3)}`);
  console.log(`  Per bug hit:     $${result.cost.perBugHit.toFixed(3)}`);
  console.log('');

  if (result.missed.length > 0) {
    console.log(`  -- Missed (${result.missed.length}) --`);
    for (const m of result.missed) {
      console.log(`  T${m.tier} ${m.id}  ${m.title}`);
    }
    console.log('');
  }

  console.log(`  Results saved to: bench/results/`);
  console.log('');
}

function pct(v: number): string { return `${(v * 100).toFixed(0)}%`.padEnd(5); }
function dot(ok: boolean): string { return ok ? '[pass]' : '[fail]'; }
