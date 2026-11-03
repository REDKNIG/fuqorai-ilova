# FuQorAI — Fuqaraviy murojaatlar uchun sun'iy intellekt yordamchisi

O'zbekiston fuqaraviy hokimiyatlari uchun mo'ljallangan veb-ilova:
fuqaro murojaat qoldiradi, tizim uni avtomatik kategoriyaga ajratadi,
xodimlar panelida ishlaydi, va Sun'iy intellekt qonuniy yechim taklif qiladi.

## Tuzilma

```
public/          # frontend (statik sayt, Firebase Hosting)
  index.html
  style.css
  app.js
  firebase-config.js      # kalitlar shu yerga (gitignore'da)
functions/       # backend (Cloud Functions, 2nd gen)
  index.js                # api function: requests / chat / telegram webhook
  .env.example
firestore.rules  # access rules
firebase.json
```

## Texnologiyalar

- Firebase Hosting + Firestore + Authentication (Email/Password)
- Cloud Functions (Node.js 20, europe-west1) — API va Telegram bildirishnoma
- OpenAI `gpt-4o-mini` — AI javoblar

## O'rnatish

### 1. Firebase loyihasi

1. https://console.firebase.google.com -> yangi loyiha
2. Firestore -> Database yarating (test mode)
3. Authentication -> Sign-in method -> Email/Password yoqing
4. Project settings -> Your apps -> Web app -> config obyektini ko'chiring

### 2. Lokal sozlama

```bash
cp public/firebase-config.example.js public/firebase-config.js
# firebase-config.js ichiga Firebase config'ni yozing
cp functions/.env.example functions/.env
# functions/.env ichiga OPENAI_API_KEY va TELEGRAM_* kalitlarini yozing
```

### 3. Admin hisobi va admin claim

```bash
cd functions
npm install
node ../scripts/set-admin.js admin@example.com parol
```

Skript foydalanuvchini Auth'ga yaratadi va `admin: true` custom claim qo'yadi.
(Firestore'da `admins/{uid}` hujjatini ham yaratadi.)

### 4. Telegram bot (ixtiyoriy, tavsiya etiladi)

1. @BotFather -> /newbot
2. Yaratilgan tokenni `functions/.env` ga `TELEGRAM_BOT_TOKEN` sifatida yozing
3. Yangi murojaat xabarlari shu chatga yuboriladi: `TELEGRAM_CHAT_ID` (admin kanal/group id)
4. Bot orqali ham murojaat qabul qilish uchun webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://europe-west1-<project>.cloudfunctions.net/api/api/telegram/webhook"
```

### 5. Deploy

```bash
npm install -g firebase-tools
firebase login
firebase use <project-id>
cd functions && npm install && cd ..
firebase deploy --only functions,firestore,hosting
```

### 6. Lokal ishga tushirish

```bash
firebase emulators:start
```

## API

| Method | Endpoint | Vazifa |
|---|---|---|
| POST | `/api/requests` | Yangi murojaat (kategoriya + ustuvorlik avtomatik) |
| GET  | `/api/requests?limit=200` | Murojaatlar ro'yxati |
| PATCH | `/api/requests/:id` | Status/javob o'zgartirish (admin token talab) |
| POST | `/api/chat` | AI javob (gpt-4o-mini) |
| POST | `/api/telegram/webhook` | Telegram orqali murojaat qabul qilish |

## Xavfsizlik

- `.env` va `public/firebase-config.js` `.gitignore` da — repo'ga tushmaydi
- OpenAI kaliti faqat serverda; frontend hech qachon kalit olmaydi
- `PATCH` endpoint `admin` custom claim'ni tekshiradi
- `requests` yozish ochiq (fuqaro murojaati), o'qish ochiq, o'zgartirish faqat admin
