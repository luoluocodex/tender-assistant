import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256 } from '../store/files.js';
import { object, string } from '../archive/config.js';
import type { Company } from './contract.js';
import type { Evidence, Notice, Packet, RuleConfig } from './model.js';
import { decide } from './rules.js';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, val: unknown) => val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val);
}

export async function readRules(project: string): Promise<RuleConfig> {
  const base = object(JSON.parse(await readFile(resolve(project, 'config/p0-baseline.json'), 'utf8')));
  const business = object(base.business); const region = object(base.region);
  if (!Array.isArray(business.keywords) || business.keywords.length !== 1 || !Array.isArray(business.excludeKeywords)) throw new Error('P3_REQUIRES_SINGLE_CONFIRMED_KEYWORD');
  const data = { keyword: string(business.keywords[0]), region: string(region.province), excludeKeywords: business.excludeKeywords.map(string) };
  if (data.region !== '广东省') throw new Error('UNSUPPORTED_REGION_RULE');
  const implementation = await Promise.all(['rules', 'source', 'fields', 'packets', 'validation', 'contract'].map(name => readFile(new URL(`./${name}.js`, import.meta.url), 'utf8')));
  return { version: `p3-v1-${sha256(JSON.stringify({ data, implementation })).slice(0, 12)}`, ...data };
}
export async function readPrompts(project: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(['relevance', 'summary', 'qualification'].map(async name => [name, await readFile(resolve(project, `prompts/${name}.md`), 'utf8')])));
}
function evidence(n: Notice, company: Company | null): Evidence[] {
  const values: Evidence[] = [];
  const add = (kind: Evidence['kind'], locator: string, text: string, sourceHash: string) => {
    // 完整分块而非静默截断；原始文件通过 sourceHash + locator 回溯。
    for (let offset = 0; offset < text.length; offset += 4000) {
      const chunk = text.slice(offset, offset + 4000); if (!chunk.trim()) continue;
      values.push({ id: `${kind}-${values.length + 1}`, kind, locator: `${locator}:chars-${offset}-${offset + chunk.length}`,
        text: chunk, sha256: sha256(chunk), sourceHash });
    }
  };
  add('title', 'listing.title', n.listing.title, n.version);
  n.text.split(/\r?\n\s*\r?\n/).forEach((text, i) => add('body', `body.paragraph-${i + 1}`, text, sha256(n.text)));
  for (const f of n.attachments) for (const unit of f.units) add('attachment', `${f.name}:${unit.locator}`, unit.text, f.sha256);
  for (const fact of company?.facts ?? []) add('company', fact.id, fact.text, sha256(JSON.stringify(fact)));
  return values;
}
/** 提示词、规则、公司资料、公告和附件任何变化都会生成新的输入指纹。 */
export function makePacket(n: Notice, rules: RuleConfig, prompts: Record<string, string>, company: Company | null = null, tracked = false): Packet {
  const ev = evidence(n, company); const promptVersion = `p3-v1-${sha256(JSON.stringify(prompts)).slice(0, 12)}`;
  const companyVersion = company ? `${company.version}-${sha256(JSON.stringify(company)).slice(0, 12)}` : 'not-provided';
  const count = n.attachmentCount;
  const mentionsMissing = /\.(?:pdf|docx?|xlsx?|zip)\b|附件名称\s*\d|以采购需求书为准|详见附件|见需求书/.test(n.text);
  const coverage = { body: n.completeness, attachments: count === null ? 'unknown' : count === 0 ? (mentionsMissing ? 'mentioned-but-not-indexed' : 'none-listed') :
    n.attachments.length === count && n.attachments.every(f => f.status === 'parsed') ? 'all-listed-parsed-not-content-certified' : 'partial-or-not-downloaded', scope: 'selected-notice-only' as const };
  const content = { schemaVersion: 1 as const, notice: n, rules, decision: decide(n, rules, tracked), prompts,
    promptVersion, company, companyVersion, evidence: ev, coverage };
  const inputHash = sha256(canonicalJson(content));
  return { ...content, packetId: `p3-${inputHash.slice(0, 24)}`, inputHash };
}
/** 从内存快照再计算指纹，防止被修改的包继续接受历史模型结果。 */
export function verifyPacket(packet: Packet): void {
  const rebuilt = makePacket(packet.notice, packet.rules, packet.prompts, packet.company, packet.decision.tracked);
  if (canonicalJson(rebuilt) !== canonicalJson(packet)) throw new Error('PACKET_INTEGRITY_FAILURE');
}
