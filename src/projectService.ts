import {collection,doc,getDocs,getDoc,deleteDoc,onSnapshot,query,where,runTransaction,setDoc,serverTimestamp,Timestamp} from 'firebase/firestore';
import {ref,uploadBytesResumable,getBlob,deleteObject,listAll} from 'firebase/storage';
import {db,auth,storage} from './cloud';
import {APP_NAME,userRef,type UserProfile} from './authService';
import {validateProject,type Project} from './domain.mjs';
export interface ProjectHeader {id:string;name:string;ownerUid:string;memberUids:string[];revision:string;version:number;chunkCount:number;}
export const projectRef=(id:string)=>doc(db!,APP_NAME,'root','projects',id);
export function watchProjects(profile:UserProfile,cb:(headers:ProjectHeader[])=>void,error:(e:Error)=>void){const c=collection(db!,APP_NAME,'root','projects');return onSnapshot(profile.role.includes('MasterAdmin')?c:query(c,where('memberUids','array-contains',profile.uid)),s=>cb(s.docs.filter(d=>typeof d.data().ownerUid==='string').map(d=>({...d.data(),id:d.id} as ProjectHeader))),error);}
export async function readProject(h:ProjectHeader):Promise<Project>{const chunks=await Promise.all(Array.from({length:h.chunkCount},(_,i)=>getDoc(doc(projectRef(h.id),'revisions',h.revision,'chunks',String(i)))));const p=JSON.parse(chunks.map(s=>{if(!s.exists())throw Error('ข้อมูลโครงการไม่ครบ');return s.data().json;}).join(''));if(!validateProject(p))throw Error('ข้อมูลโครงการไม่ถูกต้อง');return p;}
async function stage(p:Project){if(!validateProject(p))throw Error('ข้อมูลโครงการไม่ถูกต้อง');const json=JSON.stringify(p);if(new TextEncoder().encode(json).length>20*1024*1024)throw Error('โมเดลเกิน 20 MB');const revision=crypto.randomUUID();const chunks:string[]=[];for(let i=0;i<json.length;i+=180000)chunks.push(json.slice(i,i+180000));await Promise.all(chunks.map((json,i)=>setDoc(doc(projectRef(p.id),'revisions',revision,'chunks',String(i)),{json,createdBy:auth!.currentUser!.uid,createdAt:serverTimestamp()})));return {revision,chunkCount:chunks.length};}
export async function createSharedProject(p:Project){const uid=auth!.currentUser!.uid;await runTransaction(db!,async tx=>{const ref=projectRef(p.id);const s=await tx.get(ref);if(s.exists())throw Error('โครงการนี้มีอยู่แล้ว');tx.set(ref,{name:p.name,ownerUid:uid,memberUids:[uid],assignmentEmail:auth!.currentUser!.email!,revision:'initial',version:0,chunkCount:0,createdAt:serverTimestamp(),savedAt:serverTimestamp()});});const content=await stage(p);await runTransaction(db!,async tx=>{const h=await tx.get(projectRef(p.id));if(h.data()?.version!==0)throw Error('โครงการถูกแก้ไขแล้ว');const profile=await tx.get(userRef(auth!.currentUser!.email!));tx.update(projectRef(p.id),{...content,name:p.name,version:1,savedAt:serverTimestamp()});tx.update(userRef(auth!.currentUser!.email!),{assignedProjects:[...new Set([...(profile.data()?.assignedProjects||[]),p.id])],version:(profile.data()?.version||0)+1});});}
export async function saveSharedProject(p:Project,expectedVersion:number){const content=await stage(p);await runTransaction(db!,async tx=>{const h=await tx.get(projectRef(p.id));if(h.data()?.version!==expectedVersion)throw Error('PROJECT_CONFLICT');tx.update(projectRef(p.id),{...content,name:p.name,version:expectedVersion+1,savedAt:serverTimestamp()});});}
export async function deleteSharedProject(projectId:string,fileIds:string[]=[]){
 const root=projectRef(projectId);const header=await getDoc(root);if(!header.exists())return;
 await deleteProjectFiles(projectId,fileIds);
 const revision=header.data()?.revision;
 if(typeof revision==='string'){
  const chunks=await getDocs(collection(root,'revisions',revision,'chunks'));
  await Promise.all(chunks.docs.map(chunk=>deleteDoc(chunk.ref)));
 }
 await deleteDoc(root);
}
export async function assignProject(projectId:string,target:UserProfile,assigned:boolean){const me=auth!.currentUser!;await runTransaction(db!,async tx=>{const h=await tx.get(projectRef(projectId)),u=await tx.get(userRef(target.email));if(!h.exists()||!u.exists())throw Error('ไม่พบโครงการหรือผู้ใช้');if(h.data().memberUids.includes(target.uid)===assigned)return;if(!assigned&&h.data().ownerUid===target.uid)throw Error('ไม่สามารถถอนสิทธิ์เจ้าของโครงการ');const members=new Set<string>(h.data().memberUids);assigned?members.add(target.uid):members.delete(target.uid);const ids=new Set<string>(u.data().assignedProjects);assigned?ids.add(projectId):ids.delete(projectId);tx.update(projectRef(projectId),{assignmentEmail:target.email,memberUids:[...members],version:h.data().version+1,savedAt:serverTimestamp()});tx.update(userRef(target.email),{assignedProjects:[...ids],version:u.data().version+1});});}
export type FileUploadProgress={name:string;index:number;total:number;percent:number;phase:'upload'|'saving'};
export async function uploadProjectFile(projectId:string,id:string,blob:Blob,onProgress?:(percent:number)=>void){
 if(!storage)throw Error('ยังไม่ได้ตั้งค่า Storage');
 const task=uploadBytesResumable(ref(storage,`${APP_NAME}/root/projects/${projectId}/files/${id}`),blob,{contentType:blob.type||'application/octet-stream'});
 await new Promise<void>((resolve,reject)=>{task.on('state_changed',snapshot=>onProgress?.(snapshot.totalBytes?Math.min(99,Math.floor(snapshot.bytesTransferred/snapshot.totalBytes*100)):0),reject,()=>{onProgress?.(100);resolve()})});
}
export async function downloadProjectFile(projectId:string,id:string){if(!storage)throw Error('ยังไม่ได้ตั้งค่า Storage');return getBlob(ref(storage,`${APP_NAME}/root/projects/${projectId}/files/${id}`),50*1024*1024);}
export async function deleteProjectFile(projectId:string,id:string){if(!storage)return;await deleteObject(ref(storage,`${APP_NAME}/root/projects/${projectId}/files/${id}`));}
export async function deleteProjectFiles(projectId:string,fileIds:string[]=[]){
 if(!storage)return;
 const base=`${APP_NAME}/root/projects/${projectId}/files`;
 const listed=await listAll(ref(storage,base));
 const objects=new Map<string,ReturnType<typeof ref>>();
 for(const id of fileIds)objects.set(`${base}/${id}`,ref(storage,`${base}/${id}`));
 for(const item of listed.items)objects.set(item.fullPath,item);
 await Promise.all([...objects.values()].map(async file=>{try{await deleteObject(file);}catch(error){if((error as {code?:string})?.code!=='storage/object-not-found')throw error;}}));
}
export async function updateProfile(profile:UserProfile,patch:Partial<UserProfile>,expectedVersion=profile.version){await runTransaction(db!,async tx=>{const s=await tx.get(userRef(profile.email));if(s.data()?.version!==expectedVersion)throw Error('มีการแก้โปรไฟล์นี้แล้ว ข้อมูลที่กรอกยังอยู่ กรุณาตรวจข้อมูลล่าสุดก่อนบันทึก');tx.update(userRef(profile.email),{...patch,version:expectedVersion+1});});}
export function watchUsers(cb:(users:UserProfile[])=>void,error:(e:Error)=>void){return onSnapshot(collection(db!,APP_NAME,'root','users'),s=>cb(s.docs.map(d=>d.data() as UserProfile)),error);}
