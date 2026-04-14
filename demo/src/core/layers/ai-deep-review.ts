import type { LayerAnalyzer, ReviewContext, LayerResult, Finding } from '../types.js';
import type { AIClient } from '../ai/client.js';
import { buildDeepReviewPrompt } from '../ai/prompts.js';

const LENSES = ['security', 'architecture', 'test-quality'] as const;
type Lens = typeof LENSES[number];

interface LensResponse {
  lens: string;
  findings: Array<{
    severity: string;
    category: string;
    file: string;
    line: number | null;
    title: string;
    description: string;
    suggestion: string;
    confidence: number;
  }>;
}

export class AIDeepReview implements LayerAnalyzer {
  readonly layer = 3 as const;
  readonly name = 'AI Deep Review';

  constructor(private ai: AIClient, private scenario: string) {}

  async analyze(context: ReviewContext): Promise<LayerResult> {
    const start = performance.now();

    const priorFindings = context.previousLayers.flatMap((l) => l.findings);

    const lensResults = await Promise.all(
      LENSES.map((lens) => this.runLens(lens, context, priorFindings))
    );

    const findings: Finding[] = [];
    let totalCost = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    for (const result of lensResults) {
      totalCost += result.cost;
      totalTokensIn += result.tokensIn;
      totalTokensOut += result.tokensOut;

      for (const f of result.findings) {
        findings.push(f);
      }
    }

    const durationMs = performance.now() - start;

    return {
      layer: 3,
      name: this.name,
      findings,
      metrics: {
        durationMs,
        costUsd: totalCost,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
      },
    };
  }

  private async runLens(
    lens: Lens,
    context: ReviewContext,
    priorFindings: Finding[]
  ): Promise<{ findings: Finding[]; cost: number; tokensIn: number; tokensOut: number }> {
    const { system, prompt } = buildDeepReviewPrompt(lens, context, priorFindings);

    const response = await this.ai.complete({
      model: 'sonnet',
      system,
      prompt,
      cacheKey: `${this.scenario}/layer3-${lens}`,
    });

    const parsed = parseLensResponse(response.content);
    const findings: Finding[] = [];

    let index = 1;
    for (const f of parsed.findings) {
      if (f.confidence < 0.7) continue;

      const categoryPrefix = lens === 'security' ? 'SEC'
        : lens === 'architecture' ? 'ARCH'
        : 'TEST';

      findings.push({
        id: `L3-${categoryPrefix}-${String(index).padStart(3, '0')}`,
        severity: f.severity as Finding['severity'],
        category: f.category,
        file: f.file,
        line: f.line ?? undefined,
        title: f.title,
        description: f.description,
        suggestion: f.suggestion,
        layer: 3,
        lens,
        confidence: f.confidence,
      });
      index++;
    }

    return {
      findings,
      cost: response.costUsd,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
    };
  }
}

function parseLensResponse(content: string): LensResponse {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, content];
  const jsonStr = (jsonMatch[1] ?? content).trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    return { lens: 'unknown', findings: [] };
  }
}
