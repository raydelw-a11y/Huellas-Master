#!/bin/bash
set -e
APP_DIR="/Users/raydelsantana/antigravity/Huellas Master"
NODE_BIN="$HOME/.huellas-runtime/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="/usr/local/bin/node"
fi
while :; do
  STATUS_RESP="$(curl -s --max-time 2 http://127.0.0.1:4200/api/flow/process-clips-status 2>/dev/null || true)"
  if printf '%s' "$STATUS_RESP" | grep -q '"icloudDriveVerifiedReady":true'; then
    sleep 5
  else
    break
  fi
done
export PATH="$HOME/.huellas-runtime/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export UV_THREADPOOL_SIZE=32
cd "$APP_DIR"
exec "$NODE_BIN" "$APP_DIR/node_modules/tsx/dist/cli.mjs" "$APP_DIR/server.ts"
