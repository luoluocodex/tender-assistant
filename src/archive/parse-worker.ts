import { parentPort, workerData } from 'node:worker_threads';
import { parseFile } from './parse-file.js';
import type { ArchiveConfig } from './model.js';

// 消息由同一程序发送；原始附件始终作为字节传给解析器，不执行其中内容。
const data: { bytes: Uint8Array; config: ArchiveConfig } = workerData;
void parseFile(Buffer.from(data.bytes), data.config).then(result => parentPort?.postMessage(result));
