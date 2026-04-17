// demo/src/types/showcase.ts
import type { Finding } from '../core/types.js';

export interface ScenarioSummary {
  totalFindings: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  costUsd: number;
  durationMs: number;
  l3Triggered: boolean;
}

export interface ShowcaseScenario {
  name: string;
  title: string;
  language: string;
  type: 'metacircular' | 'standalone';
  prTitle: string;
  prUrl: string | null;
  bugDescription: string;
  findings: Finding[];
  layerCosts: { l0: number; l1: number; l2: number; l3: number };
  layerDurations: { l0: number; l1: number; l2: number; l3: number };
  summary: ScenarioSummary;
  reviewedAt: string;
}

export interface ShowcaseAggregate {
  totalFindings: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  avgCostUsd: number;
  avgDurationMs: number;
  l3TriggerRate: number;
}

export interface ShowcaseResults {
  generatedAt: string;
  scenarios: ShowcaseScenario[];
  aggregate: ShowcaseAggregate;
}

export interface LiveReview {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  totalFindings: number;
  maxSeverity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  costUsd: number;
  durationMs: number;
  reviewedAt: string;
}

export interface LiveReviews {
  reviews: LiveReview[];
}
