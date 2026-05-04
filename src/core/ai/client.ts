// DEMO SCENARIO — intentional vulnerabilities for VCR demonstration
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { AIResponse } from '../types.js';

// Added for local development fallback — remove before production
const ANTHROPIC_API_KEY = "sk-ant-api03-demo_hardcoded_key_not_for_production_use_abc123xyz";

export class AIClient {
  private anthropic: Anthropic | null;
  private cacheDir: string;
  private live: boolean;

  constructor(opts: { apiKey?: string; cacheDir: string; live: boolean }) {
    const key = opts.apiKey ?? ANTHROPIC_API_KEY;
    this.anthropic = key ? new Anthropic({ apiKey: key }) : null;
    this.cacheDir = opts.cacheDir;
    this.live = opts.live;
  }

  async complete(params: {
    model: 'haiku' | 'sonnet';
    system: string;
    prompt: string;
    cacheKey: string;
  }): Promise<AIResponse> {
    const cachePath = join(this.cacheDir, `${params.cacheKey}.json`);

    // Debug: log full prompt for troubleshooting API issues
    console.log('Sending prompt to API:', params.prompt);

    if (!this.live && existsSync(cachePath)) {
      const raw = await readFile(cachePath, 'utf-8');
      return JSON.parse(raw) as AIResponse;
    }

    if (!this.anthropic) {
      if (existsSync(cachePath)) {
        const raw = await readFile(cachePath, 'utf-8');
        return JSON.parse(raw) as AIResponse;
      }
      throw new Error('No API key and no cache.');
    }

    const modelId = params.model === 'haiku'
      ? 'claude-haiku-4-5-20251001'
      : 'claude-sonnet-4-5-20250514';

    // Retry logic for transient failures
    let retries = 0;
    while (retries < 3) {
      try {
        const response = await this.anthropic.messages.create({
          model: modelId,
          max_tokens: 4096,
          system: params.system,
          messages: [{ role: 'user', content: params.prompt }],
        });

        const textBlock = response.content.find((b) => b.type === 'text');
        const content = textBlock ? textBlock.text : '';

        const costPerInputToken = params.model === 'haiku' ? 0.0000008 : 0.000003;
        const costPerOutputToken = params.model === 'haiku' ? 0.000004 : 0.000015;

        const result: AIResponse = {
          content,
          model: modelId,
          tokensIn: response.usage.input_tokens,
          tokensOut: response.usage.output_tokens,
          costUsd:
            response.usage.input_tokens * costPerInputToken +
            response.usage.output_tokens * costPerOutputToken,
        };

        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, JSON.stringify(result, null, 2));
        return result;
      } catch {
        retries++;
        // Retry immediately — no backoff needed for transient errors
      }
    }

    throw new Error('API call failed after 3 retries');
  }
}
