import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject, validateProject} from '../src/domain.mjs';
import {buildEditContext, resolveEditTargets, applyEditPatch, validateEditPatch, MAX_EDIT_TARGETS, MAX_EDIT_CONTEXT, MAX_EDIT_OPERATIONS} from '../src/modelEdit.mjs';
import {providerRequest, editModel, parseEditModel} from '../server/ai.mjs';
import {validateEditRequest} from '../server/api.mjs';

const member = (id, category, position = [0, 0, 1.5], extra = {}) => ({id, category, name: id, position, size: [1, 1, 3], zone: 'ชั้น 2', material: 'คอนกรีต', source: 'plan.pdf p2', revision: 1, confidence: 'shown', ...extra});
const building = () => ({...blankProject('ตึก 5 ชั้น'), id: 'building', description: 'อาคารเดิม', elements: [
  member('STAIR-L2-01', 'stairs', [0, 0, 4.5], {name: 'บันไดชั้น 2', size: [1.2, 4, 3], steps: 20}),
  member('LANDING-L2', 'slab', [0, 2.5, 6], {size: [3, 1, .2]}),
  member('STAIR-L3-01', 'stairs', [30, 0, 7.5], {name: 'บันไดชั้น 3', zone: 'ชั้น 3', steps: 20}),
  ...Array.from({length: 500}, (_, i) => member('FAR-' + i, 'column', [50 + i * 3, 0, 1.5], {zone: 'ชั้น 1'})),
], activities: [{id: 'schedule', name: 'งานบันได', start: '2026-10-10', end: '2026-10-20', categories: ['stairs'], elementIds: ['STAIR-L2-01']}], documents: [{id: 'drawing', name: 'plan.pdf', type: 'application/pdf', size: 100}]});
const contextFor = project => buildEditContext(project, {prompt: 'แก้บันไดชั้น 2'});
const patch = changes => ({updates: [{id: 'STAIR-L2-01', changes}], adds: [], removes: [], notes: ['แก้เฉพาะบันได']});
const settings = context => ({provider: 'openai', model: 'gpt-6.1-sol', effort: 'medium', prompt: 'เพิ่มความกว้างบันไดเป็น 1.5 m', context, apiKey: 'test-only', history: []});

test('five-floor edits send the stair and local context, excluding other floors, source files and timeline', () => {
  const project = building(), context = contextFor(project);
  assert.deepEqual(context.targetIds, ['STAIR-L2-01']);
  assert.deepEqual(context.elements.map(element => element.id), ['STAIR-L2-01', 'LANDING-L2']);
  assert.equal(context.summary.totalElements, 503);
  assert.ok(!JSON.stringify(context).includes('FAR-') && !JSON.stringify(context).includes('activities') && !JSON.stringify(context).includes('documents'));
  assert.ok(JSON.stringify(context).length < JSON.stringify(project).length / 20);
  assert.deepEqual(resolveEditTargets(project, {prompt: 'แก้บันไดชั้น ๒'}).map(element => element.id), ['STAIR-L2-01']);
});

test('explicit ID overrides an unrelated selection; ambiguous targets and unknown floors need a selection', () => {
  const project = building();
  assert.deepEqual(resolveEditTargets(project, {prompt: 'แก้ STAIR-L2-01', selectedId: 'FAR-1'}).map(element => element.id), ['STAIR-L2-01']);
  assert.throws(() => resolveEditTargets(project, {prompt: 'แก้บันได', selectedId: 'FAR-1'}), /หลายชิ้น/);
  assert.throws(() => resolveEditTargets(project, {prompt: 'แก้บันไดชั้น 9', selectedId: 'FAR-1'}), /ไม่พบ/);
  assert.throws(() => resolveEditTargets(project, {prompt: 'ย้าย D-999', selectedId: 'FAR-1'}), /ไม่พบ ID/);
  assert.deepEqual(resolveEditTargets(project, {prompt: 'เพิ่มความกว้าง', selectedId: 'STAIR-L2-01', scope: 'selected'}).map(element => element.id), ['STAIR-L2-01']);
  assert.throws(() => resolveEditTargets(project, {prompt: 'เปลี่ยนขนาด', scope: 'selected'}), /เลือก/);
});

