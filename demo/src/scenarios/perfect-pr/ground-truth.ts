import type { Finding } from '../../core/types.js';

export interface GroundTruthEntry {
  id: string;
  tier: 1 | 2;  // Tier 1 = critical signal (runtime, security, breaking), Tier 2 = important signal (arch, maintainability)
  category: string;
  file: string;
  line?: number;
  title: string;
  description: string;
}

// Every known vulnerability planted in "The Perfect PR"
export const groundTruth: GroundTruthEntry[] = [
  // === Tier 1: Critical Signal (security, runtime, breaking) ===
  {
    id: 'GT-001',
    tier: 1,
    category: 'security',
    file: '.env.test',
    line: 5,
    title: 'Hardcoded JWT secret in version control',
    description: 'JWT_SECRET=super-secret-key-123 committed to repo, identical to .env.example.',
  },
  {
    id: 'GT-002',
    tier: 1,
    category: 'security',
    file: 'src/auth/auth.model.ts',
    title: 'SQL injection via string interpolation',
    description: 'All queries use template literal interpolation instead of parameterized queries.',
  },
  {
    id: 'GT-003',
    tier: 1,
    category: 'security',
    file: 'src/auth/auth.controller.ts',
    line: 53,
    title: 'Timing-unsafe token comparison',
    description: 'Uses === for token comparison instead of crypto.timingSafeEqual.',
  },
  {
    id: 'GT-004',
    tier: 1,
    category: 'security',
    file: 'src/auth/auth.service.ts',
    title: 'Weak random number generator for security tokens',
    description: 'Math.random() used for session ID generation.',
  },
  {
    id: 'GT-005',
    tier: 1,
    category: 'security',
    file: 'src/auth/auth.service.ts',
    line: 7,
    title: 'bcrypt cost factor too low (4 vs 12+)',
    description: 'SALT_ROUNDS=4 makes hashes brute-forceable in seconds.',
  },
  {
    id: 'GT-006',
    tier: 1,
    category: 'security',
    file: 'src/middleware/auth.middleware.ts',
    title: 'JWT accepts algorithm none and ignores expiry',
    description: 'ignoreExpiration: true and no algorithm restriction.',
  },
  {
    id: 'GT-007',
    tier: 1,
    category: 'security',
    file: 'src/auth/auth.controller.ts',
    title: 'No rate limiting on login endpoint',
    description: 'Unlimited login attempts allow brute-force attacks.',
  },
  {
    id: 'GT-008',
    tier: 1,
    category: 'security',
    file: 'src/auth/auth.controller.ts',
    title: 'User enumeration via error messages',
    description: '"User not found" vs "Invalid password" leaks which emails exist.',
  },
  {
    id: 'GT-009',
    tier: 1,
    category: 'security',
    file: 'src/auth/auth.controller.ts',
    title: 'No input validation on request body',
    description: 'No length/format validation. Long passwords cause bcrypt DoS.',
  },

  // === Tier 2: Important Signal (architecture, test quality, maintainability) ===
  {
    id: 'GT-010',
    tier: 2,
    category: 'test-quality',
    file: 'test/auth.test.ts',
    title: 'Circular tests — mock both db and auth library',
    description: '8/12 tests mock everything and verify mock behavior, testing nothing real.',
  },
  {
    id: 'GT-011',
    tier: 2,
    category: 'test-quality',
    file: 'test/auth.test.ts',
    title: 'Spy-only assertions instead of value assertions',
    description: 'Tests check "was called" not "returned correct result".',
  },
  {
    id: 'GT-012',
    tier: 2,
    category: 'test-quality',
    file: 'test/auth.test.ts',
    title: 'Zero negative and edge case tests',
    description: 'No tests for empty password, SQL injection, expired token, etc.',
  },
  {
    id: 'GT-013',
    tier: 2,
    category: 'architecture',
    file: 'src/auth/auth.controller.ts',
    title: 'Business logic coupled to HTTP handler',
    description: 'Auth orchestration in controller makes logic untestable without Express.',
  },
  {
    id: 'GT-014',
    tier: 2,
    category: 'architecture',
    file: 'src/auth/auth.model.ts',
    title: 'SELECT * returns password hash to all callers',
    description: 'Over-fetching sensitive data increases exposure risk.',
  },
];
