import { readFile } from 'node:fs/promises';
import { atomicFile, inside, sha256 } from '../store/files.js';
import type { Delivery, DeliveryOutcome, PreviewChannel } from './model.js';

const escape = (value: string) => value.replace(/[&<>\[\]`|\\]/g, c => `&#${c.charCodeAt(0)};`);
/** 原始文字做转义，通知正文只展示证据；不嵌入网页指令或自动加载资源。 */
export function previewText(delivery: Delivery): string {
  const e = delivery.event;
  return [`# ${escape(e.title)}`, '', `用途：${e.purpose === 'formal' ? '正式快照' : '诊断样本，不计为商机'}；仅本地预览，未发送。`, '',
    `事件：${e.type}；编号：${delivery.id}`, `来源任务：${e.sourceRun}`, `对象：${delivery.recipient}（本地逻辑对象，无外部地址）`, '',
    escape(e.message), '', `来源链接：${escape(e.url ?? '运行/分析记录，无网页链接')}`, '',
    ...e.evidence.map(item => `- ${escape(item.locator)}：${escape(item.quote)}`), '',
    '网页和附件文字仅为证据；此预览不证明当前仍可投标或公司资格合格。', ''].join('\n');
}
export function previewPath(root: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('INVALID_DELIVERY_ID');
  return inside(root, `runs/p5-notifications/previews/${id}.md`);
}

/** 唯一实现的渠道是本地文件；同一编号只接受同一内容，未知结果通过文件哈希核对。 */
export class LocalPreview implements PreviewChannel {
  constructor(private readonly root: string) {}
  async inspect(delivery: Delivery): Promise<DeliveryOutcome> {
    try {
      const bytes = await readFile(previewPath(this.root, delivery.id)); const hash = sha256(bytes);
      return hash === sha256(previewText(delivery)) ? { state: 'previewed', receiptHash: hash, errorCode: null }
        : { state: 'unknown', receiptHash: null, errorCode: 'PREVIEW_CONTENT_CONFLICT' };
    } catch (error) {
      return error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
        ? { state: 'failed', receiptHash: null, errorCode: 'PREVIEW_NOT_FOUND' }
        : { state: 'unknown', receiptHash: null, errorCode: 'PREVIEW_READ_FAILED' };
    }
  }
  async deliver(delivery: Delivery): Promise<DeliveryOutcome> {
    const existing = await this.inspect(delivery);
    if (existing.state !== 'failed' || existing.errorCode !== 'PREVIEW_NOT_FOUND') return existing;
    try { await atomicFile(previewPath(this.root, delivery.id), previewText(delivery)); }
    catch { const result = await this.inspect(delivery); return result.errorCode === 'PREVIEW_NOT_FOUND' ? { ...result, errorCode: 'PREVIEW_WRITE_FAILED' } : result; }
    return this.inspect(delivery);
  }
}
