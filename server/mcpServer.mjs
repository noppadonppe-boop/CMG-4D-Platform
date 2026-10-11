import {timingSafeEqual} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import {inspectModel} from '../src/geometry.mjs';
import {buildEditContext,normalizeEditPatch,applyEditPatch} from '../src/modelEdit.mjs';
import {categories,categoryGroups,labels,validateProject} from '../src/domain.mjs';
import {parseModel} from './ai.mjs';
import {listAdminProjectsForUser,readAdminProject,writeAdminProject} from './projectStore.mjs';
import {adminStorageBucket} from './auth.mjs';
import {verifyMcpScope} from './mcpScope.mjs';
import {bindMcpTools} from './mcpBoundScope.mjs';
import {generationBatchSchema} from './generationSchema.mjs';
import {readMcpRequest,updateMcpRequest} from './mcpRequests.mjs';
import {assembleGenerationBatches,saveGenerationBatch,readGenerationBatches} from './generationBatches.mjs';

const APP_NAME = 'CMG-4D-Platform';
const categorySet = new Set(categories);
const scopeFields = {
 scope_token: z.string().min(1).describe('Short-lived CMG scope token supplied by the application. Never invent one.'),
 project_id: z.string().min(1).max(200).describe('The CMG project id from the scope.'),
};

function result(value) {
 return {content: [{type: 'text', text: JSON.stringify(value)}]};
}

function scopeOf(args) {
 const scope = verifyMcpScope(args.scope_token, {projectId: args.project_id});
 return scope;
}

async function scopedProject(args) {
 const scope = scopeOf(args);
 const request = await readMcpRequest(scope.requestId);
 if (!request || request.status === 'cancelled') throw Error('งาน MCP นี้ถูกยกเลิกแล้ว');
 const loaded = await readAdminProject(scope.projectId);
 if (loaded.header.memberUids && !scope.role?.includes('MasterAdmin') && !loaded.header.memberUids.includes(scope.uid)) throw Error('ผู้ใช้ไม่มีสิทธิ์เข้าถึงโครงการนี้');
 return {...loaded, scope};
}

async function activeScope(args) {
 const scope = scopeOf(args);
 const request = await readMcpRequest(scope.requestId);
 if (!request || request.status === 'cancelled') throw Error('งาน MCP นี้ถูกยกเลิกแล้ว');
 return scope;
}

function nearbyElements(project, target, limit = 60) {
 const distance = element => Math.hypot(
  Math.max(0, Math.hypot(element.position[0] - target.position[0], element.position[1] - target.position[1]) - (element.size[0] + target.size[0]) / 2),
  Math.max(0, Math.abs(element.position[2] - target.position[2]) - (element.size[2] + target.size[2]) / 2),
 );
 return project.elements.filter(element => element.id !== target.id)
  .map(element => ({element, distance: distance(element)}))
  .sort((a,b) => a.distance - b.distance)
  .slice(0, limit)
  .map(({element,distance: d}) => ({...element, distance: Number(d.toFixed(3))}));
}

