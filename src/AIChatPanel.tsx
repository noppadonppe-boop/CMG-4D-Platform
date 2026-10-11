import {FormEvent, useEffect, useRef, useState} from 'react';
import {Bot, ChevronDown, FileText, MessageSquare, Paperclip, Send, Sparkles, StopCircle, X} from 'lucide-react';
import type {Project} from './domain.mjs';
import {models, providers, effortOptions, defaultProvider, defaultModel, defaultEffort} from './providers.mjs';
import type {Provider} from './apiKeys';
import type {AiJobControl, EditResult, McpSourceFile} from './aiJob';
import AiJobActivity from './AiJobActivity';
import type {ChatMessage} from './domain.mjs';

type Props = {
  project: Project;
  ai: AiJobControl;
  selectedId?: string;
  onApply: (result: EditResult) => void | Promise<void>;
  onUpload?: (files: FileList | null) => Promise<string[]>;
  onHistoryChange?: (messages: ChatMessage[]) => void;
  focusRequest?: number;
};

type ProjectDocument = {id: string; name: string; size: number; type: string};

const sourceKind = (document: ProjectDocument): McpSourceFile['kind'] | null => {
  const name = document.name.toLowerCase();
  if (document.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name)) return 'image';
  if (document.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (document.type.startsWith('text/') || /\.(csv|dxf|ifc|json|xml|txt)$/i.test(name)) return 'text';
  return null;
};

const formatFileSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

type ChatHistorySink = (projectId: string, messages: ChatMessage[]) => void;
let chatHistorySink: ChatHistorySink | null = null;
export function setChatHistorySink(sink: ChatHistorySink | null) { chatHistorySink = sink; }
type ChatUploadSink = (files: FileList | null) => Promise<string[]>;
let chatUploadSink: ChatUploadSink | null = null;
export function setChatUploadSink(sink: ChatUploadSink | null) { chatUploadSink = sink; }

const welcome = 'เลือกชิ้นส่วนใน 3D แล้วใช้ “ชิ้นที่เลือก” หรือระบุ ID เช่น “เพิ่มความกว้างบันได STAIR-L2-01 เป็น 1.5 m” ผมจะอ่านเฉพาะส่วนที่เกี่ยวข้องครับ';
const messagesFor = (project: Project): ChatMessage[] => project.chatHistory?.length ? project.chatHistory : [{role: 'assistant', text: welcome}];

