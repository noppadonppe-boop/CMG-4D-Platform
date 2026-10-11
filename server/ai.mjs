import {categories,validateProject} from '../src/domain.mjs';
import {normalizeReinforcement} from '../src/reinforcementOwnership.mjs';
import {inspectModel} from '../src/geometry.mjs';
import {constructionSkillsPrompt,constructionSkills,reinforcementVisualizationKnowledge} from '../src/constructionSkills.mjs';
import {validateEditContext,validateEditPatch,normalizeEditPatch,applyEditPatch} from '../src/modelEdit.mjs';
import {models,effortOptions} from '../src/providers.mjs';
import {Agent,fetch as undiciFetch} from 'undici';
import {readFileSync} from 'node:fs';
import {readJobEvents} from '../src/jobEvents.mjs';
import {setTimeout as sleep} from 'node:timers/promises';
export {models};
// Node's default fetch gives up after 5 minutes without response headers ("fetch failed"),
// but a high-effort drawing read can take longer. The job layer owns the overall deadline.
// Anthropic can close long multipart requests with NGHTTP2_ENHANCE_YOUR_CALM.
// Use HTTP/1.1 for provider calls so the request does not share an HTTP/2
// stream/session that the upstream server may throttle.
const providerAgent=new Agent({headersTimeout:0,bodyTimeout:0,connectTimeout:30000,allowH2:false});
const providerFetch=(url,options)=>undiciFetch(url,{...options,dispatcher:providerAgent});
export function describeNetworkError(error){
 const cause=error?.cause;
 if(!cause)return error?.message||String(error);
 return (error.message||'fetch failed')+': '+(cause.code||cause.name||'')+(cause.message&&cause.message!==error.message?' '+cause.message:'');
}
const transientNetworkError = error => {
 const detail=describeNetworkError(error);
 return /ERR_HTTP2_STREAM_ERROR|NGHTTP2_ENHANCE_YOUR_CALM|UND_ERR_SOCKET|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED/i.test(detail);
};
async function fetchProvider(url,options,fetcher,signal){
 for(let attempt=0;;attempt++){
  try{return await fetcher(url,options);}
  catch(error){
   if(error?.name==='AbortError'||!transientNetworkError(error)||attempt>=2)throw error;
   await sleep(300*(2**attempt),undefined,{signal});
  }
 }
}
const ANTHROPIC_INLINE_LIMIT=24*1024*1024;
const ANTHROPIC_MESSAGE_LIMIT=32*1024*1024;
const bodyBytes=body=>Buffer.byteLength(JSON.stringify(body),'utf8');
async function externalizeAnthropicFiles(settings,request,signal,fetcher,onProgress=()=>{}){
 if(settings.provider!=='anthropic'||bodyBytes(request.body)<=ANTHROPIC_INLINE_LIMIT)return;
 const files=settings.files.filter(file=>(file.kind==='pdf'||file.kind==='image')&&typeof file.data==='string');
 if(!files.length)throw Error('คำขอ Anthropic ใหญ่เกิน 32 MB แม้ไม่มีไฟล์ไบนารีให้ย้ายไป Files API กรุณาลดข้อความหรือแบ่งแบบเป็นชุดเล็กลง');
 const uploaded=new Map();
  for(const file of files){
   onProgress({stage:'uploading',detail:'กำลังอัปโหลด '+file.name+' ไปยัง Anthropic Files API'});
  const form=new FormData();
  form.append('file',new Blob([Buffer.from(file.data,'base64')],{type:file.mime||'application/octet-stream'}),file.name);
  form.append('expires_in_seconds','3600');
  let response;
  try{response=await fetchProvider('https://api.anthropic.com/v1/files',{method:'POST',headers:{'x-api-key':settings.apiKey,'anthropic-version':'2023-06-01'},body:form,signal},fetcher,signal);}
  catch(error){if(error?.name==='AbortError')throw error;throw Error('เชื่อมต่อ Anthropic Files API ไม่สำเร็จ ('+describeNetworkError(error)+')');}
  const data=await providerJson(response);
  if(!response.ok||typeof data.id!=='string')throw Error('[anthropic/'+settings.model+'] อัปโหลดไฟล์ไป Anthropic Files API ไม่สำเร็จ: '+(data.error?.message||data.message||('API error '+response.status)));
  uploaded.set(file.name,data.id);
 }
 let sourceName='';
 for(const block of request.body.messages[0].content){
  if(block.type==='text'&&block.text.startsWith('SOURCE: ')){sourceName=block.text.slice(8);continue;}
  const fileId=uploaded.get(sourceName);
  if(fileId&&(block.type==='document'||block.type==='image'))block.source={type:'file',file_id:fileId};
 }
 if(bodyBytes(request.body)>ANTHROPIC_MESSAGE_LIMIT)throw Error('คำขอ Anthropic ยังใหญ่เกิน 32 MB หลังใช้ Files API กรุณาลดข้อความหรือแบ่งแบบเป็นชุดเล็กลง');
}
async function providerJson(response){
 // Keep the test fetcher contract (json()) while handling real providers that
 // return an HTML/proxy error instead of JSON.
 if(typeof response.text!=='function')return response.json();
 const raw=await response.text();
 if(!raw.trim())return {};
 try{return JSON.parse(raw)}catch{
  if(!response.ok)throw Error('ผู้ให้บริการ AI ตอบกลับไม่ใช่ JSON (HTTP '+response.status+'): '+raw.slice(0,240));
  throw Error('ผู้ให้บริการ AI ตอบกลับข้อมูลที่อ่านไม่ได้');
 }
}
async function readOpenAiStream(response,report,previousThinking=[]){
 let text='',completed;
 const summaries=new Map();
 const handle=event=>{
  if(event.type==='response.reasoning_summary_text.delta'){
   const key=(event.item_id||'reasoning')+':'+(event.summary_index||0);
   summaries.set(key,(summaries.get(key)||'')+(event.delta||''));
   report({stage:'thinking',detail:'ได้รับสรุปการวิเคราะห์จาก OpenAI…',thinking:[...previousThinking,...summaries.values()]});
  }else if(event.type==='response.output_text.delta'){
   text+=event.delta||'';
   report({stage:'generating',detail:'OpenAI กำลังส่งข้อมูลโมเดล…',thinking:[...previousThinking,...summaries.values()]});
  }else if(event.type==='response.completed'||event.type==='response.incomplete'){completed=event.response;return false;}
  else if(event.type==='response.failed'||event.type==='error')throw Error(event.response?.error?.message||event.error?.message||'OpenAI ยุติการประมวลผลก่อนเสร็จ');
 };
 await readJobEvents(response.body,handle);
 if(!completed)throw Error('สตรีมจาก OpenAI ขาดการเชื่อมต่อก่อนยืนยันผลลัพธ์ กรุณาลองใหม่');
 const data=completed&&typeof completed==='object'?{...completed}:{};
 const output=Array.isArray(data.output)?[...data.output]:[];
 if(summaries.size&&!output.some(item=>item.type==='reasoning'))output.unshift({type:'reasoning',summary:[...summaries.values()].map(text=>({type:'summary_text',text}))});
 if(text&&!output.some(item=>item.type==='message'&&(item.content||[]).some(content=>content.type==='output_text')))output.push({type:'message',role:'assistant',content:[{type:'output_text',text}]});
 return {...data,output,status:data.status||'completed'};
}
 const agentInstructions=readFileSync(new URL('../docs/AGENT_INSTRUCTIONS.md',import.meta.url),'utf8');
 const floorRequirement='MANDATORY FLOOR DECOMPOSITION: First inspect plans, elevations and sections to determine the physical story count. Always return a floors array, including for one-story buildings. When there are multiple stories, model every story as a separate floor and give every story-owned element its floor index. Split each column into one vertical segment per story at the same grid X/Y; never return a single column spanning stories. This requirement applies even when the user prompt is brief.';
 export const instructions=`${floorRequirement}
Reconstruct the attached architectural drawings into a detailed editable 3D building. Output ONLY a JSON object {name,description,floors,elements,activities,notes}. Use metres, Z up, shared global origin, all positions are centres. Read all drawings together and reconcile plans/elevations/sections. Match shown dimensions; do not duplicate floors or overlap parallel walls. Preserve all visible structural, architectural, finishing, roof-framing and MEP components. Categories: ${categories.join(', ')}.
Category distinctions: use pileCap, gradeBeam, shearWall, retainingWall, brace, truss, rafter, purlin, joist, roofDeck, ramp and tendon for those structural functions. Use partition for non-load-bearing partitions, curtainWall for curtain-wall assemblies, roof for the roof form, and roofCovering/roofFlashing/gutter for roof finish and drainage pieces. Use floorFinish, wallFinish, ceiling, skirting and casework for architectural finishes and built-ins. Use duct, pipe, conduit, cableTray and the equipment/fixture categories for MEP; keep those systems separate from structure and architecture. Category describes function; material describes what it is made from, so a steel purlin remains category purlin with material steel. For a shown component with no exact category, use customComponent and a properties.geometry JSON string with version 1 and box, cylinder, or hollowSquareTube parts; preserve callout names/materials, use drawing dimensions, and mark inferred geometry/dimensions as assumed in confidence and notes. For a rafter with a shown pitch, set properties.pitchDegrees to the angle in degrees. Do not infer missing structural dimensions or MEP routing.
For a multi-story building, return floors:[{id,index,name,elevation,height}] with one entry per physical story (ground floor index 0 unless the drawings clearly use another convention). Give every story-owned element a floor integer. Build slabs, beams, walls, doors, windows, stairs and roofs separately for each story when shown. Columns must be separate vertical segments for each story: keep the same grid X/Y, set each segment's floor, and use size Z equal to that story's clear height; do not return one column spanning several stories. Keep foundations, piles and excavation on floor 0 or omit floor when they are below the building. The viewer can explode floors using this metadata.
 Each element: {id,category,name,position:[x,y,z],size:[width,depth,height],floor:integer,rotation:degreesAroundZ,zone,material,source:"filename and page/detail",revision:1,confidence:"shown|derived|assumed",properties:{string:string}}. Optional steps integer 2..100 for stairs (run along local +Y), cover/barDiameter/barSpacing in metres for reinforcement; hostId for door/window links to wall or partition. Doors/windows must share host rotation and wall plane, be fully within its boundaries; renderer cuts openings automatically. For customComponent, properties.geometry is a JSON string {"version":1,"parts":[...]}; each part position is relative to the component centre, dimensions are metres, rotations are degrees, and supported part types are box (size), cylinder (diameter,length), and hollowSquareTube (width,depth,length,wallThickness). Rotation is local to element centre. Frame is local X width, Y thickness, Z height. Elevator is a cab; model shaft walls separately. Roofs support roofStyle:flat or gable. For gable, size Z is total ridge rise; two pitched panels are generated. Use gable only when shown. Never claim invisible detail is shown: explicitly label assumptions and list in notes. Rebar parameters without explicit drawing dimensions must be assumed. Use the reinforcement visualization standard below for footing/column cages. Use independent rebar elements for actual shown rods only when a distinct bar group is shown; do not create a generic demo. For insufficient scale use the user's reference dimension or mark dimensional assumptions. Activities: [{id,name,start:"YYYY-MM-DD",end:"YYYY-MM-DD",categories:[],elementIds:[valid element IDs]}]. Read supplied timeline if present; absent timeline return [] (do not invent dates). No markdown or executable code. Maximum 3000 elements. Complete all JSON arrays. Notes must describe omissions and unresolved ambiguities.

Central construction skill library. Apply the matching skill whenever the user names or implies that work package, including during edits of an existing model:
${constructionSkillsPrompt}

 Reinforcement visualization standard:
 ${reinforcementVisualizationKnowledge}

Additional Agent role and visualization instructions:
${agentInstructions}

CMG integration rule: the additional Agent instructions are guidance for this workspace. The JSON project contract above always wins: return the complete editable project JSON, not a standalone HTML file. Preserve unaffected elements and IDs during edits.
Output compact JSON without markdown or extra whitespace. Omit optional properties when they are not shown in the drawings; do not repeat the same object or verbose explanations inside element fields.`;
const expandOutputBudget = body => { body.max_output_tokens = 64000; };
export const editInstructions = `Edit only the supplied local region of an existing 3D model. Return ONLY compact JSON {updates:[{id,changes:{field:value}}],adds:[complete new element],removes:[id],notes:[string]}. Always include all four arrays, even when empty. Never return a complete project or repeat unchanged elements. Only targetIds may be updated or removed. Other supplied elements are read-only context; host movement automatically moves their hosted doors/windows. New elements must be local to the targets and have unique IDs. Use metres, Z up, centre positions and rotation in degrees around Z. Allowed changes: category,name,position,size,rotation,zone,material,source,confidence,properties,roofStyle,hostId,steps,cover,barDiameter,barSpacing. Never change id or revision. Null may clear an optional field. A new element requires id,category,name,position:[x,y,z],size:[width,depth,height],zone,material,source,revision:1,confidence; properties is a string-to-string object. Categories: ${categories.join(',')}. Category describes function and material describes composition; use purlin with material steel for a steel purlin. If a requested part has no exact category, use customComponent and properties.geometry using the supported custom part JSON contract. Use rafter properties.pitchDegrees only when the pitch is shown. Keep MEP separate from structure and architecture, and do not invent missing structural sizes or MEP routes. Stairs run along local +Y, steps is an integer 2..100. Doors/windows must fit their hostId wall or partition with the same plane and rotation. Preserve physical connections, dimensions and levels. For reinforcement edits, preserve the footing/column cage roles, bent starter-bar hooks, closed column stirrups, and denser joint stirrups required by the reinforcement visualization standard; do not replace them with generic straight rods. Do not invent drawing evidence or engineering calculations; describe assumptions in notes. No timeline edits. If the request needs unavailable drawing detail, targets, or wider context, return empty changes and explain exactly what must be supplied or selected. For a question, return the answer in notes with empty change arrays. The patch contract takes priority over work-package guidance.`;
export function parseEditModel(text,context){
 let patch;try{patch=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('AI ส่งรายการแก้ไข JSON ไม่ครบ');}
 patch=normalizeEditPatch(patch,context);
 validateEditPatch(patch,context);
 applyEditPatch({id:context.projectId,name:context.summary.name,description:context.summary.description,elements:context.elements,activities:[],documents:[],audit:[],updatedAt:''},patch,context);
 return {mode:'edit',patch,context,notes:patch.notes};
}
export function providerRequest({provider,model,effort,files=[],prompt,mode='generate',context,history=[]}){
 if(!models[provider]?.includes(model)||!effortOptions[provider]?.some(option=>option.value===effort))throw Error('โมเดลหรือระดับการคิดไม่รองรับ');
 const editing=mode==='edit';
 if(editing)validateEditContext(context);
 const normalizedPrompt=prompt.toLocaleLowerCase('th');
 const skills=editing?constructionSkills.filter(skill=>skill.id!=='create-3d'&&(skill.categories.some(category=>context.elements.some(element=>element.category===category))||prompt.includes(skill.name)||(skill.keywords||[]).some(keyword=>normalizedPrompt.includes(keyword.toLocaleLowerCase('th'))))).map(skill=>skill.name+': '+skill.instruction).join('\n'):'';
 const guidance=editing?editInstructions+'\nApplicable construction guidance:\n'+skills:instructions;
 const requirements=editing?prompt+'\nRecent conversation (background only; current model data below is authoritative):\n'+JSON.stringify(history)+'\nCurrent local model context:\n'+JSON.stringify(context):floorRequirement+'\nUser request:\n'+prompt;
 const budget=editing?Math.min(32000,Math.max(8000,Math.ceil(context.targetIds.length/20)*8000)):32000;
 if(editing)files=[];
 const supported=files.filter(f=>f.kind!=='unsupported');
 if(provider==='google')return {url:'https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',body:{contents:[{role:'user',parts:[{text:guidance+'\nUser requirements:\n'+requirements},...supported.flatMap(f=>[{text:'SOURCE: '+f.name},f.kind==='text'?{text:f.text}:{inlineData:{mimeType:f.mime,data:f.data}}])]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:budget,thinkingConfig:{thinkingLevel:effort,includeThoughts:true}}}};
 const content=[];
 const addText=text=>content.push(provider==='openai'?{type:'input_text',text}:{type:'text',text});
 addText(guidance+'\nUser requirements:\n'+requirements);
 for(const f of supported){addText('SOURCE: '+f.name);if(f.kind==='text')addText(f.text);else if(provider==='openai')content.push(f.kind==='pdf'?{type:'input_file',filename:f.name,file_data:'data:application/pdf;base64,'+f.data}:{type:'input_image',image_url:`data:${f.mime};base64,${f.data}`,detail:'high'});else content.push({type:f.kind==='pdf'?'document':'image',source:{type:'base64',media_type:f.mime,data:f.data}});}
 if(provider==='openai')return {url:'https://api.openai.com/v1/responses',body:{model,...(effort==='off'?{}:{reasoning:{effort,summary:'auto'}}),stream:true,max_output_tokens:budget,text:{format:{type:'json_object'}},input:[{role:'user',content}]}};
 return {url:'https://api.anthropic.com/v1/messages',body:{model,max_tokens:budget,...(effort==='off'?{thinking:{type:'disabled'},output_config:{effort:'low'}}:{thinking:{type:'adaptive',display:'summarized'},output_config:{effort}}),messages:[{role:'user',content}]}};
}
export function parseModel(text){
 let data;try{data=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('AI ส่ง JSON ไม่ครบ กรุณาลดจำนวนแบบหรือแบ่งทีละชั้นแล้วลองใหม่');}
 if(typeof data.description!=='string')throw Error('AI ไม่ส่งคำอธิบายโมเดลที่ถูกต้อง');
 if(Array.isArray(data.elements))data.elements=data.elements.map(e=>({...e,confidence:e.confidence||'assumed'}));
 const suppliedFloors=Array.isArray(data.floors)?data.floors:[];
 const inferredIndexes=[...new Set((Array.isArray(data.elements)?data.elements:[]).map(element=>Number.isInteger(element?.floor)?element.floor:0))].sort((a,b)=>a-b);
 const floors=suppliedFloors.length?suppliedFloors:(inferredIndexes.length?inferredIndexes:[0]).map(index=>({id:'FLOOR-'+index,index,name:index===0?'ชั้น 1':`ชั้น ${index+1}`,elevation:index*3,height:3}));
 let project={...data,floors,id:crypto.randomUUID(),documents:[],audit:[],updatedAt:new Date().toISOString()};
 if(!project.elements?.length||project.elements.length>3000||!validateProject(project))throw Error('ข้อมูลโมเดลจาก AI ไม่ผ่านการตรวจขนาด/ตำแหน่ง/แผนงาน กรุณาระบุรายละเอียดเพิ่มแล้วลองใหม่');
 project=normalizeReinforcement(project);
 validateStorySegmentation(project);
 const openingIssues=inspectModel(project.elements).filter(issue=>issue.code.startsWith('opening-'));
 if(openingIssues.length)throw Error('แก้ความสัมพันธ์ช่องเปิด: '+openingIssues.map(issue=>issue.ids.join('/')+' '+issue.message).join('; '));
 const notes=Array.isArray(data.notes)?data.notes.map(String):[String(data.notes||'')];
 notes.unshift(`AI แบ่งข้อมูลโมเดลเป็น ${floors.length} ชั้น และกำหนดชิ้นส่วนตามชั้นแล้ว`);
 return {project,notes};
}

function validateStorySegmentation(project){
 const floors=Array.isArray(project.floors)?project.floors:[];
 if(floors.length<2)return;
 const byIndex=new Map(floors.map(floor=>[floor.index,floor]));
 for(const element of project.elements.filter(item=>item.category==='column')){
  const floor=byIndex.get(element.floor);
  if(!floor)throw Error(`อาคารหลายชั้นต้องระบุ floor ให้เสา ${element.id} และแยกเสาเป็นช่วงต่อชั้น`);
  if(element.size[2]>floor.height+.25)throw Error(`เสา ${element.id} ยังพาดข้ามหลายชั้น: แยกเป็นเสาต่อชั้นและใช้ความสูงไม่เกิน ${floor.height.toFixed(2)} m`);
 }
}

export function extractThinking(data,provider){
 if(provider==='openai')return (data.output||[]).filter(item=>item.type==='reasoning').flatMap(item=>item.summary||[]).map(part=>part.text).filter(text=>typeof text==='string'&&text.trim());
 if(provider==='anthropic')return (data.content||[]).filter(block=>block.type==='thinking').map(block=>block.thinking).filter(text=>typeof text==='string'&&text.trim());
 return (data.candidates?.[0]?.content?.parts||[]).filter(part=>part.thought&&typeof part.text==='string').map(part=>part.text).filter(text=>text.trim());
}

export const editModel=(settings,signal,fetcher,onProgress)=>generateModel({...settings,mode:'edit',files:[]},signal,fetcher,onProgress);

export async function generateModel(settings,signal,fetcher=providerFetch,onProgress=()=>{}){
 if(!settings.apiKey?.trim())throw Error('กรุณาใส่ API Key');
 const report=patch=>{try{onProgress(patch);}catch{/* status updates must never interrupt generation */}};
 report({stage:'preparing',detail:'กำลังเตรียมคำขอและไฟล์'});
 const request=providerRequest(settings);
 if(settings.mode!=='edit')await externalizeAnthropicFiles(settings,request,signal,fetcher,report);
 let lengthRetry=false,correctionRetry=false;
 let attempt=1;
 let thinking=[];
 for(;;){
  report({stage:'thinking',detail:'กำลังให้ '+(settings.provider==='openai'?'OpenAI':settings.provider==='anthropic'?'Anthropic':'Google Gemini')+(settings.mode==='edit'?' วิเคราะห์เฉพาะส่วนและตอบรายการแก้ไข':' วิเคราะห์แบบและตอบกลับ')+' · รอบ '+attempt,attempt});
  let response;
  try{response=await fetchProvider(request.url,{method:'POST',headers:{'Content-Type':'application/json',...(settings.provider==='google'?{'x-goog-api-key':settings.apiKey}:settings.provider==='openai'?{Authorization:'Bearer '+settings.apiKey}:{'x-api-key':settings.apiKey,'anthropic-version':'2023-06-01'})},body:JSON.stringify(request.body),signal},fetcher,signal);}
  catch(error){if(error?.name==='AbortError')throw error;throw Error('เชื่อมต่อผู้ให้บริการ AI ไม่สำเร็จ ('+describeNetworkError(error)+')');}
  const data=await (response.ok&&settings.provider==='openai'&&request.body.stream&&response.body?.getReader?readOpenAiStream(response,report,thinking):providerJson(response));if(!response.ok){const providerError=typeof data.error==='string'?data.error:data.error?.message;const invalidAnthropicKey=settings.provider==='anthropic'&&response.status===401&&/invalid\s+x-api-key/i.test(providerError||'');if(invalidAnthropicKey)throw Error('['+settings.provider+'/'+settings.model+'] Anthropic ปฏิเสธ API Key นี้: ตรวจว่าเป็น Key ของ Anthropic ที่ขึ้นต้นด้วย sk-ant- และบันทึกในช่อง Anthropic แล้ว ไม่ใช่ Key ของ OpenAI หรือ Google');throw Error('['+settings.provider+'/'+settings.model+'] '+(providerError||data.message||('API error '+response.status)));}
  const responseThinking=extractThinking(data,settings.provider);
  if(responseThinking.length){thinking=[...thinking,...responseThinking].slice(-8);report({stage:'thinking',detail:'ได้รับสรุปการวิเคราะห์จากผู้ให้บริการแล้ว',thinking});}
  else report({stage:'reading',detail:'ได้รับคำตอบแล้ว กำลังอ่านผลลัพธ์'});
  const incompleteReason=data.incomplete_details?.reason||data.stop_reason||data.candidates?.[0]?.finishReason;
  const truncated=data.status==='incomplete'||incompleteReason==='max_output_tokens'||incompleteReason==='max_tokens'||incompleteReason==='MAX_TOKENS';
  if(truncated){
   // Responses API can report an incomplete response before returning any
   // usable JSON. Retry OpenAI once with a larger output budget; the other
   // providers keep their existing truncation behavior and error immediately.
   if(settings.provider==='openai'&&!lengthRetry){lengthRetry=true;if(settings.mode==='edit')request.body.max_output_tokens=Math.min(64000,request.body.max_output_tokens*2);else expandOutputBudget(request.body);attempt++;report({stage:'retrying',detail:'ผลลัพธ์ยาวเกินขีดจำกัด กำลังลองใหม่ด้วยความยาวที่เพิ่มขึ้น · รอบ '+attempt,attempt});continue;}
   throw Error('โมเดลยาวเกินขีดจำกัด'+(settings.provider==='openai'?' แม้ลองเพิ่มความยาวผลลัพธ์แล้ว':'')+' กรุณาแบ่งแบบเป็นชุดเล็กลง');
  }
  if(settings.provider==='google'&&(data.promptFeedback?.blockReason||!data.candidates?.[0]?.content?.parts?.some(p=>p.text&&!p.thought)))throw Error('Google ไม่ส่งผลลัพธ์: '+(data.promptFeedback?.blockReason||data.candidates?.[0]?.finishReason||'empty response'));
  const text=settings.provider==='google'?(data.candidates?.[0]?.content?.parts||[]).filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''):settings.provider==='openai'?(data.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join(''):(data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
  report({stage:'validating',detail:'กำลังตรวจ JSON และความสัมพันธ์ของ geometry'});
  try {const result=settings.mode==='edit'?parseEditModel(text,settings.context):parseModel(text);if(correctionRetry)result.notes.push('AI แก้ไขรูปแบบข้อมูลหรือช่องเปิดอัตโนมัติ 1 รอบหลังตรวจ geometry');return {...result,thinking};}
  catch(error){
   if(correctionRetry)throw Error('AI ยังคืนโมเดลที่ไม่ถูกต้องหลังแก้ไข 1 รอบ: '+error.message);
    correctionRetry=true;
    attempt++;
    report({stage:'repairing',detail:'พบข้อมูลที่ต้องแก้ กำลังให้ AI ตรวจซ้ำ · รอบ '+attempt,attempt});
   const correction=(settings.mode==='edit'?'Repair only the previous PATCH using the supplied local context. Return {updates,adds,removes,notes}; do not return a project or modify read-only neighbors. If context is insufficient return empty changes and explain in notes.':'Repair the previous JSON using the original drawings. Keep correct dimensions and all valid elements. Return the COMPLETE corrected JSON, not a patch. Do not remove doors/windows merely to suppress errors.')+' Validation error: '+error.message;
    if(settings.provider==='openai')request.body.input.push(...(Array.isArray(data.output)?data.output:[{role:'assistant',content:[{type:'output_text',text}]}]),{role:'user',content:[{type:'input_text',text:correction}]});
   else if(settings.provider==='google')request.body.contents.push({...data.candidates[0].content,role:'model'},{role:'user',parts:[{text:correction}]});
    else request.body.messages.push({role:'assistant',content:data.content||[{type:'text',text}]},{role:'user',content:[{type:'text',text:correction}]});
  }
 }
}