function registerTools(server) {
 server.registerTool('cmg_list_projects', {
  description: 'List CMG projects that the current scoped user may access. Read-only.',
  inputSchema: {scope_token: scopeFields.scope_token},
 }, async ({scope_token}) => {
  const scope = await activeScope({scope_token});
  const projects = await listAdminProjectsForUser(scope.uid, scope.role);
  return result({projects: projects.map(project => ({id: project.id, name: project.name, version: project.version, savedAt: project.savedAt}))});
 });

 server.registerTool('cmg_get_project_summary', {
  description: 'Read the current project summary, model counts, floors, revision version, and recent audit entries. Read-only.',
  inputSchema: scopeFields,
 }, async args => {
  const {header,project} = await scopedProject(args);
  const categoryCounts = Object.fromEntries(categories.map(category => [category, project.elements.filter(element => element.category === category).length]));
  const request=await readMcpRequest(scopeOf(args).requestId);
  return result({projectId: project.id, name: project.name, description: project.description, version: header.version, floors: project.floors || [], elementCount: project.elements.length, categoryCounts, activityCount: project.activities.length, documentCount: project.documents.length, generation:request?.generation||null, recentAudit: (project.audit || []).slice(0, 10)});
 });

 server.registerTool('cmg_list_categories', {
  description: 'List supported structural, architectural, MEP, temporary-work, and customComponent element categories with Thai labels and counts. Use customComponent for a drawing part with no exact supported category. Read-only.',
  inputSchema: scopeFields,
 }, async args => {
  const {project} = await scopedProject(args);
  const groups = Object.entries(categoryGroups).map(([id,group]) => ({id, name: group.label, categories: group.categories.map(category => ({id: category, name: labels[category], count: project.elements.filter(element => element.category === category).length}))}));
  return result({groups, totalCategories: categories.length});
 });

 server.registerTool('cmg_search_elements', {
  description: 'Search model elements by id, name, BIM property, category, floor, or zone. Read-only.',
  inputSchema: {...scopeFields, query: z.string().max(2000).default('').describe('Text to find in id, name, zone, material, source, or BIM properties.'), category: z.string().optional(), floor: z.number().int().optional(), limit: z.number().int().min(1).max(100).default(50)},
 }, async args => {
  const {project} = await scopedProject(args);
  if (args.category && !categorySet.has(args.category)) throw Error('หมวดชิ้นส่วนไม่รองรับ');
  const query = args.query.trim().toLowerCase();
  const items = project.elements.filter(element => {
   if (args.category && element.category !== args.category) return false;
   if (args.floor !== undefined && element.floor !== args.floor) return false;
   const haystack = [element.id,element.name,element.category,element.zone,element.material,element.source,...Object.entries(element.properties || {}).flat()].join(' ').toLowerCase();
   return !query || haystack.includes(query);
  }).slice(0, args.limit).map(element => ({id: element.id, category: element.category, name: element.name, floor: element.floor, position: element.position, size: element.size, zone: element.zone, material: element.material, source: element.source, properties: element.properties || {}, hostId: element.hostId}));
  return result({count: items.length, elements: items});
 });

 server.registerTool('cmg_get_element_context', {
  description: 'Read one element and nearby/hosted elements needed to plan a safe local edit. Read-only.',
  inputSchema: {...scopeFields, element_id: z.string().min(1).max(200)},
 }, async args => {
  const {project} = await scopedProject(args);
  const target = project.elements.find(element => element.id === args.element_id);
  if (!target) throw Error('ไม่พบชิ้นส่วน ' + args.element_id);
  const related = project.elements.filter(element => element.hostId === target.id || target.hostId === element.id);
  const nearby = nearbyElements(project, target).filter(element => !related.some(item => item.id === element.id));
  const activities = (project.activities || []).filter(activity => activity.elementIds?.includes(target.id) || activity.categories?.includes(target.category));
  return result({projectId: project.id, version: (await readAdminProject(project.id)).header.version, target, related, nearby: nearby.slice(0, 50), activities});
 });

 server.registerTool('cmg_list_project_files', {
  description: 'List files attached to the scoped project. Read-only.',
  inputSchema: scopeFields,
 }, async args => {
  const {project} = await scopedProject(args);
  return result({files: (project.documents || []).map(file => ({id: file.id, name: file.name, size: file.size, type: file.type}))});
 });

 server.registerTool('cmg_read_text_file', {
  description: 'Read a small attached text-based source file such as CSV, DXF, IFC, JSON, or plain text through MCP. Read-only; use cmg_read_project_file for PDF and image files.',
  inputSchema: {...scopeFields, file_id: z.string().min(1).max(200)},
 }, async args => {
  const {project} = await scopedProject(args);
  const file = (project.documents || []).find(item => item.id === args.file_id);
  if (!file) throw Error('ไม่พบไฟล์ ' + args.file_id);
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  const textLike = type.startsWith('text/') || ['.csv','.dxf','.ifc','.json','.xml','.txt'].some(ext => name.endsWith(ext));
  if (!textLike) throw Error('ไฟล์นี้เป็น PDF/ภาพหรือ binary ให้ใช้เครื่องมืออ่านไฟล์ของ MCP');
  const storagePath = `${APP_NAME}/root/projects/${project.id}/files/${file.id}`;
  const [buffer] = await adminStorageBucket().file(storagePath).download();
  const maxBytes = 256 * 1024;
  return result({fileId: file.id, name: file.name, type: file.type, text: buffer.subarray(0, maxBytes).toString('utf8'), truncated: buffer.length > maxBytes});
 });

 server.registerTool('cmg_read_project_file', {
  description: 'Verify an attached PDF or image. For OpenAI generation, the full file is already attached directly to the model input; returns its identity and availability. Other providers receive binary content. Read-only; use cmg_read_text_file for text sources.',
  inputSchema: {...scopeFields, file_id: z.string().min(1).max(200)},
 }, async args => {
  const {project,scope} = await scopedProject(args);
  const file = (project.documents || []).find(item => item.id === args.file_id);
  if (!file) throw Error('ไม่พบไฟล์ ' + args.file_id);
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  const isImage = type.startsWith('image/') || ['.png','.jpg','.jpeg','.webp'].some(ext => name.endsWith(ext));
  const isPdf = type === 'application/pdf' || name.endsWith('.pdf');
  if (!isImage && !isPdf) throw Error('ไฟล์นี้เป็นข้อความ ให้ใช้ cmg_read_text_file');
  const storagePath = `${APP_NAME}/root/projects/${project.id}/files/${file.id}`;
  const request = await readMcpRequest(scope.requestId);
  const storageFile = adminStorageBucket().file(storagePath);
  if (request?.provider === 'openai' && request.operation === 'generate' && request.sourceFiles?.some(source => source.fileId === file.id && !source.name.includes('/'))) {
   // Responses already receives this PDF/image in the initial input. Sending
   // its bytes a second time as an embedded MCP resource can fail at the
   // provider boundary and duplicates the source payload.
   let size = Number(file.size);
   if (!Number.isFinite(size) && typeof storageFile.getMetadata === 'function') {
    try { size = Number((await storageFile.getMetadata())[0]?.size); } catch { size = undefined; }
   }
   return result({ok: true, fileId: file.id, name: file.name, type: file.type, ...(Number.isFinite(size)?{size}:{}), source: 'direct_response_input', instruction: 'Read the complete PDF pages or image already attached to your initial input under this exact filename. Save geometry in batches with cmg_save_model_batch, then cmg_finalize_model.'});
  }
  const [buffer] = await storageFile.download();
  if (buffer.length > 20 * 1024 * 1024) throw Error('ไฟล์ใหญ่เกิน 20 MB สำหรับการอ่านผ่าน MCP');
  if (isImage) return {content: [{type: 'text', text: JSON.stringify({fileId: file.id, name: file.name, type: file.type})}, {type: 'image', data: buffer.toString('base64'), mimeType: type || 'image/png'}]};
  return {content: [{type: 'text', text: JSON.stringify({fileId: file.id, name: file.name, type: file.type})}, {type: 'resource', resource: {uri: `cmg-file://${project.id}/${file.id}`, mimeType: 'application/pdf', blob: buffer.toString('base64')}}]};
 });

 server.registerTool('cmg_report_source_analysis', {
  description:'Report what you found in ONE selected drawing file before building batches. Summarize observed dimensions, levels, components to build, and uncertainties. This report is shown to the user. Do not include internal reasoning or claim verified accuracy.',
  inputSchema:{...scopeFields,file_id:z.string().min(1).max(200),summary:z.string().min(1).max(1000)},
 },async args=>{
  const scope=await activeScope(args),request=await readMcpRequest(scope.requestId);
  const file=request?.sourceFiles?.find(file=>file.fileId===args.file_id);
  if(request?.operation!=='generate'||!file)return result({ok:false,error:'เลือก file_id จากรายการไฟล์ของคำขอนี้เท่านั้น'});
  const detail=`AI สรุปแบบ · ${file.name} · ${args.summary}`.slice(0,240);
  const sourceAnalyses=[{fileId:file.fileId,name:file.name,summary:args.summary}];
  await updateMcpRequest(scope.requestId,{stage:'analysis',detail,sourceAnalyses,event:{key:'analysis:'+file.fileId,stage:'analysis_reported',detail}});
  return result({ok:true,name:file.name,summary:args.summary});
 });

 server.registerTool('cmg_save_model_batch', {
  description: 'Queue new model elements for construction. If a drawing part has no exact category, use customComponent with properties.geometry JSON for its shape. Send the structured batch object shown in the input schema, preferably 20-100 elements per call. Larger valid submissions are accepted within the 3000-element project limit. Use batch_index 0,1,2,... and stable IDs. Define all floors in batch 0. Retry the SAME index to replace a rejected batch. Never repeat previously saved elements in later batches. Call cmg_finalize_model after sending every part.',
  inputSchema:{...scopeFields,expected_version:z.number().int().min(0),batch_index:z.number().int().min(0).max(39),batch:generationBatchSchema},
 },async args=>{
  const {header,scope}=await scopedProject(args),request=await readMcpRequest(scope.requestId);
  if(request?.operation!=='generate')throw Error('ใช้ได้เฉพาะคำขอสร้างโมเดล');
  try{
   if(header.version!==args.expected_version)throw Error('PROJECT_CONFLICT: โครงการถูกแก้ไขระหว่างสร้างโมเดล');
   const progress=await saveGenerationBatch({requestId:scope.requestId,index:args.batch_index,json:JSON.stringify(args.batch),expectedVersion:args.expected_version});
   return result({ok:true,...progress,instruction:'Continue with the next unsaved batch. Call cmg_finalize_model only when every requested part is saved.'});
  }catch(error){return result({ok:false,error:error.message,instruction:'Repair only this batch and retry the same batch_index. Do not resend all elements.'});}
 });

 server.registerTool('cmg_finalize_model', {
  description:'Assemble all saved generation batches, validate the complete model, and atomically publish it to the current project. No model JSON needs to be repeated. Call only after all parts are saved.',
  inputSchema:scopeFields,
 },async args=>{
  const {project,header,scope}=await scopedProject(args),request=await readMcpRequest(scope.requestId);
  if(request?.operation!=='generate')throw Error('ใช้ได้เฉพาะคำขอสร้างโมเดล');
  try{
   if(!request.generation||header.version!==request.generation.expectedVersion)throw Error('PROJECT_CONFLICT: รุ่นโครงการต่างจากตอนเริ่มสร้าง');
   const missing=(request.sourceFiles||[]).filter(file=>!(request.sourceAnalyses||[]).some(report=>report.fileId===file.fileId));
   if(missing.length)return result({ok:false,error:'ยังไม่มีสรุปการอ่านไฟล์: '+missing.map(file=>file.name).join(', '),instruction:'Report only the missing source files listed in this error using cmg_report_source_analysis, then finalize. Do not reread or report files that already have a source analysis. Keep all saved batches.'});
   const batches=await readGenerationBatches(scope.requestId);
   if(batches.length!==request.generation.batchCount)throw Error('จำนวนชุดที่บันทึกไม่ครบ');
   const parsed=parseModel(JSON.stringify(assembleGenerationBatches(batches))),generated=parsed.project;
   const next={...project,description:generated.description||project.description,floors:generated.floors,elements:generated.elements,activities:generated.activities,audit:[{at:new Date().toISOString(),message:`MCP สร้างโมเดล ${batches.length} ชุด · ${generated.elements.length} ชิ้น`},...(project.audit||[])].slice(0,500)};
   const saved=await writeAdminProject({project:next,expectedVersion:header.version,actorUid:scope.uid,message:'MCP batch generation'});
   await updateMcpRequest(scope.requestId,{status:'done',stage:'completed',error:'',detail:`สร้างและบันทึก ${batches.length} ชุด · ${next.elements.length} ชิ้น`,completedAt:new Date(),result:{mode:'mcp',operation:'generate',version:saved.version,changedCount:next.elements.length,notes:parsed.notes,message:`สร้างโมเดลและบันทึกแล้ว · ${batches.length} ชุด · ${next.elements.length} ชิ้น`}});
   return result({ok:true,version:saved.version,elementCount:next.elements.length,batchCount:batches.length});
  }catch(error){return result({ok:false,error:error.message,instruction:'Repair the affected saved batch with cmg_save_model_batch using the SAME index, then finalize again. Preserve other batches.'});}
 });

 server.registerTool('cmg_create_model', {
  description: 'Create a complete 3D/4D model from the supplied drawings and save it into the current CMG project. Use only for an initial model-generation request. First read the project summary, then send the complete model JSON as model_json. This is a write operation and replaces the current model elements and schedule while preserving attached files.',
  inputSchema: {...scopeFields, expected_version: z.number().int().min(0), model_json: z.string().min(2).max(20_000_000)},
 }, async args => {
  const {project,header,scope} = await scopedProject(args);
  const request = await readMcpRequest(scope.requestId);
  if (request?.operation !== 'generate') throw Error('เครื่องมือสร้างโมเดลใช้ได้เฉพาะคำขอสร้างโมเดลผ่าน MCP');
   try {
    if (header.version !== args.expected_version) throw Error('PROJECT_CONFLICT: โครงการมีรุ่นใหม่แล้ว กรุณาอ่านสรุปโครงการล่าสุดก่อนสร้างโมเดล');
    const generated = parseModel(args.model_json).project;
    const next = {
     ...project,
     description: generated.description || project.description,
     floors: generated.floors,
     elements: generated.elements,
     activities: generated.activities,
     audit: [{at: new Date().toISOString(), message: 'MCP สร้างโมเดล 3D และแผนงานจากแบบ'}, ...(project.audit || [])].slice(0, 500),
    };
    if (!validateProject(next)) throw Error('โมเดลที่ Agent สร้างไม่ผ่านการตรวจสอบโครงการ');
    const saved = await writeAdminProject({project: next, expectedVersion: header.version, actorUid: scope.uid, message: 'MCP model generation'});
    const notes = Array.isArray(generated.notes) ? generated.notes : [];
    await updateMcpRequest(scope.requestId, {status: 'done', stage: 'completed', detail: 'สร้างและบันทึกโมเดลผ่าน MCP แล้ว', completedAt: new Date(), result: {mode: 'mcp', operation: 'generate', version: saved.version, changedCount: next.elements.length, notes, message: `สร้างโมเดลและบันทึกลงโครงการแล้ว · ${next.elements.length} ชิ้นส่วน`}});
    return result({ok: true, projectId: next.id, version: saved.version, elementCount: next.elements.length, activityCount: next.activities.length, message: 'สร้างและบันทึกโมเดลผ่าน MCP แล้ว', notes});
   } catch (error) {
    const message = error?.message || 'โมเดลที่ Agent สร้างยังไม่ผ่านการตรวจสอบ';
    // Return a normal MCP tool result so the model can repair its JSON and
    // retry. Throwing here makes Responses emit mcp_call.failed without the
    // validation message needed for an efficient repair turn.
    await updateMcpRequest(scope.requestId, {stage: 'tool', detail: 'cmg_create_model ยังบันทึกไม่ได้: ' + message, error: message}).catch(() => {});
    return result({ok: false, retryable: true, error: message, instruction: 'แก้ model_json ตาม error นี้ แล้วเรียก cmg_create_model ใหม่จนกว่าจะได้ ok:true'});
   }
 });

 server.registerTool('cmg_get_schedule', {
  description: 'Read the project 4D construction schedule and its element links. Read-only.',
  inputSchema: scopeFields,
 }, async args => {
  const {project} = await scopedProject(args);
  return result({activities: project.activities || []});
 });

 server.registerTool('cmg_inspect_model', {
  description: 'Inspect the current model for geometry and opening-placement issues. Read-only.',
  inputSchema: {...scopeFields, limit: z.number().int().min(1).max(100).default(50)},
 }, async args => {
  const {project} = await scopedProject(args);
  const issues = inspectModel(project.elements).slice(0, args.limit);
  return result({issueCount: issues.length, issues});
 });

 const patchSchema = z.object({
  updates: z.array(z.object({id: z.string(), changes: z.record(z.string(), z.unknown())})).default([]),
  adds: z.array(z.record(z.string(), z.unknown())).default([]),
  removes: z.array(z.string()).default([]),
  notes: z.array(z.string().max(2000)).default([]),
 });
 server.registerTool('cmg_apply_model_patch', {
  description: 'Validate and atomically apply a local model patch, then save it to Firebase. Use cmg_get_element_context first. Existing IDs in target_ids are updated in place even if the agent returned the complete element under adds; repeated IDs for distinct new elements are made unique automatically. Do not replace the whole project. This is a write operation.',
  inputSchema: {...scopeFields, expected_version: z.number().int().min(0), target_ids: z.array(z.string()).min(1).max(100), patch: patchSchema},
 }, async args => {
  const {project,header,scope} = await scopedProject(args);
  if (header.version !== args.expected_version) throw Error('PROJECT_CONFLICT: โครงการมีรุ่นใหม่แล้ว กรุณาอ่านบริบทล่าสุดก่อนแก้');
  const prompt = args.target_ids.join(' ');
  const context = buildEditContext(project, {prompt, scope: 'auto'});
   try {
    const safePatch = normalizeEditPatch(structuredClone(args.patch), context);
    const next = applyEditPatch(project, safePatch, context);
    next.audit = [{at: new Date().toISOString(), message: `MCP แก้โมเดล: ${safePatch.notes?.[0] || 'แก้ไขชิ้นส่วนตามคำสั่ง Agent'}`}, ...(next.audit || [])].slice(0, 500);
    const saved = await writeAdminProject({project: next, expectedVersion: header.version, actorUid: scope.uid, message: 'MCP model patch'});
    const changedCount = safePatch.updates.length + safePatch.adds.length + safePatch.removes.length;
    await updateMcpRequest(scope.requestId, {status: 'done', stage: 'completed', detail: 'แก้ไขและบันทึกโมเดลแล้ว', completedAt: new Date(), result: {mode: 'mcp', changedCount, version: saved.version, notes: safePatch.notes || []}}).catch(() => {});
    return result({ok: true, projectId: next.id, version: saved.version, changedCount, notes: safePatch.notes || []});
   } catch (error) {
    const message = error?.message || 'patch โมเดลไม่ผ่านการตรวจสอบ';
    await updateMcpRequest(scope.requestId, {stage: 'tool', detail: 'cmg_apply_model_patch ยังบันทึกไม่ได้: ' + message, error: message}).catch(() => {});
    return result({ok: false, retryable: true, error: message, instruction: 'แก้เฉพาะ patch ตามข้อผิดพลาดนี้ แล้วเรียก cmg_apply_model_patch ใหม่ด้วย target_ids และ expected_version เดิม หากเป็น ID ซ้ำให้ใช้ updates สำหรับชิ้นส่วนเดิมหรือคง adds ไว้ให้ระบบตั้งรหัสต่อท้าย ห้ามอ้างว่าสำเร็จก่อนเห็น ok:true'});
   }
 });

 server.registerTool('cmg_update_schedule', {
  description: 'Replace the validated project schedule and save it. Use cmg_get_schedule first. This is a write operation.',
  inputSchema: {...scopeFields, expected_version: z.number().int().min(0), activities: z.array(z.record(z.string(), z.unknown())).max(1000)},
 }, async args => {
  const {project,header,scope} = await scopedProject(args);
  if (header.version !== args.expected_version) throw Error('PROJECT_CONFLICT: โครงการมีรุ่นใหม่แล้ว กรุณาอ่านแผนงานล่าสุดก่อนแก้');
  const next = {...project, activities: args.activities};
  if (!validateProject(next)) throw Error('แผนงานไม่ผ่านรูปแบบของโครงการ');
  next.audit = [{at: new Date().toISOString(), message: 'MCP แก้ไขแผนงาน 4D'}, ...(next.audit || [])].slice(0, 500);
  const saved = await writeAdminProject({project: next, expectedVersion: header.version, actorUid: scope.uid, message: 'MCP schedule update'});
  await updateMcpRequest(scope.requestId, {status: 'done', stage: 'completed', detail: 'บันทึกแผนงานแล้ว', completedAt: new Date(), result: {mode: 'mcp', version: saved.version, message: 'บันทึกแผนงานแล้ว'}});
  return result({ok: true, version: saved.version, activityCount: next.activities.length});
 });

 server.registerTool('cmg_complete_request', {
  description: 'Finish a read-only or explanatory request and show a concise message in the CMG chat.',
  inputSchema: {...scopeFields, message: z.string().min(1).max(4000)},
 }, async args => {
  const scope = await activeScope(args);
  const request = await readMcpRequest(scope.requestId);
  if (request?.operation === 'generate') return result({ok: false, instruction: 'This is a model-generation request. Save geometry with cmg_save_model_batch, then cmg_finalize_model and obtain ok:true. A message alone cannot complete generation.'});
  await updateMcpRequest(scope.requestId, {status: 'done', stage: 'completed', detail: args.message.slice(0, 200), completedAt: new Date(), result: {mode: 'mcp', message: args.message}});
  return result({ok: true, message: args.message});
 });
}

