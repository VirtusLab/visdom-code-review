// demo/src/scenarios/standalone/payment-service/scenario.ts
import type { ScenarioConfig } from '../../../core/types.js';

export const scenario: ScenarioConfig = {
  name: 'standalone/payment-service',
  title: 'Payment Service',
  description: 'Python FastAPI payment endpoint with SQL injection, PCI violations, and weak auth',
  branch: 'demo/standalone/payment-service',
  prTitle: 'feat: add payment processing endpoint',
  prBody: [
    '## Summary',
    '',
    'Adds payment processing endpoint for card charges.',
    '',
    '### Changes',
    '- POST /charge — process card payment',
    '- Input validation and error handling',
    '- Logging for audit trail',
    '',
    'Tested against Stripe sandbox. All passing.',
  ].join('\n'),
  files: {
    'payment/routes.py': 'files/payment/routes.py',
    'payment/models.py': 'files/payment/models.py',
  },
};
