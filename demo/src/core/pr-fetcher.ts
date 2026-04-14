import { Octokit } from '@octokit/rest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { FileInfo, PRMetadata } from './types.js';

export interface FetchedPR {
  meta: PRMetadata;
  files: FileInfo[];
  diff: string;
}

export class PRFetcher {
  private octokit: Octokit;
  private cacheDir: string;

  constructor(opts: { token: string; cacheDir: string }) {
    this.octokit = new Octokit({ auth: opts.token });
    this.cacheDir = opts.cacheDir;
  }

  async fetch(prUrl: string): Promise<FetchedPR> {
    // Parse owner/repo/number from URL
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) throw new Error(`Invalid PR URL: ${prUrl}`);
    const [, owner, repo, numStr] = match;
    const number = parseInt(numStr, 10);

    // Check cache
    const cacheKey = `${owner}-${repo}-${number}`;
    const cachePath = join(this.cacheDir, `${cacheKey}.json`);
    if (existsSync(cachePath)) {
      const raw = await readFile(cachePath, 'utf-8');
      return JSON.parse(raw) as FetchedPR;
    }

    // Fetch PR metadata
    const { data: pr } = await this.octokit.pulls.get({ owner, repo, pull_number: number });

    // Fetch changed files (up to 100)
    const { data: prFiles } = await this.octokit.pulls.listFiles({
      owner, repo, pull_number: number, per_page: 100,
    });

    const files: FileInfo[] = [];
    const diffLines: string[] = [];

    for (const f of prFiles) {
      // Use the patch (diff) from the API
      if (f.patch) {
        diffLines.push(`diff --git a/${f.filename} b/${f.filename}`);
        diffLines.push(`--- a/${f.filename}`);
        diffLines.push(`+++ b/${f.filename}`);
        diffLines.push(f.patch);
        diffLines.push('');
      }

      // Fetch file content for analysis (best-effort)
      let content = '';
      try {
        if (f.status !== 'removed' && (f.additions + f.changes) > 0) {
          const { data } = await this.octokit.repos.getContent({
            owner, repo, path: f.filename, ref: pr.head.sha,
          });
          if ('content' in data && data.encoding === 'base64') {
            content = Buffer.from(data.content, 'base64').toString('utf-8');
          }
        }
      } catch {
        // File might not exist at head (force-pushed, rebased, etc)
        content = f.patch ?? '';
      }

      files.push({
        path: f.filename,
        content: content || f.patch || '',
        classification: 'standard',
        linesChanged: f.additions + f.deletions,
      });
    }

    const result: FetchedPR = {
      meta: {
        number,
        url: pr.html_url,
        branch: pr.head.ref,
        title: pr.title,
        filesChanged: prFiles.length,
        linesAdded: prFiles.reduce((s, f) => s + f.additions, 0),
        linesRemoved: prFiles.reduce((s, f) => s + f.deletions, 0),
      },
      files,
      diff: diffLines.join('\n'),
    };

    // Cache
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(result));

    return result;
  }
}
