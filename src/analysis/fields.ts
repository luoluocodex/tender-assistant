import { extractFields } from '../sites/fields.js';
import type { Detail, FieldEvidence } from '../model.js';
import { object, string } from '../archive/config.js';

/** 历史包保留当时的字段输出；类型校验后仍受整包输入指纹保护，不用新规则改写旧包。 */
export function readStoredFields(value: unknown): Detail['fields'] {
  const v = object(value);
  const field = (raw: unknown): FieldEvidence => {
    const f = object(raw);
    if (f.status !== 'found' && f.status !== 'missing' && f.status !== 'ambiguous') throw new Error('INVALID_FIELD_STATUS');
    return { value: f.value === null ? null : string(f.value), evidence: f.evidence === null ? null : string(f.evidence), status: f.status };
  };
  const entries = (raw: unknown) => {
    if (!Array.isArray(raw)) throw new Error('INVALID_FIELD_ARRAY');
    return raw.map(value => { const row = object(value); return { kind: string(row.kind), raw: string(row.raw), evidence: string(row.evidence) }; });
  };
  return { projectId: field(v.projectId), buyer: field(v.buyer), amounts: entries(v.amounts), dates: entries(v.dates) };
}

/** 补充多行项目编号与合同甲方形式，仍引用原文，不从标题或合同编号猜项目编号。 */
export function analysisFields(text: string): Detail['fields'] {
  const fields = extractFields(text);
  const recover = (current: FieldEvidence, pattern: RegExp): FieldEvidence => {
    const values = [...text.matchAll(pattern)].flatMap(m => m[1]?.trim() ? [{ value: m[1].trim(), evidence: m[0] }] : []);
    if (current.status === 'found' && current.value && current.evidence) values.push({ value: current.value, evidence: current.evidence });
    const unique = [...new Map(values.map(v => [v.value, v])).values()];
    if (current.status === 'ambiguous' || !unique.length) return current;
    if (unique.length > 1) return { value: null, evidence: unique.map(v => v.evidence).join('\n'), status: 'ambiguous' };
    return { ...unique[0]!, status: 'found' };
  };
  fields.projectId = recover(fields.projectId, /^(?:[一二三四五六七八九十\d]+[、.．]\s*)?(?:项目编号|采购项目编号)\s*\r?\n\s*([^\r\n]+)$/gm);
  fields.buyer = recover(fields.buyer, /^采购人\s*[（(]甲方[）)]\s*[：:]\s*([^\r\n]+)$/gm);
  for (const m of text.matchAll(/合同金额[：:]\s*((?:人民币)?[¥￥]?\s*\d[\d,，]*(?:\.\d+)?\s*(?:万|亿)?元)/g)) {
    fields.amounts.push({ kind: 'contract', raw: m[1]!.trim(), evidence: m[0] });
  }
  return fields;
}
