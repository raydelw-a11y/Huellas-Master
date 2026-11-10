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

# Protocolo `MODO DUO` / `MODO TRIO` / `MODO CUATRO` (Debate Multi-Modelo + Boost + Teamwork)

Cuando el mensaje del usuario contenga **`MODO DUO`** / **`modo duo`**, **`MODO TRIO`** / **`modo trio`** o **`MODO CUATRO`** / **`modo cuatro`** / **`MODO 4`** / **`modo 4`**, con o sin `/boost` o `/teamwork` delante:

0. **REGLA INQUEBRANTABLE DE PRIMER PASO (`PASO 0 OBLIGATORIO — PERSPECTIVAS EXTERNAS WEB + SUBAGENTES`)**:
   - **ESTÁ TERMINANTEMENTE PROHIBIDO** que el agente principal empiece a editar código o resolver el problema en solitario sin ejecutar este flujo completo.
   - En cuanto el usuario escriba `modo duo`, `modo trio` o `modo cuatro` / `modo 4`, debes ejecutar obligatoriamente esta secuencia inicial:
     1. Mostrar en el chat el encabezado visible **`🤝 [MODO DUO ACTIVADO: Consultando Perspectiva Externa en Gemini Web (Carbon High) + Invocando Agentes]`**, **`🤝 [MODO TRIO ACTIVADO: ...]`** o **`🤝 [MODO CUATRO ACTIVADO: Consultando Perspectivas Externas en Gemini Web (Carbon High) + ChatGPT Web + Invocando Agentes]`** **junto con la escena animada de los robots debatiendo en vivo dentro del chat**:
        - Copia el contenido de `public/debate_robots_template.html` (ajustando `currentMode` a `'duo'`, `'trio'` o `'cuatro'` y personalizando opcionalmente los textos de `allDialogueTurns`) al archivo de artefacto `<appDataDir>/brain/<conversation-id>/debate_robots.html` usando `write_file` con `ArtifactMetadata: { Summary: "Sala de Debate Robótico en Vivo", UserFacing: true, RequestFeedback: false }` e incrusta en tu respuesta del chat la etiqueta:
          `<agent-embed src="file:///<appDataDir>/brain/<conversation-id>/debate_robots.html"></agent-embed>`
     2. **Perspectiva Externa en Gemini Web (+ ChatGPT Web en paralelo cuando es `MODO CUATRO`) en Ventanas Nuevas del MISMO Navegador de `Huellas Master` -> Cerrar Ventanas al Terminar**:
        - **Regla de Mismo Navegador y Perfil de la App (`PROHIBIDO abrir otro navegador o perfil distinto`)**: Tanto Gemini Web como ChatGPT Web **DEBEN** abrir sus **ventanas nuevas temporales exclusivamente dentro del mismo navegador y mismo perfil de Chrome donde está abierta la ventana de nuestra app (`Huellas Master`)**, usando siempre los puentes locales `POST /api/gemini-web/ask-external` y `POST /api/chatgpt-web/ask-external` (filtrados por `hasAppWindow=1`). **ESTÁ PROHIBIDO** usar `chrome-devtools` MCP (`new_page` / `navigate_page`) para estas consultas (porque levanta un navegador aislado aparte sin sesión) y **ESTÁ PROHIBIDO** ejecutar `osascript ... window 1` a ciegas (porque puede caer en otro perfil de Chrome abierto).
        - **Gemini Web (`MODO DUO`, `MODO TRIO` y `MODO CUATRO` — `POST http://localhost:4200/api/gemini-web/ask-external`)**: Para que funcione al 100% incluso cuando el usuario trabaja desde el móvil sin tocar la ventana principal de Gemini donde está el documental, envía el problema mediante `run_command`:
          `curl -s --max-time 300 -X POST http://localhost:4200/api/gemini-web/ask-external -H "Content-Type: application/json" -d '{"prompt": "..."}'`
          (Si la extensión estuviera dormida, el propio servidor despierta únicamente la ventana donde está `Huellas Master`, o puedes forzar `curl -s -X POST http://localhost:4200/api/extension/reload`).
          Este puente abre automáticamente una **ventana nueva temporal de Gemini en el mismo navegador/perfil de `Huellas Master`** en un **chat nuevo limpio por fuera de todos los Notebooks** (`https://gemini.google.com/app`), selecciona el modelo **4 Carbon** con **Thinking Level en High** (`Carbon High`), envía el problema, captura la respuesta completa (`{ ok: true, response: "...", chatUrl: "..." }`) y **cierra automáticamente esa ventana de Gemini en cuanto obtiene la respuesta**.
        - **ChatGPT Web ADICIONAL EN PARALELO cuando es `MODO CUATRO` (`POST http://localhost:4200/api/chatgpt-web/ask-external`)**: En `MODO CUATRO`, además de todo lo que hace `MODO TRIO`, al principio junto con Gemini Web se envía **en paralelo** el mismo problema también a **ChatGPT Web**:
          `curl -s --max-time 300 -X POST http://localhost:4200/api/chatgpt-web/ask-external -H "Content-Type: application/json" -d '{"prompt": "..."}'`
          Este puente abre automáticamente una **pestaña temporal en `https://chatgpt.com/` dentro de la misma ventana donde está abierta `Huellas Master`**, envía el problema, espera a que termine de generarse la respuesta completa (`{ ok: true, response: "...", chatUrl: "...", verifiedModel: "..." }`) y **cierra automáticamente esa pestaña temporal de ChatGPT al terminar**.
        - **PARADA OBLIGATORIA SI FALLA GEMINI WEB (O CHATGPT WEB EN `MODO CUATRO`) (`PROHIBIDO continuar sin la respuesta web` + Entregar Prompt Manual al Usuario)**: Si la respuesta de Gemini Web (o la de ChatGPT Web cuando se está en `MODO CUATRO`) falla (`ok: false`), llega vacía, requiere inicio de sesión o agota el tiempo, **ESTÁ TERMINANTEMENTE PROHIBIDO** continuar el debate sin esa perspectiva web o editar archivos de código. El coordinador **DEBE DETENER EL PROCESO DE INMEDIATO**, **avisar claramente al usuario en el chat** indicando cuál puente falló y por qué, y **mostrarle en un bloque de código copiable (` ```text ... ``` `) el prompt exacto completo** para que el usuario pueda enviárselo manualmente a Gemini / ChatGPT y pegar la respuesta de vuelta en el chat para reanudar el debate.
     3. **Invocación de Subagentes con las Perspectivas Extra Incluidas (Sin Límites Artificiales de Palabras)**:
        - Llama inmediatamente a `define_subagent` e `invoke_subagent` para lanzar los 2 agentes (`MODO DUO`) o los 3 agentes (`MODO TRIO` y `MODO CUATRO`) pasándoles **el problema original + la respuesta obtenida de Gemini Web (Carbon High)** (**+ la respuesta completa de ChatGPT Web cuando es `MODO CUATRO`**) como perspectivas externas adicionales para que las evalúen, las critiquen y las integren en su debate.
        - **PROHIBIDO** ponerles límites de palabras o extensión (como *"máximo 250 palabras"* o *"en 1 párrafo"*) o prohibirles inspeccionar los archivos del proyecto: los agentes deben analizar y debatir con total profundidad técnica sin recortes artificiales.
     4. **PROHIBIDO Detener o Matar a Ningún Modelo Antes de que Termine (`Dejar Terminar Siempre a Todos`)**:
        - **ESTÁ TERMINANTEMENTE PROHIBIDO** usar `manage_subagents` con `Action: 'kill'` o `'kill_all'` para detener a Carbon High (`Model: 'inherit'`), Argon High (`Model: 'pro'`) o Flash 3.8 (`Model: 'flash'`), ni cancelar las consultas de Gemini Web o ChatGPT Web antes de que **TODOS** hayan terminado de responder por completo, incluso si el coordinador cree haber encontrado la causa por su cuenta.
        - Si uno o más agentes (por ejemplo, Carbon High, Argon High, Gemini Web Carbon High o ChatGPT Web) siguen pensando o analizando, el coordinador **DEBE ESPERAR** (terminando su turno sin llamar más herramientas para despertar reactivamente cuando llegue la respuesta de cada subagente) hasta tener las respuestas completas de **todos los participantes**.
     5. **RONDA 2 OBLIGATORIA DE DEBATE CRUZADO (`send_message` a CADA Subagente con las Respuestas de los Otros + Web)**:
        - **ESTÁ TERMINANTEMENTE PROHIBIDO** pasar de las respuestas iniciales (Ronda 1) directamente a editar archivos (`edit_file`) diciendo *"Hay consenso; ahora implemento"*.
        - Una vez que **todos** los subagentes hayan entregado su respuesta inicial (Ronda 1) y se tengan las respuestas de **Gemini Web (Carbon High)** (**y de ChatGPT Web en `MODO CUATRO`**), el coordinador **DEBE llamar obligatoriamente a `send_message` hacia CADA uno de los subagentes** (en `MODO DUO` a los 2: Carbon High y Argon High; en `MODO TRIO` y `MODO CUATRO` a los 3: Carbon High, Argon High y Flash 3.8) pasándoles:
          1. Las respuestas completas propuestas por **los otros subagentes** en la Ronda 1.
          2. La respuesta completa obtenida de **Gemini Web (Carbon High)** (**y la de ChatGPT Web si es `MODO CUATRO`**).
        - En ese `send_message` (Ronda 2), cada subagente debe **revisar críticamente las respuestas de los demás modelos y las perspectivas web**, señalar qué puntos adopta, qué errores o huecos rebate/corrige de las otras propuestas, y acordar la solución final consensuada.
        - El coordinador **DEBE ESPERAR** a que **TODOS los subagentes respondan a la Ronda 2 de debate (`send_message`)** antes de tocar una sola línea de código (`edit_file`), hacer `git commit` o publicar el veredicto final.

