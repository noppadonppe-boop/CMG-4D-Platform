import {randomUUID} from 'node:crypto';
import {adminFirestore} from './auth.mjs';
import {validateProject} from '../src/domain.mjs';

const APP_NAME = 'CMG-4D-Platform';
const ROOT = `${APP_NAME}/root`;
const CHUNK_SIZE = 180000;
const MAX_BYTES = 20 * 1024 * 1024;

const projectRef = (db, projectId) => db.doc(`${ROOT}/projects/${projectId}`);

function decodeProject(chunks, projectId) {
 const json = chunks.sort((a,b) => Number(a.id) - Number(b.id)).map(chunk => chunk.data().json).join('');
 let project;
 try { project = JSON.parse(json); } catch { throw Error('ข้อมูลโครงการอ่านไม่ได้'); }
 if (!validateProject(project) || project.id !== projectId) throw Error('ข้อมูลโครงการไม่ถูกต้อง');
 return project;
}

export async function readAdminProject(projectId) {
 const db = adminFirestore();
 const root = projectRef(db, projectId);
 const headerSnapshot = await root.get();
 if (!headerSnapshot.exists) throw Error('ไม่พบโครงการ');
 const header = {id: projectId, ...headerSnapshot.data()};
 if (!Number.isInteger(header.chunkCount) || header.chunkCount < 1 || typeof header.revision !== 'string') throw Error('โครงการยังไม่มีข้อมูลรุ่นที่สมบูรณ์');
 const chunkSnapshot = await root.collection('revisions').doc(header.revision).collection('chunks').get();
 if (chunkSnapshot.size !== header.chunkCount) throw Error('ข้อมูลโครงการไม่ครบ');
 return {db, header, project: decodeProject(chunkSnapshot.docs, projectId)};
}

export async function writeAdminProject({project,expectedVersion,actorUid,message}) {
 if (!validateProject(project)) throw Error('ข้อมูลโครงการไม่ผ่านการตรวจสอบ');
 const json = JSON.stringify(project);
 if (Buffer.byteLength(json, 'utf8') > MAX_BYTES) throw Error('ข้อมูลโครงการเกิน 20 MB');
 const chunks = [];
 for (let i = 0; i < json.length; i += CHUNK_SIZE) chunks.push(json.slice(i, i + CHUNK_SIZE));
 if (!chunks.length || chunks.length > 150) throw Error('จำนวนข้อมูลโครงการเกินขีดจำกัด');
 const db = adminFirestore();
 const root = projectRef(db, project.id);
 const revision = randomUUID();
 const now = new Date();
 const nextProject = {...project, updatedAt: now.toISOString()};
 const nextJson = JSON.stringify(nextProject);
 const nextChunks = [];
 for (let i = 0; i < nextJson.length; i += CHUNK_SIZE) nextChunks.push(nextJson.slice(i, i + CHUNK_SIZE));
 await db.runTransaction(async tx => {
  const current = await tx.get(root);
  if (!current.exists) throw Error('ไม่พบโครงการ');
  const data = current.data();
  if (data.version !== expectedVersion) throw Error('PROJECT_CONFLICT');
  for (let i = 0; i < nextChunks.length; i++) tx.set(root.collection('revisions').doc(revision).collection('chunks').doc(String(i)), {json: nextChunks[i], createdBy: actorUid || 'mcp', createdAt: now});
  tx.update(root, {name: nextProject.name, revision, version: expectedVersion + 1, chunkCount: nextChunks.length, savedAt: now});
 });
 return {project: nextProject, revision, version: expectedVersion + 1, chunkCount: nextChunks.length, message};
}

export async function listAdminProjectsForUser(uid, role = []) {
 const db = adminFirestore();
 const snapshot = await db.collection(`${ROOT}/projects`).get();
 return snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})).filter(project => role.includes('MasterAdmin') || project.memberUids?.includes(uid));
}

