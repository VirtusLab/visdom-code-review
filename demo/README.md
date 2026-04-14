# VCR Demo

Runnable demo of the VISDOM Code Review pipeline. Creates a deliberately flawed PR, runs it through 4 review layers (deterministic + AI), and shows a side-by-side comparison of traditional vs VCR code review.

## Quick Start

```bash
cd demo
npm install

# Run locally with cached AI responses (no API key needed)
npm run demo:local

# Run with narration (self-describing, auto-paced)
npm run demo:narrate

# Run with narration (press Enter to advance)
npm run demo:interactive
```

From the project root:

```bash
npm run demo:local
npm run demo:narrate
npm run demo:interactive
```

## Modes

| Command | What it does |
|---------|-------------|
| `npm run demo` | Creates a real PR on GitHub, runs pipeline, posts findings as comments |
| `npm run demo:local` | Runs pipeline locally with terminal output only (no GitHub) |
| `npm run demo:live` | Uses real Claude API calls instead of cached responses |
| `npm run demo:narrate` | Self-describing auto-play demo with pauses between sections |
| `npm run demo:interactive` | Self-describing demo, press Enter to advance each step |
| `npm run demo:cleanup` | Closes demo PR and deletes branch on GitHub |

## Requirements

- **Node.js 20+**
- **No API key needed** for `--local`, `--narrate`, `--interactive` (uses cached responses)
- **`ANTHROPIC_API_KEY`** for `--live` mode (real Claude API calls)
- **`GITHUB_TOKEN`** or `gh` CLI authenticated for PR creation mode

## The Scenario: "The Perfect PR"

The demo ships with one meticulously crafted scenario. A developer opens a PR adding a user authentication service. The code looks professional:

- Clean Express controller with async/await
- Separated business logic in AuthService
- bcrypt for password hashing, JWT for tokens
- 12 tests with 94% line coverage
- All tests passing, CI green

**VCR finds 14 issues across 4 layers:**

| Layer | Cost | Findings |
|-------|------|----------|
| **L0** Context Collection | $0 | File classification, diff generation |
| **L1** Deterministic Gate | $0 | Hardcoded secret, SQL injection, timing attack, weak RNG |
| **L2** AI Quick Scan (Haiku) | $0.02 | 8/12 tests circular, no rate limiting, user enumeration |
| **L3** AI Deep Review (Sonnet) | $0.42 | bcrypt cost=4, JWT alg:none, no input validation, mock-only tests |

**Total: 14 findings in ~2 minutes for $0.44** vs traditional review: 0 findings, 24-48h wait, ~1h senior engineer time.

## Architecture

```
demo/
├── src/
│   ├── core/                 # Reusable engine (importable as library)
│   │   ├── types.ts          # All shared interfaces
│   │   ├── pipeline.ts       # ReviewPipeline orchestrator (EventEmitter)
│   │   ├── narrator.ts       # Narration engine (auto/interactive/none)
│   │   ├── layers/
│   │   │   ├── context-collector.ts    # L0: file classification, diff
│   │   │   ├── deterministic-gate.ts   # L1: regex security rules
│   │   │   ├── ai-quick-scan.ts        # L2: Haiku risk triage + gate
│   │   │   └── ai-deep-review.ts       # L3: Sonnet parallel lenses
│   │   ├── ai/
│   │   │   ├── client.ts     # Claude API with file-based cache
│   │   │   └── prompts.ts    # Prompt templates per layer/lens
│   │   ├── github/
│   │   │   └── operations.ts # Branch, PR, comment via Octokit
│   │   └── reporter/
│   │       ├── terminal.ts   # Side-by-side terminal output
│   │       └── markdown.ts   # GitHub PR comment formatter
│   ├── cli/
│   │   └── index.ts          # CLI entry point
│   └── scenarios/
│       └── perfect-pr/
│           ├── scenario.ts   # Scenario metadata
│           └── files/        # The deliberately flawed PR files
├── cache/                    # Cached Claude API responses (offline mode)
│   └── perfect-pr/
│       ├── layer2-quick-scan.json
│       ├── layer3-security.json
│       ├── layer3-architecture.json
│       └── layer3-test-quality.json
```

### Reusability

The `core/` modules are designed to be imported as a library:

```typescript
import { ReviewPipeline } from './core/pipeline.js';
import { ContextCollector } from './core/layers/context-collector.js';
import { DeterministicGate } from './core/layers/deterministic-gate.js';
// ... wire into your own CLI, API server, GitHub Action, or web UI
```

## Adding Scenarios

Create a new directory under `scenarios/` with:

1. `scenario.ts` exporting a `ScenarioConfig` (name, branch, PR title, file map)
2. `files/` directory with the PR fixture files

No changes to core code needed. Register the scenario in `cli/index.ts` SCENARIOS map.

## Environment Variables

| Variable | Required for | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | `--live` mode | — |
| `GITHUB_TOKEN` | PR creation | Auto-detected from `gh auth token` |
| `VCR_DEMO_REPO` | PR creation | Auto-detected from git remote |
