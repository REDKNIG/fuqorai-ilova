/* ================= FuQorAI frontend ================= */
(function () {
  "use strict";

  const cfg = window.FIREBASE_CONFIG;
  const hasFirebase = cfg && cfg.apiKey && cfg.apiKey !== "YOUR_API_KEY";
  let db = null, auth = null, user = null, isAdmin = false;
  const API_BASE = "";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  $$(".tabbtn").forEach(b => b.addEventListener("click", () => {
    $$(".tabbtn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    $$(".view").forEach(v => v.classList.remove("active"));
    $("#view-" + b.dataset.view).classList.add("active");
    if (b.dataset.view === "home") loadDashboard();
    if (b.dataset.view === "admin" && user) loadAdmin();
  }));

  if (hasFirebase) {
    firebase.initializeApp(cfg);
    db = firebase.firestore();
    auth = firebase.auth();
    auth.onAuthStateChanged(async (u) => {
      user = u;
      if (u) {
        const tok = await u.getIdTokenResult(true);
        isAdmin = !!tok.claims.admin;
        $("#adminLoginBox").style.display = "none";
        $("#adminBox").style.display = "block";
        loadAdmin();
      } else {
        isAdmin = false;
        $("#adminLoginBox").style.display = "block";
        $("#adminBox").style.display = "none";
      }
    });
  } else {
    $("#adminLoginBox").innerHTML = '<h3>Xodimlar paneli</h3><p class="muted">Firebase konfiguratsiyasi ulanmagan: public/firebase-config.js faylini to\u2018ldiring.</p>';
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (opts.auth && auth && auth.currentUser) {
      const t = await auth.currentUser.getIdToken();
      headers.Authorization = "Bearer " + t;
    }
    const res = await fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const j = await res.json().catch(function () { return { ok: false, error: "javobni o\u2018qib bo\u2018lmadi" }; });
    if (!res.ok || j.ok === false) throw new Error(j.error || "xato yuz berdi");
    return j;
  }

  const CATS = ["Kommunal xizmatlar","Ijtimoiy himoya","Sog\u2018liqni saqlash","Ta'lim","Transport","Huquqiy masalalar","Hokimlik faoliyati","Ekologiya","Boshqa"];
  const ST_C = { "yangi":"b-blue", "ko\u2018rib chiqilmoqda":"b-amber", "javob tayyor":"b-purple", "yopilgan":"b-green" };
  const PR_C = { "yuqori":"b-red", "o\u2018rta":"b-amber", "past":"b-green" };
  const STATUSES = Object.keys(ST_C);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

  const sel = $("#catSelect");
  if (sel) sel.innerHTML = '<option value="">Avtomatik aniqlash</option>' + CATS.map(c => "<option>" + c + "</option>").join("");

  let ALL = [];
  async function loadDashboard() {
    try {
      const j = await api("/api/requests?limit=200");
      ALL = j.items || [];
    } catch (e) { ALL = []; }
    renderDash();
  }

  function renderDash() {
    const byCat = {}, byDep = {};
    ALL.forEach(d => { byCat[d.category] = (byCat[d.category]||0)+1; byDep[d.dep] = (byDep[d.dep]||0)+1; });
    const high = ALL.filter(d => d.priority === "yuqori").length;
    const closed = ALL.filter(d => d.status === "yopilgan").length;
    $("#kpis").innerHTML =
      '<div class="card kpi"><div class="num">' + ALL.length + '</div><div class="lbl">Jami murojaatlar</div></div>' +
      '<div class="card kpi"><div class="num">' + Object.keys(byCat).length + '</div><div class="lbl">Mavzu turlari</div></div>' +
      '<div class="card kpi"><div class="num">' + high + '</div><div class="lbl">Yuqori ustuvorlik</div></div>' +
      '<div class="card kpi"><div class="num">' + (ALL.length ? Math.round(closed/ALL.length*100) : 0) + '%</div><div class="lbl">Yopilgan ulushi</div></div>';
    const palette = ["#2563eb","#059669","#dc2626","#7c3aed","#d97706","#0891b2","#be185d","#65a30d","#9ca3af"];
    $("#chartCats").innerHTML = bars(byCat, palette);
    $("#chartDeps").innerHTML  = bars(byDep, palette);
  }

  function bars(obj, palette) {
    const entries = Object.entries(obj).sort((a,b) => b[1]-a[1]);
    const max = Math.max(1, ...entries.map(e => e[1]));
    if (!entries.length) return '<p class="muted">Hozircha ma\u2019lumot yo\u2018q</p>';
    return entries.map((e,i) =>
      '<div class="bar-row"><span class="name" title="' + esc(e[0]) + '">' + esc(e[0]) + '</span>' +
      '<span class="bar"><i style="width:' + Math.round(e[1]/max*100) + '%;background:' + palette[i%palette.length] + '"></i></span>' +
      '<span class="val">' + e[1] + '</span></div>').join("");
  }

  const reqForm = $("#reqForm");
  if (reqForm) reqForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $("#reqMsg");
    msg.className = "msg"; msg.textContent = "Yuborilmoqda...";
    try {
      const j = await api("/api/requests", { method: "POST", body: {
        fio: f.fio.value, phone: f.phone.value, text: f.text.value, category: f.category.value
      }});
      msg.className = "msg ok";
      msg.textContent = "\u2705 Yuborildi! \u2116" + j.id + " \u2014 " + j.category + " (" + j.dep + "), ustuvorlik: " + j.priority;
      f.reset();
      loadDashboard();
    } catch (err) {
      msg.className = "msg err"; msg.textContent = "\u274c " + err.message;
    }
  });

  const trackBtn = $("#trackBtn");
  if (trackBtn) trackBtn.addEventListener("click", async () => {
    const phone = $("#trackPhone").value.trim();
    const box = $("#trackList");
    if (!phone) { box.innerHTML = '<p class="muted">Telefon raqamini kiriting.</p>'; return; }
    box.innerHTML = '<p class="muted">Qidirilmoqda...</p>';
    try {
      const j = await api("/api/requests?limit=200");
      const norm = (s) => String(s||"").replace(/[^\d+]/g, "");
      const items = (j.items||[]).filter(d => norm(d.phone) && norm(d.phone).slice(-9) === norm(phone).slice(-9));
      box.innerHTML = items.length ? requestTable(items, false) : '<p class="muted">Bu raqamga murojaat topilmadi.</p>';
    } catch (e) {
      box.innerHTML = '<p class="muted">Xato: ' + esc(e.message) + '</p>';
    }
  });

  function requestTable(items, editable) {
    let h = '<table><thead><tr><th>\u2116</th><th>Murojaat</th><th>Kategoriya</th><th>Ustuvorlik</th><th>Holat</th>';
    if (editable) h += '<th>Amal</th>';
    h += '</tr></thead><tbody>';
    items.forEach(d => {
      h += '<tr><td>' + esc(d.id) + '</td>' +
        '<td><b>' + esc(d.fio||"nomsiz") + '</b><br><span class="muted">' + esc(d.text) + '</span>' +
        (d.answer ? '<br><span class="muted">Javob: ' + esc(d.answer) + '</span>' : "") + '</td>' +
        '<td>' + esc(d.category) + '<br><span class="muted">' + esc(d.dep||"") + '</span></td>' +
        '<td><span class="badge ' + (PR_C[d.priority]||"b-gray") + '">' + esc(d.priority) + '</span></td>' +
        '<td><span class="badge ' + (ST_C[d.status]||"b-gray") + '">' + esc(d.status) + '</span></td>';
      if (editable) {
        h += '<td><select data-id="' + esc(d.id) + '" class="st-sel">' +
          STATUSES.map(s => "<option" + (s===d.status ? " selected" : "") + ">" + s + "</option>").join("") +
          '</select><br><button class="ghost save-btn" data-id="' + esc(d.id) + '">Saqlash</button> ' +
          '<button class="ghost ans-btn" data-id="' + esc(d.id) + '">Javob</button></td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  const loginForm = $("#loginForm");
  if (loginForm) loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $("#loginMsg");
    msg.className = "msg"; msg.textContent = "Kirilmoqda...";
    try {
      await auth.signInWithEmailAndPassword(f.email.value, f.password.value);
      msg.className = "msg ok"; msg.textContent = "Kirildi.";
      f.reset();
    } catch (err) {
      msg.className = "msg err"; msg.textContent = "\u274c " + err.message;
    }
  });

  const logoutBtn = $("#logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", () => auth && auth.signOut());

  async function loadAdmin() {
    if (!user) return;
    const q = ($("#admSearch").value||"").toLowerCase();
    const f = $("#admFilter").value;
    const box = $("#admList");
    box.innerHTML = '<p class="muted">Yuklanmoqda...</p>';
    try {
      const j = await api("/api/requests?limit=200");
      const items = (j.items||[]).filter(d =>
        (!f || d.status === f) &&
        (!q || (d.text||"").toLowerCase().includes(q) || (d.fio||"").toLowerCase().includes(q)));
      box.innerHTML = items.length ? requestTable(items, true) : '<p class="muted">Murojaat topilmadi.</p>';
      box.querySelectorAll(".save-btn").forEach(b => b.addEventListener("click", () => saveRequest(b.dataset.id)));
      box.querySelectorAll(".ans-btn").forEach(b => b.addEventListener("click", () => answerRequest(b.dataset.id)));
      box.querySelectorAll(".st-sel").forEach(s => s.addEventListener("change", () => saveRequest(s.dataset.id)));
    } catch (e) {
      box.innerHTML = '<p class="muted">Xato: ' + esc(e.message) + '</p>';
    }
  }

  async function saveRequest(id) {
    const s = document.querySelector('.st-sel[data-id="' + id + '"]');
    if (!s) return;
    try {
      await api("/api/requests/" + id, { method: "PATCH", auth: true, body: { status: s.value } });
      loadAdmin(); loadDashboard();
    } catch (e) { alert("Xato: " + e.message); }
  }

  async function answerRequest(id) {
    const ans = prompt("Javob matni:");
    if (ans === null) return;
    try {
      await api("/api/requests/" + id, { method: "PATCH", auth: true, body: { answer: ans, status: "javob tayyor" } });
      loadAdmin(); loadDashboard();
    } catch (e) { alert("Xato: " + e.message); }
  }

  const admSearch = $("#admSearch"), admFilter = $("#admFilter");
  if (admSearch) admSearch.addEventListener("input", loadAdmin);
  if (admFilter) {
    admFilter.addEventListener("change", loadAdmin);
    admFilter.insertAdjacentHTML("beforeend", STATUSES.map(s => "<option>" + s + "</option>").join(""));
  }

  const history = [];
  function addMsg(who, text) {
    const el = document.createElement("div");
    el.className = "msgrow " + who;
    el.innerHTML = '<div class="avatar">' + (who === "ai" ? "AI" : "Siz") + '</div><div class="bubble"></div>';
    el.querySelector(".bubble").textContent = text;
    $("#chatlog").appendChild(el);
    $("#chatlog").scrollTop = $("#chatlog").scrollHeight;
  }

  async function sendChat(text) {
    addMsg("user", text);
    history.push({ role: "user", content: text });
    const typing = document.createElement("div");
    typing.className = "typing";
    typing.textContent = "AI yozmoqda...";
    $("#chatlog").appendChild(typing);
    $("#chatlog").scrollTop = $("#chatlog").scrollHeight;
    try {
      const j = await api("/api/chat", { method: "POST", body: { message: text, history: history.slice(-6) } });
      typing.remove();
      addMsg("ai", j.reply);
      history.push({ role: "assistant", content: j.reply });
    } catch (e) {
      typing.remove();
      addMsg("ai", "Xatolik: " + e.message);
    }
  }

  const chatSend = $("#chatSend");
  if (chatSend) chatSend.addEventListener("click", () => {
    const inp = $("#chatInput");
    const t = inp.value.trim();
    if (!t) return;
    inp.value = "";
    sendChat(t);
  });
  const chatInput = $("#chatInput");
  if (chatInput) chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (chatSend) chatSend.click(); }
  });
  $$("#suggests button").forEach(b => b.addEventListener("click", () => sendChat(b.textContent.trim())));

  loadDashboard();
})();
