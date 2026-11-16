# Regla Obligatoria: Trabajo Concurrente en Múltiples Conversaciones

El usuario trabaja simultáneamente en **varias conversaciones en paralelo sobre este mismo proyecto (`Huellas Master`)** para agilizar el flujo de trabajo. Todos los agentes en todas las conversaciones DEBEN cumplir estrictamente estas reglas en cada turno:

1. **Lectura inmediata antes de editar (`read_file`)**:
   - Antes de realizar cualquier cambio en un archivo (especialmente `src/App.tsx`, `src/components/CapCutTimelineEditor.tsx`, `server.ts`, `src/utils/cloudSync.ts` o `data/documentaries.json`), lee siempre las líneas exactas del archivo en ese instante para obtener la versión más reciente dejada por otras conversaciones.

2. **Ediciones 100% quirúrgicas (`edit_file`) — Prohibido sobrescribir**:
   - Modifica únicamente el bloque exacto de líneas que corresponde a tu tarea actual.
   - **PROHIBIDO** usar `write_file` con `Overwrite: true` sobre archivos de código existentes.
   - **PROHIBIDO** ejecutar `git checkout -- <file>`, `git restore`, `git reset --hard`, `git stash` o cualquier comando que descarte o revierta cambios hechos por otra conversación en paralelo.

3. **Compilación y `git commit` seguros**:
   - Antes de hacer `git commit` y `git push`, verifica con `git status` y `git diff` que no estás revirtiendo ni eliminando funciones, estilos o correcciones agregadas por otra conversación paralela.
   - Si `git push` rechaza por cambios remotos nuevos, usa `git pull --rebase` conservando ambos cambios sin sobrescribir el trabajo ajeno.

---

# Reglas Específicas de `Huellas Master` para el Sistema Global de 10 Niveles (`MODO 1 / SOLO` a `MODO 10 / MÁXIMO`)

Este proyecto aplica íntegramente el **Sistema Global de Auto-Triaje de 10 Niveles (`user_global`)** con estas reglas concretas del repositorio `Huellas Master`:

1. **Archivos Críticos Compartidos de `Huellas Master` (`+2 pts` Automáticos y Obligatorios en Riesgo de Regresión)**:
   - Si la tarea lee para modificar o toca **cualquiera** de estos archivos o flujos, **es obligatorio sumar `+2 pts` sin redondear jamás a la baja**:
     - `src/components/CapCutTimelineEditor.tsx` y `src/components/CapCutEditor.tsx` (Timeline / WebAudio / render del editor).
     - `src/utils/cloudSync.ts` y `src/utils/smartParsers.ts` (sincronización documental, auditoría de clips y parseo de etapas).
     - `chrome-extension/background.js`, `chrome-extension/flow-content.js`, `chrome-extension/gemini-content.js`, `chrome-extension/chatgpt-content.js`, `chrome-extension/claude-content.js`, `chrome-extension/grok-content.js` y `chrome-extension/copilot-content.js`.
     - Pipeline de exportación/escalado 4K (`FFmpeg` / endpoints de render en `server.ts`).

2. **Coordinación Segura en `swarm` sobre `Huellas Master` (R1/R2 Solo Lectura → Fase 3 Paralela `1 Archivo = 1 Modelo`)**:
   - **Guardia Anti-Simulación (Cero Trabajo en Solitario en Modos 2–10)**: Si el triaje resulta en Modo 2 al 10 (o por orden explícita del usuario), el coordinador tiene **TERMINANTEMENTE PROHIBIDO** editar código solo o simular a los compañeros en texto. La primera llamada debe ser `swarm({ action: "add" })` o `post_message({ text: "@<worker1> @<worker2> ... [RONDA 1: ...]" })` despertando a los workers existentes. No se puede tocar ningún archivo de código (`edit_file`) hasta haber completado R1 + R2 cruzada en la pizarra.
   - Durante **Ronda 1 y Ronda 2**, todos los workers lanzados con `swarm({ action: "add", workspace: "inherit", ... })` (`carbon-medium`, `argon-medium`, `orchestrator`, `hydrogen-medium` / `hydrogen-xhigh`) tienen **permiso completo de lectura e inspección profunda del código sin límite de palabras**, pero operan **100% en modo solo análisis/debate (`PROHIBIDO` editar archivos o correr comandos destructivos antes del consenso de R2)**.
   - **Fase 3 Post-R2 en `Huellas Master`**:
     - **1 archivo (o ajuste menor puntual)**: edita directamente el coordinador (`Flash 3.8 High`).
     - **2+ archivos medianos/grandes**: el coordinador fija literalmente el contrato compartido (`src/types.ts`, exports y rutas `/api/...`) y asigna **1 dueño exclusivo por archivo de código fuente** mencionando con `@` solo a los workers con archivo asignado (`PROHIBIDO` `@all`; cada worker hace `read_file` inmediato → `edit_file` quirúrgico respetando las conversaciones paralelas y responde solo a `@coordinator`). Si un worker edita `src/App.tsx`, recibe de una vez la hora NY (`MM/DD/YYYY`) para actualizar `LAST_UPDATED_TEXT` en esa misma pasada.
     - **Exclusivo del Coordinador (`PROHIBIDO` en workers)**: tocar `data/documentaries.json` o `docs/data/documentaries.json` (`npm run sync:public-docs`), `vite.config.ts`, `POST /api/extension/reload`, `npm run verify`, `npm run build` (corrigiendo directo el coordinador cualquier roce menor de tipos/rutas sin reabrir pizarra) y `git commit` / `git push`.

