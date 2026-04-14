# VCR Demo — Design Specification

**Version:** 1.0 Draft
**Date:** 2026-04-14
**Author:** Artur Skowroński / VirtusLab VISDOM team
**Status:** Draft — awaiting review
**Parent spec:** `2026-04-14-visdom-code-review-design.md`

---

## 1. Purpose

A runnable CLI demo that demonstrates the VCR pipeline on a real GitHub PR, producing a side-by-side comparison of traditional code review vs VCR automated review. The demo is self-contained — it creates its own branches, commits prepared code, opens a PR, runs the full 4-layer pipeline, and posts findings as PR comments.

### Goals

1. **Convince in under 5 minutes** — run `npm run demo` and see the full pipeline execute on a real PR
2. **Show the contrast** — side-by-side terminal output: traditional review (0 findings, 24h wait) vs VCR (9 findings, 2 minutes, $0.47)
3. **Be reusable** — core pipeline engine is importable as a library for future web UI, GitHub Action, or API server
4. **Work offline** — cached API responses allow demo to run without Claude API key (with `--live` flag for real calls)

### Non-Goals

- Not a production SAST tool (Layer 1 uses regex patterns, not real semgrep/gitleaks)
- Not a general-purpose code review tool (works on prepared scenarios)
- Not a GitHub Action (yet — the core is designed for it, but the Action wrapper is out of scope)

---

## 2. Scenario: "The Perfect PR"

The demo ships with one meticulously crafted scenario that maximizes impact. The PR looks professional — clean code, good naming, tests passing, high coverage — but contains layered vulnerabilities that only VCR catches.

### The Feature

User Authentication Service for a Node.js/Express app. The PR adds login/register endpoints with JWT tokens, password hashing, and a test suite.

### Files in the PR

#### `src/auth/auth.controller.ts`

Express router with `/login` and `/register` endpoints. Clean REST conventions, proper async/await, typed request/response.

**Hidden issues:**
- Token comparison via `===` instead of `crypto.timingSafeEqual` (timing attack vector)
- No rate limiting on login endpoint
- Error messages leak user existence ("User not found" vs "Invalid password" — allows enumeration)
- No input length validation (potential DoS via extremely long passwords sent to bcrypt)

#### `src/auth/auth.service.ts`

Authentication business logic — password hashing, token generation, user lookup.

**Hidden issues:**
- `bcrypt.hash(password, 4)` — cost factor 4 instead of 12+ (brute-forceable in seconds)
- Session token generated via `Math.random().toString(36)` instead of `crypto.randomBytes` (predictable tokens)
- Raw user input passed directly to database query method without sanitization

#### `src/auth/auth.model.ts`

User model with database query methods (simplified query builder pattern).

**Hidden issues:**
- String interpolation in SQL queries: `` `SELECT * FROM users WHERE email = '${email}'` `` (SQL injection)
- No parameterized queries anywhere
- `findByEmail` returns password hash to caller unnecessarily (over-fetching sensitive data)

#### `src/middleware/auth.middleware.ts`

JWT verification middleware for protecting routes.

**Hidden issues:**
- Does not check token expiry (`ignoreExpiration: true` in verify options)
- Does not explicitly block `algorithm: 'none'` (JWT alg-none attack)
- Catches all errors and returns generic 401 — swallows unexpected errors silently

#### `test/auth.test.ts`

12 tests with ~94% line coverage. Looks comprehensive at first glance.

**Hidden issues (the core "aha" moment):**
- 8 of 12 tests mock BOTH the database AND the auth library — they test the behavior of mocks, not real logic
- Tests verify "function was called with args" (spy assertions) instead of "result is correct" (value assertions)
- Zero negative test cases (empty password, SQL in email, expired token, concurrent sessions)
- The "SQL injection prevention" test builds the query the same way as production code and checks it matches — circular test that proves nothing
- The "password security" test checks `bcrypt.hash` was called but not what cost factor was used

#### `.env.test`

Test environment variables.

**Hidden issue:**
- `JWT_SECRET=super-secret-key-123` — hardcoded secret identical to `.env.example`, would leak through git history

### Expected Findings Summary

