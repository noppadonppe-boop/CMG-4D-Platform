const hosts=new Set(['footing','column','pedestal','beam','gradeBeam','slab','shearWall','retainingWall']);
export function reinforcementOwner(bar,elements){
 if(bar.category!=='rebar'||bar.properties?.reinforcementMode==='standalone')return undefined;
 const candidates=elements.filter(e=>hosts.has(e.category)&&e.properties?.reinforcementMode!=='explicit'&&!/steel|เหล็กรูปพรรณ/i.test(e.material||''));
 const id=bar.properties?.reinforcementHostId;
 if(id)return candidates.find(e=>e.id===id);
 // Containment in the host's local coordinates; proximity alone is insufficient.
 return candidates.filter(e=>{
  const a=-(e.rotation||0)*Math.PI/180,dx=bar.position[0]-e.position[0],dy=bar.position[1]-e.position[1];
  const p=[dx*Math.cos(a)-dy*Math.sin(a),dx*Math.sin(a)+dy*Math.cos(a),bar.position[2]-e.position[2]];
  const relative=((bar.rotation||0)-(e.rotation||0))*Math.PI/180,c=Math.abs(Math.cos(relative)),s=Math.abs(Math.sin(relative));
  const size=[bar.size[0]*c+bar.size[1]*s,bar.size[0]*s+bar.size[1]*c,bar.size[2]];
  return p.every((v,i)=>Math.abs(v)+size[i]/2<=e.size[i]/2+.025);
 }).sort((a,b)=>a.size.reduce((x,y)=>x*y,1)-b.size.reduce((x,y)=>x*y,1))[0];
}
export function normalizeReinforcement(project){
 const remap=new Map();
 for(const e of project.elements){const host=reinforcementOwner(e,project.elements);if(host)remap.set(e.id,host.id);}
 if(!remap.size)return project;
 const elements=project.elements.filter(e=>!remap.has(e.id)).map(e=>{
  const sourceBars=project.elements.filter(b=>remap.get(b.id)===e.id);
  if(!sourceBars.length)return e;
  const main=sourceBars.filter(b=>!(/stirrup|tie|ปลอก/i.test((b.name||'')+' '+(b.properties?.visualizationRole||''))));
  const diameters=[...new Set(main.map(b=>b.barDiameter??Math.min(...b.size)).filter(v=>v>0&&v<.1))];
  return {...e,...(!e.barDiameter&&diameters.length===1?{barDiameter:diameters[0]}:{}),properties:{...e.properties,reinforcementMode:'host',reinforcementSourceBars:JSON.stringify(sourceBars)}};
 });
 return {...project,elements,activities:(project.activities||[]).map(a=>a.elementIds?{...a,elementIds:[...new Set(a.elementIds.map(id=>remap.get(id)||id))]}:a)};
}
