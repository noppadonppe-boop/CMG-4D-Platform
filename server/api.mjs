import express from 'express';
import {prepareFiles,prepareStoredFiles} from './files.mjs';
import {models} from './ai.mjs';
import {validateEditContext} from '../src/modelEdit.mjs';
import {models as mcpModels,effortOptions} from '../src/providers.mjs';
import {authorizeProject,verifyUser} from './auth.mjs';
import {getJob,getLatestJob,cancelJob} from './jobs.mjs';
import {streamJob} from './jobStream.mjs';
import {triggerMcpProvider,getMcpRequestForUser,cancelMcpRequestForUser,runQueuedMcpRequest,validMcpTaskRequest} from './mcpIntegration.mjs';
import {handleMcpRequest,mcpHealth} from './mcpServer.mjs';

const failRequest = message => Object.assign(Error(message), {status: 400});
function validateAIRequest(body) {
 if (!body || typeof body !== 'object') throw failRequest('ข้อมูลคำขอสร้างโมเดลไม่ถูกต้อง');
 if (!models[body.provider]?.includes(body.model)) throw failRequest('โมเดลหรือผู้ให้บริการไม่รองรับ');
 if (!effortOptions[body.provider]?.some(option => option.value === body.effort)) throw failRequest('ระดับการคิดไม่รองรับสำหรับผู้ให้บริการนี้');
 if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw failRequest('กรุณาระบุรายละเอียดโมเดล');
 if (body.prompt.length > 2000000) throw failRequest('รายละเอียดโมเดลยาวเกินไป กรุณาแบ่งคำขอเป็นชุดเล็กลง');
}
export function validateEditRequest(body) {
 validateAIRequest(body);
 if (body.prompt.length > 8000) throw failRequest('คำสั่งแก้ไขยาวเกินไป กรุณาแบ่งคำสั่ง');
 if (body.files !== undefined || body.project !== undefined) throw failRequest('โหมดแก้เฉพาะส่วนรับเฉพาะบริบทชิ้นส่วน ไม่รับไฟล์หรือโมเดลทั้งชุด');
 try { validateEditContext(body.context); } catch (error) { throw failRequest(error.message); }
 if (body.context.projectId !== body.projectId) throw failRequest('บริบทแก้ไขเป็นของโครงการอื่น');
 if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 6 || !body.history.every(message => message && ['user','assistant'].includes(message.role) && typeof message.text === 'string' && message.text.length <= 1200))) throw failRequest('ประวัติสนทนาสำหรับแก้ไขไม่ถูกต้อง');
}
function validateMcpRequest(body) {
 if (!body || typeof body !== 'object') throw failRequest('ข้อมูลคำขอ MCP ไม่ถูกต้อง');
 if (!mcpModels[body.provider]?.includes(body.model)) throw failRequest('โมเดลหรือผู้ให้บริการ MCP ไม่รองรับ');
 if (!effortOptions[body.provider]?.some(option => option.value === body.effort)) throw failRequest('ระดับการคิดไม่รองรับสำหรับผู้ให้บริการนี้');
 if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw failRequest('กรุณาระบุคำสั่งสำหรับ MCP');
 if (body.prompt.length > 2000000) throw failRequest('คำสั่ง MCP ยาวเกินไป กรุณาแบ่งคำขอเป็นชุดเล็กลง');
 if (body.files !== undefined && (!Array.isArray(body.files) || body.files.length > 100 || body.files.some(file => !file || typeof file.fileId !== 'string' || typeof file.name !== 'string' || !['text','pdf','image'].includes(file.kind)))) throw failRequest('รายการไฟล์ประกอบคำสั่งไม่ถูกต้อง');
}

export function api(){const app=express();app.use(express.json({limit:'100mb'}));
 app.get('/health',(_req,res)=>res.json({ok:true,service:'cmg-4d-api'}));
 app.post('/internal/mcp/run',async(req,res)=>{if(!validMcpTaskRequest(req))return res.status(401).json({error:'MCP task authentication required'});try{const state=await runQueuedMcpRequest(req.body?.requestId);if(state==='busy')return res.set('Retry-After','60').status(503).json({error:'MCP request is already running'});res.json({ok:true,state});}catch(error){res.set('Retry-After','60').status(503).json({error:error.message||'MCP worker temporarily unavailable'});}});
 app.post('/api/prepare',async(req,res)=>{try{await authorizeProject(req);if(!Array.isArray(req.body.files)||!req.body.files.length)throw Error('เลือกไฟล์ก่อน');const inline=req.body.files.filter(file=>typeof file?.data==='string'&&file.data);const stored=req.body.files.filter(file=>!(typeof file?.data==='string'&&file.data));const prepared=[];if(inline.length)prepared.push(...await prepareFiles(inline));if(stored.length)prepared.push(...await prepareStoredFiles(req.body.projectId,stored));res.json({files:prepared});}catch(e){res.status(e.status||400).json({error:e.message});}});
 app.get('/api/jobs/current',async(req,res)=>{try{const {decoded}=await verifyUser(req);res.json({job:getLatestJob(decoded.uid)});}catch(e){res.status(e.status||400).json({error:e.message});}});
 app.get('/api/jobs/:id/events',async(req,res)=>{try{const {decoded}=await verifyUser(req);streamJob(req,res,decoded.uid);}catch(e){if(res.headersSent)res.destroy();else res.status(e.status||400).json({error:e.message});}});
 app.get('/api/jobs/:id',async(req,res)=>{try{const {decoded}=await verifyUser(req);res.json(getJob(req.params.id,decoded.uid));}catch(e){res.status(e.status||400).json({error:e.message});}});
 app.delete('/api/jobs/:id',async(req,res)=>{try{const {decoded}=await verifyUser(req);cancelJob(req.params.id,decoded.uid);res.status(204).end();}catch(e){res.status(e.status||400).json({error:e.message});}});
 app.post('/api/mcp/trigger',async(req,res)=>{try{validateMcpRequest(req.body);const result=await triggerMcpProvider(req,req.body);res.status(202).json(result);}catch(e){res.status(e.status||400).json({error:e.message});}});
 app.get('/api/mcp/requests/:id',async(req,res)=>{try{res.json(await getMcpRequestForUser(req,req.params.id));}catch(e){res.status(e.status||400).json({error:e.message});}});
 app.delete('/api/mcp/requests/:id',async(req,res)=>{try{res.json(await cancelMcpRequestForUser(req,req.params.id));}catch(e){res.status(e.status||400).json({error:e.message});}});
 app.get('/mcp/health',mcpHealth);
 app.post('/mcp',handleMcpRequest);
 app.get('/mcp',(_req,res)=>res.status(405).json({error:'MCP ใช้ POST Streamable HTTP'}));
 app.delete('/mcp',(_req,res)=>res.status(405).json({error:'MCP session stateless'}));
 app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const tooLarge=err?.type==='entity.too.large';
  const status=tooLarge?413:(Number.isInteger(err?.status)&&err.status>=400&&err.status<600?err.status:500);
  const message=tooLarge?'ไฟล์รวมใหญ่เกิน 100 MB กรุณาแบ่งชุด':(typeof err?.message==='string'&&err.message.trim()?err.message:'เซิร์ฟเวอร์เกิดข้อผิดพลาด');
  console.error('[api]',req.method,req.originalUrl,status,message);
  res.status(status).json({error:message});
 });return app;}