| Layer | Findings | Key Catches |
|-------|----------|-------------|
| L0 | Context | 6 files, auth-critical classification, 247 lines changed |
| L1 | 4 deterministic | JWT secret in env, SQL string concat, timing-unsafe compare, weak random |
| L2 | Risk: CRITICAL, 3 quick | Circular test pattern (8/12), auth code without rate limit, user enumeration |
| L3 | 6 deep (3 lenses) | bcrypt cost, alg-none, over-fetching hash, no input validation, mock-only tests, no negative cases |

**Total: 13 findings (2 critical, 5 high, 4 medium, 2 low)**

---

## 3. Architecture

### Directory Structure

```
demo/
├── package.json              # separate package, workspace member
├── tsconfig.json
├── src/
│   ├── core/                 # ← reusable engine (the library)
│   │   ├── pipeline.ts       # orchestrator with event emitter
│   │   ├── types.ts          # shared interfaces
│   │   ├── layers/
│   │   │   ├── context-collector.ts    # Layer 0
│   │   │   ├── deterministic-gate.ts   # Layer 1
│   │   │   ├── ai-quick-scan.ts        # Layer 2
│   │   │   └── ai-deep-review.ts       # Layer 3
│   │   ├── ai/
│   │   │   ├── client.ts     # Claude API wrapper with caching
│   │   │   └── prompts.ts    # prompt templates per layer/lens
│   │   ├── github/
│   │   │   └── operations.ts # branch, commit, PR, comment operations
│   │   └── reporter/
│   │       ├── terminal.ts   # side-by-side terminal output
│   │       ├── markdown.ts   # PR comment formatter
│   │       └── types.ts      # reporter interfaces
│   ├── cli/
│   │   └── index.ts          # thin CLI entry point (~50 lines)
│   └── scenarios/
│       └── perfect-pr/
│           ├── scenario.ts   # metadata, expected findings description
│           └── files/        # the actual PR files
│               ├── src/
│               │   ├── auth/
│               │   │   ├── auth.controller.ts
│               │   │   ├── auth.service.ts
│               │   │   └── auth.model.ts
│               │   └── middleware/
│               │       └── auth.middleware.ts
│               ├── test/
│               │   └── auth.test.ts
│               └── .env.test
├── cache/                    # cached Claude API responses
│   └── perfect-pr/
│       ├── layer2-response.json
│       └── layer3-security.json
│       └── layer3-architecture.json
│       └── layer3-test-quality.json
└── README.md
```

### Core Interfaces

```typescript
// === Types (core/types.ts) ===

interface ReviewContext {
  scenario: string;
  pr: PRMetadata;
  diff: string;
  files: FileInfo[];
  previousLayers: LayerResult[];
}

interface PRMetadata {
  number: number;
  url: string;
  branch: string;
  title: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

interface FileInfo {
  path: string;
  content: string;
  classification: 'critical' | 'standard' | 'test' | 'config';
  linesChanged: number;
}

interface LayerResult {
  layer: 0 | 1 | 2 | 3;
  name: string;
  findings: Finding[];
  metrics: LayerMetrics;
  gate?: GateDecision;
}

interface Finding {
  id: string;                // e.g. "L1-SEC-001"
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

interface LayerMetrics {
  durationMs: number;
  costUsd: number;
  tokensIn?: number;
  tokensOut?: number;
}

interface GateDecision {
  proceed: boolean;
  risk: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

// === Layer interface ===

interface LayerAnalyzer {
  readonly layer: number;
  readonly name: string;
  analyze(context: ReviewContext): Promise<LayerResult>;
}

// === Pipeline events ===

type PipelineEvent =
  | { type: 'pipeline:start'; scenario: string }
  | { type: 'layer:start'; layer: number; name: string }
  | { type: 'layer:complete'; result: LayerResult }
  | { type: 'finding:new'; finding: Finding }
  | { type: 'gate:decision'; decision: GateDecision }
  | { type: 'pipeline:complete'; report: ReviewReport }
  | { type: 'github:pr-created'; url: string }
  | { type: 'github:comment-posted'; url: string };

// === Reporter interface ===

interface Reporter {
  render(report: ReviewReport): Promise<void>;
}

interface ReviewReport {
  scenario: string;
  pr: PRMetadata;
  layers: LayerResult[];
  summary: ReviewSummary;
}

interface ReviewSummary {
  totalFindings: number;
  bySeverity: Record<string, number>;
  totalDuration: number;
  totalCost: number;
  traditionalComparison: TraditionalComparison;
}

interface TraditionalComparison {
  traditional: { findings: number; waitTime: string; cost: string; riskMissed: string };
  vcr: { findings: number; time: string; cost: string; riskCaught: string };
}
```

