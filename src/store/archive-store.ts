import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, copyFile, readdir, appendFile } from 'node:fs/promises';
import type { ArchiveItem, Candidate, ParsedFile } from '../archive/model.js';
import { inside, sha256, atomicFile } from './files.js';
import { object, string } from '../archive/config.js';

interface StoredFile { sha256: string; size: number; kind: string; objectPath: string; parsePath: string; parseSha: string; parseStatus: string }
interface Job { id: string; status: string; purpose: string; createdAt: string; updatedAt: string; sourceReport: string }
const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';

function readItem(raw: string): ArchiveItem {
  const v = object(JSON.parse(raw)); const c = object(v.candidate);
  const nullable = (key: string): string | null => v[key] === null ? null : string(v[key]);
  return { id: string(v.id), jobId: string(v.jobId), status: string(v.status), reason: typeof v.reason === 'string' ? v.reason : '',
    sha256: nullable('sha256'), objectPath: nullable('objectPath'), parsePath: nullable('parsePath'), parseStatus: nullable('parseStatus'), parseSha: typeof v.parseSha === 'string' ? v.parseSha : null, reused: v.reused === true,
    candidate: { purpose: c.purpose === 'formal' ? 'formal' : 'diagnostic', noticeKey: string(c.noticeKey), noticeVersion: string(c.noticeVersion), noticeId: string(c.noticeId), noticeUrl: string(c.noticeUrl), title: string(c.title), noticePayload: c.noticePayload, attachmentId: string(c.attachmentId), name: string(c.name), url: string(c.url) } };
}

