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

Cuando el usuario escriba **`MODO DUO`** (o **`MODO TRIO`**) seguido de un problema o instrucción (con o sin `/boost` o `/teamwork` delante):

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
   - El agente coordinador hace que los agentes intercambien sus argumentos (`send_message`), rebatan puntos débiles y lleguen a un consenso verificado.
   - Siempre muestra al usuario en el chat un resumen claro del **diálogo/debate entre los modelos** y el **veredicto consensuado** antes o al momento de ejecutar la solución.

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