### Pipeline Orchestrator

```typescript
// core/pipeline.ts
class ReviewPipeline extends EventEmitter {
  constructor(
    private layers: LayerAnalyzer[],
    private reporters: Reporter[]
  ) {}

  async run(context: ReviewContext): Promise<ReviewReport> {
    this.emit('pipeline:start', { scenario: context.scenario });

    for (const layer of this.layers) {
      this.emit('layer:start', { layer: layer.layer, name: layer.name });

      const result = await layer.analyze(context);
      context.previousLayers.push(result);

      for (const finding of result.findings) {
        this.emit('finding:new', { finding });
      }

      this.emit('layer:complete', { result });

      // Respect gate decisions — Layer 2 may stop the pipeline
      if (result.gate && !result.gate.proceed) {
        break;
      }
    }

    const report = this.buildReport(context);
    this.emit('pipeline:complete', { report });

    for (const reporter of this.reporters) {
      await reporter.render(report);
    }

    return report;
  }
}
```

### AI Client with Caching

```typescript
// core/ai/client.ts
class AIClient {
  constructor(
    private apiKey: string | undefined,
    private cacheDir: string,
    private live: boolean
  ) {}

  async complete(params: {
    model: 'haiku' | 'sonnet';
    system: string;
    prompt: string;
    cacheKey: string;
  }): Promise<AIResponse> {
    // 1. Check cache first (unless --live --no-cache)
    const cached = await this.loadCache(params.cacheKey);
    if (cached && !this.live) return cached;

    // 2. If no API key, use cache or fail with helpful message
    if (!this.apiKey) {
      if (cached) return cached;
      throw new Error(
        'No ANTHROPIC_API_KEY set and no cached response found. ' +
        'Run with --live and ANTHROPIC_API_KEY to generate fresh responses, ' +
        'or ensure cache/ directory contains pre-generated responses.'
      );
    }

    // 3. Call Claude API
    const response = await this.callClaude(params);

    // 4. Save to cache for future offline runs
    await this.saveCache(params.cacheKey, response);

    return response;
  }
}
```

### GitHub Operations

```typescript
// core/github/operations.ts
class GitHubOps {
  constructor(private octokit: Octokit, private repo: { owner: string; repo: string }) {}

  async setupScenario(scenario: ScenarioConfig): Promise<PRMetadata> {
    // 1. Create branch from current HEAD
    // 2. Commit scenario files
    // 3. Push branch
    // 4. Create PR with description
    return prMetadata;
  }

  async postFindings(pr: PRMetadata, report: ReviewReport): Promise<void> {
    // 1. Post summary comment with side-by-side comparison
    // 2. Post inline comments on specific lines for each finding
  }

  async cleanup(pr: PRMetadata): Promise<void> {
    // Close PR, delete branch
  }
}
```

---

## 4. Layer Implementation Details

### Layer 0: Context Collector

Deterministic. No AI. Reads the scenario files and builds the review context.

- Classifies files by path patterns (`auth/*` → critical, `test/*` → test, `.env*` → config)
- Generates unified diff from scenario files
- Calculates line counts, file counts
- Maps test files to source files

**Duration target:** <1 second
**Cost:** $0

### Layer 1: Deterministic Gate

Zero AI. Pattern matching on file contents using TypeScript regex rules.

Rules implemented for "The Perfect PR":

