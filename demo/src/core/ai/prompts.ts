import type { ReviewContext, Finding } from '../types.js';

export function buildQuickScanPrompt(context: ReviewContext, l1Findings: Finding[]): {
  system: string;
  prompt: string;
} {
  const fileList = context.files
    .map((f) => `- ${f.path} (${f.classification}, ${f.linesChanged} lines)`)
    .join('\n');

  const l1Summary = l1Findings.length > 0
    ? l1Findings.map((f) => `- [${f.severity.toUpperCase()}] ${f.id}: ${f.title} (${f.file}:${f.line ?? '?'})`).join('\n')
    : 'No deterministic findings.';

  return {
    system: `You are a code review triage agent for the VCR (VISDOM Code Review) system.

Your job:
1. Classify the overall risk of this PR: LOW, MEDIUM, HIGH, or CRITICAL
2. Detect circular/tautological test patterns
3. Identify up to 5 quick findings beyond what Layer 1 already caught

Rules:
- Be PRECISE. False positives erode trust. When unsure, omit the finding.
- Focus on issues that a static regex scanner (Layer 1) would miss.
- For test analysis: a "circular test" is one that mocks the dependency AND verifies the mock behavior, testing nothing real.

Respond in this exact JSON format:
{
  "risk": "LOW|MEDIUM|HIGH|CRITICAL",
  "riskReason": "one sentence explaining the risk level",
  "circularTests": {
    "detected": true/false,
    "count": number,
    "total": number,
    "details": "explanation"
  },
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "string",
      "file": "path",
      "line": number_or_null,
      "title": "short title",
      "description": "what's wrong and why it matters",
      "suggestion": "how to fix it"
    }
  ]
}`,
    prompt: `## PR: ${context.pr.title}

### Files changed:
${fileList}

### Layer 1 (deterministic) findings:
${l1Summary}

### Full diff:
\`\`\`
${context.diff}
\`\`\``,
  };
}

export function buildDeepReviewPrompt(
  lens: 'security' | 'architecture' | 'test-quality',
  context: ReviewContext,
  priorFindings: Finding[]
): { system: string; prompt: string } {
  const priorSummary = priorFindings
    .map((f) => `- [${f.severity.toUpperCase()}] ${f.id}: ${f.title}`)
    .join('\n') || 'None yet.';

  const fileContents = context.files
    .map((f) => `### ${f.path} (${f.classification})\n\`\`\`typescript\n${f.content}\n\`\`\``)
    .join('\n\n');

  const lensInstructions: Record<string, string> = {
    security: `You are a security-focused code reviewer specializing in OWASP Top 10 and authentication vulnerabilities.

Focus areas:
- Password storage (hashing algorithm, cost factor)
- Token generation (randomness quality, JWT configuration)
- Input validation and sanitization
- Error information leakage
- Rate limiting and brute-force protection
- JWT verification (algorithm restrictions, expiry checking)

Only report findings with confidence > 0.7. Prefer precision over recall.`,

    architecture: `You are an architecture reviewer focused on separation of concerns, testability, and coupling.

Focus areas:
- Business logic mixed with transport/HTTP concerns
- Data layer leaking implementation details
- Unnecessary data exposure between layers
- Testability of components in isolation

Only report findings with confidence > 0.7.`,

    'test-quality': `You are a test quality expert. You analyze test EFFECTIVENESS, not coverage numbers.

Focus areas:
- Circular tests: tests that mock the thing they're testing
- Mock-heavy tests: mocking both the dependency AND the caller means you test the mock framework
- Assertion quality: "function was called" vs "result is correct"
- Missing test scenarios: negative cases, edge cases, error paths
- Tests that verify implementation details rather than behavior

Only report findings with confidence > 0.7.`,
  };

  return {
    system: `${lensInstructions[lens]}

Previous findings from earlier layers (do NOT duplicate these):
${priorSummary}

Respond in this exact JSON format:
{
  "lens": "${lens}",
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "string",
      "file": "path",
      "line": number_or_null,
      "title": "short title",
      "description": "what's wrong and why it matters",
      "suggestion": "how to fix it",
      "confidence": 0.0_to_1.0
    }
  ]
}`,
    prompt: `## PR: ${context.pr.title}

### Full file contents:
${fileContents}`,
  };
}
