const toolLabels = {
 cmg_list_projects: 'ดูรายการโครงการ',
 cmg_get_project_summary: 'อ่านข้อมูลสรุปโครงการ',
 cmg_list_categories: 'ดูหมวดหมู่ชิ้นส่วน',
 cmg_search_elements: 'ค้นหาชิ้นส่วนในโมเดล',
 cmg_get_element_context: 'อ่านรายละเอียดชิ้นส่วนและบริเวณใกล้เคียง',
 cmg_list_project_files: 'ดูรายการไฟล์แนบ',
 cmg_read_text_file: 'อ่านไฟล์ข้อมูล',
 cmg_read_project_file: 'อ่านแบบหรือไฟล์แนบ',
 cmg_report_source_analysis: 'รายงานผลอ่านแบบ',
 cmg_create_model: 'บันทึกโมเดล 3 มิติ',
 cmg_save_model_batch: 'บันทึกชุดชิ้นส่วน 3 มิติ',
 cmg_finalize_model: 'รวมชุดและบันทึกโมเดล',
 cmg_get_schedule: 'อ่านแผนงาน 4D',
 cmg_inspect_model: 'ตรวจสอบโมเดล',
 cmg_apply_model_patch: 'บันทึกการแก้ไขโมเดล',
 cmg_update_schedule: 'บันทึกแผนงาน 4D',
 cmg_complete_request: 'สรุปผลคำขอ',
};

