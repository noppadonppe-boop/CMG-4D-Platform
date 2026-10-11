# ตั้งค่า Firebase สำหรับ CMG 4D Platform

> ระบบล่าสุดเพิ่ม Authentication, การอนุมัติ, หลาย Role, การแชร์โครงการ และ Realtime แล้ว โปรดใช้ [คู่มือ Authentication ปัจจุบัน](AUTHENTICATION.md) เป็นขั้นตอนหลัก เนื้อหาด้านล่างอธิบายระบบ snapshot เดิมที่ยังเก็บไว้สำหรับเปิดสำเนา

เวอร์ชันนี้แก้ไขงานในเบราว์เซอร์ และเก็บรุ่นบน Firebase แบบกดบันทึก แต่ละรุ่นประกอบด้วยโมเดล แผนงาน คำอธิบาย และไฟล์แนบ เปิดจากอุปกรณ์อื่นเป็นสำเนาใหม่ได้ ไม่มีการเขียนทับรุ่นเดิมหรือซิงก์การแก้ไขอัตโนมัติ

## ตั้งค่าครั้งแรก

1. เปิด Firebase Console เลือกโปรเจ็คที่ต้องการ และเพิ่ม Web App
2. เปิด Authentication → Sign-in method → Google และกำหนดอีเมล support
3. เพิ่ม `localhost` ใน Authentication → Settings → Authorized domains หากยังไม่มี เพิ่มโดเมนที่ใช้จริงเมื่อนำเว็บขึ้น hosting
4. สร้าง Cloud Firestore และ Cloud Storage ตามตำแหน่งข้อมูลขององค์กร ตรวจเงื่อนไข billing ของโปรเจ็คก่อนเปิด Storage
5. เติมไฟล์ `.env` ที่เตรียมไว้ (ดูตัวอย่าง `.env.example`) ด้วย Firebase Web App config ทั้งห้าค่า ห้ามใส่ Service Account หรือ AI secret ในตัวแปร `VITE_` เพราะค่าจะส่งไปยังเบราว์เซอร์
6. นำ `firestore.rules` และ `storage.rules` ไปใส่ในแท็บ Rules ของบริการแต่ละตัว หรือใช้ Firebase CLI:

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules,storage --project YOUR_PROJECT_ID
```

7. สำหรับดาวน์โหลด Blob ผ่าน Storage SDK ต้องตั้งค่า bucket CORS ให้ origin ของเว็บ ดู `storage.cors.example.json` เปลี่ยน origin เป็นโดเมนจริง หากใช้ Google Cloud CLI:

```powershell
gcloud storage buckets update gs://YOUR_BUCKET_NAME --cors-file=storage.cors.example.json
```

8. เริ่ม `npm run dev` ใหม่ เปิดปุ่ม Cloud → เข้าสู่ระบบด้วย Google → บันทึกรุ่นปัจจุบันขึ้น Cloud
9. ทดสอบเปิด Cloud จากเบราว์เซอร์อื่นที่ใช้บัญชีเดียวกัน เปิดรุ่นเป็นสำเนา และตรวจไฟล์แนบ ขนาดชิ้นส่วน และกิจกรรม

อ้างอิง: [Firebase Web setup](https://firebase.google.com/docs/web/setup), [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [Storage download/CORS](https://firebase.google.com/docs/storage/web/download-files#cors_configuration)

## โครงสร้างและสิทธิ์

- Firestore: `users/{uid}/snapshots/{snapshotId}` เก็บชื่อ รหัสโครงการ วันบันทึก และจำนวนชิ้นส่วน/ไฟล์
- Storage: `users/{uid}/snapshots/{snapshotId}/project.json` และ `files/{documentId}`
- Rules ให้เฉพาะบัญชีเจ้าของ UID อ่านและสร้างรุ่นของตน ไม่อนุญาตเขียนทับหรือลบรุ่น ไม่อนุญาตเข้าข้อมูลบัญชีอื่น
- ยังไม่มีการแชร์ทีม สมาชิกองค์กร หรือบทบาท Reviewer อย่าเปลี่ยน Rules เป็น allow-all เพื่อแก้ปัญหาสิทธิ์
- การอัปโหลดข้าม Storage และ Firestore ไม่ใช่ transaction เดียวกัน หากล้มเหลวกลางทางอาจเหลือวัตถุที่ไม่มีรายการรุ่น ผู้ดูแลต้องตรวจและล้างด้วยเครื่องมือผู้ดูแล การลองใหม่สร้าง snapshot ID ใหม่
- จำกัดข้อมูลโมเดล 20 MB, ไฟล์ละ 50 MB และ 200 ไฟล์ต่อรุ่น กำหนด quota/budget ขององค์กรเพิ่มเติมใน Firebase Console

## สถานะการทดสอบ

TypeScript และ build ตรวจได้โดยไม่มี config แต่ Google login, Firestore, Storage, CORS และการบังคับ Rules ต้องทดสอบใน Firebase ของผู้ใช้ก่อนใช้ข้อมูลโครงการจริง ยังไม่ได้รับรอง multi-user production

## Admin API Keys

เข้า Admin → เข้าสู่ระบบด้วย Google → วาง Key ของ OpenAI / Anthropic / Google AI Studio → บันทึก Key สามารถเปลี่ยนหรือลบได้จากการ์ดของค่ายนั้น ช่องแชทเลือกค่าย โมเดล และระดับการคิดก่อนส่งข้อความ โดยใช้ Key ที่อ่านล่าสุดจาก Firestore

Firestore path: `CMG-4D-Platform/root/users/{masterEmail}/apiKeys/{provider}` มี `apiKey` และ `updatedAt` เฉพาะ MasterAdmin ที่ได้รับอนุมัติเท่านั้นที่บันทึก เปลี่ยน หรือลบ Key ได้ แยกเอกสารตาม `openai`, `anthropic`, และ `google`