3. **Arquitectura de Puentes Web Locales de `Huellas Master` (`Niveles 6 a 10` — `localhost:4200`), Modos Ligeros y Guardia Anti-CAPTCHA/Cloudflare**:
   - **Modos de Respuesta Rápida en las Webs**:
     - `Gemini Web` (`/api/gemini-web/ask-external`, Nivel 7+): siempre en **`Quick answers`** (fuera de Notebooks).
     - `Claude Web` (`/api/claude-web/ask-external`, Nivel 8+): siempre en esfuerzo **`Bajo` (`Low`)** y sin Extended Thinking.
     - `Grok Web` (`/api/grok-web/ask-external`, Niveles 9–10): siempre en modo **`Fast`**.
     - `Copilot Web` (`/api/copilot-web/ask-external`, Nivel 10): siempre en modo **`Quick Response`** (automático en Nivel 10).
   - **Fase 0 Web 100% Automática en Paralelo en Niveles 6 a 10 (Cero Preguntas al Usuario)**:
     - En **Niveles 6 a 10**: queda **ESTRICTAMENTE PROHIBIDO** preguntar al usuario con `ask_question` si desea consultar manualmente a servicios web externos o emitir bloques de texto manuales. Las consultas web de Fase 0 se ejecutan **100% automáticas en paralelo** (`active: false`, 100% en inglés):
       * **Nivel 6**: `ChatGPT Web`.
       * **Nivel 7**: `ChatGPT Web` + `Gemini Web` (`Quick answers`).
       * **Nivel 8**: `ChatGPT Web` + `Gemini Web` (`Quick answers`) + `Claude Web` (`Bajo`).
       * **Nivel 9**: `ChatGPT Web` + `Gemini Web` (`Quick answers`) + `Claude Web` (`Bajo`) + `Grok Web` (`Fast`).
       * **Nivel 10 (`MÁXIMO`)**: Las 5 Webs en paralelo (`ChatGPT Web` + `Gemini Web` + `Claude Web` + `Grok Web` + `Copilot Web`).
     - **Barrera Estricta antes de Ronda 1**: **ESTÁ PROHIBIDO** iniciar la Ronda 1 de los motores internos de Antigravity hasta haber recibido **todas** las respuestas Web automáticas del nivel. Una vez recibidas, se abre R1 con los motores del nivel en `swarm`.
   - **Guardia Limpia Anti-CAPTCHA / Cloudflare Turnstile Siempre Activa**: Todos los puentes web detectan en solo lectura retos de Cloudflare Turnstile, CAPTCHA o sesión cerrada. **PROHIBIDO** intentar hacer clic, resolver, esperar o evadir cualquier reto anti-bot por código o herramientas: cuando se detecta uno, el puente se detiene limpio de inmediato y avisa al usuario (entregándole el prompt en bloque copiable o permitiéndole completarlo manualmente en la pestaña visible de Chrome).
   - **Idioma 100% Inglés**: Todo `prompt` enviado a `/api/<chatgpt-web|gemini-web|claude-web|grok-web|copilot-web>/ask-external` debe redactarse **100% en inglés técnico claro**, aunque el chat con el usuario sea en español.
   - **Misma Ventana Ancla y Pestañas Residentes (`presence.anchorWindowId` / `hasAppWindow=1`)**:
     - Todas las consultas web automáticas operan con `active: false` (100% silenciosas, sin robar foco) **dentro de la misma ventana y perfil de Chrome donde está abierta `Huellas Master`**, donde `ensureResidentGeminiAndChatGptTabs` mantiene siempre vivas (`autoDiscardable: false`) al menos **1 pestaña de `gemini.google.com/app`, 1 de `chatgpt.com`, 1 de `claude.ai/new`, 1 de `grok.com/` y 1 de `copilot.microsoft.com/`** (reutilizando pestaña libre en un Nuevo chat o creando pestaña temporal `active: false` si está ocupada).
     - **PROHIBIDO** usar `chrome-devtools` MCP (`new_page` / `navigate_page`) para estas consultas (abre un navegador aislado sin sesión) y **PROHIBIDO** ejecutar `osascript ... window 1` a ciegas.
   - **Auto-Reparación de Conexiones Web Obligatoria del Coordinador**: Si cualquier llamada a un puente web falla por error técnico (`curl exit 7/28/52`, `:4200` caído o respuesta vacía), el coordinador **no debe detenerse ni consultar al usuario**: (a) levanta el servicio con `./Iniciar_Huellas_Master.command --no-open` hasta que `GET /api/extension/fingerprint` devuelva `200`; (b) si la extensión está inactiva o desincronizada (`lastAckAt` > 15s), recarga con `POST /api/extension/reload` (o ejecuta directamente `bash scripts/call-web-bridge.sh <modelo> "<prompt>"` que maneja esta auto-reparación preventiva y reintento en bucle seguro); (c) reintenta la consulta web y reporta el `verifiedModel`.

