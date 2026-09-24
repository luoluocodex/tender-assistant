import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RunConfig } from '../model.js';
import { validateQueryDays } from './window.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须为 JSON 对象');
  return value as Record<string, unknown>;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`无效配置 ${name}`);
  return value;
}

/** 读取基线默认值和可选 --days；天数为 1～90，错误在创建任务及访问网站前抛出。 */
export async function loadConfig(root: string, daysOverride?: string): Promise<RunConfig> {
  const read = async (path: string): Promise<Record<string, unknown>> => object(JSON.parse(await readFile(resolve(root, path), 'utf8')));
  const p1 = await read('config/p1.json');
  if (typeof p1.baselineFile !== 'string' || typeof p1.sitesFile !== 'string') throw new Error('配置文件路径缺失');
  const baseline = await read(p1.baselineFile);
  const business = object(baseline.business);
  const keywords = business.keywords;
  if (!Array.isArray(keywords) || keywords.length !== 1 || typeof keywords[0] !== 'string' || !keywords[0].trim()) throw new Error('P1 要求一个已确认关键词');
  const operation = object(baseline.operation);
  if (operation.trigger !== 'manual' || operation.externalSendingEnabled !== false || operation.recurringScheduleEnabled !== false) throw new Error('P1 仅支持手动、无外部发送');
  const range = object(baseline.dateRange);
  if (range.timezone !== 'Asia/Shanghai' || range.mode !== 'calendar-days-including-today') throw new Error('P1 日期口径与已确认基线不一致');
  const defaultDays = validateQueryDays(range.days);
  const days = daysOverride === undefined ? defaultDays : validateQueryDays(/^\d+$/.test(daysOverride) ? Number(daysOverride) : NaN);
  if (object(baseline.region).province !== '广东省') throw new Error('P1 仅实现广东省筛选');
  if (p1.headless !== false) throw new Error('P1 尚未验收无头模式');
  if (p1.outputDir !== 'output/playwright') throw new Error('P1 证据位置必须为 output/playwright');
  const sourceConfig = await read(p1.sitesFile);
  if (!Array.isArray(sourceConfig.sources)) throw new Error('站点配置缺失');
  const sites = sourceConfig.sources.map((item: unknown) => {
    const source = object(item);
    if (typeof source.id !== 'string' || typeof source.entryUrl !== 'string') throw new Error('站点字段缺失');
    const expected = source.id === 'ccgp' ? 'www.ccgp.gov.cn' : source.id === 'guangdong-public-resources' ? 'ygp.gdzwfw.gov.cn' : null;
    if (!expected || new URL(source.entryUrl).hostname !== expected) throw new Error('站点入口超出已验证适配器范围');
    return { id: source.id, entryUrl: source.entryUrl };
  });
  return {
    keyword: keywords[0], days, sites, outputDir: resolve(root, p1.outputDir), headless: false,
    maxPages: integer(p1.maxPages, 'maxPages', 1, 200),
    maxDetailsPerSite: integer(p1.maxDetailsPerSite, 'maxDetailsPerSite', 1, 30),
    minIntervalMs: integer(p1.minIntervalMs, 'minIntervalMs', 1000, 60000),
    navigationTimeoutMs: integer(p1.navigationTimeoutMs, 'navigationTimeoutMs', 5000, 60000),
    actionTimeoutMs: integer(p1.actionTimeoutMs, 'actionTimeoutMs', 1000, 30000),
    maxRunMinutes: integer(p1.maxRunMinutes, 'maxRunMinutes', 1, 60),
  };
}
