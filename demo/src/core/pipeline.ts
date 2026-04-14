import { EventEmitter } from 'node:events';
import type {
  LayerAnalyzer,
  ReviewContext,
  ReviewReport,
  ReviewSummary,
  Reporter,
} from './types.js';

export class ReviewPipeline extends EventEmitter {
  constructor(
    private layers: LayerAnalyzer[],
    private reporters: Reporter[]
  ) {
    super();
  }

  async run(context: ReviewContext): Promise<ReviewReport> {
    this.emit('pipeline:start', { type: 'pipeline:start', scenario: context.scenario });

    for (const layer of this.layers) {
      this.emit('layer:start', { type: 'layer:start', layer: layer.layer, name: layer.name });

      const result = await layer.analyze(context);
      context.previousLayers.push(result);

      for (const finding of result.findings) {
        this.emit('finding:new', { type: 'finding:new', finding });
      }

      this.emit('layer:complete', { type: 'layer:complete', result });

      if (result.gate) {
        this.emit('gate:decision', { type: 'gate:decision', decision: result.gate });
        if (!result.gate.proceed) {
          break;
        }
      }
    }

    const report = this.buildReport(context);
    this.emit('pipeline:complete', { type: 'pipeline:complete', report });

    for (const reporter of this.reporters) {
      await reporter.render(report);
    }

    return report;
  }

  private buildReport(context: ReviewContext): ReviewReport {
    return buildReport(context);
  }
}

export function buildReport(context: ReviewContext): ReviewReport {
  const allFindings = context.previousLayers.flatMap((l) => l.findings);
  const totalDurationMs = context.previousLayers.reduce((sum, l) => sum + l.metrics.durationMs, 0);
  const totalCostUsd = context.previousLayers.reduce((sum, l) => sum + l.metrics.costUsd, 0);

  const bySeverity: Record<string, number> = {};
  for (const f of allFindings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }

  const summary: ReviewSummary = {
    totalFindings: allFindings.length,
    bySeverity,
    totalDurationMs,
    totalCostUsd,
    traditionalComparison: {
      traditional: {
        findings: 0,
        waitTime: '24-48h',
        cost: '~1h senior engineer',
        riskMissed: 'auth bypass ships to production',
      },
      vcr: {
        findings: allFindings.length,
        time: formatDuration(totalDurationMs),
        cost: `$${totalCostUsd.toFixed(2)}`,
        riskCaught: 'caught before merge',
      },
    },
  };

  return {
    scenario: context.scenario,
    pr: context.pr,
    layers: context.previousLayers,
    summary,
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