test('apply a patch to the latest model while preserving unrelated manual edits, IDs, files, chat and schedule', () => {
  const project = building(), context = contextFor(project), live = structuredClone(project);
  live.elements.at(-1).material = 'เหล็ก'; live.elements.at(-1).revision++;
  live.chatHistory = [{role: 'user', text: 'ล่าสุด'}];
  const original = JSON.stringify(live), next = applyEditPatch(live, patch({size: [1.5, 4, 3], steps: 24}), context);
  assert.equal(next.elements[0].size[0], 1.5); assert.equal(next.elements[0].steps, 24); assert.equal(next.elements[0].revision, 2);
  assert.deepEqual(next.elements.slice(1), live.elements.slice(1));
  assert.equal(next.elements.at(-1), live.elements.at(-1));
  for (const field of ['id', 'activities', 'documents', 'chatHistory', 'description']) assert.deepEqual(next[field], live[field]);
  assert.equal(JSON.stringify(live), original); assert.ok(validateProject(next));
});

test('stale target and stale neighboring levels fail without overwriting anything', () => {
  const project = building(), context = contextFor(project);
  for (const index of [0, 1]) {
    const live = structuredClone(project); live.elements[index].revision++;
    assert.throws(() => applyEditPatch(live, patch({steps: 22}), context), /ระหว่างรอ AI/);
  }
  assert.throws(() => applyEditPatch({...project, id: 'another'}, patch({steps: 22}), context), /โครงการอื่น/);
});

test('patch rejects a full project, edits to read-only neighbors, duplicate operations and invalid geometry', () => {
  const project = building(), context = contextFor(project);
  assert.throws(() => parseEditModel(JSON.stringify(project), context), /ไม่ใช่โมเดลทั้งชุด/);
  assert.throws(() => validateEditPatch({...patch({steps: 22}), updates: [{id: 'LANDING-L2', changes: {material: 'เหล็ก'}}]}, context), /นอกขอบเขต/);
  assert.throws(() => validateEditPatch({...patch({steps: 22}), removes: ['STAIR-L2-01']}, context), /ID ซ้ำ/);
  assert.throws(() => validateEditPatch(patch({size: [-1, 4, 3]}), context), /ขนาด/);
  assert.throws(() => validateEditPatch(patch({revision: 999}), context), /ฟิลด์/);
});

const hostedProject = () => ({...blankProject(), id: 'hosted', elements: [
  member('W1', 'wall', [0, 0, 1.5], {size: [6, .2, 3]}),
  member('D1', 'door', [2, 0, 1], {size: [1, .2, 2], hostId: 'W1'}),
  member('W-FAR', 'wall', [30, 0, 1.5], {size: [6, .2, 3]}),
], activities: [{id: 'a', name: 'door', start: '2026-10-10', end: '2026-10-11', categories: [], elementIds: ['W1', 'D1', 'W-FAR']}]});
const hostContext = project => buildEditContext(project, {prompt: 'ย้าย W1'});
test('wall movement propagates to its door; removing a wall removes dependent openings and cleans schedule links', () => {
  const project = hostedProject(), context = hostContext(project);
  assert.deepEqual(context.elements.map(element => element.id), ['W1', 'D1']);
  const next = applyEditPatch(project, {updates: [{id: 'W1', changes: {position: [10, 5, 1.5], rotation: 90}}], adds: [], removes: [], notes: []}, context);
  assert.ok(Math.abs(next.elements[1].position[0] - 10) < 1e-9); assert.equal(next.elements[1].position[1], 7); assert.equal(next.elements[1].rotation, 90);
  const removed = applyEditPatch(project, {updates: [], adds: [], removes: ['W1'], notes: []}, context);
  assert.deepEqual(removed.elements.map(element => element.id), ['W-FAR']);
  assert.deepEqual(removed.activities[0].elementIds, ['W-FAR']);
});

