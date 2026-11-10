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

# Protocolo `MODO DUO` / `MODO TRIO` (Debate Multi-Modelo + Boost + Teamwork)

Cuando el mensaje del usuario contenga **`MODO DUO`** / **`modo duo`** (o **`MODO TRIO`** / **`modo trio`**), con o sin `/boost` o `/teamwork` delante:

0. **REGLA INQUEBRANTABLE DE PRIMER PASO (`PASO 0 OBLIGATORIO — PERSPECTIVA EXTERNA EN GEMINI WEB + SUBAGENTES`)**:
   - **ESTÁ TERMINANTEMENTE PROHIBIDO** que el agente principal empiece a editar código o resolver el problema en solitario sin ejecutar este flujo completo.
   - En cuanto el usuario escriba `modo duo` o `modo trio`, debes ejecutar obligatoriamente esta secuencia inicial:
     1. Mostrar en el chat el encabezado visible **`🤝 [MODO DUO ACTIVADO: Consultando Perspectiva Externa en Gemini Web (Argon High) + Invocando Agentes]`** (o `MODO TRIO`) **junto con la escena animada de los robots debatiendo en vivo dentro del chat**:
        - Copia el contenido de `public/debate_robots_template.html` (personalizando opcionalmente los textos de `dialogueTurns` con los argumentos reales del debate) al archivo de artefacto `<appDataDir>/brain/<conversation-id>/debate_robots.html` usando `write_file` con `ArtifactMetadata: { Summary: "Sala de Debate Robótico en Vivo", UserFacing: true, RequestFeedback: false }` e incrusta en tu respuesta del chat la etiqueta:
          `<agent-embed src="file:///<appDataDir>/brain/<conversation-id>/debate_robots.html"></agent-embed>`
     2. **Perspectiva Externa en Gemini Web (Ventana Nueva Temporal -> Chat Limpio SIN Notebook, Argon en High -> Cerrar Ventana al Terminar)**:
        - **Método directo sin bloqueo de popup (`POST http://localhost:4200/api/gemini-web/ask-external`)**: Para que funcione al 100% incluso cuando el usuario trabaja desde el móvil sin tocar la ventana principal de Gemini donde está el documental, envía el problema mediante `run_command`:
          `curl -s --max-time 300 -X POST http://localhost:4200/api/gemini-web/ask-external -H "Content-Type: application/json" -d '{"prompt": "..."}'`
          (Si la extensión estuviera dormida, despiértala primero con `osascript -e 'tell application "Google Chrome" to make new tab at end of tabs of window 1 with properties {URL:"chrome-extension://kbfeckjlcogkccfplkmgenalgnmojclf/reloader.html"}'`).
        - Este puente abre automáticamente una **ventana nueva temporal de Gemini** en un **chat nuevo limpio por fuera de todos los Notebooks** (`https://gemini.google.com/app`), selecciona el modelo **Argon** con **Thinking Level en High**, envía el problema, captura la respuesta completa (`{ ok: true, response: "...", chatUrl: "..." }`) y **cierra automáticamente esa ventana de Gemini en cuanto obtiene la respuesta** (sin alterar la ventana principal de Gemini del usuario). Si se usa `chrome-devtools`, igualmente se debe abrir una ventana/pestaña nueva en `https://gemini.google.com/app` y cerrarla (`close_page`) inmediatamente después de obtener la respuesta.
        - **PARADA OBLIGATORIA SI FALLA LA RESPUESTA DE GEMINI WEB (`PROHIBIDO continuar sin Gemini Web` + Entregar Prompt Manual al Usuario)**: Si la respuesta de Gemini Web falla (`ok: false`), llega vacía o agota el tiempo (incluso tras despertar/recargar la extensión y reintentar una vez), **ESTÁ TERMINANTEMENTE PROHIBIDO** continuar el debate sin Gemini Web (prohibido decir *"Gemini Web no aportará esta vez"* y seguir adelante) o editar archivos de código. El coordinador **DEBE DETENER EL PROCESO DE INMEDIATO**, **avisar claramente al usuario en el chat** indicando qué falló en Gemini Web, y **mostrarle en un bloque de código copiable (` ```text ... ``` `) el prompt exacto completo** para que el usuario pueda enviárselo manualmente a Gemini y pegar la respuesta de vuelta en el chat para reanudar el debate.
     3. **Invocación de Subagentes con la Perspectiva Extra Incluida (Sin Límites Artificiales de Palabras)**:
        - Llama inmediatamente a `define_subagent` e `invoke_subagent` para lanzar los 2 (o 3) agentes pasándoles **el problema original + la respuesta obtenida de Gemini Web (Argon High)** como una perspectiva externa adicional para que la evalúen, la critiquen y la integren en su debate.
        - **PROHIBIDO** ponerles límites de palabras o extensión (como *"máximo 250 palabras"* o *"en 1 párrafo"*) o prohibirles inspeccionar los archivos del proyecto: los agentes deben analizar y debatir con total profundidad técnica sin recortes artificiales.
     4. **PROHIBIDO Detener o Matar a Ningún Modelo Antes de que Termine (`Dejar Terminar Siempre a Todos`)**:
        - **ESTÁ TERMINANTEMENTE PROHIBIDO** usar `manage_subagents` con `Action: 'kill'` o `'kill_all'` para detener a Argon (`Model: 'pro'`), Opus (`Model: 'inherit'`) o Flash (`Model: 'flash'`), ni cancelar la consulta de Gemini Web antes de que **TODOS** hayan terminado de responder por completo, incluso si el coordinador cree haber encontrado la causa por su cuenta.
        - Si uno o más agentes (por ejemplo, Argon `pro` o Gemini Web Argon High) siguen pensando o analizando, el coordinador **DEBE ESPERAR** (terminando su turno sin llamar más herramientas para despertar reactivamente cuando llegue la respuesta de cada subagente) hasta tener las respuestas completas de **todos los participantes**.
     5. **RONDA 2 OBLIGATORIA DE DEBATE CRUZADO (`send_message` a CADA Subagente con las Respuestas de los Otros + Gemini Web)**:
        - **ESTÁ TERMINANTEMENTE PROHIBIDO** pasar de las respuestas iniciales (Ronda 1) directamente a editar archivos (`edit_file`) diciendo *"Hay consenso; ahora implemento"*.
        - Una vez que **todos** los subagentes hayan entregado su respuesta inicial (Ronda 1) y se tenga la respuesta de **Gemini Web (Argon High)**, el coordinador **DEBE llamar obligatoriamente a `send_message` hacia CADA uno de los subagentes** (en `MODO DUO` a los 2; en `MODO TRIO` a los 3: Opus, Argon y Flash) pasándoles:
          1. Las respuestas completas propuestas por **los otros subagentes** en la Ronda 1.
          2. La respuesta completa obtenida de **Gemini Web (Argon High)**.
        - En ese `send_message` (Ronda 2), cada subagente debe **revisar críticamente las respuestas de los demás modelos y la de Gemini Web**, señalar qué puntos adopta, qué errores o huecos rebate/corrige de las otras propuestas, y acordar la solución final consensuada.
        - El coordinador **DEBE ESPERAR** a que **TODOS los subagentes respondan a la Ronda 2 de debate (`send_message`)** antes de tocar una sola línea de código (`edit_file`), hacer `git commit` o publicar el veredicto final.

