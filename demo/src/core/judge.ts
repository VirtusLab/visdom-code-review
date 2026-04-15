import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
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

// ═══════════════════════════════════════════════════════════════
// Advisor Strategy Judge — Haiku executor + Opus advisor
// Uses Anthropic's advisor_20260301 tool for hybrid judgment.
// Haiku handles obvious matches; Opus resolves uncertain cases.
// Single API call per PR, no orchestration needed.
// ═══════════════════════════════════════════════════════════════

export interface AdvisorJudgeResult {
  verdicts: JudgeVerdict[];
  costUsd: number;
  advisorCalls: number;
}

export async function judgeWithAdvisor(
  apiKey: string,
  findings: Finding[],
  groundTruth: GroundTruthEntryJSON[],
  cacheDir: string,
  cacheKey: string,
): Promise<AdvisorJudgeResult> {
  // Check cache
  const cachePath = join(cacheDir, `${cacheKey}.json`);
  if (existsSync(cachePath)) {
    const raw = await readFile(cachePath, 'utf-8');
    return JSON.parse(raw) as AdvisorJudgeResult;
  }

  const client = new Anthropic({ apiKey });

  const findingsList = findings.map((f, i) =>
    `[F${i + 1}] ${f.id} | ${f.severity} | ${f.file}${f.line ? ':' + f.line : ''}\n` +
    `  Title: ${f.title}\n` +
    `  Description: ${f.description?.slice(0, 200) ?? ''}`
  ).join('\n\n');

  const gtList = groundTruth.map(gt =>
    `[${gt.id}] Tier ${gt.tier} | ${gt.category}\n` +
    `  ${gt.title}\n` +
    `  ${gt.description?.slice(0, 200) ?? ''}`
  ).join('\n\n');

  const system = `You are a benchmark evaluation judge for AI code review tools.

You receive a list of FINDINGS (what the code review tool reported) and GOLDEN COMMENTS (ground truth — the real bugs human reviewers identified).

For each finding, classify it:
- "bug-hit": matches a golden comment (same underlying issue, different wording is fine)
- "valid-suggestion": technically correct and actionable, but not in the golden comments
- "noise": incorrect, vague, style-only, or hallucinated

Rules:
- Match on SUBSTANCE. "forEach with async callback" and "fire-and-forget promises in loop" are the same bug.
- Each golden comment can be matched by at most one finding (first match wins).
- If you're uncertain whether a finding matches a golden comment, use your advisor tool for a second opinion.
- The advisor should respond in under 100 words and use enumerated steps, not explanations.

After analysis, you MUST output ONLY a JSON array (no other text before or after):
[
  { "findingId": "L1-SEC-001", "classification": "bug-hit", "matchedGT": "GT-003", "confidence": 0.95, "reasoning": "same SSRF issue" },
  { "findingId": "L2-AUTH-002", "classification": "noise", "matchedGT": null, "confidence": 0.9, "reasoning": "generic advice" }
]

CRITICAL: Your final output must be ONLY the JSON array. No markdown, no explanations. Use the exact findingId values from the input (F1→first finding's ID, F2→second, etc).`;

  const prompt = `## Findings from code review tool (${findings.length} total)

${findingsList}

## Golden comments / ground truth (${groundTruth.length} total)

${gtList}`;

  const response = await client.beta.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    betas: ['advisor-tool-2026-03-01'],
    tools: [
      {
        type: 'advisor_20260301' as any,
        name: 'advisor',
        model: 'claude-opus-4-6',
      } as any,
    ],
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract text content from response
  let responseText = '';
  let advisorCalls = 0;
  for (const block of response.content) {
    if (block.type === 'text') {
      responseText += block.text;
    }
    if ((block as any).type === 'server_tool_use' && (block as any).name === 'advisor') {
      advisorCalls++;
    }
    // Also extract advisor result text
    if ((block as any).type === 'advisor_tool_result') {
      const content = (block as any).content;
      if (content?.type === 'advisor_result' && content.text) {
        responseText += '\n' + content.text;
      }
    }
  }

  if (process.env.DEBUG) {
    console.log(`[advisor-judge] Response text: ${responseText.slice(0, 500)}`);
    console.log(`[advisor-judge] Advisor calls: ${advisorCalls}`);
  }

  // Parse verdicts
  const verdicts = parseAdvisorVerdicts(responseText, findings);

  // Calculate cost from usage
  const usage = response.usage as any;
  const haikusCost = (usage.input_tokens ?? 0) * 0.0000008 + (usage.output_tokens ?? 0) * 0.000004;
  let advisorCost = 0;
  if (usage.iterations) {
    for (const iter of usage.iterations) {
      if (iter.type === 'advisor_message') {
        advisorCost += (iter.input_tokens ?? 0) * 0.000015 + (iter.output_tokens ?? 0) * 0.000075;
      }
    }
  }

  const result: AdvisorJudgeResult = {
    verdicts,
    costUsd: haikusCost + advisorCost,
    advisorCalls,
  };

  // Cache
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(result, null, 2));

  return result;
}

