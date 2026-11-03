#!/usr/bin/env bash
# FuQorAI — to'liq deploy scripti
set -e
cd "$(dirname "$0")/.."

echo "== 1. Firebase login =="
firebase login
firebase use murojaat-ai

echo "== 2. Functions dependencies =="
cd functions && npm install && cd ..

echo "== 3. Env tekshiruvi =="
if [ ! -f functions/.env ]; then
  echo "functions/.env topilmadi. .env.example asosida yarating:"
  cp functions/.env.example functions/.env
  echo "  -> GEMINI_API_KEY ni kiriting va qayta ishga tushiring."
  exit 1
fi

echo "== 4. Deploy =="
firebase deploy --only functions,firestore,hosting --project murojaat-ai

echo "== 5. Admin claim =="
node scripts/set-admin.js admin@example.com parol

echo "Tayyor! Sayt: https://murojaat-ai.web.app"