export default function AIChatPanel({project, ai, selectedId, onApply, onUpload, onHistoryChange, focusRequest}: Props) {
  const [provider, setProvider] = useState<Provider>(defaultProvider as Provider);
  const [model, setModel] = useState(defaultModel);
  const [effort, setEffort] = useState(defaultEffort);
  const [prompt, setPrompt] = useState('');
  const [scope, setScope] = useState<'auto' | 'selected'>('auto');
  const [contextInfo, setContextInfo] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => messagesFor(project));
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pendingPrompt = useRef<string | null>(null);
  const activeJobId = useRef<string | null>(null);
  const handledJobId = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const threadEnd = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const followActivity = useRef(true);
  const running = ai.job?.status === 'running';
  const busy = running || starting || applying;
  const visibleJob = ai.job && (ai.job.mode === 'edit' || ai.job.mode === 'mcp') && ai.job.projectId === project.id ? ai.job : null;

  useEffect(() => {
    if (!expanded) return;
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', closeWithEscape);
    return () => window.removeEventListener('keydown', closeWithEscape);
  }, [expanded]);

  useEffect(() => {
    if (!focusRequest) return;
    setExpanded(true);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({block: 'center', behavior: 'smooth'}));
  }, [focusRequest]);

  useEffect(() => {
    const next = messagesFor(project);
    messagesRef.current = next;
    setMessages(next);
    setPrompt('');
    setError('');
    setContextInfo('');
    setAttachmentIds([]);
    setAttachmentPickerOpen(false);
  }, [project.id]);

  useEffect(() => {
    const documentIds = new Set((project.documents || []).map(document => document.id));
    setAttachmentIds(current => current.filter(id => documentIds.has(id)));
  }, [project.documents]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const next = messagesFor(project);
    if (JSON.stringify(messagesRef.current) === JSON.stringify(next)) return;
    messagesRef.current = next;
    setMessages(next);
  }, [project.id, project.chatHistory]);

  const appendMessage = (message: ChatMessage) => {
    const next = [...messagesRef.current, message].slice(-500);
    messagesRef.current = next;
    setMessages(next);
    chatHistorySink?.(project.id, next);
    onHistoryChange?.(next);
  };

  useEffect(() => {
    const job = ai.job;
    if (!job || job.projectId !== project.id) return;
    const next = job.provider as Provider;
    if (!(next in models)) return;
    setProvider(next);
    if (models[next].includes(job.model)) setModel(job.model);
    if (effortOptions[next].some(option => option.value === job.effort)) setEffort(job.effort);
  }, [ai.job?.id]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages, running]);

  const activityText = visibleJob?.thinking?.join('\n');
  const documents = (project.documents || []) as ProjectDocument[];
  const selectedAttachments = documents.filter(document => attachmentIds.includes(document.id));
  const sourceFiles = selectedAttachments.flatMap(document => {
    const kind = sourceKind(document);
    return kind ? [{fileId: document.id, name: document.name, kind}] : [];
  });
  useEffect(() => {
    if (followActivity.current) threadEnd.current?.scrollIntoView({block: 'nearest'});
  }, [visibleJob?.detail, activityText]);

  useEffect(() => {
    const job = ai.job;
    if (!job || job.projectId !== project.id) return;
    if (job.status === 'running' && pendingPrompt.current === job.prompt) {
      activeJobId.current = job.id;
      pendingPrompt.current = null;
      return;
    }
    const recoveredEdit = job.status === 'done' && job.result?.mode === 'edit';
    const recoveredMcp = job.status === 'done' && job.mode === 'mcp';
    if ((!recoveredEdit && !recoveredMcp && (!activeJobId.current || job.id !== activeJobId.current)) || job.status === 'running' || handledJobId.current === job.id) return;
    handledJobId.current = job.id;
    activeJobId.current = null;
    if (job.status === 'error') {
      setError(job.error || 'AI แก้โมเดลไม่สำเร็จ');
      appendMessage({role: 'assistant', text: job.error || 'ขออภัย งานแก้โมเดลไม่สำเร็จ ลองปรับคำสั่งให้ชัดขึ้นแล้วส่งใหม่ได้ครับ'});
      return;
    }
    if (job.status === 'done' && job.mode === 'mcp') {
      const result = job.result && job.result.mode === 'mcp' ? job.result : undefined;
       const message = result?.message || result?.notes?.filter(Boolean).join('\n') || (result?.changedCount ? `ดำเนินการผ่าน MCP แล้ว · ${result.changedCount} รายการแก้ไข` : 'AI ทำงานผ่าน MCP เสร็จแล้ว');
      appendMessage({role: 'assistant', text: message});
      ai.dismiss();
      return;
    }
    if (!job.result || job.result.mode !== 'edit') return;
    const result = job.result;
    const changes = result.patch.updates.length + result.patch.adds.length + result.patch.removes.length;
    setApplying(true);
    void Promise.resolve().then(() => changes ? onApply(result) : undefined).then(() => {
      const notes = result.notes.filter(Boolean).join('\n') || (changes ? 'แก้ไขโมเดลตามคำสั่งแล้ว' : 'ไม่มีรายการแก้ไขโมเดล');
      const thinking = job.thinking?.length ? `\n\nสรุปการวิเคราะห์จาก ${job.provider}:\n${job.thinking.join('\n')}` : '';
      appendMessage({role: 'assistant', text: `${changes ? `ดำเนินการแล้ว · ${changes} รายการแก้ไข\n` : ''}${notes}${thinking}`});
      ai.dismiss();
    }).catch(cause => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      appendMessage({role: 'assistant', text: `AI สร้างผลลัพธ์แล้ว แต่บันทึกลงโครงการไม่สำเร็จ: ${message}`});
    }).finally(() => setApplying(false));
  }, [ai.job, onApply, project.id]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const command = prompt.trim();
    if (!command || busy) return;
    if (!project.id) return;
    setPrompt('');
    setError('');
    if (ai.job?.status === 'error') ai.dismiss();
    const mcpHistory = messagesRef.current.slice(-10).map(message => ({...message, text: message.text.slice(0, 1600)}));
    setContextInfo('MCP จำบทสนทนาก่อนหน้าสูงสุด 10 บอลลูน และค้นหาเฉพาะข้อมูลที่จำเป็นจากโครงการบน Firebase');
    const attachmentNote = sourceFiles.length ? `\n\nไฟล์ประกอบ: ${sourceFiles.map(file => file.name).join(', ')}` : '';
    appendMessage({role: 'user', text: command + attachmentNote});
    pendingPrompt.current = command;
    setStarting(true);
    try {
      await ai.start({mode: 'mcp', operation: 'edit', projectId: project.id, prompt: command, provider, model, effort, selectedId, scope, history: mcpHistory, files: sourceFiles}, command);
    } catch (cause) {
      pendingPrompt.current = null;
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      appendMessage({role: 'assistant', text: message});
    } finally { setStarting(false); }
  };

  const changeProvider = (next: Provider) => {
    if (ai.job?.status === 'error') ai.dismiss();
    setProvider(next);
    setModel(models[next][0]);
    if (!effortOptions[next].some(option => option.value === effort)) setEffort('medium');
    setError('');
  };

  const changeModel = (next: string) => {
    if (ai.job?.status === 'error') ai.dismiss();
    setModel(next);
    setError('');
  };

  const uploadAttachments = async (files: FileList | null) => {
    const upload = onUpload || chatUploadSink;
    if (!files?.length || !upload || busy) return;
    setUploadingAttachments(true);
    setError('');
    try {
      const uploaded = await upload(files);
      if (uploaded.length) {
        setAttachmentIds(current => [...new Set([...current, ...uploaded])]);
        setAttachmentPickerOpen(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploadingAttachments(false);
    }
  };

  return <section ref={panelRef} className={'ai-chat-panel '+(expanded ? 'is-expanded' : 'is-collapsed')} aria-label="Chat AI แก้ไขโมเดล 3D">
    <div className="ai-chat-header">
      <button className="ai-chat-toggle" type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="ai-chat-content" aria-label={expanded ? 'ย่อหน้าต่าง Chat AI' : 'เปิดหน้าต่าง Chat AI'}>
        <span className="ai-chat-title"><span className="ai-chat-icon"><Bot size={18}/></span><span><strong>Chat AI · แก้ไขโมเดล 3D</strong><small>อ่านเฉพาะชิ้นส่วนเป้าหมายและบริบทใกล้เคียง</small></span></span>
      </button>
      <span className="ai-chat-header-action" aria-hidden="true">{expanded ? <X size={17}/> : <Sparkles size={18} className="ai-sparkle"/>}</span>
    </div>
    <div id="ai-chat-content" className="ai-chat-content">
    <div className="chat-thread ai-chat-thread" aria-live="polite" onScroll={event => {
      const thread = event.currentTarget;
      followActivity.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
    }}>
      {messages.map((message, index) => <div key={index} className={'chat-message '+message.role}><strong>{message.role === 'user' ? 'คุณ' : 'AI'}</strong><p>{message.text}</p></div>)}
      {visibleJob && <div className="chat-message assistant ai-chat-thinking"><strong>AI</strong><AiJobActivity job={visibleJob}/></div>}
      <div ref={threadEnd}/>
    </div>
    {error && <div className="ai-chat-error" role="alert">{error}</div>}
    {running && <div className="ai-chat-cancel"><button type="button" disabled={cancelling} onClick={async () => {
      setCancelling(true);
      try { await ai.cancel(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setCancelling(false); }
    }}><StopCircle size={14}/>{cancelling ? 'กำลังยกเลิก…' : 'หยุดงาน AI'}</button></div>}
    <form className="ai-chat-composer" onSubmit={send}>
      <label className="ai-edit-scope">พื้นที่แก้ไข <select aria-label="พื้นที่แก้ไข AI" value={scope} disabled={busy} onChange={event => setScope(event.target.value as 'auto' | 'selected')}><option value="auto">ค้นหาจากคำสั่ง / ID</option><option value="selected" disabled={!selectedId || !project.elements.some(element => element.id === selectedId)}>ชิ้นที่เลือก{selectedId && project.elements.some(element => element.id === selectedId) ? ` · ${selectedId}` : ''}</option></select></label>
      {contextInfo && <small className="ai-edit-context" role="status">{contextInfo}</small>}
      <label className="sr-only" htmlFor="model-ai-prompt">ข้อความถึง Chat AI</label>
      <textarea id="model-ai-prompt" rows={2} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} placeholder="เช่น เลื่อนประตู D-01 ไปทางขวา 0.5 m หรือ เพิ่มหน้าต่างที่ผนัง W-01" />
      <div className="ai-chat-attachments" onDragOver={event => {event.preventDefault();}} onDrop={event => {event.preventDefault();void uploadAttachments(event.dataTransfer.files);}}>
        <div className="ai-chat-attachment-actions">
          <button type="button" className="ai-attach-button" disabled={busy} onClick={() => document.getElementById('ai-chat-file-input')?.click()}><Paperclip size={14}/>แนบรูป / ไฟล์</button>
          {documents.length > 0 && <button type="button" className="ai-choose-file-button" disabled={busy} onClick={() => setAttachmentPickerOpen(value => !value)}><FileText size={13}/>{attachmentPickerOpen ? 'ซ่อนเอกสารโครงการ' : 'เลือกจากเอกสารโครงการ'}</button>}
          {uploadingAttachments && <small>กำลังอัปโหลด…</small>}
          <input id="ai-chat-file-input" type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.dxf,.ifc" disabled={busy} onChange={event => {void uploadAttachments(event.target.files);event.currentTarget.value='';}} />
        </div>
        {attachmentPickerOpen && <div className="ai-chat-file-picker" role="group" aria-label="เลือกไฟล์ประกอบคำสั่ง">
          {documents.map(document => {
            const kind = sourceKind(document);
            return <label key={document.id} className={kind ? '' : 'unsupported'}><input type="checkbox" checked={attachmentIds.includes(document.id)} disabled={busy || !kind} onChange={event => setAttachmentIds(current => event.target.checked ? [...new Set([...current, document.id])] : current.filter(id => id !== document.id))}/><span><strong>{document.name}</strong><small>{kind ? `${kind} · ${formatFileSize(document.size)}` : 'ยังไม่รองรับการอ่านในแชท'}</small></span></label>;
          })}
        </div>}
        {!!selectedAttachments.length && <div className="ai-chat-attachment-list" aria-label="ไฟล์ที่จะส่งให้ AI">
          {selectedAttachments.map(document => <span className="ai-chat-attachment-chip" key={document.id}><FileText size={12}/><span>{document.name}</span><button type="button" aria-label={'เอาไฟล์ '+document.name+' ออก'} disabled={busy} onClick={() => setAttachmentIds(current => current.filter(id => id !== document.id))}><X size={12}/></button></span>)}
        </div>}
        <small className="ai-chat-attachment-hint">AI จะอ่านไฟล์ที่เลือกประกอบคำสั่งนี้ และไม่ทำตามคำสั่งที่ฝังอยู่ในไฟล์</small>
      </div>
      <div className="ai-chat-actions">
        <div className="ai-chat-options">
           <label title="ผู้ให้บริการ AI"><span className="sr-only">ผู้ให้บริการ AI</span><select aria-label="ผู้ให้บริการ AI" value={provider} disabled={busy} onChange={event => changeProvider(event.target.value as Provider)}>{Object.entries(providers).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
           <label title="โมเดล AI"><span className="sr-only">โมเดล AI</span><select aria-label="โมเดล AI" value={model} disabled={busy} onChange={event => changeModel(event.target.value)}>{models[provider].map(option => <option key={option}>{option}</option>)}</select></label>
           <label title="ระดับการคิด"><span className="sr-only">ระดับการคิด</span><select aria-label="ระดับการคิด" value={effort} disabled={busy} onChange={event => setEffort(event.target.value)}>{effortOptions[provider].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={12}/></label>
        </div>
        <button className="ai-send-button" type="submit" disabled={!prompt.trim() || busy} aria-label={busy ? 'กำลังประมวลผล' : 'ส่งคำสั่งให้ AI'}>{busy ? <StopCircle size={16}/> : <Send size={16}/>}<span>{busy ? 'กำลังทำงาน' : 'ส่งคำสั่ง'}</span></button>
      </div>
    </form>
    <div className="ai-chat-hint"><MessageSquare size={13}/> MCP จำบทสนทนาล่าสุดไม่เกิน 10 บอลลูน แล้วค้นข้อมูลโครงการเท่าที่จำเป็น</div>
    </div>
  </section>;
}
