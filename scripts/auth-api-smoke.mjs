import assert from 'node:assert/strict';
process.env.VITE_FIREBASE_PROJECT_ID='demo-cmg-auth';process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8280';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9299';
const {api}=await import('../server/api.mjs');const {authorizeProject,managedApiKey}=await import('../server/auth.mjs');const {getFirestore}=await import('firebase-admin/firestore');
const server=api().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const signIn=async email=>{const r=await fetch('http://127.0.0.1:9299/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'password123',returnSecureToken:true})});const data=await r.json();assert.ok(data.idToken,JSON.stringify(data));return data.idToken;};
try{
 let r=await fetch(base+'/api/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:'p',files:[]})});assert.equal(r.status,401);
 const masterToken=await signIn('first@example.test');const staffToken=await signIn('staff@example.test');
 const dummy={headers:{authorization:'Bearer '+masterToken},body:{projectId:'missing'}};await assert.rejects(()=>authorizeProject(dummy),e=>e.status===403);
 // Initialize the server SDK through an authenticated denied request, then find the real project.
 const db=getFirestore((await import('firebase-admin/app')).getApp('cmg-server'));const projects=await db.collection('CMG-4D-Platform/root/projects').get();const projectId=projects.docs.find(d=>d.data().version>0).id;
 const req={headers:{authorization:'Bearer '+staffToken},body:{projectId}};const allowed=await authorizeProject(req);assert.equal(allowed.profile.status,'approved');
  const meta=(await db.doc('CMG-4D-Platform/root/appMeta/config').get()).data();await db.doc(`CMG-4D-Platform/root/users/${meta.masterEmail}/apiKeys/openai`).set({apiKey:'test-server-only-key',updatedAt:new Date()});await assert.rejects(()=>managedApiKey(allowed,'openai'),/MCP API Key/);const masterReq={headers:{authorization:'Bearer '+masterToken},body:{projectId}};assert.equal(await managedApiKey(await authorizeProject(masterReq),'openai'),'test-server-only-key');
 r=await fetch(base+'/api/prepare',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+staffToken},body:JSON.stringify({projectId,files:[{name:'timeline.csv',data:Buffer.from('activity,start,end\nTest,2026-10-09,2026-10-10').toString('base64')}]})});assert.equal(r.status,200,await r.text());
 const uid=allowed.profile.uid;await db.doc('CMG-4D-Platform/root/users/staff@example.test').update({status:'pending'});await assert.rejects(()=>authorizeProject(req),e=>e.status===403);await db.doc('CMG-4D-Platform/root/users/staff@example.test').update({status:'approved'});
 await db.doc(`CMG-4D-Platform/root/users/${meta.masterEmail}/apiKeys/openai`).delete();console.log('PASS server: bearer token required, project membership enforced, pending user denied, approved staff can prepare files, centrally managed keys remain server-side');
}finally{await new Promise(r=>server.close(r));}