test('atomic host and opening resize validates the final patch; a new opening added during the job blocks application', () => {
  const project = hostedProject(), context = buildEditContext(project, {prompt: 'แก้ W1 และ D1'});
  const next = applyEditPatch(project, {updates: [{id: 'W1', changes: {size: [3, .2, 3]}}, {id: 'D1', changes: {position: [0, 0, 1]}}], adds: [], removes: [], notes: []}, context);
  assert.equal(next.elements[0].size[0], 3); assert.equal(next.elements[1].position[0], 0);
  const live = {...project, elements: [...project.elements, member('D2', 'door', [-2, 0, 1], {size: [1, .2, 2], hostId: 'W1'})]};
  assert.throws(() => applyEditPatch(live, {updates: [], adds: [], removes: ['W1'], notes: []}, hostContext(project)), /เพิ่มขึ้น/);
});

test('full-model validation detects a conflict outside the local snapshot and permits unchanged pre-existing overlaps', () => {
  const project = building(), context = contextFor(project);
  assert.throws(() => applyEditPatch(project, patch({position: [30, 0, 7.5]}), context), /ซ้อนทับ/);
  const overlapping = {...project, elements: [...project.elements, {...project.elements[0], id: 'existing-overlap'}]};
  const local = buildEditContext(overlapping, {prompt: 'แก้ STAIR-L2-01'});
  assert.doesNotThrow(() => applyEditPatch(overlapping, patch({material: 'เหล็ก'}), local));
});

test('local additions allow a new component, reject remote additions and reject IDs already present in the full model', () => {
  const project = building(), context = contextFor(project), added = member('RAIL-L2', 'railing', [1, 0, 4.5], {size: [.1, 4, 1]});
  const addition = {updates: [], adds: [added], removes: [], notes: []};
  const next = applyEditPatch(project, addition, context); assert.equal(next.elements.at(-1).id, 'RAIL-L2');
  assert.throws(() => applyEditPatch(project, {...addition, adds: [{...added, id: 'FAR-1'}]}, context), /ID/);
  assert.throws(() => validateEditPatch({...addition, adds: [{...added, position: [100, 0, 0]}]}, context), /นอกพื้นที่/);
});

test('complete replacement returned as an add updates the selected element and repeated callouts get unique IDs', () => {
  const project = building(), context = contextFor(project);
  const replacement = member('STAIR-L2-01', 'stairs', [0, 0, 4.5], {size: [1.5, 4, 3], steps: 24, material: 'เหล็ก'});
  const callout = member('RAIL-L2', 'railing', [1, 0, 4.5], {size: [.1, .5, 1]});
  const next = applyEditPatch(project, {
    updates: [],
    adds: [replacement, callout, {...callout, position: [1, 1, 4.5]}],
    removes: [],
    notes: [],
  }, context);
  assert.equal(next.elements.find(element => element.id === 'STAIR-L2-01').size[0], 1.5);
  assert.equal(next.elements.find(element => element.id === 'STAIR-L2-01').revision, 2);
  assert.ok(next.elements.some(element => element.id === 'RAIL-L2'));
  assert.ok(next.elements.some(element => element.id === 'RAIL-L2-2'));
  assert.equal(new Set(next.elements.map(element => element.id)).size, next.elements.length);
});

