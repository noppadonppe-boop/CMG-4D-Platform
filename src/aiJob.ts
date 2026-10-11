import {useCallback,useEffect,useState} from 'react';
import {auth} from './cloud';
import type {Project} from './domain.mjs';
import type {ChatMessage} from './domain.mjs';
import type {EditContext, ModelPatch} from './modelEdit.mjs';
import {readJobEvents} from './jobEvents.mjs';

export type McpProviderSettings = {provider: string; model: string; effort: string};
export type McpSourceFile = {fileId: string; name: string; kind: string};
export type McpEditRequest = {mode: 'mcp'; operation: 'edit'; projectId: string; prompt: string} & McpProviderSettings & {selectedId?: string; scope?: 'auto' | 'selected'; history?: ChatMessage[]; files?: McpSourceFile[]};
export type McpGenerateRequest = {mode: 'mcp'; operation: 'generate'; projectId: string; prompt: string; files: McpSourceFile[]} & McpProviderSettings & {history?: ChatMessage[]};
export type GenerateResult = {mode?: 'generate'; project: Project; notes: string[]; thinking?: string[]};
export type EditResult = {mode: 'edit'; patch: ModelPatch; context: EditContext; notes: string[]; thinking?: string[]};
export type McpResult = {mode: 'mcp'; operation?: 'edit' | 'generate'; message?: string; changedCount?: number; version?: number; notes?: string[]};
export type JobResult = GenerateResult | EditResult;
export type AiJobEvent = {id: number; at: number; stage: string; detail: string; attempt?: number};
export type AiJob = {
  id: string;
  mode?: 'generate' | 'edit' | 'mcp';
  operation?: 'generate' | 'edit';
  projectId?: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  provider: string;
  model: string;
  effort: string;
  prompt: string;
  stage?: string;
  detail?: string;
  updatedAt?: number;
  heartbeatAt?: number;
  thinking?: string[];
  attempt?: number;
  result?: JobResult | McpResult;
  error?: string;
  reconnecting?: boolean;
  events?: AiJobEvent[];
  eventId?: number;
  transport?: 'stream' | 'poll';
};
export type AiJobControl = {
  job: AiJob | null;
  start: (request: McpEditRequest | McpGenerateRequest, userPrompt: string) => Promise<void>;
  cancel: () => Promise<void>;
  dismiss: () => void;
};

type Stored = {
  id: string;
  mode?: 'generate' | 'edit' | 'mcp';
  operation?: 'generate' | 'edit';
  projectId?: string;
  startedAt: number;
  provider: string;
  model: string;
  effort: string;
  prompt: string;
  status: AiJob['status'];
  stage?: string;
  detail?: string;
  updatedAt?: number;
  heartbeatAt?: number;
  thinking?: string[];
  attempt?: number;
  result?: JobResult | McpResult;
  error?: string;
  events?: AiJobEvent[];
  eventId?: number;
};
const POLL_MS = 3000;
const MCP_POLL_MS = 1200;
const STREAM_IDLE_MS = 20000;
const storageKey = (uid: string) => 'cmg-ai-job:' + uid;
const dismissedKey = (uid: string) => 'cmg-ai-job-dismissed:' + uid;

export async function apiRequest(method: string, url: string, data?: unknown, signal?: AbortSignal) {
  if (!auth?.currentUser) throw Error('กรุณาเข้าสู่ระบบ');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(url, {
    method,
    headers: {...(data ? {'Content-Type': 'application/json'} : {}), Authorization: 'Bearer ' + token},
    body: data ? JSON.stringify(data) : undefined,
    signal,
  });
  const responseText = response.status === 204 ? '' : await response.text().catch(() => '');
  let body: any = {};
  try { body = responseText ? JSON.parse(responseText) : {}; } catch { /* proxy errors may be plain text or HTML */ }
  if (!response.ok) throw Object.assign(Error(body.error || `เซิร์ฟเวอร์ตอบกลับ HTTP ${response.status}${responseText ? ' (ไม่ใช่ JSON)' : ''}`), {status: response.status});
  return body;
}

