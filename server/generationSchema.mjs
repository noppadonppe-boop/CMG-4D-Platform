import * as z from 'zod/v4';
import {categories} from '../src/domain.mjs';

export const generationElementSchema=z.object({
 id:z.string().min(1),category:z.enum(categories),
 position:z.tuple([z.number(),z.number(),z.number()]).describe('Centre position [x,y,z] in metres; Z up'),
 size:z.tuple([z.number().positive().max(1000),z.number().positive().max(1000),z.number().positive().max(1000)]).describe('Dimensions [width,depth,height] in metres'),
 name:z.string().optional(),zone:z.string().optional(),material:z.string().optional(),source:z.string().optional(),revision:z.number().int().positive().optional(),
 floor:z.number().int().min(-20).max(200).optional(),rotation:z.number().min(-360).max(360).optional(),
 confidence:z.enum(['shown','derived','assumed']).optional(),
 properties:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).optional().describe('BIM properties. For category customComponent, set geometry to a JSON string: {"version":1,"parts":[...]}. Parts may be box {type,size:[x,y,z],position:[x,y,z],rotation:[rx,ry,rz],material?}, cylinder {type,diameter,length,position,rotation?,material?}, or hollowSquareTube {type,width,depth,length,wallThickness,position,rotation?,material?}. Part positions are relative to the component centre; dimensions are metres and rotations are degrees.'),
 hostId:z.string().optional(),steps:z.number().int().min(2).max(100).optional(),roofStyle:z.enum(['flat','gable']).optional(),
 cover:z.number().positive().max(10).optional(),barDiameter:z.number().positive().max(10).optional(),barSpacing:z.number().positive().max(10).optional(),
});
export const generationBatchSchema=z.object({
 name:z.string().optional(),description:z.string().optional(),
 floors:z.array(z.object({id:z.string(),index:z.number().int(),name:z.string(),elevation:z.number(),height:z.number().positive()})).optional(),
 elements:z.array(generationElementSchema).describe('Prefer 20-100 new elements per submission. Never repeat saved IDs.'),
 activities:z.array(z.object({id:z.string(),name:z.string(),start:z.string(),end:z.string(),categories:z.array(z.enum(categories)),elementIds:z.array(z.string()).optional()})).optional(),
 notes:z.array(z.string()).optional(),
});
export function normalizeGenerationElement(element,index){
 const parsed=generationElementSchema.safeParse(element);
 if(!parsed.success)throw Error(`elements[${index}] (${element?.id||'ไม่มี id'}): `+parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; '));
 const e=parsed.data;
 return {...e,name:e.name??e.id,zone:e.zone??'',material:e.material??'unspecified',source:e.source??'',revision:e.revision??1,confidence:e.confidence??'assumed',...(e.properties?{properties:Object.fromEntries(Object.entries(e.properties).map(([k,v])=>[k,String(v)]))}:{})};
}