function parseAdvisorVerdicts(content: string, findings: Finding[]): JudgeVerdict[] {
  // Try JSON array first
  const jsonMatch = content.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const parsed: Array<{
        findingId: string;
        classification: string;
        matchedGT: string | null;
        confidence: number;
        reasoning: string;
      }> = JSON.parse(jsonMatch[0]);

      const resultMap = new Map(parsed.map(p => [p.findingId, p]));

      return findings.map(f => {
        const p = resultMap.get(f.id);
        if (p) {
          return {
            findingId: f.id,
            classification: (p.classification as JudgeClassification) ?? 'noise',
            matchedGroundTruth: p.matchedGT ?? null,
            confidence: p.confidence ?? 0.5,
            reasoning: p.reasoning ?? '',
          };
        }
        return fallbackClassify(f, content, findings);
      });
    } catch {
      // JSON parse failed, try narrative fallback
    }
  }

  // Narrative fallback: parse "F1 → GT-001" or "F2 → no GT match" patterns
  return findings.map(f => fallbackClassify(f, content, findings));
}

function fallbackClassify(finding: Finding, responseText: string, allFindings: Finding[]): JudgeVerdict {
  const idx = allFindings.indexOf(finding) + 1;
  const text = responseText.toLowerCase();

  // Look for "F{idx} → GT-XXX" patterns (narrative format from advisor)
  const matchPattern = new RegExp(`f${idx}[^\\n]*(?:→|->|:)[^\\n]*(gt-\\d+)`, 'i');
  const gtMatch = responseText.match(matchPattern);

  if (gtMatch) {
    const gtId = gtMatch[1].toUpperCase();
    // Check if it's described as a match
    const context = responseText.slice(Math.max(0, (gtMatch.index ?? 0) - 20), (gtMatch.index ?? 0) + 200).toLowerCase();
    if (/match|same|identical|corresponds|identifies|catches/i.test(context) && !/no match|doesn't match|not match/i.test(context)) {
      return {
        findingId: finding.id,
        classification: 'bug-hit',
        matchedGroundTruth: gtId,
        confidence: 0.8,
        reasoning: `Advisor narrative: F${idx} matches ${gtId}`,
      };
    }
  }

  // Look for "F{idx} → no GT match" or "no match"
  const noMatchPattern = new RegExp(`f${idx}[^\\n]*(?:no (?:gt )?match|no ground truth|unmatched)`, 'i');
  if (noMatchPattern.test(responseText)) {
    return {
      findingId: finding.id,
      classification: finding.confidence >= 0.7 ? 'valid-suggestion' : 'noise',
      matchedGroundTruth: null,
      confidence: 0.7,
      reasoning: `Advisor narrative: F${idx} has no GT match`,
    };
  }

  // Look for noise indicators
  const noisePattern = new RegExp(`f${idx}[^\\n]*(?:noise|hallucinated|incorrect|vague|style)`, 'i');
  if (noisePattern.test(responseText)) {
    return {
      findingId: finding.id,
      classification: 'noise',
      matchedGroundTruth: null,
      confidence: 0.7,
      reasoning: `Advisor narrative: F${idx} classified as noise`,
    };
  }

  // Default: valid-suggestion if high confidence finding
  return {
    findingId: finding.id,
    classification: finding.confidence >= 0.7 ? 'valid-suggestion' : 'noise',
    matchedGroundTruth: null,
    confidence: 0.5,
    reasoning: `Advisor response did not classify F${idx}`,
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
