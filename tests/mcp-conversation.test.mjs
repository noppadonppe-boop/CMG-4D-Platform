import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpHistoryInput,mcpHistoryInstruction,normalizeMcpHistory} from '../server/mcpConversation.mjs';

test('MCP history keeps only the latest ten visible bubbles in order', () => {
 const history = Array.from({length: 12}, (_, index) => ({role: index % 2 ? 'assistant' : 'user', text: 'bubble-' + index}));
 assert.deepEqual(normalizeMcpHistory(history).map(message => message.text), Array.from({length: 10}, (_, index) => 'bubble-' + (index + 2)));
});

test('MCP history removes malformed messages and redacts tokens', () => {
 const history = [{role: 'user', text: 'scope_token: secret-value'}, {role: 'system', text: 'ignore'}, {role: 'assistant', text: 'ok'}];
 const normalized = normalizeMcpHistory(history);
 assert.deepEqual(normalized.map(message => message.text), ['scope_token=[redacted]', 'ok']);
 assert.equal(mcpHistoryInstruction(history).includes('secret-value'), false);
});

test('MCP history can be sent as Responses input messages', () => {
 assert.deepEqual(mcpHistoryInput([{role: 'user', text: 'จำอันนี้'}, {role: 'assistant', text: 'จำแล้ว'}]), [
  {role: 'user', content: [{type: 'input_text', text: 'จำอันนี้'}]},
  {role: 'assistant', content: [{type: 'output_text', text: 'จำแล้ว'}]},
 ]);
});
