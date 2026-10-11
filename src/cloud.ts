import {initializeApp} from 'firebase/app';
import {getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signOut} from 'firebase/auth';
import {getFirestore, connectFirestoreEmulator, collection, doc, getDocs, query, orderBy, setDoc, serverTimestamp} from 'firebase/firestore';
import {getStorage, connectStorageEmulator, ref, uploadBytes, getBlob} from 'firebase/storage';
import {validateProject, type Project} from './domain.mjs';

const env = import.meta.env;
const config = {apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, appId: env.VITE_FIREBASE_APP_ID};
export const cloudConfigured = Object.values(config).every(v => typeof v === 'string' && v.trim());
const app = cloudConfigured ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
if(import.meta.env.VITE_FIREBASE_EMULATORS==='1'&&auth&&db){connectAuthEmulator(auth,'http://127.0.0.1:9299',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8280)}
export const storage = app ? getStorage(app) : null;
if(import.meta.env.VITE_FIREBASE_EMULATORS==='1'&&storage)connectStorageEmulator(storage,'127.0.0.1',9199);
export type Snapshot = {id: string; name: string; projectId: string; elementCount: number; documentCount: number; createdAt: string};
export const login = async () => (await import('./authService')).loginWithGoogle();
export const logout = async () => (await import('./authService')).logout();
function owner() {if (!auth?.currentUser || !db || !storage) throw Error('กรุณาเข้าสู่ระบบ'); return auth.currentUser.uid;}
export async function listSnapshots(): Promise<Snapshot[]> {
  const uid = owner();
  const result = await getDocs(query(collection(db!, 'users', uid, 'snapshots'), orderBy('createdAt', 'desc')));
  return result.docs.map(d => ({...d.data(), id: d.id, createdAt: d.data().createdAt?.toDate().toISOString() || ''} as Snapshot));
}
// Each save has a new ID. Versions cannot overwrite each other across devices.
export async function saveSnapshot(project: Project, getFile: (key: string) => Promise<Blob | undefined>, progress: (message: string) => void) {
  const uid = owner();
  if (!validateProject(project) || project.documents.length > 200) throw Error('ข้อมูลโครงการไม่ถูกต้อง หรือมีไฟล์เกิน 200 ไฟล์');
  const snapshotId = crypto.randomUUID();
  const base = `users/${uid}/snapshots/${snapshotId}`;
  const payload = JSON.stringify({...project, schemaVersion: 1});
  if (new TextEncoder().encode(payload).length > 20 * 1024 * 1024) throw Error('ข้อมูลโมเดลเกิน 20 MB');
  for (let i = 0; i < project.documents.length; i++) {
    const d = project.documents[i];
    if (!/^[\w-]+$/.test(d.id)) throw Error('รหัสไฟล์ไม่ถูกต้อง');
    const blob = await getFile(`${project.id}/${d.id}`);
    if (!blob) throw Error(`ไม่พบไฟล์ ${d.name} ในเครื่องนี้ กรุณาแนบไฟล์ให้ครบก่อนบันทึก`);
    progress(`อัปโหลดไฟล์ ${i + 1}/${project.documents.length}: ${d.name}`);
    await uploadBytes(ref(storage!, `${base}/files/${d.id}`), blob, {contentType: d.type || 'application/octet-stream'});
  }
  progress('กำลังบันทึกโมเดลและแผนงาน');
  await uploadBytes(ref(storage!, `${base}/project.json`), new Blob([payload], {type: 'application/json'}));
  await setDoc(doc(db!, 'users', uid, 'snapshots', snapshotId), {name: project.name, projectId: project.id,
    createdAt: serverTimestamp(), elementCount: project.elements.length, documentCount: project.documents.length, schemaVersion: 1});
}
export async function loadSnapshot(id: string, progress: (message: string) => void) {
  const uid = owner();
  if (!/^[\w-]+$/.test(id)) throw Error('รหัสรุ่นไม่ถูกต้อง');
  const base = `users/${uid}/snapshots/${id}`;
  const payload = await getBlob(ref(storage!, `${base}/project.json`), 20 * 1024 * 1024);
  const p = JSON.parse(await payload.text());
  if (!validateProject(p) || !Array.isArray(p.documents) || p.documents.length > 200) throw Error('ข้อมูลรุ่นนี้ไม่ถูกต้อง');
  const files: {id: string; blob: Blob}[] = [];
  for (let i = 0; i < p.documents.length; i++) {
    const d = p.documents[i];
    if (!d || typeof d.id !== 'string' || !/^[\w-]+$/.test(d.id) || typeof d.name !== 'string' || typeof d.type !== 'string' || !Number.isFinite(d.size)) throw Error('ข้อมูลไฟล์แนบไม่ถูกต้อง');
    progress(`ดาวน์โหลดไฟล์ ${i + 1}/${p.documents.length}: ${d.name}`);
    files.push({id: d.id, blob: await getBlob(ref(storage!, `${base}/files/${d.id}`), 50 * 1024 * 1024)});
  }
  return {project: {...p, id: crypto.randomUUID(), name: p.name + ' (จาก Cloud)', audit: Array.isArray(p.audit) ? p.audit : []} as Project, files};
}
