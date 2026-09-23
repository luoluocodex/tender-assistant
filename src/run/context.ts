import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from 'playwright';
import type { QueryWindow, RunConfig } from '../model.js';

/** 统一证据输出和低频节流；每次使用新目录，不覆盖旧证据。 */
export class RunContext {
  readonly startedAt = new Date();
  readonly directory: string;
  cancelled = false;
  private sequence = 0;
  private lastAction = 0;

  constructor(readonly config: RunConfig, readonly window: QueryWindow, readonly purpose: 'formal' | 'diagnostic') {
    const id = `${this.startedAt.toISOString().replace(/[:.]/g, '-')}-${purpose}`;
    this.directory = join(config.outputDir, id);
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async pause(): Promise<void> {
    this.check();
    await delay(Math.max(0, this.config.minIntervalMs - (Date.now() - this.lastAction)));
    this.check();
    this.lastAction = Date.now();
  }

  check(): void {
    if (this.cancelled) throw new Error('运行已取消');
    if (Date.now() - this.startedAt.getTime() > this.config.maxRunMinutes * 60000) throw new Error('达到运行时间上限');
  }

  async json(name: string, value: unknown): Promise<string> {
    const path = join(this.directory, `${name}.json`);
    await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
    return path;
  }

  async log(event: string, fields: Record<string, unknown> = {}): Promise<void> {
    const record = { time: new Date().toISOString(), event, ...fields };
    await appendFile(join(this.directory, 'events.jsonl'), JSON.stringify(record) + '\n', 'utf8');
    console.log(JSON.stringify(record));
  }

  /** 只用于本轮无登录的公开页面；不保存浏览器存储或请求头。 */
  async evidence(page: Page, label: string): Promise<string[]> {
    const prefix = `${String(++this.sequence).padStart(3, '0')}-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const files: string[] = [];
    if (page.isClosed()) return files;
    for (const format of ['txt', 'html', 'png'] as const) {
      const path = join(this.directory, `${prefix}.${format}`);
      try {
        if (format === 'png') await page.screenshot({ path, fullPage: true, timeout: 15000 });
        else await writeFile(path, format === 'txt' ? await page.locator('body').innerText() : await page.content(), 'utf8');
        files.push(path);
      } catch { await this.log('evidence-unavailable', { label, format }); }
    }
    return files;
  }
}
