import {parseCustomGeometry} from './customGeometry.mjs';
import {bentBarPath} from './rebarGeometry.mjs';
import {reinforcementOwner} from './reinforcementOwnership.mjs';

export const defaults = {footing:[2,2,.6],pileCap:[2.5,2.5,.8],pedestal:[.6,.6,.8],pile:[.35,.35,6],gradeBeam:[5,.3,.5],column:[.35,.35,3],beam:[5,.3,.5],slab:[5,5,.15],shearWall:[5,.25,3],retainingWall:[5,.3,3],brace:[3,.12,.12],truss:[6,.12,1.2],rafter:[4,.08,.16],purlin:[6,.08,.12],joist:[5,.06,.2],roofDeck:[5,5,.12],ramp:[1.5,4,.2],rebar:[.016,.016,3],tendon:[.012,.012,5],anchorBolt:[.02,.02,.5],basePlate:[.3,.3,.02],embedPlate:[.2,.2,.012],connectionPlate:[.2,.2,.01],wall:[5,.2,3],partition:[5,.1,3],door:[.9,.2,2.1],window:[1.5,.2,1.2],curtainWall:[5,.2,3],cladding:[5,.05,3],louver:[3,.1,2],canopy:[2,4,.2],stairs:[1.2,4,3],elevator:[2,2,3],railing:[3,.06,1],roof:[6,6,.2],roofCovering:[5,5,.05],roofFlashing:[3,.05,.05],gutter:[5,.15,.1],floorFinish:[5,5,.03],wallFinish:[5,.02,3],ceiling:[5,5,.04],skirting:[5,.015,.1],casework:[1.2,.6,.9],duct:[1,.4,3],pipe:[.1,.1,3],conduit:[.03,.03,3],cableTray:[.2,.08,3],hvacEquipment:[1,1,1],electricalEquipment:[.8,.4,1.6],plumbingFixture:[.6,.5,.8],formwork:[2,2,.1],scaffold:[3,3,3],excavation:[3,3,1.5],customComponent:[.5,.5,.5]};
export const defaultMaterials = {footing:'คอนกรีต',pileCap:'คอนกรีต',pedestal:'คอนกรีต',pile:'คอนกรีต',gradeBeam:'คอนกรีต',column:'คอนกรีต',beam:'คอนกรีต',slab:'คอนกรีต',shearWall:'คอนกรีต',retainingWall:'คอนกรีต',brace:'เหล็ก',truss:'เหล็ก',rafter:'ไม้',purlin:'เหล็ก',joist:'ไม้',roofDeck:'เหล็ก',ramp:'คอนกรีต',rebar:'เหล็ก',tendon:'เหล็กอัดแรง',anchorBolt:'เหล็ก',basePlate:'เหล็ก',embedPlate:'เหล็ก',connectionPlate:'เหล็ก',wall:'ฉาบปูนสีเทา',partition:'ฉาบปูนสีเทา',door:'ตามแบบ',window:'อะลูมิเนียมและกระจก',curtainWall:'อะลูมิเนียมและกระจก',cladding:'ตามแบบ',louver:'ตามแบบ',canopy:'ตามแบบ',stairs:'คอนกรีต',elevator:'ตามแบบ',railing:'เหล็ก',roof:'ตามแบบ',roofCovering:'ตามแบบ',roofFlashing:'เหล็ก',gutter:'ตามแบบ',floorFinish:'ตามแบบ',wallFinish:'ฉาบปูนสีเทา',ceiling:'ตามแบบ',skirting:'ตามแบบ',casework:'ตามแบบ',duct:'เหล็กชุบสังกะสี',pipe:'ตามแบบ',conduit:'ตามแบบ',cableTray:'เหล็ก',hvacEquipment:'ตามแบบ',electricalEquipment:'ตามแบบ',plumbingFixture:'ตามแบบ',formwork:'ไม้แบบ',scaffold:'เหล็ก',excavation:'ดิน',customComponent:'ตามแบบ'};

