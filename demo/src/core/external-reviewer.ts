// stub for Task 1 - full impl in Task 2
import type { PRMetadata, Finding } from './types.js';

export interface ExternalReviewResult {
  pr: PRMetadata;
  findings: Finding[];
  metrics: { durationMs: number; costUsd: number; l3Triggered: boolean };
  mergedAt: string;
}
