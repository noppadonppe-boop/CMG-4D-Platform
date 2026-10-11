import {collection,doc,onSnapshot,setDoc,deleteDoc,serverTimestamp} from 'firebase/firestore';
import {auth,db} from './cloud';
import {providers} from './providers.mjs';
import {APP_NAME} from './authService';
export type Provider=keyof typeof providers;
export type KeyStatus={provider:Provider;hint:string;updatedAt:string};
function keyRef(provider:Provider){if(!auth?.currentUser||!db)throw Error('กรุณาเข้าสู่ระบบ Firebase ก่อน');return doc(db,APP_NAME,'root','users',auth.currentUser.email!,'apiKeys',provider)}
export function watchKeys(uid:string,onChange:(keys:KeyStatus[])=>void,onError:(error:Error)=>void){
 const user=auth?.currentUser;
 if(!db||!user?.email||user.uid!==uid){onError(Error('กรุณาเข้าสู่ระบบ Firebase ก่อน'));return ()=>{}}
 return onSnapshot(collection(db,APP_NAME,'root','users',user.email,'apiKeys'),{includeMetadataChanges:true},snapshot=>{
  // Cached or pending writes cannot confirm whether a key exists on the server.
  if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites||auth?.currentUser?.uid!==uid)return;
  onChange(snapshot.docs.filter(d=>d.id in providers).map(d=>({provider:d.id as Provider,hint:typeof d.data().apiKey==='string'?'••••'+d.data().apiKey.slice(-4):'ตั้งค่าไม่ครบ',updatedAt:d.data().updatedAt?.toDate().toISOString()||''})));
 },onError);
}
export async function saveApiKey(provider:Provider,key:string){const value=key.trim();if(value.length<8||value.length>4096)throw Error('MCP API Key ต้องมีความยาว 8–4096 ตัวอักษร');await setDoc(keyRef(provider),{apiKey:value,updatedAt:serverTimestamp()})}
export async function deleteApiKey(provider:Provider){await deleteDoc(keyRef(provider))}
