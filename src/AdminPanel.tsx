import {useAuth} from './AuthContext';
import {useEffect,useState} from 'react';
import {cloudConfigured,logout} from './cloud';
import {providers} from './providers.mjs';
import {watchKeys,saveApiKey,deleteApiKey,type Provider,type KeyStatus} from './apiKeys';

function errorMessage(error:unknown){
 const code=(error as {code?:string})?.code;
 if(code==='permission-denied')return 'Firebase ปฏิเสธสิทธิ์เข้าถึง API Key กรุณาตรวจว่าบัญชีได้รับอนุมัติและเป็น MasterAdmin รวมถึง Rules ของโปรเจกต์นี้ แล้วกดลองใหม่';
 if(code==='unavailable')return 'เชื่อมต่อ Firebase ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่';
 return error instanceof Error?error.message:String(error);
}
export default function AdminPanel(){
 const {firebaseUser:user,userProfile}=useAuth();
 const [keys,setKeys]=useState<KeyStatus[]>([]),[drafts,setDrafts]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[loadError,setLoadError]=useState('');
 const [loadState,setLoadState]=useState<'loading'|'ready'|'error'>('loading'),[revision,setRevision]=useState(0);
 const allowed=userProfile?.status==='approved'&&userProfile.role.includes('MasterAdmin');
 useEffect(()=>{setKeys([]);setDrafts({});setError('');setMessage('')},[user?.uid]);
 useEffect(()=>{
  if(!user||!allowed)return;
  let active=true;setLoadState('loading');setLoadError('');
  const stop=watchKeys(user.uid,k=>{if(active){setKeys(k);setLoadState('ready');setLoadError('')}},e=>{if(active){setLoadState('error');setLoadError(errorMessage(e))}});
  return()=>{active=false;stop()};
 },[user?.uid,allowed,revision]);
 const run=async(id:string,action:()=>Promise<unknown>,success:string)=>{
  const uid=user?.uid;setBusy(id);setError('');setMessage('');
  try{await action();if(uid===user?.uid){setMessage(success);setRevision(r=>r+1)}}catch(e){setError(errorMessage(e))}finally{setBusy('')}
 };
 if(!allowed)return <p role="alert">เฉพาะ MasterAdmin ที่ได้รับอนุมัติ จัดการ API Key สำหรับ MCP ได้</p>;
 return <div className="admin-panel">
   <p>ลงชื่อเข้าใช้ Firebase ด้วยบัญชี MasterAdmin แล้วบันทึก API Key จากบัญชีผู้ให้บริการที่ต้องการใช้กับ MCP แยกตามค่าย Key จะถูกเก็บใน Firebase และเซิร์ฟเวอร์อ่านไปใช้เมื่อส่งงาน MCP คุณเปลี่ยนหรือลบ Key ได้จากการ์ดของแต่ละค่าย</p>
  {!cloudConfigured?<p role="alert">ยังไม่ได้ตั้งค่า Firebase ให้เติม Firebase config ใน .env แล้วเปิดแอปใหม่</p>:user&&<>
   <div className="admin-account"><span>{user.email||user.displayName||user.uid}</span><button className="secondary" disabled={!!busy} onClick={()=>run('logout',logout,'ออกจากระบบแล้ว')}>ออกจากระบบ</button></div>
   {(Object.keys(providers) as Provider[]).map(provider=>{
    const saved=keys.find(k=>k.provider===provider),confirmed=loadState==='ready';
    return <section className="key-card" key={provider}>
     <div><h3>{providers[provider]}</h3><span className={confirmed&&saved?'key-ready':'key-empty'}>{!confirmed?(loadState==='loading'?'กำลังตรวจสอบ Key ใน Firebase…':'ตรวจสอบสถานะ Key ไม่สำเร็จ'):saved?'บันทึกแล้ว '+saved.hint:'ยังไม่ได้ตั้งค่า'}</span></div>
      <label className="field stack"><span>MCP API Key — {providers[provider]}</span><input type="password" autoComplete="new-password" aria-label={'API Key '+providers[provider]} placeholder={saved?'ใส่ Key ใหม่เพื่อแทนที่':'วาง API Key สำหรับ MCP ที่นี่'} value={drafts[provider]||''} disabled={!!busy} onChange={e=>setDrafts(d=>({...d,[provider]:e.target.value}))}/></label>
     {confirmed&&saved?.updatedAt&&<small>อัปเดต {new Date(saved.updatedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}</small>}
     <div className="ai-actions"><button className="primary" disabled={!!busy||!(drafts[provider]||'').trim()} onClick={()=>run(provider,async()=>{await saveApiKey(provider,drafts[provider]);setDrafts(d=>({...d,[provider]:''}))},'บันทึก '+providers[provider]+' ใน Firebase แล้ว')}>{busy===provider?'กำลังบันทึก…':confirmed&&saved?'เปลี่ยน Key':'บันทึก Key'}</button><button className="secondary" disabled={!!busy||!confirmed||!saved} aria-label={'ลบ Key '+providers[provider]} onClick={()=>run('delete-'+provider,async()=>{await deleteApiKey(provider);setDrafts(d=>({...d,[provider]:''}))},'ลบ '+providers[provider]+' จาก Firebase แล้ว')}>ลบ Key</button></div>
    </section>
   })}
  </>}
  <p role="status">{message}</p>
  {error&&<p className="ai-error" role="alert">{error}</p>}
  {loadError&&<div className="ai-error"><p role="alert">{loadError}</p><button className="secondary" disabled={!!busy} onClick={()=>run('retry',async()=>{await user?.getIdToken(true)},'')}>ลองโหลด Key ใหม่</button></div>}
 </div>
}
