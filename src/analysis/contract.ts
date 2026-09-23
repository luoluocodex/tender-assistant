import { object } from '../archive/config.js';

/** 同一份声明同时产生运行时校验和 JSON Schema，拒绝未知字段。 */
interface Contract<T> { schema: Record<string, unknown>; parse(value: unknown): T }
export function text(maxLength = 4000): Contract<string> {
  return { schema: { type: 'string', minLength: 1, maxLength }, parse(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error('INVALID_TEXT');
    return value;
  } };
}
export function choice<const T extends readonly string[]>(...values: T): Contract<T[number]> {
  return { schema: { type: 'string', enum: values }, parse(value) {
    if (typeof value !== 'string' || !values.includes(value)) throw new Error('INVALID_ENUM');
    return value;
  } };
}
export function array<T>(item: Contract<T>, minItems = 0, maxItems = 5000): Contract<T[]> {
  return { schema: { type: 'array', items: item.schema, minItems, maxItems }, parse(value) {
    if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) throw new Error('INVALID_ARRAY');
    return value.map(v => item.parse(v));
  } };
}
export function nullable<T>(item: Contract<T>): Contract<T | null> {
  return { schema: { anyOf: [item.schema, { type: 'null' }] }, parse(value) { return value === null ? null : item.parse(value); } };
}
export function shape<T extends Record<string, Contract<unknown>>>(fields: T): Contract<{ [K in keyof T]: ReturnType<T[K]['parse']> }> {
  return { schema: { type: 'object', additionalProperties: false, required: Object.keys(fields),
    properties: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.schema])) }, parse(value) {
    const row = object(value);
    if (Object.keys(row).some(k => !Object.hasOwn(fields, k))) throw new Error('UNKNOWN_FIELD');
    // 每一个值均由对应 contract 校验后才建立类型映射。
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.parse(row[k])])) as { [K in keyof T]: ReturnType<T[K]['parse']> };
  } };
}

export const citationContract = shape({ evidenceId: text(100), quote: text(2000) });
const claim = shape({ text: text(), citations: array(citationContract, 1, 30) });
export const resultContract = shape({
  packetId: text(100), inputHash: text(64), ruleVersion: text(100), promptVersion: text(100), companyVersion: text(100),
  provider: choice('codex-session'), model: text(100),
  relevance: shape({ decision: choice('related', 'irrelevant', 'review'), reason: text(), citations: array(citationContract, 1, 30) }),
  summary: shape({ facts: array(claim, 1, 30), inferences: array(claim, 0, 30), missing: array(text(), 0, 50) }),
  requirements: array(shape({ id: text(100), category: choice('mandatory', 'scoring', 'general'), scope: text(200),
    text: text(), citations: array(citationContract, 1, 30), companyCitations: array(citationContract, 0, 30),
    status: choice('符合', '不符合', '资料不足', '待复核'), reason: text() }), 0, 100),
  limitations: array(text(), 1, 50),
});
export type ModelResult = ReturnType<typeof resultContract.parse>;
export type Citation = ReturnType<typeof citationContract.parse>;
export const labelsContract = shape({ kind: choice('human', 'synthetic'), reviewer: text(100),
  labels: array(shape({ packetId: text(100), inputHash: text(64), label: choice('related', 'irrelevant'), note: text() }), 1, 5000) });
export const companyContract = shape({ kind: choice('synthetic'), version: text(100),
  facts: array(shape({ id: text(100), text: text(12000), validUntil: nullable(text(10)) }), 0, 100) });
export type Company = ReturnType<typeof companyContract.parse>;
