import test from 'node:test';
import assert from 'node:assert/strict';
import {startJob,getJob,cancelJob,subscribeJob} from '../server/jobs.mjs';
import {describeNetworkError} from '../server/ai.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('job keeps running after the caller leaves and exposes its result later', async () => {
  let release;
  const id = startJob({uid: 'u1', projectId: 'p', run: () => new Promise(resolve => { release = () => resolve({project: {id: 'x'}, notes: ['ok']}); })});
  assert.equal(getJob(id, 'u1').status, 'running');
  release();
  await wait(10);
  const done = getJob(id, 'u1');
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result.notes, ['ok']);
});

test('job exposes provider phase and heartbeat while it is running', async () => {
  let release;
  const id = startJob({uid: 'phase-user', projectId: 'p', run: (_signal, update) => {
    update({stage: 'thinking', detail: 'กำลังวิเคราะห์แบบ'});
    return new Promise(resolve => { release = () => resolve({project: {id: 'x'}, notes: []}); });
  }});
  const running = getJob(id, 'phase-user');
  assert.equal(running.status, 'running');
  assert.equal(running.stage, 'thinking');
  assert.equal(running.detail, 'กำลังวิเคราะห์แบบ');
  assert.equal(typeof running.heartbeatAt, 'number');
  release();
  await wait(10);
});

test('job failures are reported as errors', async () => {
  const id = startJob({uid: 'u2', projectId: 'p', run: async () => { throw Error('provider said no'); }});
  await wait(10);
  assert.deepEqual([getJob(id, 'u2').status, getJob(id, 'u2').error], ['error', 'provider said no']);
});

test('a user can only run one job at a time and only read their own', async () => {
  const id = startJob({uid: 'u3', projectId: 'p', run: signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('x'), {name: 'AbortError'}))))});
  assert.throws(() => startJob({uid: 'u3', projectId: 'p', run: async () => ({})}), e => e.status === 409);
  assert.throws(() => getJob(id, 'someone-else'), e => e.status === 404);
  assert.throws(() => cancelJob(id, 'someone-else'), e => e.status === 404);
  cancelJob(id, 'u3');
  await wait(10);
  assert.deepEqual([getJob(id, 'u3').status, getJob(id, 'u3').error], ['error', 'ยกเลิกแล้ว']);
  const next = startJob({uid: 'u3', projectId: 'p', run: async () => ({notes: []})});
  await wait(10);
  assert.equal(getJob(next, 'u3').status, 'done');
});

test('unknown jobs are 404', () => {
  assert.throws(() => getJob('missing', 'u1'), e => e.status === 404);
});

test('network errors show the underlying cause instead of just "fetch failed"', () => {
  const error = Object.assign(TypeError('fetch failed'), {cause: Object.assign(Error('connect ETIMEDOUT'), {code: 'UND_ERR_CONNECT_TIMEOUT'})});
  assert.match(describeNetworkError(error), /UND_ERR_CONNECT_TIMEOUT/);
  assert.equal(describeNetworkError(Error('plain')), 'plain');
});

test('history preserves retry milestones, without adding one row per reasoning token', async () => {
  let release, update;
  const id = startJob({uid: 'history-user', run: (_signal, report) => {
    update = report;
    return new Promise(resolve => { release = resolve; });
  }});
  update({stage: 'thinking', detail: 'วิเคราะห์แบบ', attempt: 1});
  for (let i = 0; i < 20; i++) update({thinking: ['summary ' + i]});
  update({stage: 'generating', detail: 'รับข้อมูลโมเดล'});
  update({stage: 'validating', detail: 'ตรวจ geometry'});
  update({stage: 'repairing', detail: 'แก้ข้อมูล', attempt: 2});
  update({stage: 'thinking', detail: 'วิเคราะห์แบบ', attempt: 2});
  const snapshot = getJob(id, 'history-user');
  assert.deepEqual(snapshot.events.map(event => event.stage), ['queued', 'thinking', 'generating', 'validating', 'repairing', 'thinking']);
  assert.equal(snapshot.events.at(-1).attempt, 2);
  assert.deepEqual(snapshot.thinking, ['summary 19']);
  assert.throws(() => subscribeJob(id, 'other-user', () => {}), error => error.status === 404);
  release({notes: []});
  await wait(10);
});

test('heartbeat reports connectivity without advancing progress time or adding stages', t => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: 100000});
  const id = startJob({uid: 'heartbeat-user', run: () => new Promise(() => {})});
  const messages = [];
  const {unsubscribe} = subscribeJob(id, 'heartbeat-user', event => messages.push(event));
  const before = getJob(id, 'heartbeat-user');
  t.mock.timers.tick(5000);
  const after = getJob(id, 'heartbeat-user');
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(after.heartbeatAt, before.heartbeatAt + 5000);
  assert.deepEqual(after.events, before.events);
  assert.equal(messages.at(-1).type, 'heartbeat');
  unsubscribe();
  cancelJob(id, 'heartbeat-user');
});

test('cancel publishes immediately even if the provider ignores abort, and late results cannot overwrite it', async () => {
  let release;
  const id = startJob({uid: 'cancel-stream-user', run: () => new Promise(resolve => { release = resolve; })});
  const messages = [];
  subscribeJob(id, 'cancel-stream-user', event => messages.push(event));
  cancelJob(id, 'cancel-stream-user');
  assert.equal(messages.at(-1).job.status, 'error');
  assert.equal(messages.at(-1).job.events.at(-1).detail, 'ยกเลิกแล้ว');
  const count = messages.length;
  release({project: {id: 'late-result'}});
  await wait(10);
  assert.equal(messages.length, count);
  assert.equal(getJob(id, 'cancel-stream-user').result, undefined);
});
