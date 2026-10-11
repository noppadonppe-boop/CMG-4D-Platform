import {labels} from './domain.mjs';
export function architecturalExample(){
 const elements=[];
 const add=(id,category,position,size,extra={})=>elements.push({id,category,name:labels[category]+' '+id,position,size,rotation:0,zone:'A',material:'คอนกรีต',source:'ตัวอย่างสถาปัตยกรรม — ไม่ได้ถอดจากแบบผู้ใช้',confidence:'assumed',revision:1,...extra});
 for(const x of [0,4,8,12])for(const y of [0,6]){const id=x+'-'+y;add('F'+id,'footing',[x,y,-.55],[1.5,1.5,.5],{floor:0});for(const a of [-.4,.4])for(const b of [-.4,.4])add('P'+id+a+b,'pile',[x+a,y+b,-1.8],[.25,.25,2],{floor:0});for(const floor of [0,1])add('C'+id+'-F'+floor,'column',[x,y,1.5+floor*3],[.25,.25,3],{floor});}
 for(const z of [0,3,6]){const floor=z===0?0:1;add('S'+z,'slab',[6,3,z-.1],[12.4,6.4,.2],{floor});for(const y of [0,6])add('B'+z+y,'beam',[6,y,z-.3],[12,.25,.4],{floor});}
 for(const y of [0,6]){const wall='W'+y;add(wall,'wall',[6,y,4.5],[11.75,.16,3],{floor:1,material:'ฉาบปูนสีเทา'});for(const [i,x] of [1.6,4.4,7.2,10].entries())add('WIN'+y+i,'window',[x,y,4.5],[2.4,.16,2.3],{floor:1,hostId:wall,material:'glass'});}
 for(const x of [0,12])add('SIDE'+x,'wall',[x,3,4.5],[5.75,.16,3],{floor:1,rotation:90,material:'ฉาบปูนสีเทา'});
 add('W-GROUND','wall',[6,6,1.5],[11.75,.16,3],{floor:0});add('D-GROUND','door',[4,6,1.1],[1.2,.16,2.2],{floor:0,hostId:'W-GROUND',material:'ไม้'});
 add('STAIR','stairs',[8,-2.4,1.5],[1.2,4.8,3],{floor:0,steps:18,material:'steel'});
 add('LIFT','elevator',[10.5,4.5,1.4],[1.6,1.6,2.8],{floor:0,material:'steel'});
 add('ROOF','roof',[6,3,6.7],[13,7,1.4],{floor:1,roofStyle:'gable',material:'metal'});
 add('DECK','slab',[2,-1.7,2.9],[4,3,.2],{floor:0});add('RAIL-F','railing',[2,-3.2,3.5],[4,.05,1],{floor:1});add('RAIL-S','railing',[0,-1.7,3.5],[3,.05,1],{floor:1,rotation:90});
 const groups=[['pile','footing'],['column','beam','slab'],['wall','roof'],['stairs','elevator','railing'],['door','window']];
 const activities=groups.map((cats,i)=>({id:'TASK-'+i,name:['ฐานรากและเสาเข็ม','โครงสร้าง','ผนังและหลังคา','บันได ลิฟต์ ราว','ประตูและหน้าต่าง'][i],start:new Date(Date.UTC(2026,9,1+i*10)).toISOString().slice(0,10),end:new Date(Date.UTC(2026,9,10+i*10)).toISOString().slice(0,10),categories:cats}));
 return {id:crypto.randomUUID(),name:'บ้านตัวอย่าง · Architecture',description:'โมเดลตัวอย่างอาคาร 2 ชั้น พร้อมองค์ประกอบแยกชั้นและเสาแยกช่วงต่อชั้น',floors:[{id:'FLOOR-0',index:0,name:'ชั้น 1',elevation:0,height:3},{id:'FLOOR-1',index:1,name:'ชั้น 2',elevation:3,height:3}],elements,activities,documents:[],audit:[],updatedAt:new Date().toISOString()};
}
