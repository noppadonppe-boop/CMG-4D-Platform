import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReinforcement,reinforcementOwner} from '../src/reinforcementOwnership.mjs';
import {reinforcementFor} from '../src/geometry.mjs';
const host={id:'F',category:'footing',position:[0,0,0],size:[2,2,.6],material:'concrete'},bar={id:'R',category:'rebar',position:[0,0,-.2],size:[1.8,.02,.02],barDiameter:.02};
test('host owns bars once, source records preserved and activity links remapped',()=>{
 const p={elements:[host,bar],activities:[{elementIds:['R','F']}]},n=normalizeReinforcement(p);
 assert.equal(n.elements.length,1);assert.equal(n.elements[0].barDiameter,.02);assert.deepEqual(n.activities[0].elementIds,['F']);assert.equal(JSON.parse(n.elements[0].properties.reinforcementSourceBars)[0].id,'R');assert.equal(p.elements.length,2);assert.equal(normalizeReinforcement(n),n);assert.deepEqual(reinforcementFor(bar,p.elements),[]);
});
test('standalone and explicitly modeled reinforcement remain available',()=>{
 assert.equal(reinforcementOwner({...bar,position:[4,0,0]},[host]),undefined);
 assert.equal(reinforcementOwner({...bar,properties:{reinforcementMode:'standalone'}},[host]),undefined);
 const explicit={...host,properties:{reinforcementMode:'explicit'}};assert.equal(reinforcementOwner(bar,[explicit]),undefined);assert.deepEqual(reinforcementFor(explicit,[explicit,bar]),[]);
});
test('ownership accounts for rotated hosts and does not absorb crossing bars',()=>{
 const beam={...host,category:'beam',size:[4,.3,.5],rotation:90};assert.equal(reinforcementOwner({...bar,position:[0,0,0],rotation:90},[beam])?.id,'F');assert.equal(reinforcementOwner({...bar,position:[0,0,0]},[beam]),undefined);
});
test('upper-storey columns do not hook or stretch to a remote footing',()=>{
 const column={id:'C',category:'column',position:[0,0,4.5],size:[.4,.4,3]};const rods=reinforcementFor(column,[host,column]).filter(r=>r.kind==='longitudinal');assert.equal(rods.length,4);assert.ok(rods.every(r=>r.path.length===2&&r.path.every(p=>Math.abs(p[2])<=1.5)));
});
test('beam bars are inside surrounding links and obey specified row counts',()=>{
 const beam={id:'B',category:'beam',position:[0,0,3],size:[4,.4,.6],properties:{topBarCount:'3',bottomBarCount:'4',stirrupDiameter:'.01',endStirrupSpacing:'.1',endZoneLength:'.5'}};
 const rods=reinforcementFor(beam),long=rods.filter(r=>r.kind==='longitudinal'),ties=rods.filter(r=>r.kind==='stirrup');assert.equal(long.filter(r=>r.layer==='top').length,3);assert.equal(long.filter(r=>r.layer==='bottom').length,4);
 const tieY=Math.max(...ties[0].path.map(p=>Math.abs(p[1]))),tieZ=Math.max(...ties[0].path.map(p=>Math.abs(p[2])));assert.ok(long.every(r=>Math.abs(r.path[0][1])+r.diameter/2<tieY-.005&&Math.abs(r.path[0][2])+r.diameter/2<tieZ-.005));
 assert.ok(ties.length>20);
});
