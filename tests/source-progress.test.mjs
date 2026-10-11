import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOpenAiSourceInputs} from '../server/mcpIntegration.mjs';
const files=[{fileId:'a',name:'plan.pdf',kind:'pdf'},{fileId:'b',name:'section.pdf',kind:'pdf'}];
test('each actual source download records its filename without claiming analysis',async()=>{
 const progress=[];const bucket={file:()=>({download:async()=>[Buffer.from('%PDF')]})};
 const inputs=await loadOpenAiSourceInputs('p',files,p=>progress.push(p),bucket);
 assert.equal(inputs.filter(i=>i.type==='input_file').length,2);
 assert.deepEqual(progress.filter(p=>p.event).map(p=>p.event.key),['source:a','source:b']);
 assert.ok(progress.every(p=>!p.detail.includes('วิเคราะห์เสร็จ')));
});
test('failed file download reports the exact file and never reports it loaded',async()=>{
 const progress=[];const bucket={file:()=>({download:async()=>{throw Error('download failed');}})};
 await assert.rejects(loadOpenAiSourceInputs('p',files,p=>progress.push(p),bucket),/plan.pdf/);
 assert.equal(progress.at(-1).event.stage,'error');
 assert.ok(!progress.some(p=>p.event?.stage==='file_loaded'));
});
test('large Storage PDFs use a temporary URL instead of loading bytes into base64',async()=>{
 const bucket={file:()=>({getMetadata:async()=>[{size:String(64*1024*1024)}],getSignedUrl:async()=>['https://storage.example.test/large-plan.pdf'],download:async()=>{throw Error('download should not be called')}})};
 const inputs=await loadOpenAiSourceInputs('p',[{fileId:'large',name:'large-plan.pdf',kind:'pdf'}],()=>{},bucket);
 assert.deepEqual(inputs.find(input=>input.type==='input_file'),{type:'input_file',file_url:'https://storage.example.test/large-plan.pdf',detail:'high'});
});
