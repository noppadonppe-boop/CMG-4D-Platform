import {adminFirestore} from './auth.mjs';
import {scopeFingerprint} from './mcpScope.mjs';
import {normalizeMcpHistory} from './mcpConversation.mjs';

const ROOT = 'CMG-4D-Platform/root/mcpRequests';

export async function createMcpRequest({requestId,uid,email,role,projectId,prompt,scopeToken,operation='edit',provider,model,effort,history,files,selectedId,scope}) {
 const db = adminFirestore();
 const now = new Date();
 await db.doc(`${ROOT}/${requestId}`).set({
  id: requestId,
  uid,
  email: String(email || ''),
  role: Array.isArray(role) ? role.slice(0, 8) : [],
  projectId,
  prompt: String(prompt).slice(0, 8000),
  history: normalizeMcpHistory(history),
  sourceFiles: Array.isArray(files) ? files.slice(0, 100).map(file => ({fileId: String(file.fileId || '').slice(0, 200), name: String(file.name || '').slice(0, 240), kind: String(file.kind || '').slice(0, 20)})) : [],
  selectedId: typeof selectedId === 'string' ? selectedId.slice(0, 200) : '',
  editScope: scope === 'selected' ? 'selected' : 'auto',
  scopeToken,
   operation: operation === 'generate' ? 'generate' : 'edit',
   provider,
   model,
   effort,
  status: 'queued',
  createdAt: now,
  updatedAt: now,
  events: [],
  scopeFingerprint: scopeFingerprint(scopeToken),
 });
 return {id: requestId, status: 'queued', createdAt: now.getTime()};
}

const TERMINAL = new Set(['done','error','cancelled']);
const WORKER_STALE_MS = 65 * 60 * 1000;

// Cloud Tasks may redeliver when a worker loses its connection. Serialize claims
// in Firestore, and let a stale task retry after Cloud Run's request deadline.
export async function claimMcpRequest(requestId) {
 const db = adminFirestore();
 const ref = db.doc(`${ROOT}/${requestId}`);
 return db.runTransaction(async tx => {
  const snapshot = await tx.get(ref);
  if (!snapshot.exists) return {status: 'missing'};
  const request = {id: requestId, ...snapshot.data()};
  if (TERMINAL.has(request.status)) return {status: 'terminal', request};
  const updatedAt = request.updatedAt?.toDate ? request.updatedAt.toDate().getTime() : Number(request.updatedAt) || 0;
  if (request.status === 'running' && Date.now() - updatedAt < WORKER_STALE_MS) return {status: 'busy', request};
  const now = new Date();
  tx.set(ref, {status: 'running', stage: 'starting', detail: 'กำลังเริ่มงาน MCP เบื้องหลัง', updatedAt: now}, {merge: true});
  return {status: 'claimed', request: {...request, status: 'running', updatedAt: now}};
 });
}

export async function readMcpRequest(requestId) {
 const snapshot = await adminFirestore().doc(`${ROOT}/${requestId}`).get();
 return snapshot.exists ? {id: requestId, ...snapshot.data()} : undefined;
}

export async function updateMcpRequest(requestId, patch) {
 const db = adminFirestore(), ref = db.doc(`${ROOT}/${requestId}`);
 await db.runTransaction(async tx => {
 const snapshot = await tx.get(ref);
 const current = snapshot.data() || {};
 const allowed = ['status','stage','detail','result','error','completedAt','scopeToken','scopeFingerprint','sourceAnalyses'];
 const update = {updatedAt: new Date()};
 for (const key of allowed) if (patch[key] !== undefined) update[key] = patch[key];
 if (Array.isArray(patch.sourceAnalyses)) {
  const reports = new Map((current.sourceAnalyses || []).map(report => [report.fileId, report]));
  for (const report of patch.sourceAnalyses) reports.set(report.fileId, report);
  update.sourceAnalyses = [...reports.values()];
 }
 if (patch.event && typeof patch.event === 'object' && typeof patch.event.stage === 'string' && typeof patch.event.detail === 'string') {
  const events = Array.isArray(current?.events) ? current.events : [];
  const key = typeof patch.event.key === 'string' ? patch.event.key.slice(0, 240) : '';
  const existingIndex = key ? events.findIndex(event => event?.key === key) : -1;
  if (existingIndex >= 0) {
   update.events = events.map((event, index) => index === existingIndex
    ? {...event, at: Date.now(), stage: patch.event.stage, detail: patch.event.detail}
    : event);
  } else {
   const lastId = events.reduce((max, event) => Math.max(max, Number(event?.id) || 0), 0);
   update.events = [...events, {id: lastId + 1, at: Date.now(), stage: patch.event.stage, detail: patch.event.detail, ...(key ? {key} : {})}].slice(-100);
  }
 }
 tx.set(ref, update, {merge: true});
 });
 return readMcpRequest(requestId);
}

export function publicMcpRequest(request) {
 if (!request) return null;
 return {
  id: request.id,
  projectId: request.projectId,
  operation: request.operation || 'edit',
   provider: request.provider,
   model: request.model,
   effort: request.effort,
  status: request.status,
  stage: request.stage,
  detail: request.detail,
  result: request.result,
  generation: request.generation,
  error: request.error,
  events: Array.isArray(request.events) ? request.events.filter(event => event && typeof event.id === 'number' && typeof event.at === 'number' && typeof event.stage === 'string' && typeof event.detail === 'string').slice(-100).map(({id,at,stage,detail}) => ({id,at,stage,detail})) : [],
  createdAt: request.createdAt?.toDate ? request.createdAt.toDate().getTime() : request.createdAt,
  updatedAt: request.updatedAt?.toDate ? request.updatedAt.toDate().getTime() : request.updatedAt,
  completedAt: request.completedAt?.toDate ? request.completedAt.toDate().getTime() : request.completedAt,
 };
}

