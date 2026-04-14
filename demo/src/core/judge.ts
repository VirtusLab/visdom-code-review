import type { AIClient } from './ai/client.js';
import type { Finding } from './types.js';

export interface GroundTruthJSON {
  scenario: string;
  version: string;
  language: string;
  domain: string;
  description: string;
  entries: GroundTruthEntryJSON[];
}

export interface GroundTruthEntryJSON {
  id: string;
  tier: 1 | 2;
  category: string;
  file: string;
  line?: number;
  title: string;
  description: string;
  cwe?: string;
  owasp?: string;
}

export type JudgeClassification = 'bug-hit' | 'valid-suggestion' | 'noise';

export interface JudgeVerdict {
  findingId: string;
  classification: JudgeClassification;
  matchedGroundTruth: string | null;
  confidence: number;
  reasoning: string;
}

export async function judgeFinding(
  ai: AIClient,
  finding: Finding,
  groundTruth: GroundTruthEntryJSON[],
  scenario: string
): Promise<JudgeVerdict> {
  // Filter GT entries to same file (or skip file filter if no match — let judge decide)
  const sameFile = groundTruth.filter(gt => {
    const fFile = finding.file.split('/').pop() ?? finding.file;
    const gFile = gt.file.split('/').pop() ?? gt.file;
    return fFile === gFile || finding.file.endsWith(gt.file) || gt.file.endsWith(finding.file);
  });

  const candidates = sameFile.length > 0 ? sameFile : groundTruth;

  const gtList = candidates.map(gt =>
    `- [${gt.id}] (Tier ${gt.tier}, ${gt.category}) ${gt.title}\n  File: ${gt.file}${gt.line ? ':' + gt.line : ''}\n  ${gt.description}`
  ).join('\n');

  const system = `You are an evaluation judge for a code review benchmark.

Your job: classify a code review finding against a ground truth list.

Classifications:
- "bug-hit": The finding identifies the SAME underlying issue as a ground truth entry. Different wording is fine — only the substance matters.
- "valid-suggestion": The finding is technically correct and actionable, but does NOT match any ground truth entry. It found something real that wasn't in the planted bugs.
- "noise": The finding is incorrect, hallucinated, too vague to be actionable, or a pure style preference.

Rules:
- Match on SUBSTANCE, not exact wording. "Timing-unsafe comparison" and "Token compared with ===" are the same issue.
- A finding can match at most ONE ground truth entry.
- If the finding covers the same file and same type of issue as a GT entry, it's likely a match.
- Be generous with matching — if it's the same vulnerability described differently, it's a bug-hit.

Respond in JSON:
{
  "classification": "bug-hit" | "valid-suggestion" | "noise",
  "matchedGroundTruth": "GT-XXX" or null,
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence"
}`;

  const prompt = `## Finding to classify

ID: ${finding.id}
Severity: ${finding.severity}
Category: ${finding.category}
File: ${finding.file}${finding.line ? ':' + finding.line : ''}
Title: ${finding.title}
Description: ${finding.description}
${finding.suggestion ? 'Suggestion: ' + finding.suggestion : ''}

## Ground truth entries (candidates)

${gtList}`;

  const response = await ai.complete({
    model: 'haiku',
    system,
    prompt,
    cacheKey: `${scenario}/judge/${finding.id}`,
  });

  return parseJudgeResponse(response.content, finding.id);
}

function parseJudgeResponse(content: string, findingId: string): JudgeVerdict {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { findingId, classification: 'noise', matchedGroundTruth: null, confidence: 0.5, reasoning: 'Could not parse judge response' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      findingId,
      classification: parsed.classification ?? 'noise',
      matchedGroundTruth: parsed.matchedGroundTruth ?? null,
      confidence: parsed.confidence ?? 0.5,
      reasoning: parsed.reasoning ?? '',
    };
  } catch {
    return { findingId, classification: 'noise', matchedGroundTruth: null, confidence: 0.5, reasoning: 'JSON parse error' };
  }
}

// Keyword-based fallback (for offline mode without API key)
export function judgeByKeywords(
  finding: Finding,
  groundTruth: GroundTruthEntryJSON[]
): JudgeVerdict {
  let bestMatch: GroundTruthEntryJSON | null = null;
  let bestScore = 0;

  for (const entry of groundTruth) {
    // Skip file filter if GT has no file path (e.g. Martian dataset uses '*')
    if (entry.file !== '*') {
      const findingFile = finding.file.split('/').pop() ?? finding.file;
      const gtFile = entry.file.split('/').pop() ?? entry.file;
      if (findingFile !== gtFile && !finding.file.endsWith(entry.file) && !entry.file.endsWith(finding.file)) {
        continue;
      }
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

  if (bestScore >= 0.2 && bestMatch) {
    return {
      findingId: finding.id,
      classification: 'bug-hit',
      matchedGroundTruth: bestMatch.id,
      confidence: bestScore,
      reasoning: `Keyword match (score: ${bestScore.toFixed(2)})`,
    };
  }

  if (finding.confidence >= 0.7 && finding.suggestion != null && finding.suggestion.length > 0) {
    return {
      findingId: finding.id,
      classification: 'valid-suggestion',
      matchedGroundTruth: null,
      confidence: finding.confidence,
      reasoning: 'High confidence finding with suggestion, not matched to GT',
    };
  }

  return {
    findingId: finding.id,
    classification: 'noise',
    matchedGroundTruth: null,
    confidence: 0.5,
    reasoning: 'No keyword match found',
  };
}

function semanticScore(textA: string, textB: string): number {
  const a = textA.toLowerCase();
  const b = textB.toLowerCase();

  const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'will', 'than', 'they', 'them', 'into', 'does', 'uses', 'instead', 'which', 'should', 'every', 'makes', 'allow']);
  const extractKeywords = (text: string) =>
    (text.match(/\b\w{4,}\b/g) ?? []).filter(w => !stopWords.has(w));

  const kwA = extractKeywords(a);
  const kwB = extractKeywords(b);

  if (kwA.length === 0 || kwB.length === 0) return 0;

  const aInB = kwA.filter(kw => b.includes(kw)).length / kwA.length;
  const bInA = kwB.filter(kw => a.includes(kw)).length / kwB.length;

  return Math.max(aInB, bInA);
}
