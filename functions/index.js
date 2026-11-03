/* =====================================================================
   FuQorAI — Cloud Function "api"
   Route'lar:
     POST   /api/requests            — murojaat yaratish (kategoriya avtomatik)
     GET    /api/requests?limit=N    — ro'yxat
     PATCH  /api/requests/:id        — status/javob (admin token talab)
     POST   /api/chat                — AI javob (Gemini, OpenAI emas)
     POST   /api/telegram/webhook    — Telegram orqali murojaat qabul qilish
   ===================================================================== */
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const logger = require("firebase-functions/logger");

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });
initializeApp();
const db = getFirestore();
const auth = getAuth();

/* ---------------- helpers ---------------- */
function esc(s){ return String(s==null?"":s); }

async function requireAdmin(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) throw new HttpsError("unauthenticated", "Kirish talab qilinadi");
  const dec = await auth.verifyIdToken(token);
  if (!dec.admin) throw new HttpsError("permission-denied", "Admin huquqi kerak");
  return dec;
}

/* ---------------- AI (OpenAI + Gemini) ---------------- */
const AI_SYSTEM = `Siz — O'zbekiston fuqaraviy hokimiyati xodimi yordamchisiz.
Javoblar rasmiy uslubda, qisqa va aniq bo'lsin.
Har bir javob quyidagi tuzilma bilan:
1) Qisqa xulosa (1-2 jumla).
2) Muammo va uning mohiyati.
3) Raqamlangan amaliy choralar (1-5 ta).
4) Qaysi bo'limga murojaat qilish kerak.
5) Taxminiy muddat.
Faktlarni ixtiyoriy qo'shmang, aniq bo'lmasa "aniqlanadi" deb yozing.`;

/* OpenAI (chat.completions) */
async function askOpenAI(message, history) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new HttpsError("failed-precondition", "OPENAI_API_KEY ulanmagan");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const msgs = [{ role: "system", content: AI_SYSTEM }];
  (history || []).forEach(m => {
    if (!m || !m.content) return;
    const role = m.role === "assistant" ? "assistant" : "user";
    msgs.push({ role, content: String(m.content).slice(0, 4000) });
  });
  msgs.push({ role: "user", content: String(message).slice(0, 4000) });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({ model, messages: msgs, temperature: 0.4, max_tokens: 1200 })
  });
  if (!res.ok) {
    const t = await res.text();
    logger.error("OpenAI xato", { status: res.status, body: t.slice(0, 500) });
    throw new HttpsError("internal", "OpenAI javob bermadi: " + res.status);
  }
  const j = await res.json();
  const text = j.choices && j.choices[0] && j.choices[0].message
    ? String(j.choices[0].message.content || "").trim() : "";
  if (!text) throw new HttpsError("internal", "OpenAI bo'sh javob qaytardi");
  return text;
}

/* Gemini (bepul kvota) */
async function askGemini(message, history) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new HttpsError("failed-precondition", "GEMINI_API_KEY ulanmagan");
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const parts = [];
  (history || []).forEach(m => {
    if (!m || !m.content) return;
    parts.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content).slice(0, 4000) }] });
  });
  parts.push({ role: "user", parts: [{ text: String(message).slice(0, 4000) }] });
  const body = {
    system_instruction: { parts: [{ text: AI_SYSTEM }] },
    contents: parts,
    generationConfig: { temperature: 0.4, maxOutputTokens: 1200 }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    logger.error("Gemini xato", { status: res.status, body: t.slice(0, 500) });
    throw new HttpsError("internal", "Gemini javob bermadi");
  }
  const j = await res.json();
  const cand = j.candidates && j.candidates[0];
  const text = cand && cand.content && cand.content.parts
    ? cand.content.parts.map(p => p.text || "").join("").trim() : "";
  if (!text) throw new HttpsError("internal", "AI bo'sh javob qaytardi");
  return text;
}

/* AI provider tanlash: avval OpenAI, key yo'q bo'lsa Gemini */
async function askAI(message, history) {
  if (process.env.OPENAI_API_KEY) return askOpenAI(message, history);
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return askGemini(message, history);
  throw new HttpsError("failed-precondition", "AI kaliti ulanmagan");
}