function serverForRequest(scopeToken) {
 const server = new McpServer({name: 'cmg-4d-platform', version: '0.1.0'});
 registerTools(bindMcpTools(server,scopeToken));
 return server;
}

function validServerToken(req) {
 const expected = process.env.MCP_SERVER_TOKEN || process.env.MCP_SHARED_SECRET;
 if (!expected) return false;
 const actual = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
 if (!actual) return false;
 const actualBytes = Buffer.from(actual);
 const expectedBytes = Buffer.from(expected);
 return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function handleMcpRequest(req, res) {
 if (!validServerToken(req)) return res.status(401).json({error: 'MCP authentication required'});
 const scopeToken=req.headers['x-cmg-scope'];
 if(scopeToken!==undefined){try{verifyMcpScope(scopeToken);}catch{return res.status(401).json({error:'MCP scope authentication failed'});}}
 const server = serverForRequest(scopeToken);
 try {
  const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on('close', () => { void transport.close(); void server.close(); });
 } catch (error) {
  console.error('MCP request failed', error);
  if (!res.headersSent) res.status(500).json({jsonrpc: '2.0', error: {code: -32603, message: error?.message || 'MCP internal error'}, id: null});
 }
}

export function mcpHealth(req, res) {
 const hasServerToken = Boolean(process.env.MCP_SERVER_TOKEN || process.env.MCP_SHARED_SECRET);
 const hasScopeSecret = Boolean(process.env.MCP_SCOPE_SECRET || process.env.MCP_SHARED_SECRET);
 const hasPublicUrl = Boolean(process.env.MCP_PUBLIC_URL);
 const hasTaskQueue = Boolean(process.env.MCP_TASK_QUEUE);
 const configured = hasServerToken && hasScopeSecret && hasPublicUrl && (!process.env.K_SERVICE || hasTaskQueue);
 res.json({ok: true, name: `${APP_NAME} MCP`, configured, taskQueue: process.env.K_SERVICE ? (hasTaskQueue ? 'cloud_tasks' : 'missing') : 'local_background', transport: configured ? 'provider_mcp' : 'unconfigured'});
}

