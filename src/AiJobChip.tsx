import {useEffect,useState} from 'react';
import {AlertTriangle,Check} from 'lucide-react';
import type {AiJob} from './aiJob';

export function useElapsed(startedAt: number | undefined, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!startedAt) return '0:00';
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

export default function AiJobChip({job, onOpen}: {job: AiJob | null; onOpen: () => void}) {
  const elapsed = useElapsed(job?.startedAt, job?.status === 'running');
  const heartbeatAge = useElapsed(job?.heartbeatAt || job?.updatedAt || job?.startedAt, job?.status === 'running');
  if (!job) return null;
  const label = job.status === 'running'
    ? (job.reconnecting ? 'กำลังเชื่อมต่อใหม่…' : (job.detail || 'AI กำลังทำงาน') + ' · ' + elapsed)
    : job.status === 'done' ? (job.mode === 'edit' ? 'ผลแก้ไข AI พร้อมแล้ว' : 'โมเดล AI พร้อมแล้ว') : (job.mode === 'edit' ? 'AI แก้ไขไม่สำเร็จ' : 'AI สร้างไม่สำเร็จ');
  const freshness = job.status === 'running' ? 'เซิร์ฟเวอร์อัปเดตล่าสุด '+heartbeatAge+' ที่แล้ว' : '';
  return <button className={'ai-job-chip ' + job.status} onClick={onOpen} title={[label, freshness, 'กดเพื่อเปิดดู'].filter(Boolean).join(' — ')} aria-label={label}>
    {job.status === 'running' ? <span className="ai-job-spinner" aria-hidden="true"/> : job.status === 'done' ? <Check size={15}/> : <AlertTriangle size={15}/>}
    <span className="ai-job-text">{label}</span>
  </button>;
}
