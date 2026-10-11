import {initializeApp,getApps,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {userFirestore} from './firestoreRest.mjs';

const APP_NAME = 'CMG-4D-Platform';
const AI_ROLES = ['MasterAdmin', 'SuperAdmin', 'Admin', 'Staff', 'Modeler'];

const fail = (message, status) => Object.assign(Error(message), {status});
const normalizeApiKey = value => {
  let trimmed = String(value || '').trim();
  const assignment = trimmed.match(/^[A-Z][A-Z0-9_]*\s*=\s*([\s\S]+)$/);
  if (assignment) trimmed = assignment[1].trim();
  if (/^Bearer\s+/i.test(trimmed)) trimmed = trimmed.replace(/^Bearer\s+/i, '').trim();
  const wrapped = trimmed.match(/^(['"`])([\s\S]*)\1$/);
  return (wrapped ? wrapped[2] : trimmed).trim();
};

// Admin credentials are optional: without them the server only needs the public project id.
// Cloud Run supplies Application Default Credentials through its service
// account instead of GOOGLE_APPLICATION_CREDENTIALS. Keep the REST fallback
// for local/browser-token API requests, but allow privileged server-only
// features such as the MCP bridge to opt into Admin SDK access in Cloud Run.
const hasAdminCredentials = () => Boolean(
 process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE || process.env.CLOUD_RUN_JOB,
);

function services() {
  let app = getApps().find(a => a.name === 'cmg-server');
  if (!app) {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    if (!projectId) throw fail('ยังไม่ได้ตั้งค่า Firebase Project สำหรับเซิร์ฟเวอร์', 500);
    const credential = hasAdminCredentials() ? {credential: applicationDefault()} : {};
    app = initializeApp({projectId, ...credential}, 'cmg-server');
  }
  return {auth: getAuth(app), projectId: app.options.projectId, adminDb: () => getFirestore(app)};
}

export async function verifyUser(req) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) throw fail('กรุณาเข้าสู่ระบบ', 401);
  const {auth, projectId: firebaseProject, adminDb} = services();
  const admin = hasAdminCredentials();
  let decoded;
  try {
    // The revocation check calls the Auth API, which needs admin credentials.
    decoded = await auth.verifyIdToken(token, admin);
  } catch (error) {
    if (admin && error?.code !== 'auth/id-token-expired' && error?.code !== 'auth/id-token-revoked' && error?.code !== 'auth/argument-error') {
      throw fail('เซิร์ฟเวอร์ตรวจสอบสิทธิ์ไม่สำเร็จ: ' + (error?.message || error), 500);
    }
    throw fail('การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่', 401);
  }
  return {token, decoded, firebaseProject, adminDb, admin};
}

export async function authorizeProject(req) {
 return authorizeProjectId(req, req.body?.projectId);
}

export async function authorizeProjectId(req, projectId) {
  const {token, decoded, firebaseProject, adminDb, admin} = await verifyUser(req);
  if (typeof projectId !== 'string' || !projectId || projectId.length > 200 || projectId.includes('/')) throw fail('รหัสโครงการไม่ถูกต้อง', 400);
  const db = admin ? {get: async path => (await adminDb().doc(path).get()).data()} : userFirestore(token, firebaseProject);
  const profile = await db.get(`${APP_NAME}/root/users/${decoded.email}`);
  if (profile?.uid !== decoded.uid || profile.status !== 'approved' || !profile.role.some(r => AI_ROLES.includes(r))) throw fail('ไม่มีสิทธิ์ใช้ AI', 403);
  const project = await db.get(`${APP_NAME}/root/projects/${projectId}`);
  if (!project || (!profile.role.includes('MasterAdmin') && !project.memberUids?.includes(decoded.uid))) throw fail('ไม่มีสิทธิ์เข้าถึงโครงการนี้', 403);
  return {db, profile, project, token};
}

// Server-only Firestore access for trusted integrations. The MCP bridge uses
// this after validating its short-lived scope token; it never exposes the
// Admin SDK to the browser.
export function adminFirestore() {
 if (!hasAdminCredentials()) throw fail('MCP ต้องใช้ Firebase Admin credentials หรือ Cloud Run service account', 503);
 return services().adminDb();
}

export function adminStorageBucket() {
 if (!hasAdminCredentials()) throw fail('MCP ต้องใช้ Firebase Admin credentials หรือ Cloud Run service account', 503);
 services();
 const app = getApps().find(item => item.name === 'cmg-server');
 const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || `${process.env.VITE_FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT}.appspot.com`;
 return getStorage(app).bucket(bucketName);
}

// Provider keys are managed only from the Admin page. Stored keys are readable
// by the server with admin credentials, or by the MasterAdmin's own token.
export async function managedApiKey({db, profile}, provider) {
  if (!['openai','anthropic','google'].includes(provider)) throw Error('ผู้ให้บริการไม่รองรับ');
  const meta = await db.get(`${APP_NAME}/root/appMeta/config`);
  let key;
  if (meta?.masterUid) {
    key = (await db.get(`${APP_NAME}/root/users/${meta.masterEmail}/apiKeys/${provider}`))?.apiKey;
    if (!key) {
      try {
        key = (await db.get(`users/${meta.masterUid}/apiKeys/${provider}`))?.apiKey;
      } catch {
        // legacy location may be unreadable
      }
    }
  }
  if (typeof key === 'string' && key.trim()) return normalizeApiKey(key);
  if (!meta?.masterUid) throw Error('ยังไม่มี MasterAdmin');
  throw Error('ยังไม่มี MCP API Key ของ ' + provider + ' — ตั้งค่าที่หน้า Admin');
}
