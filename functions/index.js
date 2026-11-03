/* ================= FuQorAI Cloud Functions ================= */
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const logger = require("firebase-functions/logger");

initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });
const db = getFirestore();
const auth = getAuth();

async function requireAdmin(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) throw new HttpsError("unauthenticated", "Kirish talab qilinadi");
  const dec = await auth.verifyIdToken(token);
  if (!dec.admin) throw new HttpsError("permission-denied", "Admin huquqi kerak");
  return dec;
}

/* ---------------- helpers ---------------- */
const CATS = {
  "Kommunal xizmatlar": { dep: "Kommunal xizmatlar boshqarmasi", kw: ["suv","elektr","gaz","kanalizatsiya","issiq","hisoblagich","chiqindi","tozib"] },
  "Ijtimoiy himoya":    { dep: "Ijtimoiy himoya bo‘limi", kw: ["nafaqa","subsidiya","yordam","oil","reabilitatsiya","iqtizodiy","moddiy yordam"] },
  "Sog‘liqni saqlash":  { dep: "Sog‘liqni saqlash boshqarmasi", kw: ["shifokor","shifoxona","dorixona","dori","tibbiy","shoshilinch","poliklinika","bemor","kursatkaz"] },
  "Ta'lim":             { dep: "Ta'lim boshqarmasi", kw: ["maktab","o‘qituvchi","bog‘cha","stipendiya","ovqatlanish","o‘quv","talaba","bolalar"] },
  "Transport":          { dep: "Transport va yo‘l xo‘jaligi bo‘limi", kw: ["avtobus","yo‘l","transport","tosh","ko‘cha","yorug‘lik","parkovka","tarmoq","mashina"] },
  "Huquqiy masalalar":  { dep: "Yuridik bo‘lim", kw: ["sud","qarz","huquq","notarius","aliment","shartnoma","ijro","hujjat","mulk","fuqarolik"] },
  "Hokimlik faoliyati": { dep: "Hokimlik apparati", kw: ["hokim","mahalla","byudjet","qaror","tadbirkor","yig‘ilish","hokimiyat","yuzma-yuz"] },
  "Ekologiya":          { dep: "Ekologiya va atrof-muhit bo‘limi", kw: ["zavod","iflos","daryo","chigindi","daraxt","ekologiya","havо","suv ombori","poligon"] },
  "Boshqa":             { dep: "Umumiy qabulxona", kw: [] }
};

function detectCategory(text) {
  const t = (text || "").toLowerCase();
  let best = null, bestScore = 0;
  for (const [cat, cfg] of Object.entries(CATS)) {
    let score = 0;
    for (const k of cfg.kw) if (t.includes(k.toLowerCase())) score++;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best || "Boshqa";
}

function detectPriority(text, cat) {
  const t = (text || "").toLowerCase();
  const urgent = ["tez","darhol","xavf","xavfsiz","hayot","tezyordam","shoshilinch","yong‘in","kuchli","tezda","urgent","falak"];
  const hit = urgent.some(k => t.includes(k));
  if (hit) return "yuqori";
  if (t.length < 60) return "past";
  return "o‘rta";
}

const SYSTEM_PROMPT = `Siz — FuQorAI, O‘zbekiston fuqoraviy hokimiyatlari uchun sun’iy intellekt yordamchisiz.
Sizning vazifangiz: fuqaro murojaatlariga aniq, qonuniy va amaliy javob berish.
Qoidalar:
1. Har doim o‘zbek tilida, rasmiy va xalqaro savdo qilingan tilda javob bering.
2. Javob strukturasi: Qisqacha xulosa → Masalaning mohiyati → Zarur choralar (raqamlangan) → Qaysi bo‘limga murojaat (kategoriya bo‘yicha) → Qancha muddat (taxminiy) → Foydalanish uchun telefon/guzara.
3. Noma'lumni o'ylab topmang. Aniq ma'lumot bo'lmasa, "aniqlanadi" deb yozing.
4. Hech qachon huquqiy yoki moliyaviy majburiyat yaratuvchi qaror qabul qilmaymang — maslahat bering, yakuniy qaror fuqaro va bo'limda.
5. Javob 120-250 so'zdan oshmasin.
6. Xavfsizlik: shaxsiy ma'lumot (telefon, manzil, pasport) so'ralsa, uni chatga yozmasdan, shu masalaga maslahat bering.`;

async function openaiChat(messages, maxTokens = 800) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new HttpsError("failed-precondition", "OPENAI_API_KEY sozlanmagan");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens
    })
  });
  if (!res.ok) {
    const t = await res.text();
    logger.error("OpenAI error", { status: res.status, body: t.slice(0, 500) });
    throw new HttpsError("internal", "AI javob berolmadi, keyinroq urinib ko'ring");
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content || "Javob topilmadi.";
}

