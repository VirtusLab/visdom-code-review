# FAQ Backed by Algorithm Improvements

**Date:** 2026-04-15
**Status:** Approved
**Scope:** FAQ page + landing page tease + 2 algorithm fixes + architecture doc update

---

## Problem

VCR has solid engineering (43% F1, advisor judge, 4-layer pipeline) but no content addressing the real concerns developers and engineering leaders have about AI code review. Research identified 14 practitioner-sourced concerns; VCR credibly addresses 10, partially addresses 3, and doesn't address 1.

The 3 "partial" gaps are addressable with small algorithm changes. Building FAQ content backed by real mechanisms and benchmarks (not just claims) fits VCR's positioning as transparent and evidence-based.

## Deliverables

### 1. FAQ Page (`/faq`)

10 questions in 4 categories. Each answer references specific VCR mechanisms (layer numbers, rule IDs, benchmark data, cost figures).

#### Trust & Accuracy

**Q1: "How do I know the findings are real, not hallucinations?"**
Answer references: L1 deterministic backstop (0% hallucination, 17 regex rules), AI layers confidence threshold (0.8), max 3 findings per lens, Martian benchmark numbers (46% precision, 50 PRs, 5 languages). Links to evaluation methodology page.

**Q2: "What about false positives / alert fatigue?"**
Answer references: "Precision over recall" philosophy, v6 prompt experiment (expanding patterns INCREASED noise), usefulness rate (76% = hits+valid/total), "silence is acceptable, noise is not" prompt design. Cites Cubic's blog on false positive problem.

**Q3: "Can it understand developer intent, not just patterns?"**
Answer references: **NEW PR description parsing** in L0 — pipeline reads PR title and body, passes intent context ("PR intent: Add caching for auth tokens") to L2/L3 prompts. Risk adjustment based on PR labels. Honest caveat: intent understanding is shallow (title/body parsing, not semantic reasoning).

**Q4: "It only sees the diff — how can it catch cross-file bugs?"**
Answer references: **NEW import graph** in L0 — lists related modules in L2/L3 prompts. Honest numbers: diff-only ceiling is ~55-60% recall, 63% of missed bugs need full codebase context. Links to "What We Didn't Build" section in architecture doc. Mentions ViDIA as production path to full-repo context.

#### Enterprise Security

**Q5: "Does our code leave the network?"**
Answer references: Runs in client CI/CD pipeline, client owns the API key, no SaaS dependency. Deployment model comparison table (already on landing page). Air-gap compatible: L1 works with zero network access.

**Q6: "How does this work with SOC2/HIPAA/EU AI Act?"**
Answer references: L1 deterministic = auditable rule-based findings (rule ID, regex pattern, line number). Full pipeline report is structured JSON suitable as compliance artifact. Anthropic API enterprise terms (no training on inputs). EU AI Act: deterministic backstop satisfies "human oversight" requirements for high-risk AI systems.

**Q7: "What about shadow AI / ungoverned tool sprawl?"**
Answer references: VCR as governed CI/CD component replaces ad-hoc Copilot/ChatGPT usage for review. Single pipeline with audit trail. Cites Augment Code's research on 65% ungoverned AI tools in enterprises.

#### Economics

**Q8: "What does it actually cost?"**
Answer references: Per-PR cost breakdown with real numbers:
- L0+L1 only (low-risk): $0.00
- L0+L1+L2 (medium-risk): ~$0.02
- Full pipeline (high-risk): ~$0.44
- Average across all PRs: ~$0.10
- 50-person team, 500 PRs/week: ~$2,600/year
- Comparison: SaaS tools $12-40/dev/month = $7,200-$24,000/year for same team
- Advisor judge for evaluation: $0.005/PR

**Q9: "What if the AI model gets more expensive or changes?"**
Answer references: Pipeline is model-agnostic. L2 uses Haiku (cheapest), L3 uses Sonnet (mid-tier). Swap to any Claude model, GPT-4o, or Gemini by changing one config. L1 works with zero LLM. No vendor lock-in: client owns the pipeline code.

#### Process

