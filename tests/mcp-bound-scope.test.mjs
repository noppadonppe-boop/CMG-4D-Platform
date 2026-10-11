import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpScope} from '../server/mcpScope.mjs';
import {bindMcpTools} from '../server/mcpBoundScope.mjs';
test('transport binds verified identity, hides credentials, and rejects malformed headers',async()=>{
 const previous=process.env.MCP_SCOPE_SECRET;process.env.MCP_SCOPE_SECRET='bound-scope-test-secret-longer-than-thirty-two';
 try{
  const token=createMcpScope({uid:'u',projectId:'p',requestId:'r'});let registered;
  const server={registerTool:(name,config,handler)=>{registered={name,config,handler};}};
  bindMcpTools(server,token).registerTool('save',{inputSchema:{scope_token:{},project_id:{},batch_index:{}}},args=>args);
  assert.deepEqual(Object.keys(registered.config.inputSchema),['batch_index']);
  const args=await registered.handler({scope_token:'corrupted-by-model',project_id:'another-project',batch_index:2});
  assert.equal(args.scope_token,token);assert.equal(args.project_id,'p');assert.equal(args.batch_index,2);
  assert.throws(()=>bindMcpTools(server,'invalid'),/ไม่ถูกต้อง/);
  assert.equal(bindMcpTools(server,undefined),server);
 }finally{if(previous===undefined)delete process.env.MCP_SCOPE_SECRET;else process.env.MCP_SCOPE_SECRET=previous;}
});
