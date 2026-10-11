import React,{useMemo,useEffect} from 'react';
import {Edges} from '@react-three/drei';
import * as THREE from 'three';
import {partsFor,reinforcementFor} from './geometry.mjs';
import {presentationColorFor} from './presentationColors.mjs';
import {rebarTubeGeometry} from './rebarGeometry.mjs';
import type {Element} from './domain.mjs';
const colors:Record<string,string>={footing:'#b8c4c8',pileCap:'#a9b7bc',pedestal:'#8c9da4',column:'#b6c5cb',beam:'#97adb5',slab:'#c5d8dd',shearWall:'#aabdc2',retainingWall:'#968d7e',brace:'#667b84',truss:'#60777f',rafter:'#a98765',purlin:'#74828b',joist:'#a98765',roofDeck:'#819397',ramp:'#c5d8dd',rebar:'#795e4d',pile:'#74848b',gradeBeam:'#95a9ad',tendon:'#796356',anchorBolt:'#74828b',basePlate:'#667b84',embedPlate:'#667b84',connectionPlate:'#667b84',wall:'#e3ded2',partition:'#e7e1d5',door:'#9d7351',window:'#94bbc2',curtainWall:'#9bc4ca',cladding:'#c1b8a7',louver:'#a9a28f',canopy:'#8d999b',stairs:'#87959b',elevator:'#aebec3',roof:'#575e64',roofCovering:'#68757a',roofFlashing:'#74828b',gutter:'#74828b',floorFinish:'#d8d0bf',wallFinish:'#ddd5c6',ceiling:'#e8e7df',skirting:'#9c8c7d',casework:'#a98765',duct:'#bac8ca',pipe:'#718d95',conduit:'#84969a',cableTray:'#75858a',hvacEquipment:'#8da1a5',electricalEquipment:'#777f83',plumbingFixture:'#c8dadd',railing:'#56656d',formwork:'#b99068',scaffold:'#71818a',excavation:'#a79070',customComponent:'#78858c'};
const materialColors={wood:'#c0783d',concrete:'#d7d4cb',steel:'#607d89'};
const wallSurfaceCategories=new Set(['wall','partition','cladding','wallFinish']);
const surfaceTextureCache=new Map<string,THREE.CanvasTexture>();
type SurfaceTexture='stone'|'concrete';

function surfaceTextureFor(e:Element,material:string):SurfaceTexture|undefined{
 const requested=String(e.properties?.surfaceTexture||e.properties?.texture||'').toLowerCase();
 if(/stone|masonry|brick|หิน|อิฐ|ก่ออิฐ/.test(requested))return 'stone';
 if(/concrete|plaster|ปูน|คอนกรีต|ฉาบ|เทา|gray|grey/.test(requested))return 'concrete';
 if(/stone|masonry|brick|หิน|อิฐ|ก่ออิฐ/.test(material.toLowerCase()))return 'stone';
 return undefined;
}

