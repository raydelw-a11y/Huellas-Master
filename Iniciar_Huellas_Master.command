#!/bin/bash
cd "$(dirname "$0")"
STATUS_JSON="$(curl -s --max-time 2 http://127.0.0.1:4200/api/flow/process-clips-status 2>/dev/null || true)"
if printf '%s' "$STATUS_JSON" | grep -q '"icloudTccPending":false'; then
  echo "✅ Huellas Master ya está activo en http://localhost:4200 con acceso verificado a iCloud Drive."
  open "http://localhost:4200"
  exit 0
fi

launchctl bootout "gui/$(id -u)/com.raydelsantana.huellas-master" 2>/dev/null || true
EXISTING_PIDS="$(lsof -tiTCP:4200 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PIDS" ]; then
  echo "♻️ Reiniciando instancia previa en :4200 ($EXISTING_PIDS)..."
  echo "$EXISTING_PIDS" | xargs kill -TERM 2>/dev/null || true
  sleep 1
fi

export PATH="$HOME/.huellas-runtime/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
echo "🎬 Iniciando Huellas Master en http://localhost:4200 ..."
(sleep 2 && open "http://localhost:4200") &
if [ -x "$HOME/.huellas-runtime/node/bin/node" ]; then
  exec "$HOME/.huellas-runtime/node/bin/node" ./node_modules/.bin/tsx server.ts
else
  npm run dev
fi
