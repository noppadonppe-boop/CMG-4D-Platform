const vector3 = value => Array.isArray(value) && value.length === 3 && value.every(number => Number.isFinite(number) && Math.abs(number) <= 1000);
const dimensions3 = value => Array.isArray(value) && value.length === 3 && value.every(number => Number.isFinite(number) && number > 0 && number <= 1000);
const rotation3 = value => value === undefined || (Array.isArray(value) && value.length === 3 && value.every(number => Number.isFinite(number) && Math.abs(number) <= 360));
const validMaterial = value => value === undefined || (typeof value === 'string' && value.length <= 100);

function validPart(part) {
 if (!part || typeof part !== 'object' || !vector3(part.position) || !rotation3(part.rotation) || !validMaterial(part.material)) return false;
 if (part.type === 'box') return dimensions3(part.size);
 if (part.type === 'cylinder') return Number.isFinite(part.diameter) && part.diameter > 0 && part.diameter <= 1000 && Number.isFinite(part.length) && part.length > 0 && part.length <= 1000;
 if (part.type === 'hollowSquareTube') return Number.isFinite(part.width) && part.width > 0 && part.width <= 1000 && Number.isFinite(part.depth) && part.depth > 0 && part.depth <= 1000 && Number.isFinite(part.length) && part.length > 0 && part.length <= 1000 && Number.isFinite(part.wallThickness) && part.wallThickness > 0 && part.wallThickness < Math.min(part.width, part.depth) / 2;
 return false;
}

export function parseCustomGeometry(value) {
 if (typeof value !== 'string' || value.length > 150_000) throw Error('custom geometry ต้องเป็น JSON ขนาดไม่เกิน 150 KB');
 let geometry;
 try { geometry = JSON.parse(value); } catch { throw Error('custom geometry ต้องเป็น JSON ที่ถูกต้อง'); }
 if (!geometry || geometry.version !== 1 || !Array.isArray(geometry.parts) || geometry.parts.length < 1 || geometry.parts.length > 500 || !geometry.parts.every(validPart)) throw Error('custom geometry ต้องมี version 1 และ parts ชนิด box, cylinder หรือ hollowSquareTube ที่มีขนาดและตำแหน่งถูกต้อง');
 return geometry;
}

export function validCustomGeometry(value) {
 try { parseCustomGeometry(value); return true; } catch { return false; }
}