---

# Blindaje Obligatorio Anti-Regresiones (Matriz de Impacto Cruzado y Compuerta `npm run verify`)

Antes de dar por terminado **cualquier** cambio en código, datos o extensión dentro de `Huellas Master`, todos los agentes deben verificar obligatoriamente las zonas hermanas acopladas usando esta Matriz de Impacto Cruzado:

| Si modificas… | Debes revisar obligatoriamente también… | Motivo crítico |
| :--- | :--- | :--- |
| **`src/types.ts` o `promptConfig` / `productionType`** | `src/utils/cloudSync.ts`, `src/utils/smartParsers.ts`, `src/App.tsx`, `server.ts` y `data/documentaries.json` | Ningún enum legado (`SHORT_9X16`, `REELS_9X16`, `clipVoiceMode`) puede romper el selector, Etapa 1, Etapa 6 ni mutar `updatedAt` causando tormentas CAS. |
| **Urls de media / `serve-folder-file` / Intro / `@References`** | `src/App.tsx` (`getMacMediaBridgeBases`, `resolveRemoteFolderMediaUrl`), `src/components/CapCutEditor.tsx` (`getEditorMediaBridgeBases`, `buildOfficialIntroOutroUrls`), `src/utils/cloudSync.ts` (`stripHeavyMediaForStorage`) y `server.ts` (`writeDocumentaries`, `Range`) | La app corre en **3 entornos simultáneos**: Mac `:4200`, Render/iPhone vía túnel Cloudflare HTTPS y GitHub Pages (`docs/`). Nunca dejar `http://localhost:4200` ni `trycloudflare.com` crudos. |
| **Cuarentena / rechazo / Stage 7 / Stage 8 / `merge`** | `src/utils/cloudSync.ts` (`mergeTwoDocumentaryObjects`), `server.ts` (`mergeServerClipArrays`) y los cargadores de clips en `src/App.tsx` | Impedir resurrección de `videoReady: true` tras rechazo y preservar la cola de clips (`> max clipNumber`) en merges parciales. |
| **Transiciones o Split Clip 1 en Editor** | `src/components/CapCutEditor.tsx` (`ClipTransitionType`, `normalizeEditorClipTransition`, `isFirstClipAfterIntro`) y `server.ts` (builder FFmpeg `isFirstClipAfterIntro`) | La clave canónica es `'dip_black'` (jamás `'fade_black'`). La Parte B de un Clip 1 dividido no debe repetir fade-in ni sobrescribir `'direct'`. |
| **`data/documentaries.json` o `docs/data/documentaries.json`** | `scripts/sync-public-docs-json.mjs` y `server.ts` (`writeDocumentaries` / `writeFileAtomicUtf8`) | Nunca usar `cp` directo sobre `data/documentaries.json` hacia `docs/data/` ni `fs.writeFileSync` crudo; `docs/data/` debe ir libre de `videoFrames` y `data:` > 60KB. |
| **Puentes Web (`chatgpt-content.js` / `gemini-content.js` / `claude-content.js` / `grok-content.js`)** | `node --check chrome-extension/*.js` y prueba real en `:4200` | No cortar respuestas válidas cortas ni dejar pasar texto intermedio de razonamiento. |
| **Cualquier cambio antes de compilar o subir** | Ejecutar `npm run verify` y `npm run build` (actualizando también fallback `LAST_UPDATED_TEXT` / `__BUILD_TIMESTAMP__`) | Compuerta bloqueante de 6 gates (`tsc --noEmit`, AST JSX/extensión, paridad rutas API, anti-fugas, invariantes JSON J1–J5, UI Global `Actualizado:` + `Acceso Privado`). |
