const keywordColors=[
 ['เขียวอ่อน','#d9efbf'],['light green','#d9efbf'],['mint','#d9efbf'],
 ['เขียวเข้ม','#14752d'],['dark green','#14752d'],
 ['เขียว','#20a249'],['green','#20a249'],
 ['เทาเข้ม','#62666b'],['dark gray','#62666b'],['dark grey','#62666b'],
 ['เทา','#b9bfbe'],['gray','#b9bfbe'],['grey','#b9bfbe'],
 ['ส้ม','#d87815'],['orange','#d87815'],
 ['ขาว','#f3f3ee'],['white','#f3f3ee'],
 ['ครีม','#eee2c2'],['cream','#eee2c2'],
 ['น้ำตาลเข้ม','#704b2e'],['brown','#7b5638'],
 ['ดำ','#292c30'],['black','#292c30'],
 ['ฟ้า','#8fc8e4'],['blue','#8fc8e4'],
].sort((a,b)=>b[0].length-a[0].length);

const housePalette={wall:'#d9efbf',partition:'#d9efbf',wallFinish:'#d9efbf',cladding:'#e7efcf',column:'#858783',pedestal:'#858783',shearWall:'#858783',retainingWall:'#858783',roof:'#62666b',roofDeck:'#62666b',roofCovering:'#14752d',roofFlashing:'#d87815',gutter:'#d87815',floorFinish:'#4d5054',slab:'#65696c',stairs:'#65696c',door:'#704b2e',window:'#b6d8e2',curtainWall:'#b6d8e2',railing:'#292c30',canopy:'#14752d'};

function fromText(value){
 const text=String(value||'').trim().toLowerCase();
 if(!text)return undefined;
 const hex=text.match(/#[0-9a-f]{6}\b/i);
 if(hex)return hex[0].toLowerCase();
 return keywordColors.find(([keyword])=>text.includes(keyword))?.[1];
}

export function presentationColorFor(element,material){
 const properties=element?.properties||{};
 for(const key of ['color','paintColor','finishColor']){
  const color=fromText(properties[key]);
  if(color)return color;
 }
 const presentation=String(properties.presentation||properties.style||material||'').toLowerCase();
 if(['house-color','house color','colorful','สีบ้าน'].includes(presentation))return housePalette[element.category];
 return fromText(material);
}

export {housePalette};
