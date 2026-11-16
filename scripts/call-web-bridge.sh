#!/usr/bin/env bash
set -eo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

MODEL="${1:-}"
PROMPT="${2:-}"
MAX_TIME="${3:-300}"

if [ -z "$MODEL" ] || [ -z "$PROMPT" ]; then
  echo "Uso: $0 <chatgpt|gemini|claude|grok|copilot> \"<prompt>\" [max_time_sec]" >&2
  exit 1
fi

MODEL_LOWER="$(echo "$MODEL" | tr '[:upper:]' '[:lower:]')"
case "$MODEL_LOWER" in
  *chatgpt*|*gpt*) BRIDGE="chatgpt" ;;
  *gemini*)        BRIDGE="gemini" ;;
  *claude*)        BRIDGE="claude" ;;
  *grok*)          BRIDGE="grok" ;;
  *copilot*)       BRIDGE="copilot" ;;
  *)
    echo "Modelo desconocido: $MODEL. Debe ser chatgpt, gemini, claude, grok o copilot." >&2
    exit 1
    ;;
esac

repair_connection() {
  echo "🔧 [auto-repair] Verificando estado del servidor y extensión en :4200..." >&2

  # 1. Comprobar si :4200 responde
  local FP_STATUS
  FP_STATUS="$(curl -s --max-time 3 http://localhost:4200/api/extension/fingerprint 2>/dev/null || true)"
  if ! printf '%s' "$FP_STATUS" | grep -q '"ok":true'; then
    echo "⚠️ [auto-repair] Servidor :4200 no responde. Iniciando servicio con Iniciar_Huellas_Master.command..." >&2
    "$APP_DIR/Iniciar_Huellas_Master.command" --no-open >/dev/null 2>&1 || true
    for _ in {1..24}; do
      sleep 0.5
      FP_STATUS="$(curl -s --max-time 2 http://localhost:4200/api/extension/fingerprint 2>/dev/null || true)"
      if printf '%s' "$FP_STATUS" | grep -q '"ok":true'; then
        echo "✅ [auto-repair] Servidor restablecido en http://localhost:4200." >&2
        break
      fi
    done
  fi

  # 2. Comprobar frescura de la extensión y recargar si está inactiva
  local LAST_ACK
  LAST_ACK="$(printf '%s' "$FP_STATUS" | jq -r '.lastAckAt // 0' 2>/dev/null || echo "0")"
  local NOW_MS
  NOW_MS="$(node -e 'console.log(Date.now())' 2>/dev/null || echo "0")"
  local DIFF_MS=$(( NOW_MS - LAST_ACK ))
  if [ "$LAST_ACK" = "0" ] || [ "$DIFF_MS" -gt 15000 ]; then
    echo "♻️ [auto-repair] Extensión desincronizada o inactiva (${DIFF_MS}ms). Recargando extensión..." >&2
    curl -s -X POST http://localhost:4200/api/extension/reload >/dev/null 2>&1 || true
    sleep 1.5
  fi
}

# Ejecutar chequeo preventivo de auto-reparación
repair_connection

# Preparar payload JSON seguro con jq
PAYLOAD="$(jq -n --arg p "$PROMPT" --argjson t "$(( MAX_TIME * 1000 ))" '{ prompt: $p, timeoutMs: $t }')"

ENDPOINT="http://localhost:4200/api/${BRIDGE}-web/ask-external"

RESPONSE=""
EXIT_CODE=0
RESPONSE="$(curl -s --max-time "$MAX_TIME" -X POST "$ENDPOINT" -H "Content-Type: application/json" -d "$PAYLOAD")" || EXIT_CODE=$?

# Si falló con error de conexión (código 7, 28, 52) o respuesta vacía:
if [ "$EXIT_CODE" -ne 0 ] || [ -z "$RESPONSE" ] || printf '%s' "$RESPONSE" | grep -q '"ok":false'; then
  # Si el error es de CAPTCHA/Cloudflare o sesión cerrada, no reintentar; reportar inmediatamente
  if printf '%s' "$RESPONSE" | grep -qE "verificaci[oó]n|challenge|captcha|inicia sesi[oó]n|sign in"; then
    echo "$RESPONSE"
    exit 0
  fi

  echo "⚠️ [auto-repair] La llamada a $BRIDGE devolvió fallo técnico (código $EXIT_CODE). Aplicando auto-reparación y reintentando..." >&2
  repair_connection
  EXIT_CODE=0
  RESPONSE="$(curl -s --max-time "$MAX_TIME" -X POST "$ENDPOINT" -H "Content-Type: application/json" -d "$PAYLOAD")" || EXIT_CODE=$?
fi

echo "$RESPONSE"
exit "$EXIT_CODE"
