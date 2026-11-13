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

# Reglas Específicas de `Huellas Master` para el Sistema Global de 8 Niveles (`MODO 1 / SOLO` a `MODO 8 / MÁXIMO`)

Este proyecto aplica íntegramente el **Sistema Global de Auto-Triaje de 8 Niveles (`user_global`)** con estas reglas concretas del repositorio `Huellas Master`:

1. **Archivos Críticos Compartidos de `Huellas Master` (`+2 pts` Automáticos y Obligatorios en Riesgo de Regresión)**:
   - Si la tarea lee para modificar o toca **cualquiera** de estos archivos o flujos, **es obligatorio sumar `+2 pts` sin redondear jamás a la baja**:
     - `src/components/CapCutTimelineEditor.tsx` y `src/components/CapCutEditor.tsx` (Timeline / WebAudio / render del editor).
     - `src/utils/cloudSync.ts` y `src/utils/smartParsers.ts` (sincronización documental, auditoría de clips y parseo de etapas).
     - `chrome-extension/background.js`, `chrome-extension/flow-content.js`, `chrome-extension/gemini-content.js` y `chrome-extension/chatgpt-content.js`.
     - Pipeline de exportación/escalado 4K (`FFmpeg` / endpoints de render en `server.ts`).

2. **Coordinación Segura en `swarm` sobre `Huellas Master` (Cero Colisiones de Escritura)**:
   - Todos los workers lanzados con `swarm({ action: "add", workspace: "inherit", ... })` (`carbon-high`, `argon-high`, `flash-high`, `hydrogen-high` / `hydrogen-xhigh`) tienen **permiso completo de lectura e inspección profunda del código sin límite de palabras**, pero operan en **modo solo análisis/debate (`PROHIBIDO` que un worker edite archivos o corra comandos destructivos en paralelo)**.
   - **Únicamente el agente coordinador** aplica las ediciones quirúrgicas (`read_file` → `edit_file`) una vez completada la **Ronda 2 cruzada** y alcanzado el consenso.

3. **Arquitectura de Puentes Web Locales de `Huellas Master` (`Niveles 6 a 8` — `localhost:4200`)**:
   - **Fase 0 Web-First Obligatoria**: En los Modos `6`, `7` y `8 (MÁXIMO)`, las consultas Web externas (`ChatGPT Web` en Nivel 6+, `Gemini Web` en Niveles 7–8) se ejecutan **PRIMERO** y se espera a recibir sus respuestas completas **ANTES** de iniciar la Ronda 1 de los motores internos de Antigravity.
   - **Idioma 100% Inglés**: Todo `prompt` enviado a `/api/chatgpt-web/ask-external` (Nivel 6+) y `/api/gemini-web/ask-external` (Niveles 7–8) debe redactarse **100% en inglés técnico claro**, aunque el chat con el usuario sea en español.
   - **Misma Ventana Ancla y Pestañas Residentes (`presence.anchorWindowId` / `hasAppWindow=1`)**:
     - Todas las consultas web operan con `active: false` (100% silenciosas, sin robar foco) **dentro de la misma ventana y perfil de Chrome donde está abierta `Huellas Master`**, donde `ensureResidentGeminiAndChatGptTabs` mantiene siempre vivas (`autoDiscardable: false`) al menos **1 pestaña de `gemini.google.com/app` y 1 de `chatgpt.com`** (reutilizando pestaña libre en un Nuevo chat o creando pestaña temporal `active: false` si está ocupada, y en Gemini seleccionando `4 Carbon · Low` fuera de Notebooks).
     - **PROHIBIDO** usar `chrome-devtools` MCP (`new_page` / `navigate_page`) para estas consultas (abre un navegador aislado sin sesión) y **PROHIBIDO** ejecutar `osascript ... window 1` a ciegas.
   - **Servicio Local Residente**: Si `localhost:4200` no responde, el coordinador revisa `/tmp/huellas-master-4200.log` y `/tmp/huellas-master-4200.err.log` y levanta el servicio residente / `Iniciar_Huellas_Master.command` con acceso TCC válido antes de reintentar la consulta web.
