import {categories, labels, validateElement, validateProject} from './domain.mjs';
import {boxesOverlap, normalizedAngle, inspectModel} from './geometry.mjs';

export const MAX_EDIT_TARGETS = 100;
export const MAX_EDIT_CONTEXT = 250;
export const MAX_EDIT_OPERATIONS = 250;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalize = text => String(text).replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit))).toLowerCase();
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, value) => new RegExp(`(^|[^a-z0-9_-])${escape(normalize(value))}(?=$|[^a-z0-9_-])`, 'u').test(text);
const groupMentions = (value, reference) => new RegExp(`(^|[^a-z0-9])${escape(reference)}(?=$|[^a-z0-9])`, 'u').test(normalize(value));
const matchesReference = (element, reference) => [element.id, element.name, element.zone, ...Object.values(element.properties || {})].some(value => groupMentions(value, reference));
const aliases = {stairs:['บันได','stair'],slab:['พื้น','slab'],wall:['ผนัง','wall'],door:['ประตู','door'],window:['หน้าต่าง','window'],beam:['คาน','beam'],column:['เสา','column'],roof:['หลังคา','roof'],railing:['ราว','railing'],pileCap:['pile cap','ฐานหัวเสาเข็ม'],gradeBeam:['grade beam','คานคอดิน'],shearWall:['shear wall','ผนังรับแรงเฉือน'],retainingWall:['retaining wall','กำแพงกันดิน'],brace:['bracing','ค้ำยัน'],truss:['โครงถัก','truss'],rafter:['จันทัน','rafter'],purlin:['เหล็กแป','แป','purlin'],joist:['ตง','joist'],roofDeck:['พื้นรองหลังคา','roof deck'],ramp:['ทางลาด','ramp'],tendon:['ลวดอัดแรง','tendon'],anchorBolt:['anchor bolt','anchor bolt'],basePlate:['base plate','แผ่นฐานเสา'],embedPlate:['เพลทฝัง','embedded plate'],connectionPlate:['เพลทต่อ','connection plate'],partition:['ผนังกั้นห้อง','ผนังกั้น','partition'],curtainWall:['curtain wall','ผนังกระจก'],cladding:['วัสดุกรุ','cladding'],louver:['แผงบังแดด','เกล็ดบังแดด','louver'],canopy:['กันสาด','canopy'],roofCovering:['วัสดุมุงหลังคา','แผ่นหลังคา','roof covering'],roofFlashing:['ครอบหลังคา','flashing'],gutter:['รางน้ำฝน','gutter'],floorFinish:['วัสดุปูพื้น','งานพื้น','floor finish'],wallFinish:['ผิวผนัง','งานกรุผนัง','wall finish'],ceiling:['ฝ้าเพดาน','ceiling'],skirting:['บัวพื้น','skirting'],casework:['ตู้บิลต์อิน','เคาน์เตอร์','casework'],duct:['ท่อลม','duct'],pipe:['ท่อประปา','ท่อ','pipe'],conduit:['ท่อร้อยสาย','conduit'],cableTray:['รางสายไฟ','cable tray'],hvacEquipment:['อุปกรณ์ปรับอากาศ','hvac'],electricalEquipment:['อุปกรณ์ไฟฟ้า','electrical equipment'],plumbingFixture:['สุขภัณฑ์','plumbing fixture']};
const floorOf = text => normalize(text).match(/(?:ชั้น(?:ที่)?\s*|floor\s*|level\s*|\b(?:l|f)[-_]?)(\d+)(?!\d)/)?.[1];
const matchesFloor = (element, floor) => {
  const properties = element.properties || {};
  return [element.name, element.zone, element.id, properties.floor, properties.level, properties.storey, properties['ชั้น']].some(value => value && (floorOf(value) === floor || normalize(value).trim() === floor));
};

