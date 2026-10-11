import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {startJob, getJob, getLatestJob, cancelJob} from '../server/jobs.mjs';
import {streamJob} from '../server/jobStream.mjs';
import {demoProject} from '../src/domain.mjs';

// Use real hooks, components, SSE handler and job lifecycle. Only Firebase login
// and the external AI are substituted; no real account or provider key is used.
await fs.mkdir('.qa', {recursive: true});
await fs.writeFile('.qa/ai-stream-harness.tsx', `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useAiJob} from '../src/aiJob';
import AIChatPanel from '../src/AIChatPanel';
import AIPanel from '../src/AIPanel';
import {demoProject} from '../src/domain.mjs';
import {applyEditPatch} from '../src/modelEdit.mjs';
import '../src/style.css';
function Harness() {
  const ai = useAiJob('qa-user');
  const [panel, setPanel] = useState('chat');
  const [project, setProject] = useState({...demoProject(), id: 'qa-project'});
  return <div style={{maxWidth:700,margin:'20px auto',padding:12}}>
    <button onClick={() => setPanel(panel === 'chat' ? 'generate' : 'chat')}>สลับแผงทดสอบ</button>
    <output data-testid="job-status">{ai.job?.status || 'idle'}</output>
    {panel === 'chat' ? <AIChatPanel project={project} ai={ai} selectedId="F-001" onApply={result => setProject(current => applyEditPatch(current,result.patch,result.context))}/> :
      <AIPanel project={project} ai={ai} onStarted={() => {}} getFile={async () => undefined} onUpload={async () => []} onApply={setProject}/>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
`);

const mock = express();
mock.use(express.json());
const responses = new Set();
let activeId, report, finish, editContext;
const editResult = (notes, thinking = []) => ({mode:'edit',context:editContext,patch:{updates:[],adds:[],removes:[],notes},notes,thinking});
let streamCount = 0;
let streamsEnabled = true;
let completeBeforeCancel = false;
mock.use('/api', (req, res, next) => {
  assert.equal(req.headers.authorization, 'Bearer qa-token');
  next();
});
mock.post(['/api/generate','/api/edit'], (req, res) => {
  editContext = req.body.context;
  activeId = startJob({uid: 'qa-user', ...req.body, prompt: req.body.displayPrompt, run: (_signal, update) => {
    report = update;
    return new Promise(resolve => { finish = resolve; });
  }});
  res.status(202).json({jobId: activeId});
});
mock.get('/api/jobs/current', (_req, res) => res.json({job: getLatestJob('qa-user')}));
mock.get('/api/jobs/:id/events', (req, res) => {
  streamCount++;
  if (streamsEnabled === 'silent') {
    res.set('Content-Type', 'text/event-stream').flushHeaders();
    return; // Simulate a proxy keeping HTTP open while buffering every SSE event.
  }
  if (!streamsEnabled) { res.status(503).json({error: 'SSE unavailable'}); return; }
  responses.add(res);
  res.on('close', () => responses.delete(res));
  streamJob(req, res, 'qa-user');
});
mock.get('/api/jobs/:id', (req, res) => res.json(getJob(req.params.id, 'qa-user')));
mock.delete('/api/jobs/:id', async (req, res) => {
  if (completeBeforeCancel) {
    finish(editResult(['เสร็จก่อนยกเลิก']));
    await Promise.resolve();
    await Promise.resolve();
  }
  cancelJob(req.params.id, 'qa-user');
  res.status(204).end();
});