function customPartsFor(e) {
 const geometry = parseCustomGeometry(e.properties.geometry), parts = [];
 const rotation = values => (values || [0,0,0]).map(value => value * Math.PI / 180);
 const addBox = (size, position, material, angles) => parts.push({size, position, material:material || e.material, rotation:rotation(angles)});
 for (const part of geometry.parts) {
  if (part.type === 'box') addBox(part.size, part.position, part.material, part.rotation);
  else if (part.type === 'cylinder') parts.push({size:[part.diameter,part.length,part.diameter],position:part.position,material:part.material||e.material,rotation:rotation(part.rotation),cylinder:true});
  else if (part.type === 'hollowSquareTube') {
   const {width,depth,length,wallThickness:t,position:[x,y,z],material,rotation:angles}=part;
   addBox([t,depth,length],[x-(width-t)/2,y,z],material,angles);
   addBox([t,depth,length],[x+(width-t)/2,y,z],material,angles);
   addBox([width-2*t,t,length],[x,y-(depth-t)/2,z],material,angles);
   addBox([width-2*t,t,length],[x,y+(depth-t)/2,z],material,angles);
  }
 }
 return parts;
}
const rebarRoleFor=e=>String(e?.properties?.visualizationRole||e?.properties?.rebarRole||'').trim().toLowerCase();
export function isBentRebarElement(e){
 if(e?.category!=='rebar')return false;
 const role=rebarRoleFor(e);
 if(['footing-mat','footing-cage','column-cage','starter-cage','footing-edge','column-longitudinal','column-stirrup','joint-stirrup','u-bar','l-hook'].includes(role))return true;
 const diameter=Number(e.barDiameter),[w,d,h]=e.size||[];
 // A rebar element that has an envelope much wider than its bar diameter is
 // usually a cage/group. Keep a slender [diameter,diameter,length] element as
 // one independent straight bar unless the source explicitly gives a role.
 return Number.isFinite(diameter)&&diameter>0&&Math.min(w||0,d||0)>=diameter*8&&Math.max(w||0,d||0)>=diameter*8&&h>diameter*4;
}
export function partsFor(e,elements=[]){
 const [w,d,h]=e.size, parts=[];
 const box=(size,position=[0,0,0],material=e.material,rotation=[0,0,0])=>parts.push({size,position,material,rotation});
 const frame=Math.min(.06,w/8,h/8);
 if(e.category==='curtainWall'){
  const mullion=Math.min(.06,w/20,h/20),panelWidth=Math.max(1,Math.round(w/1.5)),panelHeight=Math.max(1,Math.round(h/1.5)),rail=Math.min(.04,h/20);
  for(let i=0;i<=panelWidth;i++)box([mullion,d,h],[-w/2+i*w/panelWidth,0,0],'frame');
  for(let i=0;i<=panelHeight;i++)box([w,d,rail],[0,0,-h/2+i*h/panelHeight],'frame');
  for(let i=0;i<panelWidth;i++)for(let j=0;j<panelHeight;j++)box([Math.max(.01,w/panelWidth-mullion),Math.min(.02,d/5),Math.max(.01,h/panelHeight-rail)],[-w/2+(i+.5)*w/panelWidth,0,-h/2+(j+.5)*h/panelHeight],'glass');
 }else if(e.category==='louver'){
  const spacing=Math.max(.08,Math.min(.6,Number.parseFloat(e.properties?.slatSpacing)||.18)),slatHeight=Math.min(.05,h/10),support=Math.min(.05,w/10);
  for(let z=-h/2+slatHeight/2;z<=h/2;z+=spacing)box([w,d,slatHeight],[0,0,z]);
  for(const x of [-1,1])box([support,d,h],[x*(w-support)/2,0,0],'frame');
 }else if(e.category==='gutter'){
  const thickness=Math.min(.04,d/4,h/4);
  box([w,d,thickness],[0,0,-h/2+thickness/2]);
  for(const y of [-1,1])box([w,thickness,h],[0,y*(d-thickness)/2,0]);
 }else if(['wall','partition'].includes(e.category)){
  const angle=-(e.rotation||0)*Math.PI/180;
  const openings=elements.filter(x=>x.hostId===e.id&&['door','window'].includes(x.category)).map(x=>{const dx=x.position[0]-e.position[0],dy=x.position[1]-e.position[1],cx=dx*Math.cos(angle)-dy*Math.sin(angle),cz=x.position[2]-e.position[2];return {l:Math.max(-w/2,cx-x.size[0]/2),r:Math.min(w/2,cx+x.size[0]/2),b:Math.max(-h/2,cz-x.size[2]/2),t:Math.min(h/2,cz+x.size[2]/2)}}).filter(o=>o.r>o.l&&o.t>o.b);
  const xs=[...new Set([-w/2,w/2,...openings.flatMap(o=>[o.l,o.r])])].sort((a,b)=>a-b),zs=[...new Set([-h/2,h/2,...openings.flatMap(o=>[o.b,o.t])])].sort((a,b)=>a-b);
  for(let i=1;i<xs.length;i++)for(let j=1;j<zs.length;j++){const x=(xs[i]+xs[i-1])/2,z=(zs[j]+zs[j-1])/2;if(!openings.some(o=>x>o.l&&x<o.r&&z>o.b&&z<o.t))box([xs[i]-xs[i-1],d,zs[j]-zs[j-1]],[x,0,z]);}
 }else if(['door','window'].includes(e.category)){
  for(const x of [-1,1])box([frame,d,h],[x*(w-frame)/2,0,0],'frame');
  box([w-2*frame,d,frame],[0,0,(h-frame)/2],'frame');
  if(e.category==='window'){box([w-2*frame,d,frame],[0,0,-(h-frame)/2],'frame');box([frame,d,h-2*frame],[0,0,0],'frame');box([w-2*frame,Math.min(.015,d),h-2*frame],[0,0,0],'glass')}
  else {box([w-2*frame,Math.min(.04,d*.5),h-frame],[0,0,-frame/2]);box([.03,.07,.12],[w*.32,-d/2,0],'frame');}
 }else if(e.category==='truss'){
  const thickness=Math.min(d/3,h/12,.12),nodes=Math.max(2,Math.min(12,Math.round(w/1.5)));
  const member=(x1,z1,x2,z2)=>{const dx=x2-x1,dz=z2-z1;box([Math.hypot(dx,dz),d,thickness],[(x1+x2)/2,0,(z1+z2)/2],'frame',[0,-Math.atan2(dz,dx),0]);};
  const bottom=-h/2,topAt=x=>bottom+h*(1-Math.abs(x)/(w/2));
  member(-w/2,bottom,w/2,bottom);
  member(-w/2,bottom,0,h/2);member(0,h/2,w/2,bottom);
  for(let i=1;i<nodes;i++){const x=-w/2+w*i/nodes;member(x,bottom,x,topAt(x));}
  for(let i=0;i<nodes;i++){const x1=-w/2+w*i/nodes,x2=-w/2+w*(i+1)/nodes;member(x1,bottom,x2,topAt(x2));}
 }else if(e.category==='brace'){
  const thickness=Math.min(d/3,h/8,.16),length=Math.hypot(w,h),angle=Math.atan2(h,w);
  box([length,d,thickness],[0,0,0],'frame',[0,-angle,0]);box([length,d,thickness],[0,0,0],'frame',[0,angle,0]);
 }else if(e.category==='rafter'&&e.properties?.pitchDegrees){
  const pitch=Number.parseFloat(e.properties.pitchDegrees);
  box(e.size,[0,0,0],e.material,[0,Number.isFinite(pitch)?pitch*Math.PI/180:0,0]);
 }else if(e.category==='ramp'){
  const slopeLength=Math.hypot(d,h),thickness=Math.min(.2,h/5);
  box([w,slopeLength,thickness],[0,0,0],e.material,[Math.atan2(h,d),0,0]);
 }else if(e.category==='stairs'){
  const count=Math.max(2,Math.min(100,Math.round(e.steps||h/.17)));
  for(let i=0;i<count;i++)box([w,d/count,h/count],[0,-d/2+(i+.5)*d/count,-h/2+(i+.5)*h/count]);
  for(const side of [-1,1]){for(let i=0;i<=count;i+=Math.max(1,Math.floor(count/8)))box([.035,.035,1],[side*(w-.035)/2,-d/2+i*d/count,-h/2+i*h/count+.5],'frame');box([.04,Math.hypot(d,h),.04],[side*(w-.035)/2,0,1],'frame',[Math.atan2(h,d),0,0]);}
 }else if(e.category==='roof'&&e.roofStyle==='gable'){
  const angle=Math.atan2(h,w/2),length=Math.hypot(w/2,h);for(const side of [-1,1])box([length,d,.10],[side*w/4,0,0],e.material,[0,side*angle,0]);
 }else if(e.category==='elevator'){
  const t=Math.min(.08,w/10,d/10,h/10);box([w,d,t],[0,0,-(h-t)/2],'frame');box([w,d,t],[0,0,(h-t)/2],'frame');
  for(const x of [-1,1])box([t,d,h],[x*(w-t)/2,0,0],'glass');box([w,t,h],[0,(d-t)/2,0],'glass');
  for(const x of [-1,1])box([w/2-.02,t,h*.85],[x*w/4,-(d-t)/2,-h*.025],'frame');
 }else if(e.category==='railing'){
  box([w,d,.04],[0,0,(h-.04)/2],'frame');const n=Math.max(1,Math.ceil(w));for(let i=0;i<=n;i++)box([.04,d,h],[-w/2+i*w/n,0,0],'frame');
 }else if(e.category==='formwork'){
  const t=Math.min(.08,w/10,d/10);box([w,t,h],[0,-(d-t)/2,0],e.material||'ไม้แบบ');box([w,t,h],[0,(d-t)/2,0],e.material||'ไม้แบบ');box([t,d-2*t,h],[-(w-t)/2,0,0],e.material||'ไม้แบบ');box([t,d-2*t,h],[(w-t)/2,0,0],e.material||'ไม้แบบ');
 }else if(e.category==='scaffold'){
  const steel=e.material||'เหล็ก',longest=Math.max(...e.size),shortest=Math.min(...e.size),singlePipe=longest>=Math.max(4*shortest,.35)&&shortest<=.2;
  if(singlePipe){
   // AI often returns each standard/ledger as its own scaffold element.
   // A slender element is one pipe, not a miniature scaffold assembly.
   const axis=e.size.indexOf(longest),rotation=axis===0?[0,0,Math.PI/2]:axis===2?[Math.PI/2,0,0]:[0,0,0];
   parts.push({size:e.size,position:[0,0,0],rotation,material:steel,cylinder:true,radialSegments:24});
  }else{
   // A pipe scaffold is a set of frames around the work area. Keep the centre
   // open so it reads as scaffold bays instead of a dense rebar mesh.
   const post=Math.max(.06,Math.min(.1,Math.min(w,d)/28)),rail=Math.max(.045,post*.82),xBays=Math.max(1,Math.ceil(w/3.5)),yBays=Math.max(1,Math.ceil(d/3.5)),levels=Math.max(1,Math.ceil(h/1.8));
   const xs=Array.from({length:xBays+1},(_,i)=>-w/2+i*w/xBays),ys=Array.from({length:yBays+1},(_,i)=>-d/2+i*d/yBays);
   const tube=(length,diameter,position,rotation)=>parts.push({size:[diameter,length,diameter],position,rotation,material:steel,cylinder:true,radialSegments:24});
   const brace=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz),rotation=Math.abs(dx)>1e-6?[-Math.atan2(dz,dx),0,Math.PI/2]:[Math.atan2(dz,dy),0,0];tube(length,rail,a.map((value,i)=>(value+b[i])/2),rotation)};
   const framePosts=(x,y)=>{
    tube(h,post,[x,y,0],[Math.PI/2,0,0]);
    box([.2,.2,.035],[x,y,-h/2+.0175],steel);
   };
   for(const x of xs)for(const y of [ys[0],ys[ys.length-1]])framePosts(x,y);
   for(const y of ys.slice(1,-1))for(const x of [xs[0],xs[xs.length-1]])framePosts(x,y);
   for(let level=0;level<=levels;level++){
    const z=-h/2+level*h/levels;
    for(const y of [ys[0],ys[ys.length-1]])tube(w,rail,[0,y,z],[0,0,-Math.PI/2]);
    for(const x of [xs[0],xs[xs.length-1]])tube(d,rail,[x,0,z],[0,0,0]);
   }
   for(const y of [ys[0],ys[ys.length-1]])for(let bay=0;bay<xBays;bay+=2)for(let level=0;level<levels;level++){
    const x0=xs[bay],x1=xs[Math.min(bay+1,xs.length-1)],z0=-h/2+level*h/levels,z1=-h/2+(level+1)*h/levels;
    brace([x0,y,z0],[x1,y,z1]);brace([x0,y,z1],[x1,y,z0]);
   }
   for(const x of [xs[0],xs[xs.length-1]])for(let bay=0;bay<yBays;bay+=2)for(let level=0;level<levels;level++){
    const y0=ys[bay],y1=ys[Math.min(bay+1,ys.length-1)],z0=-h/2+level*h/levels,z1=-h/2+(level+1)*h/levels;
    brace([x,y0,z0],[x,y1,z1]);brace([x,y0,z1],[x,y1,z0]);
   }
  }
  }else if(e.category==='rebar'){
   // Path-based bent bars are rendered by Rebar below. Do not add a straight
   // cylinder here or the cage would be visually duplicated.
  }else if(['rebar','pile','tendon','pipe','conduit'].includes(e.category)){const axis=e.size.indexOf(Math.max(...e.size));parts.push({size:e.size,position:[0,0,0],material:e.material,rotation:axis===0?[0,0,Math.PI/2]:axis===2?[Math.PI/2,0,0]:[0,0,0],cylinder:true})}
 else if(e.category==='customComponent'&&e.properties?.geometry){try{parts.push(...customPartsFor(e))}catch{box(e.size)}}
 else box(e.size);
 return parts;
}
const defaultCover=category=>category==='footing'?.075:.04;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function pathRod(path,diameter,closed=false,kind='longitudinal',layer='single'){
 const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];
 for(const point of path)for(let axis=0;axis<3;axis++){mins[axis]=Math.min(mins[axis],point[axis]);maxs[axis]=Math.max(maxs[axis],point[axis]);}
 return {position:[0,0,0],size:maxs.map((value,axis)=>Math.max(diameter,value-mins[axis])),path,diameter,closed,kind,layer};
}
function roundedRectanglePath(width,depth,z,radius){
 const hw=width/2,hd=depth/2,r=Math.min(radius,hw,hd),corners=[{x:hw-r,y:hd-r,a:0},{x:-hw+r,y:hd-r,a:Math.PI/2},{x:-hw+r,y:-hd+r,a:Math.PI},{x:hw-r,y:-hd+r,a:Math.PI*1.5}],points=[];
 for(const corner of corners)for(let i=0;i<5;i++){const a=corner.a+i*Math.PI/8;points.push([corner.x+r*Math.cos(a),corner.y+r*Math.sin(a),z]);}
 return points;
}
function roundedRectangleYZPath(depth,height,x,radius){
 const hd=depth/2,hh=height/2,r=Math.min(radius,hd,hh),corners=[{y:hd-r,z:hh-r,a:0},{y:-hd+r,z:hh-r,a:Math.PI/2},{y:-hd+r,z:-hh+r,a:Math.PI},{y:hd-r,z:-hh+r,a:Math.PI*1.5}],points=[];
 for(const corner of corners)for(let i=0;i<5;i++){const a=corner.a+i*Math.PI/8;points.push([x,corner.y+r*Math.cos(a),corner.z+r*Math.sin(a)]);}
 return points;
}
function overlappingFooting(e,elements){
 return elements.filter(x=>x.category==='footing'&&x.position[2]<e.position[2]&&Math.abs(x.position[0]-e.position[0])<=(x.size[0]+e.size[0])/2&&Math.abs(x.position[1]-e.position[1])<=(x.size[1]+e.size[1])/2).sort((a,b)=>Math.abs((a.position[2]+a.size[2]/2)-(e.position[2]-e.size[2]/2))-Math.abs((b.position[2]+b.size[2]/2)-(e.position[2]-e.size[2]/2)))[0];
}
function overlappingPedestal(e,elements){return elements.some(x=>x.category==='pedestal'&&Math.abs(x.position[0]-e.position[0])<=(x.size[0]+e.size[0])/2&&Math.abs(x.position[1]-e.position[1])<=(x.size[1]+e.size[1])/2&&x.position[2]<e.position[2]);}
function hookedPath(x,y,zTop,zAnchor,direction,length,diameter){
 if(zAnchor>=zTop)return [[x,y,zTop],[x,y,zAnchor]];
 const radius=Math.min(diameter*3,(zTop-zAnchor)/3);
 return bentBarPath([[x+direction*(length+radius),y,zAnchor],[x,y,zAnchor],[x,y,zTop]],radius);
}
function hookedPathAlongY(x,y,zTop,zAnchor,direction,length,diameter){
 if(zAnchor>=zTop)return [[x,y,zTop],[x,y,zAnchor]];
 const radius=Math.min(Math.max(diameter*2,.025),Math.max(.02,(zTop-zAnchor)/3)),arc=[];
 for(let i=0;i<=8;i++){const a=i*Math.PI/16;arc.push([x,y+direction*radius*Math.cos(a),zAnchor+radius*Math.sin(a)]);}
 return [[x,y+direction*(length+radius),zAnchor],...arc,[x,y,zTop]];
}
function overlappingPedestalElement(e,elements){
 return elements.filter(x=>x.category==='pedestal'&&Math.abs(x.position[0]-e.position[0])<=(x.size[0]+e.size[0])/2&&Math.abs(x.position[1]-e.position[1])<=(x.size[1]+e.size[1])/2&&x.position[2]<e.position[2]).sort((a,b)=>Math.abs((a.position[2]+a.size[2]/2)-(e.position[2]-e.size[2]/2))-Math.abs((b.position[2]+b.size[2]/2)-(e.position[2]-e.size[2]/2)))[0];
}
function columnCageRods(e,elements=[],forceHook=false){
 const [w,d,h]=e.size,diameter=e.barDiameter??.016,spacing=e.barSpacing??.2,cover=Math.min(e.cover??defaultCover(e.category),w/4,d/4,h/4),edge=cover+diameter/2,rods=[];
 const tieDiameter=Number(e.properties?.stirrupDiameter)||Math.max(.006,Math.min(.012,diameter*.65)),tieWidth=Math.max(tieDiameter,w-2*cover-tieDiameter),tieDepth=Math.max(tieDiameter,d-2*cover-tieDiameter),tieRadius=Math.min((diameter+tieDiameter)*1.2,tieWidth/4,tieDepth/4);
 const barInset=tieRadius-(tieRadius-(diameter+tieDiameter)*.56)/Math.SQRT2;
 const xBar=Math.max(diameter/2,tieWidth/2-barInset),yBar=Math.max(diameter/2,tieDepth/2-barInset),zBottom=-h/2+edge,zTop=h/2-edge;
 const bottom=e.position[2]-h/2,near=e2=>e2&&Math.abs(e2.position[2]+e2.size[2]/2-bottom)<.15;
 const rawPedestal=overlappingPedestalElement(e,elements),pedestal=near(rawPedestal)?rawPedestal:undefined,rawFooting=overlappingFooting(e,elements);
 const footing=near(rawFooting)||(pedestal&&rawFooting&&Math.abs(rawFooting.position[2]+rawFooting.size[2]/2-(pedestal.position[2]-pedestal.size[2]/2))<.15)?rawFooting:undefined;
 const support=footing||pedestal,shouldHook=forceHook||!!support;
 let anchor=zBottom;
 if(shouldHook&&support){const supportCover=Math.min(support.cover??defaultCover(support.category),support.size[0]/4,support.size[1]/4,support.size[2]/4),matDiameter=support.barDiameter??.016;anchor=support.position[2]-support.size[2]/2+supportCover+matDiameter*2.24+diameter*.56-e.position[2];}
 const innerReach=Math.max(diameter*3,Math.min(Math.abs(xBar),Math.abs(yBar))*0.7);
 const hookLength=support?clamp(Math.min(.35,support.size[0]/2-Math.max(Math.abs(xBar),Math.abs(yBar))-edge),diameter*3,.35):Math.min(.25,innerReach);
 // Column starter bars bend outward from the cage into the surrounding footing/pedestal.
 const count=value=>Math.max(2,Math.min(30,Math.round(Number(value)||2))),positions=[];
 for(const y of [-yBar,yBar]){const n=count(e.category==='beam'?(y>0?e.properties?.topBarCount:e.properties?.bottomBarCount):e.properties?.barsAlongX);for(let i=0;i<n;i++)positions.push([-xBar+2*xBar*i/(n-1),y]);}
 if(e.category!=='beam'){const n=count(e.properties?.barsAlongY);for(const x of [-xBar,xBar])for(let i=1;i<n-1;i++)positions.push([x,-yBar+2*yBar*i/(n-1)]);}
 for(const [x,y] of positions){const direction=x>=0?1:-1;const path=shouldHook?hookedPath(x,y,zTop,anchor,direction,hookLength,diameter):[[x,y,zBottom],[x,y,zTop]];rods.push({...pathRod(path,diameter,false,'longitudinal','single'),size:[diameter,diameter,Math.max(diameter,zTop-zBottom)]});}
 const endSpacing=Number(e.properties?.endStirrupSpacing),zone=Math.min((zTop-zBottom)/2,Number(e.properties?.endZoneLength)||0);
 const stations=new Set();const range=(a,b,s)=>{const n=Math.min(100,Math.max(1,Math.ceil((b-a)/s)));for(let i=0;i<=n;i++)stations.add(a+(b-a)*i/n);};
 if(endSpacing>0&&zone>0){range(zBottom,zBottom+zone,endSpacing);range(zBottom+zone,zTop-zone,spacing);range(zTop-zone,zTop,endSpacing);}else range(zBottom,zTop,spacing);
 for(const z of [...stations].sort((a,b)=>a-b))rods.push(pathRod(roundedRectanglePath(tieWidth,tieDepth,z,tieRadius),tieDiameter,true,'stirrup','single'));
 return rods;
}
function footingBasketRods(e,diameter,spacing,cover){
 const [w,d,h]=e.size,edge=cover+diameter*.56,gap=diameter*1.12;
 const halfX=w/2-edge,halfY=d/2-edge,bottom=-h/2+edge,top=h/2-edge;
 const radius=Math.max(0,Math.min(diameter*3,(top-bottom-gap)/4,halfX/4,halfY/4)),rods=[];
 if(radius<=0)return rods;
 for(const axis of [0,1]){
  const along=axis===0?halfX:halfY,across=axis===0?halfY:halfX;
  // Keep the crossing bars on the straight bottom runs, clear of corner bends.
  const reach=Math.max(0,across-radius-gap),n=Math.min(100,Math.max(1,Math.ceil(2*reach/spacing)));
  const z=bottom+axis*gap,zt=top-(1-axis)*gap,hook=Math.min(diameter*8,along*.3);
  for(let i=0;i<=n;i++){
   const cross=-reach+2*reach*i/n;
   const vertices=[[-along+hook,zt],[-along,zt],[-along,z],[along,z],[along,zt],[along-hook,zt]].map(([s,height])=>axis===0?[s,cross,height]:[cross,s,height]);
   rods.push(pathRod(bentBarPath(vertices,radius),diameter,false,axis===0?'longitudinal':'distribution','bottom'));
  }
 }
 // An upper mat is explicit source data, never inferred from footing thickness.
 if(e.properties?.rebarLayers==='top-bottom'){
  for(const axis of [0,1]){
   const along=(axis===0?halfX:halfY)-radius-gap,across=(axis===0?halfY:halfX)-radius-gap,n=Math.min(100,Math.max(1,Math.ceil(2*across/spacing))),z=top-radius-3*gap-axis*gap;
   for(let i=0;i<=n;i++){const c=-across+2*across*i/n;rods.push(pathRod(axis===0?[[-along,c,z],[along,c,z]]:[[c,-along,z],[c,along,z]],diameter,false,axis===0?'longitudinal':'distribution','top'));}
  }
 }
 return rods;
}
export function reinforcementFor(e,elements=[]){
 if(e.properties?.reinforcementMode==='explicit'||reinforcementOwner(e,elements))return [];
 const [w,d,h]=e.size,diameter=e.barDiameter??.016,spacing=e.barSpacing??.2,cover=Math.min(e.cover??defaultCover(e.category),w/4,d/4,h/4),edge=cover+diameter/2,rods=[];
 if(['column','pedestal'].includes(e.category)){
  rods.push(...columnCageRods(e,elements));
 }else if(e.category==='rebar'&&isBentRebarElement(e)){
  const role=rebarRoleFor(e);
  if(['footing-cage','footing-mat','footing-edge'].includes(role)){
   rods.push(...footingBasketRods(e,diameter,spacing,cover));
  }else if(['column-stirrup','joint-stirrup'].includes(role)){
   const tieDiameter=Math.max(.006,Math.min(.012,diameter*.65)),tieWidth=Math.max(tieDiameter,w-2*edge),tieDepth=Math.max(tieDiameter,d-2*edge),tieRadius=Math.min(.035,tieWidth/4,tieDepth/4);
   rods.push(pathRod(roundedRectanglePath(tieWidth,tieDepth,0,tieRadius),tieDiameter,true,'stirrup','single'));
  }else if(['column-longitudinal','u-bar','l-hook'].includes(role)){
   rods.push(...columnCageRods({...e,category:'pedestal'},elements,true).filter(rod=>rod.kind==='longitudinal'));
  }else{
   rods.push(...columnCageRods({...e,category:'pedestal'},elements,true));
  }
 }else if(e.category==='rebar'){
  const axis=e.size.indexOf(Math.max(...e.size)),a=[0,0,0],b=[0,0,0];a[axis]=-e.size[axis]/2;b[axis]=e.size[axis]/2;rods.push(pathRod([a,b],e.barDiameter??Math.min(...e.size)));
 }else if(e.category==='footing'){
  rods.push(...footingBasketRods(e,diameter,spacing,cover));
 }else if(e.category==='slab'){
  // A flat grid made the reinforcement look like a decal on the concrete.
  // Keep two distinct mats inside the section, with the lower mat drawn first
  // and the upper mat lifted to the real cover position.
  const xMargin=Math.min(w/2-diameter/2,edge),yMargin=Math.min(d/2-diameter/2,edge),xStart=-w/2+xMargin,xEnd=w/2-xMargin,yStart=-d/2+yMargin,yEnd=d/2-yMargin,xSpan=Math.max(diameter,xEnd-xStart),ySpan=Math.max(diameter,yEnd-yStart),bottomZ=-h/2+edge,topZ=h/2-edge,nx=Math.min(100,Math.max(1,Math.ceil(xSpan/spacing))),ny=Math.min(100,Math.max(1,Math.ceil(ySpan/spacing))),layers=h>diameter*5?[bottomZ,topZ]:[bottomZ];
  for(const [layerIndex,z] of layers.entries()){
   const layer=layerIndex===0?'bottom':'top';
   for(let i=0;i<=ny;i++){const y=yStart+(yEnd-yStart)*i/ny;rods.push(pathRod([[xStart,y,z],[xEnd,y,z]],diameter,false,'longitudinal',layer));}
   for(let i=0;i<=nx;i++){const x=xStart+(xEnd-xStart)*i/nx,dz=layer==='top'?-diameter*1.12:diameter*1.12;rods.push(pathRod([[x,yStart,z+dz],[x,yEnd,z+dz]],diameter,false,'distribution',layer));}
  }
 }else if(['beam','gradeBeam'].includes(e.category)){
  // Reuse the confined section, with the cage axis mapped from Z to beam X.
  for(const rod of columnCageRods({...e,category:'beam',size:[d,h,w]},[]))rods.push(pathRod(rod.path.map(([x,y,z])=>[z,x,y]),rod.diameter,rod.closed,rod.kind,rod.kind==='longitudinal'?(rod.path[0][1]>0?'top':'bottom'):'single'));
 }else if(['shearWall','retainingWall'].includes(e.category)){
  const faceOffset=Math.max(diameter/2,d/2-edge),xStart=-w/2+edge,xEnd=w/2-edge,zBottom=-h/2+edge,zTop=h/2-edge,xSpan=Math.max(diameter,xEnd-xStart),zSpan=Math.max(diameter,zTop-zBottom),nx=Math.min(100,Math.max(1,Math.ceil(xSpan/spacing))),nz=Math.min(100,Math.max(1,Math.ceil(zSpan/spacing)));
  for(const y of [-faceOffset,faceOffset]){
   for(let i=0;i<=nx;i++){const x=xStart+(xEnd-xStart)*i/nx;rods.push(pathRod([[x,y,zBottom],[x,y,zTop]],diameter,false,'longitudinal',y>0?'front':'back'));}
   for(let i=0;i<=nz;i++){const z=zBottom+(zTop-zBottom)*i/nz;rods.push(pathRod([[xStart,y,z],[xEnd,y,z]],diameter,false,'distribution',y>0?'front':'back'));}
  }
 }return rods;
}

