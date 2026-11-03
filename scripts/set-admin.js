/* Admin foydalanuvchisi yaratadi va 'admin: true' custom claim qo'yadi.
   Ishga tushirish: node scripts/set-admin.js email parol
   Talablar: FIREBASE_PROJECT_ID va GOOGLE_APPLICATION_CREDENTIALS yoki
   'firebase login' orqali Application Default Credentials. */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) {
  console.error("Foydalanish: node scripts/set-admin.js <email> <parol>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const db = getFirestore();

(async () => {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log("Foydalanuvchi mavjud:", user.uid);
  } catch (e) {
    user = await auth.createUser({ email, password, emailVerified: true });
    console.log("Foydalanuvchi yaratildi:", user.uid);
  }
  await auth.setCustomUserClaims(user.uid, { admin: true });
  await db.collection("admins").doc(user.uid).set({
    email, admin: true, createdAt: FieldValue.serverTimestamp()
  });
  console.log("admin claim qo'yildi. Admin panelga kirish uchun chiqib qayta kiring.");
})().catch(e => { console.error(e); process.exit(1); });
