// demo/src/scenarios/meta/broken-deterministic-gate/scenario.ts
import type { ScenarioConfig } from '../../../core/types.js';

export const scenario: ScenarioConfig = {
  name: 'meta/broken-deterministic-gate',
  title: 'Refactoring the Gate',
  description: 'A "clean" refactor of the deterministic security gate that silently weakens it',
  branch: 'demo/meta/broken-deterministic-gate',
  prTitle: 'refactor: simplify deterministic gate pattern matching',
  prBody: [
    '## Summary',
    '',
    'Refactors the deterministic gate for readability and maintainability.',
    '',
    '### Changes',
    '- Simplify SQL injection regex (remove redundant clauses)',
    '- Inline JWT secret check for clarity',
    '- Remove unused SSRF rule (no external URLs in codebase)',
    '- Code style improvements',
    '',
    'Behavior unchanged. All tests pass.',
  ].join('\n'),
  files: {
    'src/core/layers/deterministic-gate.ts': 'files/src/core/layers/deterministic-gate.ts',
  },
};
