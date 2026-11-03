# FuQorAI — Fuqaraviy murojaatlar uchun AI yordamchisi

O'zbekiston fuqaraviy hokimiyatlari uchun mo'ljallangan veb-ilova:
fuqaro murojaat qoldiradi, tizim uni avtomatik kategoriyaga ajratadi,
xodimlar panelida ishlaydi, va AI qonuniy yechim taklif qiladi.

## Tezkor ko'rish

| Bo'lim | Vazifasi |
|---|---|
| Bosh sahifa | KPI, kategoriya va bo'limlar bo'yicha statistika |
| Murojaat berish | Forma — kategoriya va ustuvorlik avtomatik aniqlanadi |
| Murojaatim | Telefon raqam orqali murojaat holatini kuzatish |
| AI yordam | Chat — Gemini (bepul kvota) |
| Xodimlar paneli | Login, status o'zgartirish, javob yozish |

## Tuzilma

```
public/          # frontend (Firebase Hosting)
  index.html
  style.css
  app.js
  firebase-config.js        # <-- shu faylni to'ldirasiz (gitignore'da)
  firebase-config.example.js
functions/       # backend (Cloud Functions 2nd gen, europe-west1)
  index.js        # api: requests / chat / telegram webhook
  .env.example
scripts/
  set-admin.js    # admin foydalanuvchi + 'admin: true' claim
  deploy.sh       # to'liq deploy scripti
firestore.rules
firestore.indexes.json
firebase.json
.firebaserc      # loyiha: murojaat-ai
```

## Narxi

Firebase Hosting, Firestore, Authentication, Cloud Functions (bepul kvota ichida)
va Gemini API — **barchasi bepul**. Faqat Firebase'ga Blaze rejani yoqish kerak
(karta bog'lanadi, lekin $200/oy bepul kvota bor; konsolda ogohlantirish qo'ying).

## O'rnatish — 5 qadam

### 1. Firebase loyihasi

Firebase konsoli: [console.firebase.google.com](https://console.firebase.google.com)
Loyiha ID: **murojaat-ai**

- **Firestore Database** → Create database → Production mode → `europe-west1`
- **Authentication** → Sign-in method → **Email/Password** → Enable
- **Blaze rejani yoqing** (Billing → "Upgrade") — Functions uchun shart

### 2. Firebase konfiguratsiyasi (frontend uchun)

Project settings → General → pastga scroll → **Your apps** → **</>** (Web) →
"Add to Firebase App" → konfiguratsiya ko'rinadi.

```bash
cp public/firebase-config.example.js public/firebase-config.js
# firebase-config.js ichidagi 6 ta qiymatni konfiguratsiyadan ko'chiring
```

`firebase-config.js` `.gitignore` da — repo'ga tushmaydi.

### 3. AI kaliti (bepul)

1. [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → "Create API key"
2. Kalitni `.env` faylga qo'ying:

```bash
cp functions/.env.example functions/.env
# GEMINI_API_KEY=AIza... ni yozing
```

`.env` faqat serverda qoladi, hech qachon repo'ga tushmaydi.

### 4. Telegram bot (ixtiyoriy, lekin tavsiya etiladi)

1. @BotFather → `/newbot` → token oling
2. `functions/.env` ga `TELEGRAM_BOT_TOKEN` va `TELEGRAM_CHAT_ID` (admin kanal ID) yozing
3. Bot orqali ham murojaat qabul qilish:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://europe-west1-murojaat-ai.cloudfunctions.net/api/api/telegram/webhook"
```

### 5. Deploy

```bash
npm install -g firebase-tools
firebase login
bash scripts/deploy.sh
```

Yoki qo'lda:

```bash
cd functions && npm install && cd ..
firebase deploy --only functions,firestore,hosting --project murojaat-ai
node scripts/set-admin.js admin@example.com parol
```

Sayt: **https://murojaat-ai.web.app**

## API

| Method | Endpoint | Vazifa |
|---|---|---|
| POST | `/api/requests` | Yangi murojaat (kategoriya + ustuvorlik avtomatik) |
| GET | `/api/requests?limit=200` | Murojaatlar ro'yxati |
| PATCH | `/api/requests/:id` | Status/javob o'zgartirish (admin token talab) |
| POST | `/api/chat` | AI javob (Gemini 2.0 Flash) |
| POST | `/api/telegram/webhook` | Telegram orqali murojaat qabul qilish |

AI kaliti yo'q bo'lsa ham chat ishlaydi — qoidalar asosidagi qo'lda javob qaytaradi.

## Xavfsizlik

- `.env` va `public/firebase-config.js` `.gitignore` da
- AI kaliti faqat serverda; frontend hech qachon kalit olmaydi
- `PATCH` endpoint `admin` custom claim'ni tekshiradi
- `requests` yozish ochiq (fuqaro murojaati), o'zgartirish faqat admin
