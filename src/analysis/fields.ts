import { extractFields } from '../sites/fields.js';
import type { Detail, FieldEvidence } from '../model.js';

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