function readStored(uid: string): Stored | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(uid)) || 'null');
    if (!value || typeof value.id !== 'string' || typeof value.startedAt !== 'number') return null;
    const status = value.status === 'done' || value.status === 'error' ? value.status : 'running';
    // Keep jobs created by an older build. Their provider is unknown, but the
    // server can still tell us whether the job is running, done or gone.
    return {
      id: value.id,
      ...(value.mode === 'edit' || value.mode === 'generate' || value.mode === 'mcp' ? {mode: value.mode} : {}),
      ...(value.operation === 'edit' || value.operation === 'generate' ? {operation: value.operation} : {}),
      ...(typeof value.projectId === 'string' ? {projectId: value.projectId} : {}),
      startedAt: value.startedAt,
      provider: typeof value.provider === 'string' ? value.provider : 'ไม่ทราบผู้ให้บริการ',
      model: typeof value.model === 'string' ? value.model : 'ไม่ทราบโมเดล',
      effort: typeof value.effort === 'string' ? value.effort : 'medium',
      prompt: typeof value.prompt === 'string' ? value.prompt : '',
      status,
      ...(typeof value.stage === 'string' ? {stage: value.stage} : {}),
      ...(typeof value.detail === 'string' ? {detail: value.detail} : {}),
      ...(typeof value.updatedAt === 'number' ? {updatedAt: value.updatedAt} : {}),
      ...(typeof value.heartbeatAt === 'number' ? {heartbeatAt: value.heartbeatAt} : {}),
      ...(Array.isArray(value.thinking) ? {thinking: value.thinking.filter((item: unknown): item is string => typeof item === 'string')} : {}),
      ...(typeof value.attempt === 'number' ? {attempt: value.attempt} : {}),
      ...(value.result ? {result: value.result} : {}),
      ...(typeof value.error === 'string' ? {error: value.error} : {}),
      ...eventMetadata(value),
    };
  } catch {
    return null;
  }
}

function saveStored(uid: string, job: AiJob) {
  const stored: Stored = {
    id: job.id,
    mode: job.mode,
    operation: job.operation,
    projectId: job.projectId,
    startedAt: job.startedAt,
    provider: job.provider,
    model: job.model,
    effort: job.effort,
    prompt: job.prompt,
    status: job.status,
    ...(job.stage ? {stage: job.stage} : {}),
    ...(job.detail ? {detail: job.detail} : {}),
    ...(job.updatedAt ? {updatedAt: job.updatedAt} : {}),
    ...(job.heartbeatAt ? {heartbeatAt: job.heartbeatAt} : {}),
    ...(job.thinking?.length ? {thinking: job.thinking} : {}),
    ...(job.attempt ? {attempt: job.attempt} : {}),
    ...(job.result ? {result: job.result} : {}),
    ...(job.error ? {error: job.error} : {}),
    events: job.events,
    eventId: job.eventId,
  };
  try { localStorage.setItem(storageKey(uid), JSON.stringify(stored)); }
  catch {
    // Large completed geometry can exhaust browser storage. Retain the id so
    // reload can recover the result from the server instead of failing the stream.
    try { localStorage.setItem(storageKey(uid), JSON.stringify({...stored, result: undefined, thinking: undefined})); } catch { /* storage unavailable */ }
  }
}

function eventMetadata(value: any): {events?: AiJobEvent[]; eventId?: number} {
  return {
    ...(Array.isArray(value.events) ? {events: value.events.filter((event: any) => event && typeof event.id === 'number' && typeof event.at === 'number' && typeof event.stage === 'string' && typeof event.detail === 'string').slice(-100)} : {}),
    ...(typeof value.eventId === 'number' ? {eventId: value.eventId} : {}),
  };
}

function fromServer(value: any): AiJob | null {
  if (!value || typeof value.id !== 'string') return null;
  const status: AiJob['status'] = value.status === 'done' || value.status === 'error' ? value.status : 'running';
  return {
    id: value.id,
    ...(value.mode === 'edit' || value.mode === 'generate' || value.mode === 'mcp' ? {mode: value.mode} : {}),
    ...(value.operation === 'edit' || value.operation === 'generate' ? {operation: value.operation} : {}),
    ...(typeof value.projectId === 'string' ? {projectId: value.projectId} : {}),
    status,
    startedAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    provider: typeof value.provider === 'string' ? value.provider : 'ไม่ทราบผู้ให้บริการ',
    model: typeof value.model === 'string' ? value.model : 'ไม่ทราบโมเดล',
    effort: typeof value.effort === 'string' ? value.effort : 'medium',
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    ...(typeof value.stage === 'string' ? {stage: value.stage} : {}),
    ...(typeof value.detail === 'string' ? {detail: value.detail} : {}),
    ...(typeof value.updatedAt === 'number' ? {updatedAt: value.updatedAt} : {}),
    ...(typeof value.heartbeatAt === 'number' ? {heartbeatAt: value.heartbeatAt} : {}),
    ...(Array.isArray(value.thinking) ? {thinking: value.thinking.filter((item: unknown): item is string => typeof item === 'string')} : {}),
    ...(typeof value.attempt === 'number' ? {attempt: value.attempt} : {}),
    ...(value.result ? {result: value.result} : {}),
    ...(typeof value.error === 'string' ? {error: value.error} : {}),
    ...eventMetadata(value),
  };
}

