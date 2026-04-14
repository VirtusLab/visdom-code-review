import { createInterface } from 'node:readline';
import chalk from 'chalk';

export type PaceMode = 'auto' | 'interactive' | 'none';

const AUTO_DELAY_MS = 2500;
const AUTO_DELAY_SHORT_MS = 1200;

export class Narrator {
  readonly mode: PaceMode;
  private rl: ReturnType<typeof createInterface> | null = null;

  constructor(mode: PaceMode) {
    this.mode = mode;
    if (mode === 'interactive') {
      this.rl = createInterface({ input: process.stdin, output: process.stdout });
    }
  }

  async narrate(text: string): Promise<void> {
    if (this.mode === 'none') return;

    // Print narration in a distinct style
    for (const line of text.split('\n')) {
      console.log(chalk.italic.hex('#a78bfa')(`  ${line}`));
    }
    console.log('');

    await this.pace();
  }

  async heading(text: string): Promise<void> {
    if (this.mode === 'none') return;

    console.log('');
    console.log(chalk.bold.hex('#818cf8')(`  ── ${text} ──`));
    console.log('');

    await this.pace();
  }

  async showCode(filename: string, content: string, highlightLines?: number[]): Promise<void> {
    if (this.mode === 'none') return;

    console.log(chalk.dim(`  ┌─ ${filename}`));
    const lines = content.split('\n');
    const maxLines = 25; // show first 25 lines max
    const displayLines = lines.slice(0, maxLines);
    for (let i = 0; i < displayLines.length; i++) {
      const lineNum = String(i + 1).padStart(3, ' ');
      const highlight = highlightLines?.includes(i + 1);
      if (highlight) {
        console.log(chalk.bgHex('#7c3aed').white(`  │${lineNum}│ ${displayLines[i]}`));
      } else {
        console.log(chalk.dim(`  │${lineNum}│`) + ` ${displayLines[i]}`);
      }
    }
    if (lines.length > maxLines) {
      console.log(chalk.dim(`  │   │ ... (${lines.length - maxLines} more lines)`));
    }
    console.log(chalk.dim(`  └──`));
    console.log('');

    await this.paceShort();
  }

  async challenge(text: string): Promise<void> {
    if (this.mode === 'none') return;

    console.log('');
    console.log(chalk.bold.yellow(`  ❓ ${text}`));
    console.log('');

    await this.paceLong();
  }

  async reveal(text: string): Promise<void> {
    if (this.mode === 'none') return;

    console.log(chalk.bold.green(`  → ${text}`));
    console.log('');

    await this.paceShort();
  }

  async separator(): Promise<void> {
    if (this.mode === 'none') return;
    console.log(chalk.dim('  ' + '─'.repeat(56)));
    console.log('');
  }

  private async pace(): Promise<void> {
    if (this.mode === 'auto') {
      await sleep(AUTO_DELAY_MS);
    } else if (this.mode === 'interactive') {
      await this.waitForEnter();
    }
  }

  private async paceShort(): Promise<void> {
    if (this.mode === 'auto') {
      await sleep(AUTO_DELAY_SHORT_MS);
    } else if (this.mode === 'interactive') {
      await this.waitForEnter();
    }
  }

  private async paceLong(): Promise<void> {
    if (this.mode === 'auto') {
      await sleep(AUTO_DELAY_MS * 2);
    } else if (this.mode === 'interactive') {
      await this.waitForEnter();
    }
  }

  private waitForEnter(): Promise<void> {
    return new Promise((resolve) => {
      process.stdout.write(chalk.dim('  [Enter] '));
      this.rl!.once('line', () => resolve());
    });
  }

  close(): void {
    this.rl?.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
