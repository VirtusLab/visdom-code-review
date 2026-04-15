# FAQ Backed by Algorithm Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a FAQ page (10 questions) and landing page tease (3 questions) backed by real VCR mechanisms and benchmark data, plus two small algorithm improvements (PR description context, import graph) that make FAQ answers truthful.

**Architecture:** Algorithm fixes go first (Tasks 1-3) so we can benchmark before/after and use real numbers in the FAQ. FAQ page (Task 4) and landing page tease (Task 5) come second. Architecture doc update last (Task 6).

**Tech Stack:** Astro (pages), TypeScript (pipeline), existing DocLayout, Tailwind CSS, Martian benchmark runner

---

### Task 1: Add PR body to PRMetadata and PRFetcher

**Files:**
- Modify: `demo/src/core/types.ts:13-21`
- Modify: `demo/src/core/pr-fetcher.ts:68-78`

- [ ] **Step 1: Add `body` field to PRMetadata interface**

In `demo/src/core/types.ts`, add `body` after `title`:

```typescript
export interface PRMetadata {
  number: number;
  url: string;
  branch: string;
  title: string;
  body: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}
```

- [ ] **Step 2: Store PR body in PRFetcher**

In `demo/src/core/pr-fetcher.ts`, update the `result` object at line 68 to include `body`:

```typescript
    const result: FetchedPR = {
      meta: {
        number,
        url: pr.html_url,
        branch: pr.head.ref,
        title: pr.title,
        body: pr.body ?? '',
        filesChanged: prFiles.length,
        linesAdded: prFiles.reduce((s, f) => s + f.additions, 0),
        linesRemoved: prFiles.reduce((s, f) => s + f.deletions, 0),
      },
      files,
      diff: diffLines.join('\n'),
    };
```

- [ ] **Step 3: Set default body in bench-martian.ts context builder**

In `demo/src/cli/bench-martian.ts`, the context builder at ~line 138 creates a `ReviewContext` with a manual `pr` object. Add `body: ''` there:

```typescript
        const context: ReviewContext = {
          scenario: `martian-${repoName}-pr${i}`,
          pr: { ...fetched.meta, body: fetched.meta.body ?? '' },
          diff: fetched.diff,
          files: fetched.files,
          previousLayers: [],
        };
```

- [ ] **Step 4: Set default body in existing scenario configs**

