import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpScope,verifyMcpScope,scopeFingerprint} from '../server/mcpScope.mjs';

test('MCP scope tokens are signed, scoped, and verifiable', () => {
 const previous = process.env.MCP_SCOPE_SECRET;
 process.env.MCP_SCOPE_SECRET = 'test-mcp-secret-that-is-long-enough-1234567890';
 try {
  const token = createMcpScope({uid:'user-1',email:'user@example.com',role:['Modeler'],projectId:'project-1',requestId:'request-1',ttlSeconds:60});
  assert.equal(verifyMcpScope(token, {uid:'user-1',projectId:'project-1',requestId:'request-1'}).projectId, 'project-1');
  assert.throws(() => verifyMcpScope(token, {projectId:'other-project'}), /ไม่ตรงกับคำขอ/);
  assert.equal(scopeFingerprint(token).length, 64);
 } finally {
  if (previous === undefined) delete process.env.MCP_SCOPE_SECRET;
  else process.env.MCP_SCOPE_SECRET = previous;
 }
});

test('MCP scope rejects expired tokens', () => {
 const previous = process.env.MCP_SCOPE_SECRET;
 process.env.MCP_SCOPE_SECRET = 'test-mcp-secret-that-is-long-enough-1234567890';
 try {
  const token = createMcpScope({uid:'user-1',projectId:'project-1',requestId:'request-1',ttlSeconds:60});
  const now = Date.now;
  Date.now = () => now() + 120000;
  try { assert.throws(() => verifyMcpScope(token), /หมดอายุ/); }
  finally { Date.now = now; }
 } finally {
  if (previous === undefined) delete process.env.MCP_SCOPE_SECRET;
  else process.env.MCP_SCOPE_SECRET = previous;
 }
});
