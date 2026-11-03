#!/usr/bin/env bash
# Firebase Functions env'ga kalitlarni o'zgartiradi (eski .env fayldan o'qiydi)
set -euo pipefail
cd "$(dirname "$0")/.."
ENVFILE="${ENVFILE:-functions/.env}"
[ -f "$ENVFILE" ] || { echo "Topilmadi: $ENVFILE"; exit 1; }

set -a; . "./$ENVFILE"; set +a

firebase functions:config:set --project "${FIREBASE_PROJECT:-murojaat-ai}" \
  OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o-mini}" \
  GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
  GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.0-flash}" \
  OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
  OPENROUTER_MODEL="${OPENROUTER_MODEL:-google/gemma-4-26b-a4b-it:free}" \
  TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}" \
  TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}" \
  APP_URL="${APP_URL:-https://murojaat-ai.web.app}"

echo "Yangi config:"
firebase functions:config:get --project "${FIREBASE_PROJECT:-murojaat-ai}"