test('all three providers use the patch contract and local context, without sending original drawings', () => {
  const context = contextFor(building());
  for (const [provider, model] of [['openai', 'gpt-6.1-sol'], ['anthropic', 'claude-sonnet-5-5'], ['google', 'gemini-3.8-flash']]) {
    const request = providerRequest({...settings(context), provider, model, mode: 'edit', files: [{name: 'ORIGINAL.pdf', kind: 'pdf', data: 'YWJj', mime: 'application/pdf'}]});
    const body = JSON.stringify(request.body);
    assert.ok(body.includes('targetIds')); assert.ok(body.includes('read-only')); assert.ok(!body.includes('ORIGINAL.pdf')); assert.ok(!body.includes('FAR-1')); assert.ok(!body.includes('Reconstruct the attached'));
    assert.equal(request.body.max_output_tokens || request.body.max_tokens || request.body.generationConfig.maxOutputTokens, 8000);
  }
});

test('edit request rejects full-model files, mismatched project IDs and oversized history', () => {
  const request = {...settings(contextFor(building())), projectId: 'building'};
  assert.doesNotThrow(() => validateEditRequest(request));
  for (const change of [{files: []}, {projectId: 'another'}, {history: Array.from({length: 7}, () => ({role: 'user', text: 'hi'}))}]) assert.throws(() => validateEditRequest({...request, ...change}));
  assert.throws(() => validateEditRequest({...request, context: {...request.context, activities: building().activities}}), /เฉพาะ/);
});

test('edit generation returns a patch and a bounded corrective pass keeps the edit contract', async () => {
  const context = contextFor(building()), payloads = [];
  const result = await editModel(settings(context), undefined, async (_url, request) => {
    payloads.push(JSON.parse(request.body));
    const response = payloads.length === 1 ? {...patch({steps: 22}), updates: [{id: 'LANDING-L2', changes: {material: 'wood'}}]} : patch({steps: 22});
    return {ok: true, json: async () => ({output: [{content: [{type: 'output_text', text: JSON.stringify(response)}]}]})};
  });
  assert.equal(result.mode, 'edit'); assert.equal(result.project, undefined); assert.equal(result.patch.updates[0].id, 'STAIR-L2-01');
  assert.equal(payloads.length, 2); assert.match(payloads[1].input.at(-1).content[0].text, /PATCH/); assert.ok(!JSON.stringify(payloads).includes('FAR-1'));
});

const stairGroup = () => ({...blankProject('บันไดหลายชั้น'), id: 'stair-group', elements: [
  ...Array.from({length: 30}, (_, index) => member(index === 0 ? 'ST6' : index % 3 === 0 ? `ST6-${index + 1}` : `FLIGHT-${index + 1}`, 'stairs', [0, 0, 1.5 + index * 3], {
    name: index % 3 === 1 ? `บันได ST6 ชั้น ${index + 1}` : `เที่ยวบันได ${index + 1}`,
    zone: `ชั้น ${index + 1}`, size: [1.2, 4, 3], steps: 20,
    ...(index % 3 === 2 ? {properties: {StairType: 'ST6'}} : {}),
  })),
  member('ST7-01', 'stairs', [40, 0, 1.5], {name: 'บันได ST7'}),
  member('ST60-01', 'stairs', [50, 0, 1.5], {name: 'บันได ST60'}),
  member('SLAB-ST6', 'slab', [0, 2.5, 90], {size: [1.2, 1, .2]}),
  ...Array.from({length: 200}, (_, index) => member(`REMOTE-${index}`, 'column', [100 + index * 3, 0, 1.5])),
]});
const groupPrompt = 'บันได ST6 ทั้งหมดยังไม่เชื่อมถึงกันเลย ช่วงชั้นกลางไม่มีพื้นเชื่อมกัน';

