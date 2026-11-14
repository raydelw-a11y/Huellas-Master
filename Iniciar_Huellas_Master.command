#!/bin/bash
cd "$(dirname "$0")"
STATUS_JSON="$(curl -s --max-time 2 http://127.0.0.1:4200/api/flow/process-clips-status 2>/dev/null || true)"
if printf '%s' "$STATUS_JSON" | grep -q '"icloudTccPending":false'; then
  echo "✅ Huellas Master ya está activo en http://localhost:4200 con acceso verificado a iCloud Drive."
  open "http://localhost:4200"
  exit 0
fi

LAUNCHD_LABEL="com.raydelsantana.huellas-master"
LAUNCHD_DOMAIN="gui/$(id -u)"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"

if [ -f "$LAUNCHD_PLIST" ]; then
  launchctl bootstrap "$LAUNCHD_DOMAIN" "$LAUNCHD_PLIST" 2>/dev/null || true
  launchctl kickstart -k "$LAUNCHD_DOMAIN/$LAUNCHD_LABEL" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    sleep 1
    STATUS_AFTER_KICK="$(curl -s --max-time 2 http://127.0.0.1:4200/api/flow/process-clips-status 2>/dev/null || true)"
    if printf '%s' "$STATUS_AFTER_KICK" | grep -q '"icloudTccPending":false'; then
      echo "✅ Huellas Master activado vía LaunchAgent con acceso a iCloud Drive."
      open "http://localhost:4200"
      exit 0
    fi
  done
  launchctl bootout "$LAUNCHD_DOMAIN/$LAUNCHD_LABEL" 2>/dev/null || true
fi

EXISTING_PIDS="$(lsof -tiTCP:4200 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PIDS" ]; then
  echo "♻️ Reiniciando instancia previa en :4200 ($EXISTING_PIDS)..."
  echo "$EXISTING_PIDS" | xargs kill -TERM 2>/dev/null || true
  sleep 1
fi

export PATH="$HOME/.huellas-runtime/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export UV_THREADPOOL_SIZE=32
echo "🎬 Iniciando Huellas Master en http://localhost:4200 ..."
(sleep 2 && open "http://localhost:4200") &
if [ -x "$HOME/.huellas-runtime/node/bin/node" ]; then
  exec "$HOME/.huellas-runtime/node/bin/node" ./node_modules/tsx/dist/cli.mjs server.ts
else
  npm run dev
fi
