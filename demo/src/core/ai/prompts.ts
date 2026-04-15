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
    system: `You are a code review triage agent. Your job is risk classification and defect detection on pull request diffs.

Tasks:
1. Classify overall risk: LOW, MEDIUM, HIGH, or CRITICAL
2. If test files are present, check for circular/tautological test patterns
3. Report ONLY concrete defects you are confident about

CRITICAL RULES — violations cause the system to be disabled:
- NEVER report style preferences, naming suggestions, or "consider using X" advice
- NEVER report generic best practices that aren't specific to this diff
- NEVER report something already caught by Layer 1 (listed below)
- Report ONLY if you can point to a specific line and explain the concrete bug or vulnerability
- If you are not confident, report NOTHING. Silence is acceptable. Noise is not.
- Maximum 3 findings. Quality over quantity.

Respond in this exact JSON format:
{
  "risk": "LOW|MEDIUM|HIGH|CRITICAL",
  "riskReason": "one sentence",
  "circularTests": {
    "detected": true/false,
    "count": number,
    "total": number,
    "details": "explanation or empty string"
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

### Layer 1 (deterministic) findings already reported — do NOT duplicate:
${l1Summary}

### Diff:
\`\`\`
${truncateDiff(context.diff, 8000)}
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
    .map((f) => {
      const lang = detectLanguage(f.path);
      return `### ${f.path} (${f.classification})\n\`\`\`${lang}\n${truncateContent(f.content, 3000)}\n\`\`\``;
    })
    .join('\n\n');

  const lensInstructions: Record<string, string> = {
    security: `You are a security and safety reviewer. Analyze for vulnerabilities AND dangerous runtime behavior.

Report:
- Injection: SQL, NoSQL, XSS, SSRF, command injection, path traversal — including raw SQL in migrations
- Auth bypasses: missing checks, wrong credential comparison, token handling errors
- Auth/security degradation: error paths that fail OPEN (granting access), feature flags that always evaluate to one branch
- Null/nil dereference that causes crashes in production (not just theoretical)
- Thread-safety: lazy-initialized shared state without synchronization, mutable class-level variables accessed concurrently
- Cryptographic weaknesses with specific impact
- Unsafe state: reading state that may not exist, accessing dict keys without presence check

DO NOT report:
- Generic "add input validation" without a specific attack path
- Style preferences or naming issues
- Anything already found by earlier layers (listed below)

Maximum 4 findings. Only report if confidence > 0.8.`,

    architecture: `You are a correctness reviewer. Analyze ONLY for logic defects and behavioral bugs.

Report:
- Logic errors: wrong condition, inverted boolean, off-by-one, wrong variable used
- Return value misuse: calling methods on wrong return type (e.g. safeParse result treated as data), ignoring error returns, using Response as JSON
- Race conditions: concurrent access without synchronization, TOCTOU, stale reads under concurrency
- Wrong method/object: calling session instead of delegate, using wrong provider, returning wrong value
- Asymmetric logic: caching reads but not writes, checking one path but not another
- Overly broad scope: filter/delete/update conditions that affect more records than intended
- Resource lifecycle: opened but not closed, used after close
- Negative/boundary cases: negative indices, empty collections, null propagation through call chains
- API misuse: invalid schema syntax, wrong argument types, deprecated patterns that cause runtime errors

DO NOT report:
- Separation of concerns, coupling, or design pattern suggestions
- Naming, documentation, or style issues
- Performance optimizations or "consider using X" advice
- Anything already found by earlier layers (listed below)

Maximum 4 findings. Only report if confidence > 0.8.`,

    'test-quality': `You are a test quality reviewer. Analyze ONLY for tests that provide false assurance.

Report:
- Circular tests: tests that mock the thing they verify
- Tests that assert mock interactions, not outcomes
- Tests that would still pass if the production code were completely broken
- Flaky patterns: fixed sleeps instead of condition waits, timezone-dependent assertions, order-dependent tests
- Comment-code contradictions: test description says one thing but assertion checks another
- Critical untested paths that handle security or data integrity

DO NOT report:
- Missing edge case tests (unless the edge case is a security boundary)
- Style issues in test code
- "Could add more assertions" without a specific missed bug
- Anything already found by earlier layers (listed below)

Maximum 3 findings. Only report if confidence > 0.8.`,
  };

  return {
    system: `${lensInstructions[lens]}

Previous findings from earlier layers — do NOT duplicate:
${priorSummary}

CRITICAL: If you have nothing confident to report, return an empty findings array. An empty response is BETTER than a noisy one.

Respond in JSON:
{
  "lens": "${lens}",
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "string",
      "file": "path",
      "line": number_or_null,
      "title": "short title",
      "description": "concrete problem and impact",
      "suggestion": "specific fix",
      "confidence": 0.0_to_1.0
    }
  ]
}`,
    prompt: `## PR: ${context.pr.title}

### Code:
${fileContents}`,
  };
}

function detectLanguage(path: string): string {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.go')) return 'go';
  if (path.endsWith('.rb') || path.endsWith('.erb')) return 'ruby';
  if (path.endsWith('.rs')) return 'rust';
  if (path.endsWith('.css') || path.endsWith('.scss')) return 'css';
  return '';
}

function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) return diff;
  return diff.slice(0, maxChars) + '\n... (truncated)';
}

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n... (truncated)';
}
