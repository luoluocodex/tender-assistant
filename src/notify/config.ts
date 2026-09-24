import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { object } from '../archive/config.js';
import { configContract, type NotifyConfig } from './model.js';

/** 首版只允许本地预览；打开发送/调度开关不会得到隐含授权，而是拒绝执行。 */
export async function notifyConfig(project: string): Promise<NotifyConfig> {
  const config = configContract.parse(JSON.parse(await readFile(resolve(project, 'config/p5.json'), 'utf8')));
  const baseline = object(JSON.parse(await readFile(resolve(project, 'config/p0-baseline.json'), 'utf8')));
  const operation = object(baseline.operation);
  if (operation.externalSendingEnabled !== false || operation.recurringScheduleEnabled !== false || operation.notificationMode !== 'preview-only') throw new Error('P5_BASELINE_MISMATCH');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(config.recipient) || config.maxAttempts < 1 || config.maxAttempts > 5
    || config.deadlineHours.some(h => h < 1 || h > 168) || new Set(config.deadlineHours).size !== config.deadlineHours.length) throw new Error('INVALID_P5_CONFIG');
  return config;
}
