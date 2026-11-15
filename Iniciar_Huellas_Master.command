#!/bin/bash
cd "$(dirname "$0")"

LAUNCHD_LABEL="com.raydelsantana.huellas-master"
LAUNCHD_DOMAIN="gui/$(id -u)"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"

NO_OPEN_BROWSER=0
if [ "${1:-}" = "--no-open" ] || [ "${HUELLAS_NO_OPEN:-0}" = "1" ] || [ -f /tmp/huellas-no-open-once.flag ]; then
  rm -f /tmp/huellas-no-open-once.flag 2>/dev/null || true
  NO_OPEN_BROWSER=1
fi
open_app_url() {
  if [ "$NO_OPEN_BROWSER" != "1" ]; then
    open "http://localhost:4200"
  fi
}

STATUS_JSON="$(curl -s --max-time 2 http://127.0.0.1:4200/api/flow/process-clips-status 2>/dev/null || true)"
HAS_ICLOUD_READY=false
if printf '%s' "$STATUS_JSON" | grep -q '"icloudDriveVerifiedReady":true'; then
  HAS_ICLOUD_READY=true
fi

# 1. Salida rápida: nunca matar una instancia sana con acceso verificado a iCloud Drive (sea LaunchAgent o Terminal.app)
if [ "$HAS_ICLOUD_READY" = "true" ]; then
  echo "✅ Huellas Master ya está activo en http://localhost:4200 con acceso verificado a iCloud Drive."
  open_app_url
  exit 0
fi

# 2. Liberar :4200 antes de intentar el LaunchAgent si el proceso previo no tiene acceso verificado a iCloud
EXISTING_PIDS="$(lsof -tiTCP:4200 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PIDS" ]; then
  echo "♻️ Liberando puerto :4200 de proceso previo sin iCloud TCC ($EXISTING_PIDS)..."
  kill -TERM $EXISTING_PIDS 2>/dev/null || true
  sleep 1
  STILL_ALIVE="$(lsof -tiTCP:4200 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$STILL_ALIVE" ]; then
    kill -KILL $STILL_ALIVE 2>/dev/null || true
    sleep 1
  fi
fi

# 3. Intentar LaunchAgent hasta 7s; si el binario aislado carece de TCC en macOS, descargar y pasar a Terminal.app
if [ -f "$LAUNCHD_PLIST" ]; then
  launchctl print "$LAUNCHD_DOMAIN/$LAUNCHD_LABEL" >/dev/null 2>&1 || launchctl bootstrap "$LAUNCHD_DOMAIN" "$LAUNCHD_PLIST" 2>/dev/null || true
  launchctl kickstart -k "$LAUNCHD_DOMAIN/$LAUNCHD_LABEL" 2>/dev/null || true

  for _ in $(seq 1 7); do
    sleep 1
    STATUS_AFTER_KICK="$(curl -s --max-time 2 http://127.0.0.1:4200/api/flow/process-clips-status 2>/dev/null || true)"
    if printf '%s' "$STATUS_AFTER_KICK" | grep -q '"icloudDriveVerifiedReady":true'; then
      echo "✅ Huellas Master activado vía LaunchAgent con acceso verificado a iCloud Drive."
      open_app_url
      exit 0
    fi
  done

  echo "⚠️ LaunchAgent aún no obtuvo TCC sobre iCloud Drive; pasando limpiamente a Terminal.app..."
  launchctl bootout "$LAUNCHD_DOMAIN/$LAUNCHD_LABEL" 2>/dev/null || true
  LAUNCHD_LEFT_PIDS="$(lsof -tiTCP:4200 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$LAUNCHD_LEFT_PIDS" ]; then
    kill -TERM $LAUNCHD_LEFT_PIDS 2>/dev/null || true
    sleep 1
    LAUNCHD_STILL="$(lsof -tiTCP:4200 -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$LAUNCHD_STILL" ]; then
      kill -KILL $LAUNCHD_STILL 2>/dev/null || true
      sleep 1
    fi
  fi
fi

# Fallback con TCC heredado de Terminal.app
export PATH="$HOME/.huellas-runtime/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export UV_THREADPOOL_SIZE=32
echo "🎬 Iniciando Huellas Master en http://localhost:4200 ..."
if [ "$NO_OPEN_BROWSER" != "1" ]; then
  (sleep 2 && open "http://localhost:4200") &
fi
if [ -x "$HOME/.huellas-runtime/node/bin/node" ]; then
  if [ "$NO_OPEN_BROWSER" = "1" ]; then
    exec "$HOME/.huellas-runtime/node/bin/node" ./node_modules/tsx/dist/cli.mjs server.ts >> /tmp/huellas-master-4200.log 2>> /tmp/huellas-master-4200.err.log
  else
    exec "$HOME/.huellas-runtime/node/bin/node" ./node_modules/tsx/dist/cli.mjs server.ts
  fi
else
  npm run dev
fi