**Q10: "Does this replace human reviewers?"**
Answer references: No. First-pass filter. Benchmark data: 40% recall = VCR catches 4 in 10 bugs. 60% still need human eyes. Positioned as: frees senior reviewers from routine catches (secrets, null safety, async mistakes) so they focus on architecture and mentorship. Cites GitHub's research on human oversight in code review.

### 2. Landing Page Tease

3 questions shown on landing page (before Market Landscape section). Accordion/expandable format. Each shows question + 1-line answer. Link: "See all 10 questions →" to `/faq`.

Selected questions (trust, security, cost):
- Q1: "How do I know the findings are real?" → "Layer 1 uses deterministic rules that cannot hallucinate. AI layers require 80% confidence. Verified on 50 real-world PRs."
- Q5: "Does our code leave the network?" → "No. VCR runs in your CI/CD with your API key. No SaaS dependency. Air-gap compatible."
- Q8: "What does it actually cost?" → "~$0.10 per PR average. A 50-person team pays ~$2,600/year in LLM costs vs $7,200-24,000 for SaaS tools."

### 3. Algorithm Fix A: PR Description Context

**File:** `demo/src/core/layers/context-collector.ts`

Change: After collecting file metadata, extract PR intent from `context.pr.title` and `context.pr.body` (already available in `ReviewContext`).

**File:** `demo/src/core/ai/prompts.ts`

Change: Add "PR intent" section to L2 Quick Scan and L3 Deep Review prompts:
```
### PR intent (from author):
Title: ${context.pr.title}
Description: ${truncate(context.pr.body, 200)}
```

This gives the AI model the developer's stated intent. Zero additional API cost — the data is already fetched by PRFetcher.

**Expected impact:** Helps L2 risk classification (a PR described as "security fix" should get MEDIUM+ risk). Helps L3 avoid flagging intentional changes (e.g., "deliberately widening visibility for plugin API").

**Measurement:** Re-run Martian benchmark with advisor judge. Compare precision/recall before and after.

### 4. Algorithm Fix B: Import Graph Context

**File:** `demo/src/core/layers/context-collector.ts`

Change: Parse import/require/from statements from changed files' diff content. Extract module names. Store as `context.relatedModules: string[]`.

Regex patterns:
- JS/TS: `import .* from ['"](.+)['"]` and `require\(['"](.+)['"]\)`
- Python: `from (\S+) import` and `import (\S+)`
- Go: `"(\S+)"` inside import blocks
- Java: `import ([\w.]+);`
- Ruby: `require ['"](.+)['"]`

Only extract module names (not content). Deduplicate. Cap at 20 modules.

**File:** `demo/src/core/ai/prompts.ts`

Change: Add related modules list to L2 and L3 prompts:
```
### Related modules (imported by changed files):
${context.relatedModules.join(', ')}
```

**Expected impact:** Gives the AI model awareness of what other parts of the codebase are affected. A finding about "wrong return type from auth service" becomes more plausible when the prompt shows auth-service is imported.

**Measurement:** Re-run Martian benchmark with advisor judge. Compare before/after.

### 5. Architecture Decisions Update

After implementing fixes A and B:
1. Add section "12. FAQ-Driven Algorithm Improvements" to `docs/architecture-decisions.md`
2. Include: what changed, why (FAQ research revealed the gap), benchmark before/after
3. Document the research sources used for FAQ content

## Component Layout

```
/src/pages/faq.astro          — Full FAQ page, DocLayout, 10 questions
/src/pages/index.astro         — Add 3-question tease section
/demo/src/core/layers/context-collector.ts  — PR description + import graph
/demo/src/core/ai/prompts.ts              — Add intent + modules to prompts
/docs/architecture-decisions.md            — New section 12
```

## What This Does NOT Include

- No interactive Q&A or chatbot
- No full codebase indexing (that's ViDIA's job)
- No model fine-tuning
- No changes to L1 deterministic rules
- No changes to the judge (advisor strategy stays as-is)

## Success Criteria

1. FAQ page renders with 10 questions, each referencing specific VCR mechanisms
2. Landing page shows 3-question tease with link to full FAQ
3. Algorithm fixes A+B don't regress F1 below 40% on Martian benchmark
4. If F1 improves, new numbers reflected in FAQ answers and architecture doc
5. All changes documented in architecture-decisions.md