/* AI kaliti yo'q holat uchun — qoidalar asosidagi qo'lda javob */
function fallbackReply(message) {
  const t = String(message || "").toLowerCase();
  let cat = "Boshqa", dep = "Umumiy qabulxona";
  for (const [k, v] of Object.entries(CATS)) {
    if (t.includes(k.toLowerCase())) { cat = k; dep = DEP_OF[k]; break; }
  }
  return `1) Xulosa: Sizning murojaatingiz "${cat}" bo'limiga tegishli va "${dep}" tomonidan ko'rib chiqiladi.\n\n2) Muammo: Murojaatingiz qabul qilindi. Batafsil holat va hujjatlar xodim tomonidan tekshiriladi.\n\n3) Choralar:\n1) Murojaat ro'yxatga olindi.\n2) Mas'ul xodim belgilandi.\n3) Siz bilan telefon orqali bog'lanish uchun murojaat raqamini saqlang.\n4) Zarur hujjatlar (ariza, hujjat nusxasi) bo'limga yetkaziladi.\n\n4) Bo'lim: ${dep}\n\n5) Muddat: 3-7 ish kuni ichida.`;
}

/* ---------------- kategoriyalar ---------------- */
const CATS = {
  "Kommunal xizmatlar": { dep: "Kommunal xizmatlar boshqarmasi", kw: ["kommunal","suv","kanalizatsiya","chiqindi","garbage","elektr","gaz","isitish","uyni","jamoat","tozalash","chiqindilar"] },
  "Ijtimoiy himoya": { dep: "Ijtimoiy himoya bo'limi", kw: ["ijtimoiy","yordam","nafaka","peshona","mayda","keksa","invalid","nogiron","taminot","yordam berish","subsidiya"] },
  "Sog'liqni saqlash": { dep: "Sog'liqni saqlash boshqarmasi", kw: ["sog'liq","shifoxona","poliklinika","shifokor","dori","retsept","ambulans","virus","epidemiya","tibbiy","jarohat"] },
  "Ta'lim": { dep: "Ta'lim boshqarmasi", kw: ["maktab","o'qituvchi","o'quvchi","ta'lim","universitet","kurs","imtihon","diplom","o'qitish"] },
  "Transport": { dep: "Transport va yo'l xo'jaligi bo'limi", kw: ["transport","avtobus","taksi","avtomobil","yo'l","shossha","trafik","parking","mashina"] },
  "Huquqiy masalalar": { dep: "Yuridik bo'lim", kw: ["huquq","qonun","shartnoma","qarar","fuqarolik","sud","jazo","huquqiy","maslahat"] },
  "Hokimlik faoliyati": { dep: "Hokimlik apparati", kw: ["hokim","hokimiyat","rahbar","ariza","qabul","birinchi","fuqarolar","murojaat","javob","jarohat"] },
  "Ekologiya": { dep: "Ekologiya va atrof-muhit bo'limi", kw: ["ekologiya","atrof","muhit","iflos","zaxira","daraxt","hayvon","chiqindi","shovqin"] }
};
const DEP_OF = {};
Object.keys(CATS).forEach(k => { DEP_OF[k] = CATS[k].dep; });
DEP_OF["Boshqa"] = "Umumiy qabulxona";

function detectCategory(text, manual) {
  if (manual && DEP_OF[manual]) return { category: manual, dep: DEP_OF[manual] };
  const t = String(text || "").toLowerCase();
  let best = null, bestHits = 0;
  for (const [cat, cfg] of Object.entries(CATS)) {
    let hits = 0;
    cfg.kw.forEach(k => { if (t.includes(k)) hits++; });
    if (hits > bestHits) { bestHits = hits; best = cat; }
  }
  if (!best) return { category: "Boshqa", dep: DEP_OF["Boshqa"] };
  return { category: best, dep: CATS[best].dep };
}

function detectPriority(text, category) {
  const t = String(text || "").toLowerCase();
  if (/(jaloqatli|falokat|tez|shoshilinch|hayotga|xavf|ishlamay qol|to\x27liq)/.test(t)) return "yuqori";
  if (category === "Ijtimoiy himoya" || category === "Sog'liqni saqlash") return "o'rta";
  if (t.length > 320) return "o'rta";
  return "past";
}

/* ---------------- Telegram ---------------- */
async function notifyTelegram(req) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const text = [
    "🔔 Yangi murojaat",
    `№: ${req.id}`,
    `F.I.O: ${req.fio || "nomsiz"}`,
    `Tel: ${req.phone || "-"}`,
    `Kategoriya: ${req.category} (${req.dep})`,
    `Ustuvorlik: ${req.priority}`,
    `Matn: ${req.text}`
  ].join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (e) {
    logger.error("Telegram xato", e);
  }
}