1. **Activación Automática de Subagentes con Modelos Distintos (`define_subagent`, `invoke_subagent`, `send_message`)**:
   - **En `MODO DUO`**:
     - **Si el usuario pide `Argon + Flash` (o por defecto cuando está en Gemini)**:
       - **Agente 1 (`Model: 'pro'`) — Arquitecto Estratégico (Gemini Argon/Pro)**: Diseña la solución de fondo, arquitectura y lógica principal.
       - **Agente 2 (`Model: 'flash'`) — Auditor Crítico & Explorador Rápido (Gemini Flash)**: Inspecciona el código a máxima velocidad, busca fallos, casos borde, cuellos de botella y desafía la propuesta del Agente 1.
     - **Si el usuario tiene seleccionado Claude Opus en el chat (o pide `Opus + Argon`)**:
       - **Agente 1 (`Model: 'inherit'`) — Arquitecto Principal (Claude Opus)**.
       - **Agente 2 (`Model: 'pro'`) — Contraparte & Auditor Crítico (Gemini Argon/Pro)**.
   - **En `MODO TRIO`**:
     - Combina los 3 perfiles simultáneamente: **`inherit`** (Modelo activo en el selector, ej. Claude Opus) + **`pro`** (Gemini Argon/Pro) + **`flash`** (Gemini Flash).

2. **Debate de Ida y Vuelta + Verificación Rigurosa (Estilo `/boost` + `/teamwork`)**:
   - El agente coordinador hace que los agentes intercambien sus argumentos (`send_message`) en al menos **2 rondas completas** (Ronda 1: propuesta inicial de cada modelo; Ronda 2: revisión cruzada de las respuestas de los otros agentes + Gemini Web, refutación de puntos débiles y acuerdo final).
   - Siempre muestra al usuario en el chat un resumen claro de: (a) qué propuso cada modelo en la Ronda 1 (incluyendo Gemini Web), (b) **qué se rebatieron o adoptaron entre sí en la Ronda 2 de debate**, y (c) el **veredicto consensuado** antes o al momento de ejecutar la solución.

3. **Relevo Automático por Cuota Agotada (En `MODO DUO`/`TRIO` y también en Modo Normal)**:
   - **En `MODO DUO` / `MODO TRIO`**: Si en cualquier momento el agente en `Model: 'inherit'` (Claude Opus) agota su cuota, sufre límite de capacidad (`quota` / `rate limit`) o falla al responder, el coordinador **no detiene la tarea**: transfiere inmediatamente todo el contexto acumulado del debate a la dupla **Gemini Argon (`Model: 'pro'`) + Gemini Flash (`Model: 'flash'`)** para que continúen el debate y terminen la implementación sin interrupciones.
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
