import type { ScenarioConfig } from '../../../core/types.js';

export const scenario: ScenarioConfig = {
  name: 'meta/insecure-ai-client',
  title: 'Securing the AI Client',
  description: 'A seemingly improved AI client with hardcoded credentials and unsafe logging',
  branch: 'demo/meta/insecure-ai-client',
  prTitle: 'feat: add retry and caching to AI client',
  prBody: [
    '## Summary',
    '',
    'Improves AI client reliability with automatic retries and better error handling.',
    '',
    '### Changes',
    '- Add retry logic for transient API failures',
    '- Improve cache key generation',
    '- Add debug logging for troubleshooting',
    '',
    'All existing tests pass.',
  ].join('\n'),
  files: {
    'src/core/ai/client.ts': 'files/src/core/ai/client.ts',
  },
};
