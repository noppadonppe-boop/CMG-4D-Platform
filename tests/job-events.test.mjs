import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readJobEvents} from '../src/jobEvents.mjs';
import {streamJob} from '../server/jobStream.mjs';
import {startJob, getJob, cancelJob} from '../server/jobs.mjs';
import {api} from '../server/api.mjs';

test('SSE handles split UTF-8, split CRLF, comments and multiple records', async () => {
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\nid: 1\r\nevent: job\r\ndata: {"detail":\r\ndata: "กำลังอ่านแบบ"}\r\n\r\ndata: [DONE]\r\n\r\ndata: {"status":"done"}\r\n\r\n');
  const body = new ReadableStream({start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  }});
  const received = [];
  await readJobEvents(body, value => { received.push(value); });
  assert.deepEqual(received, [{detail: 'กำลังอ่านแบบ'}, {status: 'done'}]);
});

test('SSE stops and cancels its reader on a terminal snapshot', async () => {
  let cancelled = false;
  const body = new ReadableStream({start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"status":"done"}\n\ndata: {"status":"running"}\n\n'));
  }, cancel() { cancelled = true; }});
  const received = [];
  await readJobEvents(body, value => { received.push(value); return false; });
  assert.equal(cancelled, true);
  assert.deepEqual(received, [{status: 'done'}]);
});

test('malformed SSE data fails instead of silently losing status updates', async () => {
  await assert.rejects(readJobEvents(new Response('data: broken\n\n').body, () => {}), SyntaxError);
});

async function serve(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {base: `http://127.0.0.1:${server.address().port}`, close: async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }};
}

test('production event route requires authentication before opening the stream', async () => {
  const server = await serve(api());
  try {
    const response = await fetch(server.base + '/api/jobs/unknown/events');
    assert.equal(response.status, 401);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
  } finally { await server.close(); }
});

test('HTTP SSE isolates owners, survives disconnect, restores missed stages and ends with the result', async () => {
  let update, release;
  const id = startJob({uid: 'http-owner', projectId: 'p', run: (_signal, report) => {
    update = report;
    return new Promise(resolve => { release = resolve; });
  }});
  const app = express();
  // Substitute only the authentication boundary; use the production stream handler.
  app.get('/jobs/:id/events', (req, res) => {
    try { streamJob(req, res, req.headers.authorization === 'Bearer owner' ? 'http-owner' : 'other'); }
    catch (error) { res.status(error.status || 500).json({error: error.message}); }
  });
  const server = await serve(app);
  try {
    assert.equal((await fetch(server.base + `/jobs/${id}/events`)).status, 404);
    const response = await fetch(server.base + `/jobs/${id}/events`, {headers: {Authorization: 'Bearer owner'}});
    assert.match(response.headers.get('Content-Type'), /text\/event-stream/);
    assert.equal(response.headers.get('X-Accel-Buffering'), 'no');
    await readJobEvents(response.body, snapshot => {
      assert.equal(snapshot.status, 'running');
      assert.equal(snapshot.uid, undefined);
      assert.equal(snapshot.controller, undefined);
      return false; // Close the tab without cancelling generation.
    });
    update({stage: 'thinking', detail: 'วิเคราะห์แบบ', thinking: ['สรุปจากโมเดล']});
    update({stage: 'validating', detail: 'ตรวจช่องเปิด'});
    assert.equal(getJob(id, 'http-owner').status, 'running');
    const resumed = await fetch(server.base + `/jobs/${id}/events`, {headers: {Authorization: 'Bearer owner'}});
    const snapshots = [];
    const reading = readJobEvents(resumed.body, snapshot => { snapshots.push(snapshot); });
    release({project: {id: 'result'}, notes: ['verified']});
    await reading;
    assert.deepEqual(snapshots[0].events.map(event => event.stage), ['queued', 'thinking', 'validating']);
    assert.deepEqual(snapshots[0].thinking, ['สรุปจากโมเดล']);
    assert.equal(snapshots.at(-1).status, 'done');
    assert.equal(snapshots.at(-1).result.project.id, 'result');
    assert.equal(snapshots.at(-1).events.at(-1).stage, 'done');
    assert.ok(snapshots.at(-1).eventId > snapshots[0].eventId);
    // Opening an already completed job sends its snapshot and closes immediately.
    const completed = await fetch(server.base + `/jobs/${id}/events`, {headers: {Authorization: 'Bearer owner'}});
    const final = [];
    await readJobEvents(completed.body, value => { final.push(value); });
    assert.equal(final.length, 1);
    assert.equal(final[0].status, 'done');
  } finally { cancelJob(id, 'http-owner'); await server.close(); }
});
