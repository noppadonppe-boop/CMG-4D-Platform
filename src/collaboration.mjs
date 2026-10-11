// Three-way field merge: independent edits compose; competing edits stay explicit.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function mergeValue(base,local,remote,path='',conflicts=[],preferLocal=false){
 if(same(local,base))return remote;if(same(remote,base)||same(local,remote))return local;
 if(Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)&&[...base,...local,...remote].every(x=>x&&typeof x==='object'&&('id' in x||'at' in x))){const key=x=>x.id??x.at+'|'+x.message;const b=new Map(base.map(x=>[key(x),x])),l=new Map(local.map(x=>[key(x),x])),r=new Map(remote.map(x=>[key(x),x]));return [...new Set([...r.keys(),...l.keys(),...b.keys()])].map(id=>mergeValue(b.get(id),l.get(id),r.get(id),path+'/'+id,conflicts,preferLocal)).filter(x=>x!==undefined);}
 if(base&&local&&remote&&!Array.isArray(base)&&typeof base==='object'&&typeof local==='object'&&typeof remote==='object'){return Object.fromEntries([...new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])].map(k=>[k,mergeValue(base[k],local[k],remote[k],path+'/'+k,conflicts,preferLocal)]).filter(([,v])=>v!==undefined));}
 if(!path.endsWith('/updatedAt')&&!path.endsWith('/revision'))conflicts.push(path);return local;
}
export function mergeProject(base,local,remote){const conflicts=[];const project=mergeValue(base,local,remote,'',conflicts);return {project,conflicts};}
