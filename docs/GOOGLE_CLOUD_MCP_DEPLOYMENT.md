# คู่มือติดตั้ง CMG MCP บน Google Cloud

เอกสารนี้เป็นขั้นตอนนำระบบที่อยู่ใน repository ขึ้นใช้งานจริง โดยใช้ MCP เป็นช่องทาง AI เดียวในหน้าแชทและหน้าสร้างโมเดล

## ภาพรวม

```text
CMG Webapp (Firebase Hosting)
        │
        └─ /api/mcp/trigger ─► Cloud Tasks ─► Cloud Run worker
                                             ├─ OpenAI / Anthropic / Google
                                             └─ Custom MCP /mcp ─► Firebase Admin SDK ─► Firestore/Storage
```

ผู้ให้บริการที่เลือกเรียก MCP ผ่าน URL ที่เข้าถึงจากอินเทอร์เน็ตได้ จึงต้องใช้ URL ของ Cloud Run จริง ไม่ใช่ `localhost` และต้องส่ง Bearer token ของ MCP server ทุกครั้ง

## สิ่งที่ต้องมีใน Google Cloud

1. Google Cloud project ที่ใช้กับ Firebase (`cmg-4d-platform` ในชุดปัจจุบัน)
2. เปิด APIs: Cloud Run, Cloud Build, Cloud Tasks, Artifact Registry, Secret Manager, Firestore และ Firebase Authentication
3. ติดตั้ง Google Cloud CLI แล้วรัน `gcloud auth login` และ `gcloud auth application-default login`
4. สร้าง Artifact Registry repository ชื่อ `cmg` ใน region `asia-southeast1`
5. สร้าง service account สำหรับ Cloud Run เช่น `cmg-api-runtime`
6. ให้ service account มีสิทธิ์อ่าน/เขียน Firestore ตามงานของระบบ และอ่าน secret ต่อไปนี้จาก Secret Manager:
   - `mcp-server-token`
   - `mcp-scope-secret`
   Provider API Key ทั้งสามค่ายให้ MasterAdmin บันทึกจากหน้า Admin ลง Firebase

ตัวอย่าง IAM ขั้นต่ำสำหรับ service account ของ runtime:

```powershell
gcloud iam service-accounts create cmg-api-runtime --display-name="CMG API Runtime"
gcloud projects add-iam-policy-binding cmg-4d-platform --member="serviceAccount:cmg-api-runtime@cmg-4d-platform.iam.gserviceaccount.com" --role="roles/datastore.user"
gcloud projects add-iam-policy-binding cmg-4d-platform --member="serviceAccount:cmg-api-runtime@cmg-4d-platform.iam.gserviceaccount.com" --role="roles/storage.objectViewer"
gcloud secrets add-iam-policy-binding mcp-server-token --member="serviceAccount:cmg-api-runtime@cmg-4d-platform.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding mcp-scope-secret --member="serviceAccount:cmg-api-runtime@cmg-4d-platform.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud projects add-iam-policy-binding cmg-4d-platform --member="serviceAccount:cmg-api-runtime@cmg-4d-platform.iam.gserviceaccount.com" --role="roles/cloudtasks.enqueuer"
```

งาน AI ต้องผ่าน Cloud Tasks เพราะ Firebase Hosting ตัด request ที่ทำงานเกิน 60 วินาที คำสั่งเริ่มงานจึงส่งงานเข้าคิวและตอบกลับทันที ส่วน worker รับงานจาก Cloud Tasks โดยตรงที่ Cloud Run:

```powershell
gcloud services enable cloudtasks.googleapis.com --project=cmg-4d-platform
gcloud tasks queues create cmg-mcp --location=asia-southeast1 --max-dispatches-per-second=2 --max-concurrent-dispatches=10 --project=cmg-4d-platform
```

สร้างคิวครั้งเดียว หากมีคิว `cmg-mcp` อยู่แล้วให้ข้ามคำสั่ง create ได้ Cloud Run runtime service account ต้องมี `roles/cloudtasks.enqueuer` เพื่อส่งงานเข้าคิว

ค่าของ `mcp-server-token` และ `mcp-scope-secret` ต้องเป็นค่าลับแบบสุ่มยาวอย่างน้อย 32 ตัวอักษร และต้องไม่ใช้ค่าเดียวกัน

สร้างชื่อ secret ก่อน แล้วเพิ่มค่า secret จริงผ่าน Google Cloud Console หรือ Secret Manager CLI:

```powershell
gcloud secrets create mcp-server-token --replication-policy=automatic
gcloud secrets create mcp-scope-secret --replication-policy=automatic
```

## Deploy Cloud Run

จากโฟลเดอร์ repository:

```powershell
gcloud config set project cmg-4d-platform
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com
gcloud artifacts repositories create cmg --repository-format=docker --location=asia-southeast1
gcloud builds submit --config cloudbuild.yaml --substitutions=_AGENT_TRIGGER_ID="",_RUNTIME_SERVICE_ACCOUNT="cmg-api-runtime@cmg-4d-platform.iam.gserviceaccount.com"
```

