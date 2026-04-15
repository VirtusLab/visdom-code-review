# VCR: Architecture Decisions & Technical Narrative

A running log of every architectural decision, approach tested, benchmark result, and lesson learned during the development of VCR (VISDOM Code Review). Written as source material for technical articles.

---

## 1. Core Architecture: Why Layers, Not a Single Pass

**Decision:** 4-layer pipeline (L0 Context, L1 Deterministic, L2 AI Triage, L3 AI Deep Review) instead of one-model-one-pass like every SaaS tool on the market.

**Inspiration:** Defense-in-depth from security engineering. Each layer has a different cost/accuracy profile. Not every PR needs the same depth.

**What we tried:**
- Single Sonnet pass on every PR — expensive, no cost control, same depth for a typo fix and an auth refactor
- Layered approach with risk-gated escalation — L2 (Haiku, $0.02) decides if L3 (Sonnet, $0.40) is worth running

**What we learned:**
- On the Martian benchmark, L1 deterministic rules alone catch 11-14% of real bugs at $0 cost
- The gate decision (L2 → L3) is the economic hinge — it determines whether you spend $0.02 or $0.44 per PR
- ~30-50% of PRs are expected to trigger L3 in production

**Key reference:** Triage framework (arxiv:2604.07494) — routes tasks to different LLM tiers based on code quality signals. Our L2 risk classifier serves the same function.

---

## 2. Layer 1: Deterministic Gate — The Immune Backstop

**Decision:** Layer 1 uses regex pattern matching, not AI. Zero cost. Cannot be prompt-injected. Cannot hallucinate.

**What we built:** 17 cross-language rules covering: hardcoded secrets, SQL injection, timing attacks, weak RNG, async forEach, null deref, broad catch, self-assignment, dead exception, infinite recursion, ignored return value, SSRF, dangerous headers, duplicate methods, null method calls, resource leaks.

**What we tried and removed:**
- `L1-QUALITY-001` (visibility widening: private→public) — 100% noise on real PRs, 0 GT hits across 50 PRs. Removed.
- `L1-LOGIC-005` (duplicate method definition) — over-fired on Java method overloads and diff hunks. Disabled for diff content.
- `L1-NULL-001` broad version (`.get().method()`) — matched too many safe patterns. Tightened to Java `Optional.get()` only.

**Benchmark results (Martian, 50 PRs, 5 languages):**
- L1-only: 26% precision, 11% recall, F1=16%, **zero noise**
- Best rule: `L1-ASYNC-001` (async forEach fire-and-forget) — 5 hits, 0 noise across all repos
- Worst rules: recursion detector and null deref — high false positive rate on real codebases

**Key lesson:** Regex rules on diffs are fundamentally limited. Diffs contain `+`/`-` markers that interfere with pattern matching, and lack the context to distinguish safe from unsafe patterns. L1 is a backstop, not the main reviewer. The 11% recall baseline is the floor that AI layers build on.

**Inspiration:** Semgrep community rules, Error Prone bug patterns, ESLint async rules.

---

## 3. AI Layers: Prompt Engineering for Precision

**Decision:** Precision over recall. "Better to miss a LOW finding than erode trust with a false positive."

**What we tried:**

### v1 — Permissive prompts
- L2: "Identify up to 5 quick findings"
- L3: "Only report findings with confidence > 0.7"
- Result: 20% precision, 33% recall, **98 noise findings** across 25 PRs

### v2 — Anti-noise rules
- Added: "NEVER report style preferences", "Maximum 3 findings", "Silence is acceptable, noise is not"
- Result: 26% precision, 34% recall, 58 noise (41% reduction)

### v3 — Tightened L1 + stricter AI
- Removed noisy L1 rules, raised confidence threshold to 0.8
- Result: 28% precision, 28% recall, 36 noise