export const normalizedAngle=degrees=>((degrees+180)%360+360)%360-180;
const isOpening=e=>['door','window'].includes(e.category);
const isOpeningHost=e=>['wall','partition'].includes(e.category);
function openingPlacement(host,e){
 const angle=-(host.rotation||0)*Math.PI/180,dx=e.position[0]-host.position[0],dy=e.position[1]-host.position[1];
 return {x:dx*Math.cos(angle)-dy*Math.sin(angle),y:dx*Math.sin(angle)+dy*Math.cos(angle),z:e.position[2]-host.position[2]};
}
// Separating axis test for boxes rotated about Z. Touching faces are connections, not overlaps.
export function boxesOverlap(a,b,tolerance=.005){
 if(Math.abs(a.position[2]-b.position[2])>=(a.size[2]+b.size[2])/2-tolerance)return false;
 const axes=e=>{const t=(e.rotation||0)*Math.PI/180;return [[Math.cos(t),Math.sin(t)],[-Math.sin(t),Math.cos(t)]]};
 const aa=axes(a),bb=axes(b),delta=[b.position[0]-a.position[0],b.position[1]-a.position[1]];
 const dot=(u,v)=>u[0]*v[0]+u[1]*v[1];
 return [...aa,...bb].every(axis=>Math.abs(dot(delta,axis))<a.size[0]/2*Math.abs(dot(aa[0],axis))+a.size[1]/2*Math.abs(dot(aa[1],axis))+b.size[0]/2*Math.abs(dot(bb[0],axis))+b.size[1]/2*Math.abs(dot(bb[1],axis))-tolerance);
}
export function inspectModel(elements){
 const issues=[],byId=new Map(elements.map(e=>[e.id,e]));
 for(const e of elements){if(e.hostId){const host=byId.get(e.hostId);if(!isOpening(e)||!host||!isOpeningHost(host)){issues.push({code:'opening-host',ids:[e.id],message:'ไม่พบผนังเจ้าของช่องเปิด หรือชนิดชิ้นส่วนไม่ใช่ช่องเปิด'});continue;}
  const {x,y,z}=openingPlacement(host,e);
  if(Math.abs(y)>.01||Math.abs(normalizedAngle((e.rotation||0)-(host.rotation||0)))>.01||Math.abs(x)+e.size[0]/2>host.size[0]/2+.001||Math.abs(z)+e.size[2]/2>host.size[2]/2+.001)issues.push({code:'opening-fit',ids:[e.id,host.id],message:'ช่องเปิดไม่ตรงแนวหรือเกินขอบผนัง'});
 }}
 for(let i=0;i<elements.length;i++)for(let j=i+1;j<elements.length;j++){
  const a=elements[i],b=elements[j],sharedHost=isOpening(a)&&isOpening(b)&&a.hostId&&a.hostId===b.hostId;
  if(!sharedHost&&(a.category!==b.category||['rebar','railing'].includes(a.category)))continue;
  if(boxesOverlap(a,b))issues.push({code:sharedHost?'opening-overlap':'box-overlap',ids:[a.id,b.id],message:sharedHost?'ช่องประตู/หน้าต่างซ้อนทับกันบนผนังเดียวกัน':'ขอบเขตชิ้นส่วนประเภทเดียวกันซ้อนทับ — ตรวจตำแหน่ง'});
  if(issues.length>=100)return issues;
 }
 return issues;
}
export function editedElements(elements,draft){
 const previous=elements.find(e=>e.id===draft.id),next={...draft,rotation:normalizedAngle(draft.rotation||0),revision:(previous?.revision||0)+1};
 if(next.hostId&&isOpening(next)){
  const host=elements.find(e=>e.id===next.hostId&&isOpeningHost(e));if(!host)throw Error('ไม่พบผนังเจ้าของช่องเปิด');
  if(next.size[0]>host.size[0]||next.size[2]>host.size[2])throw Error('ขนาดช่องเปิดใหญ่กว่าผนัง');
  const angle=(host.rotation||0)*Math.PI/180,limit=(host.size[0]-next.size[0])/2,x=Math.max(-limit,Math.min(limit,openingPlacement(host,next).x)),zlim=(host.size[2]-next.size[2])/2;
  next.position=[host.position[0]+x*Math.cos(angle),host.position[1]+x*Math.sin(angle),Math.max(host.position[2]-zlim,Math.min(host.position[2]+zlim,next.position[2]))];next.rotation=normalizedAngle(host.rotation||0);
 }
 const affected=new Set([next.id]);
 const result=elements.map(e=>{if(e.id===next.id)return next;if(e.hostId===next.id&&previous){affected.add(e.id);const a=((next.rotation||0)-(previous.rotation||0))*Math.PI/180,dx=e.position[0]-previous.position[0],dy=e.position[1]-previous.position[1];return {...e,position:[next.position[0]+dx*Math.cos(a)-dy*Math.sin(a),next.position[1]+dx*Math.sin(a)+dy*Math.cos(a),next.position[2]+e.position[2]-previous.position[2]],rotation:normalizedAngle((e.rotation||0)+(next.rotation||0)-(previous.rotation||0)),revision:e.revision+1}}return e});
 const invalid=inspectModel(result.filter(e=>affected.has(e.id)||isOpeningHost(e)||isOpening(e))).find(issue=>issue.code.startsWith('opening-')&&issue.ids.some(id=>affected.has(id)));
 if(invalid)throw Error(invalid.message+' ('+invalid.ids.join(', ')+') — ปรับขนาดหรือตำแหน่งช่องเปิดก่อน');
 return result;
}
