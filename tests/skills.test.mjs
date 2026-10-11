import test from 'node:test';
import assert from 'node:assert/strict';
import {categories} from '../src/domain.mjs';
import {constructionSkills,constructionSkillIds,constructionSkillsPrompt} from '../src/constructionSkills.mjs';
import {instructions} from '../server/ai.mjs';

test('central construction skills are unique, mapped to valid categories, and included in AI instructions',()=>{
 assert.equal(constructionSkills.length,9);
 assert.equal(new Set(constructionSkillIds).size,constructionSkills.length);
 for(const skill of constructionSkills)for(const category of skill.categories)assert.ok(categories.includes(category)||category==='all model categories');
 for(const name of ['สร้าง 3D','สร้างเหล็กเสริม','งานปูน','งานไม้แบบ นั่งร้าน','งานโครงสร้าง ฐานราก งานขุด','งานสถาปัตย์','งานโครงหลังคา','ระบบประกอบอาคาร MEP'])assert.match(constructionSkillsPrompt,new RegExp(name));
 assert.match(instructions,/Additional Agent role and visualization instructions/);
 assert.match(instructions,/งานไม้แบบ นั่งร้าน/);
 assert.match(instructions,/REINFORCEMENT_VISUALIZATION_STANDARD/);
 assert.match(instructions,/Output ONLY a JSON object/);
});
