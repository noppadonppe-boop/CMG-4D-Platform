import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('.qa',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/__rebar_qa?*',r=>r.fulfill({contentType:'text/html',body:`<html><body style="margin:0;background:#edf2f2"><div id="root" style="width:100vw;height:100vh"></div><script type="module">
 const React=(await import('/node_modules/.vite/deps/react.js')).default,{createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default,{Canvas}=await import('/node_modules/.vite/deps/@react-three_fiber.js'),{Rebar}=await import('/src/ModelParts.tsx');
 const h=React.createElement,F={id:'F',category:'footing',position:[0,0,0],size:[2,2,.6],barDiameter:.016,barSpacing:.2,cover:.075},C={id:'C',category:'column',position:[0,0,.85],size:[.3,.3,1.5],barDiameter:.016,barSpacing:.15,cover:.04};
 window.renderRebar=(xray=true,close=false)=>{createRoot(document.getElementById('root')).render(h(Canvas,{camera:{position:close?[.9,-1.3,.75]:[3,-4,3],up:[0,0,1],fov:close?32:38},onCreated:({camera})=>{camera.lookAt(0,0,close?-.04:.5);window.rebarReady=true;}},h('ambientLight',{intensity:1.5}),h('directionalLight',{position:[3,-4,6],intensity:3}),h(Rebar,{e:F,elements:[F,C],xray}),h(Rebar,{e:C,elements:[F,C],xray})));};
 window.renderRebar(!location.search.includes('solid'),location.search.includes('close'));
 </script></body></html>`}));
 for(const mode of ['xray','solid','close']){
  await page.goto('http://127.0.0.1:5178/__rebar_qa?'+mode);await page.waitForFunction(()=>window.rebarReady);await page.waitForTimeout(1800);
  await page.screenshot({path:'.qa/rebar-'+mode+'.png'});
 }
 assert.deepEqual(errors,[]);console.log('PASS: actual Rebar component renders gray basket in solid, X-ray and close-up without browser errors');
}finally{await browser.close();}
