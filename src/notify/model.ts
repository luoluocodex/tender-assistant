import { array, choice, nullable, shape, text } from '../analysis/contract.js';

interface Contract<T> { schema: Record<string, unknown>; parse(value: unknown): T }

const integer: Contract<number> = { schema: { type: 'integer', minimum: 0 }, parse(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_INTEGER'); return value;
} };
const off: Contract<false> = { schema: { const: false }, parse(value) { if (value !== false) throw new Error('P5_PREVIEW_ONLY'); return false; } };
export const configContract = shape({ schemaVersion: { schema: { const: 1 }, parse(value: unknown): 1 { if (value !== 1) throw new Error('INVALID_P5_SCHEMA'); return 1; } },
  channel: choice('local-preview'), recipient: text(80), externalSendingEnabled: off, scheduleEnabled: off,
  deadlineHours: array(integer, 1, 5), maxAttempts: integer });
export type NotifyConfig = ReturnType<typeof configContract.parse>;
export const eventContract = shape({ id: text(64), type: choice('related-notice', 'project-update', 'deadline', 'run-problem', 'review-required'),
  purpose: choice('formal', 'diagnostic'), sourceRun: text(100), subject: text(200), version: text(64), title: text(500),
  message: text(6000), url: nullable(text(5000)), evidence: array(shape({ locator: text(500), quote: text(2000) }), 0, 30) });
export type NotifyEvent = ReturnType<typeof eventContract.parse>;
const deliveryState = choice('pending', 'writing', 'previewed', 'failed', 'unknown');
const runState = choice('running', 'complete', 'partial', 'failed', 'cancelled');
export const deliveryContract = shape({ id: text(64), event: eventContract, channel: choice('local-preview'), recipient: text(80),
  state: deliveryState, attempts: integer, updatedAt: text(50), errorCode: nullable(text(100)), receiptHash: nullable(text(64)),
  history: array(shape({ state: deliveryState, at: text(50), attempt: integer, errorCode: nullable(text(100)) }), 1, 1000) });
export type Delivery = ReturnType<typeof deliveryContract.parse>;
export const runContract = shape({ id: text(80), purpose: choice('formal', 'diagnostic'), sourceRun: nullable(text(100)), startedAt: text(50),
  referenceTime: text(50), finishedAt: nullable(text(50)), status: runState,
  deliveryIds: array(text(64), 0, 100000), added: integer, reused: integer, errorCode: nullable(text(100)),
  history: array(shape({ status: runState, at: text(50), errorCode: nullable(text(100)) }), 1, 1000) });
export type NotifyRun = ReturnType<typeof runContract.parse>;
const materialContract = shape({ bodyHash: text(64), fetchedAt: nullable(text(50)), attachments: array(shape({
  contentHash: text(64), observation: nullable(shape({ archiveId: text(100), attachmentId: text(100), revision: integer })),
}), 0, 1000) });
export const observationContract = shape({ purpose: choice('formal', 'diagnostic'), subject: text(200), version: text(64),
  contentHash: text(64), fetchedAt: nullable(text(50)), relevant: choice('yes', 'no'), material: nullable(materialContract) });
export type Observation = ReturnType<typeof observationContract.parse>;
export const ledgerContract = shape({ version: choice('p5-v2'), deliveries: array(deliveryContract, 0, 100000),
  runs: array(runContract, 0, 10000), observations: array(observationContract, 0, 100000) });
export type Ledger = ReturnType<typeof ledgerContract.parse>;
export interface DeliveryOutcome { state: 'previewed' | 'failed' | 'unknown'; receiptHash: string | null; errorCode: string | null }
export interface PreviewChannel {
  deliver(delivery: Delivery): Promise<DeliveryOutcome>;
  inspect(delivery: Delivery): Promise<DeliveryOutcome>;
}