const vite = await createServer({configFile: false, server: {host: '127.0.0.1', port: 0}, plugins: [{
  name: 'qa-ai-stream', configureServer(server) { server.middlewares.use(mock); },
}]});
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({channel: 'msedge', headless: true});
const page = await browser.newPage({viewport: {width: 1000, height: 900}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/__qa-ai', route => route.fulfill({contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/.qa/ai-stream-harness.tsx"></script>'}));
await page.route('**/src/cloud.ts*', route => route.fulfill({contentType: 'text/javascript', body: `
export const auth = {currentUser:{uid:'qa-user',getIdToken:async () => 'qa-token'}};
export const db = null, storage = null, cloudConfigured = false;
export async function logout() {}
`}));
await page.route('**/src/AuthContext.tsx*', route => route.fulfill({contentType: 'text/javascript', body: `
export const useAuth = () => ({firebaseUser:{uid:'qa-user'},userProfile:{uid:'qa-user',role:['Staff'],status:'approved'}});
`}));
const send = async text => {
  await page.getByLabel('พื้นที่แก้ไข AI', {exact: true}).selectOption('selected');
  await page.getByLabel('ข้อความถึง Chat AI', {exact: true}).fill(text);
  await page.getByRole('button', {name: 'ส่งคำสั่งให้ AI', exact: true}).click();
  await page.getByTestId('job-status').filter({hasText: 'running'}).waitFor();
  await page.getByText(/รับสถานะสด/).waitFor();
};
try {
  await page.goto(base + '/__qa-ai');
  await send('เพิ่มหน้าต่างกว้าง 1.5 เมตร');
  report({stage: 'thinking', detail: 'กำลังวิเคราะห์แปลน', thinking: ['กำลังเทียบผนังกับรูปตัด'], attempt: 1});
  await page.locator('.ai-activity-heading').getByText('กำลังวิเคราะห์แปลน', {exact: true}).waitFor();
  await page.getByText('ดูสรุปการวิเคราะห์จาก openai', {exact: true}).click();
  await page.getByText('กำลังเทียบผนังกับรูปตัด', {exact: true}).waitFor();
  // Summary-only changes arrive while the provider's promise is unresolved.
  report({thinking: ['กำลังเทียบผนังกับรูปตัด พบตำแหน่งช่องเปิดแล้ว']});
  await page.getByText('กำลังเทียบผนังกับรูปตัด พบตำแหน่งช่องเปิดแล้ว', {exact: true}).waitFor();
  assert.equal(getJob(activeId, 'qa-user').status, 'running');
  await page.screenshot({path: '.qa/ai-stream-live.png', fullPage: true});

  const connectionsBefore = streamCount;
  for (const response of responses) response.destroy();
  await page.getByText(/ตรวจสถานะเป็นระยะ/).waitFor();
  report({stage: 'validating', detail: 'ตรวจความสัมพันธ์ช่องเปิด'});
  report({stage: 'repairing', detail: 'กำลังแก้ช่องเปิดรอบที่ 2', attempt: 2});
  await page.getByText(/รับสถานะสด/).waitFor({timeout: 15000});
  assert.ok(streamCount > connectionsBefore);
  await page.locator('.ai-activity-history').getByText('ตรวจความสัมพันธ์ช่องเปิด', {exact: true}).waitFor();
  await page.locator('.ai-activity-history').getByText('กำลังแก้ช่องเปิดรอบที่ 2', {exact: true}).waitFor();
  assert.equal(await page.locator('.ai-activity-history li').count(), 4);

  await page.reload();
  await page.getByText(/รับสถานะสด/).waitFor();
  assert.equal(await page.locator('.ai-activity-history li').count(), 4);
  await page.evaluate(() => localStorage.removeItem('cmg-ai-job:qa-user'));
  await page.reload();
  await page.getByText(/รับสถานะสด/).waitFor();
  assert.equal(await page.locator('.ai-activity-history li').count(), 4);
  assert.equal(await page.locator('.ai-activity-history').getByText('ตรวจความสัมพันธ์ช่องเปิด', {exact: true}).count(), 1);
  await page.getByText('ดูสรุปการวิเคราะห์จาก openai', {exact: true}).click();
  await page.getByText('กำลังเทียบผนังกับรูปตัด พบตำแหน่งช่องเปิดแล้ว', {exact: true}).waitFor();
  // Generation and edit jobs are isolated in their respective surfaces.
  await page.getByRole('button', {name: 'สลับแผงทดสอบ'}).click();
  assert.equal(await page.locator('.ai-activity-history li').count(), 0);
  await page.getByRole('button', {name: 'สลับแผงทดสอบ'}).click();
  assert.equal(await page.locator('.ai-activity-history li').count(), 4);
  report({stage: 'validating', detail: 'ตรวจ geometry รอบสุดท้าย', attempt: 2});
  await page.locator('.ai-activity-heading').getByText('ตรวจ geometry รอบสุดท้าย', {exact: true}).waitFor();
  await page.screenshot({path: '.qa/ai-stream-generation.png', fullPage: true});
  finish(editResult(['ผลลัพธ์ทดสอบ'], ['สรุปการตรวจครบแล้ว']));
  await page.getByTestId('job-status').filter({hasText: 'idle'}).waitFor();
  assert.equal(getJob(activeId, 'qa-user').events.length, 6);
  await page.getByText(/สรุปการตรวจครบแล้ว/).waitFor();
  await page.screenshot({path: '.qa/ai-stream-complete.png', fullPage: true});
  for (const [width, height] of [[390, 844], [820, 1180]]) {
    await page.setViewportSize({width, height});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: '.qa/ai-stream-mobile.png', fullPage: true});

  // Cancel from chat; late provider completion must not overwrite the cancelled job.
  await send('ย้ายประตู');
  const cancelledId = activeId;
  await page.getByRole('button', {name: 'หยุดงาน AI', exact: true}).click();
  await page.getByTestId('job-status').filter({hasText: 'error'}).waitFor();
  assert.equal(getJob(cancelledId, 'qa-user').error, 'ยกเลิกแล้ว');
  finish(editResult([]));
  assert.equal(getJob(cancelledId, 'qa-user').status, 'error');

  completeBeforeCancel = true;
  await send('เสร็จพร้อมกดหยุด');
  await page.getByRole('button', {name: 'หยุดงาน AI', exact: true}).click();
  await page.getByTestId('job-status').filter({hasText: 'idle'}).waitFor();
  assert.equal(getJob(activeId, 'qa-user').status, 'done');
  completeBeforeCancel = false;

  // A silent buffered stream must not leave the UI waiting indefinitely.
  streamsEnabled = 'silent';
  await page.getByLabel('ข้อความถึง Chat AI', {exact: true}).fill('ตรวจสตรีมที่เงียบ');
  await page.getByRole('button', {name: 'ส่งคำสั่งให้ AI', exact: true}).click();
  await page.getByText(/กำลังเชื่อมต่อสถานะ/).waitFor();
  await page.getByText(/ตรวจสถานะเป็นระยะ/).waitFor({timeout: 25000});
  assert.equal(getJob(activeId, 'qa-user').status, 'running');
  await page.getByRole('button', {name: 'หยุดงาน AI', exact: true}).click();
  await page.getByTestId('job-status').filter({hasText: 'error'}).waitFor();

  // When SSE is unavailable the existing snapshot API still finishes the job.
  streamsEnabled = false;
  await page.getByLabel('ข้อความถึง Chat AI', {exact: true}).fill('เพิ่มผนัง');
  await page.getByRole('button', {name: 'ส่งคำสั่งให้ AI', exact: true}).click();
  await page.getByText(/ตรวจสถานะเป็นระยะ/).waitFor();
  report({stage: 'validating', detail: 'ตรวจผลผ่านช่องทางสำรอง'});
  finish(editResult(['สำรองสำเร็จ']));
  await page.getByTestId('job-status').filter({hasText: 'idle'}).waitFor({timeout: 15000});
  assert.deepEqual(errors, []);
  console.log('PASS: live summaries before completion, reconnect + missing stages, reload/server recovery, isolated creation/edit panels, terminal patch result, mobile/tablet layout, cancellation/completion race, silent-stream timeout and polling fallback; no browser errors');
} finally {
  if (activeId) cancelJob(activeId, 'qa-user');
  await browser.close();
  await vite.close();
}
