import type { LayerAnalyzer, ReviewContext, LayerResult, Finding, FileInfo } from '../types.js';

interface Rule {
  id: string;
  severity: Finding['severity'];
  category: string;
  title: string;
  description: string;
  suggestion: string;
  test: (file: FileInfo) => { match: boolean; line?: number };
}

const rules: Rule[] = [
  {
    id: 'L1-SEC-001',
    severity: 'critical',
    category: 'security',
    title: 'Hardcoded secret in configuration',
    description: 'JWT_SECRET is hardcoded in a configuration file. This value is identical to .env.example and would leak through git history.',
    suggestion: 'Use environment-specific secrets managed by a vault or secrets manager. Never commit secrets to version control.',
    test: (file) => {
      if (!file.path.includes('.env')) return { match: false };
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/^JWT_SECRET\s*=\s*.+/.test(lines[i]) && !lines[i].includes('${')) {
          return { match: true, line: i + 1 };
        }
      }
      return { match: false };
    },
  },
  {
    id: 'L1-SEC-002',
    severity: 'high',
    category: 'security',
    title: 'SQL query built with string interpolation',
    description: 'SQL queries use template literal interpolation (`${value}`) instead of parameterized queries. This is a SQL injection vector.',
    suggestion: 'Use parameterized queries: `db.query("SELECT * FROM users WHERE email = $1", [email])`',
    test: (file) => {
      if (file.classification === 'test' || file.classification === 'config') return { match: false };
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|VALUES)/i.test(line)) {
          const nearby = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
          if (/\$\{[^}]+\}/.test(nearby) && /`/.test(nearby)) {
            return { match: true, line: i + 1 };
          }
        }
      }
      return { match: false };
    },
  },
  {
    id: 'L1-SEC-003',
    severity: 'high',
    category: 'security',
    title: 'Timing-unsafe token comparison',
    description: 'Token/secret comparison uses `===` operator which is vulnerable to timing attacks. An attacker can determine the correct token character-by-character by measuring response times.',
    suggestion: 'Use `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` for comparing tokens or secrets.',
    test: (file) => {
      if (file.classification === 'test' || file.classification === 'config') return { match: false };
      if (!file.path.includes('auth') && !file.path.includes('middleware')) return { match: false };
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/===.*token|token.*===|===.*authorization|authorization.*===/i.test(line)) {
          return { match: true, line: i + 1 };
        }
      }
      return { match: false };
    },
  },
  {
    id: 'L1-SEC-004',
    severity: 'medium',
    category: 'security',
    title: 'Weak random number generator used for security token',
    description: '`Math.random()` is not cryptographically secure. Generated tokens are predictable and can be reproduced by an attacker.',
    suggestion: 'Use `crypto.randomBytes(32).toString("hex")` for generating security tokens.',
    test: (file) => {
      if (file.classification === 'test' || file.classification === 'config') return { match: false };
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/Math\.random\(\)/.test(lines[i])) {
          return { match: true, line: i + 1 };
        }
      }
      return { match: false };
    },
  },
];

export class DeterministicGate implements LayerAnalyzer {
  readonly layer = 1 as const;
  readonly name = 'Deterministic Gate';

  async analyze(context: ReviewContext): Promise<LayerResult> {
    const start = performance.now();
    const findings: Finding[] = [];

    for (const file of context.files) {
      for (const rule of rules) {
        const result = rule.test(file);
        if (result.match) {
          findings.push({
            id: rule.id,
            severity: rule.severity,
            category: rule.category,
            file: file.path,
            line: result.line,
            title: rule.title,
            description: rule.description,
            suggestion: rule.suggestion,
            layer: 1,
            confidence: 1.0,
          });
        }
      }
    }

    const durationMs = performance.now() - start;

    return {
      layer: 1,
      name: this.name,
      findings,
      metrics: { durationMs, costUsd: 0 },
    };
  }
}
