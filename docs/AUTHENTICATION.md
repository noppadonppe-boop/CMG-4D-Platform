# Firebase Authentication และสิทธิ์โครงการ

ระบบใช้หน้าตา workspace เดิม โดยจัดการผู้ใช้ภายใน body ของ workspace เมนูอยู่ท้าย Sidebar และแสดงเฉพาะ MasterAdmin

## เปิดใช้งานกับ Firebase จริง

1. ใช้ Firebase Web App config ใน `.env` ตาม `.env.example` เปิด Authentication providers **Email/Password** และ **Google** และเพิ่มโดเมนเว็บใน Authorized domains
2. เผยแพร่ `firestore.rules` และ `storage.rules` ให้ Firebase project ที่กำหนดใน `.env`
3. ฝั่ง Node server ใช้ Firebase Admin SDK และ Application Default Credentials ตั้ง `GOOGLE_APPLICATION_CREDENTIALS` เป็น path ของ service account ที่มีสิทธิ์ Firebase Authentication / Firestore หรือใช้ service identity ของ hosting ห้ามใช้ตัวแปร `VITE_` สำหรับ credential นี้
4. เริ่ม `npm run dev` หรือ `npm run build` แล้ว `npm start` ผู้ใช้ที่สร้างโปรไฟล์คนแรกจะได้ MasterAdmin / approved ผ่าน transaction ผู้ใช้ต่อมาจะได้ Staff / pending
5. MasterAdmin เข้าเมนูจัดการผู้ใช้งานเพื่ออนุมัติ เลือกหลาย Role และ Assign Project และใช้ Admin เดิมเพื่อจัดการ API Key

`Username` ในฟอร์มคืออีเมลของ Firebase Authentication บัญชีที่มี role หลายรายการจะได้สิทธิ์รวม ไม่มีระบบบังคับ logout ตามเวลาท้องถิ่น Firebase จัดการการ refresh token และใช้ browserLocalPersistence

## โครงสร้างข้อมูล

- `CMG-4D-Platform/root/users/{email}`: โปรไฟล์, `role: UserRole[]`, สถานะ, assignedProjects, รูป Google และ version
- `CMG-4D-Platform/root/users/{masterEmail}/apiKeys/{provider}`: Key ที่ MasterAdmin เพิ่ม/เปลี่ยน/ลบแยกตามผู้ให้บริการ และใช้โดย MCP server
- `CMG-4D-Platform/root/appMeta/config`: firstUserRegistered, totalUsers, createdAt, masterUid, masterEmail และ lastRegisteredEmail
- `CMG-4D-Platform/root/projects/{projectId}`: ownerUid, memberUids และ metadata ของรุ่น
- `.../projects/{projectId}/revisions/{revision}/chunks/{index}`: โมเดล แผนงาน เอกสาร และประวัติของโครงการนั้น เป็นข้อมูล immutable แต่ละรุ่น
- Storage `CMG-4D-Platform/root/projects/{projectId}/files/{documentId}`: ไฟล์แนบของโครงการ
- `CMG-4D-Platform/root/activityLogs/{id}`: REGISTER / LOGIN เขียนแบบ non-blocking

memberUids เป็นตัวบังคับสิทธิ์อ่านโครงการ เจ้าของอยู่ในรายชื่อนี้เสมอ การ Assign/ถอนสิทธิ์อัปเดต memberUids และ assignedProjects ใน transaction เดียวกัน เจ้าของแชร์ได้เฉพาะโครงการตนเอง MasterAdmin เข้าถึงทุกโครงการได้

ข้อมูลเก่าใน localStorage / snapshot ยังไม่ถูกลบ แต่ไม่แสดงเป็นโครงการที่ได้รับสิทธิ์อัตโนมัติ ส่งออก JSON จากระบบเดิมแล้วนำเข้า หรือเปิดรุ่นสำรองด้วย Cloud เพื่อสร้างโครงการที่มีเจ้าของและสิทธิ์ใหม่ MCP server ยังอ่าน Key จากเส้นทาง uid เดิมได้เมื่อเส้นทางอีเมลยังไม่มี Key เพื่อรองรับการตั้งค่าเก่า

## AuthContext และ LoginPage

ไฟล์จริง: `src/AuthContext.tsx`, `src/AuthPages.tsx`, `src/authService.ts`

```tsx
// AuthContext: รอ Firebase คืนสถานะ ก่อนเปิดหน้า login
useEffect(() => {
  const stop = onAuthStateChanged(auth, user => {
    setUser(user);
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    // โค้ดจริงติดตาม profile ด้วย onSnapshot และยกเลิก listener เก่า
    // loading จะจบเมื่อได้ผลโปรไฟล์ จึงไม่มีการกระพริบหน้า Login
  });
  return stop;
}, []);
```

