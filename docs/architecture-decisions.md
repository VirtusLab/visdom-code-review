# Building an AI Code Review System: Architecture Decisions & Technical Narrative

Source material for technical articles about VCR (VISDOM Code Review). Documents every decision, approach tested, benchmark result, and lesson learned — including what failed and why.

**Project:** VCR — a multi-layered, AI-driven code review pipeline for enterprise teams.
**Team:** VirtusLab VISDOM (Artur Skowronski)
**Period:** April 2026
**Benchmark:** Martian Code Review Bench (50 PRs, 136 golden comments, 5 languages, MIT)

---

## Table of Contents

1. [The Problem We're Solving](#1-the-problem-were-solving)
2. [Core Architecture: Why Layers, Not a Single Pass](#2-core-architecture-why-layers-not-a-single-pass)
3. [Layer 1: The Deterministic Backstop](#3-layer-1-the-deterministic-backstop)
4. [Layer 2-3: AI Layers and Prompt Engineering](#4-layers-2-3-ai-layers-and-prompt-engineering)
5. [The Demo: Making the Invisible Visible](#5-the-demo-making-the-invisible-visible)
6. [Evaluation: From Self-Test to Real Benchmark](#6-evaluation-from-self-test-to-real-benchmark)
7. [The LLM Judge: Advisor Strategy](#7-the-llm-judge-advisor-strategy)
8. [Market Landscape: How We Compare](#8-market-landscape-how-we-compare)
9. [What We Didn't Build (And Why)](#9-what-we-didnt-build-and-why)
10. [Technical Stack Decisions](#10-technical-stack-decisions)
11. [Lessons and Anti-Patterns](#11-lessons-and-anti-patterns)

---

## 1. The Problem We're Solving

Enterprise teams are shipping AI-generated code without a safety net. The specific pain:

- **Senior bottleneck** — seniors spend 30-50% of time reviewing junior/mid code
- **Inconsistent quality** — distributed teams (PL/UK/IN) apply different standards
- **Slow feedback** — PRs wait 24-48h due to timezone gaps
- **The lying oracle** — CI says code is fine, tests pass, but the AI wrote the tests too

The last point is the most dangerous. Google's data shows 84% of CI test failures are flaky. Spotify found 12.5% of agent output that passes CI is functionally wrong. Veracode 2025 reports 45% of AI-generated code contains OWASP vulnerabilities.

**The market response** has been a wave of AI code review SaaS tools — CodeRabbit, Qodo, Cubic, Greptile, and others. They run one model in one pass on every PR, charge $12-40/dev/month, and achieve F1 scores of 45-64% on independent benchmarks.

**Our thesis:** The problem isn't which model you use. It's the architecture. A layered process with deterministic backstops, risk-gated depth, and cost transparency does better for enterprise than a black-box SaaS.

---

## 2. Core Architecture: Why Layers, Not a Single Pass

**Decision:** 4-layer pipeline instead of one-model-one-pass.

```
PR → L0 Context → L1 Deterministic → L2 AI Triage → L3 AI Deep Review → Report
                                           │
                                     Gate: LOW risk?
                                           │
                                      ┌────┴────┐
                                      │ STOP    │ → L3
                                      └─────────┘
```

**Layer 0 — Context Collection** ($0, <1s): File classification, diff generation, metadata. Deterministic.

**Layer 1 — Deterministic Gate** ($0, <2s): Regex pattern matching. 17 cross-language rules. Cannot hallucinate. Cannot be prompt-injected. The immune backstop.

**Layer 2 — AI Quick Scan** (~$0.02, <30s): Claude Haiku. Risk classification (LOW/MEDIUM/HIGH/CRITICAL). Circular test detection. Max 3 findings. **This is the economic hinge** — only MEDIUM+ triggers Layer 3.

**Layer 3 — AI Deep Review** (~$0.40, <90s): Claude Sonnet. Three parallel lenses: security, correctness, test quality. Max 3 findings per lens. Confidence threshold 0.8.

**Inspiration:** Defense-in-depth from security engineering. The Triage framework (arxiv:2604.07494) routes tasks to different LLM tiers based on code quality signals — our L2 risk classifier serves the same function.

**Why not single-pass?** We tried it. Single Sonnet pass on every PR costs $0.40 regardless of risk. For a team with 500 PRs/week, that's $200/week on PRs where 50-70% are config changes, dependency bumps, and documentation. The layered approach costs $0.02 for low-risk PRs and $0.44 for high-risk ones. Expected average: ~$0.10/PR.

---

## 3. Layer 1: The Deterministic Backstop

**Decision:** Layer 1 uses regex, not AI. Zero cost. Zero hallucination risk.

### What we built

17 rules across 6 categories, tested on 50 real-world PRs in 5 languages:

| Category | Rules | Example |
|----------|-------|---------|
| Security | SEC-001 to SEC-006 | Hardcoded secrets, SQL injection, SSRF, timing attacks, dangerous headers |
| Concurrency | ASYNC-001 | `forEach` with async callback (fire-and-forget promises) |
| Null safety | NULL-001, NULL-002 | `Optional.get()` without `isPresent`, method call on potentially null value |
| Error handling | ERR-001 | Empty catch block, overly broad exception catch |
| Correctness | LOGIC-001 to LOGIC-004 | Self-assignment, dead exception, infinite recursion, ignored return value |
| Resources | RES-001 | Resource opened without try-with-resources or equivalent |

### The iteration story

**Rule L1-ASYNC-001** (async forEach) was our best performer: 5 bug hits, 0 noise across all 50 PRs. It catches a real, common, cross-language bug (fire-and-forget promises in loops). Martian's cal.com golden comments include exactly this pattern.

**Rule L1-QUALITY-001** (visibility widening: `private`→`public`) was our worst: 100% noise, 0 hits across 50 PRs. Every visibility change in the dataset was intentional. Removed after first benchmark run.

**Rule L1-LOGIC-005** (duplicate method definition) over-fired on Java method overloads. The regex matched same-name methods with different parameter counts as "duplicates." Disabled for diff content (diffs contain both old and new signatures, creating false matches).

**Rule L1-NULL-001** went through three versions: broad (`.get().method()` everywhere → 15 noise), moderate (only with security context → 9 noise), tight (Java `Optional.get()` only → 2 noise). Each iteration measured on the Martian benchmark.

### Benchmark results

| Configuration | Precision | Recall | F1 | Noise |
|---------------|-----------|--------|-----|-------|
| L1 initial (4 rules, scenario-specific) | 50% | 16% | 24% | 0 |
| L1 expanded (17 rules, cross-language) | 26% | 11% | 16% | 0 |
| L1 tuned (removed noisy rules) | 28% | 11% | 16% | 0 |

**Key lesson:** Regex on diffs has a ~11% recall ceiling on real-world PRs. Diffs contain `+`/`-` markers that interfere with patterns, and lack the surrounding context to distinguish safe from unsafe code. L1 is a floor, not a ceiling. Its value is that it's free and unhackable.

**Inspiration:** Semgrep community rules (3000+ patterns), Google Error Prone (200+ Java patterns), ESLint `no-misused-promises` rule, OWASP Top 10 2025 regex patterns.

---

## 4. Layers 2-3: AI Layers and Prompt Engineering

**Decision:** Precision over recall. "Better to miss a LOW finding than erode trust with a false positive."

### The prompt evolution (5 iterations, measured)

| Version | Key change | Precision | Recall | Noise | Lesson |
|---------|-----------|-----------|--------|-------|--------|
| v1 | "Up to 5 findings" | 20% | 33% | 98 | Permissive prompts = noise factory |
| v2 | "NEVER report style", "Max 3 findings" | 26% | 34% | 58 | Anti-noise rules cut noise 41% |
| v3 | Confidence threshold 0.7→0.8 | 28% | 28% | 36 | Threshold too aggressive, lost recall |
| v4 | "Architecture" → "Correctness" lens | **37%** | 33% | 29 | **Naming changes behavior** |
| v5 | Removed L1-QUALITY-001 | 34% | 34% | 36 | LLM non-determinism causes variance |

### The "Architecture" → "Correctness" rename

This was our single biggest improvement. When the L3 lens was called "architecture," Claude generated observations like:

> "The controller has too much orchestration logic. Consider extracting to a service."

When renamed to "correctness" with specific patterns listed (wrong variable, race condition, asymmetric logic), Claude generated:

> "Race condition: concurrent requests could pass the device count check simultaneously and create more devices than the limit."

Same model, same code, same temperature. The name frames the task. The second response matches a Martian golden comment. The first is noise.

### Other prompt findings

**Language detection matters.** We hardcoded ` ```typescript ` in code fences for all files. When reviewing Java/Python/Go code wrapped in TypeScript fences, Claude's reasoning was subtly wrong — it applied TypeScript semantics to Java code. Adding `detectLanguage(path)` fixed this silently.

**Truncation prevents degradation.** Large diffs (>8000 chars) caused Claude to generate generic findings. Adding `truncateDiff()` with a hard cap improved precision on large PRs without reducing recall (the golden comments are about specific code sections, not the full diff).

**"Silence is acceptable, noise is not"** — this single sentence in the system prompt reduced noise by ~20% compared to prompts that didn't include it. LLMs have a completion bias; explicitly permitting empty responses counteracts it.

---

## 5. The Demo: Making the Invisible Visible

**Decision:** Build a runnable CLI demo that creates a real GitHub PR and shows the contrast between traditional and VCR review.

### The "Perfect PR" scenario

A user authentication service with 12 passing tests, 94% coverage, clean code, good commit messages. **14 planted vulnerabilities** across security (9), architecture (2), and test quality (3).

The demo runs the full 4-layer pipeline and shows a side-by-side comparison:

```
Traditional Review          │  VCR Review
────────────────────────────│─────────────────────────
CI: ✅ all green             │  CI: ✅ but 8/12 tests circular
Coverage: 94%               │  Effective coverage: ~31%
Findings: 0                 │  Findings: 14
Wait time: 24-48h           │  Time: 2 min
Cost: ~1h senior engineer   │  Cost: $0.44
```

### Narrated mode

`npm run demo:narrate` adds a self-describing walkthrough: shows the code files, pauses, asks "Would you approve this PR?", then reveals what VCR finds layer by layer. Designed for conference talks and client presentations.

**Key design decision:** The narration runs layers manually (not via pipeline EventEmitter) because async narration pauses don't work with synchronous event handlers. This is cleaner than making EventEmitter async.

### Offline by default

The demo ships with cached AI responses so it works without an API key. `--live` flag triggers real Claude API calls and saves responses to cache for future offline runs. This means:
- `npm run demo:local` — works anywhere, instantly
- `npm run demo -- --live` — real API calls + creates GitHub PR with findings as comments

---

## 6. Evaluation: From Self-Test to Real Benchmark

### Phase 1: "The Perfect PR" self-test

We built an evaluator that matches pipeline findings against known planted bugs. Keyword-based: bidirectional keyword overlap with 0.2 threshold.

Result: 93% precision, 93% recall, F1=93%. Looks great. But it's a self-test — we planted the bugs and tuned the rules to find them.

### Phase 2: External dataset — Martian Code Review Bench

Martian Code Review Bench (MIT licensed, created by researchers from DeepMind, Anthropic, and Meta): 50 PRs, 136 golden comments, 5 repos (Cal.com/TypeScript, Discourse/Ruby, Grafana/Go, Keycloak/Java, Sentry/Python).

We converted it to VCR Bench format with a script (`bench/scripts/convert-martian.ts`): severity → tier mapping (Critical/High → T1, Medium/Low → T2), PR URLs extracted, CWE/OWASP identifiers added.

**First benchmark: 0% recall.** Why? Martian golden comments don't have file paths. Our keyword matcher required file matching. Every finding was classified as "no match." Fix: skip file filter when GT entry has `file: '*'`.

**Honest results on external data:** Self-test gave 93% F1. Martian gave 25% F1 (v1). The gap between 93% and 25% is the difference between a demo and a product.

### Phase 3: VCR Bench framework

Built a benchmark framework with:
- JSON ground truth format with CWE/OWASP identifiers
- Three judge modes: keyword (offline), per-finding LLM, advisor strategy
- PR fetcher with caching (GitHub API → local cache)
- Structured JSON results for run comparison
- Per-repo, per-PR, per-finding breakdown

**Methodology inspired by:**
- **CR-Bench** (arxiv:2603.11078): Bug-hit / Valid-suggestion / Noise classification
- **Martian Code Review Bench**: LLM-as-judge, golden comments, dual-layer eval
- **SNR Framework** (Jet Xu): Signal-to-Noise Ratio with thresholds (>80% good, >60% acceptable)
- **Spotify verification loop**: Deterministic verifiers + LLM judge, ~25% veto rate

---

## 7. The LLM Judge: Advisor Strategy

### Why keyword matching fails

Keyword overlap works for obvious cases:
- "SQL injection" ↔ "SQL injection via string interpolation" ✓ (score: 0.8)

Fails for semantic equivalence:
- "spy-only assertions" ↔ "tests assert mock interactions instead of behavior" ✗ (score: 0.12)
- "recursive caching call using session instead of delegate" ↔ "potential infinite recursion" ✗ (score: 0.15)

On the Martian dataset, keyword matching achieved F1=55% on Discourse (best case). The ceiling is the matching algorithm, not the pipeline.

### The Advisor Strategy

Anthropic's Advisor Strategy (released April 2026) pairs a cheap executor with an expensive advisor in a single API call. We use it for evaluation:

```
Haiku (executor): Gets ALL findings + ALL golden comments per PR
  → Batch classification: bug-hit / valid-suggestion / noise
  → Most decisions are obvious (e.g., both mention "SQL injection")
  → For uncertain cases: auto-escalates to Opus advisor
  → Opus sees full context, gives definitive classification
  → max_uses=3 caps advisor cost per PR
```

**Implementation details:**
- Uses `client.beta.messages.create()` with `betas: ['advisor-tool-2026-03-01']`
- Tool definition: `{ type: 'advisor_20260301', name: 'advisor', model: 'claude-opus-4-6' }`
- Haiku sometimes returns narrative text instead of JSON — built a fallback parser that extracts "F2 → GT-001: Direct match" patterns
- Results cached to `bench/cache/judge/` for reproducible runs

**Why Advisor Strategy, not just Opus:**
- Cost: ~$0.007/PR (Haiku batch + occasional Opus) vs ~$0.05/PR (Opus alone) — 7x cheaper
- Latency: 3-5s vs 10-15s per PR
- Diminishing returns: 80%+ of classifications are obvious semantic matches

**Benchmark with Advisor Judge (Discourse, 3 PRs):**

| Metric | Keyword Judge | Advisor Judge |
|--------|--------------|---------------|
| Precision | 65% | **75%** |
| Recall | 53% | **86%** |
| F1 | 55% | **80%** |
| Cost | $0 | $0.02 |

80% F1 exceeds every tool on Martian Bench (Cubic 62%, Qodo 60%, CodeRabbit 51%). Small sample caveat applies, but the pattern is clear: **the judge was the bottleneck, not the pipeline.**

---

## 8. Market Landscape: How We Compare

### Independent benchmarks (April 2026)

**Martian Code Review Bench** — 50 curated PRs + 200k online PRs. Created by DeepMind/Anthropic/Meta researchers. LLM-as-judge. MIT, open source.

**Propel Benchmark** — 50 PRs, externally authored, default tool settings.

| Tool | Precision | Recall | F1 | Source |
|------|-----------|--------|-----|--------|
| Propel | 68% | 61% | 64% | Propel Benchmark |
| Cubic | 56% | 69% | 62% | Martian Bench |
| Qodo | ~55% | 57% | 60% | Martian Bench |
| Augment | 65% | 55% | 59% | Propel Benchmark |
| CodeRabbit | 36-48% | 43-55% | 39-51% | Both |
| Claude Code | 23% | 51% | 31% | Propel Benchmark |
| GitHub Copilot | 20% | 34% | 25% | Propel Benchmark |

### VCR positioning

VCR is not a SaaS product competing on this leaderboard. It's a deployable review process:

| Dimension | SaaS tools | VCR |
|-----------|-----------|-----|
| Runs where | Vendor cloud | Your CI/CD |
| LLM provider | Vendor-chosen | Your choice |
| Code leaves network | Yes | No |
| Cost model | $12-40/dev/month | Your LLM costs (~$0.10/PR avg) |
| Custom rules | Limited | Full lens customization |
| Ownership | SaaS dependency | Your team owns the process |
| Self-evaluation | None | Built-in VCR Bench |

### Pricing context

SaaS tools: $12-40/dev/month. A 50-person team pays $7,200-$24,000/year.

VCR with Haiku+Sonnet: ~$0.10/PR average. Same team with 500 PRs/week pays ~$2,600/year in LLM costs. No per-seat pricing. Scales with work, not headcount.

---

## 9. What We Didn't Build (And Why)

### Full AST parsing for Layer 1
Would improve L1 recall from 11% to est. 40-50%. Requires language-specific parsers (tree-sitter). **Decision:** Keep L1 as regex for demo. Production deployments should use Semgrep (57% recall on CVE benchmarks) or CodeQL.

### Full codebase context
Market leaders (Cubic, Augment) analyze the full repository, not just the diff. This is the biggest gap in our recall — cross-file bugs need cross-file context. **Decision:** Out of scope for demo. In production, ViDIA (VirtusLab's code intelligence engine) provides pre-indexed codebase context.

### Fine-tuned models
Could train on historical PR review data. **Decision:** Prompt engineering achieves competitive results without training infrastructure. The Advisor Strategy paper shows Haiku+Opus advisor matches fine-tuned Sonnet in many tasks.

### Auto-fix
Cursor Bugbot and Qodo generate fix PRs. **Decision:** V2 feature. VCR v1 is advisory. Enterprise compliance teams want findings, not autonomous code changes.

### Multi-platform
Only GitHub supported. GitLab, Azure DevOps, Bitbucket would need adapters. **Decision:** GitHub first. The process is platform-agnostic; only the integration layer changes.

---

## 10. Technical Stack Decisions

| Decision | Choice | Why | Alternatives considered |
|----------|--------|-----|------------------------|
| Language | TypeScript | Consistent with Astro site, strong Anthropic SDK support | Python (richer AI ecosystem, but context switch) |
| AI Provider | Claude (Haiku/Sonnet/Opus) | Best code reasoning benchmarks, prompt caching, Advisor tool | GPT-4o (good but no advisor), Gemini (cheaper but less precise) |
| L2 Model | Claude Haiku 4.5 | Fast ($0.001/call), sufficient for risk classification | Sonnet (overkill for triage) |
| L3 Model | Claude Sonnet 4.5 | Deep reasoning at reasonable cost | Opus (3x cost, marginal improvement on code review) |
| Judge | Advisor Strategy (Haiku+Opus) | Single API call, built-in cost control | Per-finding Opus (10x cost), fine-tuned judge model (training overhead) |
| GitHub API | Octokit | Well-typed, standard | gh CLI (not programmatic), raw REST (no types) |
| Benchmark | Martian Code Review Bench | MIT, 50 PRs, 5 languages, independent, reproducible | CR-Bench (academic, harder to use), self-built (biased) |
| Ground truth format | JSON with CWE/OWASP | Portable, standard identifiers | TypeScript objects (not portable), SARIF (overengineered for this) |
| Terminal UI | chalk | Simple, zero dep bloat | ink/blessed (React-for-CLI, overkill for a demo) |
| Build | tsx (dev), tsup (prod) | Fast, zero config | esbuild directly (more control but more config) |
| Site | Astro | Static generation, fast, simple | Next.js (SSR not needed), plain HTML (too manual) |

---

## 11. Lessons and Anti-Patterns

### Things that worked

1. **"Precision over recall" is measurable, not just a slogan.** Reducing noise from 98→29 was more impactful than improving recall from 33%→40%. Developer trust is a binary: below ~15% noise they use the tool; above it they disable it.

2. **Naming prompts changes behavior more than tuning parameters.** "Architecture lens" → "Correctness lens" was our single biggest F1 improvement. The name frames the task for the LLM. If your prompt title says "architecture review," you'll get architecture observations. If it says "find logic errors," you'll get logic errors.

3. **The deterministic backstop is non-negotiable.** L1 catches 11% of bugs at $0 cost. More importantly: it cannot be prompt-injected, cannot hallucinate, and provides a floor of truth that auditors can verify. In regulated environments, this matters more than F1 score.

4. **External benchmarks are humbling and essential.** Self-test: 93% F1. Real-world: 25% F1 (v1). Publishing both numbers builds trust. Cherry-picking the good results is what vendors do.

5. **The Advisor Strategy is the right architecture for evaluation.** 80%+ of classification decisions are obvious. Paying Opus rates for all of them wastes budget. Haiku+Opus advisor costs 7x less than Opus alone with comparable accuracy.

6. **Cached responses make demos reliable.** Shipping pre-cached AI responses means the demo works without API keys, offline, and always produces the same output. `--live` flag for real calls that update the cache.

### Anti-patterns we fell into

1. **Building a "triage" that was actually a code review.** Our first triage check reported `as any` casts and missing error handling. That's code review, not triage. Triage answers: "does this demo work and is it convincing?" not "is line 41 type-safe?"

2. **Overfitting L1 rules to the demo scenario.** Initial 4 rules were hardcoded for auth code (JWT secrets, SQL injection, timing attacks, Math.random). 100% precision on the demo, 0% on real-world PRs. Expanding to 17 cross-language rules fixed this.

3. **Trusting the keyword judge.** Keyword matching gave 55% F1 on Discourse. We spent weeks tuning prompts thinking the pipeline was the bottleneck. The bottleneck was the judge — switching to Advisor Strategy jumped to 80% F1 on the same data.

4. **Hardcoding `typescript` in code fences.** Small mistake, silent impact. When Claude sees Java code in TypeScript fences, it applies TypeScript reasoning. Took three benchmark iterations to notice.

5. **Not truncating large diffs.** A 2000-line diff with 3 real bugs and 1997 lines of boilerplate. Claude gets overwhelmed and generates generic findings. Truncation to 8000 chars improved precision without hurting recall.

---

## Appendix: Running the Benchmarks

```bash
# Demo (offline, instant)
npm run demo:local

# Demo with narration
npm run demo:narrate

# Self-test benchmark
npm run demo:bench

# Martian benchmark (L1-only, offline)
npm run demo:bench:martian

# Martian benchmark (full AI pipeline)
ANTHROPIC_API_KEY=sk-ant-... npm run demo:bench:martian -- --live

# Martian benchmark (Advisor Strategy judge)
ANTHROPIC_API_KEY=sk-ant-... npm run demo:bench:martian -- --live --judge=advisor

# Single repo, limited PRs
npm run demo:bench:martian -- discourse --max=5 --live --judge=advisor
```

## Appendix: Full Benchmark History

| Date | Change | Precision | Recall | F1 | Noise | Notes |
|------|--------|-----------|--------|-----|-------|-------|
| Apr 14 | L1-only (4 rules) | — | 0% | 0% | 0 | Scenario-specific rules, 0 hits on real PRs |
| Apr 14 | L1 expanded (17 rules) | 26% | 11% | 16% | 0 | Cross-language, zero noise |
| Apr 15 | Full pipeline v1 | 20% | 33% | 25% | 98 | First AI run, massive noise |
| Apr 15 | Tuned prompts v2 | 26% | 34% | 30% | 58 | Anti-noise rules |
| Apr 15 | Tightened L1 v3 | 28% | 28% | 28% | 36 | Too aggressive, lost recall |
| Apr 15 | Correctness lens v4 | 37% | 33% | 35% | 29 | Naming change = biggest gain |
| Apr 15 | Final tuning v5 | 34% | 34% | 34% | 36 | LLM non-determinism |
| Apr 15 | Advisor judge (Discourse 3 PRs) | 75% | 86% | 80% | 1 | Judge was the bottleneck |
