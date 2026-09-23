import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { downloadFile } from '../../src/archive/download.js';
import { ArchiveError } from '../../src/archive/model.js';
import { openSession, waitForManualDownload } from '../../src/auth/session.js';
import { initializeRoot } from '../../src/store/files.js';
import { ArchiveStore } from '../../src/store/archive-store.js';
import { runArchive } from '../../src/archive/run.js';
import { fixtureRoot, testConfig, syntheticPdf, syntheticCandidate } from './archive-fixtures.js';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('测试服务器异常'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server): Promise<void> { server.closeAllConnections(); await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }

test('流式下载识别伪装登录页、限流、体积超限和未登记重定向；中断不保存假成功', async () => {
  const server=createServer((req,res)=>{
    if(req.url==='/html'){res.writeHead(200,{'content-type':'application/pdf'});res.end('<html>请先登录</html>');}
    else if(req.url==='/large'){res.writeHead(200,{'content-length':'20000'});res.end('large');}
    else if(req.url==='/redirect'){res.writeHead(302,{location:'http://example.invalid/private?token=SECRET'});res.end();}
    else if(req.url==='/limit'){res.writeHead(429);res.end('limit');}
    else {res.writeHead(200,{'content-type':'application/pdf'});res.end(syntheticPdf());}
  });
  const origin=await listen(server); const config={...testConfig(await fixtureRoot(),origin),maxFileBytes:1000}; const signal=new AbortController().signal;
  try {
    for(const [path,code] of [['/html','HTML_INSTEAD_OF_ATTACHMENT'],['/large','FILE_TOO_LARGE'],['/redirect','UNREGISTERED_SOURCE'],['/limit','HTTP_429']]) {
      await assert.rejects(downloadFile(origin+path,origin,config,signal),e=>e instanceof ArchiveError&&e.code===code);
    }
    const result=await downloadFile(origin+'/ok',origin,config,signal);assert(result.bytes.equals(syntheticPdf()));
    const cancelled=new AbortController();cancelled.abort();await assert.rejects(downloadFile(origin+'/ok',origin,config,cancelled.signal));
  } finally {await close(server);}
});

test('专用有头会话关闭重开复用，失效后检测人工需求，重新登录恢复；浏览器下载可取消', async () => {
  const server=createServer((req,res)=>{
    if(req.url==='/login'){res.writeHead(200,{'content-type':'text/html','set-cookie':'fixtureSession=ok; HttpOnly; Path=/; Max-Age=3600'});res.end('<h1>合成登录成功</h1>');}
    else if(req.url==='/logout'){res.writeHead(200,{'set-cookie':'fixtureSession=; HttpOnly; Path=/; Max-Age=0'});res.end('合成过期');}
    else if(req.url==='/protected.pdf'&&req.headers.cookie?.includes('fixtureSession=ok')){res.writeHead(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="synthetic.pdf"'});res.end(syntheticPdf());}
    else {res.writeHead(200,{'content-type':'text/html'});res.end('<html>合成场景：请先登录</html>');}
  });
  const origin=await listen(server);const root=await fixtureRoot();await initializeRoot(root,false);const config=testConfig(root,origin);let session:Awaited<ReturnType<typeof openSession>>|undefined;
  try {
    session=await openSession(root,origin,'synthetic');const page=session.context.pages()[0]!;await page.goto(origin+'/login');await session.close();
    session=await openSession(root,origin,'synthetic');const second=session.context.pages()[0]!;
    assert((await downloadFile(origin+'/protected.pdf',origin,config,new AbortController().signal,session.context)).bytes.equals(syntheticPdf()));
    await second.goto(origin+'/logout');await assert.rejects(downloadFile(origin+'/protected.pdf',origin,config,new AbortController().signal,session.context),e=>e instanceof ArchiveError&&e.action==='needs-human');
    await second.goto(origin+'/login');assert((await downloadFile(origin+'/protected.pdf',origin,config,new AbortController().signal,session.context)).bytes.equals(syntheticPdf()));
    const pending=waitForManualDownload(session.context,config.maxFileBytes,AbortSignal.timeout(5000));await second.goto(origin+'/protected.pdf').catch(()=>{});assert((await pending).bytes.equals(syntheticPdf()));
    const controller=new AbortController();const cancelled=waitForManualDownload(session.context,config.maxFileBytes,controller.signal);const check=assert.rejects(cancelled);controller.abort();await check;
  } finally {await session?.close();await close(server);}
});

test('下载过程中取消保留已完成项；重开数据库恢复时不重复请求已完成文件', async () => {
  const controller=new AbortController();let first=0,second=0;let cancel=true;
  const server=createServer((req,res)=>{
    if(req.url==='/one')first++; else {second++;if(cancel){controller.abort();res.destroy();return;}}
    res.writeHead(200,{'content-type':'application/pdf'});res.end(syntheticPdf());
  });
  const origin=await listen(server);const root=await fixtureRoot();await initializeRoot(root,false);const config=testConfig(root,origin);let store=new ArchiveStore(root);
  try {
    const job=await store.createJob([syntheticCandidate(origin+'/one'),syntheticCandidate(origin+'/two')],'synthetic-cancel-test');
    assert.equal((await runArchive(store,job,config,controller.signal)).status,'cancelled');assert.equal(store.items(job)[0]?.status,'complete');
    store.close();store=new ArchiveStore(root);cancel=false;
    assert.equal((await runArchive(store,job,config,new AbortController().signal)).status,'complete');assert.equal(first,1);assert.equal(second,2);assert.equal(store.items(job)[0]?.reused,true);assert.equal((await store.verify()).ok,true);
  } finally {store.close();await close(server);}
});
