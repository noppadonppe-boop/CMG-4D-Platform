import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Fillet explicit bend vertices; straight runs stay straight (no spline overshoot).
export function bentBarPath(vertices,radius){
 const result=[vertices[0]];
 for(let i=1;i<vertices.length-1;i++){
  const b=new THREE.Vector3(...vertices[i]),a=new THREE.Vector3(...vertices[i-1]),c=new THREE.Vector3(...vertices[i+1]);
  const u=a.clone().sub(b).normalize(),v=c.clone().sub(b).normalize();
  const r=Math.min(radius,a.distanceTo(b)/2,c.distanceTo(b)/2);
  const center=b.clone().addScaledVector(u,r).addScaledVector(v,r);
  for(let j=0;j<=12;j++){const t=j*Math.PI/24;result.push(center.clone().addScaledVector(v,-r*Math.cos(t)).addScaledVector(u,-r*Math.sin(t)).toArray());}
 }
 result.push(vertices.at(-1));return result;
}

export function rebarTubeGeometry(rod){
 const points=rod.path.map(p=>new THREE.Vector3(...p));
 if(rod.closed)points.push(points[0].clone());
 const curve=new THREE.CurvePath();
 for(let i=1;i<points.length;i++)if(points[i].distanceToSquared(points[i-1])>1e-16)curve.add(new THREE.LineCurve3(points[i-1],points[i]));
 const length=curve.getLength(),pitch=rod.diameter*.7,segments=Math.min(4800,Math.max(points.length*4,Math.ceil(length/pitch*6))),radialSegments=16;
 let geometry=new THREE.TubeGeometry(curve,segments,rod.diameter/2,radialSegments,!!rod.closed);
 // Actual raised ribs preserve the silhouette when viewed close up. Bump alone
 // disappeared at normal viewing distances on narrow bars.
 const position=geometry.attributes.position;
 for(let i=0;i<=segments;i++){
  const center=curve.getPointAt(i/segments);
  for(let j=0;j<=radialSegments;j++){
   const angle=j/radialSegments*Math.PI*2,phase=i/segments*length/pitch-.35*Math.sin(2*angle);
   const rib=Math.pow(Math.max(0,Math.cos(phase*Math.PI*2)),8)*rod.diameter*.045;
   const index=i*(radialSegments+1)+j,p=new THREE.Vector3().fromBufferAttribute(position,index).sub(center).normalize().multiplyScalar(rod.diameter/2+rib).add(center);
   position.setXYZ(index,p.x,p.y,p.z);
  }
 }
 geometry.computeVertexNormals();
 // Texture repeats follow physical distance along the bend, not bar length.
 const uv=geometry.attributes.uv;
 for(let i=0;i<uv.count;i++)uv.setX(i,uv.getX(i)*length/(rod.diameter*.7));
 if(!rod.closed){
  const caps=[0,1].map(t=>{const cap=new THREE.CircleGeometry(rod.diameter/2,radialSegments),normal=curve.getTangentAt(t).multiplyScalar(t===0?-1:1);cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal));const center=curve.getPointAt(t);cap.translate(center.x,center.y,center.z);return cap;});
  const merged=mergeGeometries([geometry,...caps]);geometry.dispose();caps.forEach(c=>c.dispose());geometry=merged;
 }
 return geometry;
}
