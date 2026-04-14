import type { LayerAnalyzer, ReviewContext, LayerResult, Finding, GateDecision } from '../types.js';
import type { AIClient } from '../ai/client.js';
import { buildQuickScanPrompt } from '../ai/prompts.js';

interface QuickScanResponse {
  risk: string;
  riskReason: string;
  circularTests: {
    detected: boolean;
    count: number;
    total: number;
    details: string;
  };
  findings: Array<{
    severity: string;
    category: string;
    file: string;
    line: number | null;
    title: string;
    description: string;
    suggestion: string;
  }>;
}

export class AIQuickScan implements LayerAnalyzer {
  readonly layer = 2 as const;
  readonly name = 'AI Quick Scan';

  constructor(private ai: AIClient, private scenario: string) {}

  async analyze(context: ReviewContext): Promise<LayerResult> {
    const start = performance.now();

    const l1Findings = context.previousLayers
      .filter((l) => l.layer === 1)
      .flatMap((l) => l.findings);

    const { system, prompt } = buildQuickScanPrompt(context, l1Findings);

    const response = await this.ai.complete({
      model: 'haiku',
      system,
      prompt,
      cacheKey: `${this.scenario}/layer2-quick-scan`,
    });

    const parsed = parseResponse(response.content);

    const findings: Finding[] = [];
    let findingIndex = 1;

    if (parsed.circularTests.detected) {
      findings.push({
        id: `L2-TEST-001`,
        severity: 'high',
        category: 'test-quality',
        file: context.files.find((f) => f.classification === 'test')?.path ?? 'test/',
        title: `${parsed.circularTests.count}/${parsed.circularTests.total} tests are circular (mock-on-mock)`,
        description: parsed.circularTests.details,
        layer: 2,
        confidence: 0.85,
      });
      findingIndex++;
    }

    for (const f of parsed.findings.slice(0, 5)) {
      findings.push({
        id: `L2-${f.category.toUpperCase().slice(0, 4)}-${String(findingIndex).padStart(3, '0')}`,
        severity: f.severity as Finding['severity'],
        category: f.category,
        file: f.file,
        line: f.line ?? undefined,
        title: f.title,
        description: f.description,
        suggestion: f.suggestion,
        layer: 2,
        confidence: 0.8,
      });
      findingIndex++;
    }

    const risk = parsed.risk.toLowerCase() as GateDecision['risk'];
    const proceed = risk !== 'low';

    const gate: GateDecision = {
      proceed,
      risk,
      reason: parsed.riskReason,
    };

    const durationMs = performance.now() - start;

    return {
      layer: 2,
      name: this.name,
      findings,
      metrics: {
        durationMs,
        costUsd: response.costUsd,
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
      },
      gate,
    };
  }
}

function parseResponse(content: string): QuickScanResponse {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, content];
  const jsonStr = (jsonMatch[1] ?? content).trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    return {
      risk: 'HIGH',
      riskReason: 'Could not parse AI response; defaulting to HIGH risk.',
      circularTests: { detected: false, count: 0, total: 0, details: '' },
      findings: [],
    };
  }
}