export function resolveEditTargets(project, {prompt, selectedId, scope = 'auto'}) {
  const selected = project.elements.find(element => element.id === selectedId);
  if (scope === 'selected') {
    if (!selected) throw Error('เลือกชิ้นส่วนใน 3D ก่อนส่งคำสั่ง');
    return [selected];
  }
  const text = normalize(prompt);
  const bulk = /(ทั้งหมด|ทุก|\ball\b|\beach\b)/i.test(text);
  const category = categories.flatMap(category => (aliases[category] || [labels[category], category]).map(word => ({category, word: normalize(word)}))).filter(item => text.includes(item.word)).sort((a, b) => b.word.length - a.word.length)[0]?.category;
  const floor = floorOf(text);
  const references = [...new Set((text.match(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*\b/g) || []).filter(reference => /\d/.test(reference) && !/^(?:m|cm|mm|kg|kn|mpa)\d+$/.test(reference)))];
  let matches = project.elements.filter(element => mentions(text, element.id));
  if (references.length) {
    const referenced = new Set();
    for (const reference of references) {
      const exact = project.elements.find(element => normalize(element.id) === reference);
      // A family mark such as ST6 can live in an ID prefix, a name, or BIM properties.
      // Numeric boundaries keep ST6 separate from ST60 and ST61.
      const group = exact && !bulk ? [exact] : project.elements.filter(element => (!category || element.category === category) && (!floor || matchesFloor(element, floor)) && matchesReference(element, reference));
      if (!group.length) throw Error(`ไม่พบ ID หรือกลุ่ม ${reference.toUpperCase()} ที่ระบุ กรุณาตรวจชื่อหรือเลือกชิ้นส่วนใน 3D`);
      for (const element of group) referenced.add(element.id);
    }
    matches = project.elements.filter(element => referenced.has(element.id));
  }
  if (!matches.length) {
    matches = project.elements.filter(element => element.name && text.includes(normalize(element.name)));
    if (!matches.length && category) matches = project.elements.filter(element => element.category === category);
    if (floor && matches.length) matches = matches.filter(element => matchesFloor(element, floor));
    if (!matches.length && (category || floor)) throw Error('ไม่พบชิ้นส่วนตามคำสั่ง กรุณาเลือกชิ้นใน 3D แล้วใช้ “ชิ้นที่เลือก”');
  }
  if (!matches.length && selected) matches = [selected];
  if (!matches.length) throw Error('ระบุ ID หรือเลือกชิ้นส่วนที่ต้องการแก้ใน 3D');
  if (matches.length > MAX_EDIT_TARGETS) throw Error(`คำสั่งครอบคลุม ${matches.length} ชิ้น กรุณาแบ่งแก้ครั้งละไม่เกิน ${MAX_EDIT_TARGETS} ชิ้น`);
  if (matches.length > 1 && !bulk && !matches.every(element => mentions(text, element.id))) {
    throw Error(`พบหลายชิ้น: ${matches.map(element => element.id).join(', ')} กรุณาระบุ ID หรือเลือกชิ้นใน 3D`);
  }
  return matches;
}

// Compare rotated XY envelopes, so nearby context includes landings/floors at both ends.
const radius = element => Math.hypot(element.size[0], element.size[1]) / 2;
const distance = (a, b) => Math.hypot(
  Math.max(0, Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]) - radius(a) - radius(b)),
  Math.max(0, Math.abs(a.position[2] - b.position[2]) - (a.size[2] + b.size[2]) / 2),
);

export function buildEditContext(project, options) {
  const targets = resolveEditTargets(project, options);
  const ids = new Set(targets.map(element => element.id));
  const nearby = project.elements.filter(element => !ids.has(element.id))
    .map(element => ({element, distance: Math.min(...targets.map(target => distance(element, target)))}))
    .filter(item => item.distance <= 2).sort((a, b) => a.distance - b.distance).slice(0, Math.min(100, Math.max(40, targets.length * 2)));
  for (const {element} of nearby) ids.add(element.id);
  // Never truncate host/child dependencies. All openings of an included wall are needed.
  let expanded;
  do {
    expanded = false;
    for (const element of project.elements) {
      if ((ids.has(element.id) && element.hostId && !ids.has(element.hostId)) || (element.hostId && ids.has(element.hostId) && !ids.has(element.id))) {
        ids.add(element.id); if (element.hostId) ids.add(element.hostId); expanded = true;
      }
    }
  } while (expanded);
  if (ids.size > MAX_EDIT_CONTEXT) throw Error('ส่วนที่เชื่อมต่อมีข้อมูลมากเกินไป กรุณาแบ่งพื้นที่แก้ไขให้เล็กลง');
  const elements = project.elements.filter(element => ids.has(element.id));
  const context = {
    projectId: project.id,
    summary: {name: project.name.slice(0, 200), description: project.description.slice(0, 1200), totalElements: project.elements.length, units: 'metres', axis: 'Z up'},
    targetIds: targets.map(element => element.id),
    elements: structuredClone(elements),
  };
  validateEditContext(context);
  return context;
}

