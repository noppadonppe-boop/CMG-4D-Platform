import http from 'node:http';
import {api} from '../server/api.mjs';

const token = process.env.MCP_SERVER_TOKEN || 'local-mcp-smoke-token-12345678901234567890';
process.env.MCP_SERVER_TOKEN = token;
process.env.MCP_SCOPE_SECRET ||= 'local-mcp-scope-secret-12345678901234567890';
process.env.MCP_PUBLIC_URL ||= 'http://localhost:5173';
process.env.OPENAI_API_KEY ||= 'local-mcp-openai-key';

const server = http.createServer(api());
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const {port} = server.address();
const endpoint = `http://127.0.0.1:${port}/mcp`;
const headers = {
 Authorization: 'Bearer ' + token,
 'Content-Type': 'application/json',
 Accept: 'application/json, text/event-stream',
};

async function call(body) {
 const response = await fetch(endpoint, {method: 'POST', headers, body: JSON.stringify(body)});
 const text = await response.text();
 if (!response.ok) throw Error(`MCP HTTP ${response.status}: ${text.slice(0, 500)}`);
 return text;
}

try {
 const health = await fetch(`http://127.0.0.1:${port}/mcp/health`);
 const healthBody = await health.json();
 if (!healthBody.configured || healthBody.transport !== 'provider_mcp') throw Error('MCP health is not configured for provider MCP mode');
 const initialized = await call({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'cmg-mcp-smoke', version: '1'}}});
 if (!initialized.includes('cmg-4d-platform')) throw Error('initialize response did not identify CMG MCP');
 const listed = await call({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}});
 const required = ['cmg_get_project_summary', 'cmg_read_project_file', 'cmg_create_model', 'cmg_apply_model_patch', 'cmg_update_schedule', 'cmg_complete_request'];
 for (const name of required) if (!listed.includes(name)) throw Error('missing MCP tool: ' + name);
 console.log('MCP smoke passed: initialize + tools/list');
} finally {
 await new Promise(resolve => server.close(resolve));
}