async function notifyTelegram(req) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { logger.warn("Telegram sozlanmagan"); return; }
  const text = `🔔 *Yangi murojaat* #${req.id}\n` +
    `📂 Kategoriya: ${req.category}\n` +
    `🔥 Ustuvorlik: ${req.priority}\n` +
    `👤 ${req.fio || "nomsiz"}\n\n` +
    `📝 ${req.text}`;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
  } catch (e) { logger.error("telegram", e); }
}

/* ---------------- API (HTTP) ---------------- */
exports.api = onRequest(async (req, res) => {
  const path = req.path.replace(/^\/api\/?/, "") || req.query.path || "";
  try {
    if (req.method === "POST" && path === "requests") {
      const b = req.body || {};
      const text = String(b.text || "").trim();
      if (text.length < 10) throw new HttpsError("invalid-argument", "Murojaat matni juda qisqa (kamida 10 belgi)");
      const category = b.category && CATS[b.category] ? b.category : detectCategory(text);
      const priority = b.priority || detectPriority(text, category);
      const doc = {
        id: Date.now(),
        fio: String(b.fio || "").trim(),
        phone: String(b.phone || "").trim(),
        text,
        category,
        dep: CATS[category].dep,
        priority,
        status: "yangi",
        source: b.source || "web",
        answer: "",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };
      await db.collection("requests").doc(String(doc.id)).set(doc);
      await notifyTelegram(doc);
      res.json({ ok: true, id: doc.id, category, priority, dep: doc.dep });
      return;
    }

    if (req.method === "GET" && (path === "requests" || path === "")) {
      const limit = Math.min(Number(req.query.limit) || 100, 300);
      const snap = await db.collection("requests").orderBy("createdAt", "desc").limit(limit).get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      res.json({ ok: true, items, total: items.length });
      return;
    }

    if (req.method === "PATCH" && path.startsWith("requests/")) {
      await requireAdmin(req);
      const id = path.split("/")[1];
      const b = req.body || {};
      const allowed = {};
      ["status", "priority", "answer", "dep", "category"].forEach(k => {
        if (b[k] !== undefined) allowed[k] = b[k];
      });
      allowed.updatedAt = FieldValue.serverTimestamp();
      await db.collection("requests").doc(id).update(allowed);
      res.json({ ok: true });
      return;
    }

    if (req.method === "POST" && path === "chat") {
      const b = req.body || {};
      const q = String(b.message || "").trim();
      if (!q) throw new HttpsError("invalid-argument", "Savol bo'sh");
      const messages = [{ role: "system", content: SYSTEM_PROMPT }];
      const history = Array.isArray(b.history) ? b.history.slice(-6) : [];
      history.forEach(h => messages.push({ role: h.role === "user" ? "user" : "assistant", content: h.content }));
      messages.push({ role: "user", content: q });
      const reply = await openaiChat(messages);
      res.json({ ok: true, reply });
      return;
    }

    if (req.method === "POST" && path === "telegram/webhook") {
      const upd = req.body;
      if (upd && upd.message && upd.message.text) {
        const doc = {
          id: Date.now(),
          fio: upd.message.from ? [upd.message.from.first_name, upd.message.from.last_name].filter(Boolean).join(" ") : "",
          phone: "",
          text: upd.message.text,
          category: detectCategory(upd.message.text),
          priority: detectPriority(upd.message.text),
          status: "yangi",
          source: "telegram",
          answer: "",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };
        doc.dep = CATS[doc.category].dep;
        await db.collection("requests").doc(String(doc.id)).set(doc);
        await notifyTelegram(doc);
      }
      res.json({ ok: true });
      return;
    }

    res.status(404).json({ ok: false, error: "topilmadi" });
  } catch (e) {
    logger.error("api error", e);
    res.status(e.code === "invalid-argument" ? 400 : 500).json({ ok: false, error: e.message || "xato" });
  }
});