1. **Activación Automática de Subagentes con Modelos Distintos y Verificados (`define_subagent`, `invoke_subagent`, `send_message` — PROHIBIDO usar nombres falsos)**:
   - **Mapeo real de backend en Antigravity (`invoke_subagent`)**:
     - `Model: 'pro'` → ejecuta siempre el motor real **`Gemini 4 Argon (High)`**.
     - `Model: 'flash'` → ejecuta siempre el motor real **`Gemini 3.8 Flash`**.
     - `Model: 'inherit'` → **NO es un alias fijo a Carbon**, sino que clona exactamente el modelo activo en el selector superior del chat (`<USER_SETTINGS_CHANGE>`).
   - **REGLA ANTI-DUPLICACIÓN / CERO ETIQUETAS FALSAS**:
     - Antes de lanzar `MODO DUO`, `MODO TRIO` o `MODO CUATRO`, el coordinador **DEBE verificar en su contexto (`<USER_SETTINGS_CHANGE>`) cuál es el modelo activo del chat principal**:
       - Cuando el selector del chat está en **`Gemini 4 Carbon (High)`**: `Model: 'inherit'` corre realmente en **`Gemini 4 Carbon (High)`** y `Model: 'pro'` corre realmente en **`Gemini 4 Argon (High)`** (+ `Model: 'flash'` = **`Gemini 3.8 Flash`** en `MODO TRIO` y `MODO CUATRO`).
       - Si el selector del chat **NO** está en `Gemini 4 Carbon (High)` (por ejemplo, está en `Argon` o `Flash`), **ESTÁ TERMINANTEMENTE PROHIBIDO** llamar `"Carbon High"` a un subagente con `Model: 'inherit'` (porque correría otro `Argon` o `Flash` duplicado bajo un nombre falso). En ese caso, el coordinador debe avisar al usuario en 1 línea visible que el selector del chat no está en `Carbon High` (para que pueda cambiarlo si desea subagente Carbon nativo) y nunca duplicar el mismo modelo con nombres distintos (`Model: 'pro'` = Argon High + `Model: 'flash'` = Flash 3.8 + Gemini Web verificado en `4 Carbon · High` [+ ChatGPT Web en `MODO CUATRO`]).
     - En Gemini Web (`POST /api/gemini-web/ask-external`), el puente verifica en el DOM real del selector de modelos (`verifiedModel`) que esté activo **`4 Carbon · High`** antes de enviar (bloqueando envíos accidentales en `Low` o `Flash`), y el coordinador debe mostrar en el resumen el `verifiedModel` devuelto por el endpoint (y en `MODO CUATRO`, también el `verifiedModel` devuelto por ChatGPT Web).
   - **En `MODO DUO` (`Carbon High + Argon High`)**:
     - **Agente 1 (`Model: 'inherit'`) — Arquitecto Principal (`Gemini 4 Carbon High`**, verificado en el selector activo del chat**)**: Diseña la solución de fondo, arquitectura y lógica principal.
     - **Agente 2 (`Model: 'pro'`) — Contraparte & Auditor Estratégico (`Gemini 4 Argon High`)**: Audita la arquitectura con razonamiento profundo, desafía supuestos y valida la integridad de los cambios.
     - *(Más la perspectiva externa obligatoria de **Gemini Web verificada por DOM en `4 Carbon · Thinking: High`**).*
   - **En `MODO TRIO` (`Carbon High + Argon High + Flash 3.8`)**:
     - **Agente 1 (`Model: 'inherit'`) — Arquitecto Principal (`Gemini 4 Carbon High`**, verificado en el selector activo del chat**)**.
     - **Agente 2 (`Model: 'pro'`) — Contraparte & Auditor Estratégico (`Gemini 4 Argon High`)**.
     - **Agente 3 (`Model: 'flash'`) — Auditor Crítico & Explorador Rápido (`Gemini 3.8 Flash`)**: Inspecciona el código a máxima velocidad, busca fallos, casos borde y cuellos de botella.
     - *(Más la perspectiva externa obligatoria de **Gemini Web verificada por DOM en `4 Carbon · Thinking: High`**).*
   - **En `MODO CUATRO` (`Todo MODO TRIO + Perspectiva Externa Doble: Gemini Web Carbon High + ChatGPT Web`)**:
     - **Agente 1 (`Model: 'inherit'`) — Arquitecto Principal (`Gemini 4 Carbon High`**, verificado en el selector activo del chat**)**.
     - **Agente 2 (`Model: 'pro'`) — Contraparte & Auditor Estratégico (`Gemini 4 Argon High`)**.
     - **Agente 3 (`Model: 'flash'`) — Auditor Crítico & Explorador Rápido (`Gemini 3.8 Flash`)**.
     - *(Más **AMBAS perspectivas externas web obligatorias en paralelo**: **Gemini Web (`4 Carbon · Thinking: High`)** + **ChatGPT Web (`https://chatgpt.com/`)**, cuyas ventanas temporales se cierran automáticamente al obtener respuesta).*

2. **Debate de Ida y Vuelta + Verificación Rigurosa (Estilo `/boost` + `/teamwork`)**:
   - El agente coordinador hace que los agentes intercambien sus argumentos (`send_message`) en al menos **2 rondas completas** (Ronda 1: propuesta inicial de cada modelo; Ronda 2: revisión cruzada de las respuestas de los otros agentes + Gemini Web [+ ChatGPT Web en `MODO CUATRO`], refutación de puntos débiles y acuerdo final).
   - Siempre muestra al usuario en el chat un resumen claro de: (a) qué propuso cada modelo en la Ronda 1 (incluyendo Gemini Web y, en `MODO CUATRO`, ChatGPT Web), (b) **qué se rebatieron o adoptaron entre sí en la Ronda 2 de debate**, y (c) el **veredicto consensuado** antes o al momento de ejecutar la solución.

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
