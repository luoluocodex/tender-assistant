/** P2 只读取已发现附件；限制也适用于本地人工导入。 */
export interface ArchiveConfig {
  runtimeRoot: string; minIntervalMs: number; maxFiles: number; maxFileBytes: number;
  timeoutMs: number; parseTimeoutMs: number; maxRunMinutes: number;
  maxZipEntries: number; maxExpandedBytes: number; maxArchiveDepth: number;
  sources: Array<{ id: string; origin: string; pathPrefix: string }>;
}
export type ParseStatus = 'parsed' | 'partial' | 'needs-ocr' | 'encrypted' | 'unsupported' | 'invalid' | 'timeout';
export interface ParsedFile {
  parserVersion: 'p2-v1'; kind: string; status: ParseStatus; reason: string;
  units: Array<{ locator: string; text: string }>;
  members: Array<{ name: string; sha256: string; size: number; kind: string; status: ParseStatus; reason: string }>;
}
export interface Candidate {
  purpose: 'formal' | 'diagnostic'; noticeKey: string; noticeVersion: string; noticeId: string;
  noticeUrl: string; title: string; noticePayload: unknown; attachmentId: string; name: string; url: string;
}
export interface ArchiveItem {
  id: string; jobId: string; candidate: Candidate; status: string; reason: string;
  sha256: string | null; objectPath: string | null; parsePath: string | null; parseStatus: string | null;
  parseSha?: string | null;
  reused: boolean;
}
/** 固定错误码避免第三方错误或带签名的 URL 进入普通日志。 */
export class ArchiveError extends Error {
  constructor(readonly code: string, readonly action: 'failed' | 'needs-human' | 'limited' = 'failed') { super(code); }
}