/** SQLite 保存清单和进度；文件先原子落盘，再提交引用，重复内容复用对象。 */
export class ArchiveStore {
  readonly db: DatabaseSync;
  constructor(readonly root: string) {
    this.db = new DatabaseSync(inside(root, 'archive.sqlite'), { timeout: 5000, defensive: true });
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;');
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) { this.db.close(); throw new Error('不支持的归档数据库版本'); }
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notices(version TEXT PRIMARY KEY, notice_key TEXT NOT NULL, path TEXT NOT NULL, sha TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS objects(sha TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS links(attachment_id TEXT NOT NULL, sha TEXT NOT NULL REFERENCES objects(sha), created_at TEXT NOT NULL, source_url TEXT NOT NULL, PRIMARY KEY(attachment_id,sha));
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), payload TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  close(): void { this.db.close(); }

  async createJob(selected: Candidate[], sourceReport: string): Promise<string> {
    const id = `p2-${randomUUID()}`; const now = new Date().toISOString();
    const purpose = selected.every(x => x.purpose === 'formal') ? 'formal' : 'diagnostic';
    this.db.prepare('INSERT INTO jobs VALUES (?,?)').run(id, json({ id, status: 'pending', purpose, createdAt: now, updatedAt: now, sourceReport }));
    for (const candidate of new Map(selected.map(c => [c.attachmentId, c])).values()) {
      const path = `notices/${candidate.noticeKey}/${candidate.noticeVersion}.json`;
      if (!this.db.prepare('SELECT version FROM notices WHERE version=?').get(candidate.noticeVersion)) {
        const payload = json(candidate.noticePayload); await atomicFile(inside(this.root, path), payload);
        this.db.prepare('INSERT INTO notices VALUES (?,?,?,?)').run(candidate.noticeVersion, candidate.noticeKey, path, sha256(payload));
      }
      const item: ArchiveItem = { id: sha256(`${id}:${candidate.attachmentId}`), jobId: id, candidate, status: 'pending', reason: '', sha256: null, objectPath: null, parsePath: null, parseStatus: null, reused: false };
      this.db.prepare('INSERT INTO items VALUES (?,?,?)').run(item.id, id, json(item));
    }
    await this.report(id); await this.event(id, 'job-created', { purpose, items: this.items(id).length }); return id;
  }

  items(jobId: string): ArchiveItem[] {
    return this.db.prepare('SELECT payload FROM items WHERE job_id=? ORDER BY rowid').all(jobId).map(row => readItem(string(row.payload)));
  }
  job(jobId: string): Job {
    const row = this.db.prepare('SELECT payload FROM jobs WHERE id=?').get(jobId); if (!row) throw new Error('归档任务不存在');
    const v = object(JSON.parse(string(row.payload)));
    return { id: string(v.id), status: string(v.status), purpose: string(v.purpose), createdAt: string(v.createdAt), updatedAt: string(v.updatedAt), sourceReport: string(v.sourceReport) };
  }
  update(item: ArchiveItem): void { this.db.prepare('UPDATE items SET payload=? WHERE id=?').run(json(item), item.id); }
  async setStatus(jobId: string, status: string): Promise<void> {
    this.db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(json({ ...this.job(jobId), status, updatedAt: new Date().toISOString() }), jobId);
    await this.report(jobId); await this.event(jobId, 'job-status', { status });
  }
  /** 追加日志只接收程序生成的状态信息，调用方不得传 URL、Cookie 或材料全文。 */
  async event(jobId: string, event: string, fields: Record<string, string | number | boolean | null> = {}): Promise<void> {
    await appendFile(inside(this.root, `runs/${jobId}/events.jsonl`), JSON.stringify({ time: new Date().toISOString(), jobId, event, ...fields }) + '\n', 'utf8');
  }
  async report(jobId: string): Promise<string> {
    const path = inside(this.root, `runs/${jobId}/report.json`);
    await atomicFile(path, json({ schemaVersion: 1, phase: 'P2', ...this.job(jobId), items: this.items(jobId), notification: 'not-sent' }));
    return path;
  }
  file(hash: string): StoredFile | null {
    const row = this.db.prepare('SELECT payload FROM objects WHERE sha=?').get(hash); if (!row) return null;
    const v = object(JSON.parse(string(row.payload)));
    return { sha256: string(v.sha256), size: Number(v.size), kind: string(v.kind), objectPath: string(v.objectPath), parsePath: string(v.parsePath), parseSha: string(v.parseSha), parseStatus: string(v.parseStatus) };
  }
  async reusable(attachmentId: string): Promise<StoredFile | null> {
    const row = this.db.prepare('SELECT sha FROM links WHERE attachment_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(attachmentId);
    if (!row) return null;
    const file = this.file(string(row.sha)); if (!file) return null;
    if (await this.fileValid(file)) return file;
    return null;
  }
  private async fileValid(file: StoredFile): Promise<boolean> {
    try { return sha256(await readFile(inside(this.root, file.objectPath))) === file.sha256 && sha256(await readFile(inside(this.root, file.parsePath))) === file.parseSha; } catch { return false; }
  }
  async save(item: ArchiveItem, bytes: Buffer, parsed: ParsedFile, finalUrl: string, method: string): Promise<void> {
    const hash = sha256(bytes); const extension = ['pdf','doc','docx','xlsx','zip','rar'].includes(parsed.kind) ? parsed.kind : 'bin';
    const objectPath = `objects/${hash.slice(0,2)}/${hash}.${extension}`;
    const parsedText = json(parsed); const parseSha = sha256(parsedText); const parsePath = `parsed/${hash}-${parseSha.slice(0,12)}.json`;
    await atomicFile(inside(this.root, objectPath), bytes); await atomicFile(inside(this.root, parsePath), parsedText);
    const file: StoredFile = { sha256: hash, size: bytes.length, kind: parsed.kind, objectPath, parsePath, parseSha, parseStatus: parsed.status };
    this.applyFile(item, file, false); item.reason = `${method}:${parsed.reason || 'OK'}`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO objects VALUES (?,?) ON CONFLICT(sha) DO UPDATE SET payload=excluded.payload').run(hash, json(file));
      this.db.prepare('INSERT OR IGNORE INTO links VALUES (?,?,?,?)').run(item.candidate.attachmentId, hash, new Date().toISOString(), finalUrl);
      this.update(item); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  applyFile(item: ArchiveItem, file: StoredFile, reused: boolean): void {
    item.sha256 = file.sha256; item.objectPath = file.objectPath; item.parsePath = file.parsePath; item.parseStatus = file.parseStatus;
    item.parseSha = file.parseSha;
    item.status = file.parseStatus === 'parsed' ? 'complete' : 'partial'; item.reused = reused; item.reason = reused ? 'VERIFIED_CONTENT_REUSED' : '';
  }

  /** 不做修复或删除；检出缺失、篡改和 SQLite 引用问题。 */
  async verify(): Promise<{ ok: boolean; objects: number; notices: number; errors: string[] }> {
    const errors: string[] = []; const objects = this.db.prepare('SELECT sha FROM objects').all();
    for (const row of objects) { const file = this.file(string(row.sha))!; if (!await this.fileValid(file)) errors.push(`OBJECT_OR_PARSE_MISMATCH:${file.sha256}`); }
    const notices = this.db.prepare('SELECT path,sha FROM notices').all();
    for (const row of notices) { try { if (sha256(await readFile(inside(this.root, string(row.path)))) !== row.sha) errors.push('NOTICE_MISMATCH'); } catch { errors.push('NOTICE_MISSING'); } }
    // 旧任务可能引用旧的解析版本；不能只校验 objects 表指向的最新解析结果。
    for (const row of this.db.prepare('SELECT payload FROM items').all()) {
      const item = readItem(string(row.payload)); if (!item.sha256) continue;
      try {
        if (!item.objectPath || !item.parsePath || sha256(await readFile(inside(this.root, item.objectPath))) !== item.sha256) throw new Error('对象损坏');
        const parsed = await readFile(inside(this.root, item.parsePath));
        const expected = item.parseSha ?? /-([a-f0-9]{12})\.json$/.exec(item.parsePath)?.[1];
        if (!expected || !sha256(parsed).startsWith(expected) || object(JSON.parse(parsed.toString('utf8'))).status !== item.parseStatus) throw new Error('解析结果损坏');
      } catch { errors.push(`ITEM_REFERENCE_MISMATCH:${item.id}`); }
    }
    if (this.db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || this.db.prepare('PRAGMA foreign_key_check').all().length) errors.push('DATABASE_INTEGRITY');
    return { ok: errors.length === 0, objects: objects.length, notices: notices.length, errors };
  }
}

/** 持有全局锁且无事务时复制完整业务目录；会话和锁不进入备份。 */
export async function backupArchive(store: ArchiveStore): Promise<{ path: string; files: number }> {
  const check = await store.verify(); if (!check.ok) throw new Error('归档校验失败，不能生成成功备份');
  const relativeRoot = `backups/${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
  const root = inside(store.root, relativeRoot); await mkdir(root, { recursive: true });
  // VACUUM INTO 生成一致的独立数据库，不依赖 WAL 文件复制时机。
  store.db.exec(`VACUUM INTO '${inside(root, 'archive.sqlite').replaceAll("'", "''")}'`);
  const manifest: Array<{ path: string; sha256: string }> = [{ path: 'archive.sqlite', sha256: sha256(await readFile(inside(root, 'archive.sqlite'))) }];
  const copy = async (relativePath: string): Promise<void> => {
    for (const entry of await readdir(inside(store.root, relativePath), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('归档中存在意外符号链接');
      const path = `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) { await mkdir(inside(root, path), { recursive: true }); await copy(path); }
      else if (!entry.name.endsWith('.partial')) { await copyFile(inside(store.root, path), inside(root, path)); manifest.push({ path, sha256: sha256(await readFile(inside(root, path))) }); }
    }
  };
  for (const dir of ['objects','parsed','notices','runs']) { await mkdir(inside(root, dir), { recursive: true }); await copy(dir); }
  await atomicFile(inside(root, 'manifest.json'), json({ schemaVersion: 1, sessionsIncluded: false, files: manifest }));
  return { path: root, files: manifest.length };
}

/** 恢复到全新目录并重新核验，绝不覆盖原归档或导入登录会话。 */
export async function restoreArchive(backup: string, target: string): Promise<{ ok: boolean; objects: number; notices: number; errors: string[] }> {
  await mkdir(target, { recursive: false });
  const manifest = object(JSON.parse(await readFile(inside(backup, 'manifest.json'), 'utf8')));
  if (manifest.sessionsIncluded !== false || !Array.isArray(manifest.files)) throw new Error('备份清单无效');
  for (const raw of manifest.files) {
    const row = object(raw); const path = string(row.path);
    if (path !== 'archive.sqlite' && !/^(objects|parsed|notices|runs)\//.test(path)) throw new Error('备份路径超出业务材料范围');
    const bytes = await readFile(inside(backup, path)); if (sha256(bytes) !== row.sha256) throw new Error('备份文件指纹不符');
    await atomicFile(inside(target, path), bytes);
  }
  const store = new ArchiveStore(target);
  try { return await store.verify(); } finally { store.close(); }
}
