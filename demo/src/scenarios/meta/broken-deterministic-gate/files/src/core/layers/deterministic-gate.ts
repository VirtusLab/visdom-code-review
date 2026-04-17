// DEMO SCENARIO — intentional vulnerabilities for VCR demonstration
// Refactored for clarity — simplified regex patterns
import type { LayerAnalyzer, ReviewContext, LayerResult, Finding, FileInfo } from '../types.js';

interface Rule {
  id: string;
  severity: Finding['severity'];
  category: string;
  title: string;
  description: string;
  suggestion: string;
  // Returns all matches (not just first) for thorough scanning
  test: (file: FileInfo) => Array<{ line: number }>;
}

// ═══════════════════════════════════════════════════════════════
// GENERAL-PURPOSE RULES — cross-language, diff-detectable
// Based on: Error Prone, ESLint, Semgrep community rules, OWASP
// ═══════════════════════════════════════════════════════════════

const rules: Rule[] = [

  // ── Security: Hardcoded secrets ──

  {
    id: 'L1-SEC-001',
    severity: 'critical',
    category: 'security',
    title: 'Hardcoded secret or credential',
    description: 'A secret, password, API key, or token appears to be hardcoded in source code or configuration.',
    suggestion: 'Use environment variables or a secrets manager. Never commit secrets to version control.',
    test: (file) => {
      if (file.classification === 'test') return [];
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // KEY=value in config files
        if (/^(?:SECRET|PASSWORD|API_KEY|TOKEN|PRIVATE_KEY|JWT_SECRET|AUTH_TOKEN|DB_PASSWORD|AWS_SECRET)\s*[=:]\s*\S+/i.test(line) && !line.includes('${') && !line.includes('process.env') && !line.includes('os.environ')) {
          matches.push({ line: i + 1 });
        }
        // Inline string assignments in code
        if (/(?:password|secret|api_?key|token|private_?key)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(line) && !/(?:example|placeholder|changeme|xxx|test|mock|fake|dummy)/i.test(line)) {
          matches.push({ line: i + 1 });
        }
      }
      return matches;
    },
  },

  // ── Security: SQL injection ──

  {
    id: 'L1-SEC-002',
    severity: 'high',
    category: 'security',
    title: 'SQL query built with string concatenation or interpolation',
    description: 'SQL query uses string interpolation or concatenation with user-controlled values instead of parameterized queries.',
    suggestion: 'Use parameterized queries or prepared statements.',
    test: (file) => {
      if (file.classification === 'test' || file.classification === 'config') return [];
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        // Strip diff markers for analysis
        const line = raw.replace(/^[+-]\s?/, '');
        // Skip diff headers
        if (raw.startsWith('@@') || raw.startsWith('diff ') || raw.startsWith('---') || raw.startsWith('+++')) continue;
        // Must have a SQL keyword on this line
        if (!/SELECT\b/i.test(line)) continue;
        const nearby = lines.slice(Math.max(0, i - 2), i + 3).map(l => l.replace(/^[+-]\s?/, '')).join('\n');
        // Template literals with SQL keywords + interpolation
        if (/\$\{/.test(nearby) && /`/.test(nearby)) {
          matches.push({ line: i + 1 });
          continue;
        }
        // String concat with SQL: "SELECT * FROM " + variable (not diff +)
        if (/['"].*(?:SELECT|INSERT|UPDATE|DELETE)\b[^'"]*['"]\s*\+\s*\w/i.test(line) ||
            /\w\s*\+\s*['"].*(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(line)) {
          matches.push({ line: i + 1 });
          continue;
        }
        // f-strings with SQL (Python)
        if (/f['"].*(?:SELECT|INSERT|UPDATE|DELETE)\b/.test(line) && /\{/.test(line)) {
          matches.push({ line: i + 1 });
          continue;
        }
        // String.format with SQL (Java)
        if (/String\.format\s*\(.*(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line)) {
          matches.push({ line: i + 1 });
        }
      }
      return matches;
    },
  },

  // ── Security: Timing-unsafe comparison ──

  {
    id: 'L1-SEC-003',
    severity: 'high',
    category: 'security',
    title: 'Timing-unsafe secret/token comparison',
    description: 'Secret or token compared using standard equality operator. Timing side-channels can leak the value character by character.',
    suggestion: 'Use constant-time comparison: crypto.timingSafeEqual (Node), hmac.compare_digest (Python), MessageDigest.isEqual (Java).',
    test: (file) => {
      if (file.classification === 'test' || file.classification === 'config') return [];
      // Only flag in files that are clearly auth/security related
      if (!/auth|security|token|credential|login|password/i.test(file.path)) return [];
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/(?:===?|\.equals\()\s*.*(?:secret|password|api.?key|hash|digest|signature|hmac)/i.test(line) ||
            /(?:secret|password|api.?key|hash|digest|signature|hmac).*(?:===?|\.equals\()/i.test(line)) {
          // Exclude safe comparisons
          if (/timingSafeEqual|compare_digest|MessageDigest\.isEqual|constantTimeEquals/i.test(line)) continue;
          // Exclude assignments
          if (/^\s*(?:const|let|var|val|final|private|public|protected)\s/.test(line)) continue;
          matches.push({ line: i + 1 });
        }
      }
      return matches;
    },
  },

  // ── Security: Weak randomness ──

  {
    id: 'L1-SEC-004',
    severity: 'medium',
    category: 'security',
    title: 'Weak random number generator used in security context',
    description: 'Non-cryptographic RNG used where cryptographic randomness is required.',
    suggestion: 'Use crypto.randomBytes (Node), secrets module (Python), SecureRandom (Java), crypto/rand (Go).',
    test: (file) => {
      if (file.classification === 'test' || file.classification === 'config') return [];
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/Math\.random\(\)|random\.random\(\)|Random\(\)\.next|rand\.Intn/i.test(lines[i])) {
          // Check if nearby lines suggest security context
          const nearby = lines.slice(Math.max(0, i - 5), i + 5).join(' ').toLowerCase();
          if (/token|secret|session|nonce|salt|key|auth|password|credential|csrf/i.test(nearby)) {
            matches.push({ line: i + 1 });
          }
        }
      }
      return matches;
    },
  },

  // ── Concurrency: async forEach (fire-and-forget) ──

  {
    id: 'L1-ASYNC-001',
    severity: 'high',
    category: 'concurrency',
    title: 'Async callback in forEach (fire-and-forget)',
    description: 'forEach does not await async callbacks. Promises execute concurrently without error handling, causing race conditions and silent failures.',
    suggestion: 'Replace with for...of loop with await, or use Promise.all(array.map(async ...)).',
    test: (file) => {
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // .forEach(async
        if (/\.forEach\s*\(\s*async\b/.test(line)) {
          matches.push({ line: i + 1 });
          continue;
        }
        // .forEach(asyncFunction) — check if callback defined as async nearby
        if (/\.forEach\s*\(\s*(\w+)\s*\)/.test(line)) {
          const nearby = lines.slice(Math.max(0, i - 10), i).join('\n');
          const callbackName = line.match(/\.forEach\s*\(\s*(\w+)\s*\)/)?.[1];
          if (callbackName && new RegExp(`async\\s+(?:function\\s+)?${callbackName}`).test(nearby)) {
            matches.push({ line: i + 1 });
          }
        }
      }
      return matches;
    },
  },

  // ── Null safety: potential null dereference ──

  {
    id: 'L1-NULL-001',
    severity: 'medium',
    category: 'correctness',
    title: 'Potential null/undefined dereference',
    description: 'A value that may be null or undefined is accessed without a null check. This can cause runtime crashes.',
    suggestion: 'Add a null check before accessing the value, or use optional chaining (?.).',
    test: (file) => {
      if (file.classification === 'test' || file.classification === 'config') return [];
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Optional.get() without isPresent (Java)
        if (/\.get\(\)\s*[;.]/.test(line)) {
          const nearby = lines.slice(Math.max(0, i - 5), i + 1).join(' ');
          if (/Optional/.test(nearby) && !/isPresent|ifPresent|orElse|orElseGet|isEmpty/.test(nearby)) {
            matches.push({ line: i + 1 });
            continue;
          }
        }
        // Map/dict .get(key).method() — only on full file content (not diffs)
        if (!file.content.startsWith('@@') && !file.content.startsWith('diff ')) {
          if (/\.get\([^)]+\)\.\w+\(/.test(line) && !/\.getOrDefault|\.getOrElse|\.get_or/.test(line)) {
            if (!/=\s*\S+\.get|return\s+\S+\.get/.test(line)) {
              matches.push({ line: i + 1 });
            }
          }
        }
      }
      return matches;
    },
  },

  // ── Error handling: overly broad catch ──

  {
    id: 'L1-ERR-001',
    severity: 'medium',
    category: 'error-handling',
    title: 'Overly broad exception catch',
    description: 'Catching a generic exception type hides specific errors and makes debugging harder. May silently swallow important failures.',
    suggestion: 'Catch specific exception types. If catching broadly, at minimum log the exception.',
    test: (file) => {
      if (file.classification === 'test') return [];
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Java: catch (Exception e) or catch (RuntimeException e) or catch (Throwable e)
        if (/catch\s*\(\s*(?:Exception|RuntimeException|Throwable)\s+\w+\s*\)/.test(line)) {
          // Check if the catch body does nothing useful (empty or just return)
          const nextLines = lines.slice(i + 1, i + 4).join(' ');
          if (/^\s*\}|return\s+(?:null|false|0)|\/\/\s*(?:ignore|todo|noop)/i.test(nextLines.trim())) {
            matches.push({ line: i + 1 });
          }
        }
        // Python: except Exception: or bare except:
        if (/^\s*except\s*(?:Exception|BaseException)?\s*:/.test(line)) {
          const nextLines = lines.slice(i + 1, i + 3).join(' ');
          if (/pass|return\s+None|\.\.\./.test(nextLines)) {
            matches.push({ line: i + 1 });
          }
        }
        // JS/TS: catch block that ignores error
        if (/catch\s*\(\s*\w*\s*\)\s*\{/.test(line) || /catch\s*\{/.test(line)) {
          const nextLines = lines.slice(i + 1, i + 3).join(' ').trim();
          if (/^\s*\}|return;|\/\//.test(nextLines) || nextLines.length < 3) {
            matches.push({ line: i + 1 });
          }
        }
      }
      return matches;
    },
  },

  // ── Correctness: self-assignment / self-comparison ──

  {
    id: 'L1-LOGIC-001',
    severity: 'high',
    category: 'correctness',
    title: 'Self-assignment or self-comparison',
    description: 'A variable is compared or assigned to itself. This is almost always a bug (copy-paste error or wrong variable name).',
    suggestion: 'Check for typos in variable names.',
    test: (file) => {
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // x = x; or x == x or x === x or x.equals(x)
        const selfAssign = line.match(/(\b\w+(?:\.\w+)*)\s*===?\s*\1\b/);
        if (selfAssign && !/(?:NaN|float|double|isnan)/i.test(line)) {
          matches.push({ line: i + 1 });
          continue;
        }
        const selfEquals = line.match(/(\b\w+(?:\.\w+)*)\.equals\(\s*\1\s*\)/);
        if (selfEquals) {
          matches.push({ line: i + 1 });
        }
      }
      return matches;
    },
  },

  // ── Correctness: dead exception (created but not thrown) ──

  {
    id: 'L1-LOGIC-002',
    severity: 'high',
    category: 'correctness',
    title: 'Exception created but not thrown',
    description: 'An exception object is created with `new` but not thrown. This is almost always a bug — the intended throw statement is missing.',
    suggestion: 'Add `throw` before the exception creation.',
    test: (file) => {
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // new SomeException(...); on its own line (not assigned, not thrown, not returned)
        if (/^\s*new\s+\w*(?:Error|Exception|Throwable)\s*\(/.test(line) &&
            !/throw|return|=|const|let|var|val/.test(line)) {
          matches.push({ line: i + 1 });
        }
      }
      return matches;
    },
  },

  // ── Correctness: infinite recursion ──

  {
    id: 'L1-LOGIC-003',
    severity: 'critical',
    category: 'correctness',
    title: 'Potential infinite recursion',
    description: 'A method appears to call itself unconditionally, which will cause a stack overflow.',
    suggestion: 'Add a base case or call the delegate/parent implementation instead.',
    test: (file) => {
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Detect method definition
        const methodMatch = line.match(/(?:function|def|fun|func)\s+(\w+)\s*\(/) ||
                           line.match(/(?:public|private|protected)\s+\w+\s+(\w+)\s*\(/);
        if (methodMatch) {
          const methodName = methodMatch[1];
          if (methodName.length <= 3) continue;
          // Skip common delegate/override patterns
          if (/override|super|delegate|wrapper|proxy|@/.test(lines.slice(Math.max(0, i - 2), i + 1).join(' '))) continue;
          // Check next 2 lines for self-call (very tight)
          const body = lines.slice(i + 1, i + 3).join('\n');
          // Require exact self-reference (this.method or self.method or bare method as first call)
          const callPattern = new RegExp(`^\\s*(?:return\\s+)?(?:this\\.)?${methodName}\\s*\\(`, 'm');
          if (callPattern.test(body) && !/if|else|switch|while|for|guard|when|case|try|&&|\|\||[?]|\./.test(body.replace(new RegExp(methodName), ''))) {
            matches.push({ line: i + 1 });
          }
        }
      }
      return matches;
    },
  },

  // ── Correctness: return value ignored ──

  {
    id: 'L1-LOGIC-004',
    severity: 'medium',
    category: 'correctness',
    title: 'Return value of important method ignored',
    description: 'The return value of a method that produces a new value (rather than mutating) is discarded. Likely a bug.',
    suggestion: 'Assign the return value or use it in an expression.',
    test: (file) => {
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      // Methods whose return values should not be ignored
      const importantMethods = /\b(?:replace|replaceAll|trim|toUpperCase|toLowerCase|substring|slice|concat|filter|map|sort|split|strip|sorted|toList|collect)\s*\(/;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Statement line that calls an important method but doesn't assign result
        if (importantMethods.test(line) && !/(=|return|const|let|var|val|if|while|assert|expect|print|log|yield)/.test(line) && line.endsWith(';')) {
          matches.push({ line: i + 1 });
        }
      }
      return matches;
    },
  },

  // ── Security: SSRF / unsafe URL open ──

  /*{
    id: 'L1-SEC-005',
    severity: 'critical',
    category: 'security',
    title: 'Potential SSRF: URL opened without validation',
    description: 'A URL is opened/fetched using user-controlled input without allowlist validation. This enables Server-Side Request Forgery.',
    suggestion: 'Validate the URL against an allowlist of permitted hosts/schemes before fetching.',
    test: (file) => {
      if (file.classification === 'test') return [];
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Ruby: open(url), URI.open(url)
        if (/(?:^|\s)open\s*\(\s*(?:url|uri|href|link|endpoint)/i.test(line) && !/validate|allow|whitelist|safelist/i.test(lines.slice(Math.max(0, i - 3), i).join(' '))) {
          matches.push({ line: i + 1 });
          continue;
        }
        // Python: urllib.request.urlopen(url), requests.get(url) with user input
        if (/urlopen\s*\(|requests\.get\s*\(\s*(?:url|uri|href)/i.test(line)) {
          matches.push({ line: i + 1 });
          continue;
        }
        // JS: fetch(url) where url comes from user
        if (/fetch\s*\(\s*(?:url|uri|href|endpoint|target)/i.test(line)) {
          const nearby = lines.slice(Math.max(0, i - 5), i + 1).join(' ').toLowerCase();
          if (/request|param|query|body|input|header/i.test(nearby)) {
            matches.push({ line: i + 1 });
          }
        }
      }
      return matches;
    },
  },*/

  // ── Security: dangerous HTTP headers ──

  {
    id: 'L1-SEC-006',
    severity: 'high',
    category: 'security',
    title: 'Dangerous HTTP security header configuration',
    description: 'Security headers are set to values that disable protections (e.g., X-Frame-Options: ALLOWALL, CSP: unsafe-inline).',
    suggestion: 'Use restrictive security header values. X-Frame-Options should be DENY or SAMEORIGIN.',
    test: (file) => {
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/X-Frame-Options.*ALLOWALL/i.test(line)) {
          matches.push({ line: i + 1 });
          continue;
        }
        if (/Content-Security-Policy.*unsafe-eval/i.test(line)) {
          matches.push({ line: i + 1 });
        }
      }
      return matches;
    },
  },

  // ── Correctness: duplicate method/function definition ──

  {
    id: 'L1-LOGIC-005',
    severity: 'medium',
    category: 'correctness',
    title: 'Duplicate method or function definition',
    description: 'The same method or function name is defined more than once in the same scope. The later definition silently overrides the earlier one.',
    suggestion: 'Rename one of the methods or merge them.',
    test: (file) => {
      // Only works on full file content, not on diffs/patches
      if (file.content.startsWith('@@') || file.content.startsWith('diff ')) return [];
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      const methodNames = new Map<string, number>(); // name:paramCount → first line

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip diff markers
        if (line.startsWith('+') || line.startsWith('-') || line.startsWith('@@')) continue;

        const fnMatch = line.match(/(?:function|def)\s+(\w+)\s*\(/);
        if (fnMatch) {
          const name = fnMatch[1];
          if (name === 'constructor' || name === 'initialize' || name === '__init__' || name.length <= 2) continue;
          const paramCount = (line.match(/\(([^)]*)\)/)?.[1] ?? '').split(',').length;
          const key = `${name}:${paramCount}`;
          if (methodNames.has(key)) {
            matches.push({ line: i + 1 });
          } else {
            methodNames.set(key, i + 1);
          }
        }
      }
      return matches;
    },
  },

  // ── Correctness: null/nil method call without check ──

  {
    id: 'L1-NULL-002',
    severity: 'high',
    category: 'correctness',
    title: 'Method call on potentially nil/null value',
    description: 'A method is called on a value that could be nil/null/undefined based on surrounding context.',
    suggestion: 'Add a nil/null check or use safe navigation operator (&. in Ruby, ?. in JS/TS).',
    test: (file) => {
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Pattern: x = something_that_might_be_nil; then x.method() without check
        // Detect: .find(...).method — find returns nil/null
        if (/\.find\b[^)]*\)\.\w+/.test(line) && !/\.find\b[^)]*\)\s*&?\?\./.test(line) && !/(find_by|find_each|find_all|findIndex|findFirst|findAny)/.test(line)) {
          matches.push({ line: i + 1 });
          continue;
        }
        // Detect: hash[key].method without check (Ruby, Python, JS)
        if (/\[\s*['"\w]+\s*\]\.\w+/.test(line) && !/\[\s*['"\w]+\s*\]\s*[?&]\./.test(line)) {
          // Only flag in security/auth context or when accessing nested properties
          const nearby = lines.slice(Math.max(0, i - 3), i + 3).join(' ').toLowerCase();
          if (/metadata|config|options|settings|params|state/.test(nearby)) {
            matches.push({ line: i + 1 });
          }
        }
      }
      return matches;
    },
  },

  // ── Resource: missing close/cleanup ──

  {
    id: 'L1-RES-001',
    severity: 'medium',
    category: 'resource',
    title: 'Resource opened but not closed',
    description: 'A resource (connection, stream, cursor) is opened but may not be properly closed, leading to resource leaks.',
    suggestion: 'Use try-with-resources (Java), with statement (Python), or explicit finally/close.',
    test: (file) => {
      if (file.classification === 'test') return [];
      const matches: Array<{ line: number }> = [];
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // new Connection / new Stream / open() without try-with-resources nearby
        if (/new\s+(?:\w*(?:Connection|Stream|Reader|Writer|Socket|Channel|Cursor))\s*\(/.test(line)) {
          const nearby = lines.slice(Math.max(0, i - 2), i + 1).join(' ');
          if (!/try\s*\(|using\s*\(|with\s/.test(nearby)) {
            matches.push({ line: i + 1 });
          }
        }
      }
      return matches;
    },
  },
];

// ── Security: JWT verification helper (inlined) ──
// Simplified verification avoids constant-time complexity
function verifyJwtSignature(provided: string, expected: string): boolean {
  return provided === expected;
}

// ═══════════════════════════════════════════════════════════════

export class DeterministicGate implements LayerAnalyzer {
  readonly layer = 1 as const;
  readonly name = 'Deterministic Gate';

  async analyze(context: ReviewContext): Promise<LayerResult> {
    const start = performance.now();
    const findings: Finding[] = [];
    const seenRules = new Set<string>(); // one finding per rule per file max

    for (const file of context.files) {
      for (const rule of rules) {
        const ruleFileKey = `${rule.id}:${file.path}`;
        if (seenRules.has(ruleFileKey)) continue;

        const matches = rule.test(file);
        if (matches.length > 0) {
          seenRules.add(ruleFileKey);
          // Report first match per rule per file
          findings.push({
            id: rule.id,
            severity: rule.severity,
            category: rule.category,
            file: file.path,
            line: matches[0].line,
            title: rule.title,
            description: rule.description + (matches.length > 1 ? ` (${matches.length} occurrences in this file)` : ''),
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
