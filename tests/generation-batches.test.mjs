import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleGenerationBatches,parseGenerationBatch} from '../server/generationBatches.mjs';
import {parseModel} from '../server/ai.mjs';
import {demoProject} from '../src/domain.mjs';
const elements=demoProject().elements;
const batch=(index,parts,extra={})=>({index,json:JSON.stringify({elements:parts,...extra})});
test('batches assemble in order and pass full model parsing without repeating geometry',()=>{
 const model=assembleGenerationBatches([batch(1,elements.slice(5)),batch(0,elements.slice(0,5),{description:'two batches',name:'Batch model'})]);
 const parsed=parseModel(JSON.stringify(model));
 assert.equal(parsed.project.elements.length,elements.length);
 assert.deepEqual(parsed.project.elements.map(e=>e.id),elements.map(e=>e.id));
 assert.equal(parsed.project.name,'Batch model');
});
test('batch limits, missing indexes and duplicate IDs fail explicitly',()=>{
 assert.throws(()=>parseGenerationBatch(JSON.stringify({elements:Array.from({length:3001},(_,i)=>({...elements[0],id:String(i)}))})),/3000|ใหญ่เกิน/);
 assert.throws(()=>assembleGenerationBatches([batch(1,[elements[0]])]),/ต่อเนื่อง/);
 assert.throws(()=>assembleGenerationBatches([batch(0,[elements[0]]),batch(1,[elements[0]])]),/ซ้ำข้ามชุด/);
});

test('optional presentation metadata is filled without inventing geometry',()=>{
 const parsed=parseGenerationBatch(JSON.stringify({elements:[{id:'S1',category:'scaffold',position:[1,2,3],size:[.05,.05,2],properties:{count:4}}]}));
 assert.equal(parsed.elements[0].revision,1);assert.equal(parsed.elements[0].properties.count,'4');
 assert.deepEqual(parsed.elements[0].position,[1,2,3]);
 assert.throws(()=>parseGenerationBatch(JSON.stringify({elements:[{id:'BAD',category:'scaffold',position:[0,0,0]}]})),/BAD.*size/);
 assert.equal(parseGenerationBatch(JSON.stringify({elements:Array.from({length:150},(_,i)=>({...elements[0],id:String(i)}))})).elements.length,150);
});
test('activity links can span batches and validate when assembled',()=>{
 const activity={id:'test',name:'schedule',start:'2026-10-01',end:'2026-10-02',categories:[],elementIds:[elements[1].id]};
 const model=assembleGenerationBatches([batch(0,[elements[0]],{activities:[activity]}),batch(1,[elements[1]])]);
 assert.equal(parseModel(JSON.stringify(model)).project.activities[0].elementIds[0],elements[1].id);
 const invalid=assembleGenerationBatches([batch(0,[elements[0]],{activities:[activity]})]);
 assert.throws(()=>parseModel(JSON.stringify(invalid)),/ไม่ผ่าน/);
});
