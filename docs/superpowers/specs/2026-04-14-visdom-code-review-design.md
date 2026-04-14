# VISDOM Code Review (VCR) — Design Specification

**Version:** 1.0 Draft
**Date:** 2026-04-14
**Author:** Artur Skowroński / VirtusLab VISDOM team
**Status:** Draft — awaiting review

---

## 1. Overview

### What is VCR?

VISDOM Code Review (VCR) is a **multi-layered, AI-driven code review framework** for enterprise teams. It provides structured, automated review of pull requests — from deterministic static analysis through AI-powered deep review — and proactive repository-wide quality scanning.

VCR is part of the VISDOM Agent-Ready SDLC offering, sitting within the **Automated Risk Assessment** pillar alongside Context Fabric and Machine-Speed CI.

### Core Problem

Enterprise teams want to deploy AI-generated code but lack a safety net. The specific pain points:

1. **Senior bottleneck** — seniors spend 30-50% of time reviewing junior/mid code, no time for own work
2. **Inconsistent quality** — distributed teams (PL/UK/IN) apply different review standards
3. **Slow feedback loop** — PRs wait 24-48h for review due to timezone gaps
4. **AI-code trust gap** — teams are afraid to ship AI-generated code because existing CI is a "lying oracle" (see: [The Agent-Ready SDLC, Post #3](https://virtuslab.com/blog/ai/the-fallacy))

### The Lying Oracle Problem

As described in the VISDOM Agent-Ready SDLC series: CI pipelines treat test results as ground truth, but flaky tests lie intermittently (Google: 84% of pass-to-fail transitions are flaky) and AI-generated tests lie systematically (Circular Test Trap — tests verify what code *does*, not what it *should do*). VCR addresses both failure modes.

### Design Philosophy

- **Process-first, tool-agnostic** — VCR defines the review process (steps, inputs, outputs, quality gates). Reference implementations are provided for specific platforms, but the process is portable.
- **Layered depth** — review depth scales with risk. Low-risk PRs get fast, cheap feedback. High-risk PRs get thorough, expensive analysis.
- **Opinionated defaults, full flexibility** — ships with "VISDOM Standard" review categories. Clients can add, remove, or replace categories.
- **Deterministic backstop** — Layer 1 (static analysis) cannot be fooled by prompt injection, hallucination, or non-determinism. It is the floor.

### Deliverable Model

- **Framework** — process definition, configuration schema, prompt templates, reference implementation
- **Pilot deployment** — working pipeline on 1-2 client teams, configured for their stack
- **Knowledge transfer** — client team owns and operates VCR after engagement
- **Reference platform:** GitHub + GitHub Actions (first). Other platforms follow the same process with different integration adapters.

---

## 2. Architecture — Layered Review Agent

### Mental Model

Every PR passes through layers of increasing depth and cost. Each layer produces structured output consumed by subsequent layers and the final report. A risk classifier at Layer 2 gates whether the expensive Layer 3 runs.

Separately, a Proactive Scanner runs on cron, analyzing the repository independent of PR flow.

### Layer Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    PR Opened / Updated                    │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────┐
│  LAYER 0: Context Collection                  (<10s)     │
│  Deterministic. Collects diff, metadata, repo context.   │
│  Requires: pre-indexed repository knowledge layer.       │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────┐
│  LAYER 1: Deterministic Gate                  (<60s)     │
│  Zero AI. Linters, SAST, secret scan, coverage delta.    │
│  100% repeatable. Cannot be prompt-injected.             │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────┐
│  LAYER 2: AI Quick Scan + Risk Classifier    (<2 min)    │
│  Fast AI pass over diff. Classifies risk: LOW→CRITICAL.  │
│  Quick findings (max 5). AI-code detection.              │
└──────────────┬───────────────────────────────────────────┘
               ▼ (MEDIUM+ risk only)
┌──────────────────────────────────────────────────────────┐
│  LAYER 3: AI Deep Review                     (<10 min)   │
│  Full analysis with repo context, history, conventions.  │
│  Multiple Review Lenses run in parallel.                 │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────┐
│  REPORTER: Aggregation + PR Comment                      │
│  Structured summary, inline comments, reviewer guidance. │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Layer 0 — Context Collection

Fully deterministic. Zero AI. Collects everything subsequent layers need.

### Required Data

| Source | What we collect | Format |
|--------|----------------|--------|
| Git diff | Changed files, added/removed lines, hunks | Unified diff |
| PR metadata | Title, description, author, labels, linked issues, draft status | JSON |
| Test coverage | Coverage of affected files, delta vs base branch | JSON report |
| File classification | Type per file: critical/sensitive/standard/low_risk (from config) | Tags |
| Repo conventions | Linter configs, `CODEOWNERS`, architecture docs, convention files | Raw |
| Repository knowledge layer | Code ownership, dependency graph, PR history, commit heatmap, expertise scores | Structured query results |
| Test reliability data | Known flaky tests, per-test pass/fail history | JSON (TORS input) |

### Repository Knowledge Layer

Layer 0 requires access to a **pre-indexed repository knowledge layer** — a deterministic data source that provides code ownership, dependency graphs, commit analytics, and PR history without re-parsing the repository on every run.

This layer must be:
- **Deterministic** — same commit = same data
- **Pre-indexed** — queries complete in seconds, not minutes
- **Reusable** — shared across agents and review runs, not rebuilt per session

> **Reference implementation:** [ViDIA](https://github.com/virtuslab/vidia) (VirtusLab, MIT license) — DuckDB analytics over git history, dependency graphs, and PR discussions, served as MCP tools or CLI. Pinned by SHA256, reusable across sessions.
>
> **Alternative implementations:** Any system that exposes the required data (ownership, dependencies, history, expertise) via API or CLI. Examples: GitHub CODEOWNERS + custom scripts, Sourcegraph code intelligence, custom DuckDB/SQLite indexes over git log.

### Test Reliability Data (TORS Input)

Layer 0 also collects **test reliability history** — per-test pass/fail data used to compute the Test Oracle Reliability Score (TORS). This data feeds into Layer 1 and Layer 2 to filter flaky test signals from agent feedback.

Sources: CI historical data, test result databases, flaky test tracking tools.

### Path Classification (client-configured)

```yaml
path_classifications:
  critical:
    - "src/auth/**"
    - "src/payments/**"
    - "infra/**"
    - "*.tf"
  sensitive:
    - "src/api/**"
    - "src/middleware/**"
  standard:
    - "src/**"
  low_risk:
    - "docs/**"
    - "*.md"
    - "test/**"
```

### Output: `review-context.json`

Structured document consumed by all subsequent layers. Single source of truth for the review.

---

## 4. Layer 1 — Deterministic Gate

Zero AI. Existing tooling. 100% repeatable. **Cannot be prompt-injected.**

### Default Checks (VISDOM Standard)

| Check | Reference tooling | Block PR? |
|-------|-------------------|-----------|
| Linting | ESLint / Checkstyle / Pylint (per stack) | Configurable |
| Formatting | Prettier / google-java-format | Configurable |
| Secret detection | gitleaks / truffleHog | **Always block** |
| SAST (static security) | Semgrep / CodeQL | Configurable per severity |
| Test coverage delta | Coverage tool + custom threshold | Configurable |
| Build passes | Existing CI | **Always block** |
| Dependency audit | `npm audit` / Dependabot / Snyk | Configurable per severity |

### TORS Filtering

Layer 1 consults the Test Oracle Reliability Score for the current test suite. Tests with reliability below a configurable threshold (default: 0.5) are **excluded from the signal** sent to subsequent layers and to agents.

This prevents the Lying Oracle problem: agents do not "fix" flaky tests, and Layer 2/3 do not reason over false failures.

```
TORS = (real failures) / (total failures)

If TORS < threshold → test excluded from feedback signal
Agent receives: "14/14 reliable tests: ✅. 1 flaky test excluded."
```

### Output: `layer1-results.json`

```json
{
  "passed": false,
  "blocking_findings": [...],
  "non_blocking_findings": [...],
  "coverage_delta": -2.3,
  "new_dependencies": ["lodash@4.17.21"],
  "tors": {
    "overall": 0.94,
    "excluded_flaky_tests": ["test_user_search_pagination"],
    "reliable_tests_passed": 14,
    "reliable_tests_total": 14
  }
}
```

### Key Principle

Layer 1 does **not** stop the review pipeline (unless a blocking finding). Results flow as additional context to Layer 2 and 3 — AI knows what linters already caught and does not repeat.

---

## 5. Layer 2 — AI Quick Scan + Risk Classifier

First AI contact with the code. Two goals: (1) fast feedback on obvious problems, (2) risk classification of the PR.

### Input

- `review-context.json` from Layer 0
- `layer1-results.json` from Layer 1
- Diff only (not full files) + ~50 lines surrounding context per hunk

### Prompt Structure

```
You are a code reviewer. Review this diff.

## Context
- PR: {title}, author: {author}
- Affected paths: {paths} (classification: {critical/sensitive/standard})
- Layer 1 findings: {summary}
- Repository knowledge: {ownership, recent changes, module stability}

## Tasks
1. RISK CLASSIFICATION: Assess PR risk (LOW/MEDIUM/HIGH/CRITICAL)
   Signals: size, affected paths, complexity, test coverage delta, module stability
2. QUICK FINDINGS: Report obvious problems (max 5):
   - Obvious bugs, missing error handling
   - Missing tests for new code paths
   - Copy-paste / dead code
   - DO NOT comment on: naming style, missing docs, import order, formatting
     (these are handled by Layer 1 linters)
3. AI-CODE DETECTION: Does this code appear AI-generated?
   Signals: over-engineering, unnecessary abstractions, generic variable names
4. CIRCULAR TEST DETECTION: Do new tests mirror implementation logic
   rather than testing against a specification?

## Output format
Respond with JSON matching the Layer 2 output schema:
- risk_classification: LOW | MEDIUM | HIGH | CRITICAL
- risk_signals: array of { signal, value, weight }
- findings: array of { severity, file, line, category, description, suggestion, confidence }
- ai_generated: { detected: bool, confidence: float, signals: array }
- circular_tests: array of { test_file, test_name, reason }
```

### Risk Classification Logic

Risk classification is **primarily deterministic**, with AI judgment as one input among several:

| Signal | Source | Weight |
|--------|--------|--------|
| Path classification | Config (deterministic) | High |
| Diff size | Git (deterministic) | Medium |
| Coverage delta | CI (deterministic) | Medium |
| Module stability | Repository knowledge layer (deterministic) | Medium |
| AI-generated flag | Layer 2 AI detection | Medium |
| AI complexity assessment | Layer 2 AI judgment | Low |

```
CRITICAL: critical path + large diff + coverage drop
HIGH:     critical path OR (large diff + sensitive path)
MEDIUM:   sensitive path OR AI-generated flag OR coverage drop >5%
LOW:      small diff + standard/low_risk paths + coverage stable
```

### Gate Decision

| Risk | Layer 3? | Estimated cost |
|------|----------|----------------|
| LOW | Skip | ~$0.01-0.05 per PR |
| MEDIUM | Yes, standard depth | ~$0.10-0.50 per PR |
| HIGH | Yes, full depth + extra lenses | ~$0.50-2.00 per PR |
| CRITICAL | Yes, full depth + mandatory senior review flag | ~$0.50-2.00 per PR |

Client can override: "always run Layer 3 on all PRs" or "skip Layer 3 for docs/**".

---

## 6. Layer 2 — Risk Analysis: What Can Go Wrong

Layer 2 is the hinge of the system — it determines cost, depth, and trust. These risks have been researched and mitigated in the design.

### Risk 1: Non-determinism

**Problem:** LLMs produce different outputs for identical inputs, even at temperature=0. Same PR reviewed twice may get different risk scores.

**Evidence:** Research measuring consistency across 5 identical runs found Claude Sonnet at 0.85 correlation, GPT-4o at 0.79. Subjective assessments (e.g., "maintainability") dropped to 0.53 correlation. ([Measuring Determinism in LLMs for Code Review, arxiv 2502.20747](https://arxiv.org/html/2502.20747v1))

**Mitigation:** Risk classification uses deterministic signals as primary inputs (path classification, diff size, coverage delta). AI judgment is one signal among several, not the sole decider. For borderline cases near risk thresholds, optional consensus (2-3 runs, majority vote).

### Risk 2: "Cry Wolf" Effect — Developer Alert Fatigue

**Problem:** Too many comments → developers auto-dismiss everything, including real findings.

**Evidence:** CodeRabbit produces 8-20 comments per PR. After ~10 days, teammates auto-dismissed all of them. GitHub Copilot intentionally limits to 2-5 comments with 71% actionable rate and stays silent in 29% of cases. Industry rule: <30-40% action rate = noise. ([AI Code Review Journey — Elio Struyf](https://www.eliostruyf.com/ai-code-review-journey-copilot-coderabbit-macroscope/))

**Mitigation:**
- Hard cap: Layer 2 max **5 findings**, prioritized by severity
- Confidence threshold: do not report findings below 0.8 confidence
- Silence is OK: if nothing important → `✅ VCR: No issues found (risk: LOW)`
- Precision over recall: better to miss a LOW finding than report a false positive

### Risk 3: Large Diff Degradation

**Problem:** AI accuracy degrades on large PRs (>500 changed lines). "Lost in the middle" phenomenon — content at the beginning and end of context gets 85-95% accuracy, middle drops to 76-82%.

**Evidence:** Models with claimed 200K token context become unreliable around 130K tokens, with sudden performance drops. ([Graphite: How much context do AI code reviews need?](https://graphite.com/guides/ai-code-review-context-full-repo-vs-diff))

**Mitigation:**
- Chunk strategy: for PRs >500 lines, Layer 2 analyzes per-file, aggregates at the end
- Repository knowledge layer provides targeted context (relevant files only, not everything)
- PR size warning: PRs >1000 lines get automatic recommendation to split
- Layer 3 uses selective context informed by dependency graph, not "entire module"

### Risk 4: Prompt Injection via PR Content

**Problem:** Malicious or "creative" code comments, PR descriptions, or commit messages can contain instructions that manipulate the AI reviewer.

**Evidence:** Anthropic's own [Claude Code Security Review action](https://github.com/anthropics/claude-code-security-review) warns it is "not hardened against prompt injection." OWASP ranks prompt injection as #1 risk for LLMs. Every file, comment, and PR description is a potential injection surface.

**Mitigation:**
- Input sanitization: strip suspicious instruction patterns before passing to AI
- Segregated prompts: system prompt with hard rules ("NEVER skip security analysis") separated from user content
- Canary checks: include known-bad patterns in test — if AI misses them, injection likely occurred
- **Layer 1 as backstop:** deterministic SAST/secret scan is immune to prompt injection. Even if Layer 2 AI is manipulated, Layer 1 still blocks.

### Risk 5: Cost Explosion at Scale

**Problem:** Enterprise with 200 developers × 1-2 PRs/day = 200-400 PRs/day. Deep review at $0.50-2.00/PR scales to $2,000-16,000/month.

**Evidence:** Claude Code Review averages $15-25 per PR (full agentic review). At 100 PRs/day, monthly cost reaches $45,000-75,000. ([The $25 Code Review Tax — Epsilla](https://www.epsilla.com/blogs/2026-03-10-claude-code-review-tax))

**Mitigation:**
- Layered cost model is the answer: Layer 2 (small/fast model) at $0.01-0.05. Layer 3 (capable model) only for MEDIUM+ risk
- Budget caps in configuration: `max_daily_layer3_budget: $50`
- Model tiering: fast model for Layer 2, capable model for Layer 3 standard, most capable for CRITICAL
- Prompt caching reduces cost of repeated context
- Track cost-per-useful-finding, not cost-per-PR

### Risk 6: Generic / Surface-Level Feedback

**Problem:** Without repo context, AI falls back to generic "code reviewer" mode — comments on naming, suggests docstrings, flags missing type hints. Nothing a senior wouldn't see in 5 seconds.

**Evidence:** Augment Code found early versions using "pattern-based grep-search" for context produced generic findings. Quality improved only after semantic retrieval + organizational context. ([How we built a high-quality AI code review agent — Augment Code](https://www.augmentcode.com/blog/how-we-built-high-quality-ai-code-review-agent))

**Mitigation:**
- Repository knowledge layer provides repo-specific conventions, patterns, ownership
- Anti-patterns in prompts: "DO NOT comment on naming style, missing docs, import order, formatting"
- Conventions file (`.vcr/conventions.md`) — client defines "in our repo we do X, not Y"
- Minimum severity in Layer 2: Quick Scan does not report below MEDIUM

### Risk 7: AI Reviewing AI — Blind Spots

**Problem:** AI-generated code has patterns that another AI model may not catch because it produces similar patterns itself. Over-engineering, unnecessary abstractions, hallucinated APIs look "clean" to an AI reviewer.

**Evidence:** Veracode 2025 tested 100+ LLMs: 45% of AI-generated code contains OWASP vulnerabilities. Models' own tests caught none of them. Spotify's LLM-as-judge vetoes 25% of agent output — meaning 1 in 4 passes CI but is wrong. ([Spotify Honk post-mortem](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3))

**Mitigation:**
- Dedicated "AI-Code Safety" lens targeting specific AI patterns: hallucinated APIs, unnecessary abstractions, over-engineering, Factory/Builder where direct instantiation is convention
- Repository knowledge layer can compare new code complexity against module baseline
- Optional cross-model review: if code was generated by model A, review with model B

### Risk 8: Cross-Cultural Interpretation

**Problem:** "This code needs refactoring" lands differently for a senior in Kraków, a mid in London, and a junior in Bangalore. AI comments without cultural sensitivity can be demotivating or ignored.

**Evidence:** [Shopify: When Culture and Code Reviews Collide](https://shopify.engineering/code-reviews-communication) — feedback must be constructive, not evaluative.

**Mitigation:**
- Structured finding format: always Problem → Why it matters → Concrete fix suggestion
- Configurable tone: `tone: direct | constructive | educational`. Default: `constructive`
- No blame attribution: VCR says "this code has..." never "you wrote..."

### Risk Priority Matrix

| # | Risk | Severity | Likelihood | Primary mitigation |
|---|------|----------|------------|-------------------|
| 2 | Cry Wolf | CRITICAL | HIGH | Hard cap, confidence threshold, silence is OK |
| 6 | Generic feedback | HIGH | HIGH | Repo context, anti-patterns in prompts, min severity |
| 1 | Non-determinism | HIGH | HIGH | Deterministic signals primary in risk classifier |
| 7 | AI reviewing AI | HIGH | MEDIUM | Dedicated AI-Code Safety lens |
| 3 | Large diff degradation | HIGH | MEDIUM | Chunk per-file, selective context, PR size warning |
| 4 | Prompt injection | CRITICAL | LOW-MED | Input sanitization, Layer 1 backstop |
| 5 | Cost explosion | MEDIUM | MEDIUM | Layered cost model, budget caps |
| 8 | Cross-cultural | MEDIUM | MEDIUM | Structured format, configurable tone |

**Risks #2 and #6 are the most dangerous** — they lead to abandonment. If developers stop reading VCR comments, all other mitigations are irrelevant.

---

## 7. Layer 3 — AI Deep Review

Full analysis. Triggered only for MEDIUM+ risk. Expensive but high-value.

### Input

Everything from previous layers PLUS:
- **Full files** (not just diff) — AI sees the entire module
- **Related files** — files imported by changed files (from dependency graph)
- **Conventions doc** — extracted from repo conventions, architecture docs, ADRs
- **Historical context** — how this module evolved (from repository knowledge layer)

### Review Lenses (VISDOM Standard)

Each category is a **Review Lens** — a separate prompt with its own focus area and output schema. Lenses run in parallel.

| Lens | Focus | When active |
|------|-------|-------------|
| **Security** | Injection, auth bypass, data exposure, OWASP Top 10 | Always on MEDIUM+ |
| **Performance** | N+1 queries, unnecessary allocations, blocking calls, O(n^2) | MEDIUM+ with DB/API paths |
| **Architecture** | Consistency with repo patterns, separation of concerns, coupling | HIGH+ |
| **Test Quality** | New paths have tests, assertion quality, edge cases, **circular test detection** | Always on MEDIUM+ |
| **AI-Code Safety** | Over-engineering, hallucinated APIs, unnecessary abstractions, generic patterns | When AI-generated flag is set |
| **Conventions** | Naming, file structure, import patterns, error handling patterns | Always on MEDIUM+ |

### Circular Test Detection (from blog: The Circular Test Trap)

The Test Quality lens includes explicit detection of circular tests — tests derived from implementation rather than specification:

```
Examine new/modified tests. For each test, determine:
1. Does this test verify behavior described in a spec/issue/PR description?
   OR does it mirror the implementation logic?
2. Does this test cover negative paths, edge cases, invalid inputs?
   OR only the happy path that the implementation handles?
3. Would this test FAIL if the implementation had a subtle bug
   (off-by-one, missing null check, wrong status code)?
   OR would it pass because it tests the same logic?

Flag as CIRCULAR if the test would pass regardless of correctness.
```

### Custom Lenses

Clients add their own Review Lenses:

```yaml
custom_lenses:
  - name: "Banking Compliance"
    prompt_file: "lenses/banking-compliance.md"
    active_when: "paths match src/transactions/**"
  - name: "GDPR Data Handling"
    prompt_file: "lenses/gdpr.md"
    active_when: "paths match src/user/** OR src/analytics/**"
```

### Output per Lens

```json
{
  "lens": "security",
  "findings": [
    {
      "severity": "HIGH",
      "file": "src/api/auth.ts",
      "line": 42,
      "category": "SQL Injection",
      "description": "User input interpolated directly into query",
      "suggestion": "Use parameterized query: db.query('SELECT ...', [userId])",
      "confidence": 0.95
    }
  ]
}
```

---

## 8. Reporter — Aggregation and Output

### PR Comment Format

Reporter collects results from ALL layers into one structured comment:

```markdown
## 🔍 VISDOM Code Review — Risk: HIGH

### Summary
This PR modifies authentication middleware and adds a new API endpoint.
Layer 3 deep review was triggered (critical path + coverage drop).

### 🚨 Blocking (must fix)
| # | Severity | Category | File | Finding |
|---|----------|----------|------|---------|
| 1 | CRITICAL | Security | auth.ts:42 | SQL injection via unsanitized input |
| 2 | HIGH | Testing | - | No tests for new /api/reset endpoint |

### ⚠️ Recommendations (should fix)
| # | Severity | Category | File | Finding |
|---|----------|----------|------|---------|
| 3 | MEDIUM | Performance | users.ts:88 | N+1 query in loop |
| 4 | MEDIUM | Circular Test | auth.test.ts | Tests mirror implementation, don't verify spec |

### 💡 Suggestions (nice to have)
- Consider extracting validation logic to shared utility (auth.ts:30-45)

### 📊 Stats
- Files reviewed: 8 | Lines changed: +142 / -38
- Coverage delta: -2.3% (67.2% → 64.9%)
- Layers: L1 ✅ → L2 (HIGH) → L3 (Security, Performance, Testing, Architecture)
- AI-generated code detected: Yes (confidence: 0.82)
- TORS: 94% (2 flaky tests excluded from signal)

### 🧑‍💻 Reviewer Guidance
Focus your review on: **auth.ts** (security findings) and **test coverage gap**.
Suggested reviewer: @senior-krakow (top expertise for this module).
```

### Inline Comments

In addition to the summary comment, VCR posts **inline comments** on specific PR lines — directly where the problem is. Each inline comment includes category, severity, and a concrete fix suggestion.

Hard cap: **max 15 inline comments** per PR (configurable). Prevents notification flood.

### Output Channels (configurable)

| Channel | When | Format |
|---------|------|--------|
| PR Comment | Always | Markdown summary |
| PR Inline Comments | Always | Per-finding inline |
| GitHub Check | Always | Pass/Fail status check |
| Slack notification | Configurable | Summary + PR link |
| Metrics export | Always | JSON for dashboard/tracking |

---

## 9. Proactive Scanner

Runs independently of PR flow. Cron-based repository analysis.

### Scan Modes

| Mode | Frequency | What it does |
|------|-----------|--------------|
| **Coverage Trends** | Daily | Tracks test coverage per module over time |
| **Tech Debt Scan** | Weekly | Large files, circular dependencies, dead code, growing complexity |
| **Convention Drift** | Weekly | Does new code diverge from established patterns? Cross-team comparison |
| **Security Baseline** | Daily | Full SAST scan, dependency vulnerabilities |
| **AI-Code Audit** | Weekly | Which modules have high AI-generated code density, what's the quality |

### Convention Drift Detection

Particularly valuable for mixed teams across geographies:

```
Repository knowledge layer data:
  Module: user-service
  Team A commits: 89% direct service calls
  Team B commits: 73% repository pattern

DRIFT DETECTED:
"user-service has diverging patterns between contributors.
 Drift rate: 14% → 31% over 2 weeks."

ITS correlation: ITS for user-service trending up (4 → 7)
→ agents need more iterations = code getting harder to reason about
```

### Output

- **Report** — Markdown/HTML with trends
- **GitHub Issues** — auto-created for critical findings
- **Metrics** — JSON for dashboard integration

---

## 10. Configuration

### Repository Structure

```
.vcr/
├── vcr-config.yaml          # Main configuration
├── conventions.md            # Repo conventions (AI reads this)
├── lenses/                   # Review lenses (prompts)
│   ├── security.md
│   ├── performance.md
│   ├── architecture.md
│   ├── test-quality.md
│   ├── ai-code-safety.md
│   ├── conventions.md
│   └── custom/              # Client adds their own
│       └── banking-compliance.md
├── rules/                    # Deterministic rules (Layer 1)
│   ├── semgrep-custom.yaml
│   └── eslint-overrides.json
└── templates/                # Output templates
    ├── pr-comment.md
    └── proactive-report.md
```

### `vcr-config.yaml`

```yaml
version: "1.0"

# AI provider
ai:
  provider: "anthropic"           # anthropic | openai | azure-openai
  layer2_model: "claude-haiku-4-5"
  layer3_model: "claude-sonnet-4-6"
  layer3_critical_model: "claude-opus-4-6"  # Optional: most capable for CRITICAL

# Repository knowledge layer
context:
  # Any system providing ownership, dependencies, history, expertise
  # VCR queries this via CLI or MCP protocol
  provider: "vidia"               # vidia | custom | github-native
  queries:
    ownership: true
    dependencies: true
    pr_history: true
    expertise: true
    commit_heatmap: true

# Path classification
path_classifications:
  critical: ["src/auth/**", "src/payments/**", "infra/**", "*.tf"]
  sensitive: ["src/api/**", "src/middleware/**"]
  standard: ["src/**"]
  low_risk: ["docs/**", "*.md", "test/**"]

# Layer 1
layer1:
  secret_scan: true
  sast: true
  coverage_threshold: -5          # Max allowed coverage drop %
  blocking_severity: "HIGH"
  tors:
    enabled: true
    flaky_threshold: 0.5          # Tests below this reliability are excluded

# Layer 2
layer2:
  always_run: true
  max_findings: 5
  min_confidence: 0.8
  risk_overrides:
    always_high: ["src/auth/**"]
    always_skip_layer3: ["docs/**"]

# Layer 3
layer3:
  enabled_lenses: ["security", "performance", "test-quality", "conventions"]
  extra_lenses_for_high: ["architecture"]
  extra_lenses_for_critical: ["architecture", "ai-code-safety"]
  custom_lenses: ["custom/banking-compliance"]
  chunk_threshold: 500            # Lines above which per-file chunking activates

# Reporter
reporter:
  pr_comment: true
  inline_comments: true
  max_inline_comments: 15
  github_check: true
  tone: "constructive"            # direct | constructive | educational
  slack_webhook: null

# Proactive Scanner
proactive:
  enabled: true
  schedule: "0 6 * * 1"          # Mondays 6 AM
  scans: ["coverage_trends", "tech_debt", "security_baseline", "convention_drift"]
  output: "github_issues"

# Budget
budget:
  max_daily_layer3_spend: 50      # USD
  track_cost_per_finding: true
```

### GitHub Actions Reference Implementation

```yaml
# .github/workflows/vcr-review.yaml
name: VISDOM Code Review
on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

jobs:
  vcr-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: virtuslab/vcr-action@v1
        with:
          config: .vcr/vcr-config.yaml
          ai_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

---

## 11. Metrics — Per Layer

Each layer has its own metrics, measured at its stage. Plus end-to-end metrics aligned with the VISDOM Agent-Ready SDLC metrics framework (ITS, CPI, TORS).

### Layer 0 — Context Collection

| Metric | Target | Measured when |
|--------|--------|---------------|
| Context build time | <10s | After Layer 0 completes |
| Knowledge layer cache hit rate | >90% | On each query |
| Context completeness | 100% required fields | Validation of `review-context.json` |

### Layer 1 — Deterministic Gate

| Metric | Target | Measured when |
|--------|--------|---------------|
| Gate execution time | <60s | After Layer 1 completes |
| Secret detection recall | 100% (zero false negatives) | Quarterly audit with known secrets |
| SAST findings per PR | Trending down | After each PR |
| Blocking rate | <10% PRs blocked | After each PR |
| TORS | >85% | Computed from test reliability data |

### Layer 2 — AI Quick Scan

| Metric | Target | Measured when |
|--------|--------|---------------|
| Scan time | <2 min | After Layer 2 completes |
| Risk classification accuracy | >85% agreement with human | Comparison: VCR risk vs reviewer judgment |
| Quick findings acceptance rate | >60% | Developer reaction on findings (👍/👎) |
| Layer 3 trigger rate | 30-50% of PRs | After classification. Too low = miss risk. Too high = waste |
| Token cost per scan | <$0.05 avg | Per invocation |
| AI-code detection precision | >80% | Comparison with known AI-generated PRs |

### Layer 3 — AI Deep Review

| Metric | Target | Measured when |
|--------|--------|---------------|
| Deep review time | <10 min | After Layer 3 completes |
| Finding severity distribution | More HIGH/CRITICAL than LOW | If L3 produces mainly LOW findings, risk classifier is too aggressive |
| False positive rate | <15% | Developer reaction 👎 per finding |
| Actionable finding rate | >80% | Finding has concrete fix suggestion |
| Token cost per review | <$2.00 avg | Per invocation |
| Circular test detection rate | Tracked, no target | Per PR with new/modified tests |

### Reporter

| Metric | Target | Measured when |
|--------|--------|---------------|
| Time to first comment | <5 min (L2 only), <15 min (L2+L3) | Timestamp PR open → first VCR comment |
| Comment engagement rate | >50% PRs have reaction | 24h after comment |
| Reviewer guidance accuracy | >70% | Human reviewer confirms focus areas matched |
| Suggested reviewer acceptance | >60% | Was the expertise-based suggestion used? |

### Proactive Scanner

| Metric | Target | Measured when |
|--------|--------|---------------|
| Scan completion rate | 100% scheduled scans | After each cron run |
| Trend detection lead time | >2 weeks before problem | Comparison: when scanner flagged vs when it became incident |
| Created issues resolution rate | >50% within 30 days | Tracking auto-created issues |
| Convention drift detection | Drift flagged within 2 weeks | Cross-team pattern comparison |

### End-to-End — VISDOM SDLC Metrics Integration

These metrics connect VCR to the broader VISDOM Agent-Ready SDLC framework described in the blog series:

| Metric | Definition | Target | Connection to VISDOM SDLC |
|--------|-----------|--------|---------------------------|
| **ITS (Iterations-to-Success)** | Iterations from task assignment to passing CI | 1-3 healthy, 5-10 warning, 20+ structural failure | VCR reduces ITS by filtering flaky tests (TORS) and providing early feedback before agent iterates |
| **CPI (Cost-per-Iteration)** | Tokens + compute + CI + review per iteration | Trending down | VCR reduces review component of CPI; TORS reduces wasted iterations |
| **TORS (Test Oracle Reliability Score)** | % of test failures that are real regressions | >85% | Directly measured by Layer 1; feeds into Layer 2 risk classification |
| **Escaped defects** | Bugs in production in areas covered by VCR | Trending down | Primary outcome metric |
| **4x Hidden Tax visibility** | License + compute + tokens + review breakdown | Fully tracked | VCR dashboard provides real-time cost breakdown |
| **Senior review time** | Time seniors spend on code review | -30% vs baseline | VCR pre-annotates PRs, focuses reviewer attention |

### Feedback Mechanism

Each finding has developer reactions:
- `👍` — finding was helpful, fixed it
- `👎` — false positive / not relevant
- `🤔` — not sure, needs discussion

These reactions feed per-layer metrics. During pilot, VirtusLab analyzes manually. In mature deployment, they inform prompt tuning and risk classifier calibration.

---

## 12. Before / After Scenarios

### Scenario 1: AI-Generated Code with Security Vulnerability

**BEFORE (no VCR):**
1. Developer uses Copilot to generate auth code
2. Copilot generates matching tests (Circular Test Trap — tests verify implementation, not spec)
3. CI passes (tests are green, but they test "does code do what code does")
4. Human reviewer waits 24-48h (timezone gap PL→IN)
5. Senior approves — "looks clean, tests pass"
6. SQL injection ships to production
7. Incident after 3 weeks. Rollback. Postmortem.

**Cost:** 0 automated review time, 24-48h to human review, incident cost $50-200K, team loses trust in AI-generated code.

**AFTER (with VCR):**
1. Developer pushes same PR
2. Layer 0 (<10s): repository knowledge shows auth module is hot path with 3 recent reverts
3. Layer 1 (<60s): Semgrep catches SQL injection pattern. Secret scan clean. TORS excludes 2 known flaky tests
4. Layer 2 (<2 min): Risk=CRITICAL (critical path + AI-generated + coverage drop). Circular test detected
5. Layer 3 (<10 min): Security lens confirms injection + finds missing token expiry check. AI-Code Safety lens flags hallucinated API and unnecessary Factory pattern. Test Quality lens explains why tests are circular
6. Reporter: structured comment with 2 blocking findings, reviewer guidance, suggested expert reviewer
7. Senior reviews within 1h (pre-annotated, knows exactly where to look)
8. Request Changes → developer fixes → VCR re-runs (<10 min) → merge

**Cost:** <10 min automated review, <1h to human review, $0.50-2.00 VCR cost, $0 incident cost.

### Scenario 2: Agent Loop on Flaky Tests (The Lying Oracle)

**BEFORE:**
1. Agent gets task → writes fix → pushes → CI (15 min)
2. CI fails on flaky test. Agent doesn't know it's flaky → "fixes" non-existent problem
3. 12-47 iterations over 11+ hours. Context grows. Each iteration more expensive
4. Agent "succeeds" when flaky test happens to pass. Submits PR with +847 lines of unnecessary changes
5. Senior spends 4h trying to understand what happened. Rejects

**Cost:** 47 iterations × 15 min = 11.75h wall time, $23+ tokens/compute, 4h senior review wasted. Net value: zero.

**AFTER:**
1. Agent pushes fix → Machine-Speed CI (<30s)
2. VCR Layer 1: TORS filters flaky test from feedback signal. Agent sees: "14/14 reliable tests: pass. 1 flaky test excluded — do not fix"
3. Agent: "All reliable tests pass. Done." — 3 iterations, 1.5 min
4. Layer 2: Risk=LOW, small diff, tests pass. No Layer 3 needed
5. Human review: 10 min, clean diff

**Cost:** 3 iterations × 30s = 1.5 min wall time, $0.90, 10 min review.

### Scenario 3: Convention Drift in Mixed Teams

**BEFORE:**
- Month 1-6: PL team uses direct service calls, IN team uses repository pattern. Nobody notices — each team reviews their own code. CI passes (patterns aren't enforced)
- Month 7: "Why does integrating these modules take 3 sprints?" — 6 months of convention drift. 40-80 person-days to fix

**AFTER:**
- Week 2: VCR Proactive Scanner detects pattern divergence via repository knowledge layer
- Auto-created issue: "Convention drift in user-service — drift rate 14%→31% over 2 weeks"
- ITS correlation: ITS trending up for the module (code getting harder for agents to reason about)
- Tech lead addresses in Week 3: 2-3 person-days vs 40-80 later

### Scenario 4: Budget Visibility (The 4x Hidden Tax)

**BEFORE:**
- CFO asks "How much does AI cost?" → "50 Copilot licenses × $19 = $950/month"
- Reality: $950 license + $4,200 compute + $3,800 tokens + $8,500 review overhead = $17,450/month (18x budget)

**AFTER:**
- VCR dashboard shows real-time breakdown of all 4 cost categories
- Layered model reduces compute (caching) and tokens (TORS filtering, targeted context)
- Pre-annotated PRs reduce senior review time by 30-50%
- CFO sees: $6,450/month total (63% reduction), with full audit trail

---

## 13. Reference Implementations

VCR is a process framework. The following are reference implementations provided by VirtusLab for pilot deployments. Clients may substitute with equivalent tooling.

| Component | Required capability | Reference implementation | Alternatives |
|-----------|---------------------|--------------------------|--------------|
| Repository knowledge layer | Pre-indexed ownership, dependencies, history, expertise | [ViDIA](https://github.com/virtuslab/vidia) (VirtusLab, MIT) | Sourcegraph code intelligence, custom DuckDB/SQLite over git log, GitHub CODEOWNERS + scripts |
| CI infrastructure | Sub-2-minute feedback loops for agent iteration | VISDOM Machine-Speed CI (remote caching, incremental builds, test impact analysis) | Bazel + EngFlow, Nx, Turborepo, Gradle remote cache |
| SAST | Static security analysis | Semgrep (open source) | CodeQL, SonarQube, Snyk Code |
| Secret scanning | Detect leaked credentials | gitleaks (open source) | truffleHog, GitHub secret scanning |
| AI provider | LLM API access | Anthropic (Claude Haiku/Sonnet/Opus) | OpenAI GPT-4o, Azure OpenAI, Google Gemini |
| CI/CD platform | Workflow execution | GitHub Actions | GitLab CI, Azure Pipelines, Jenkins |
| Code hosting | PR integration | GitHub | GitLab, Bitbucket, Azure DevOps |

---

## 14. Out of Scope (v1)

- **Auto-fix:** VCR v1 reports findings. It does not auto-fix code. (Planned for v2: agent applies suggested fixes, VCR re-reviews.)
- **Fine-tuning:** v1 uses off-the-shelf models with prompt engineering. Fine-tuning on client data is a v2 consideration.
- **Multi-repo:** v1 targets single-repo setup. Monorepo and multi-repo orchestration is v2.
- **GitLab/Azure DevOps:** v1 reference implementation is GitHub-only. Process is portable; adapters for other platforms follow.
- **Self-hosted LLM:** v1 uses cloud API providers. Self-hosted/air-gapped deployment is an enterprise v2 feature.

---

## 15. Open Questions

1. **AI-generated flag source:** How to reliably detect AI-generated code? PR labels? Git metadata? Heuristic detection? Need to define the primary signal.
2. **Feedback loop automation:** At what maturity level do developer reactions (👍/👎) automatically adjust prompts vs manual tuning by VirtusLab?
3. **TORS bootstrap:** New clients have no test reliability history. What's the cold-start strategy? Run 30 days of data collection before enabling TORS filtering?
4. **Reviewer assignment:** Should VCR assign reviewers based on expertise data, or only suggest? Organizational politics may make auto-assignment problematic.
5. **PR blocking policy:** Should VCR ever block a PR merge (via GitHub Check), or only advise? Who decides the policy — VCR config or org-level setting?
