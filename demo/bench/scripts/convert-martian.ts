import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

interface MartianPR {
  pr_title: string;
  url: string;
  original_url?: string;
  comments: Array<{ comment: string; severity: string }>;
}

interface GroundTruthJSON {
  scenario: string;
  version: string;
  source: string;
  license: string;
  language: string;
  domain: string;
  description: string;
  prs: Array<{
    title: string;
    url: string;
    entries: Array<{
      id: string;
      tier: 1 | 2;
      severity: string;
      title: string;
      description: string;
    }>;
  }>;
  stats: {
    totalPRs: number;
    totalEntries: number;
    tier1: number;
    tier2: number;
    bySeverity: Record<string, number>;
  };
}

const REPO_META: Record<string, { language: string; domain: string }> = {
  cal_dot_com: { language: 'typescript', domain: 'scheduling' },
  discourse: { language: 'ruby', domain: 'forum' },
  grafana: { language: 'go', domain: 'observability' },
  keycloak: { language: 'java', domain: 'authentication' },
  sentry: { language: 'python', domain: 'error-tracking' },
};

async function convert() {
  const sourceDir = '/tmp/martian-bench/offline/golden_comments';
  const outDir = join(process.cwd(), 'bench', 'ground-truth', 'martian');
  await mkdir(outDir, { recursive: true });

  const allStats = { totalPRs: 0, totalEntries: 0, repos: [] as string[] };

  for (const [repoKey, meta] of Object.entries(REPO_META)) {
    const raw = await readFile(join(sourceDir, `${repoKey}.json`), 'utf-8');
    const prs: MartianPR[] = JSON.parse(raw);

    let entryIndex = 1;
    const bySeverity: Record<string, number> = {};
    let tier1 = 0;
    let tier2 = 0;

    const convertedPRs = prs.map(pr => {
      const entries = pr.comments.map(c => {
        const id = `GT-${String(entryIndex++).padStart(3, '0')}`;
        const tier = (c.severity === 'Critical' || c.severity === 'High') ? 1 as const : 2 as const;
        if (tier === 1) tier1++; else tier2++;
        bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1;

        // Extract a short title from the comment (first sentence or first 100 chars)
        const firstSentence = c.comment.match(/^[^.!?]+[.!?]?/)?.[0] ?? c.comment.slice(0, 100);

        return {
          id,
          tier,
          severity: c.severity,
          title: firstSentence.length > 120 ? firstSentence.slice(0, 117) + '...' : firstSentence,
          description: c.comment,
        };
      });

      return {
        title: pr.pr_title,
        url: pr.original_url ?? pr.url,
        entries,
      };
    });

    const gt: GroundTruthJSON = {
      scenario: `martian-${repoKey.replace(/_/g, '-')}`,
      version: '1.0',
      source: 'Martian Code Review Bench (https://github.com/withmartian/code-review-benchmark)',
      license: 'MIT',
      language: meta.language,
      domain: meta.domain,
      description: `Golden comments from ${repoKey.replace(/_/g, '.')} repository (Martian benchmark)`,
      prs: convertedPRs,
      stats: {
        totalPRs: prs.length,
        totalEntries: entryIndex - 1,
        tier1,
        tier2,
        bySeverity,
      },
    };

    const outPath = join(outDir, `${repoKey}.json`);
    await writeFile(outPath, JSON.stringify(gt, null, 2));
    console.log(`✓ ${repoKey}: ${prs.length} PRs, ${entryIndex - 1} entries → ${outPath}`);

    allStats.totalPRs += prs.length;
    allStats.totalEntries += entryIndex - 1;
    allStats.repos.push(repoKey);
  }

  // Write index
  const index = {
    source: 'Martian Code Review Bench',
    license: 'MIT',
    url: 'https://github.com/withmartian/code-review-benchmark',
    convertedAt: new Date().toISOString(),
    repos: allStats.repos,
    totalPRs: allStats.totalPRs,
    totalEntries: allStats.totalEntries,
  };
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`\n✓ Index written. Total: ${allStats.totalPRs} PRs, ${allStats.totalEntries} entries`);
}

convert().catch(console.error);
