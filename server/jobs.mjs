import {randomUUID} from 'node:crypto';

// Background generation jobs live in server memory: the browser may close the modal,
// change page or even close the tab while the provider is still working.
const RETENTION_MS = 6 * 60 * 60 * 1000;
export const JOB_TIMEOUT_MS = 20 * 60 * 1000;
const jobs = new Map();
const HISTORY_LIMIT = 100;
const UPDATE_MS = 100;

const fail = (message, status) => Object.assign(Error(message), {status});

function sweep(now) {
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > RETENTION_MS) jobs.delete(id);
  }
}

function recordStage(job) {
  const previous = job.events.at(-1);
  if (previous?.stage === job.stage && previous.detail === job.detail && previous.attempt === job.attempt) return;
  job.events.push({id: ++job.eventId, at: job.updatedAt, stage: job.stage, detail: job.detail, ...(job.attempt ? {attempt: job.attempt} : {})});
  job.events = job.events.slice(-HISTORY_LIMIT);
}

function publish(job, type) {
  const event = {id: ++job.eventId, type, job: publicJob(job)};
  for (const listener of job.listeners) {
    try { listener(event); } catch { job.listeners.delete(listener); }
  }
}

function ownedJob(id, uid) {
  const job = jobs.get(id);
  if (!job || job.uid !== uid) throw fail('ไม่พบงาน (อาจหมดอายุหรือเซิร์ฟเวอร์เริ่มใหม่)', 404);
  return job;
}

export function startJob({uid, projectId, provider, model, effort, prompt, mode = 'generate', run}) {
  const now = Date.now();
  sweep(now);
  for (const job of jobs.values()) {
    if (job.uid === uid && job.status === 'running') throw fail('มีงานสร้างโมเดลที่กำลังทำงานอยู่ กรุณารอให้เสร็จหรือยกเลิกก่อน', 409);
  }
  const controller = new AbortController();
  const job = {
    id: randomUUID(), uid, projectId, provider, model, effort, prompt, mode,
    status: 'running', createdAt: now, updatedAt: now, heartbeatAt: now,
    stage: 'queued', detail: 'กำลังเตรียมคำขอ…', thinking: [], controller,
    events: [], eventId: 0, listeners: new Set(),
  };
  recordStage(job);
  jobs.set(job.id, job);
  let pendingUpdate;
  const finish = (status, result, error) => {
    if (job.status !== 'running') return;
    clearTimeout(timer);
    clearTimeout(pendingUpdate);
    clearInterval(heartbeat);
    job.status = status;
    job.stage = status;
    if (status === 'done') {
      job.result = result;
      if (Array.isArray(result?.thinking)) job.thinking = result.thinking.filter(value => typeof value === 'string').slice(-8);
      job.detail = job.mode === 'edit' ? 'รายการแก้ไขพร้อมแล้ว กำลังตรวจและบันทึก' : 'สร้างโมเดลเสร็จแล้ว พร้อมตรวจผลลัพธ์';
    } else {
      job.error = error;
      job.detail = error;
    }
    job.updatedAt = job.heartbeatAt = job.finishedAt = Date.now();
    recordStage(job);
    publish(job, 'job');
    job.listeners.clear();
  };
  job.cancel = () => { finish('error', undefined, 'ยกเลิกแล้ว'); controller.abort(); };
  const timer = setTimeout(() => {
    finish('error', undefined, 'หมดเวลาประมวลผล');
    controller.abort();
  }, JOB_TIMEOUT_MS);
  const heartbeat = setInterval(() => {
    if (job.status !== 'running') return;
    // A live server is not evidence that the provider made progress.
    job.heartbeatAt = Date.now();
    publish(job, 'heartbeat');
  }, 5000);
  const update = patch => {
    if (job.status !== 'running' || !patch || typeof patch !== 'object') return;
    const before = [job.stage, job.detail, job.attempt];
    if (typeof patch.stage === 'string') job.stage = patch.stage;
    if (typeof patch.detail === 'string') job.detail = patch.detail;
    if (Array.isArray(patch.thinking)) job.thinking = patch.thinking.filter(value => typeof value === 'string').slice(-8);
    if (typeof patch.attempt === 'number') job.attempt = patch.attempt;
    job.updatedAt = Date.now();
    job.heartbeatAt = job.updatedAt;
    const stageChanged = before[0] !== job.stage || before[1] !== job.detail || before[2] !== job.attempt;
    if (stageChanged) {
      clearTimeout(pendingUpdate);
      pendingUpdate = undefined;
      recordStage(job);
      publish(job, 'job');
    } else if (Array.isArray(patch.thinking) && !pendingUpdate) {
      // Coalesce token deltas; don't render or serialize the entire summary per token.
      pendingUpdate = setTimeout(() => {
        pendingUpdate = undefined;
        if (job.status === 'running') publish(job, 'job');
      }, UPDATE_MS);
    }
  };
  new Promise(resolve => resolve(run(controller.signal, update)))
    .then(result => finish('done', result))
    .catch(error => {
      finish('error', undefined, error?.name === 'AbortError' ? 'หมดเวลาประมวลผล' : (error?.message || String(error)));
    });
  return job.id;
}

function publicJob(job) {
  const {status, createdAt, projectId, result, error} = job;
  return {
    id: job.id, status, createdAt, projectId, provider: job.provider, model: job.model, mode: job.mode,
    effort: job.effort || 'medium', prompt: job.prompt || '',
    stage: job.stage || (status === 'running' ? 'working' : status),
    detail: job.detail || '', updatedAt: job.updatedAt || createdAt,
    heartbeatAt: job.heartbeatAt || job.updatedAt || createdAt,
    thinking: Array.isArray(job.thinking) ? job.thinking : [],
    events: [...job.events], eventId: job.eventId,
    ...(job.attempt ? {attempt: job.attempt} : {}),
    ...(status === 'done' ? {result} : {}), ...(status === 'error' ? {error} : {}),
  };
}

export function getJob(id, uid) {
  return publicJob(ownedJob(id, uid));
}

// Every connection starts with an authoritative snapshot, including milestones
// missed while disconnected. Summary snapshots prevent duplicate token replay.
export function subscribeJob(id, uid, listener) {
  const job = ownedJob(id, uid);
  if (job.status === 'running') job.listeners.add(listener);
  return {snapshot: publicJob(job), unsubscribe: () => job.listeners.delete(listener)};
}

export function getLatestJob(uid) {
  sweep(Date.now());
  let latest;
  for (const job of jobs.values()) {
    if (job.uid === uid && (!latest || job.createdAt > latest.createdAt)) latest = job;
  }
  return latest ? publicJob(latest) : null;
}

export function cancelJob(id, uid) {
  const job = ownedJob(id, uid);
  if (job.status === 'running') job.cancel();
}