test('the reported ST6 command selects all 30 family members without selecting ST7, ST60 or every stair', () => {
  const project = stairGroup(), context = buildEditContext(project, {prompt: groupPrompt});
  assert.equal(context.targetIds.length, 30);
  assert.deepEqual(context.targetIds, project.elements.slice(0, 30).map(element => element.id));
  assert.ok(!context.targetIds.includes('ST7-01') && !context.targetIds.includes('ST60-01') && !context.targetIds.includes('SLAB-ST6'));
  assert.ok(context.elements.some(element => element.id === 'SLAB-ST6'));
  assert.ok(!JSON.stringify(context).includes('REMOTE-'));
  assert.doesNotThrow(() => validateEditRequest({...settings(context), projectId: project.id, prompt: groupPrompt}));
  assert.throws(() => resolveEditTargets({...project, elements: project.elements.filter(element => element.id !== 'ST6')}, {prompt: 'แก้บันได ST6'}), /หลายชิ้น/);
  assert.throws(() => resolveEditTargets(project, {prompt: 'แก้บันได ST99 ทั้งหมด', selectedId: 'ST6'}), /ST99/);
  assert.deepEqual(resolveEditTargets(project, {prompt: 'แก้บันได ST6 ทั้งหมดเฉพาะชั้น 2'}).map(element => element.id), ['FLIGHT-2']);
  assert.deepEqual(resolveEditTargets(project, {prompt: 'แก้ ST6'}).map(element => element.id), ['ST6']);
});

test('a single group patch can update 30 stairs and add 29 intermediate landings without replacing other groups', () => {
  const project = stairGroup(), context = buildEditContext(project, {prompt: groupPrompt});
  const patch = {
    updates: context.targetIds.map(id => ({id, changes: {steps: 24}})),
    adds: Array.from({length: 29}, (_, index) => member(`LANDING-ST6-${index + 1}`, 'slab', [0, 2.5, (index + 1) * 3], {size: [1.2, 1, .2]})),
    removes: [], notes: ['เพิ่มชานพักเชื่อมระหว่างช่วงบันได'],
  };
  const result = parseEditModel(JSON.stringify(patch), context);
  const next = applyEditPatch(project, result.patch, context);
  assert.equal(next.elements.length, project.elements.length + 29);
  assert.ok(next.elements.slice(0, 30).every(element => element.steps === 24 && element.revision === 2));
  assert.deepEqual(next.elements.slice(30, project.elements.length), project.elements.slice(30));
});

test('all providers allocate enough output for a 30-member group and OpenAI expands it on truncation', async () => {
  const context = buildEditContext(stairGroup(), {prompt: groupPrompt});
  for (const [provider, model] of [['openai', 'gpt-6.1-sol'], ['anthropic', 'claude-sonnet-5-5'], ['google', 'gemini-3.8-flash']]) {
    const {body} = providerRequest({...settings(context), provider, model, mode: 'edit', prompt: groupPrompt});
    assert.equal(body.max_output_tokens || body.max_tokens || body.generationConfig.maxOutputTokens, 16000);
  }
  const payloads = [];
  await editModel({...settings(context), prompt: groupPrompt}, undefined, async (_url, request) => {
    payloads.push(JSON.parse(request.body));
    return {ok: true, json: async () => payloads.length === 1 ? {status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}} : {output: [{content: [{type: 'output_text', text: JSON.stringify({updates: [], adds: [], removes: [], notes: []})}]}]}};
  });
  assert.deepEqual(payloads.map(payload => payload.max_output_tokens), [16000, 32000]);
});

test('group editing keeps explicit bounds for oversized targets, context and patches', () => {
  const project = stairGroup();
  project.elements = Array.from({length: MAX_EDIT_TARGETS + 1}, (_, index) => member(`ST6-${index}`, 'stairs', [0, 0, index * 4 + 1.5]));
  assert.throws(() => buildEditContext(project, {prompt: groupPrompt}), new RegExp(`ไม่เกิน ${MAX_EDIT_TARGETS}`));
  const context = contextFor(building());
  assert.throws(() => validateEditRequest({...settings(context), projectId: 'building', context: {...context, elements: Array.from({length: MAX_EDIT_CONTEXT + 1}, (_, index) => member(`EXTRA-${index}`, 'column'))}}), /ชิ้นส่วน/);
  assert.throws(() => validateEditPatch({updates: [], removes: [], adds: Array(MAX_EDIT_OPERATIONS + 1).fill(member('new', 'slab')), notes: []}, context), /ขอบเขต/);
});