function getSurfaceTexture(kind:SurfaceTexture|undefined){
 if(!kind||typeof document==='undefined')return undefined;
 const cached=surfaceTextureCache.get(kind);
 if(cached)return cached;
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=192;
 const context=canvas.getContext('2d');
 if(!context)return undefined;
 const random=(seed:number)=>{const value=Math.sin(seed*12.9898)*43758.5453;return value-Math.floor(value)};
 context.fillStyle=kind==='stone'?'#d2d0c8':'#bec2c1';context.fillRect(0,0,canvas.width,canvas.height);
 if(kind==='stone'){
  const blockHeight=27,grout='#9c9d98';
  for(let row=0;row<8;row++){
   const y=row*blockHeight,offset=row%2? -24:0;
   for(let col=-1;col<7;col++){
    const x=offset+col*48+2,seed=row*19+col*7;
    const width=44+Math.round(random(seed)*8),height=23+Math.round(random(seed+1)*4);
    const shade=Math.round(194+random(seed+2)*35);
    context.fillStyle=`rgb(${shade+4},${shade+3},${shade-2})`;context.fillRect(x,y+2,width,height);
    context.strokeStyle='rgba(112,113,109,.42)';context.lineWidth=1;context.strokeRect(x+.5,y+2.5,width-1,height-1);
    context.fillStyle='rgba(255,255,255,.20)';context.fillRect(x+2,y+4,Math.max(4,width-8),1);
   }
  }
  context.strokeStyle=grout;context.lineWidth=2;
  for(let row=0;row<=8;row++){const y=row*blockHeight;context.beginPath();context.moveTo(0,y);context.lineTo(canvas.width,y);context.stroke();}
 }else{
  for(let i=0;i<650;i++){
   const shade=Math.round(150+random(i+3)*70),alpha=.06+random(i+5)*.12;
   context.fillStyle=`rgba(${shade},${shade+2},${shade+1},${alpha})`;
   context.fillRect(random(i+7)*canvas.width,random(i+11)*canvas.height,1+random(i+13)*3,1+random(i+17)*3);
  }
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.RepeatWrapping;texture.needsUpdate=true;surfaceTextureCache.set(kind,texture);return texture;
}
const skipRaycast:THREE.Object3D['raycast']=()=>{};
// X-ray is rendered as a separate ghost pass.  The old .08 alpha was too
// strong because many overlapping parts were drawn with depth testing off;
// the alpha accumulated and made slabs/roofs look solid again.
const XRAY_OPACITY=.055;
// Transparent mode uses alpha-hash instead of regular alpha blending.  That
// keeps real depth ordering while preventing overlapping floors from adding
// their opacity together into an opaque stack.
const TRANSPARENT_OPACITY=.16;
export function Member({e,elements,selected,onSelect,status,transparent,section,xray,floorOffset=0}:{e:Element;elements:Element[];selected:boolean;onSelect:()=>void;status:string;transparent:boolean;section:boolean;xray:boolean;floorOffset?:number}){
 const clip=useMemo(()=>section?[new THREE.Plane(new THREE.Vector3(0,0,-1),2)]:[],[section]);
 const parts=useMemo(()=>partsFor(e,elements),[e,elements]);
 const ghost=status==='future';
 return <group position={[e.position[0],e.position[1],e.position[2]+floorOffset]} rotation={[0,0,(e.rotation||0)*Math.PI/180]} onClick={xray?undefined:ev=>{ev.stopPropagation();onSelect()}}>{parts.map((p:any,i:number)=>{const material=p.material==='frame'?e.material:p.material,glass=p.material==='glass',wallSurface=wallSurfaceCategories.has(e.category),textureKind=surfaceTextureFor(e,material),surfaceTexture=getSurfaceTexture(textureKind),presentationColor=presentationColorFor(e,material),wood=!wallSurface&&(e.category==='formwork'||/ไม้|wood/i.test(material)),concrete=/คอนกรีต|ปูน|concrete/i.test(material),steel=/เหล็ก|steel|metal/i.test(material),baseColor=selected?'#ed9b38':status==='active'?'#efbd4b':status==='done'?'#3da28e':glass?'#a8d6df':presentationColor|| (wallSurface?(textureKind==='stone'?'#d2d0c8':'#b9bfbe'):wood?materialColors.wood:concrete?materialColors.concrete:steel?materialColors.steel:p.material==='frame'?'#53616a':colors[e.category]||'#bdcbd0'),color=xray?'#78949a':baseColor,opacity=ghost?.1:xray?XRAY_OPACITY:transparent?TRANSPARENT_OPACITY:glass?.3:1,hashedTransparent=transparent&&!glass&&!ghost;return <mesh key={i} position={p.position} rotation={p.rotation} castShadow receiveShadow renderOrder={xray?1:0} raycast={xray?skipRaycast:undefined}>{p.cylinder?<cylinderGeometry args={[Math.min(...p.size)/2,Math.min(...p.size)/2,Math.max(...p.size),p.radialSegments||12,1,p.hollow===true]}/>:<boxGeometry args={p.size}/>} {xray?<meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} depthTest clippingPlanes={clip}/>:<meshStandardMaterial color={color} map={surfaceTexture} roughness={textureKind==='stone'?.9:glass?.15:steel?.42:.82} metalness={steel?.35:p.material==='frame'?.6:0} transparent={ghost||glass} alphaHash={hashedTransparent} opacity={opacity} wireframe={false} depthWrite={hashedTransparent?true:!ghost&&!glass} clippingPlanes={clip}/>} {!xray&&!p.cylinder&&(selected||parts.length<30)&&<Edges color={selected?'#e89129':'#77888c'} threshold={25}/>}</mesh>})}</group>
}
let rebarBump:THREE.CanvasTexture|undefined;
function getRebarBump(){
 if(rebarBump)return rebarBump;
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#555';ctx.fillRect(0,0,128,128);
 // Diagonal transverse ribs, mirrored on the two faces, plus longitudinal seams.
 ctx.strokeStyle='#ddd';ctx.lineWidth=14;
 for(let k=-1;k<=1;k++)for(const side of [0,1]){ctx.beginPath();ctx.moveTo(k*128+(side?94:34),side*64);ctx.lineTo(k*128+(side?34:94),(side+1)*64);ctx.stroke();}
 ctx.fillStyle='#aaa';ctx.fillRect(0,0,128,5);ctx.fillRect(0,64,128,5);
 rebarBump=new THREE.CanvasTexture(canvas);rebarBump.wrapS=rebarBump.wrapT=THREE.RepeatWrapping;rebarBump.anisotropy=4;return rebarBump;
}
function RebarRod({rod,xray}:{rod:any;xray:boolean}){
 const geometry=useMemo(()=>rebarTubeGeometry(rod),[rod]);
 useEffect(()=>()=>geometry.dispose(),[geometry]);
 return <mesh geometry={geometry} renderOrder={xray?10:0} castShadow receiveShadow raycast={xray?undefined:skipRaycast}><meshStandardMaterial color="#686b6d" bumpMap={getRebarBump()} bumpScale={rod.diameter*.045} metalness={.45} roughness={.68} depthTest depthWrite/></mesh>
}
export function Rebar({e,elements=[],xray=false,floorOffset=0,onSelect}:{e:Element;elements?:Element[];xray?:boolean;floorOffset?:number;onSelect?:()=>void}){const rods=useMemo(()=>reinforcementFor(e,elements),[e,elements]);return <group position={[e.position[0],e.position[1],e.position[2]+floorOffset]} rotation={[0,0,(e.rotation||0)*Math.PI/180]} renderOrder={xray?4:0} onClick={xray&&onSelect?ev=>{ev.stopPropagation();onSelect()}:undefined}>{rods.map((rod:any,index:number)=><RebarRod key={index} rod={rod} xray={xray}/>)}</group>}
