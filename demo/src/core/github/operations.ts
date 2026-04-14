import { Octokit } from '@octokit/rest';
import type { PRMetadata, ReviewReport, ScenarioConfig } from '../types.js';
import { buildPRSummaryComment, buildInlineComment } from '../reporter/markdown.js';

export class GitHubOps {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(opts: { token: string; owner: string; repo: string }) {
    this.octokit = new Octokit({ auth: opts.token });
    this.owner = opts.owner;
    this.repo = opts.repo;
  }

  async setupScenario(
    scenario: ScenarioConfig,
    fileContents: Record<string, string>
  ): Promise<PRMetadata> {
    // Get default branch SHA
    const { data: ref } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: 'heads/master',
    }).catch(() =>
      this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: 'heads/main',
      })
    );
    const baseSha = ref.object.sha;

    // Create branch (delete first if exists)
    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${scenario.branch}`,
      sha: baseSha,
    }).catch(async (err: unknown) => {
      if (err instanceof Error && 'status' in err && (err as any).status === 422) {
        await this.octokit.git.deleteRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${scenario.branch}`,
        });
        return this.octokit.git.createRef({
          owner: this.owner,
          repo: this.repo,
          ref: `refs/heads/${scenario.branch}`,
          sha: baseSha,
        });
      }
      throw err;
    });

    // Create blobs and tree
    const treeItems = await Promise.all(
      Object.entries(fileContents).map(async ([path, content]) => {
        const { data: blob } = await this.octokit.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content: Buffer.from(content).toString('base64'),
          encoding: 'base64',
        });
        return {
          path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blob.sha,
        };
      })
    );

    const { data: tree } = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseSha,
      tree: treeItems,
    });

    // Create commit
    const { data: commit } = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: `${scenario.prTitle}\n\nDemo scenario: ${scenario.name}`,
      tree: tree.sha,
      parents: [baseSha],
    });

    // Update branch ref
    await this.octokit.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${scenario.branch}`,
      sha: commit.sha,
    });

    // Create PR
    const { data: pr } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: scenario.prTitle,
      body: scenario.prBody,
      head: scenario.branch,
      base: 'master',
    }).catch(() =>
      this.octokit.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title: scenario.prTitle,
        body: scenario.prBody,
        head: scenario.branch,
        base: 'main',
      })
    );

    const linesAdded = Object.values(fileContents).reduce(
      (sum, c) => sum + c.split('\n').length,
      0
    );

    return {
      number: pr.number,
      url: pr.html_url,
      branch: scenario.branch,
      title: scenario.prTitle,
      filesChanged: Object.keys(fileContents).length,
      linesAdded,
      linesRemoved: 0,
    };
  }

  async postFindings(pr: PRMetadata, report: ReviewReport): Promise<void> {
    // Post summary comment
    const summaryBody = buildPRSummaryComment(report);
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: pr.number,
      body: summaryBody,
    });

    // Post inline comments via a review
    const inlineFindings = report.layers
      .flatMap((l) => l.findings)
      .filter((f) => f.line != null);

    if (inlineFindings.length > 0) {
      const { data: pullRequest } = await this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: pr.number,
      });

      const comments = inlineFindings.map((f) => ({
        path: f.file,
        line: f.line!,
        body: buildInlineComment(f),
      }));

      await this.octokit.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: pr.number,
        commit_id: pullRequest.head.sha,
        event: 'COMMENT' as const,
        comments,
      });
    }
  }

  async cleanup(branchName: string, prNumber: number): Promise<void> {
    await this.octokit.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      state: 'closed',
    });

    await this.octokit.git.deleteRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branchName}`,
    });
  }
}
