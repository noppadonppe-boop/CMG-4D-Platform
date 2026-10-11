import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,deleteDoc,updateDoc,runTransaction,serverTimestamp,writeBatch,collection,getDocs,query,where} from 'firebase/firestore';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const env=await initializeTestEnvironment({projectId:'demo-cmg-auth',firestore:{host:'127.0.0.1',port:8280,rules:await fs.readFile('firestore.rules','utf8')}});
const path='CMG-4D-Platform/root',email=uid=>uid+'@example.test',db=uid=>env.authenticatedContext(uid,{email:email(uid)}).firestore();
const user=(uid,first=false)=>({uid,email:email(uid),firstName:uid,lastName:'Test',position:'Engineer',department:'Engineering',role:[first?'MasterAdmin':'Staff'],status:first?'approved':'pending',assignedProjects:[],createdAt:serverTimestamp(),photoURL:'',isFirstUser:first,version:1});
async function registerOnce(uid){const client=db(uid);return runTransaction(client,async tx=>{const ur=doc(client,path,'users',email(uid)),mr=doc(client,path,'appMeta','config');const u=await tx.get(ur),meta=await tx.get(mr);if(u.exists())return;tx.set(ur,user(uid,!meta.exists()));tx.set(mr,{firstUserRegistered:true,totalUsers:(meta.data()?.totalUsers||0)+1,createdAt:meta.data()?.createdAt||serverTimestamp(),masterUid:meta.data()?.masterUid||uid,masterEmail:meta.data()?.masterEmail||email(uid),lastRegisteredEmail:email(uid)});});}
async function register(uid){for(let n=0;n<4;n++){try{return await registerOnce(uid);}catch(e){if(e.code!=='permission-denied'||n===3)throw e;await new Promise(r=>setTimeout(r,80*(n+1)));}}}
try{
 await env.clearFirestore();console.log('bootstrap');await assertSucceeds(register('master'));console.log('register concurrent');
 await Promise.all([assertSucceeds(register('alice')),assertSucceeds(register('bob'))]);
 const m=db('master'),a=db('alice'),b=db('bob');assert.equal((await getDoc(doc(m,path,'appMeta','config'))).data().totalUsers,3);
 assert.equal((await getDoc(doc(a,path,'users',email('alice')))).data().status,'pending');
 await assertFails(updateDoc(doc(a,path,'users',email('alice')),{role:['MasterAdmin'],status:'approved',version:2}));
 await assertFails(getDocs(collection(a,path,'projects')));
 await assertFails(updateDoc(doc(m,path,'appMeta','config'),{firstUserRegistered:false,totalUsers:0}));
 await assertSucceeds(updateDoc(doc(m,path,'users',email('alice')),{role:['Modeler','Planner'],status:'approved',version:2}));
 await assertSucceeds(updateDoc(doc(m,path,'users',email('bob')),{status:'approved',version:2}));
 const head={name:'A project',ownerUid:'alice',memberUids:['alice'],assignmentEmail:email('alice'),revision:'initial',version:0,chunkCount:0,createdAt:serverTimestamp(),savedAt:serverTimestamp()};
 await assertSucceeds(setDoc(doc(a,path,'projects','p'),head));
 await assertSucceeds(setDoc(doc(a,path,'projects','p','revisions','r1','chunks','0'),{json:'{}',createdBy:'alice',createdAt:serverTimestamp()}));
 const create=writeBatch(a);create.update(doc(a,path,'projects','p'),{version:1,chunkCount:1,revision:'r1',savedAt:serverTimestamp()});create.update(doc(a,path,'users',email('alice')),{assignedProjects:['p'],version:3});await assertSucceeds(create.commit());
 await assertFails(getDoc(doc(b,path,'projects','p')));await assertSucceeds(getDoc(doc(m,path,'projects','p')));
 await assertFails(updateDoc(doc(a,path,'projects','p'),{memberUids:['alice','bob'],assignmentEmail:email('bob'),version:2,savedAt:serverTimestamp()}));
 const share=writeBatch(a);share.update(doc(a,path,'projects','p'),{memberUids:['alice','bob'],assignmentEmail:email('bob'),version:2,savedAt:serverTimestamp()});share.update(doc(a,path,'users',email('bob')),{assignedProjects:['p'],version:3});await assertSucceeds(share.commit());
 await assertSucceeds(getDoc(doc(b,path,'projects','p')));await assertSucceeds(getDocs(query(collection(b,path,'projects'),where('memberUids','array-contains','bob'))));
 await assertFails(updateDoc(doc(b,path,'projects','p'),{ownerUid:'bob',version:3,savedAt:serverTimestamp()}));
 await assertFails(updateDoc(doc(b,path,'projects','p'),{revision:'stale',version:2,savedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(doc(b,path,'projects','p'),{revision:'r2',version:3,savedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(a,'users','alice','apiKeys','openai'),{apiKey:'test-long-key',updatedAt:serverTimestamp()}));
 await assertSucceeds(setDoc(doc(m,'users','master','apiKeys','openai'),{apiKey:'test-long-key',updatedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(b,'users','master','apiKeys','openai')));
 await assertFails(updateDoc(doc(m,path,'users',email('master')),{role:['Staff'],version:2}));
 await assertSucceeds(updateDoc(doc(m,path,'users',email('bob')),{role:['Viewer'],version:4}));
 await assertFails(setDoc(doc(b,path,'projects','p','revisions','forbidden','chunks','0'),{json:'{}',createdBy:'bob',createdAt:serverTimestamp()}));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),path,'projects','p')));
 await assertFails(deleteDoc(doc(b,path,'projects','p')));
 await assertSucceeds(deleteDoc(doc(a,path,'projects','p','revisions','r1','chunks','0')));
 await assertSucceeds(deleteDoc(doc(a,path,'projects','p')));
 const masterProject={name:'Master project',ownerUid:'master',memberUids:['master'],assignmentEmail:email('master'),revision:'initial',version:0,chunkCount:0,createdAt:serverTimestamp(),savedAt:serverTimestamp()};
 await assertSucceeds(setDoc(doc(m,path,'projects','master-project'),masterProject));
 await assertSucceeds(deleteDoc(doc(m,path,'projects','master-project')));
 console.log('PASS: bootstrap transaction, concurrent registration, approval, role union, escalation denial, project isolation, owner sharing, stale-save rejection, read-only role and MasterAdmin-only keys');
}finally{await env.cleanup();}


