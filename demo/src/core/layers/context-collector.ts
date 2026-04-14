import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LayerAnalyzer, ReviewContext, LayerResult, FileInfo } from '../types.js';

export class ContextCollector implements LayerAnalyzer {
  readonly layer = 0 as const;
  readonly name = 'Context Collection';

  async analyze(context: ReviewContext): Promise<LayerResult> {
    const start = performance.now();

    for (const file of context.files) {
      file.classification = classifyFile(file.path);
    }

    context.diff = generateDiff(context.files);

    const durationMs = performance.now() - start;

    return {
      layer: 0,
      name: this.name,
      findings: [],
      metrics: { durationMs, costUsd: 0 },
    };
  }
}

function classifyFile(path: string): FileInfo['classification'] {
  if (path.startsWith('test/') || path.includes('.test.') || path.includes('.spec.')) {
    return 'test';
  }
  if (path.startsWith('.env') || path.endsWith('.config.ts') || path.endsWith('.json')) {
    return 'config';
  }
  if (
    path.includes('/auth/') ||
    path.includes('/middleware/') ||
    path.includes('security') ||
    path.includes('crypto')
  ) {
    return 'critical';
  }
  return 'standard';
}

function generateDiff(files: FileInfo[]): string {
  const lines: string[] = [];
  for (const file of files) {
    lines.push(`diff --git a/${file.path} b/${file.path}`);
    lines.push('new file mode 100644');
    lines.push(`--- /dev/null`);
    lines.push(`+++ b/${file.path}`);
    const contentLines = file.content.split('\n');
    lines.push(`@@ -0,0 +1,${contentLines.length} @@`);
    for (const line of contentLines) {
      lines.push(`+${line}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function loadScenarioFiles(scenarioDir: string, fileMap: Record<string, string>): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  for (const [prPath, localRelPath] of Object.entries(fileMap)) {
    const fullPath = join(scenarioDir, localRelPath);
    const content = await readFile(fullPath, 'utf-8');
    files.push({
      path: prPath,
      content,
      classification: 'standard',
      linesChanged: content.split('\n').length,
    });
  }
  return files;
}
