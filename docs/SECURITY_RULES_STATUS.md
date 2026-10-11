# สถานะ Security Rules ปัจจุบัน (CMG 4D Platform)

บันทึกเมื่อ 2026-10-09 จากการอ่านไฟล์ `firestore.rules` และ `storage.rules` ใน working tree ตอนนั้น
ทั้งสองไฟล์ **ยังไม่ได้ commit** (HEAD `0645663` ยังเป็นเวอร์ชันเก่าที่เปิดแค่ `users/{uid}/snapshots`)

> เอกสารนี้อ่านอย่างเดียว ไม่มีการแก้ไฟล์ rules ใดๆ
> ไม่ได้รันชุดทดสอบ (`tests/firebase-*.mjs`) ในรอบนี้ จึงยังไม่ได้ยืนยันว่า rules ทำงานตามที่เขียนไว้

## บทบาทและเงื่อนไขกลางที่ใช้ในทั้งสองไฟล์

| ฟังก์ชัน | ความหมาย |
|---|---|
| `signedIn()` | login แล้ว และ token มี email |
| `approved()` | โปรไฟล์ที่ `CMG-4D-Platform/root/users/{email}` มี `uid` ตรงกับผู้ใช้ และ `status == 'approved'` |
| `master()` | approved และมีบทบาท `MasterAdmin` |
| `editor()` | approved และมีบทบาทใดบทบาทหนึ่งใน `MasterAdmin, SuperAdmin, Admin, Staff, Modeler, Planner` (`Viewer` อ่านได้อย่างเดียว) |
| `access(id)` | approved และเป็น master หรือมี `uid` อยู่ใน `projects/{id}.memberUids` |

## Firestore (`firestore.rules`)

ฐานข้อมูลทั้งหมดอยู่ใต้ `CMG-4D-Platform/root`

| Path | อ่าน | เขียน |
|---|---|---|
| `CMG-4D-Platform/root` (ตัวเอกสาร) | master | ปฏิเสธทั้งหมด |
| `appMeta/config` | signedIn ทุกคน | create: ผู้ใช้คนแรกเท่านั้น (`totalUsers == 1`, `masterUid` = ตัวเอง). update: เพิ่ม `totalUsers` ทีละ 1 ตอนสมัครใหม่ และแก้ได้แค่ `totalUsers`, `lastRegisteredEmail` |
| `users/{email}` | เจ้าของ email หรือ approved ทุกคน | create: เฉพาะ email ตัวเอง `version == 1`. คนแรกได้ `['MasterAdmin']` + `approved`. คนถัดไปได้ `['Staff']` + `pending`. update: ต้อง `version + 1`; master แก้ได้ทุกอย่าง, เจ้าของแก้ได้แค่ `firstName, lastName, position, department`, การมอบหมายโปรเจกต์ผ่าน `assignment()` |
| `users/{email}/apiKeys/{provider}` | master และ email ตรงกับตัวเอง | create/update/delete: เงื่อนไขเดียวกัน, provider เป็น `openai`, `anthropic`, `google`, มีเฉพาะ `apiKey` (8 ถึง 4096 ตัวอักษร) กับ `updatedAt` |
| `projects/{id}` | approved และเป็น master หรืออยู่ใน `memberUids` | create: editor, `memberUids == [uid ตัวเอง]`, `version == 0`. update: ต้องมี `access(id)`, `version + 1`, `chunkCount` 1 ถึง 150. แก้เนื้อหาต้องเป็น editor. แก้สมาชิกต้องเป็น master หรือ owner และเปลี่ยนทีละ 1 คน |
| `projects/{id}/revisions/{rev}/chunks/{i}` | `access(id)` | create: `access(id)` และ editor, `json` ไม่เกิน 900000 ตัวอักษร. ไม่มี update/delete |
| `activityLogs/{id}` | master | create: signedIn, `action` เป็น `REGISTER` หรือ `LOGIN`, `uid`/`email` ตรงกับตัวเอง |
| `{model\|schedule\|documents\|history}/{id}` | master | ไม่มี (ปฏิเสธ) |
| `users/{uid}/apiKeys/{provider}` (เส้นทางตาม uid) | master และ uid ตรงกับตัวเอง | เงื่อนไขเดียวกับของ `{email}` |
| `users/{uid}/snapshots/{id}` | approved และ uid ตรงกับตัวเอง | create: editor, `access(projectId)`, `schemaVersion == 1`. ไม่มี update/delete |

