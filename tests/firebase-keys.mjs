import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,deleteDoc,serverTimestamp} from 'firebase/firestore';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const env=await initializeTestEnvironment({projectId:'demo-cmg-admin',firestore:{host:'127.0.0.1',port:8280,rules:await fs.readFile('firestore.rules','utf8')}});
try{const owner=env.authenticatedContext('owner',{email:'owner@example.test'}).firestore(),other=env.authenticatedContext('other',{email:'other@example.test'}).firestore(),anonymous=env.unauthenticatedContext().firestore();
 await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'CMG-4D-Platform/root/users/owner@example.test'),{uid:'owner',status:'approved',role:['MasterAdmin']});await setDoc(doc(c.firestore(),'CMG-4D-Platform/root/users/other@example.test'),{uid:'other',status:'approved',role:['Staff']});});
 for(const provider of ['openai','anthropic','google']){const path=`CMG-4D-Platform/root/users/owner@example.test/apiKeys/${provider}`,ref=doc(owner,path);await assertSucceeds(setDoc(ref,{apiKey:'test-key-original',updatedAt:serverTimestamp()}));assert.equal((await getDoc(ref)).data().apiKey,'test-key-original');await assertSucceeds(setDoc(ref,{apiKey:'test-key-replaced',updatedAt:serverTimestamp()}));assert.equal((await getDoc(ref)).data().apiKey,'test-key-replaced');await assertFails(getDoc(doc(other,path)));await assertFails(deleteDoc(doc(other,path)));await assertFails(getDoc(doc(anonymous,path)));await assertSucceeds(deleteDoc(ref));assert.equal((await getDoc(ref)).exists(),false)}
 await assertFails(setDoc(doc(owner,'CMG-4D-Platform/root/users/owner@example.test/apiKeys/unknown'),{apiKey:'test-key-long',updatedAt:serverTimestamp()}));await assertFails(setDoc(doc(owner,'CMG-4D-Platform/root/users/owner@example.test/apiKeys/openai'),{apiKey:'short',updatedAt:serverTimestamp()}));
 console.log('PASS Firebase emulator: save, replace, read, delete all 3 providers; cross-account/anonymous access denied; validation enforced');
}finally{await env.cleanup()}
