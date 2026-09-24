import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFile } from '../../src/archive/parse-file.js';
import { parseIsolated } from '../../src/archive/parse.js';
import { initializeRoot, inside, acquireLock } from '../../src/store/files.js';
import { ArchiveStore, backupArchive, restoreArchive } from '../../src/store/archive-store.js';
import { candidates, canonicalUrl, displayUrl } from '../../src/archive/source.js';
import { fixtureRoot, testConfig, syntheticCandidate, syntheticPdf, syntheticZip } from './archive-fixtures.js';
import { importFile } from '../../src/archive/run.js';

test('PDF 页码、DOCX 段落和 XLSX 单元格有可追溯文本；损坏 PDF 不算解析成功', async () => {
  const config = testConfig(await fixtureRoot());
  const pdf = await parseIsolated(syntheticPdf(), config, new AbortController().signal);
  assert.equal(pdf.status,'parsed'); assert.equal(pdf.units[0]?.locator,'page:1'); assert.match(pdf.units[0]!.text,/Synthetic tender fixture/);
  const docx = await parseFile(syntheticZip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>合成采购条款</w:t></w:r></w:p></w:body></w:document>' }),config);
  assert.equal(docx.kind,'docx'); assert.equal(docx.status,'parsed'); assert.equal(docx.units[0]?.text,'合成采购条款');
  const xlsx = await parseFile(syntheticZip({ 'xl/workbook.xml':'<workbook/>', 'xl/sharedStrings.xml':'<sst><si><t>合成报价</t></si></sst>', 'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>' }), config);
  assert.equal(xlsx.kind,'xlsx'); assert.equal(xlsx.units[0]?.locator,'xl/worksheets/sheet1.xml!A1'); assert.equal(xlsx.units[0]?.text,'合成报价'); assert.match(xlsx.units[1]!.text,/未计算/);
  assert.equal((await parseIsolated(Buffer.from('%PDF-1.4 broken'),config,new AbortController().signal)).status,'invalid');
  const emptyText=Buffer.from(syntheticPdf().toString().replace('Synthetic tender fixture',' '.repeat('Synthetic tender fixture'.length)));
  assert.equal((await parseIsolated(emptyText,config,new AbortController().signal)).status,'needs-ocr');
});

test('人工导入保留来源并解析；HTML 伪装不入库；解析超时显式报告', async () => {
  const root=await fixtureRoot();await initializeRoot(root,false);const store=new ArchiveStore(root);const config=testConfig(root);const signal=new AbortController().signal;
  try {
    const job=await store.createJob([syntheticCandidate()],'synthetic-manual-import');const item=store.items(job)[0]!;const path=join(root,'manual.pdf');
    await writeFile(path,'<html>请先登录</html>');await assert.rejects(importFile(store,job,item.id,path,config,signal),/HTML/);assert.equal(store.items(job)[0]?.status,'pending');
    await writeFile(path,syntheticPdf());assert.equal((await importFile(store,job,item.id,path,config,signal)).status,'complete');assert.match(store.items(job)[0]!.reason,/manual-import/);assert.equal((await store.verify()).ok,true);
    assert.equal((await parseIsolated(syntheticPdf(),{...config,parseTimeoutMs:1},signal)).status,'timeout');
  } finally {store.close();}
});

test('ZIP 路径穿越、CRC 损坏、加密、过多条目及 XML 实体声明被拒绝', async () => {
  const config = testConfig(await fixtureRoot());
  assert.equal((await parseFile(syntheticZip({'../outside.txt':'合成'}),config)).status,'invalid');
  const corrupt = syntheticZip({'sample.txt':'abc'}); corrupt[40] = 100;
  assert.equal((await parseFile(corrupt,config)).status,'invalid');
  assert.equal((await parseFile(syntheticZip({'sample.txt':'abc'},true),config)).status,'encrypted');
  assert.equal((await parseFile(syntheticZip({'one.txt':'a','two.txt':'b'}),{...config,maxZipEntries:1})).status,'invalid');
  const unsafe = syntheticZip({'word/document.xml':'<!DOCTYPE x [<!ENTITY x "injected">]><w:document><w:p><w:t>&x;</w:t></w:p></w:document>'});
  assert.equal((await parseFile(unsafe,config)).status,'invalid');
  assert.equal((await parseFile(Buffer.from('unsupported format'),config)).status,'unsupported');
});

test('公告与附件幂等归档、版本保留、内容校验、备份及新目录恢复', async () => {
  const root = await fixtureRoot(); await initializeRoot(root,false); const store = new ArchiveStore(root);
  try {
    const candidate = syntheticCandidate(); const id = await store.createJob([candidate,candidate],'synthetic-report'); assert.equal(store.items(id).length,1);
    const bytes = syntheticPdf(); const parsed = await parseFile(bytes,testConfig(root));
    const item = store.items(id)[0]!; await store.save(item,bytes,parsed,candidate.url,'synthetic-test');
    const duplicate = await store.createJob([candidate],'synthetic-report'); const reused = await store.reusable(candidate.attachmentId); assert(reused); store.applyFile(store.items(duplicate)[0]!,reused,true);
    assert.equal(store.db.prepare('SELECT count(*) n FROM objects').get()?.n,1);
    const modified = Buffer.concat([bytes,Buffer.from('\n% version2')]); await store.save(item,modified,parsed,candidate.url,'synthetic-update');
    assert.equal(store.db.prepare('SELECT count(*) n FROM links').get()?.n,2);
    assert.equal((await store.reusable(candidate.attachmentId))?.sha256,item.sha256);
    assert.deepEqual(await store.verify(),{ok:true,objects:2,notices:1,errors:[]});
    const backup = await backupArchive(store); const restored = await restoreArchive(backup.path,join(root,'restored')); assert.equal(restored.ok,true);
    await assert.rejects(restoreArchive(backup.path,join(root,'restored')));
    await writeFile(inside(root,item.objectPath!),Buffer.from('tampered')); assert.equal((await store.verify()).ok,false); assert.equal(await store.reusable(candidate.attachmentId),null);
    const manifest = JSON.parse(await readFile(join(backup.path,'manifest.json'),'utf8')); assert.equal(manifest.sessionsIncluded,false);
  } finally { store.close(); }
});

test('运行锁阻止并发；路径与 URL 签名处理不改变业务附件标识', async () => {
  const root = await fixtureRoot(); const release = await acquireLock(root);
  await assert.rejects(acquireLock(root),/仍在运行/); await release(); const again = await acquireLock(root); await again();
  assert.throws(()=>inside(root,'../outside'));
  assert.equal(displayUrl('https://example.invalid/a?accessCode=secret#token'),'https://example.invalid/a');
  assert.equal(canonicalUrl('https://example.invalid/a?uuid=123&accessCode=secret'),'https://example.invalid/a?uuid=123');
});

test('报告选择保留诊断用途；签名更新不新建公告版本；未知来源拒绝', async () => {
  const root = await fixtureRoot(); const config = testConfig(root); config.sources=[{id:'fixture',origin:'https://files.example.invalid',pathPrefix:'/file/'}];
  const path = join(root,'report.json');
  const report = {phase:'P1',purpose:'diagnostic',details:[{listing:{site:'ccgp',id:'sample',title:'合成',url:'https://www.ccgp.gov.cn/cggg/sample.htm'},title:'合成',text:'合成正文',fields:{},attachments:[{name:'合成.pdf',url:'https://files.example.invalid/file/a?accessCode=one'}]}]};
  await writeFile(path,JSON.stringify(report));const first=(await candidates(path,['sample:0'],config))[0]!;
  report.details[0]!.attachments[0]!.url='https://files.example.invalid/file/a?accessCode=two';await writeFile(path,JSON.stringify(report)); const second=(await candidates(path,['sample:0'],config))[0]!;
  assert.equal(first.noticeVersion,second.noticeVersion);assert.equal(first.attachmentId,second.attachmentId);assert.equal(first.purpose,'diagnostic');
  await assert.rejects(candidates(path,['sample:0'],{...config,sources:[]}));
});

test('DOCX 段落、表格、超链接和连续文字保持原文顺序及段落定位', async () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>资格要求：</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲级资质</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>评分条件：</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>参考 </w:t></w:r><w:hyperlink><w:r><w:t>附件</w:t></w:r></w:hyperlink><w:r><w:t> 的项目经验</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const parsed = await parseFile(syntheticZip({ 'word/document.xml': xml }), testConfig(await fixtureRoot()));
  assert.equal(parsed.status, 'parsed');
  assert.deepEqual(parsed.units.map(u => u.text), ['资格要求：', '甲级资质', '评分条件：', '参考 附件 的项目经验']);
  assert.deepEqual(parsed.units.map(u => u.locator), [1, 2, 3, 4].map(i => `word/document.xml:paragraph:${i}`));
});