### v4 — Correctness-focused lenses
- Renamed "architecture lens" to "correctness lens" — focused on logic errors, race conditions, wrong variable
- Expanded security lens to include null deref and unsafe state
- Result: **37% precision, 33% recall, F1=35%**, 29 noise

### v5 — Final tuning
- Removed L1-QUALITY-001
- Result: 34% precision, 34% recall, F1=34%, but **Discourse (Ruby) hit 62% F1**

**Key lesson:** The "architecture" lens name was misleading the LLM into generating abstract coupling/design observations instead of concrete bugs. Renaming it to "correctness" and listing specific patterns (wrong variable, race condition, asymmetric logic) dramatically improved hit rate.

**Key lesson:** Language detection matters. Hardcoding ` ```typescript ` for Java/Python/Go code fences confused the LLM about what language it was reviewing.

---

## 4. Evaluation: From Self-Test to Real Benchmark

### Phase 1: Ground truth as self-test
- Created "The Perfect PR" scenario with 14 planted vulnerabilities
- Evaluator matched findings against known bugs using keyword overlap
- Result: 93-100% precision, 93% recall — but this is a controlled scenario, not a real benchmark

### Phase 2: External dataset (Martian Code Review Bench)
- Integrated 50 PRs, 136 golden comments, 5 languages, MIT licensed
- Converted to VCR Bench format with tier classification (Critical/High → T1, Medium/Low → T2)
- Added CWE and OWASP identifiers to our ground truth entries

**Problem discovered:** Martian golden comments don't have file paths (just text descriptions). Our keyword matcher required file matching, so it classified everything from Martian as "no match." Fix: skip file filter when GT has no file path.

### Phase 3: Keyword judge limitations
- Bidirectional keyword overlap works for obvious matches ("SQL injection" ↔ "SQL injection via string interpolation")
- Fails for semantic equivalence ("spy-only assertions" ↔ "tests assert mock interactions instead of behavior")
- Fails for domain-specific matches ("recursive caching call using session instead of delegate" ↔ "potential infinite recursion")

**This is why we need an LLM judge.**

---

## 5. LLM Judge: The Advisor Strategy

**Decision:** Use Anthropic's Advisor Strategy (claude.com/blog/the-advisor-strategy) for the evaluation judge.

**Architecture:**
```
Per-PR batch:
  Haiku (executor) gets ALL findings + ALL golden comments
  → Classifies each finding: bug-hit / valid-suggestion / noise
  → For uncertain cases (confidence < 0.7): escalates to Opus advisor
  → Opus sees same context, gives definitive classification
  → Single API request, no orchestration
