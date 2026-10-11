import {chromium,expect} from '@playwright/test';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import fs from 'node:fs/promises';
const projectId='demo-cmg-auth',rules=await fs.readFile('firestore.rules','utf8');
const environments=[];
async function installRules(content){environments.push(await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8280,rules:content}}));}
await fetch(`http://127.0.0.1:8280/emulator/v1/projects/${projectId}/databases/(default)/documents`,{method:'DELETE'});
await fetch(`http://127.0.0.1:9299/emulator/v1/projects/${projectId}/accounts`,{method:'DELETE'});
await installRules(rules);
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5176/register');
 await page.locator('form input').nth(0).fill('Admin');await page.locator('form input').nth(1).fill('Tester');await page.locator('form input').nth(2).fill('Engineer');await page.locator('input[type=email]').fill('recovery@example.test');await page.locator('input[type=password]').fill('password123');await page.getByRole('button',{name:'สมัครใช้งาน',exact:true}).click();await page.waitForURL('**/dashboard');
 await installRules(rules.replaceAll('if master() && request.auth.token.email==email','if false && request.auth.token.email==email'));
 await page.getByRole('button',{name:'Admin',exact:true}).click();
 await expect(page.getByText('ตรวจสอบสถานะ Key ไม่สำเร็จ',{exact:true})).toHaveCount(3);
 await expect(page.getByText('ยังไม่ได้ตั้งค่า',{exact:true})).toHaveCount(0);
 const card=page.locator('.key-card').filter({has:page.getByRole('heading',{name:'OpenAI',exact:true})});
 await card.locator('input').fill('test-key-recovery-1234');await card.getByRole('button',{name:'บันทึก Key',exact:true}).click();
 await expect(card.getByRole('button',{name:'บันทึก Key',exact:true})).toBeEnabled();
 await expect(card.locator('input')).toHaveValue('test-key-recovery-1234');
 console.log('PASS denied reads show unknown status; failed save retains draft');
 await installRules(rules);await page.getByRole('button',{name:'ลองโหลด Key ใหม่',exact:true}).click();
 await expect(page.getByText('ยังไม่ได้ตั้งค่า',{exact:true})).toHaveCount(3);await expect(page.locator('.admin-panel [role=alert]')).toHaveCount(0);await expect(card.locator('input')).toHaveValue('test-key-recovery-1234');
 console.log('PASS retry recovers terminated listener and clears stale errors without losing draft');
 for(const provider of ['OpenAI','Anthropic','Google AI Studio']){
  const c=page.locator('.key-card').filter({has:page.getByRole('heading',{name:provider,exact:true})});
  await c.locator('input').fill('test-key-save-1234');await c.getByRole('button',{name:'บันทึก Key',exact:true}).click();await expect(c.getByText('บันทึกแล้ว ••••1234',{exact:true})).toBeVisible();
  await c.locator('input').fill('test-key-replaced-5678');await c.getByRole('button',{name:'เปลี่ยน Key',exact:true}).click();await expect(c.getByText('บันทึกแล้ว ••••5678',{exact:true})).toBeVisible();
 }
 await page.reload();await page.getByRole('button',{name:'Admin',exact:true}).click();await expect(page.getByText('บันทึกแล้ว ••••5678',{exact:true})).toHaveCount(3);
 for(const provider of ['OpenAI','Anthropic','Google AI Studio']){await page.getByRole('button',{name:'ลบ Key '+provider,exact:true}).click();await expect(page.getByRole('button',{name:'ลบ Key '+provider,exact:true})).toBeDisabled();}
 await expect(page.getByText('ยังไม่ได้ตั้งค่า',{exact:true})).toHaveCount(3);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.qa/admin-recovery-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
 console.log('PASS browser save/replace/persist/delete all providers; mobile layout; no runtime errors');
}finally{await installRules(rules);await browser.close();for(const env of environments)await env.cleanup();}