| Rule ID | Pattern | Catches |
|---------|---------|---------|
| `SEC-001` | `/['"][-\w]+secret[-\w]*['"]\s*[:=]\s*['"][^'"]+['"]/i` in non-test config | Hardcoded secrets |
| `SEC-002` | `` /`[^`]*\$\{[^}]*\}[^`]*`/`` in SQL context | SQL string interpolation |
| `SEC-003` | `/===\s*.*token\|token.*===\|==\s*.*secret/i` in auth code | Timing-unsafe comparison |
| `SEC-004` | `/Math\.random\(\)/` in auth/crypto context | Weak randomness |

Each rule produces a `Finding` with specific file, line number, description, and suggestion.

**Duration target:** <2 seconds
**Cost:** $0

### Layer 2: AI Quick Scan

First AI layer. Uses Claude Haiku for fast, cheap analysis.

**Input:** diff + context.json + Layer 1 results
**Prompt structure:**
```
System: You are a code review triage agent. Classify risk and identify
top concerns. Be precise — false positives erode trust.

Context: {file classifications, line counts, L1 findings summary}

Task:
1. Risk classification: LOW/MEDIUM/HIGH/CRITICAL with reasoning
2. Circular test detection: analyze test file for tautological patterns
3. Up to 5 quick findings (beyond what L1 caught)

Output: structured JSON
```

**Gate logic:** If risk >= MEDIUM → proceed to Layer 3. If LOW → stop here.

For "The Perfect PR": always classifies CRITICAL (auth code, SQL injection in L1, circular tests detected).

**Duration target:** <30 seconds
**Cost:** ~$0.02

### Layer 3: AI Deep Review

Full analysis with Claude Sonnet. Runs 3 parallel lenses.

#### Security Lens
```
System: You are a security-focused code reviewer. Analyze for OWASP Top 10,
auth vulnerabilities, and crypto weaknesses. Only report findings with
confidence > 0.7.

Context: {full file contents, L1+L2 findings, file classifications}

Focus areas for auth code: password storage, token generation,
input validation, error information leakage, rate limiting,
JWT configuration.
```

Expected findings: bcrypt cost factor, alg-none attack, input validation, DoS via long password.

#### Architecture Lens
```
System: You are an architecture reviewer. Analyze separation of concerns,
testability, and coupling.

Context: {full file contents, file dependency map}
```

Expected findings: auth logic coupled to HTTP handler, model returns sensitive data unnecessarily.

#### Test Quality Lens
```
System: You are a test quality expert. Analyze test effectiveness,
not just coverage. Look for: circular tests, mock-heavy tests that
test nothing, missing edge cases, assertion quality.

Context: {test files, source files they test, L2 circular test flag}
```

Expected findings: mock-on-mock testing, spy-only assertions, no negative cases, circular SQL test.

**Duration target:** <90 seconds (3 lenses in parallel)
**Cost:** ~$0.40

---

## 5. CLI Interface

### Commands

```bash
# Full demo — creates PR, runs pipeline, posts comments
npm run demo

# With live AI (requires ANTHROPIC_API_KEY)
npm run demo -- --live

# Skip GitHub PR creation (terminal output only)
npm run demo -- --local

# Cleanup after demo
npm run demo -- --cleanup

# List available scenarios
npm run demo -- --list
```

### Terminal Output

The CLI renders a progressive, layer-by-layer output:

```
┌─────────────────────────────────────────────────────┐
│  VCR Demo — "The Perfect PR"                        │
│  Scenario: User Authentication Service              │
└─────────────────────────────────────────────────────┘

→ Creating PR... ✓ #42 https://github.com/virtuslab/visdom-code-review/pull/42

▸ Layer 0 — Context Collection                    0.3s
  6 files │ 247 lines │ 2 critical │ 1 test │ 1 config

▸ Layer 1 — Deterministic Gate                    1.1s
  ⚠ CRITICAL  SEC-001  .env.test:1         Hardcoded JWT secret
  ⚠ HIGH      SEC-002  auth.model.ts:15    SQL string interpolation
  ⚠ HIGH      SEC-003  auth.controller.ts:28  Timing-unsafe token comparison
  ⚠ MEDIUM    SEC-004  auth.service.ts:31  Math.random() for token generation

▸ Layer 2 — AI Quick Scan (Haiku)                12.4s  $0.02
  Risk: CRITICAL │ Gate: → Layer 3 triggered
  ⚠ HIGH      TEST-001  auth.test.ts       8/12 tests are circular (mock-on-mock)
  ⚠ HIGH      AUTH-001  auth.controller.ts  No rate limiting on login endpoint
  ⚠ MEDIUM    AUTH-002  auth.controller.ts  User enumeration via error messages

▸ Layer 3 — AI Deep Review (Sonnet)              47.2s  $0.41
  Running 3 lenses in parallel...
  ┌ Security
  │ ⚠ CRITICAL  SEC-005  auth.service.ts:12   bcrypt cost=4 (brute-forceable)
  │ ⚠ HIGH      SEC-006  auth.middleware.ts:8  JWT alg:none not blocked
  ├ Architecture
  │ ⚠ MEDIUM    ARCH-001 auth.controller.ts    Auth logic coupled to HTTP handler
  │ ⚠ LOW       ARCH-002 auth.model.ts:22      Model returns password hash to caller
  ├ Test Quality
  │ ⚠ HIGH      TEST-002 auth.test.ts:45       Tests assert spy calls, not values
  │ ⚠ LOW       TEST-003 auth.test.ts          Zero negative/edge case tests
  └

════════════════════════════════════════════════════════
  RESULTS — Side by Side
════════════════════════════════════════════════════════

  Traditional Review          │  VCR Review
  ────────────────────────────│─────────────────────────
  CI status: ✅ all green     │  CI: ✅ but 8/12 tests circular
  Coverage: 94%               │  Effective coverage: ~31%
  Findings: 0                 │  Findings: 13
    critical: 0               │    critical: 2
    high: 0                   │    high: 5
    medium: 0                 │    medium: 4
    low: 0                    │    low: 2
  Wait time: 24-48h           │  Time: 1m 01s
  Human cost: ~1h senior eng  │  Human cost: $0 (review only)
  AI cost: $0                 │  AI cost: $0.43
  Risk: auth bypass ships     │  Risk: caught before merge

→ Findings posted to PR #42
  https://github.com/virtuslab/visdom-code-review/pull/42

→ Run `npm run demo -- --cleanup` to close PR and delete branch
```

---

## 6. Technology Stack

| Component | Technology | Why |
|-----------|------------|-----|
| Runtime | Node.js 20+ | Matches existing Astro project |
| Language | TypeScript 5+ | Type safety, consistency with project |
| CLI framework | None (minimal `process.argv` parsing) | Zero deps for ~5 flags |
| Claude API | `@anthropic-ai/sdk` | Official SDK |
| GitHub API | `@octokit/rest` | Standard GitHub SDK |
| Terminal output | `chalk` + manual formatting | Simple, no heavy TUI framework |
| Build | `tsx` for dev, `tsup` for build | Fast execution, simple bundling |

### Dependencies (minimal)

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@octokit/rest": "^21.0.0",
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "tsup": "^8.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

## 7. Configuration

The demo uses environment variables (no config file needed for demo):

```bash
# Required for --live mode
ANTHROPIC_API_KEY=sk-ant-...

# Required for PR creation (auto-detected from gh CLI if available)
GITHUB_TOKEN=ghp_...

# Optional
VCR_DEMO_REPO=virtuslab/visdom-code-review  # defaults to current repo
VCR_DEMO_BRANCH_PREFIX=demo/                 # defaults to "demo/"
```

---

## 8. Scenario Extensibility

New scenarios follow a simple contract:

```typescript
// scenarios/perfect-pr/scenario.ts
export const scenario: ScenarioConfig = {
  name: 'perfect-pr',
  title: 'The Perfect PR',
  description: 'A seemingly flawless auth service with layered vulnerabilities',
  branch: 'demo/perfect-pr',
  prTitle: 'feat: add user authentication service',
  prBody: '## Summary\n\nAdds login/register endpoints with JWT auth...',
  files: {
    'src/auth/auth.controller.ts': './files/src/auth/auth.controller.ts',
    // ... file mappings
  },
  // Layer 1 rules specific to this scenario (optional, extends defaults)
  deterministicRules: [],
};
```

Adding a new scenario = new directory under `scenarios/` with a `scenario.ts` and `files/`. The pipeline, reporters, and GitHub operations are scenario-agnostic.

---

## 9. What This Demo Is NOT

- **Not production VCR** — Layer 1 uses regex, not semgrep/gitleaks. Layer 3 prompts are demo-focused, not the full lens library.
- **Not a general review tool** — It reviews prepared scenarios, not arbitrary PRs. The architecture supports arbitrary PRs, but prompt quality for unknown code is out of scope.
- **Not a GitHub Action** — The core is structured to become one, but the Action YAML/workflow is not part of this spec.
- **Not a testing framework** — TORS scoring is simulated via L2 circular test detection, not a real statistical framework.

---

## 10. Success Criteria

1. `npm run demo` completes in under 3 minutes (with cache) or under 5 minutes (live)
2. Creates a real PR on GitHub with VCR findings as comments
3. Terminal output shows clear side-by-side contrast
4. Running without `ANTHROPIC_API_KEY` works (uses cached responses)
5. Core modules are importable: `import { ReviewPipeline } from './core/pipeline'`
6. Adding a new scenario requires only new files under `scenarios/`, no changes to core