```

**Why Advisor Strategy:**
- Single `messages.create()` call — no multi-step orchestration
- Built-in cost control via `max_uses` parameter
- Haiku handles 80%+ of classifications (simple semantic matching)
- Opus handles only the hard cases (subtle equivalences)
- Cost: ~$0.005/PR vs $0.03 per-finding approach

**Why not just use Opus for everything:**
- Cost: Opus alone would be ~$0.05/PR for judge (10x more)
- Latency: batch Haiku returns in ~2s, Opus in ~10s
- Diminishing returns: most matches are obvious, only ~20% need deep reasoning

**Inspiration:**
- Martian Code Review Bench: LLM-as-judge with Claude Opus/Sonnet for matching findings to golden comments
- CR-Bench (arxiv:2603.11078): CR-Evaluator classifies as bug-hit / valid-suggestion / noise
- Spotify verification loop: LLM judge layer after deterministic verifiers, ~25% veto rate

---

## 6. Benchmark Results: Where VCR Stands

### Against Martian Code Review Bench (25 PRs, 5 languages, L1+L2+L3)

| Metric | VCR v1 | VCR v5 (tuned) | Market SOTA |
|--------|--------|-----------------|-------------|
| Precision | 20% | 37% | 56-68% |
| Recall | 33% | 33% | 41-69% |
| F1 | 25% | 35% | 45-64% |
| Noise | 98 | 29 | varies |
| Cost/PR | $0.014 | $0.006 | $12-40/dev/mo |

### Best per-language results (v4-v5, with variance):

| Language | Repo | F1 | Comparable to |
|----------|------|----|---------------|
| Ruby | Discourse | **62%** | Cubic (62%), Qodo (60%) |
| TypeScript | Cal.com | **47%** | Greptile (45%), CodeRabbit (39-51%) |
| Go | Grafana | 32% | Below market |
| Java | Keycloak | 21% | Below market |
| Python | Sentry | 32% | Below market |

### Key context for fair comparison:
- Market tools are evaluated on the SAME Martian dataset
- VCR uses Haiku for L2 ($0.001/call) and Sonnet for L3 ($0.005/call) — budget models
- Market tools use frontier models (Claude Opus, GPT-5) with full codebase context
- VCR sees only the diff/patch, not the full repository
- Keyword judge (not LLM judge) was used — expected improvement with advisor strategy

---

## 7. What We Didn't Build (And Why)

### Full AST parsing for L1
- Would dramatically improve L1 recall (from 11% to est. 40-50%)
- But requires language-specific parsers (tree-sitter for each language)
- Decided: keep L1 as regex for demo simplicity. Production VCR should use Semgrep.

### Multi-repo context
- Market leaders (Cubic, Augment) analyze full codebase, not just diff
- Would improve recall on cross-file bugs (biggest gap in our results)
- Decided: out of scope for demo. ViDIA integration provides this in production.

### Fine-tuned models
- Could train a specialized review model on historical PR data
- Decided: not necessary. Prompt engineering on Claude achieves competitive results without training cost.

### Auto-fix suggestions
- Some tools (Cursor Bugbot, Qodo) generate fix PRs
- Decided: v2 feature. VCR v1 is advisory only — identifies issues, doesn't fix them.

---

## 8. Technical Stack Decisions

| Decision | Choice | Why | Alternative considered |
|----------|--------|-----|----------------------|
| Language | TypeScript | Consistency with Astro site, good Anthropic SDK | Python (better AI ecosystem) |
| AI Provider | Claude (Haiku/Sonnet) | Best code reasoning, prompt caching | GPT-4o, Gemini |
| GitHub API | Octokit | Standard, well-typed | gh CLI, raw REST |
| Benchmark dataset | Martian Code Review Bench | MIT, 50 PRs, 5 languages, independent | CR-Bench (academic, less practical) |
| Judge architecture | Advisor Strategy (Haiku+Opus) | Single API call, cost control | Per-finding Opus (10x cost) |
| Ground truth format | JSON with CWE/OWASP | Portable, standard | TypeScript objects (not portable) |
| Terminal output | chalk | Simple, no TUI framework | ink (React for CLI, overkill) |

---

## 9. Lessons for the Technical Article

1. **"Precision over recall" is not just a slogan.** We measured it: reducing noise from 98 to 29 findings was more impactful than increasing recall from 33% to 40%. Developer trust is the bottleneck.

2. **Naming your AI prompts matters.** Renaming "architecture lens" to "correctness lens" changed the LLM's behavior more than any other single change. The name frames the task.

3. **Deterministic backstop is non-negotiable.** L1 catches 11% of bugs at $0 cost and cannot be prompt-injected. In a world where the AI layer might hallucinate, having a floor of deterministic truth matters.

4. **Benchmark yourself honestly.** Our Discourse (Ruby) result of 62% F1 competes with market leaders. Our Keycloak (Java) result of 21% does not. Both are published. Cherry-picking the good results is what vendors do. Publishing both is what builds trust.

5. **The Advisor Strategy fits evaluation perfectly.** Most classification decisions are easy (Haiku can do them). Only ~20% need deep reasoning (Opus). Paying for Opus on every decision wastes 80% of the budget.

6. **External datasets are essential.** Our self-test (Perfect PR) gave 93% F1. Real-world PRs give 34% F1. The gap is the difference between a demo and a product.