export function validateEditContext(context) {
  if (!context || typeof context.projectId !== 'string' || !context.projectId || !context.summary || typeof context.summary.name !== 'string' || typeof context.summary.description !== 'string' || context.summary.name.length > 200 || context.summary.description.length > 1200) throw Error('บริบทโครงการไม่ถูกต้อง');
  if (Object.keys(context).some(key => !['projectId', 'summary', 'targetIds', 'elements'].includes(key)) || Object.keys(context.summary).some(key => !['name', 'description', 'totalElements', 'units', 'axis'].includes(key)) || !Number.isInteger(context.summary.totalElements) || context.summary.totalElements < 1 || context.summary.totalElements > 10000 || context.summary.units !== 'metres' || context.summary.axis !== 'Z up') throw Error('บริบทแก้ไขต้องมีเฉพาะสรุปและชิ้นส่วนที่เกี่ยวข้อง');
  if (!Array.isArray(context.elements) || !context.elements.length || context.elements.length > MAX_EDIT_CONTEXT || !context.elements.every(validateElement)) throw Error('ข้อมูลชิ้นส่วนสำหรับแก้ไขไม่ถูกต้อง');
  const ids = new Set(context.elements.map(element => element.id));
  if (ids.size !== context.elements.length || !Array.isArray(context.targetIds) || !context.targetIds.length || context.targetIds.length > MAX_EDIT_TARGETS || new Set(context.targetIds).size !== context.targetIds.length || !context.targetIds.every(id => ids.has(id))) throw Error('ขอบเขตชิ้นส่วนสำหรับแก้ไขไม่ถูกต้อง');
  if (JSON.stringify(context).length > 250000) throw Error('ข้อมูลเฉพาะส่วนยาวเกินไป กรุณาแบ่งคำสั่ง');
  const issue = inspectModel(context.elements).find(issue => issue.code.startsWith('opening-'));
  if (issue) throw Error('ตรวจความสัมพันธ์ช่องเปิดในพื้นที่นี้ก่อนแก้: ' + issue.message);
  return context;
}

const editableFields = new Set(['category', 'name', 'position', 'size', 'rotation', 'zone', 'material', 'source', 'confidence', 'properties', 'roofStyle', 'hostId', 'steps', 'cover', 'barDiameter', 'barSpacing']);
const optionalFields = new Set(['rotation', 'properties', 'roofStyle', 'hostId', 'steps', 'cover', 'barDiameter', 'barSpacing']);
const changedElement = (element, changes) => {
  const next = {...element};
  for (const [key, value] of Object.entries(changes)) {
    if (!editableFields.has(key)) throw Error('AI แก้ฟิลด์ที่ไม่รองรับ: ' + key);
    if (value === null && optionalFields.has(key)) delete next[key]; else next[key] = value;
  }
  if (!validateElement(next)) throw Error('ค่าที่แก้ไขไม่ผ่านการตรวจขนาด/ตำแหน่ง: ' + element.id);
  return next;
};

// A drawing callout is not always a unique model ID.  Older/less reliable
// agent responses may return a complete element in `adds` even though its ID
// already exists in the selected target set.  Treat that as a replacement of
// the selected element, while keeping the patch contract and concurrency
// checks intact.  Distinct new elements that repeat a callout get a stable
// suffix so one bad ID cannot discard the whole update.
function replacementChanges(element) {
  const changes = {};
  for (const field of editableFields) {
    if (Object.prototype.hasOwnProperty.call(element, field)) changes[field] = element[field];
    else if (optionalFields.has(field)) changes[field] = null;
  }
  return changes;
}

function uniqueAdditionId(base, used) {
  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (used.has(candidate)) candidate = `${base}-${++suffix}`;
  return candidate;
}

