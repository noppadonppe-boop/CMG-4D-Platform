import test from 'node:test';
import assert from 'node:assert/strict';
import {reinforcementFor} from '../src/geometry.mjs';
import {rebarTubeGeometry} from '../src/rebarGeometry.mjs';

const footing={id:'F',category:'footing',position:[0,0,0],size:[2,2,.6],barDiameter:.016,barSpacing:.15,cover:.075};
// Closest distance of finite segments, including parallel/degenerate cases.
function distance(a,b,c,d){
 const sub=(x,y)=>x.map((v,i)=>v-y[i]),dot=(x,y)=>x.reduce((s,v,i)=>s+v*y[i],0),u=sub(b,a),v=sub(d,c),w=sub(a,c),A=dot(u,u),B=dot(u,v),C=dot(v,v),D=dot(u,w),E=dot(v,w),den=A*C-B*B;
 let s=den>1e-18?Math.max(0,Math.min(1,(B*E-C*D)/den)):0,t=C?(B*s+E)/C:0;
 if(t<0){t=0;s=A?Math.max(0,Math.min(1,-D/A)):0;}else if(t>1){t=1;s=A?Math.max(0,Math.min(1,(B-D)/A)):0;}
 return Math.hypot(...w.map((x,i)=>x+s*u[i]-t*v[i]));
}
test('basket has continuous upturned bars and no invented upper mat or intersecting steel',()=>{
 const rods=reinforcementFor(footing);
 assert.ok(rods.length>10);assert.ok(rods.every(r=>r.layer==='bottom'&&r.path.length>20));
 for(const r of rods){assert.ok(r.path[0][2]>0&&r.path.at(-1)[2]>0);assert.ok(Math.min(...r.path.map(p=>p[2]))<0);}
 for(let i=0;i<rods.length;i++)for(let j=i+1;j<rods.length;j++){
  const a=rods[i],b=rods[j];let closest=Infinity;
  for(let x=1;x<a.path.length;x++)for(let y=1;y<b.path.length;y++)closest=Math.min(closest,distance(a.path[x-1],a.path[x],b.path[y-1],b.path[y]));
  assert.ok(closest>=(a.diameter+b.diameter)*.545-1e-6,`bars ${i}/${j} collide including ribs: ${closest}`);
 }
});
test('column starters clear footing mats and surrounding ties in reference assembly',()=>{
 const column={id:'C',category:'column',position:[0,0,.85],size:[.3,.3,1.5],barDiameter:.016,barSpacing:.15,cover:.04};
 const base=reinforcementFor(footing),cage=reinforcementFor(column,[footing,column]).map(r=>({...r,path:r.path.map(p=>p.map((v,i)=>v+column.position[i]))}));
 for(const a of cage.filter(r=>r.kind==='longitudinal'))for(const b of [...base,...cage.filter(r=>r.kind==='stirrup')]){
  const bp=b.closed?[...b.path,b.path[0]]:b.path;let closest=Infinity;
  for(let x=1;x<a.path.length;x++)for(let y=1;y<bp.length;y++)closest=Math.min(closest,distance(a.path[x-1],a.path[x],bp[y-1],bp[y]));
  assert.ok(closest>=(a.diameter+b.diameter)*.545-1e-6,`starter intersects ${b.kind}: ${closest}`);
 }
});
test('upper mat is opt-in, and standalone footing cages share basket geometry',()=>{
 assert.ok(reinforcementFor({...footing,properties:{rebarLayers:'top-bottom'}}).some(r=>r.layer==='top'));
 assert.deepEqual(reinforcementFor({...footing,category:'rebar',properties:{visualizationRole:'footing-cage'}}),reinforcementFor(footing));
});
test('rendered bent steel stays inside cover and texture spacing follows length',()=>{
 for(const rod of reinforcementFor(footing)){
  const g=rebarTubeGeometry(rod);g.computeBoundingBox();
  for(const axis of ['x','y','z']){const index={x:0,y:1,z:2}[axis],bound=footing.size[index]/2-footing.cover;assert.ok(g.boundingBox.max[axis]<=bound+.001);assert.ok(g.boundingBox.min[axis]>=-bound-.001);}
  assert.ok(Array.from(g.attributes.uv.array).some(v=>v>100));g.dispose();
 }
});
