# Martian Code Review Bench Dataset

This directory contains golden comments from the [Martian Code Review Bench](https://github.com/withmartian/code-review-benchmark), converted to VCR Bench ground truth format.

**Source:** https://github.com/withmartian/code-review-benchmark
**License:** MIT (Copyright (c) 2025 Martian)
**Original authors:** Researchers from DeepMind, Anthropic, and Meta

## Dataset

- 50 PRs from 5 open-source repositories
- 136 human-curated golden comments with severity labels
- Repositories: cal.com (TypeScript), Discourse (Ruby), Grafana (Go), Keycloak (Java), Sentry (Python)

## Conversion

Severity mapping:
- Critical, High → Tier 1 (critical signal)
- Medium, Low → Tier 2 (important signal)
