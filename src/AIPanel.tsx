import {useEffect,useRef,useState} from 'react';
import {Upload} from 'lucide-react';
import type {Project} from './domain.mjs';
import {inspectModel} from './geometry.mjs';
import type {GenerateResult,AiJobControl,McpGenerateRequest,McpResult} from './aiJob';
import type {Provider} from './apiKeys';
import {models,providers,effortOptions,defaultProvider,defaultModel,defaultEffort} from './providers.mjs';
import {auth} from './cloud';
import {useAuth} from './AuthContext';
import type {FileUploadProgress} from './projectService';
import AdminPanel from './AdminPanel';
import AiJobActivity from './AiJobActivity';

type Input={fileId:string;name:string;kind:string;detail:string;data?:string;text?:string;mime?:string};
type PanelMessage={role:'user'|'assistant';text:string};
const base64=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('อ่านไฟล์ไม่ได้'));reader.readAsDataURL(blob)});
const wait=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds));
const retryablePrepareStatuses=new Set([500,502,503,504]);
const INLINE_PREPARE_BYTES=8*1024*1024;

export default function AIPanel({project,getFile,onUpload,onApply,ai,onStarted}:{ai:AiJobControl;onStarted:()=>void;project:Project;getFile:(key:string)=>Promise<Blob|undefined>;onUpload:(files:FileList|null,onProgress?:(progress:FileUploadProgress)=>void)=>Promise<string[]>;onApply:(p:Project)=>void|Promise<void>}){
 const {userProfile}=useAuth();
 const [provider,setProvider]=useState<Provider>(defaultProvider as Provider);
 const [model,setModel]=useState(defaultModel);
 const [effort,setEffort]=useState(defaultEffort);
 const [prompt,setPrompt]=useState(project.description);
 const [selected,setSelected]=useState(project.documents.map(document=>document.id));
 const [files,setFiles]=useState<Input[]>([]);
 const [working,setBusy]=useState(false);
 const [stage,setStage]=useState('');
 const [error,setError]=useState('');
 const [result,setResult]=useState<GenerateResult|null>(null);
 const [admin,setAdmin]=useState(false);
 const [cancelling,setCancelling]=useState(false);
 const [uploadProgress,setUploadProgress]=useState<FileUploadProgress|null>(null);
 const [uploading,setUploading]=useState(false);
 const running=ai.job?.status==='running';
 const busy=working||running;
 const job=ai.job && ai.job.projectId===project.id && (ai.job.mode==='generate'||ai.job.mode==='mcp') ? ai.job : null;
 const generated:GenerateResult|null=job?.status==='done'&&job.result&&'project' in job.result?job.result as GenerateResult:null;
 const visibleResult=generated||result;
 const mcpResult:McpResult|null=job?.status==='done'&&job.result?.mode==='mcp'?job.result as McpResult:null;
 const messages:PanelMessage[]=job?[{role:'user',text:job.prompt||'สร้างโมเดลตามแบบที่เลือก'} as PanelMessage,...(generated?[{role:'assistant',text:job.model+' · '+generated.project.elements.length+' ชิ้นส่วน\n'+generated.notes.join('\n')} as PanelMessage]:[])]:[];

 useEffect(()=>{setResult(generated)},[job?.id,job?.status,job?.result]);
 useEffect(()=>{if(job?.prompt)setPrompt(job.prompt);if(!job?.provider)return;const nextProvider=job.provider as Provider;if(nextProvider in models){setProvider(nextProvider);if(models[nextProvider].includes(job.model))setModel(job.model);if(effortOptions[nextProvider].some(option=>option.value===job.effort))setEffort(job.effort)}},[job?.id]);
 const fileInput=useRef<HTMLInputElement>(null);
 const abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 useEffect(()=>{
  setSelected(project.documents.map(document=>document.id));
  setPrompt(project.description);
  setFiles([]);
  setResult(null);
  setStage('');
  setError('');
  if(fileInput.current)fileInput.current.value='';
 },[project.id]);

 const call=async(url:string,data:unknown)=>{if(!auth?.currentUser)throw Error('กรุณาเข้าสู่ระบบ');const token=await auth.currentUser.getIdToken();const request=()=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...data as object,projectId:project.id}),signal:abort.current?.signal});let response=await request();let retry=0;while(url==='/api/prepare'&&!response.ok&&retry<2&&retryablePrepareStatuses.has(response.status)){await wait(400*(retry+1));retry++;response=await request()}const raw=await response.text();let body:any={};try{body=raw?JSON.parse(raw):{}}catch{/* gateways may return plain-text errors */}if(!response.ok){const detail=body.error||raw.replace(/\s+/g,' ').trim().slice(0,240);throw Error(detail?`เซิร์ฟเวอร์ตอบกลับ HTTP ${response.status}: ${detail}`:`เซิร์ฟเวอร์ตอบกลับ HTTP ${response.status} และไม่ได้ส่งรายละเอียด`)}return body};
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');abort.current=new AbortController();try{await action()}catch(cause){setError(cause instanceof Error?(cause.name==='AbortError'?'ยกเลิกแล้ว':cause.message):String(cause));setStage('ยังไม่เสร็จ')}finally{setBusy(false)}};
 const uploadFiles=(incoming:FileList|null)=>{if(busy||!incoming?.length)return;return run(async()=>{setUploading(true);setUploadProgress(null);setStage('กำลังแนบไฟล์…');try{const ids=await onUpload(incoming,progress=>{setUploadProgress(progress);setStage((progress.phase==='saving'?'กำลังบันทึก':'กำลังอัปโหลด')+' '+progress.name+' · ไฟล์ '+progress.index+'/'+progress.total+' · '+progress.percent+'%')});if(ids.length){setSelected(current=>[...new Set([...current,...ids])]);setFiles([]);setResult(null);setStage('แนบ '+ids.length+' ไฟล์แล้ว พร้อมอ่านและตรวจรายการไฟล์')}else setStage('ไม่มีไฟล์ที่แนบสำเร็จ')}finally{setUploading(false);setUploadProgress(null);if(fileInput.current)fileInput.current.value=''}})};
 const prepareFiles=async():Promise<Input[]>=>{if(job?.status==='error')ai.dismiss();setStage('1. อ่านและตรวจรายการไฟล์…');setResult(null);setFiles([]);const inputs:{fileId:string;name:string;data?:string;size?:number;mime?:string}[]=[];for(const id of selected){const document=project.documents.find(item=>item.id===id);if(!document)throw Error('ไม่พบข้อมูลไฟล์ที่เลือก');const size=Number(document.size);let blob:Blob|undefined;if(Number.isFinite(size)&&size<=INLINE_PREPARE_BYTES){try{blob=await getFile(project.id+'/'+id)}catch{/* local cache is optional; server reads the Storage object */}}if(blob)inputs.push({fileId:id,name:document.name,data:await base64(blob),size:blob.size,mime:blob.type||document.type});else inputs.push({fileId:id,name:document.name,size,mime:document.type})}const body=await call('/api/prepare',{files:inputs});const prepared=body.files as Input[];setFiles(prepared);setStage('อ่านและตรวจรายการไฟล์เสร็จแล้ว กำลังส่งให้ AI…');return prepared};
 const changeProvider=(next:Provider)=>{if(ai.job?.status==='error')ai.dismiss();setProvider(next);setModel(models[next][0]);if(!effortOptions[next].some(option=>option.value===effort))setEffort('medium');setError('')};
 const changeModel=(next:string)=>{if(ai.job?.status==='error')ai.dismiss();setModel(next);setError('')};
 const changeEffort=(next:string)=>{if(ai.job?.status==='error')ai.dismiss();setEffort(next);setError('')};
 const generate=()=>run(async()=>{const requestedPrompt=prompt;const prepared=await prepareFiles();const readyFiles=prepared.filter(file=>file.kind!=='unsupported').map(({fileId,name,kind})=>({fileId,name,kind}));if(!readyFiles.length)throw Error('ไม่พบไฟล์ที่อ่านได้สำหรับสร้างโมเดล');setStage('กำลังส่งแบบให้ AI…');const request:McpGenerateRequest={mode:'mcp',operation:'generate',provider,model,effort,projectId:project.id,files:readyFiles,prompt:requestedPrompt};await ai.start(request,requestedPrompt);onStarted()});
 const cancel=async()=>{if(cancelling)return;if(running){setCancelling(true);try{await ai.cancel()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setCancelling(false)}}else abort.current?.abort()};
 const confirmProject=async()=>{if(!visibleResult)return;await run(async()=>{await onApply(visibleResult.project);ai.dismiss()})};

 return <div className="ai-panel">
  <p>กด “สร้างโมเดลด้วย AI” เพียงปุ่มเดียว ระบบจะอ่านและตรวจรายการไฟล์เป็นขั้นตอนแรก แล้วจึงส่งแบบให้ AI สร้างโมเดล</p>
  <p>เมื่อต้องการแก้เฉพาะชิ้นส่วน ใช้ “Chat AI · แก้ไขโมเดล 3D” ใต้โมเดล</p>
  <button className="upload-area" disabled={busy} onClick={()=>fileInput.current?.click()} onDragOver={event=>{event.preventDefault();event.stopPropagation()}} onDrop={event=>{event.preventDefault();event.stopPropagation();uploadFiles(event.dataTransfer.files)}}><Upload size={22}/><strong>อัปโหลดแบบของคุณ</strong><span>PDF · ภาพ · DWG · DXF · IFC · ZIP · RAR · CSV</span><small>เลือกหรือลากไฟล์มาวางที่นี่ สูงสุด 512 MB / ไฟล์ · ไฟล์ใหญ่จะอ่านจาก Storage โดยตรง</small></button>
  {uploadProgress&&<div className="upload-progress" aria-live="polite"><div><span>{uploadProgress.name} · ไฟล์ {uploadProgress.index}/{uploadProgress.total}</span><strong>{uploadProgress.percent}%</strong></div><progress aria-label="ความคืบหน้าการอัปโหลดไฟล์" max={100} value={uploadProgress.percent}/><small>{uploadProgress.phase==='saving'?'อัปโหลดครบแล้ว กำลังบันทึกไฟล์':'กำลังอัปโหลดไฟล์'}</small></div>}
  <input type="file" ref={fileInput} aria-label="อัปโหลดแบบและ Timeline" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.ifc,.zip,.rar,.csv" hidden disabled={busy} onChange={event=>uploadFiles(event.target.files)}/>
  <div className="chat-thread" aria-label="บทสนทนาสร้างโมเดล">{messages.map((message,index)=><div key={index} className={'chat-message '+message.role}><strong>{message.role==='user'?'คุณ':'AI'}</strong><p>{message.text}</p></div>)}{job&&<div className="chat-message assistant"><strong>AI</strong><AiJobActivity job={job}/></div>}</div>
  <div className="chat-composer"><label className="field stack"><span>คำสั่งสร้างโมเดลจากแบบ</span><textarea rows={3} disabled={running||(working&&!uploading)} value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="ระบุรายละเอียดอาคาร หน่วย และมิติอ้างอิงสำหรับสร้างจากแบบ"/></label><div className="ai-grid"><label>ผู้ให้บริการ<select aria-label="ผู้ให้บริการ AI" value={provider} disabled={busy} onChange={event=>changeProvider(event.target.value as Provider)}>{Object.entries(providers).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label>โมเดล<select aria-label="โมเดล AI" value={model} disabled={busy} onChange={event=>changeModel(event.target.value)}>{models[provider].map(option=><option key={option}>{option}</option>)}</select></label><label>ระดับการคิด<select aria-label="ระดับการคิด" value={effort} disabled={busy} onChange={event=>changeEffort(event.target.value)}>{effortOptions[provider].map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>{userProfile?.status==='approved'&&userProfile.role.includes('MasterAdmin')&&<button className="secondary" disabled={busy} onClick={()=>setAdmin(!admin)}>{admin?'ปิดการตั้งค่า Key':'จัดการ Key ที่ Admin'}</button>}<small>พิมพ์คำสั่งรอได้ระหว่างอัปโหลด · MCP จะส่งแบบให้ AI สร้างและบันทึกโมเดล หากไม่มีหมวดชิ้นส่วนตรงตัว จะสร้างเป็นชิ้นส่วนกำหนดเองพร้อมติดป้ายมิติที่อนุมาน</small></div>
  {admin&&<AdminPanel/>}
  <div className="ai-files">{project.documents.map(document=><label key={document.id}><input type="checkbox" checked={selected.includes(document.id)} disabled={busy} onChange={event=>{setSelected(current=>event.target.checked?[...current,document.id]:current.filter(id=>id!==document.id));setFiles([]);setResult(null)}}/>{document.name}</label>)}{!project.documents.length&&<p>ยังไม่มีไฟล์แนบ เลือกหรือลากแบบและ Timeline มาวางในช่องอัปโหลดด้านบน</p>}</div>
  {!!files.length&&<div className="ai-files">{files.map((file,index)=><div key={index}><strong>{file.name}</strong><small>{file.kind} · {file.detail}</small></div>)}<p>{files.filter(file=>file.kind!=='unsupported').length} ไฟล์พร้อมส่ง · {files.filter(file=>file.kind==='unsupported').length} ไฟล์อ่านไม่ได้ (ไม่ส่ง)</p></div>}
  <div className="ai-actions"><button className="primary" disabled={busy||!selected.length} onClick={generate}>สร้างโมเดลด้วย AI</button>{busy&&<button className="secondary" disabled={cancelling} onClick={cancel}>{cancelling?'กำลังยกเลิก…':'ยกเลิก'}</button>}</div>
  {running?<p className="ai-background-hint">ปิดหน้านี้หรือไปเมนูอื่นได้ งานยังทำงานต่อบนเซิร์ฟเวอร์</p>:<p role="status">{working&&<span className="busy-dot"/>}{stage||(job?.status==='done'?'สร้างโมเดลเสร็จแล้ว พร้อมเปิดตรวจใน 3D':'')}</p>}
  {(error||(job?.status==='error'&&job.error))&&<p role="alert" className="ai-error">{error||((job?.provider||job?.model)?((job.provider||'AI')+' / '+job.model+': '+job.error):job?.error)}</p>}
  {visibleResult&&<div className="ai-result"><h3>{visibleResult.project.name} · {visibleResult.project.elements.length} ชิ้นส่วน</h3><p>{visibleResult.project.activities.length} กิจกรรม · {inspectModel(visibleResult.project.elements).length} จุดที่ควรตรวจตำแหน่ง</p>{visibleResult.notes.map((note,index)=><p key={index}>{note}</p>)}<p className="ai-confirm-note">ผลลัพธ์นี้ยังไม่ถูกบันทึก กดปุ่มด้านล่างเพื่อยืนยันบันทึกลงในโครงการ “{project.name}” โดยจะรักษาไฟล์แนบของโครงการเดิมไว้</p><button className="primary ai-confirm-button" disabled={busy} onClick={confirmProject}>3. ยืนยันบันทึกลงโครงการนี้ใน 3D</button></div>}
  {mcpResult&&<div className="ai-result"><h3>MCP สร้างโมเดลเสร็จแล้ว</h3><p>{mcpResult.message||'สร้างและบันทึกโมเดลลงโครงการแล้ว'}</p>{mcpResult.notes?.filter(Boolean).map((note,index)=><p key={index}>{note}</p>)}<p className="ai-confirm-note">MCP บันทึกผลลงโครงการโดยตรงแล้ว หน้าต่างนี้ไม่ต้องกดยืนยันซ้ำ</p></div>}
  <p className="micro-note">มิติที่ไม่ปรากฏในแบบจะแสดงเป็น assumed ในข้อมูลชิ้นส่วน สามารถแก้ไขได้ทุกชิ้น</p>
 </div>;
}
