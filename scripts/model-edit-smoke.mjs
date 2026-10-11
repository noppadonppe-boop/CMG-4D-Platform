import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {startJob, getJob, getLatestJob, cancelJob} from '../server/jobs.mjs';
import {streamJob} from '../server/jobStream.mjs';
import {validateEditRequest} from '../server/api.mjs';

// Real UI, request routing, SSE, job lifecycle and patch merging; Firebase and the external AI are simulated.
await fs.mkdir('.qa', {recursive: true});
await fs.writeFile('.qa/model-edit-harness.tsx', `
import React,{useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {useAiJob} from '../src/aiJob';
import AIChatPanel from '../src/AIChatPanel';
import AIPanel from '../src/AIPanel';
import {applyEditPatch} from '../src/modelEdit.mjs';
import {blankProject} from '../src/domain.mjs';
import '../src/style.css';
const element=(id,category,position,extra={})=>({id,category,name:id,position,size:[1,1,3],zone:'ชั้น 2',material:'คอนกรีต',source:'plan.pdf p2',revision:1,confidence:'shown',...extra});
const initial={...blankProject('ตึก 5 ชั้น'),id:'qa-building',elements:[
element('STAIR-L2-01','stairs',[0,0,4.5],{name:'บันไดชั้น 2',size:[1.2,4,3],steps:20}),
element('LANDING-L2','slab',[0,2.5,6],{size:[3,1,.2]}),
element('STAIR-L3-01','stairs',[30,0,7.5],{name:'บันไดชั้น 3',zone:'ชั้น 3',steps:20}),
...Array.from({length:500},(_,i)=>element('FAR-'+i,'column',[50+i*3,0,1.5]))
],documents:[{id:'drawing',name:'plan.pdf',type:'application/pdf',size:10}],activities:[]};
function Harness(){
const ai=useAiJob('qa-user');
const [project,setProject]=useState(()=>JSON.parse(localStorage.getItem('qa-edit-project')||'null')||initial);
const projectRef=useRef(project);projectRef.current=project;
const [panel,setPanel]=useState('chat'),[selected,setSelected]=useState('FAR-1');
const save=next=>{projectRef.current=next;localStorage.setItem('qa-edit-project',JSON.stringify(next));setProject(next)};
const apply=result=>save(applyEditPatch(project,result.patch,result.context));
return <div style={{maxWidth:700,margin:'20px auto',padding:12}}>
<button onClick={()=>setPanel(panel==='chat'?'generate':'chat')}>สลับแผง</button>
<button onClick={()=>setSelected('STAIR-L3-01')}>เลือกบันไดชั้น 3</button>
<button onClick={()=>save({...project,elements:project.elements.map(e=>e.id==='FAR-0'?{...e,material:'เหล็ก',revision:e.revision+1}:e)})}>แก้เสาห่างออกไปด้วยมือ</button>
<button onClick={()=>save({...project,elements:project.elements.map(e=>e.id==='STAIR-L2-01'?{...e,steps:30,revision:e.revision+1}:e)})}>แก้บันไดด้วยมือ</button>
<button onClick={()=>save({...project,id:'qa-st6',elements:[...Array.from({length:30},(_,i)=>element('ST6-'+(i+1),'stairs',[0,0,1.5+i*3],{name:'บันได ST6 ชั้น '+(i+1),zone:'ชั้น '+(i+1),size:[1.2,4,3],steps:20})),element('ST7-01','stairs',[40,0,1.5]),element('ST60-01','stairs',[50,0,1.5]),...Array.from({length:200},(_,i)=>element('REMOTE-'+i,'column',[100+i*3,0,1.5]))]})}>โหลดกลุ่ม ST6 30 ชิ้น</button>
<output data-testid="job-status">{ai.job?.status||'idle'}</output>
<output data-testid="stair-width">{project.elements.find(e=>e.id==='STAIR-L2-01')?.size[0]}</output>
{panel==='chat'?<AIChatPanel project={project} ai={ai} selectedId={selected} onApply={apply} onHistoryChange={history=>save({...projectRef.current,chatHistory:history})}/>:<AIPanel project={project} ai={ai} onStarted={()=>{}} getFile={async()=>new Blob(['drawing'])} onUpload={async()=>[]} onApply={save}/>}
</div>}
createRoot(document.getElementById('root')!).render(<Harness/>);
`);
const mock = express(); mock.use(express.json({limit: '1mb'}));
let activeId, finish, editRequest, generateRequest;
const edits = [], generations = [];
mock.use('/api', (req, _res, next) => {assert.equal(req.headers.authorization, 'Bearer qa-token'); next();});
mock.post('/api/edit', (req, res) => {
  validateEditRequest(req.body); editRequest = req.body; edits.push(req.body);
  activeId = startJob({uid: 'qa-user', ...req.body, mode: 'edit', prompt: req.body.displayPrompt, run: (_signal, update) => {update({stage: 'thinking', detail: 'กำลังอ่านเฉพาะพื้นที่'}); return new Promise(resolve => {finish = resolve;});}});
  res.status(202).json({jobId: activeId});
});
mock.post('/api/prepare', (_req, res) => res.json({files: [{name: 'plan.pdf', kind: 'text', text: 'prepared drawing', detail: 'test drawing'}]}));
mock.post('/api/generate', (req, res) => {
  generateRequest = req.body; generations.push(req.body);
  activeId = startJob({uid: 'qa-user', ...req.body, mode: 'generate', prompt: req.body.displayPrompt, run: () => new Promise(resolve => {finish = resolve;})});
  res.status(202).json({jobId: activeId});
});
mock.get('/api/jobs/current', (_req, res) => res.json({job: getLatestJob('qa-user')}));
mock.get('/api/jobs/:id/events', (req, res) => streamJob(req, res, 'qa-user'));
mock.get('/api/jobs/:id', (req, res) => res.json(getJob(req.params.id, 'qa-user')));
mock.delete('/api/jobs/:id', (req, res) => {cancelJob(req.params.id, 'qa-user'); res.status(204).end();});
const vite = await createServer({configFile: false, server: {host: '127.0.0.1', port: 0}, plugins: [{name: 'qa-model-edit', configureServer(server) {server.middlewares.use(mock);}}]});
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({channel: 'msedge', headless: true});
const page = await browser.newPage({viewport: {width: 1000, height: 1000}});
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.route('**/__qa-model-edit', route => route.fulfill({contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/.qa/model-edit-harness.tsx"></script>'}));
await page.route('**/src/cloud.ts*', route => route.fulfill({contentType: 'text/javascript', body: "export const auth={currentUser:{uid:'qa-user',getIdToken:async()=>'qa-token'}};export const db=null,storage=null,cloudConfigured=false;export async function logout(){}"}));
await page.route('**/src/AuthContext.tsx*', route => route.fulfill({contentType: 'text/javascript', body: "export const useAuth=()=>({firebaseUser:{uid:'qa-user'},userProfile:{uid:'qa-user',role:['Staff'],status:'approved'}});"}));
const send = async prompt => {
  await page.getByLabel('ข้อความถึง Chat AI', {exact: true}).fill(prompt);
  await page.getByRole('button', {name: 'ส่งคำสั่งให้ AI', exact: true}).click();
  await page.getByTestId('job-status').filter({hasText: 'running'}).waitFor();
};
const completeEdit = (updates, note) => finish({mode: 'edit', context: editRequest.context, patch: {updates, adds: [], removes: [], notes: [note]}, notes: [note]});
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('qa-edit-project')));
try {
  await page.goto(base + '/__qa-model-edit');
  await send('แก้บันไดชั้น 2 ให้กว้าง 1.5 m');
  assert.equal(edits.length, 1); assert.deepEqual(editRequest.context.targetIds, ['STAIR-L2-01']);
  assert.equal(editRequest.context.elements.length, 2); assert.equal(editRequest.files, undefined); assert.equal(editRequest.context.activities, undefined);
  await page.getByText(/ส่ง 2 จาก 503 ชิ้น/).waitFor();
  await page.getByRole('button', {name: 'แก้เสาห่างออกไปด้วยมือ', exact: true}).click();
  completeEdit([{id: 'STAIR-L2-01', changes: {size: [1.5, 4, 3]}}], 'แก้บันไดชั้น 2 สำเร็จ');
  await page.getByText(/แก้บันไดชั้น 2 สำเร็จ/).waitFor();
  await page.getByTestId('stair-width').filter({hasText: '1.5'}).waitFor();
  const next = await saved(); assert.equal(next.elements.length, 503); assert.equal(next.elements.find(e => e.id === 'FAR-0').material, 'เหล็ก'); assert.equal(next.documents.length, 1);
  assert.equal(generations.length, 0); assert.equal(next.chatHistory.at(-1).role, 'assistant');
  await page.screenshot({path: '.qa/model-edit-local.png', fullPage: true});

  // Ambiguity stays in the composer and does not make a paid provider request.
  await page.getByLabel('ข้อความถึง Chat AI', {exact: true}).fill('แก้บันได');
  await page.getByRole('button', {name: 'ส่งคำสั่งให้ AI', exact: true}).click();
  await page.getByText(/พบหลายชิ้น/).waitFor(); assert.equal(edits.length, 1);
  assert.equal(await page.getByLabel('ข้อความถึง Chat AI', {exact: true}).inputValue(), 'แก้บันได');

  // Explicit selected scope sends only that component; a reload resumes the edit job.
  await page.getByRole('button', {name: 'เลือกบันไดชั้น 3', exact: true}).click();
  await page.getByLabel('พื้นที่แก้ไข AI', {exact: true}).selectOption('selected');
  await send('เพิ่มจำนวนขั้นเป็น 24'); assert.deepEqual(editRequest.context.targetIds, ['STAIR-L3-01']);
  await page.reload(); await page.getByTestId('job-status').filter({hasText: 'running'}).waitFor();
  completeEdit([{id: 'STAIR-L3-01', changes: {steps: 24}}], 'แก้หลังโหลดหน้าใหม่สำเร็จ');
  await page.getByText(/แก้หลังโหลดหน้าใหม่สำเร็จ/).waitFor();
  assert.equal((await saved()).elements.find(e => e.id === 'STAIR-L3-01').steps, 24);

  // A changed target is protected against a late response from the provider.
  await send('แก้ STAIR-L2-01 ให้กว้าง 2 m');
  await page.getByRole('button', {name: 'แก้บันไดด้วยมือ', exact: true}).click();
  completeEdit([{id: 'STAIR-L2-01', changes: {size: [2, 4, 3]}}], 'old response');
  await page.locator('.ai-chat-error').getByText(/ระหว่างรอ AI/).waitFor();
  const protectedProject = await saved(); assert.equal(protectedProject.elements[0].size[0], 1.5); assert.equal(protectedProject.elements[0].steps, 30);

  // Regression for the user's screenshot: the 30-member ST6 group must not hit the old 20-target/50-operation limits.
  await page.getByRole('button', {name: 'โหลดกลุ่ม ST6 30 ชิ้น', exact: true}).click();
  await send('บันได ST6 ทั้งหมดยังไม่เชื่อมถึงกันเลย ช่วงชั้นกลางไม่มีพื้นเชื่อมกัน');
  assert.equal(editRequest.context.targetIds.length, 30);
  assert.ok(editRequest.context.targetIds.every(id => id.startsWith('ST6-')));
  assert.ok(!JSON.stringify(editRequest.context).includes('REMOTE-'));
  await page.getByText(/ส่ง 30 จาก 232 ชิ้น/).waitFor();
  const groupPatch = {
    updates: editRequest.context.targetIds.map(id => ({id, changes: {steps: 24}})),
    adds: Array.from({length: 29}, (_, i) => ({...editRequest.context.elements[0], id: 'LANDING-ST6-' + (i + 1), name: 'ชานพัก ST6 ' + (i + 1), category: 'slab', position: [0, 2.5, (i + 1) * 3], size: [1.2, 1, .2]})),
    removes: [], notes: ['แก้กลุ่ม ST6 พร้อมเพิ่มชานพักสำเร็จ'],
  };
  finish({mode: 'edit', context: editRequest.context, patch: groupPatch, notes: groupPatch.notes});
  await page.getByText(/แก้กลุ่ม ST6 พร้อมเพิ่มชานพักสำเร็จ/).waitFor();
  const groupProject = await saved(); assert.equal(groupProject.elements.length, 261);
  assert.ok(groupProject.elements.slice(0, 30).every(e => e.steps === 24 && e.revision === 2));
  assert.equal(groupProject.elements.find(e => e.id === 'ST7-01').revision, 1);
  assert.equal(groupProject.elements.find(e => e.id === 'ST60-01').revision, 1);
  await page.screenshot({path: '.qa/model-edit-st6-group.png', fullPage: true});

  // Generation remains a separate file-based workflow and does not append a previous full model to the prompt.
  await page.getByRole('button', {name: 'สลับแผง', exact: true}).click();
  assert.equal(await page.locator('.ai-result').count(), 0);
  await page.getByRole('button', {name: '1. อ่านและตรวจรายการไฟล์', exact: true}).click();
  await page.getByText('อ่านไฟล์เสร็จแล้ว ตรวจรายการก่อนสร้างโมเดล', {exact: true}).waitFor();
  await page.locator('.ai-panel textarea').fill('สร้างอาคารจากแบบ');
  await page.getByRole('button', {name: '2. สร้างโมเดลด้วย AI', exact: true}).click();
  await page.getByTestId('job-status').filter({hasText: 'running'}).waitFor();
  assert.equal(generations.length, 1); assert.equal(generateRequest.mode, 'generate'); assert.equal(generateRequest.files[0].text, 'prepared drawing'); assert.equal(generateRequest.context, undefined); assert.equal(generateRequest.prompt, 'สร้างอาคารจากแบบ');
  finish({project: protectedProject, notes: ['ผลสร้างจากแบบ']});
  await page.getByText('ผลสร้างจากแบบ', {exact: true}).waitFor();
  await page.getByRole('button', {name: '3. ยืนยันบันทึกลงโครงการนี้ใน 3D', exact: true}).waitFor();
  await page.screenshot({path: '.qa/model-edit-generation.png', fullPage: true});
  await page.getByRole('button', {name: 'สลับแผง', exact: true}).click();
  assert.equal(await page.locator('.ai-chat-thinking').count(), 0);
  assert.equal(edits.length, 4);
  for (const [width, height] of [[390, 844], [820, 1180]]) {await page.setViewportSize({width, height}); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));}
  await page.screenshot({path: '.qa/model-edit-mobile.png', fullPage: true});
  assert.deepEqual(errors, []);
  console.log('PASS: local edits and file-based generation stay separate; 2/503 elements sent, 30 ST6 targets plus 29 new landings in one patch, preserved other families/manual edits, ambiguity, selection, reload recovery, stale protection, persisted history, responsive UI; no browser errors');
} finally {
  if (activeId && getJob(activeId, 'qa-user').status === 'running') cancelJob(activeId, 'qa-user');
  await browser.close(); await vite.close();
}