function objectValue(value) {
 if (value && typeof value === 'object' && !Array.isArray(value)) return value;
 if (typeof value !== 'string' || value.length > 100_000) return {};
 try {
  const parsed = JSON.parse(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
 } catch { return {}; }
}

function text(value, max = 100) {
 return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '';
}

function resultObject(result) {
 for(let depth=0;depth<5;depth++){
  if(typeof result==='string'){result=objectValue(result);continue;}
  if(result?.structuredContent){result=result.structuredContent;continue;}
  if(typeof result?.output==='string'){result=result.output;continue;}
  const firstText=result?.content?.find(item=>item?.type==='text')?.text;
  if(firstText!==undefined){result=firstText;continue;}
  return objectValue(result);
 }
 return objectValue(result);
}

function resultSummary(name, result) {
 const data = resultObject(result);
 if(data.ok===false)return 'ยังไม่บันทึก · '+text(data.error||data.instruction,140);
 if(name==='cmg_report_source_analysis'&&data.ok)return `${text(data.name)} · ${text(data.summary,120)}`;
 if(name==='cmg_save_model_batch' && data.ok)return `ชุด ${data.batchCount} · สะสม ${data.elementCount} ชิ้น`;
 if(name==='cmg_finalize_model' && data.ok)return `${data.batchCount} ชุด · ${data.elementCount} ชิ้น`;
 if (name === 'cmg_search_elements' && Number.isFinite(data.count)) return `พบ ${data.count} ชิ้น`;
 if (name === 'cmg_list_projects' && Array.isArray(data.projects)) return `${data.projects.length} โครงการ`;
 if (name === 'cmg_get_project_summary' && Number.isFinite(data.elementCount)) return `${data.elementCount} ชิ้น · ${data.activityCount || 0} กิจกรรม · ${data.documentCount || 0} ไฟล์`;
 if (name === 'cmg_list_project_files' && Array.isArray(data.files)) return `${data.files.length} ไฟล์`;
 if (name === 'cmg_read_text_file' || name === 'cmg_read_project_file') return text(data.name);
 if (name === 'cmg_get_element_context' && data.target) return `อ่าน ${text(data.target.name || data.target.id)} · ใกล้เคียง ${data.nearby?.length || 0} ชิ้น`;
 if (name === 'cmg_get_schedule' && Array.isArray(data.activities)) return `${data.activities.length} กิจกรรม`;
 if (name === 'cmg_inspect_model' && Number.isFinite(data.issueCount)) return data.issueCount ? `พบจุดที่ควรตรวจ ${data.issueCount} รายการ` : 'ไม่พบจุดผิดปกติ';
 if (name === 'cmg_create_model' && Number.isFinite(data.elementCount)) return `${data.elementCount} ชิ้น · ${data.activityCount || 0} กิจกรรม`;
 if (name === 'cmg_apply_model_patch' && Number.isFinite(data.changedCount)) return `เปลี่ยน ${data.changedCount} รายการ`;
 if (name === 'cmg_update_schedule' && Number.isFinite(data.activityCount)) return `${data.activityCount} กิจกรรม`;
 return '';
}

export function describeMcpActivity(name, rawArgs, sourceFiles = [], result) {
 const args = objectValue(rawArgs);
 const knownName = typeof name === 'string' && name.trim();
 const label = toolLabels[name] || (knownName ? name.replace(/^cmg_/, '').replaceAll('_', ' ') : 'กำลังดำเนินงาน');
 const context = [];

 if (name === 'cmg_search_elements') {
  const query = text(args.query, 80);
  const category = text(args.category, 60);
  const floor = Number.isInteger(args.floor) ? `ชั้น ${args.floor}` : '';
  if (query) context.push(`คำค้น “${query}”`);
  else if (category) context.push(`หมวด ${category}`);
  if (floor) context.push(floor);
 }
 if (name === 'cmg_get_element_context' && args.element_id) context.push(`รหัส ${text(args.element_id, 80)}`);
 if (name === 'cmg_read_text_file' || name === 'cmg_read_project_file') {
  const fileId = args.file_id;
  const file = sourceFiles.find(item => item?.fileId === fileId || item?.id === fileId);
  const fileName = text(file?.name) || text(fileId, 80);
  if (fileName) context.push(fileName);
 }
 if (name === 'cmg_apply_model_patch') {
  const patch = objectValue(args.patch);
  const changes = (patch.updates?.length || 0) + (patch.adds?.length || 0) + (patch.removes?.length || 0);
  if (changes) context.push(`${changes} รายการ`);
 }
 if (name === 'cmg_update_schedule' && Array.isArray(args.activities)) context.push(`${args.activities.length} กิจกรรม`);

 const summary = resultSummary(name, result);
 if (summary && !context.includes(summary)) context.push(summary);
 return [label, ...context].filter(Boolean).join(' · ').slice(0, 240);
}

export function createOpenAiMcpProgress(sourceFiles = [], streamId = 'openai') {
 const itemsById = new Map();
 const itemsByIndex = new Map();
 const argumentDeltas = new Map();

 function remember(item, outputIndex) {
  if (!item || item.type !== 'mcp_call') return;
  if (item.id) itemsById.set(item.id, {...itemsById.get(item.id), ...item});
  if (Number.isInteger(outputIndex)) itemsByIndex.set(outputIndex, item.id || item);
 }

 function callFor(event) {
  const direct = event.item || event.output_item;
  if (direct?.type === 'mcp_call') remember(direct, event.output_index);
  const id = event.item_id || direct?.id;
  let item = id ? itemsById.get(id) : undefined;
  if (!item && Number.isInteger(event.output_index)) {
   const indexed = itemsByIndex.get(event.output_index);
   item = typeof indexed === 'string' ? itemsById.get(indexed) : indexed;
  }
  if (!item && Array.isArray(event.response?.output)) {
   item = event.response.output.find(candidate => candidate?.type === 'mcp_call' && (!id || candidate.id === id));
   remember(item, event.output_index);
  }
  const delta = id ? argumentDeltas.get(id) : undefined;
  const accumulated = delta?.join('');
  const argumentsValue = event.arguments || accumulated || item?.arguments;
  if (item && argumentsValue !== undefined) item = {...item, arguments: argumentsValue};
  return {id: id || item?.id || `index-${event.output_index ?? 'unknown'}`, item, name: event.name || event.tool_name || item?.name, args: argumentsValue};
 }

 return event => {
  const type = String(event?.type || '');
  const embeddedItems = event.response?.output;
  if (Array.isArray(embeddedItems)) embeddedItems.forEach(item => remember(item, item.output_index));
  if (type === 'response.output_item.added' || type === 'response.output_item.done') remember(event.item, event.output_index);

  const itemId = event.item_id || event.item?.id;
  if (type === 'response.mcp_call_arguments.delta' && itemId && typeof event.delta === 'string') {
   const chunks = argumentDeltas.get(itemId) || [];
   chunks.push(event.delta);
   argumentDeltas.set(itemId, chunks);
  }

  if (type === 'response.created') return {stage: 'model', detail: 'กำลังวิเคราะห์คำขอและเลือกขั้นตอน'};
  if (type === 'response.output_text.done') return {stage: 'model', detail: 'กำลังสรุปผลจากการทำงาน'};
  if (type === 'response.completed') return {stage: 'completed', detail: 'กำลังตรวจผลที่ได้'};
  if (type === 'response.output_item.done' && event.item?.type === 'mcp_call') {
   const call = callFor(event);
   if(call.name==='cmg_report_source_analysis')return null; // The tool records one durable per-file event.
   const detail = describeMcpActivity(call.name, call.args, sourceFiles, call.item);
   const key = `${streamId}:${call.id}`;
   const stage=resultObject(call.item).ok===false?'error':'tool';
   return {stage, detail, event: call.name ? {key, stage, detail} : undefined};
  }
  if (!type.startsWith('response.mcp_call.') && !type.startsWith('response.mcp_call_arguments.')) return null;

  const call = callFor(event);
  if(call.name==='cmg_report_source_analysis' && type!=='response.mcp_call.failed')return null;
  const detail = describeMcpActivity(call.name, call.args, sourceFiles);
  const key = `${streamId}:${call.id}`;
  if (type === 'response.mcp_call.in_progress' || type === 'response.mcp_call_arguments.done') {
   return {stage: 'tool', detail, event: call.name ? {key, stage: 'tool', detail} : undefined};
  }
  if (type === 'response.mcp_call.completed') {
   const completed = describeMcpActivity(call.name, call.args, sourceFiles, call.item?.output || event.output || event.result);
   return {stage: 'tool', detail: completed, event: call.name ? {key, stage: 'tool', detail: completed} : undefined};
  }
  if (type === 'response.mcp_call.failed') {
   const failure = responseFailure(event);
   const failedDetail = `${detail}${failure ? ` · ${failure}` : ' · เครื่องมือแจ้งข้อผิดพลาด'}`.slice(0, 240);
   return {stage: 'error', detail: failedDetail, event: call.name ? {key, stage: 'error', detail: failedDetail} : undefined};
  }
  return null;
 };
}

function responseFailure(event) {
 const value = event?.error || event?.item?.error || event?.output_item?.error;
 if (typeof value === 'string') return value.slice(0, 120);
 if (typeof value?.message === 'string') return value.message.slice(0, 120);
 return '';
}