export function normalizeEditPatch(patch, context) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Array.isArray(patch.updates) || !Array.isArray(patch.adds) || !Array.isArray(patch.removes) || !Array.isArray(patch.notes)) return patch;
  const targets = new Set(context.targetIds);
  const existing = new Map(context.elements.map(element => [element.id, element]));
  const protectedIds = new Set([...patch.updates.map(update => update?.id), ...patch.removes]);
  const replacementIds = new Set();
  const usedIds = new Set([...existing.keys(), ...patch.updates.map(update => update?.id), ...patch.removes]);
  const updates = [...patch.updates];
  const additions = [];
  const notes = [...patch.notes];

  for (const element of patch.adds) {
    const id = element?.id;
    const target = typeof id === 'string' ? existing.get(id) : undefined;
    // Convert only an existing ID that is an explicit edit target. A
    // read-only/context ID must still be rejected by validateEditPatch.
    if (target && targets.has(id) && !protectedIds.has(id) && !replacementIds.has(id)) {
      updates.push({id, changes: replacementChanges(element)});
      replacementIds.add(id);
      continue;
    }

    let next = element;
    if (typeof id === 'string' && usedIds.has(id)) {
      // Keep an explicit update/remove collision invalid. Only re-key an
      // additional complete element after the first operation for that ID.
      if (protectedIds.has(id) && !replacementIds.has(id)) {
        additions.push(element);
        continue;
      }
      const nextId = uniqueAdditionId(id, usedIds);
      next = {...element, id: nextId};
      notes.push(`ระบบเปลี่ยนรหัสชิ้นส่วนใหม่ที่ซ้ำ ${id} เป็น ${nextId}`);
    }
    if (typeof next?.id === 'string') usedIds.add(next.id);
    additions.push(next);
  }

  return {...patch, updates, adds: additions, notes: [...new Set(notes)].slice(0, 20)};
}

export function validateEditPatch(patch, context) {
  validateEditContext(context);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['updates', 'adds', 'removes', 'notes'].includes(key))) throw Error('AI ต้องคืนรายการแก้ไขเฉพาะส่วน ไม่ใช่โมเดลทั้งชุด');
  if (!['updates', 'adds', 'removes', 'notes'].every(key => Array.isArray(patch[key]))) throw Error('รายการแก้ไขจาก AI ไม่ครบ');
  if (patch.updates.length + patch.adds.length + patch.removes.length > MAX_EDIT_OPERATIONS || patch.notes.length > 20 || !patch.notes.every(note => typeof note === 'string' && note.length <= 2000)) throw Error('รายการแก้ไขยาวเกินขอบเขต');
  const targets = new Set(context.targetIds), seen = new Set();
  for (const update of patch.updates) {
    if (!update || Object.keys(update).some(key => !['id', 'changes'].includes(key)) || !targets.has(update.id) || !update.changes || typeof update.changes !== 'object' || Array.isArray(update.changes)) throw Error('AI แก้ชิ้นส่วนนอกขอบเขต');
    if (seen.has(update.id)) throw Error('AI แก้ ID ซ้ำ: ' + update.id);
    seen.add(update.id);
    changedElement(context.elements.find(element => element.id === update.id), update.changes);
  }
  for (const id of patch.removes) {
    if (!targets.has(id) || seen.has(id)) throw Error('AI ลบชิ้นส่วนนอกขอบเขตหรือ ID ซ้ำ');
    seen.add(id);
  }
  for (const element of patch.adds) {
    if (!validateElement(element) || seen.has(element.id) || context.elements.some(existing => existing.id === element.id)) throw Error('ชิ้นส่วนใหม่ไม่ถูกต้องหรือ ID ซ้ำ');
    if (Math.min(...context.elements.filter(target => targets.has(target.id)).map(target => distance(element, target))) > 5) throw Error('ชิ้นส่วนใหม่อยู่นอกพื้นที่แก้ไข');
    seen.add(element.id);
  }
  const localIds = new Set([...context.elements.map(element => element.id), ...patch.adds.map(element => element.id)]);
  if (patch.adds.some(element => element.hostId && !localIds.has(element.hostId)) || patch.updates.some(update => update.changes.hostId && !localIds.has(update.changes.hostId))) throw Error('ผนังเจ้าของช่องเปิดอยู่นอกบริบทที่ส่งให้ AI');
  return patch;
}

function issuesForElement(element, elements) {
  const host = elements.find(other => other.id === element.hostId);
  const issues = inspectModel(host ? [element, host] : [element]).filter(issue => issue.code.startsWith('opening-') && issue.ids.includes(element.id));
  for (const other of elements) {
    if (other.id === element.id) continue;
    const sharedHost = ['door', 'window'].includes(element.category) && ['door', 'window'].includes(other.category) && element.hostId && element.hostId === other.hostId;
    if (!sharedHost && (element.category !== other.category || ['rebar', 'railing'].includes(element.category))) continue;
    if (boxesOverlap(element, other)) issues.push({code: sharedHost ? 'opening-overlap' : 'box-overlap', ids: [element.id, other.id], message: sharedHost ? 'ช่องประตู/หน้าต่างซ้อนทับกันบนผนังเดียวกัน' : 'ขอบเขตชิ้นส่วนประเภทเดียวกันซ้อนทับ'});
  }
  return issues;
}
const issueKey = issue => issue.code + ':' + [...issue.ids].sort().join(',');

