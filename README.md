# VISDOM Code Review

**Multi-layered, AI-driven code review framework for enterprise teams.**

Pre-indexed repo context, deterministic static analysis, AI-powered risk classification and deep review — served as a structured pipeline on every PR.

---

## The Problem

Enterprise teams want to deploy AI-generated code but lack a safety net:

- **Senior bottleneck** — seniors spend 30-50% of time reviewing junior/mid code
- **Inconsistent quality** — distributed teams (PL/UK/IN) apply different standards
- **Slow feedback** — PRs wait 24-48h due to timezone gaps
- **AI-code trust gap** — CI is a [lying oracle](https://virtuslab.com/blog/ai/the-fallacy) that confirms what AI wants to hear

## The Solution

VCR reviews every PR through layers of increasing depth:

```
PR opened
  │
  ▼
Layer 0: Context Collection          (<10s)   deterministic
Layer 1: Deterministic Gate          (<60s)   linters, SAST, secrets, TORS
Layer 2: AI Quick Scan               (<2min)  risk classification, quick findings
Layer 3: AI Deep Review              (<10min) full analysis, Review Lenses
  │                                           ↑ only MEDIUM+ risk
  ▼
Reporter: structured PR comment + inline annotations
```

LOW-risk PRs complete in <2 min at ~$0.05. Deep review triggers only when risk warrants it.

A **Proactive Scanner** runs independently on cron — catching convention drift, coverage trends, and tech debt before they become incidents.

## Key Design Decisions

- **Process-first, tool-agnostic** — defines steps, inputs, outputs. Reference implementations provided; the process is portable
- **Deterministic backstop** — Layer 1 cannot be prompt-injected, hallucinated, or non-deterministic. It is the floor
- **Precision over recall** — max 5 findings in Quick Scan, confidence threshold 0.8, silence is OK. The Cry Wolf effect kills adoption
- **TORS filtering** — flaky tests excluded from feedback signal. Agents don't "fix" tests that aren't broken
- **Layered cost model** — Haiku for L2, Sonnet for L3, Opus for CRITICAL. Budget caps in config

## Documentation

**[virtuslab.github.io/visdom-code-review](https://virtuslab.github.io/visdom-code-review/)**

| Page | What it covers |
|------|----------------|
| [Overview](https://virtuslab.github.io/visdom-code-review/) | Problem, solution, design principles, personas |
| [Architecture](https://virtuslab.github.io/visdom-code-review/architecture/) | Layer diagram, risk gating, TORS, proactive scanner |
| [Layer 0](https://virtuslab.github.io/visdom-code-review/layers/context-collection/) | Context collection, repository knowledge layer |
| [Layer 1](https://virtuslab.github.io/visdom-code-review/layers/deterministic-gate/) | Deterministic gate, TORS filtering |
| [Layer 2](https://virtuslab.github.io/visdom-code-review/layers/ai-quick-scan/) | AI Quick Scan, risk classifier, 8 risks with mitigations |
| [Layer 3](https://virtuslab.github.io/visdom-code-review/layers/ai-deep-review/) | Deep review, Review Lenses, circular test detection |
| [Reporter](https://virtuslab.github.io/visdom-code-review/reporter/) | PR comment format, inline comments, output channels |
| [Proactive Scanner](https://virtuslab.github.io/visdom-code-review/proactive-scanner/) | Convention drift, coverage trends, tech debt scans |
| [Configuration](https://virtuslab.github.io/visdom-code-review/configuration/) | `vcr-config.yaml` reference, repo structure, GitHub Actions |
| [Metrics](https://virtuslab.github.io/visdom-code-review/metrics/) | Per-layer metrics, ITS/CPI/TORS, feedback mechanism |
| [Before/After](https://virtuslab.github.io/visdom-code-review/before-after/) | 4 scenarios: security vuln, flaky tests, convention drift, budget |
| [Reference Implementations](https://virtuslab.github.io/visdom-code-review/reference-implementations/) | Tech-agnostic table, VL references, open questions |

## VISDOM SDLC Metrics

VCR integrates with the [VISDOM Agent-Ready SDLC](https://virtuslab.com/services/visdom) metrics framework:

| Metric | What it measures | VCR's role |
|--------|-----------------|------------|
| **ITS** (Iterations-to-Success) | Agent iterations to passing CI | Reduces via TORS filtering + early feedback |
| **CPI** (Cost-per-Iteration) | Tokens + compute + CI + review | Reduces review overhead; TORS cuts wasted iterations |
| **TORS** (Test Oracle Reliability Score) | % of test failures that are real | Measured by Layer 1; feeds risk classification |

## Reference Implementations

VCR is a process framework. These are reference implementations for pilot deployments:

| Component | Reference | Alternatives |
|-----------|-----------|--------------|
| Repository knowledge layer | [ViDIA](https://github.com/virtuslab/vidia) (VirtusLab, MIT) | Sourcegraph, custom DuckDB over git log |
| CI infrastructure | VISDOM Machine-Speed CI | Bazel + EngFlow, Nx, Turborepo |
| AI provider | Anthropic Claude (Haiku/Sonnet/Opus) | OpenAI, Azure OpenAI, Google Gemini |
| CI/CD platform | GitHub Actions | GitLab CI, Azure Pipelines, Jenkins |

## Development

```bash
npm install
npm run dev      # localhost:4321
npm run build    # static output → dist/
```

Deploys automatically to GitHub Pages on push to master via `.github/workflows/deploy.yml`.

## Part of VISDOM

VCR sits within the **Automated Risk Assessment** pillar of [VISDOM](https://virtuslab.com/services/visdom) — alongside Context Fabric and Machine-Speed CI.

Read the series: [The Agent-Ready SDLC](https://virtuslab.com/blog/ai/the-fallacy)

---

*VirtusLab · [virtuslab.com](https://virtuslab.com)*