// The generation itself runs on the server. This hook only starts it, remembers its id
// (so a reload or a closed tab can pick it up again) and streams its snapshots.
export function useAiJob(uid: string | undefined): AiJobControl {
  const [job, setJob] = useState<AiJob | null>(null);

  useEffect(() => {
    const stored = uid ? readStored(uid) : null;
    let stopped = false;
    setJob(stored ? stored : null);
    const missingCompletedResult = !!stored && stored.status === 'done' && !stored.result;
    if (!uid || (stored && !missingCompletedResult)) return () => { stopped = true; };
    // Recover a job that is still held by the server when browser storage was
    // cleared or this tab was opened on another device/browser profile.
    const recoveryUrl = missingCompletedResult ? '/api/jobs/' + stored!.id : '/api/jobs/current';
    apiRequest('GET', recoveryUrl).then(body => {
      if (stopped) return;
      const recovered = fromServer(missingCompletedResult ? body : body.job);
      if (recovered && recovered.id !== localStorage.getItem(dismissedKey(uid))) {
        localStorage.removeItem(dismissedKey(uid));
        saveStored(uid, recovered);
        setJob(recovered);
      }
    }).catch(() => { /* the normal signed-in screen remains usable */ });
    return () => { stopped = true; };
  }, [uid]);

  const activeId = job?.status === 'running' && job.mode !== 'mcp' ? job.id : null;
  useEffect(() => {
    if (!activeId || !uid) return;
    let stopped = false;
    let terminal = false;
    let failures = 0;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (patch: Partial<AiJob>) => setJob(current => {
      if (stopped || !current || current.id !== activeId || current.status !== 'running') return current;
      if (typeof patch.eventId === 'number' && typeof current.eventId === 'number' && patch.eventId < current.eventId) return current;
      const next = {...current, ...patch};
      if (uid) saveStored(uid, next);
      return next;
    });
    const receive = (body: any, transport: 'stream' | 'poll') => {
      const next = fromServer(body);
      if (!next || next.id !== activeId) throw Error('ข้อมูลสถานะงานไม่ถูกต้อง');
      terminal = next.status !== 'running';
      // Keep the short user-facing prompt; the server prompt includes model JSON.
      const {prompt: _prompt, ...metadata} = next;
      update({...metadata, reconnecting: false, transport});
      failures = 0;
      return !terminal && !stopped;
    };
    const connect = async () => {
      try {
        if (!auth?.currentUser || auth.currentUser.uid !== uid) return;
        const token = await auth.currentUser.getIdToken();
        if (stopped) return;
        const connection = new AbortController();
        const abortConnection = () => connection.abort();
        controller.signal.addEventListener('abort', abortConnection, {once: true});
        let idleTimer = setTimeout(abortConnection, STREAM_IDLE_MS);
        try {
          const response = await fetch('/api/jobs/' + activeId + '/events', {
            headers: {Authorization: 'Bearer ' + token, Accept: 'text/event-stream'},
            signal: connection.signal,
          });
          if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) throw Error('เปิดสตรีมสถานะไม่ได้');
          await readJobEvents(response.body, body => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(abortConnection, STREAM_IDLE_MS);
            return receive(body, 'stream');
          });
        } finally {
          clearTimeout(idleTimer);
          controller.signal.removeEventListener('abort', abortConnection);
          connection.abort();
        }
        if (terminal || stopped) return;
        throw Error('สตรีมสถานะขาดการเชื่อมต่อ');
      } catch {
        if (stopped || controller.signal.aborted) return;
        // Snapshot polling also supports old servers or proxies without SSE.
        // Only a 404 from the job itself means it has been lost.
        try {
          const body = await apiRequest('GET', '/api/jobs/' + activeId, undefined, controller.signal);
          if (stopped) return;
          receive(body, 'poll');
          if (terminal) return;
        } catch (error) {
          if (stopped) return;
          if ((error as {status?: number}).status === 404) {
            const message = 'ตรวจสอบงานนี้ไม่ได้ เพราะเซิร์ฟเวอร์ไม่พบงานเดิม (อาจรีสตาร์ตระหว่างประมวลผล) กรุณาสร้างโมเดลใหม่';
            update({status: 'error', stage: 'error', detail: message, error: message, reconnecting: false});
            return;
          }
          update({reconnecting: true});
          failures++;
        }
      }
      if (!stopped) timer = setTimeout(connect, Math.min(15000, POLL_MS * 2 ** Math.min(failures, 3)));
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeId, uid]);

  const mcpActiveId = job?.status === 'running' && job.mode === 'mcp' ? job.id : null;
  useEffect(() => {
    if (!mcpActiveId || !uid) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      try {
        const body = await apiRequest('GET', '/api/mcp/requests/' + mcpActiveId);
        if (stopped) return;
        const terminal = body.status === 'done' || body.status === 'error' || body.status === 'cancelled';
        setJob(current => {
          if (!current || current.id !== mcpActiveId) return current;
          const next: AiJob = {
            ...current,
            status: body.status === 'error' || body.status === 'cancelled' ? 'error' : terminal ? 'done' : 'running',
            stage: body.stage || current.stage,
            detail: body.detail || current.detail,
            updatedAt: body.updatedAt || Date.now(),
            heartbeatAt: body.updatedAt || current.heartbeatAt,
            error: body.error || (body.status === 'cancelled' ? 'ยกเลิกแล้ว' : undefined),
            result: terminal && body.status === 'done' ? ({mode: 'mcp', ...(body.result || {})} as McpResult) : undefined,
            ...eventMetadata(body),
            transport: 'poll',
            reconnecting: false,
          };
          saveStored(uid, next);
          return next;
        });
        failures = 0;
        if (!terminal && !stopped) timer = setTimeout(poll, MCP_POLL_MS);
      } catch {
        if (stopped) return;
        failures++;
        setJob(current => current && current.id === mcpActiveId ? {...current, reconnecting: true, detail: failures > 3 ? 'กำลังเชื่อมต่อผลลัพธ์ MCP ใหม่…' : current.detail} : current);
        timer = setTimeout(poll, Math.min(15000, MCP_POLL_MS * 2 ** Math.min(failures, 3)));
      }
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [mcpActiveId, uid]);

  const start = useCallback(async (request: McpEditRequest | McpGenerateRequest, userPrompt: string) => {
    if (!uid) throw Error('กรุณาเข้าสู่ระบบ');
    const body = await apiRequest('POST', '/api/mcp/trigger', {...request, prompt: userPrompt});
    const startedAt = Date.now();
    const next: AiJob = {id: body.requestId, mode: 'mcp', operation: request.operation, projectId: request.projectId, startedAt, provider: request.provider, model: request.model, effort: request.effort, prompt: userPrompt, status: 'running', stage: 'queued', detail: 'ส่งงานให้ MCP แล้ว…', updatedAt: startedAt, heartbeatAt: startedAt, thinking: [], events: []};
    localStorage.removeItem(dismissedKey(uid));
    saveStored(uid, next);
    setJob(next);
  }, [uid]);

  const cancel = useCallback(async () => {
    if (!job) return;
    if (job.mode === 'mcp') {
      await apiRequest('DELETE', '/api/mcp/requests/' + job.id);
      setJob(current => {
        if (!current || current.id !== job.id || current.status !== 'running') return current;
        const next = {...current, status: 'error' as const, stage: 'cancelled', detail: 'ยกเลิกแล้ว', error: 'ยกเลิกแล้ว', reconnecting: false};
        if (uid) saveStored(uid, next);
        return next;
      });
      return;
    }
    let confirmed: AiJob | null = null;
    try {
      await apiRequest('DELETE', '/api/jobs/' + job.id);
      // A completion can race with the user's click. Preserve a confirmed result
      // rather than replacing it with a local cancellation message.
      try { confirmed = fromServer(await apiRequest('GET', '/api/jobs/' + job.id)); } catch { /* keep local cancellation if disconnected */ }
    } catch (error) {
      if ((error as {status?: number}).status !== 404) throw error;
    }
    // Keep the cancellation state so a reload explains what happened.
    setJob(current => {
      if (!current || current.id !== job.id || current.status !== 'running') return current;
      const next = confirmed?.status !== 'running' && confirmed
        ? {...current, ...confirmed, prompt: current.prompt, reconnecting: false}
        : {...current, status: 'error' as const, stage: 'error', detail: 'ยกเลิกแล้ว', error: 'ยกเลิกแล้ว', reconnecting: false};
      if (uid) saveStored(uid, next);
      return next;
    });
  }, [job, uid]);

  const dismiss = useCallback(() => {
    if (uid) {
      if (job) localStorage.setItem(dismissedKey(uid), job.id);
      localStorage.removeItem(storageKey(uid));
    }
    setJob(null);
  }, [job, uid]);

  return {job, start, cancel, dismiss};
}
