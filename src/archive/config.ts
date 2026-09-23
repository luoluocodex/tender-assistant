import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { ArchiveConfig } from './model.js';

/** 配置与报告是数据，先验证类型和范围再使用。 */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要 JSON 对象');
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('缺少非空字符串');
  return value;
}
/** 运行数据和源码分开；不允许把数据根目录设为磁盘根或源码目录。 */
export async function archiveConfig(project: string): Promise<ArchiveConfig> {
  const raw = object(JSON.parse(await readFile(resolve(project, 'config/p2.json'), 'utf8')));
  const runtimeRoot = resolve(string(raw.runtimeRoot));
  if (!isAbsolute(string(raw.runtimeRoot)) || runtimeRoot.length < 12 || runtimeRoot.toLowerCase().startsWith(resolve(project).toLowerCase())) throw new Error('P2 数据目录必须独立于源码');
  if (raw.retention !== 'keep-until-manual-review-no-automatic-deletion') throw new Error('保留策略未确认');
  const number = (key: string, min: number, max: number): number => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`无效 P2 配置：${key}`);
    return value;
  };
  if (!Array.isArray(raw.sources)) throw new Error('来源配置缺失');
  const sources = raw.sources.map(value => {
    const s = object(value); const origin = string(s.origin); const u = new URL(origin);
    if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin || !u.hostname.endsWith('.gov.cn')) throw new Error('附件来源必须是已登记政府域名');
    const pathPrefix = string(s.pathPrefix); if (!pathPrefix.startsWith('/')) throw new Error('来源路径无效');
    return { id: string(s.id), origin, pathPrefix };
  });
  return { runtimeRoot, sources, minIntervalMs: number('minIntervalMs', 3000, 60000), maxFiles: number('maxFiles', 1, 30),
    maxFileBytes: number('maxFileBytes', 1024, 104857600), timeoutMs: number('timeoutMs', 1000, 120000),
    parseTimeoutMs: number('parseTimeoutMs', 1000, 120000), maxRunMinutes: number('maxRunMinutes', 1, 60),
    maxZipEntries: number('maxZipEntries', 1, 1000), maxExpandedBytes: number('maxExpandedBytes', 1024, 209715200), maxArchiveDepth: number('maxArchiveDepth', 0, 3) };
}