// Apply against the live model, never replace it with the snapshot sent to AI.
export function applyEditPatch(project, patch, context) {
  patch = normalizeEditPatch(structuredClone(patch), context);
  validateEditPatch(patch, context);
  if (project.id !== context.projectId) throw Error('ผลแก้ไขเป็นของโครงการอื่น');
  for (const base of context.elements) {
    if (!same(project.elements.find(element => element.id === base.id), base)) throw Error(`ชิ้นส่วน ${base.id} มีการแก้ไขระหว่างรอ AI กรุณาส่งคำสั่งใหม่ด้วยข้อมูลล่าสุด`);
  }
  if (project.elements.some(element => element.hostId && context.elements.some(base => base.id === element.hostId) && !context.elements.some(base => base.id === element.id))) throw Error('มีช่องเปิดเพิ่มขึ้นในพื้นที่ระหว่างรอ AI กรุณาส่งคำสั่งใหม่');
  if (patch.adds.some(element => project.elements.some(existing => existing.id === element.id))) throw Error('ID ชิ้นส่วนใหม่ซ้ำกับโมเดลล่าสุด');
  const removed = new Set(patch.removes);
  for (const element of project.elements) if (element.hostId && removed.has(element.hostId)) removed.add(element.id);
  let elements = project.elements.filter(element => !removed.has(element.id));
  elements = [...elements, ...patch.adds.map(element => ({...element, revision: 1}))];
  const updates = new Map(patch.updates.map(update => [update.id, update.changes]));
  if (patch.updates.some(update => removed.has(update.id))) throw Error('ไม่สามารถแก้ช่องเปิดที่ถูกลบพร้อมผนัง');
  // Transform existing hosted children, then apply explicit changes in global coordinates.
  // Validate the final batch, so resizing a wall and its openings together is atomic.
  elements = elements.map(element => {
    let next = element;
    const previousHost = project.elements.find(host => host.id === element.hostId);
    const hostChanges = previousHost && updates.get(previousHost.id);
    if (hostChanges && project.elements.some(previous => previous.id === element.id)) {
      const host = changedElement(previousHost, hostChanges), angle = ((host.rotation || 0) - (previousHost.rotation || 0)) * Math.PI / 180;
      const dx = element.position[0] - previousHost.position[0], dy = element.position[1] - previousHost.position[1];
      if (angle || !same(host.position, previousHost.position)) next = {...element, position: [host.position[0] + dx * Math.cos(angle) - dy * Math.sin(angle), host.position[1] + dx * Math.sin(angle) + dy * Math.cos(angle), host.position[2] + element.position[2] - previousHost.position[2]], rotation: normalizedAngle((element.rotation || 0) + (host.rotation || 0) - (previousHost.rotation || 0)), revision: element.revision + 1};
    }
    const changes = updates.get(element.id);
    if (changes) {
      next = changedElement(next, changes);
      next = {...next, revision: element.revision + 1};
      if (next.rotation !== undefined) next.rotation = normalizedAngle(next.rotation);
    }
    return next;
  });
  const changedIds = new Set([...removed, ...elements.filter(element => !same(element, project.elements.find(previous => previous.id === element.id))).map(element => element.id)]);
  const previousIssues = new Set(project.elements.filter(element => changedIds.has(element.id)).flatMap(element => issuesForElement(element, project.elements)).map(issueKey));
  // Pairwise checks against the full model avoid the general inspector's 100-issue cap.
  for (const element of elements.filter(element => changedIds.has(element.id))) {
    const issue = issuesForElement(element, elements).find(issue => !previousIssues.has(issueKey(issue)));
    if (issue) throw Error('ผลแก้ไขทำให้เกิดปัญหา: ' + issue.message + ' (' + issue.ids.join(', ') + ')');
  }
  const activities = removed.size ? project.activities.map(activity => activity.elementIds ? {...activity, elementIds: activity.elementIds.filter(id => !removed.has(id))} : activity) : project.activities;
  const next = {...project, elements, activities};
  if (!validateProject(next)) throw Error('ผลแก้ไขไม่ผ่านการตรวจโมเดลและแผนงาน');
  return next;
}
