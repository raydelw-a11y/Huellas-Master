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

# Sistema de Auto-Triaje de Complejidad y Protocolo `SOLO` / `MODO DUO` / `MODO TRIO` / `MODO CUATRO`

En **CADA tarea técnica del usuario**, el agente coordinador ejecuta obligatoriamente este **Paso 0 de Auto-Triaje** antes de editar código:

0. **PASO 0 OBLIGATORIO — AUTO-TRIAJE DE COMPLEJIDAD Y OVERRIDE MANUAL**:
   - **Prioridad 1 — Orden Explícita del Usuario (Override Manual)**:
     - Si el usuario indica explícitamente `modo solo`, `modo duo`, `modo trio` o `modo cuatro` / `modo 4` como instrucción de ejecución (con o sin `/boost` o `/teamwork`, sin confundirlo con una pregunta teórica sobre los modos), el coordinador obedece ese modo exacto sin cuestionarlo.
   - **Prioridad 2 — Matriz Objetiva de Complejidad (`0 a 10 puntos` cuando el usuario NO especifica modo)**:
     - **A. Archivos y Capas**: 1 archivo local (`0 pts`) · 2–3 archivos conectados (`+2 pts`) · 4+ archivos o cruce `src/App.tsx + server.ts + chrome-extension/` (`+3 pts`).
     - **B. Naturaleza del Problema**: ajuste claro de botones, textos, estilos o prompts (`0 pts`) · nueva lógica de estado, parsers, descargas o endpoints (`+2 pts`) · bug sin causa obvia, condiciones de carrera, FFmpeg, WebAudio o selectores DOM externos (`+3 pts`).
     - **C. Riesgo de Regresión (`REGLA ANTI-REDONDEO A LA BAJA`)**: zona aislada (`0 pts`) · si **cualquiera** de los archivos previstos o tocados incluye flujos sensibles compartidos como Timeline del editor (`CapCutTimelineEditor.tsx`), `cloudSync.ts`, `smartParsers.ts`, `background.js`, `flow-content.js`, `gemini-content.js` o pipeline 4K, **es automático y obligatorio sumar `+2 pts` sin excepción** (**PROHIBIDO** poner `+0` o redondear a la baja cuando alguno de esos archivos está implicado; ante duda entre dos puntajes, aplica siempre el más alto).
     - **D. Reincidencia (Auto-Escalado)**: fallo que persiste o *"sigue sin funcionar"* tras un intento previo (`+4 pts` automáticos).
   - **Umbrales de Decisión y Encabezado Inicial en MODO LISTA (solo el modo elegido + viñetas cortas de tareas y puntos, SIN deliberación previa ni `debate_robots.html` / `<agent-embed>`)**:
     - **Formato obligatorio en MODO LISTA al principio del turno (`PROHIBIDO escribir párrafos previos antes del encabezado y PROHIBIDO poner el desglose corrido en una sola línea`)**: El mensaje debe abrir directamente con el título del **único modo que se va a usar** y el total `(X/10)`, seguido inmediatamente debajo por una **lista vertical con viñetas (`-`)** indicando cada tarea concreta a realizar y los puntos que sumó (sin etiquetas genéricas vacías como `Regresión: +0` ni mencionar los demás modos; si fue orden manual explícita, añade `Override Manual`).
       - *Ejemplo real*:
         ```markdown
         🤝 **[AUTO-TRIAJE → MODO TRIO: Gemini Web + ChatGPT Web + 3 Agentes (7/10)]**
         - Cruzar `App.tsx` + `server.ts` + `background.js` (`+3 pts`)
         - Nueva lógica de sincronización de pestañas web (`+2 pts`)
         - Toca flujo compartido crítico de `background.js` (`+2 pts`)
         ```
     - **`0–2 pts` → Ejecución Directa (`SOLO`)**:
       Muestra **`⚡ [AUTO-TRIAJE → Ejecución Directa (X/10)]`** seguido de la lista `- <tarea> (+pts)` y resuelve de inmediato sin lanzar subagentes ni consultas web.
     - **`3–5 pts` → `MODO DUO` Rápido (Solo Subagentes Internos ~30s, SIN Webs Externas)**:
       Muestra **`🤝 [AUTO-TRIAJE → MODO DUO Rápido: Carbon + Argon (X/10)]`** seguido de la lista `- <tarea> (+pts)`.
       - Lanza **únicamente** los 2 subagentes internos (`Model: 'inherit'` + `Model: 'pro'`) **sin** llamar a Gemini Web ni ChatGPT Web, ejecutando **Ronda 1 + Ronda 2 de debate cruzado (`send_message` entre ambos)** antes de editar código.
     - **`6–7 pts` → `MODO TRIO` Completo (3 Subagentes + Gemini Web + ChatGPT Web)**:
       Muestra **`🤝 [AUTO-TRIAJE → MODO TRIO: Gemini Web + ChatGPT Web + 3 Agentes (X/10)]`** seguido de la lista `- <tarea> (+pts)`.
     - **`8–10 pts` → `MODO CUATRO` Crítico (3 Subagentes + Gemini Web + ChatGPT Web + Auditoría Exhaustiva)**:
       Muestra **`🤝 [AUTO-TRIAJE → MODO CUATRO: Gemini Web + ChatGPT Web + 3 Agentes + Auditoría Profunda (X/10)]`** seguido de la lista `- <tarea> (+pts)`.
   - **Auto-Escalado Incremental Dinámico tras Exploración o Ronda 1 (`SIN hacer repetir a los modelos que ya completaron Ronda 1`)**:
     - Si durante la inspección inicial o **al recibir las respuestas de la Ronda 1** el coordinador descubre nuevas tareas, archivos críticos compartidos, condiciones de carrera o riesgos adicionales que elevan el puntaje real a un modo superior, **DEBE recalcular y escalar inmediatamente al modo superior** mostrando en **modo lista**:
       `🔼 **[AUTO-ESCALADO → <NUEVO MODO> (X/10)]**` seguido debajo por viñetas `- <nueva tarea/hallazgo detectado> (+pts añadidos)`.
     - **Regla de Incorporación Incremental (`PROHIBIDO repetir la Ronda 1 en modelos que ya respondieron`)**:
       - Los modelos que **ya completaron su Ronda 1 conservan intacta su propuesta** y **NO** vuelven a ejecutar la Ronda 1.
       - El coordinador lanza **únicamente los modelos o consultas web que faltaban** entre el modo escogido inicialmente y el nuevo modo superior:
         - De **`MODO DUO` Rápido → `MODO TRIO` o `MODO CUATRO`**: mantiene las respuestas de Ronda 1 ya entregadas por `Carbon` y `Argon High`, y lanza **únicamente** en paralelo las consultas en inglés a **Gemini Web (`4 Carbon · Low`)** + **ChatGPT Web** y la Ronda 1 del subagente faltante **`Flash 3.8` (`Model: 'flash'`)**.
         - De **`SOLO` → `MODO DUO` / `MODO TRIO` / `MODO CUATRO`**: incorpora directamente los participantes de ese modo.
         - De **`MODO TRIO` → `MODO CUATRO`**: conserva las 5 respuestas de Ronda 1 ya obtenidas y añade la auditoría exhaustiva línea por línea en la Ronda 2.
       - En cuanto terminen **solo los recién incorporados**, el coordinador ejecuta la **Ronda 2 cruzada (`send_message`) con TODOS los subagentes del modo superior** (`Carbon` + `Argon High` + `Flash 3.8`), entregándoles tanto las respuestas originales de Ronda 1 como las de los modelos/webs recién incorporados.
   - **Flujo Obligatorio cuando se ejecuta `MODO DUO`, `MODO TRIO` o `MODO CUATRO` (por Auto-Triaje o Manual)**:
     1. **Perspectiva Externa Doble en Paralelo (`Gemini Web` + `ChatGPT Web`) — EXCLUSIVA DE `MODO TRIO` Y `MODO CUATRO` (Omitida en `MODO DUO` Rápido) — PROMPTS SIEMPRE EN INGLÉS**:
        - **IDIOMA OBLIGATORIO 100% EN INGLÉS PARA LAS CONSULTAS WEB (`PROHIBIDO enviar prompts en español a Gemini Web o ChatGPT Web`)**: Aunque el usuario escriba su solicitud en español (y aunque al usuario se le responda en español en el chat), **TODOS los prompts enviados a `/api/gemini-web/ask-external` y a `/api/chatgpt-web/ask-external` DEBEN estar redactados SIEMPRE 100% en inglés técnico claro** (incluyendo contexto, restricciones, fragmentos de código relevantes y preguntas de arquitectura).
        - **Regla de Misma Ventana y Perfil de la App + Pestañas Permanentes Vivas de Gemini y ChatGPT (`PROHIBIDO abrir ventana solitaria u otro navegador/perfil`)**: Tanto Gemini Web como ChatGPT Web **DEBEN** operar **dentro de la misma ventana y perfil de Chrome donde está abierta `Huellas Master`** (`presence.anchorWindowId`, nunca abriendo una ventana solitaria aparte), donde el guardián automático `ensureResidentGeminiAndChatGptTabs` mantiene **SIEMPRE abiertas y vivas (`autoDiscardable: false`) al menos 1 pestaña de Gemini (`https://gemini.google.com/app`) y 1 pestaña de ChatGPT (`https://chatgpt.com/`)** (reabriéndolas en segundo plano si alguna se cierra y prohibiendo cerrar la última de cada servicio), usando siempre los puentes locales `POST /api/gemini-web/ask-external` y `POST /api/chatgpt-web/ask-external` (filtrados por `hasAppWindow=1`). **ESTÁ PROHIBIDO** usar `chrome-devtools` MCP (`new_page` / `navigate_page`) para estas consultas (porque levanta un navegador aislado aparte sin sesión) y **ESTÁ PROHIBIDO** ejecutar `osascript ... window 1` a ciegas.
        - **Gemini Web EN PARALELO (`MODO TRIO` y `MODO CUATRO` — `POST http://localhost:4200/api/gemini-web/ask-external`)**: Envía el problema **en inglés** mediante `run_command`:
          `curl -s --max-time 300 -X POST http://localhost:4200/api/gemini-web/ask-external -H "Content-Type: application/json" -d '{"prompt": "<ENGLISH PROMPT>"}'`
          Este puente abre automáticamente una **pestaña nueva temporal silenciosa en segundo plano (`active: false`, sin cambiar la pestaña activa ni robar el foco) de Gemini dentro de la misma ventana de `Huellas Master`** en un **chat nuevo limpio por fuera de todos los Notebooks** (`https://gemini.google.com/app`), selecciona el modelo **4 Carbon** con **Thinking Level en Low** (`4 Carbon · Low` / `Carbon Low`), envía el problema, captura la respuesta completa (`{ ok: true, response: "...", chatUrl: "..." }`) y **cierra automáticamente solo esa pestaña temporal de Gemini en cuanto obtiene la respuesta**.
        - **ChatGPT Web EN PARALELO (`MODO TRIO` y `MODO CUATRO` — `POST http://localhost:4200/api/chatgpt-web/ask-external`)**: En **`TRIO` y `CUATRO`**, junto con Gemini Web se envía **en paralelo** el mismo problema **en inglés** también a **ChatGPT Web** en **modo 100% silencioso en segundo plano (sin robar foco)**:
          `curl -s --max-time 300 -X POST http://localhost:4200/api/chatgpt-web/ask-external -H "Content-Type: application/json" -d '{"prompt": "<ENGLISH PROMPT>"}'`
          Si ya hay una ventana o pestaña libre de ChatGPT abierta en el navegador, este puente **la reutiliza en segundo plano abriendo dentro de ella un Nuevo chat (`https://chatgpt.com/`)** sin abrir otra pestaña ni cerrarla al terminar; **únicamente si otro chat de Antigravity ya está ejecutando una consulta activa en esa ventana/pestaña de ChatGPT (o si no hay ninguna abierta)**, crea una **pestaña temporal paralela con `active: false` dentro de la ventana de `Huellas Master`** y cierra únicamente esa pestaña temporal tras capturar la respuesta completa (`{ ok: true, response: "...", chatUrl: "...", verifiedModel: "..." }`).
        - **AUTO-DIAGNÓSTICO Y AUTO-REPARACIÓN OBLIGATORIA SI FALLA GEMINI WEB O CHATGPT WEB EN `TRIO`/`CUATRO` (`PROHIBIDO rendirse o continuar sin la respuesta web`)**: Si en `MODO TRIO` o `MODO CUATRO` la consulta a Gemini Web o a ChatGPT Web falla (`ok: false`, `curl` exit `7`/`52`, timeout `exit 28`, respuesta vacía, extensión desconectada o cambio en selectores DOM/modelo), **ESTÁ TERMINANTEMENTE PROHIBIDO** continuar el debate sin esa perspectiva web y **ESTÁ PROHIBIDO** detenerse a pedir ayuda al usuario ante fallos técnicos reparables. **Ese mismo agente coordinador DEBE investigar qué pasó, arreglarlo en el acto y continuar la investigación con GPT y Gemini Web**:
          1. **Servidor local (`localhost:4200`)**: Revisar `lsof -iTCP:4200 -sTCP:LISTEN` y `/tmp/huellas-master-4200.log` / `/tmp/huellas-master-4200.err.log`; si está caído, levantarlo mediante `launchctl kickstart -k gui/$(id -u)/com.raydelsantana.huellas-master` (o `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.raydelsantana.huellas-master.plist`).
          2. **Extensión y ventana ancla en Chrome**: Verificar `curl -s http://localhost:4200/api/extension/fingerprint`, confirmar que exista una pestaña abierta de `Huellas Master` en Google Chrome y, si hace falta (con `activeExternalAskIds` vacío), recargar la extensión con `curl -s -X POST http://localhost:4200/api/extension/reload`.
          3. **Puente y selectores DOM**: Si el error proviene de selectores, menú de modelo (`4 Carbon · Low`), inserción de prompt o extracción en `chrome-extension/background.js`, `chrome-extension/gemini-content.js`, `chrome-extension/chatgpt-content.js` o `server.ts`, diagnosticar y aplicar la corrección quirúrgica (`node --check`), recargar la extensión y/o reiniciar el `LaunchAgent`.
          4. **Reintentar y continuar sin interrupción**: Relanzar la consulta fallida a `Gemini Web` y/o `ChatGPT Web` hasta obtener `{ ok: true, response: "..." }` completo, e **inmediatamente continuar la investigación y el debate (`Ronda 1` + `Ronda 2`) con las respuestas reales de GPT y Gemini Web**.
          5. **Única excepción (acción humana física)**: Solo si el fallo es por sesión cerrada de Google/OpenAI en Chrome o por un reto anti-bot/CAPTCHA (que jamás debe intentarse saltar), detener el proceso, avisar al usuario la causa exacta y entregarle el prompt completo en un bloque copiable (` ```text ... ``` `).
     2. **Invocación de Subagentes (Sin Límites Artificiales de Palabras)**:
        - En **`MODO DUO` Rápido**: llama inmediatamente a `define_subagent` e `invoke_subagent` para lanzar los 2 agentes internos (`Carbon` + `Argon High`) con el problema completo.
        - En **`MODO TRIO` y `MODO CUATRO`**: llama a `define_subagent` e `invoke_subagent` para lanzar los 3 agentes internos (`Carbon` + `Argon High` + `Flash 3.8`) pasándoles **el problema original + la respuesta de Gemini Web (Carbon Low) + la respuesta completa de ChatGPT Web** como perspectivas externas adicionales para que las evalúen, las critiquen y las integren en su debate.
        - **PROHIBIDO** ponerles límites de palabras o extensión (como *"máximo 250 palabras"* o *"en 1 párrafo"*) o prohibirles inspeccionar los archivos del proyecto: los agentes deben analizar y debatir con total profundidad técnica sin recortes artificiales.
     3. **PROHIBIDO Detener o Matar a Ningún Modelo Antes de que Termine (`Dejar Terminar Siempre a Todos`)**:
        - **ESTÁ TERMINANTEMENTE PROHIBIDO** usar `manage_subagents` con `Action: 'kill'` o `'kill_all'` para detener a Carbon (`Model: 'inherit'`), Argon High (`Model: 'pro'`) o Flash 3.8 (`Model: 'flash'`), ni cancelar las consultas de Gemini Web o ChatGPT Web antes de que **TODOS** los modelos participantes de ese modo hayan terminado de responder por completo.
        - Si uno o más agentes siguen pensando o analizando, el coordinador **DEBE ESPERAR** (terminando su turno sin llamar más herramientas para despertar reactivamente cuando llegue la respuesta de cada subagente) hasta tener las respuestas completas de **todos los participantes**.
     4. **RONDA 2 OBLIGATORIA DE DEBATE CRUZADO (`send_message` a CADA Subagente)**:
        - **ESTÁ TERMINANTEMENTE PROHIBIDO** pasar de las respuestas iniciales (Ronda 1) directamente a editar archivos (`edit_file`) diciendo *"Hay consenso; ahora implemento"*.
        - Una vez que **todos** los subagentes hayan entregado su respuesta inicial (Ronda 1), el coordinador **DEBE llamar obligatoriamente a `send_message` hacia CADA uno de los subagentes** (en `MODO DUO` a los 2: Carbon y Argon High; en `MODO TRIO` y `MODO CUATRO` a los 3: Carbon, Argon High y Flash 3.8) pasándoles las respuestas completas propuestas por **los otros subagentes** en la Ronda 1 (y en `TRIO`/`CUATRO`, también las respuestas de **Gemini Web y ChatGPT Web**).
        - En ese `send_message` (Ronda 2), cada subagente debe **revisar críticamente las respuestas de los demás modelos**, señalar qué puntos adopta, qué errores o huecos rebate/corrige de las otras propuestas, y acordar la solución final consensuada.
        - El coordinador **DEBE ESPERAR** a que **TODOS los subagentes respondan a la Ronda 2 de debate (`send_message`)** antes de tocar una sola línea de código (`edit_file`), hacer `git commit` o publicar el veredicto final.

