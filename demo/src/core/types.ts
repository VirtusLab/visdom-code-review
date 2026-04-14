import { EventEmitter } from 'node:events';

// === Review Context ===

export interface ReviewContext {
  scenario: string;
  pr: PRMetadata;
  diff: string;
  files: FileInfo[];
  previousLayers: LayerResult[];
}

export interface PRMetadata {
  number: number;
  url: string;
  branch: string;
  title: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface FileInfo {
  path: string;
  content: string;
  classification: 'critical' | 'standard' | 'test' | 'config';
  linesChanged: number;
}

// === Layer Results ===

export interface LayerResult {
  layer: 0 | 1 | 2 | 3;
  name: string;
  findings: Finding[];
  metrics: LayerMetrics;
  gate?: GateDecision;
}

export interface Finding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  file: string;
  line?: number;
  title: string;
  description: string;
  suggestion?: string;
  layer: number;
  lens?: string;
  confidence: number;
}

export interface LayerMetrics {
  durationMs: number;
  costUsd: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface GateDecision {
  proceed: boolean;
  risk: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

// === Layer Interface ===

export interface LayerAnalyzer {
  readonly layer: number;
  readonly name: string;
  analyze(context: ReviewContext): Promise<LayerResult>;
}

// === Pipeline Events ===

export type PipelineEvent =
  | { type: 'pipeline:start'; scenario: string }
  | { type: 'layer:start'; layer: number; name: string }
  | { type: 'layer:complete'; result: LayerResult }
  | { type: 'finding:new'; finding: Finding }
  | { type: 'gate:decision'; decision: GateDecision }
  | { type: 'pipeline:complete'; report: ReviewReport }
  | { type: 'github:pr-created'; url: string }
  | { type: 'github:comment-posted'; url: string };

// === Reporter ===

export interface Reporter {
  render(report: ReviewReport): Promise<void>;
}

export interface ReviewReport {
  scenario: string;
  pr: PRMetadata;
  layers: LayerResult[];
  summary: ReviewSummary;
}

export interface ReviewSummary {
  totalFindings: number;
  bySeverity: Record<string, number>;
  totalDurationMs: number;
  totalCostUsd: number;
  traditionalComparison: TraditionalComparison;
}

export interface TraditionalComparison {
  traditional: { findings: number; waitTime: string; cost: string; riskMissed: string };
  vcr: { findings: number; time: string; cost: string; riskCaught: string };
}

// === Scenario Config ===

export interface ScenarioConfig {
  name: string;
  title: string;
  description: string;
  branch: string;
  prTitle: string;
  prBody: string;
  files: Record<string, string>;
}

// === AI Client ===

export interface AIResponse {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

// === CLI Options ===

export interface CLIOptions {
  live: boolean;
  local: boolean;
  cleanup: boolean;
  list: boolean;
  scenario: string;
  narrate: boolean;
  interactive: boolean;
  triage: boolean;
  bench: boolean;
}
