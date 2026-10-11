import React,{useLayoutEffect,useRef} from 'react';
import {TransformControls} from '@react-three/drei';
import * as THREE from 'three';
import type {Element} from './domain.mjs';
export default function EditGizmo({element,onMove}:{element:Element;onMove:(position:[number,number,number])=>void}){
 const ref=useRef<THREE.Mesh>(null!);
 useLayoutEffect(()=>{ref.current.position.set(...element.position)},[element]);
 return <TransformControls mode="translate" translationSnap={.05} onMouseUp={()=>{if(ref.current)onMove(ref.current.position.toArray() as [number,number,number])}}><mesh ref={ref} position={element.position} rotation={[0,0,(element.rotation||0)*Math.PI/180]}><boxGeometry args={element.size}/><meshBasicMaterial color="#efa533" wireframe transparent opacity={.3}/></mesh></TransformControls>
}