1. **Activación Automática de Subagentes con Modelos Distintos y Verificados (`define_subagent`, `invoke_subagent`, `send_message` — PROHIBIDO usar nombres falsos)**:
   - **Mapeo real de backend en Antigravity (`invoke_subagent`)**:
     - `Model: 'pro'` → ejecuta siempre el motor real **`Gemini 4 Argon (High)`**.
     - `Model: 'flash'` → ejecuta siempre el motor real **`Gemini 3.8 Flash`**.
     - `Model: 'inherit'` → **NO es un alias fijo**, sino que clona exactamente el modelo activo en el selector superior del chat (`<USER_SETTINGS_CHANGE>`).
   - **REGLA ANTI-DUPLICACIÓN / CERO ETIQUETAS FALSAS**:
     - Antes de lanzar `MODO DUO`, `MODO TRIO` o `MODO CUATRO`, el coordinador **DEBE verificar en su contexto (`<USER_SETTINGS_CHANGE>`) cuál es el modelo activo del chat principal**:
       - Cuando el selector del chat está en **`Gemini 4 Carbon (High)`** o **`Gemini 4 Carbon (Low)`**: `Model: 'inherit'` corre realmente en ese nivel exacto de **Carbon** (reportándolo con su nombre real verificado) y `Model: 'pro'` corre realmente en **`Gemini 4 Argon (High)`** (+ `Model: 'flash'` = **`Gemini 3.8 Flash`** en `MODO TRIO` y `MODO CUATRO`).
       - Si el selector del chat **NO** está en `Carbon` (por ejemplo, está en `Argon` o `Flash`), **ESTÁ TERMINANTEMENTE PROHIBIDO** llamar `"Carbon"` a un subagente con `Model: 'inherit'` (porque duplicaría `Argon` o `Flash` bajo un nombre falso). En ese caso, avisa en 1 línea visible que el selector no está en `Carbon` y nunca dupliques el mismo modelo con nombres distintos.
     - En `MODO TRIO` y `MODO CUATRO`, el coordinador debe mostrar en el resumen los `verifiedModel` devueltos por Gemini Web (`4 Carbon · Low`) y por ChatGPT Web.
   - **En `MODO DUO` Rápido (`Carbon + Argon High`, sin Webs Externas)**:
     - **Agente 1 (`Model: 'inherit'`) — Arquitecto Principal (`Gemini 4 Carbon`**, verificado en el selector activo del chat**)**: Diseña la solución de fondo, arquitectura y lógica principal.
     - **Agente 2 (`Model: 'pro'`) — Contraparte & Auditor Estratégico (`Gemini 4 Argon High`)**: Audita la arquitectura con razonamiento profundo, desafía supuestos y valida la integridad de los cambios.
   - **En `MODO TRIO` (`Carbon + Argon High + Flash 3.8 + Gemini Web + ChatGPT Web`)**:
     - **Agente 1 (`Model: 'inherit'`) — Arquitecto Principal (`Gemini 4 Carbon`**, verificado en el selector activo del chat**)**.
     - **Agente 2 (`Model: 'pro'`) — Contraparte & Auditor Estratégico (`Gemini 4 Argon High`)**.
     - **Agente 3 (`Model: 'flash'`) — Auditor Crítico & Explorador Rápido (`Gemini 3.8 Flash`)**: Inspecciona el código a máxima velocidad, busca fallos, casos borde y cuellos de botella.
     - *(Más **AMBAS perspectivas externas web obligatorias en paralelo**: **Gemini Web (`4 Carbon · Thinking: Low`)** + **ChatGPT Web (`https://chatgpt.com/`)**).*
   - **En `MODO CUATRO` (`Carbon + Argon High + Flash 3.8 + Gemini Web + ChatGPT Web + Auditoría Exhaustiva`)**:
     - Los mismos 3 subagentes verificados + **Gemini Web (`4 Carbon · Thinking: Low`)** + **ChatGPT Web (`https://chatgpt.com/`)**, exigiendo además auditoría exhaustiva línea por línea de todos los archivos implicados, concurrencia y casos borde antes de editar.