```tsx
// LoginPage: guard นี้อยู่ก่อน JSX ของฟอร์ม
if (loading) return <AuthSpinner />;
if (firebaseUser && !userProfile) return <ProfileWait />;

async function googleLogin() {
  await loginWithGoogle();
  await refreshProfile();
}

// โค้ดจริงใช้ useEffect watching userProfile:
// pending -> /pending, approved -> original destination หรือ /dashboard
// rejected -> แสดงข้อผิดพลาดและปุ่ม Logout
```

```tsx
<ProtectedRoute requireApproved requireRoles={['SuperAdmin', 'Admin']}>
  <YourPage />
</ProtectedRoute>
```

MasterAdmin ผ่าน whitelist ทุก Role เส้นทาง `/login`, `/register`, `/pending`, `/dashboard` และ `/admin` รองรับ reload โดยเซิร์ฟเวอร์คืน index.html

## Realtime และการแก้ไขพร้อมกัน

`src/useProjects.ts` ใช้ onSnapshot และบันทึกอัตโนมัติหลังหยุดแก้ 700 ms การเขียนรุ่นตรวจ version ใน transaction การแก้คนละ field / element รวมกันด้วย three-way merge หากแก้ field เดียวกันจะแจ้ง conflict และคงข้อความที่กรอกไว้ ผู้ใช้ตรวจข้อมูลก่อนกดบันทึกฉบับของตนเอง สามารถส่งออก JSON ของ draft ได้

ฟอร์มชิ้นส่วนและผู้ใช้เก็บ draft แยกจากข้อมูล server ข้อมูลที่ยังไม่ได้แก้ติดตาม realtime และข้อมูลที่กำลังกรอกไม่ถูกรีเซ็ตเมื่อมี snapshot ใหม่ การแก้โปรไฟล์ใช้ version เพื่อป้องกัน overwrite

Role ปรับได้ใน ROLES / permissions ใน `src/authService.ts`: MasterAdmin, SuperAdmin, Admin, Staff, Modeler, Planner, Viewer ตามโมดูลที่ใช้จริง Viewer อ่านโครงการที่ได้รับสิทธิ์ ส่วนการเขียนข้อมูล project revision ให้เฉพาะกลุ่ม editor ตาม Security Rules สิทธิ์การแก้แต่ละโมดูลใน UI ตรวจผ่าน canUse หากต้องการจำกัดข้อมูลย่อยแต่ละโมดูลที่ระดับ Rules ให้แยก module documents จาก payload JSON ของรุ่น

MCP endpoints ตรวจ Firebase ID token, approval, role และ project membership บน server จึงไม่ส่ง Key ให้ browser ของสมาชิก

Server ไม่จำเป็นต้องมี service account: ถ้าไม่ตั้ง `GOOGLE_APPLICATION_CREDENTIALS` server จะตรวจ token ด้วย public key ของ Firebase และอ่าน Firestore ด้วย ID token ของผู้ใช้เอง (ผ่าน Security Rules) ผู้ใช้ที่ login แล้วและได้รับอนุมัติใช้ AI ได้ทันที ไม่มีขั้นตอน login ซ้ำ

MCP ใช้ API Key ของผู้ให้บริการที่ MasterAdmin บันทึกใน Admin โดยอ่านจาก Firebase ผ่าน server ที่มี service account และไม่ส่ง Key ให้ผู้ใช้ทั่วไป

## ตรวจสอบ

- `npm run build`
- `npm test` (รวม three-way merge และข้อมูลโมเดลเดิม)
- `firebase emulators:start --only auth,firestore,storage --project demo-cmg-auth --config firebase.test.json`
- `node tests/firebase-storage.mjs`: สิทธิ์ไฟล์ของสมาชิก การปฏิเสธบัญชี pending และการกันเขียนทับไฟล์เดิม
- `node tests/firebase-auth.mjs`: bootstrap/concurrent registration, approval, privilege escalation, project isolation, sharing, stale save และ Viewer
- เปิด Vite ด้วย config demo และ VITE_FIREBASE_EMULATORS=1 ที่ port 5176 แล้ว `node scripts/auth-smoke.mjs`
- ต่อด้วย `node scripts/auth-api-smoke.mjs` เพื่อตรวจ server authorization และ managed keys โดยไม่เรียก AI จริง

Google popup, Authorized domains, service credentials, Storage CORS และ deployment ของ Firebase จริงยังต้องตรวจใน project ที่นำไปใช้งาน

อ้างอิง: [Firebase Persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence), [Firestore Transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)

ผลตรวจในเครื่อง: build ผ่าน, unit tests 36 รายการผ่าน, browser authentication/project flow ผ่าน, server authorization ผ่าน และ Storage Rules ผ่าน emulator รวมถึงป้องกัน overwrite ไฟล์เดิม
