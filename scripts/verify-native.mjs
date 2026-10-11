import fs from 'node:fs/promises';
import {prepareFiles} from '../server/files.mjs';
await fs.mkdir('.qa/fixtures',{recursive:true});
for(const [name,url] of [['line.dwg','https://raw.githubusercontent.com/LibreDWG/libredwg/master/test/test-data/2000/Line.dwg'],['comment.rar','https://raw.githubusercontent.com/YuJianrong/node-unrar.js/master/testFiles/WithComment.rar']]){const r=await fetch(url);if(!r.ok)throw Error(r.status);const bytes=Buffer.from(await r.arrayBuffer());await fs.writeFile('.qa/fixtures/'+name,bytes);const files=await prepareFiles([{name,data:bytes.toString('base64')}]);console.log(name,files.map(f=>({name:f.name,kind:f.kind,characters:f.text?.length})));}