2. **Debate de Ida y Vuelta + Verificación Rigurosa (Estilo `/boost` + `/teamwork`)**:
   - El agente coordinador hace que los agentes intercambien sus argumentos (`send_message`) en al menos **2 rondas completas** (Ronda 1: propuesta inicial de cada modelo; Ronda 2: revisión cruzada de las respuestas de los otros agentes + Gemini Web + ChatGPT Web, refutación de puntos débiles y acuerdo final).
   - Siempre muestra al usuario en el chat un resumen claro de: (a) qué propuso cada modelo en la Ronda 1 (incluyendo Gemini Web y ChatGPT Web en los tres modos), (b) **qué se rebatieron o adoptaron entre sí en la Ronda 2 de debate**, y (c) el **veredicto consensuado** antes o al momento de ejecutar la solución.

3. **Relevo Automático por Cuota Agotada (En `MODO DUO`/`TRIO`/`CUATRO` y también en Modo Normal)**:
   - **En `MODO DUO` / `MODO TRIO` / `MODO CUATRO`**: Si en cualquier momento el agente en `Model: 'inherit'` (Claude Opus) agota su cuota, sufre límite de capacidad (`quota` / `rate limit`) o falla al responder, el coordinador **no detiene la tarea**: transfiere inmediatamente todo el contexto acumulado del debate a la dupla **Gemini Argon (`Model: 'pro'`) + Gemini Flash (`Model: 'flash'`)** para que continúen el debate y terminen la implementación sin interrupciones.
   - **En Modo Normal (fuera de `MODO DUO`/`TRIO`)**: Si se agota la cuota de Claude Opus durante una tarea o en cualquier subagente, se cambia automáticamente a **Gemini Argon (`Model: 'pro'`)** para terminar la tarea sin interrupción. Además, en cuanto la conversación continúe en **Gemini Argon** tras agotarse Claude, el agente retoma automáticamente el trabajo exacto donde quedó sin pedir que le repitan la instrucción.

---

# Regla de Estilo Visual en Tiempo Real: Narración Paso a Paso (Estilo Claude)

1. **Describir brevemente cada paso mientras trabajas (Prohibido ejecutar herramientas en silencio)**:
   - Cuando estés en **Gemini Argon** (o cualquier otro modelo), **NUNCA** encadenes llamadas a herramientas (`read_file`, `edit_file`, `run_command`, `invoke_subagent`, etc.) en silencio sin texto visible.
   - En **cada paso** en que llames a una herramienta, escribe siempre una frase corta y directa (1 línea) visible en el chat antes de la herramienta explicando qué estás haciendo en ese instante (exactamente como hace Claude Opus).
   - *Ejemplos*:
     - *"Voy a leer las líneas 9800–9900 de `src/App.tsx` para revisar el panel de la carpeta..."*
     - *"Ahora aplico el cambio quirúrgico en `server.ts` para agregar el endpoint..."*
     - *"Compilando el proyecto con `npm run build` y subiendo los cambios a GitHub..."*
