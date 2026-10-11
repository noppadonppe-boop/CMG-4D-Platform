import {Check, Circle, AlertTriangle} from 'lucide-react';
import type {AiJob} from './aiJob';
import {useElapsed} from './AiJobChip';

export default function AiJobActivity({job}: {job: AiJob}) {
  const running = job.status === 'running';
  const elapsed = useElapsed(job.startedAt, running);
  const heartbeatAge = useElapsed(job.heartbeatAt || job.startedAt, running);
  const progressAge = useElapsed(job.updatedAt || job.startedAt, running);
  const events = (job.events || []).filter(event => !(
    /^(กำลังอ่านรายการเครื่องมือ MCP|อ่านรายการเครื่องมือ MCP แล้ว|AI เริ่มประมวลผลคำขอผ่าน MCP|ส่งคำขอไปยัง OpenAI Responses แล้ว|AI สรุปผลลัพธ์จาก MCP แล้ว|AI ทำงานผ่าน MCP เสร็จแล้ว กำลังตรวจผลลัพธ์)$/.test(event.detail)
    || /^(?:กำลังรัน MCP: |MCP ทำงานเสร็จ: |MCP ทำงานไม่สำเร็จ: )?เครื่องมือ MCP(?: ·.*)?$/.test(event.detail)
  ));
  const genericMcpDetail = job.mode === 'mcp' && /^(?:กำลังรัน MCP: เครื่องมือ MCP|MCP ทำงานเสร็จ: เครื่องมือ MCP|OpenAI กำลังทำงานผ่าน MCP|กำลังอ่านรายการเครื่องมือ MCP จาก (?:Anthropic|Google AI Studio))$/.test(job.detail || '');
  const heading = genericMcpDetail ? 'กำลังดำเนินงานตามคำขอ' : job.detail || (running ? 'AI กำลังประมวลผล…' : job.status === 'done' ? 'สร้างโมเดลเสร็จแล้ว' : 'ประมวลผลไม่สำเร็จ');
  const time = (at: number) => {
    const seconds = Math.max(0, Math.floor((at - job.startedAt) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  return <div className={'ai-activity ' + job.status} aria-label="การทำงานของ AI">
    <div className="ai-activity-heading" role="status">
      {running ? <span className="ai-job-spinner" aria-hidden="true"/> : job.status === 'done' ? <Check size={16}/> : <AlertTriangle size={16}/>}
      <strong>{job.status === 'error' && job.error ? job.error : heading}</strong>
      {running && <span className="ai-activity-elapsed">{elapsed}</span>}
    </div>
    {running && <p className="ai-activity-connection">{job.reconnecting ? 'การเชื่อมต่อขาดหาย กำลังเชื่อมต่อใหม่…' : job.transport ? `${job.transport === 'stream' ? 'รับสถานะสด' : 'ตรวจสถานะเป็นระยะ'} · เซิร์ฟเวอร์ตอบสนอง ${heartbeatAge} ที่แล้ว` : 'กำลังเชื่อมต่อสถานะ…'}<br/>ข้อมูลความคืบหน้าล่าสุด {progressAge} ที่แล้ว</p>}
    {!!events.length && <details className="ai-activity-history" open>
      <summary>สิ่งที่ AI ทำ</summary>
      <ol>{events.map((event, index) => {
        const latest = index === events.length - 1;
        const confirmed = ['file_loaded','files_sent','analysis_reported'].includes(event.stage);
        const failed = event.stage === 'error' || (latest && job.status === 'error' && !confirmed);
        const active = latest && running && !confirmed;
        return <li key={event.id} className={failed ? 'failed' : active ? 'active' : 'finished'}>
          {failed ? <AlertTriangle size={12}/> : active ? <Circle size={12}/> : <Check size={12}/>}
          <span>{event.detail}</span><time>{time(event.at)}</time>
        </li>;
      })}</ol>
    </details>}
    {!!job.thinking?.length && <details className="ai-thinking" onToggle={event => {
      if (event.currentTarget.open) event.currentTarget.scrollIntoView({block: 'nearest'});
    }}>
      <summary>ดูสรุปการวิเคราะห์จาก {job.provider}</summary>
      <small>สรุปที่ผู้ให้บริการส่งกลับมา</small>
      {job.thinking.map((text, index) => <p key={index}>{text}</p>)}
    </details>}
  </div>;
}
