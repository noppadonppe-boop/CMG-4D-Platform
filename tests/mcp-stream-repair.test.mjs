import test from 'node:test';
import assert from 'node:assert/strict';
import {readResponseStream} from '../server/mcpIntegration.mjs';
test('tool argument rejection lets the model repair the call within the same response',async()=>{
 const events=[{type:'response.mcp_call.failed',item_id:'bad'},{type:'response.output_item.done',item:{type:'mcp_call',id:'bad',error:{type:'mcp_tool_execution_error',content:'invalid arguments'}}},{type:'response.output_item.done',item:{type:'mcp_call',id:'good',output:'{"ok":true}'}},{type:'response.completed',response:{id:'r',status:'completed'}}];
 const response=new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
 assert.equal((await readResponseStream(response,async()=>{})).status,'completed');
});
