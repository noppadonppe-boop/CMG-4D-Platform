import {unzipSync} from 'fflate';
import {createExtractorFromData} from 'node-unrar-js';
import path from 'node:path';
import DxfParser from 'dxf-parser';
import {fileURLToPath} from 'node:url';
import {adminStorageBucket} from './auth.mjs';

export const INLINE_PREPARE_BYTES = 8 * 1024 * 1024;
export const MAX_STORED_FILE_BYTES = 512 * 1024 * 1024;

function extension(name) {
 return String(name || '').split('.').pop().toLowerCase();
}

function preparedFileSize(file) {
 const size = Number(file.size);
 return Number.isFinite(size) && size >= 0 ? size : undefined;
}

export async function prepareFiles(files,depth=0,options={includeBinary:true}){
 if(depth>3)throw Error('แฟ้มซ้อนกันเกิน 3 ชั้น กรุณาแยกไฟล์ก่อน');
 const result=[];
 for(const file of files){
  const bytes=Buffer.from(file.data,'base64'),ext=extension(file.name);
  if(ext==='zip'){
   const entries=unzipSync(bytes);const nested=Object.entries(entries).filter(([name])=>!name.endsWith('/')).map(([name,data])=>({fileId:file.fileId,name:file.name+'/'+name,data:Buffer.from(data).toString('base64')}));
   result.push(...await prepareFiles(nested,depth+1,options));
  }else if(ext==='rar'){
   const extractor=await createExtractorFromData({data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
   const nested=[];for(const f of extractor.extract().files)if(f.extraction)nested.push({fileId:file.fileId,name:file.name+'/'+f.fileHeader.name,data:Buffer.from(f.extraction).toString('base64')});
   result.push(...await prepareFiles(nested,depth+1,options));
  }else if(ext==='dxf'){
   const db=new DxfParser().parseSync(bytes.toString('utf8'));if(!db?.entities?.length)throw Error('ไม่พบ geometry ใน DXF: '+file.name);result.push({fileId:file.fileId,name:file.name,kind:'text',text:JSON.stringify(db),detail:'Native DXF coordinates / layers / entities'});
  }else if(ext==='dwg'){
   const {LibreDwg,Dwg_File_Type}=await import('@mlightcad/libredwg-web');
   const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../node_modules/@mlightcad/libredwg-web/wasm')+path.sep;
   const reader=await LibreDwg.create(dir);
   const ptr=reader.dwg_read_data(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),ext==='dwg'?Dwg_File_Type.DWG:Dwg_File_Type.DXF);
   if(!ptr)throw Error('อ่าน CAD ไม่สำเร็จ: '+file.name+' — ส่งออก PDF หรือ DXF แล้วลองอีกครั้ง');
   try {const db=reader.convert(ptr);if(!db.entities?.length)throw Error('ไม่พบ geometry ใน DWG: '+file.name);const text=JSON.stringify({header:db.header,tables:db.tables,entities:db.entities,objects:{LAYOUT:db.objects?.LAYOUT,IMAGEDEF:db.objects?.IMAGEDEF}});if(text.length>1500000)throw Error('CAD ใหญ่เกินรอบประมวลผล: '+file.name+' กรุณาแยกชั้น/โซน');result.push({fileId:file.fileId,name:file.name,kind:'text',text,detail:'Native CAD coordinates / layers / entities'});}finally{reader.dwg_free(ptr)}
  }else if(ext==='pdf')result.push({fileId:file.fileId,name:file.name,kind:'pdf',...(options.includeBinary?{data:file.data}:{}),mime:'application/pdf',size:preparedFileSize(file) ?? bytes.length,detail:'PDF ทุกหน้า ส่งให้โมเดลอ่านภาพและข้อความ'});
  else if(['png','jpg','jpeg','webp'].includes(ext))result.push({fileId:file.fileId,name:file.name,kind:'image',...(options.includeBinary?{data:file.data}:{}),mime:ext==='jpg'||ext==='jpeg'?'image/jpeg':'image/'+ext,size:preparedFileSize(file) ?? bytes.length,detail:'ภาพอ้างอิง'});
  else if(['csv','txt','json'].includes(ext))result.push({fileId:file.fileId,name:file.name,kind:'text',text:bytes.toString('utf8'),detail:'ข้อความ / Timeline'});
  else result.push({fileId:file.fileId,name:file.name,kind:'unsupported',detail:'ยังอ่านชนิดไฟล์นี้ไม่ได้'});
  if(result.length>100)throw Error('เกิน 100 ไฟล์ต่อรอบ กรุณาแยกเป็นชุด');
 }return result;
}

// Large-file preparation is intentionally server-side. The browser sends only
// document metadata, Cloud Run reads the object from Storage, and binary data
// is not returned through the JSON response. Text/CAD still use the existing
// native parsers; PDF/image entries only need classification at this stage.
export async function prepareStoredFiles(projectId,files,suppliedBucket){
 if(!projectId)throw Error('ไม่พบรหัสโครงการสำหรับอ่านไฟล์จาก Storage');
 if(!Array.isArray(files)||!files.length)throw Error('เลือกไฟล์ก่อน');
 const bucket=suppliedBucket||adminStorageBucket();
 const prepared=[];
 const loaded=[];
 for(const file of files.slice(0,100)){
  if(!file?.fileId||!file?.name)throw Error('รายการไฟล์ไม่ถูกต้อง');
  const storageFile=bucket.file(`CMG-4D-Platform/root/projects/${projectId}/files/${file.fileId}`);
  let declaredSize=Number(file.size);
  if(!Number.isFinite(declaredSize)||declaredSize<0)declaredSize=0;
  if(declaredSize>MAX_STORED_FILE_BYTES)throw Error(`ไฟล์ใหญ่เกิน ${MAX_STORED_FILE_BYTES/1024/1024} MB: ${file.name}`);
  const ext=extension(file.name);
  let actualSize=declaredSize||undefined;
  if(typeof storageFile.getMetadata==='function'){
   try{const [metadata]=await storageFile.getMetadata();const size=Number(metadata?.size);if(Number.isFinite(size)&&size>=0)actualSize=size;}catch(error){throw Error(`ตรวจสอบไฟล์ใน Storage ไม่สำเร็จ · ${file.name}: ${error?.message||'ไม่สามารถอ่าน metadata ได้'}`)}
  }
  if(actualSize>MAX_STORED_FILE_BYTES)throw Error(`ไฟล์ใหญ่เกิน ${MAX_STORED_FILE_BYTES/1024/1024} MB: ${file.name}`);
  if(ext==='pdf'){
   prepared.push({fileId:file.fileId,name:file.name,kind:'pdf',mime:'application/pdf',...(actualSize===undefined?{}:{size:actualSize}),detail:'PDF ทุกหน้า ส่งให้โมเดลอ่านภาพและข้อความ'});
   continue;
  }
  if(['png','jpg','jpeg','webp'].includes(ext)){
   prepared.push({fileId:file.fileId,name:file.name,kind:'image',mime:ext==='jpg'||ext==='jpeg'?'image/jpeg':'image/'+ext,...(actualSize===undefined?{}:{size:actualSize}),detail:'ภาพอ้างอิง'});
   continue;
  }
  if(!['zip','rar','dxf','dwg','csv','txt','json'].includes(ext)){
   prepared.push({fileId:file.fileId,name:file.name,kind:'unsupported',detail:'ยังอ่านชนิดไฟล์นี้ไม่ได้'});
   continue;
  }
  let buffer;
  try{[buffer]=await storageFile.download();}catch(error){throw Error(`โหลดไฟล์ไม่สำเร็จ · ${file.name}: ${error?.message||'ดาวน์โหลดไม่ได้'}`)}
  if(buffer.length>MAX_STORED_FILE_BYTES)throw Error(`ไฟล์ใหญ่เกิน ${MAX_STORED_FILE_BYTES/1024/1024} MB: ${file.name}`);
  loaded.push({fileId:file.fileId,name:file.name,data:buffer.toString('base64'),size:buffer.length});
 }
 if(loaded.length)prepared.push(...await prepareFiles(loaded,0,{includeBinary:false}));
 if(prepared.length>100)throw Error('เกิน 100 ไฟล์ต่อรอบ กรุณาแยกเป็นชุด');
 return prepared;
}
