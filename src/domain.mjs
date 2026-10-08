export const categories = ['footing','pedestal','column','beam','slab'];
export const labels = {footing:'ฐานราก',pedestal:'ตอม่อ',column:'เสา',beam:'คาน',slab:'พื้น'};
export const dateRange = {start:'2026-11-01',end:'2027-01-31'};
export function dayNumber(date){return Math.round(Date.parse(date+'T00:00:00Z')/86400000)}
export function activityState(activity,date){const d=dayNumber(date);return d<dayNumber(activity.start)?'future':d<=dayNumber(activity.end)?'active':'done'}
export function demoProject(name='อาคารสำนักงาน CMG'){
 const id=crypto.randomUUID();const elements=[];let count=0;
 for(let y=0;y<2;y++)for(let x=0;x<2;x++){
  count++;const px=x*5,py=y*5;
  elements.push({id:`F-${count.toString().padStart(3,'0')}`,category:'footing',name:`ฐานราก F${count}`,position:[px,py,-0.9],size:[2,2,0.6],zone:'A',material:'คอนกรีต',source:'ข้อมูลสาธิต',revision:1});
  elements.push({id:`P-${count}`,category:'pedestal',name:`ตอม่อ P${count}`,position:[px,py,-0.2],size:[0.6,0.6,0.8],zone:'A',material:'คอนกรีต',source:'ข้อมูลสาธิต',revision:1});
  elements.push({id:`C-${count}`,category:'column',name:`เสา C${count}`,position:[px,py,1.75],size:[0.35,0.35,3.1],zone:'A',material:'คอนกรีต',source:'ข้อมูลสาธิต',revision:1});
 }
 for(let i=0;i<2;i++){
 elements.push({id:`B-X-${i}`,category:'beam',name:`คาน BX${i+1}`,position:[2.5,i*5,3.2],size:[5.35,0.3,0.5],zone:'A',material:'คอนกรีต',source:'ข้อมูลสาธิต',revision:1});
 elements.push({id:`B-Y-${i}`,category:'beam',name:`คาน BY${i+1}`,position:[i*5,2.5,3.2],size:[0.3,5.35,0.5],zone:'A',material:'คอนกรีต',source:'ข้อมูลสาธิต',revision:1});
 }
 elements.push({id:'S-001',category:'slab',name:'พื้นชั้น 1',position:[2.5,2.5,3.5],size:[5.35,5.35,0.15],zone:'A',material:'คอนกรีต',source:'ข้อมูลสาธิต',revision:1});
 const activities=[{id:'A-01',name:'ฐานราก',start:'2026-11-01',end:'2026-11-15',categories:['footing']},{id:'A-02',name:'ตอม่อ',start:'2026-11-16',end:'2026-11-25',categories:['pedestal']},{id:'A-03',name:'เสา',start:'2026-11-26',end:'2026-12-15',categories:['column']},{id:'A-04',name:'คาน',start:'2026-12-16',end:'2027-01-05',categories:['beam']},{id:'A-05',name:'พื้น',start:'2027-01-06',end:'2027-01-20',categories:['slab']}];
 return {id,name,elements,activities,documents:[],audit:[],description:'โมเดลตัวอย่างฐานราก 4 ฐาน พร้อมตอม่อ เสา คาน และพื้น',updatedAt:new Date().toISOString()};
}
export function validateElement(e){return e && typeof e.name==='string' && typeof e.material==='string' && typeof e.zone==='string' && typeof e.source==='string' && Number.isInteger(e.revision) && e.revision>=1 && typeof e.id==='string' && categories.includes(e.category) && Array.isArray(e.size) && e.size.length===3 && e.size.every(v=>Number.isFinite(v)&&v>0&&v<=1000) && Array.isArray(e.position)&&e.position.length===3&&e.position.every(v=>Number.isFinite(v)&&Math.abs(v)<=100000)}
function validDate(d){return typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(dayNumber(d)) && new Date(dayNumber(d)*86400000).toISOString().slice(0,10)===d}
export function validateProject(p){return p&&typeof p.id==='string'&&typeof p.name==='string'&&Array.isArray(p.elements)&&p.elements.length<=10000&&p.elements.every(validateElement)&&new Set(p.elements.map(e=>e.id)).size===p.elements.length&&Array.isArray(p.activities)&&p.activities.length<=1000&&new Set(p.activities.map(a=>a?.id)).size===p.activities.length&&p.activities.every(a=>a&&typeof a.id==='string'&&typeof a.name==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(a.start)&&/^\d{4}-\d{2}-\d{2}$/.test(a.end)&&validDate(a.start)&&validDate(a.end)&&a.start<=a.end&&Array.isArray(a.categories)&&a.categories.every(c=>categories.includes(c)))}