ถ้า repository หรือ secret มีอยู่แล้ว คำสั่ง create จะฟ้องว่าเคยมีอยู่ ให้ข้ามเฉพาะคำสั่งนั้นได้

หลัง deploy ให้ตรวจ:

```powershell
gcloud run services describe cmg-4d-api --region=asia-southeast1 --format="value(status.url)"
Invoke-WebRequest https://URL_CLOUD_RUN/health
Invoke-WebRequest https://URL_CLOUD_RUN/mcp/health
```

`/health` ต้องตอบ `ok: true` และ `/mcp/health` ต้องตอบ `configured: true`

## ตั้งค่า Firebase Hosting

`firebase.json` มี rewrite ให้ `/api/*` และ `/mcp` ไป Cloud Run แล้ว ส่วนหน้าเว็บให้ build ก่อน deploy:

```powershell
npm ci
npm run build
firebase use cmg-4d-platform
firebase deploy --only hosting,firestore:rules,storage
```

ถ้าชื่อ Cloud Run หรือ region เปลี่ยน ให้แก้ `serviceId` และ `region` ใน `firebase.json` ให้ตรงกันก่อน deploy

## ตั้งค่า AI ที่จะเรียก MCP

หน้า Admin ใช้บันทึก API Key ของ OpenAI, Anthropic และ Google AI Studio ใน Firebase ระบบไม่ส่ง Key ไปยัง browser และไม่ต้องตั้ง `VITE_` ตัวแปรสำหรับ Key ผู้ให้บริการ

เซิร์ฟเวอร์ใช้ `MCP_PUBLIC_URL`, `MCP_SERVER_TOKEN` และ `MCP_SCOPE_SECRET` เพื่อให้ผู้ให้บริการที่เลือกเรียก Custom MCP ได้อย่างปลอดภัย OpenAI ใช้ Responses MCP ส่วน Anthropic และ Google ใช้ MCP bridge ฝั่งเซิร์ฟเวอร์

## ทดสอบจากหน้าเว็บ

1. ล็อกอินด้วยผู้ใช้ที่ได้รับอนุมัติและมี role ใช้ AI
2. เปิดโครงการที่มีสิทธิ์
3. เปิด `Chat AI · แก้ไขโมเดล 3D`
4. เลือกค่าย โมเดล และระดับการคิดในช่อง MCP
5. ทดลองคำสั่งอ่าน เช่น “สรุปจำนวนชิ้นส่วนของโครงการนี้”
6. ทดลองแก้แบบเล็ก ๆ เช่น “ขยับเสานี้ไปทางขวา 0.10 เมตร”
7. ตรวจ version ของโครงการและรายการ audit ใน Firestore

## เกณฑ์พร้อมใช้งานจริง

- การสร้างและแก้โมเดลส่งผ่าน `/api/mcp/trigger` ได้ HTTP 202 ก่อนเริ่มงาน และใช้ Cloud Tasks/worker ผ่าน MCP เท่านั้น
- `/mcp/health` แสดง `configured: true` และ `taskQueue: "cloud_tasks"`
- MCP health เป็น `configured: true`
- MCP trigger ได้ HTTP 202 และสร้างรายการใน `CMG-4D-Platform/root/mcpRequests`
- MCP อ่านข้อมูลได้เฉพาะ project ที่ user มีสิทธิ์
- patch ที่ version ไม่ตรงถูกปฏิเสธด้วย `PROJECT_CONFLICT`
- patch ที่ผ่าน validation บันทึก revision ใหม่และเพิ่ม version แบบ atomic
- เมื่อผู้ให้บริการทำงานผ่าน MCP เสร็จ หน้าเว็บเห็นสถานะ `done` และข้อความผลลัพธ์
- secret ไม่อยู่ใน frontend, git, หรือ log
- ทดสอบ deploy ใหม่แล้ว rollback image เดิมได้

## ข้อจำกัดที่ต้องรู้

งาน MCP เป็นงานแบบ asynchronous หน้าเว็บจึงแสดงสถานะจาก Firestore แล้ว polling ผลลัพธ์ ไม่ได้รอคำตอบแบบ synchronous ใน HTTP request เดียว

การแก้โมเดลแบบ MCP เน้นงานอ่าน context และ patch เฉพาะจุด เพื่อประหยัด context และลดความเสี่ยงการเขียนทับทั้งโครงการ สำหรับการสร้างโมเดลใหม่จาก PDF/ภาพ OpenAI worker จะแนบไฟล์ที่เลือกจาก Firebase Storage เข้า Responses โดยตรงเพื่อให้โมเดลได้รับทั้งข้อความและภาพหน้าแบบ แล้วใช้ `cmg_read_project_file` เพื่อตรวจ file ID และบริบทในโครงการก่อนบันทึกผ่าน `cmg_create_model`
