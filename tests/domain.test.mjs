import test from 'node:test';
import assert from 'node:assert/strict';
import {demoProject,validateProject,validateElement,activityState,dayNumber,linkedActivities,elementState} from '../src/domain.mjs';
test('demo model has unique IDs and valid dimensions',()=>{const p=demoProject();assert.ok(validateProject(p));assert.equal(p.elements.filter(e=>e.category==='footing').length,4);assert.equal(new Set(p.elements.map(e=>e.id)).size,p.elements.length)});
test('4D boundaries are inclusive calendar dates',()=>{const a={start:'2026-11-01',end:'2026-11-15'};assert.equal(activityState(a,'2026-10-31'),'future');assert.equal(activityState(a,'2026-11-01'),'active');assert.equal(activityState(a,'2026-11-15'),'active');assert.equal(activityState(a,'2026-11-16'),'done');assert.equal(dayNumber('2027-01-01')-dayNumber('2026-12-31'),1)});
test('reject invalid geometry and duplicate IDs in imports',()=>{const p=demoProject();const e=p.elements[0];assert.equal(validateElement({...e,size:[0,2,.6]}),false);assert.equal(validateElement({...e,position:[NaN,0,0]}),false);assert.equal(validateProject({...p,elements:[e,e]}),false)});
test('reject reversed schedule dates',()=>{const p=demoProject();p.activities[0].end='2026-10-01';assert.equal(validateProject(p),false)});
test('project JSON round trip keeps model and schedule',()=>{const p=demoProject();p.elements[0].size=[2.5,2,.6];const imported=JSON.parse(JSON.stringify(p));assert.ok(validateProject(imported));assert.deepEqual(imported.elements[0].size,[2.5,2,.6]);assert.deepEqual(imported.activities,p.activities)});

test('reject impossible calendar dates',()=>{const p=demoProject();p.activities[0].start='2026-02-31';assert.equal(validateProject(p),false)});
test('explicit links override category defaults and can leave a task unlinked',()=>{
 const p=demoProject(),e=p.elements[0];const a={...p.activities[0],elementIds:[]};
 assert.equal(linkedActivities([a],e).length,0);
 assert.equal(linkedActivities([{...a,categories:[],elementIds:[e.id]}],e).length,1);
 assert.equal(linkedActivities(p.activities,e).length,1);
});
test('multiple tasks do not mark a member complete before its final task',()=>{
 const e=demoProject().elements[0];const a=[{id:'pour',name:'pour',start:'2026-11-01',end:'2026-11-03',categories:[],elementIds:[e.id]},{id:'cure',name:'cure',start:'2026-11-06',end:'2026-11-10',categories:[],elementIds:[e.id]}];
 assert.equal(elementState(a,e,'2026-11-02'),'active');assert.equal(elementState(a,e,'2026-11-04'),'future');
 assert.equal(elementState(a,e,'2026-11-10'),'active');assert.equal(elementState(a,e,'2026-11-11'),'done');
 assert.equal(elementState([],e,'2026-11-11'),'none');
});
test('import rejects dangling, repeated or invalid element links',()=>{
 const p=demoProject();p.activities[0].elementIds=['missing'];assert.equal(validateProject(p),false);
 p.activities[0].elementIds=[p.elements[0].id,p.elements[0].id];assert.equal(validateProject(p),false);
 p.activities[0].elementIds=[null];assert.equal(validateProject(p),false);
 p.activities[0].elementIds=[p.elements[0].id];assert.equal(validateProject(p),true);
});
