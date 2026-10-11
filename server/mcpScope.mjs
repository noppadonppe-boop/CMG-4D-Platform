import {createHmac,timingSafeEqual} from 'node:crypto';

const encoder = value => Buffer.from(value).toString('base64url');
const decoder = value => Buffer.from(value, 'base64url').toString('utf8');
const secret = () => {
 const value = process.env.MCP_SCOPE_SECRET || process.env.MCP_SHARED_SECRET;
 if (!value || value.length < 32) throw Error('MCP_SCOPE_SECRET ต้องมีอย่างน้อย 32 ตัวอักษร');
 return value;
};
const sign = value => encoder(createHmac('sha256', secret()).update(value).digest());

export function createMcpScope({uid,email,role,projectId,requestId,ttlSeconds=15*60}) {
 const now = Math.floor(Date.now()/1000);
 const body = encoder(JSON.stringify({
  v: 1,
  uid,
  email,
  role: Array.isArray(role) ? role.slice(0, 8) : [],
  projectId,
  requestId,
  iat: now,
  exp: now + Math.max(60, Math.min(ttlSeconds, 30*60)),
 }));
 return body + '.' + sign(body);
}

export function verifyMcpScope(token, expected = {}) {
 if (typeof token !== 'string') throw Error('MCP scope token หายไป');
 const parts = token.split('.');
 if (parts.length !== 2) throw Error('MCP scope token ไม่ถูกต้อง');
 const expectedSignature = sign(parts[0]);
 const actualBuffer = Buffer.from(parts[1]);
 const expectedBuffer = Buffer.from(expectedSignature);
 if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throw Error('MCP scope token ไม่ผ่านการตรวจสอบ');
 let payload;
 try { payload = JSON.parse(decoder(parts[0])); } catch { throw Error('MCP scope token อ่านไม่ได้'); }
 if (payload?.v !== 1 || typeof payload.uid !== 'string' || typeof payload.projectId !== 'string' || typeof payload.requestId !== 'string' || !Number.isInteger(payload.exp) || payload.exp < Math.floor(Date.now()/1000)) throw Error('MCP scope token หมดอายุหรือข้อมูลไม่ครบ');
 for (const [key,value] of Object.entries(expected)) if (value !== undefined && payload[key] !== value) throw Error('MCP scope token ไม่ตรงกับคำขอ');
 return payload;
}

export function scopeFingerprint(token) {
 return createHmac('sha256', secret()).update(String(token)).digest('hex');
}