In `demo/src/cli/index.ts`, find where `ReviewContext` is built for the Perfect PR scenario. Add `body: ''` (or the scenario's `prBody`) to the `pr` object. Search for `pr:` object literal and add the field.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd demo && npx tsc --noEmit`
Expected: No errors (all PRMetadata usages now include `body`).

- [ ] **Step 6: Commit**

```bash
git add demo/src/core/types.ts demo/src/core/pr-fetcher.ts demo/src/cli/bench-martian.ts demo/src/cli/index.ts
git commit -m "feat: add PR body to PRMetadata for intent context"
```

---

### Task 2: Add PR intent and import graph to prompts

**Files:**
- Modify: `demo/src/core/ai/prompts.ts:1-66` (Quick Scan) and `:68-165` (Deep Review)

- [ ] **Step 1: Add PR intent section to Quick Scan prompt**

In `demo/src/core/ai/prompts.ts`, update the `prompt` template in `buildQuickScanPrompt` (around line 53). Insert a PR intent block between the file list and the diff:

```typescript
    prompt: `## PR: ${context.pr.title}

### PR intent (from author):
${context.pr.body ? truncateContent(context.pr.body, 200) : 'No description provided.'}

### Files changed:
${fileList}

### Layer 1 (deterministic) findings already reported — do NOT duplicate:
${l1Summary}

### Diff:
\`\`\`
${truncateDiff(context.diff, 8000)}
\`\`\``,
```

- [ ] **Step 2: Add import graph extraction function**

At the bottom of `demo/src/core/ai/prompts.ts` (after `truncateContent`), add:

```typescript
export function extractImports(files: { path: string; content: string }[]): string[] {
  const modules = new Set<string>();

  for (const file of files) {
    const lines = file.content.split('\n');
    for (const line of lines) {
      // JS/TS: import ... from '...' or require('...')
      const jsImport = line.match(/(?:from|require\()\s*['"]([^'"]+)['"]/);
      if (jsImport) { modules.add(jsImport[1].split('/').pop()!); continue; }

      // Python: from X import ... or import X
      const pyImport = line.match(/^(?:from\s+(\S+)\s+import|import\s+(\S+))/);
      if (pyImport) { modules.add((pyImport[1] ?? pyImport[2]).split('.').pop()!); continue; }

      // Go: "package/path" inside import block
      const goImport = line.match(/^\s*"([^"]+)"/);
      if (goImport && !line.includes('func') && !line.includes('var')) {
        modules.add(goImport[1].split('/').pop()!);
        continue;
      }

      // Java: import com.example.Class;
      const javaImport = line.match(/^import\s+([\w.]+);/);
      if (javaImport) { modules.add(javaImport[1].split('.').pop()!); continue; }

      // Ruby: require 'something'
      const rbImport = line.match(/require\s+['"]([^'"]+)['"]/);
      if (rbImport) { modules.add(rbImport[1].split('/').pop()!); continue; }
    }
  }

  // Deduplicate, cap at 20
  return [...modules].slice(0, 20);
}
```

- [ ] **Step 3: Add related modules to Quick Scan prompt**

Update the `prompt` template in `buildQuickScanPrompt` to include related modules. Add after the PR intent block:

```typescript
### Related modules (imported by changed files):
${extractImports(context.files).join(', ') || 'None detected.'}
```

The full prompt string becomes:

```typescript
    prompt: `## PR: ${context.pr.title}

### PR intent (from author):
${context.pr.body ? truncateContent(context.pr.body, 200) : 'No description provided.'}

### Related modules (imported by changed files):
${extractImports(context.files).join(', ') || 'None detected.'}

### Files changed:
${fileList}

### Layer 1 (deterministic) findings already reported — do NOT duplicate:
${l1Summary}

### Diff:
\`\`\`
${truncateDiff(context.diff, 8000)}
\`\`\``,
```

- [ ] **Step 4: Add PR intent and related modules to Deep Review prompt**

Update the `prompt` template in `buildDeepReviewPrompt` (around line 160):

```typescript
    prompt: `## PR: ${context.pr.title}

### PR intent (from author):
${context.pr.body ? truncateContent(context.pr.body, 200) : 'No description provided.'}

### Related modules (imported by changed files):
${extractImports(context.files).join(', ') || 'None detected.'}

### Code:
${fileContents}`,
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd demo && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add demo/src/core/ai/prompts.ts
git commit -m "feat: add PR intent context and import graph to L2/L3 prompts"
```

---

### Task 3: Benchmark algorithm fixes and document results

**Files:**
- Read: benchmark results
- Modify: `docs/architecture-decisions.md`

- [ ] **Step 1: Clear AI caches for fresh responses**

```bash
rm -rf demo/cache/martian
rm -rf demo/bench/cache/judge
```

- [ ] **Step 2: Run full advisor benchmark (all 5 repos)**

Run each repo in parallel:

```bash
npx tsx demo/src/cli/bench-martian.ts cal_dot_com --judge=advisor --live &
npx tsx demo/src/cli/bench-martian.ts discourse --judge=advisor --live &
npx tsx demo/src/cli/bench-martian.ts grafana --judge=advisor --live &
npx tsx demo/src/cli/bench-martian.ts keycloak --judge=advisor --live &
npx tsx demo/src/cli/bench-martian.ts sentry --judge=advisor --live &
wait
```

Expected: Results saved to `demo/bench/results/martian-<repo>-*.json`.

- [ ] **Step 3: Compare with v5 baseline**

v5 baseline (before algorithm fixes): P=46%, R=40%, F1=43%, Noise=37.

Parse new results and compare per-repo and aggregate. Note whether PR intent and import graph improved, regressed, or had no effect.

- [ ] **Step 4: Add section 12 to architecture-decisions.md**

Add a new section "12. FAQ-Driven Algorithm Improvements" with:
- What changed (PR body in PRMetadata, import graph extraction, intent+modules in prompts)
- Why (FAQ research revealed gaps in "intent understanding" and "cross-file context")
- Benchmark before/after numbers
- Lesson learned

- [ ] **Step 5: Commit**

```bash
git add docs/architecture-decisions.md
git commit -m "docs: add benchmark results for PR intent + import graph improvements"
```

---

### Task 4: Create FAQ page

**Files:**
- Create: `src/pages/faq.astro`
- Modify: `src/layouts/DocLayout.astro:52-53` (add FAQ to nav)

- [ ] **Step 1: Add FAQ link to DocLayout nav**

In `src/layouts/DocLayout.astro` at line 52, add FAQ link after Scenarios:

```html
        <a href={`${base}before-after/`} class="hover:text-visdom-gray-900 no-underline">Scenarios</a>
        <a href={`${base}faq/`} class="hover:text-visdom-gray-900 no-underline">FAQ</a>
        <a href={`${base}reference/`} class="hover:text-visdom-gray-900 no-underline">Reference</a>
```

- [ ] **Step 2: Create FAQ page**

Create `src/pages/faq.astro` using DocLayout. 10 questions grouped in 4 categories. Each answer uses `<details>` for accordion behavior. Each answer references specific VCR mechanisms with layer numbers, benchmark data, and cost figures.

Use the DocLayout with props:
```
title="Frequently Asked Questions"
subtitle="Common questions about AI code review — answered with data, not marketing"
section="Home"
```

The page body contains 4 sections (Trust & Accuracy, Enterprise Security, Economics, Process), each with `<details><summary>` elements for the questions. Answers should be 3-5 sentences each, referencing specific numbers from benchmarks (P=46%, R=40%, $0.10/PR avg, etc.). Include links to evaluation methodology and architecture reference pages where relevant.

Fill in the actual benchmark numbers from the latest run (Task 3 results). If the numbers changed from the algorithm fixes, use the new numbers.

- [ ] **Step 3: Verify page builds**

Run: `npm run build`
Expected: Build succeeds, no errors. FAQ page accessible at `/faq/`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/faq.astro src/layouts/DocLayout.astro
git commit -m "feat: add FAQ page with 10 evidence-backed questions"
```

---

### Task 5: Add FAQ tease to landing page

**Files:**
- Modify: `src/pages/index.astro:419-420` (insert before Market Landscape section)

- [ ] **Step 1: Add FAQ tease section**

Insert a new section before the `<!-- ============ Market Landscape ============ -->` comment (line 420) in `src/pages/index.astro`:

```html
  <!-- ============ FAQ Tease ============ -->
  <section class="stats-section">
    <div class="stats-section__inner">
      <h2 class="section-heading">Common questions</h2>

      <div class="faq-tease">
        <details class="faq-tease__item">
          <summary class="faq-tease__q">How do I know the findings are real, not hallucinations?</summary>
          <p class="faq-tease__a">Layer 1 uses deterministic regex rules that cannot hallucinate. AI layers (L2/L3) require &ge;80% confidence and cap at 3 findings per lens. Verified on 50 real-world PRs across 5 languages with an independent LLM judge.</p>
        </details>

        <details class="faq-tease__item">
          <summary class="faq-tease__q">Does our code leave the network?</summary>
          <p class="faq-tease__a">No. VCR runs in your CI/CD pipeline with your own API key. No SaaS dependency. Air-gap compatible &mdash; Layer 1 works with zero network access.</p>
        </details>

        <details class="faq-tease__item">
          <summary class="faq-tease__q">What does it actually cost?</summary>
          <p class="faq-tease__a">~$0.10 per PR average. Low-risk PRs cost $0.02 (Haiku triage only). A 50-person team doing 500 PRs/week pays ~$2,600/year in LLM costs vs $7,200&ndash;$24,000 for SaaS tools.</p>
        </details>
      </div>

      <div style="text-align: center; margin-top: 1.5rem;">
        <a href={`${base}faq/`} class="btn btn--outline">See all 10 questions &rarr;</a>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Add CSS for FAQ tease**

Add styles in the `<style>` block at the bottom of `index.astro`:

```css
    /* ===== FAQ Tease ===== */
    .faq-tease {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .faq-tease__item {
      border: 1px solid var(--light-gray);
      border-radius: 8px;
      padding: 0;
      background: var(--white);
    }
    .faq-tease__q {
      padding: 1rem 1.25rem;
      font-weight: 600;
      font-size: 1.05rem;
      cursor: pointer;
      color: var(--text);
      list-style: none;
    }
    .faq-tease__q::-webkit-details-marker { display: none; }
    .faq-tease__q::before {
      content: '+';
      display: inline-block;
      width: 1.5rem;
      font-weight: 700;
      color: var(--brand-green);
    }
    details[open] .faq-tease__q::before { content: '−'; }
    .faq-tease__a {
      padding: 0 1.25rem 1rem 2.75rem;
      color: var(--text-secondary);
      font-size: 0.95rem;
      line-height: 1.6;
    }
```

- [ ] **Step 3: Add FAQ link to landing page nav**

In `src/pages/index.astro`, find the nav links (line 39-45) and add FAQ:

```html
        <a href={`${base}before-after/`} class="nav__link">Scenarios</a>
        <a href={`${base}faq/`} class="nav__link">FAQ</a>
        <a href={`${base}reference/`} class="nav__link">Reference</a>
```

- [ ] **Step 4: Verify page builds and looks correct**

Run: `npm run dev`
Open http://localhost:4321/ and scroll to the FAQ tease section. Verify accordions expand/collapse. Click "See all 10 questions" link — should navigate to `/faq/`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: add FAQ tease section to landing page with top 3 questions"
```

---

### Task 6: Update architecture decisions document

**Files:**
- Modify: `docs/architecture-decisions.md`

- [ ] **Step 1: Add FAQ research section**

If not already done in Task 3 Step 4, add or expand section 12 in `docs/architecture-decisions.md` with:

- Research methodology (web search, practitioner sources — list the 11 sources from the research)
- 14 concerns identified, 10 addressed, 3 partially addressed, 1 not addressed
- How FAQ answers map to pipeline mechanisms
- The decision to combine FAQ content with algorithm improvements (not just content marketing)

- [ ] **Step 2: Commit and push**

```bash
git add docs/architecture-decisions.md
git commit -m "docs: add FAQ research and algorithm improvement results to architecture decisions"
git push origin dev
```

---

## Task Dependency Summary

```
Task 1 (PR body in types) → Task 2 (prompts) → Task 3 (benchmark)
                                                       ↓
                              Task 4 (FAQ page) ←── uses numbers from Task 3
                              Task 5 (landing tease) ←── uses numbers from Task 3
                              Task 6 (arch doc) ←── uses numbers from Task 3
```

Tasks 4, 5, 6 can run in parallel after Task 3 completes.
