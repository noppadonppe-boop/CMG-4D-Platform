import {useEffect, useState} from 'react';
import {onAuthStateChanged, type User} from 'firebase/auth';
import {auth, cloudConfigured, login, logout, listSnapshots, saveSnapshot, loadSnapshot, type Snapshot} from './cloud';
import type {Project} from './domain.mjs';

export default function CloudPanel({project, getFile, onRestore}: {
  project: Project; getFile: (key: string) => Promise<Blob | undefined>;
  onRestore: (p: Project, files: {id: string; blob: Blob}[]) => Promise<void>;
}) {
  const [user, setUser] = useState<User | null>(auth?.currentUser || null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {setBusy(true); setError(''); setMessage('กำลังดำเนินการ…');
    try {await fn(); setMessage('ดำเนินการสำเร็จ');} catch (e) {setMessage(''); setError(e instanceof Error ? e.message : String(e));} finally {setBusy(false);}};
  useEffect(() => auth ? onAuthStateChanged(auth, setUser) : undefined, []);
  useEffect(() => {let active = true; setSnapshots([]); if (user) listSnapshots().then(s => {if(active)setSnapshots(s);}).catch(e => {if(active)setError(e.message);}); return () => {active = false;};}, [user]);
  if (!cloudConfigured) return <div className="help-content"><p><strong>พร้อมตั้งค่า Firebase</strong></p><p>เติมค่า Firebase Web App ในไฟล์ .env ตาม .env.example แล้วเริ่มเว็บใหม่ ดูขั้นตอนใน docs/FIREBASE_SETUP.md</p><p>โหมด Local ใช้งานได้ทันที ข้อมูลและไฟล์แนบจะยังอยู่ในเบราว์เซอร์นี้จนกว่าจะบันทึกขึ้น Cloud</p></div>;
  return <div className="cloud-panel"><p>เก็บรุ่นโมเดล แผนงาน และไฟล์แนบไว้ในบัญชีของคุณ เปิดกลับบนอุปกรณ์อื่นได้ แต่ละรุ่นแก้ทับไม่ได้</p>
    {user ? <><p>{user.email || user.displayName}</p><button className="secondary" disabled={busy} onClick={() => run(logout)}>ออกจากระบบ</button>
      <button className="primary" disabled={busy} onClick={() => run(async () => {await saveSnapshot(project, getFile, setMessage); setSnapshots(await listSnapshots());})}>บันทึกรุ่นปัจจุบันขึ้น Cloud</button>
      <button className="text-link" disabled={busy} onClick={() => run(async () => setSnapshots(await listSnapshots()))}>โหลดรายการใหม่</button>
      <div className="document-list">{snapshots.map(s => <div className="document" key={s.id}><span><strong>{s.name}</strong><small>{s.createdAt && new Date(s.createdAt).toLocaleString('th-TH')} · {s.elementCount} ชิ้น · {s.documentCount} ไฟล์</small></span><button className="secondary" disabled={busy} onClick={() => run(async () => {const loaded = await loadSnapshot(s.id, setMessage); await onRestore(loaded.project, loaded.files);})}>เปิดเป็นสำเนา</button></div>)}{!snapshots.length && <p>ยังไม่มีรุ่นบน Cloud</p>}</div>
    </> : <button className="primary" disabled={busy} onClick={() => run(login)}>เข้าสู่ระบบด้วย Google</button>}
    <p role="status">{message}</p>{error && <p className="cloud-error" role="alert">{error}</p>}
  </div>;
}
