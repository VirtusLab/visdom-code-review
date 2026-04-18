// demo/src/scenarios/meta/hollow-test-suite/scenario.ts
import type { ScenarioConfig } from '../../../core/types.js';

export const scenario: ScenarioConfig = {
  name: 'meta/hollow-test-suite',
  title: 'Hollow Test Suite',
  description: '15 tests with 100% coverage that verify nothing — circular mocks on VCR\'s own pipeline',
  branch: 'demo/meta/hollow-test-suite',
  prTitle: 'test: add comprehensive pipeline layer tests',
  prBody: [
    '## Summary',
    '',
    'Adds full test coverage for all pipeline layers.',
    '',
    '### Changes',
    '- 15 unit tests covering L0–L3 layers',
    '- 100% line coverage on pipeline.ts and all layer files',
    '- Mock-based isolation for fast test execution',
    '',
    'Coverage report attached. All green.',
  ].join('\n'),
  files: {
    'test/pipeline.test.ts': 'files/test/pipeline.test.ts',
  },
};
