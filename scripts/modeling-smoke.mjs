import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {architecturalExample} from '../src/architectural-example.mjs';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1560,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 // Simulate saved Admin keys; real Firebase integration is covered by admin-smoke.mjs.
 await page.route('**/src/apiKeys.ts',route=>route.fulfill({contentType:'text/javascript',body:'export async function readApiKey(provider){return "test-only-admin-"+provider} export function watchKeys(uid,onChange){onChange([]);return ()=>{}} export async function saveApiKey(){} export async function deleteApiKey(){}'}));
 await page.goto(process.env.QA_URL||'http://127.0.0.1:5174');await page.locator('canvas').waitFor();
 await page.getByRole('button',{name:'เปิดบ้านตัวอย่าง',exact:true}).click();await page.waitForTimeout(500);
 const example=await page.evaluate(()=>JSON.parse(localStorage.getItem('cmg-workspace-v1')).at(-1));assert.equal(example.elements.length,77);
 await page.screenshot({path:'.qa/architecture.png',fullPage:true});
 // Reversible modeling tools and instanced reinforcement render without errors.
 await page.getByRole('button',{name:'ทำสำเนาชิ้นส่วน',exact:true}).click();
 await page.getByRole('button',{name:'ลบชิ้นส่วน',exact:true}).click();
 await page.getByTitle('ย้อนกลับการแก้โมเดลล่าสุด',{exact:true}).click();
 await page.getByTitle('ลากย้ายชิ้นส่วน Snap 0.05 m',{exact:true}).click();
 await page.getByText('เหล็กเสริมสาธิต',{exact:true}).click();
 await page.waitForTimeout(300);
 await page.getByText('เหล็กเสริมสาธิต',{exact:true}).click();
 await page.getByTitle('โปร่งใส',{exact:true}).click();
 await page.getByTitle('ลากย้ายชิ้นส่วน Snap 0.05 m',{exact:true}).click();
 // Native BIM property edit and opening alignment.
 await page.locator('.category-row[aria-controls=category-elements-window]').click();
 await page.getByRole('button',{name:'WIN00 หน้าต่าง WIN00',exact:true}).click();
 await page.getByLabel('หมุนรอบ Z',{exact:true}).fill('15');await page.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cmg-workspace-v1')).at(-1));assert.equal(saved.elements.find(e=>e.id==='WIN00').rotation,0);
 await page.locator('.category-row[aria-controls=category-elements-stairs]').click();
 await page.locator('.element-row').filter({hasText:'STAIR'}).click();assert.ok(await page.getByText('จำนวนขั้น',{exact:true}).isVisible());
 await page.getByRole('button',{name:'เล่นแผนงาน',exact:true}).click();await page.waitForTimeout(300);await page.getByRole('button',{name:'หยุด',exact:true}).click();
 await page.getByRole('button',{name:'สร้าง 3D ด้วย AI',exact:true}).click();
 assert.equal(await page.locator('.left-panel .upload-area').count(),0);
 await page.getByLabel('อัปโหลดแบบและ Timeline',{exact:true}).setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1kAAAAASUVORK5CYII=','base64')});
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cmg-workspace-v1')).at(-1).documents.length===1);
 assert.equal(await page.locator('.ai-files input[type=checkbox]').first().isChecked(),true);
 await page.getByRole('button',{name:'1. อ่านและตรวจรายการไฟล์',exact:true}).click();await page.getByText('อ่านไฟล์เสร็จแล้ว ตรวจรายการก่อนสร้างโมเดล',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('แหล่ง API Key',{exact:true}).count(),0);
 assert.equal(await page.getByLabel('API Key ชั่วคราว',{exact:true}).count(),0);
 const model=architecturalExample();let requested=false;
 await page.route('**/api/generate',async route=>{requested=true;const request=route.request().postDataJSON();assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.apiKey,'test-only-admin-openai');assert.equal(request.files[0].kind,'image');await route.fulfill({status:202,json:{jobId:'qa-job'}})});
 await page.route('**/api/jobs/qa-job',route=>route.fulfill({json:{id:'qa-job',status:'done',result:{project:model,notes:['QA simulated provider response']}}}));
 await page.getByRole('button',{name:'2. สร้างโมเดลด้วย AI',exact:true}).click();
 // The modal stays open while the job runs so the user can see and cancel it.
 await page.getByText('QA simulated provider response',{exact:true}).waitFor();
 await page.screenshot({path:'.qa/ai-workflow.png',fullPage:true});
 await page.getByRole('button',{name:'3. เปิดเป็นโครงการใหม่ใน 3D',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cmg-workspace-v1')).length===3);
 assert.ok(requested);const projects=await page.evaluate(()=>JSON.parse(localStorage.getItem('cmg-workspace-v1')));assert.equal(projects[2].documents.length,1);assert.ok(!JSON.stringify(projects).includes('test-only-admin-openai'));
 await page.reload();await page.locator('canvas').waitFor();assert.equal(await page.getByLabel('เลือกโครงการ',{exact:true}).locator('option').count(),3);
 for(const [width,height] of [[820,1180],[390,844]]){await page.setViewportSize({width,height});await page.waitForTimeout(250);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 assert.deepEqual(errors,[]);console.log('PASS: architecture, BIM host alignment, stairs, 4D playback, real file preparation, simulated AI request/result, source persistence, responsive layouts; no browser errors');
}finally{await browser.close()}


