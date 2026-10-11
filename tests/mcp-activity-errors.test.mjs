import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiMcpProgress} from '../server/mcpActivity.mjs';
test('a rejected save is shown as an error even when MCP transport completed',()=>{
 const progress=createOpenAiMcpProgress([],'test');
 const item={type:'mcp_call',id:'m1',name:'cmg_save_model_batch',arguments:'{}',output:JSON.stringify({content:[{type:'text',text:JSON.stringify({ok:false,error:'invalid batch'})}]})};
 const result=progress({type:'response.output_item.done',item});
 assert.equal(result.event.stage,'error');assert.match(result.detail,/invalid batch/);
});
