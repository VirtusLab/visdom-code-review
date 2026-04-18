// demo/src/scenarios/meta/hollow-test-suite/files/test/pipeline.test.ts
// DEMO SCENARIO — intentional vulnerabilities for VCR demonstration
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all layers — fast isolation
vi.mock('../src/core/layers/context-collector', () => ({
  ContextCollector: vi.fn().mockImplementation(() => ({
    layer: 0,
    name: 'Context Collection',
    analyze: vi.fn().mockResolvedValue({ layer: 0, findings: [], metrics: { durationMs: 1, costUsd: 0 } }),
  })),
}));

vi.mock('../src/core/layers/deterministic-gate', () => ({
  DeterministicGate: vi.fn().mockImplementation(() => ({
    layer: 1,
    name: 'Deterministic Gate',
    analyze: vi.fn().mockResolvedValue({ layer: 1, findings: [], metrics: { durationMs: 2, costUsd: 0 } }),
  })),
}));

vi.mock('../src/core/layers/ai-quick-scan', () => ({
  AIQuickScan: vi.fn().mockImplementation(() => ({
    layer: 2,
    name: 'AI Quick Scan',
    analyze: vi.fn().mockResolvedValue({ layer: 2, findings: [], gate: { proceed: false, risk: 'low', reason: 'low risk' }, metrics: { durationMs: 5, costUsd: 0.02 } }),
  })),
}));

vi.mock('../src/core/layers/ai-deep-review', () => ({
  AIDeepReview: vi.fn().mockImplementation(() => ({
    layer: 3,
    name: 'AI Deep Review',
    analyze: vi.fn().mockResolvedValue({ layer: 3, findings: [], metrics: { durationMs: 10, costUsd: 0.4 } }),
  })),
}));

import { ContextCollector } from '../src/core/layers/context-collector';
import { DeterministicGate } from '../src/core/layers/deterministic-gate';
import { AIQuickScan } from '../src/core/layers/ai-quick-scan';
import { AIDeepReview } from '../src/core/layers/ai-deep-review';
import { ReviewPipeline } from '../src/core/pipeline';

describe('ReviewPipeline', () => {
  let contextCollector: any;
  let deterministicGate: any;
  let aiQuickScan: any;
  let aiDeepReview: any;
  let pipeline: ReviewPipeline;

  beforeEach(() => {
    contextCollector = new ContextCollector();
    deterministicGate = new DeterministicGate();
    aiQuickScan = new AIQuickScan({} as any, 'test');
    aiDeepReview = new AIDeepReview({} as any, 'test');
    pipeline = new ReviewPipeline([contextCollector, deterministicGate, aiQuickScan, aiDeepReview], []);
  });

  it('calls ContextCollector.analyze', async () => {
    await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(contextCollector.analyze).toHaveBeenCalled();
  });

  it('calls DeterministicGate.analyze', async () => {
    await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(deterministicGate.analyze).toHaveBeenCalled();
  });

  it('calls AIQuickScan.analyze', async () => {
    await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(aiQuickScan.analyze).toHaveBeenCalled();
  });

  it('does not call AIDeepReview when gate says stop', async () => {
    await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(aiDeepReview.analyze).not.toHaveBeenCalled();
  });

  it('ContextCollector has layer 0', () => {
    expect(contextCollector.layer).toBe(0);
  });

  it('DeterministicGate has layer 1', () => {
    expect(deterministicGate.layer).toBe(1);
  });

  it('AIQuickScan has layer 2', () => {
    expect(aiQuickScan.layer).toBe(2);
  });

  it('AIDeepReview has layer 3', () => {
    expect(aiDeepReview.layer).toBe(3);
  });

  it('pipeline emits pipeline:start', async () => {
    const handler = vi.fn();
    pipeline.on('pipeline:start', handler);
    await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(handler).toHaveBeenCalled();
  });

  it('pipeline emits layer:start for each layer', async () => {
    const handler = vi.fn();
    pipeline.on('layer:start', handler);
    await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('pipeline emits pipeline:complete', async () => {
    const handler = vi.fn();
    pipeline.on('pipeline:complete', handler);
    await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(handler).toHaveBeenCalled();
  });

  it('pipeline returns ReviewReport', async () => {
    const report = await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(report).toBeDefined();
    expect(report.layers).toBeDefined();
  });

  it('report.layers contains results from each layer', async () => {
    const report = await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(report.layers.length).toBeGreaterThan(0);
  });

  it('report.summary.totalCostUsd is sum of layer costs', async () => {
    const report = await pipeline.run({ scenario: 'test', pr: {} as any, diff: '', files: [], previousLayers: [] });
    expect(report.summary.totalCostUsd).toBeDefined();
  });
});
