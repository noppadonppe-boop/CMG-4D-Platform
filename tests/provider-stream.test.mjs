import test from 'node:test';
import assert from 'node:assert/strict';
import {generateModel} from '../server/ai.mjs';
import {demoProject} from '../src/domain.mjs';

const settings = {provider: 'openai', model: 'gpt-6.1-sol', effort: 'medium', apiKey: 'test-only', prompt: 'build', files: []};
const response = events => new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join(''), {headers: {'Content-Type': 'text/event-stream'}});

test('provider stream preserves separate summary parts and accepts a completed terminal event', async () => {
  const progress = [];
  const result = await generateModel(settings, undefined, async () => response([
    {type: 'response.reasoning_summary_text.delta', item_id: 'r1', summary_index: 0, delta: 'ตรวจหน่วย'},
    {type: 'response.reasoning_summary_text.delta', item_id: 'r1', summary_index: 1, delta: 'ตรวจช่องเปิด'},
    {type: 'response.output_text.delta', delta: JSON.stringify(demoProject())},
    {type: 'response.completed', response: {status: 'completed', output: []}},
  ]), patch => progress.push(patch));
  assert.deepEqual(result.thinking, ['ตรวจหน่วย', 'ตรวจช่องเปิด']);
  assert.ok(progress.some(patch => patch.thinking?.length === 2));
});

test('valid JSON from a disconnected provider is not treated as a confirmed result', async () => {
  let calls = 0;
  await assert.rejects(generateModel(settings, undefined, async () => {
    calls++;
    return response([{type: 'response.output_text.delta', delta: JSON.stringify(demoProject())}]);
  }), /ขาดการเชื่อมต่อ/);
  assert.equal(calls, 1);
});

test('streamed incomplete output retries with a larger budget instead of succeeding early', async () => {
  let calls = 0;
  const result = await generateModel(settings, undefined, async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    if (calls === 1) return response([{type: 'response.incomplete', response: {status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}, output: []}}]);
    assert.ok(request.max_output_tokens > 32000);
    return response([{type: 'response.completed', response: {status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(demoProject())}]}]}}]);
  });
  assert.equal(calls, 2);
  assert.ok(result.project.elements.length);
});

test('JSON HTTP errors from a streaming request keep the provider error message', async () => {
  await assert.rejects(generateModel(settings, undefined, async () => new Response(JSON.stringify({error: {message: 'test quota exhausted'}}), {status: 429})), /test quota exhausted/);
});