## Storage (`storage.rules`)

| Path | อ่าน | เขียน |
|---|---|---|
| `CMG-4D-Platform/root/projects/{id}/files/{fileId}` | `access(id)` | create: ไฟล์ใหม่เท่านั้น (`resource == null`), `access(id)` และ editor, ไม่เกิน 50 MB. update/delete ปฏิเสธ |
| `users/{uid}/snapshots/{snapshotId}/**` | approved และ uid ตรงกับตัวเอง | create: ไฟล์ใหม่เท่านั้น, editor, uid ตรงกับตัวเอง, ไม่เกิน 50 MB. update/delete ปฏิเสธ |

## สิ่งที่เปลี่ยนจาก HEAD (`0645663`)

- เดิมมีกฎเดียว คือ snapshot ของเจ้าของ (ทั้ง Firestore และ Storage) ตอนนี้เพิ่มระบบผู้ใช้ที่ต้องอนุมัติ, บทบาท, โปรเจกต์แบบมีสมาชิก, revision แบบ chunk, activity log และ API key
- การอ่าน snapshot เปลี่ยนจาก "แค่เป็นเจ้าของ" เป็น "ต้อง approved ด้วย"
- การสร้าง snapshot ใน Firestore ต้องเป็น editor และมีสิทธิ์ในโปรเจกต์นั้น
- **ข้อจำกัดฟิลด์ที่ไม่มีในเวอร์ชันใหม่** (เวอร์ชันเก่าตรวจไว้ ตอนนี้ไม่ได้ตรวจ):
  - `name.size() <= 500`
  - `projectId is string` และ `size() <= 200`
  - `elementCount` และ `documentCount` อยู่ในช่วง 0 ถึง 10000 และ 0 ถึง 200
  - เวอร์ชันใหม่ตรวจแค่ `is string` / `is int` ของบางฟิลด์

## ข้อสังเกต (เพื่อประกอบการตัดสินใจ ยังไม่ได้แก้อะไร)

1. snapshot ใน Firestore ตรวจ `access(projectId)` แต่ snapshot ใน Storage ไม่ตรวจโปรเจกต์ ตรวจแค่ editor และ uid ตรงกับตัวเอง
2. `users/{email}` อ่านได้โดย approved ทุกคน จึงเห็นโปรไฟล์ของคนอื่นทั้งหมด (ชื่อ ตำแหน่ง บทบาท โปรเจกต์ที่ถูกมอบหมาย)
3. `appMeta/config` อ่านได้โดยทุกคนที่ login แล้ว (รวมคนที่ยัง pending)
4. API key เก็บเป็นข้อความธรรมดาใน Firestore และมีสองเส้นทางที่ใช้ได้พร้อมกัน (`root/users/{email}/apiKeys` กับ `users/{uid}/apiKeys`) ทั้งสองจำกัดให้ master อ่านของตัวเองเท่านั้น
5. ทุก request ที่ผ่าน `approved()` ต้องอ่านเอกสารโปรไฟล์เพิ่มหนึ่งครั้ง และ `access()` อ่านเอกสารโปรเจกต์เพิ่มอีกหนึ่งครั้ง ซึ่งนับเป็นการอ่านที่คิดค่าใช้จ่าย
6. ไฟล์ `firestore.rules` เขียนแบบบีบเป็นบรรทัดยาว (บาง rule ยาวหลายร้อยตัวอักษร) อ่านและ review ยาก

## ที่เกี่ยวข้อง

- ชุดทดสอบ rules: `tests/firebase-auth.mjs`, `tests/firebase-keys.mjs`, `tests/firebase-storage.mjs` และ `firebase.test.json`
- เอกสารอื่น: `docs/AUTHENTICATION.md`, `docs/FIREBASE_SETUP.md`
