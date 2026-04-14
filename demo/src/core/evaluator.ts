import type { ReviewReport, Finding } from './types.js';
import type { GroundTruthEntry } from '../scenarios/perfect-pr/ground-truth.js';

// === CR-Bench style classification ===

export type FindingClassification = 'bug-hit' | 'valid-suggestion' | 'noise';

export interface ClassifiedFinding {
  finding: Finding;
  classification: FindingClassification;
  matchedGroundTruth?: string;  // GT id if matched
}

export interface TriageReport {
  // Identification
  scenario: string;
  timestamp: string;

  // CR-Bench metrics
  totalFindings: number;
  bugHits: number;
  validSuggestions: number;
  noise: number;

  // Standard metrics
  precision: number;     // bugHits / totalFindings
  recall: number;        // matched GT entries / total GT entries
  f1: number;            // harmonic mean
  usefulnessRate: number; // (bugHits + validSuggestions) / totalFindings — CR-Bench

  // Signal-to-Noise (SNR framework)
  signalRatio: number;   // (tier1 hits + tier2 hits) / total findings
  snr: number;           // (bugHits + validSuggestions) / max(noise, 1)
  snrRating: 'excellent' | 'good' | 'acceptable' | 'poor';

  // False Positive Rate
  fpr: number;           // noise / totalFindings

  // Cost efficiency
  costPerBugHit: number;
  costPerFinding: number;
  totalCost: number;

  // Per-layer breakdown
  layerBreakdown: LayerTriageMetrics[];

  // Detailed classifications
  classifications: ClassifiedFinding[];

  // Missed ground truth
  missed: GroundTruthEntry[];
}

export interface LayerTriageMetrics {
  layer: number;
  name: string;
  findings: number;
  bugHits: number;
  noise: number;
  precision: number;
  costUsd: number;
  durationMs: number;
}

export function evaluateReport(
  report: ReviewReport,
  groundTruth: GroundTruthEntry[]
): TriageReport {
  const allFindings = report.layers.flatMap(l => l.findings);

  // Classify each finding against ground truth
  const matchedGTIds = new Set<string>();
  const classifications: ClassifiedFinding[] = allFindings.map(f => {
    const match = findGroundTruthMatch(f, groundTruth);
    if (match) {
      matchedGTIds.add(match.id);
      return { finding: f, classification: 'bug-hit' as const, matchedGroundTruth: match.id };
    }
    // Valid suggestion: technically sound finding not in GT but still useful
    if (isValidSuggestion(f)) {
      return { finding: f, classification: 'valid-suggestion' as const };
    }
    return { finding: f, classification: 'noise' as const };
  });

  const bugHits = classifications.filter(c => c.classification === 'bug-hit').length;
  const validSuggestions = classifications.filter(c => c.classification === 'valid-suggestion').length;
  const noise = classifications.filter(c => c.classification === 'noise').length;
  const totalFindings = allFindings.length;

  const precision = totalFindings > 0 ? bugHits / totalFindings : 0;
  const recall = groundTruth.length > 0 ? matchedGTIds.size / groundTruth.length : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  const usefulnessRate = totalFindings > 0 ? (bugHits + validSuggestions) / totalFindings : 0;

  const signalRatio = totalFindings > 0 ? (bugHits + validSuggestions) / totalFindings : 0;
  const snr = (bugHits + validSuggestions) / Math.max(noise, 1);
  const snrRating: TriageReport['snrRating'] =
    signalRatio >= 0.9 ? 'excellent' :
    signalRatio >= 0.8 ? 'good' :
    signalRatio >= 0.6 ? 'acceptable' : 'poor';

  const fpr = totalFindings > 0 ? noise / totalFindings : 0;

  const totalCost = report.summary.totalCostUsd;
  const costPerBugHit = bugHits > 0 ? totalCost / bugHits : totalCost;
  const costPerFinding = totalFindings > 0 ? totalCost / totalFindings : 0;

  // Per-layer breakdown
  const layerBreakdown: LayerTriageMetrics[] = report.layers
    .filter(l => l.findings.length > 0)
    .map(l => {
      const layerClassifications = classifications.filter(c => c.finding.layer === l.layer);
      const layerBugHits = layerClassifications.filter(c => c.classification === 'bug-hit').length;
      const layerNoise = layerClassifications.filter(c => c.classification === 'noise').length;
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

  // Missed GT entries
  const missed = groundTruth.filter(gt => !matchedGTIds.has(gt.id));

  return {
    scenario: report.scenario,
    timestamp: new Date().toISOString(),
    totalFindings,
    bugHits,
    validSuggestions,
    noise,
    precision,
    recall,
    f1,
    usefulnessRate,
    signalRatio,
    snr,
    snrRating,
    fpr,
    costPerBugHit,
    costPerFinding,
    totalCost,
    layerBreakdown,
    classifications,
    missed,
  };
}

// Match finding to ground truth by file + semantic similarity
function findGroundTruthMatch(finding: Finding, gt: GroundTruthEntry[]): GroundTruthEntry | null {
  let bestMatch: GroundTruthEntry | null = null;
  let bestScore = 0;

  for (const entry of gt) {
    // Must match file (or at least the filename part)
    const findingFile = finding.file.split('/').pop() ?? finding.file;
    const gtFile = entry.file.split('/').pop() ?? entry.file;
    if (findingFile !== gtFile && !finding.file.endsWith(entry.file) && !entry.file.endsWith(finding.file)) {
      continue;
    }

    const score = semanticScore(
      `${finding.title} ${finding.description}`,
      `${entry.title} ${entry.description}`
    );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  // Threshold: 0.2 is enough when file already matches
  return bestScore >= 0.2 ? bestMatch : null;
}

// Bidirectional keyword overlap score
function semanticScore(textA: string, textB: string): number {
  const a = textA.toLowerCase();
  const b = textB.toLowerCase();

  // Extract meaningful keywords (4+ chars, skip common words)
  const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'will', 'than', 'they', 'them', 'into', 'does', 'uses', 'instead', 'which', 'should', 'every', 'makes', 'allow']);
  const extractKeywords = (text: string) =>
    (text.match(/\b\w{4,}\b/g) ?? []).filter(w => !stopWords.has(w));

  const kwA = extractKeywords(a);
  const kwB = extractKeywords(b);

  if (kwA.length === 0 || kwB.length === 0) return 0;

  // A→B: how many of A's keywords appear in B's text
  const aInB = kwA.filter(kw => b.includes(kw)).length / kwA.length;
  // B→A: how many of B's keywords appear in A's text
  const bInA = kwB.filter(kw => a.includes(kw)).length / kwB.length;

  // Return the max of both directions (generous matching)
  return Math.max(aInB, bInA);
}

// A finding is a "valid suggestion" if it has reasonable confidence and is actionable
function isValidSuggestion(finding: Finding): boolean {
  return finding.confidence >= 0.7 && finding.suggestion != null && finding.suggestion.length > 0;
}
