import {adminFirestore} from './auth.mjs';
import {validateElement,validateProject} from '../src/domain.mjs';
import {normalizeGenerationElement} from './generationSchema.mjs';

export function parseGenerationBatch(json) {
 if (Buffer.byteLength(json, 'utf8') > 700000) throw Error('ชุดข้อมูลใหญ่เกินไป ให้แบ่งชุดละไม่เกิน 100 ชิ้น');
 const data = JSON.parse(json);
 if (!data || !Array.isArray(data.elements)) throw Error('ต้องส่ง elements เป็น array');
 if(data.elements.length>3000)throw Error(`ส่งมา ${data.elements.length} ชิ้น เกินขีดจำกัดโมเดล 3000 ชิ้น`);
 data.elements=data.elements.map(normalizeGenerationElement);
 const invalid=data.elements.findIndex(e=>!validateElement(e));
 if(invalid>=0)throw Error(`elements[${invalid}] (${data.elements[invalid].id}): ตำแหน่งต้องอยู่ในช่วง ±100000 เมตรและขนาดต้องมากกว่า 0`);
 if (new Set(data.elements.map(e=>e.id)).size !== data.elements.length) throw Error('รหัสชิ้นส่วนซ้ำภายในชุด');
 if (data.description !== undefined && typeof data.description !== 'string') throw Error('description ต้องเป็นข้อความ');
 if (data.name !== undefined && typeof data.name !== 'string') throw Error('name ต้องเป็นข้อความ');
 if (data.notes !== undefined && (!Array.isArray(data.notes) || !data.notes.every(n=>typeof n==='string'))) throw Error('notes ต้องเป็นรายการข้อความ');
 const activities = data.activities || [];
 // Links can refer to parts saved in another batch. Validate their geometry
 // and cross-batch links only after assembling all batches.
 if (!Array.isArray(activities) || activities.length > 100 || !validateProject({id:'batch',name:'batch',elements:data.elements,activities:activities.map(a=>({...a,elementIds:undefined})),...(data.floors ? {floors:data.floors} : {})})) throw Error('ข้อมูลชั้นหรือแผนงานในชุดไม่ถูกต้อง');
 if (activities.some(a=>a.elementIds!==undefined && (!Array.isArray(a.elementIds)||!a.elementIds.every(id=>typeof id==='string')))) throw Error('elementIds ต้องเป็นรายการรหัสชิ้นส่วน');
 return {...data,activities};
}

export function assembleGenerationBatches(batches) {
 const sorted = [...batches].sort((a,b)=>a.index-b.index);
 if (!sorted.length || sorted.some((b,i)=>b.index!==i)) throw Error('ชุดข้อมูลไม่ต่อเนื่อง ต้องเริ่ม batch_index ที่ 0');
 const model={name:'โมเดลจากแบบ',description:'',floors:[],elements:[],activities:[],notes:[]};
 for(const batch of sorted){
  const data=parseGenerationBatch(batch.json);
  if(data.name)model.name=data.name;
  if(data.description)model.description=data.description;
  if(data.floors?.length){if(model.floors.length && JSON.stringify(model.floors)!==JSON.stringify(data.floors))throw Error('ข้อมูลชั้นต่างกันระหว่างชุด');model.floors=data.floors;}
  model.elements.push(...data.elements);model.activities.push(...data.activities);model.notes.push(...(data.notes||[]));
 }
 if(new Set(model.elements.map(e=>e.id)).size!==model.elements.length)throw Error('รหัสชิ้นส่วนซ้ำข้ามชุด ให้แก้ชุดที่ซ้ำ อย่าส่งชิ้นเดิมใหม่');
 if(model.elements.length>3000)throw Error('โมเดลเกิน 3000 ชิ้น');
 return model;
}

export async function saveGenerationBatch({requestId,index,json,expectedVersion}) {
 const data=parseGenerationBatch(json),db=adminFirestore();
 const request=db.doc(`CMG-4D-Platform/root/mcpRequests/${requestId}`),batch=request.collection('generationBatches').doc(String(index));
 return db.runTransaction(async tx=>{
  const [r,b]=await Promise.all([tx.get(request),tx.get(batch)]);const current=r.data();
  if(current?.status!=='running')throw Error('คำขอสร้างโมเดลนี้ไม่ได้กำลังทำงาน');
  const generation=current.generation||{batchCount:0,elementCount:0,expectedVersion};
  if(generation.expectedVersion!==expectedVersion)throw Error('expected_version ต้องตรงกับรุ่นที่เริ่มสร้าง');
  if(index>generation.batchCount)throw Error(`ชุดถัดไปต้องเป็น batch_index ${generation.batchCount}`);
  const next={...generation,batchCount:Math.max(generation.batchCount,index+1),elementCount:generation.elementCount-(b.data()?.elementCount||0)+data.elements.length};
  if(next.elementCount>3000)throw Error('โมเดลเกิน 3000 ชิ้น');
  tx.set(batch,{json:JSON.stringify(data),index,elementCount:data.elements.length,createdAt:new Date()});
  tx.update(request,{generation:next,updatedAt:new Date(),error:'',detail:`บันทึกชุด ${index+1} แล้ว · สะสม ${next.elementCount} ชิ้น`});
  return {...next,nextBatchIndex:next.batchCount};
 });
}

export async function readGenerationBatches(requestId) {
 const snapshot=await adminFirestore().collection(`CMG-4D-Platform/root/mcpRequests/${requestId}/generationBatches`).get();
 return snapshot.docs.map(doc=>doc.data());
}