/* ---------------- main ---------------- */
exports.api = onRequest(async (req, res) => {
  const path = req.path.replace(/^\/+|\/+$/g, "");
  const method = req.method.toUpperCase();

  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  if (method === "OPTIONS") return res.status(204).send("");

  try {
    /* ---- murojaat yaratish ---- */
    if (method === "POST" && path === "requests") {
      const b = req.body || {};
      const text = esc(b.text).trim();
      if (!text) throw new HttpsError("invalid-argument", "Murojaat matni bo'sh");
      const { category, dep } = detectCategory(text, b.category);
      const priority = detectPriority(text, category);
      const doc = {
        fio: esc(b.fio).trim().slice(0, 120),
        phone: esc(b.phone).trim().slice(0, 40),
        text: text.slice(0, 4000),
        category, dep, priority,
        status: "yangi",
        answer: "",
        source: "web",
        createdAt: FieldValue.serverTimestamp()
      };
      const ref = await db.collection("requests").add(doc);
      const id = ref.id;
      await notifyTelegram({ id, ...doc });
      return res.status(201).json({ ok: true, id, category, dep, priority, status: "yangi" });
    }

    /* ---- ro'yxat ---- */
    if (method === "GET" && path === "requests") {
      const limit = Math.min(parseInt((req.query && req.query.limit) || 200, 10) || 200, 500);
      const snap = await db.collection("requests").orderBy("createdAt", "desc").limit(limit).get();
      const items = snap.docs.map(d => {
        const o = d.data();
        const c = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null;
        return Object.assign({ id: d.id }, o, { createdAt: c ? c.toISOString() : null });
      });
      return res.json({ ok: true, items, count: items.length });
    }

    /* ---- yangilash (faqat admin) ---- */
    if (method === "PATCH" && path.startsWith("requests/")) {
      await requireAdmin(req);
      const id = path.split("/")[1];
      const b = req.body || {};
      const patch = {};
      if (b.status) patch.status = b.status;
      if (b.priority) patch.priority = b.priority;
      if (b.answer !== undefined) patch.answer = esc(b.answer).slice(0, 4000);
      if (b.category && DEP_OF[b.category]) { patch.category = b.category; patch.dep = DEP_OF[b.category]; }
      patch.updatedAt = FieldValue.serverTimestamp();
      await db.collection("requests").doc(id).update(patch);
      return res.json({ ok: true, id, patch });
    }

    /* ---- AI chat ---- */
    if (method === "POST" && path === "chat") {
      const b = req.body || {};
      const message = esc(b.message).trim();
      if (!message) throw new HttpsError("invalid-argument", "Savol bo'sh");
      let reply;
      try {
        reply = await askAI(message, b.history);
      } catch (e) {
        logger.warn("AI fallback'ga o'tildi", e && e.message);
        reply = fallbackReply(message);
      }
      return res.json({ ok: true, reply });
    }

    /* ---- Telegram webhook ---- */
    if (method === "POST" && path === "telegram/webhook") {
      const b = req.body || {};
      const msg = b.message || {};
      const chat = msg.chat || {};
      const from = msg.from || {};
      const text = esc(msg.text || "").trim();
      if (text && chat.id) {
        const text2 = text.replace(/^\/[a-z_]+/, "").trim();
        if (text2) {
          const { category, dep } = detectCategory(text2, "");
          const priority = detectPriority(text2, category);
          const ref = await db.collection("requests").add({
            fio: esc(from.first_name || "") + " " + esc(from.last_name || ""),
            phone: esc(from.phone_number || ""),
            text: text2.slice(0, 4000),
            category, dep, priority,
            status: "yangi", answer: "",
            source: "telegram",
            telegramChatId: String(chat.id),
            createdAt: FieldValue.serverTimestamp()
          });
          await notifyTelegram({ id: ref.id, fio: from.first_name, phone: "", text: text2, category, dep, priority });
        }
      }
      return res.json({ ok: true });
    }

    return res.status(404).json({ ok: false, error: "Topilmadi: /" + path });
  } catch (e) {
    logger.error("Xato", { path, method, msg: e && e.message });
    const code = e && e.code && typeof e.code === "string" && e.code.startsWith("HttpsError") ? 400 : 500;
    return res.status(code).json({ ok: false, error: (e && e.message) || "Xato yuz berdi" });
  }
});
