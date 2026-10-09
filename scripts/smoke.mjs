// Optional browser QA: node scripts/smoke.mjs <absolute playwright index.mjs>
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.argv[2]?pathToFileURL(process.argv[2]).href:'playwright');
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await fs.mkdir('.qa',{recursive:true});
try {
 await page.goto('http://127.0.0.1:5173');
 await page.locator('canvas').waitFor();await page.waitForTimeout(1500);
 assert.equal(await page.getByText('เปิดโมเดล 3D ไม่สำเร็จ').count(),0);
 await page.getByRole('spinbutton').first().fill('2.5');
 await page.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click();
 await page.reload();await page.getByRole('spinbutton').first().waitFor();
 assert.equal(await page.getByRole('spinbutton').first().inputValue(),'2.5');
 for(const name of ['+X','-X','+Y','-Y','+Z','-Z','ISO'])await page.getByRole('button',{name,exact:true}).click();
 await page.getByTitle('สลับการฉายภาพ',{exact:true}).click();
 await page.getByRole('button',{name:'แผนงาน 4D',exact:true}).click();
 await page.getByRole('button',{name:'แก้แผนงาน',exact:false}).click();
 await page.getByRole('button',{name:'เพิ่มกิจกรรม',exact:true}).click();
 const links=page.locator('.activity-links').last();await links.locator('summary').click();
 await links.getByRole('checkbox').first().check();
 await page.getByRole('button',{name:'ใช้แผนงานนี้',exact:true}).click();
 const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('cmg-workspace-v1')));
 assert.deepEqual(data[0].activities.at(-1).elementIds,['F-001']);
 await page.getByRole('button',{name:'Cloud',exact:true}).click();
 await page.getByText('พร้อมตั้งค่า Firebase',{exact:true}).waitFor();
 await page.getByRole('button',{name:'ปิด',exact:true}).click();
 await page.locator('input[type=file]').first().setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1kAAAAASUVORK5CYII=','base64')});
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cmg-workspace-v1'))[0].documents.length===1);
 await page.getByRole('button',{name:'ดูเอกสารทั้งหมด',exact:false}).click();
 await page.getByRole('button',{name:/^reference.png/}).click();
 await page.getByRole('img',{name:'reference.png'}).waitFor();
 await page.locator('.file-preview .icon-btn').click();
 await page.getByRole('button',{name:'ปิด',exact:true}).click();
 for(const [name,width,height] of [['desktop',1440,1000],['tablet',820,1180],['phone',390,844]]) {
  await page.setViewportSize({width,height});await page.waitForTimeout(400);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: horizontal overflow`);
  await page.screenshot({path:`.qa/${name}.png`,fullPage:true});
  assert.ok(await page.locator('canvas').isVisible(),`${name}: model hidden`);
  if(width<1200){await page.getByRole('button',{name:'ข้อมูล',exact:true}).click();assert.ok(await page.getByRole('spinbutton').first().isVisible());await page.getByRole('button',{name:'โมเดล',exact:true}).click();}
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByLabel('ชนิดชิ้นส่วนใหม่',{exact:true}).selectOption('column');
 await page.getByTitle('เพิ่มชิ้นส่วน',{exact:true}).click();
 const afterAdd=await page.evaluate(()=>JSON.parse(localStorage.getItem('cmg-workspace-v1'))[0]);
 assert.equal(afterAdd.elements.at(-1).category,'column');assert.equal(afterAdd.elements.length,18);
 await page.getByTitle('เพิ่มโครงการ',{exact:true}).click();
 await page.getByPlaceholder('เช่น โรงงานโซน A').fill('QA project B');
 await page.getByRole('button',{name:'สร้างโครงการ',exact:true}).click();
 assert.equal(await page.getByLabel('เลือกโครงการ',{exact:true}).locator('option').count(),2);
 const projects=await page.evaluate(()=>JSON.parse(localStorage.getItem('cmg-workspace-v1')));
 assert.equal(projects[1].documents.length,0);assert.equal(projects[1].elements.length,17);assert.equal(projects[0].elements.length,18);
 assert.deepEqual(errors,[]);console.log('PASS: model, edit persistence, seven views, orthographic, 4D links, local attachments, Cloud setup, desktop/tablet/phone layouts, member creation, independent projects; no page errors.');
} finally {await browser.close();}
