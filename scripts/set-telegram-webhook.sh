#!/usr/bin/env bash
# Telegram webhook'ni Firebase Function URL'ga ulaydi
# Ishlatish: TELEGRAM_BOT_TOKEN=... ./scripts/set-telegram-webhook.sh
set -euo pipefail

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN kerak}"
URL="${WEBHOOK_URL:-https://murojaat-ai.web.app/api/telegram/webhook}"
SECRET="${TELEGRAM_WEBHOOK_SECRET:-}"

echo "-> Bot tekshirilmoqda..."
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" | head -c 300; echo

echo "-> Webhook o'rnatilmoqda..."
if [ -n "$SECRET" ]; then
  PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"url":sys.argv[1],"secret_token":sys.argv[2],"allowed_updates":["message"]}))' "$URL" "$SECRET")
else
  PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"url":sys.argv[1],"allowed_updates":["message"]}))' "$URL")
fi
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" -d "$PAYLOAD" | head -c 300
echo
echo "-> Tekshiruv:"
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | head -c 400; echo
