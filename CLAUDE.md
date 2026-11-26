# Reglas de Proyecto para Claude Code — `Huellas Master`

> Este archivo sincroniza las reglas operativas de `Huellas Master` (`GEMINI.md` y `.agents/plugins/raydel-global-rules/rules/AGENTS.md`) para que **Claude Code** trabaje de forma segura en paralelo con Antigravity sin pisar cambios ni romper invariantes.

## 1. Trabajo Concurrente en Múltiples Conversaciones
El usuario trabaja simultáneamente con varios agentes/conversaciones en paralelo sobre este mismo repositorio:
1. **Leer antes de editar**: Lee siempre las líneas exactas del archivo justo antes de modificarlo (especialmente `src/App.tsx`, `src/components/CapCutEditor.tsx`, `src/components/CapCutTimelineEditor.tsx`, `server.ts`, `src/utils/cloudSync.ts` o `data/documentaries.json`).
2. **Ediciones quirúrgicas**: Modifica únicamente el bloque exacto de líneas de tu tarea.
   - **PROHIBIDO** sobrescribir archivos completos de código existente.
   - **PROHIBIDO** ejecutar `git checkout -- <file>`, `git restore`, `git reset --hard`, `git stash` o comandos que descarten cambios hechos en paralelo.
3. **Git seguro**:
   - Revisa `git status` y `git diff` antes de hacer `git commit`.
   - Si `git push` es rechazado por cambios remotos nuevos, usa `git pull --rebase origin main` conservando ambos cambios y luego `git push origin main`.

## 2. Regla Global de Verificación de Despliegue (Render / Web Apps)
1. **Indicador `Actualizado: [hora] - [MM/DD/YYYY]`**:
   - Cada cambio en la UI debe actualizar `LAST_UPDATED_TEXT` en `src/App.tsx` con la hora y fecha actual de Nueva York (`TZ="America/New_York" date +"%I:%M %p - %m/%d/%Y"`).
   - `vite.config.ts` inyecta `__BUILD_TIMESTAMP__` automáticamente al compilar.
2. **Pantalla `Acceso Privado`**:
   - Todo formulario de contraseña debe mantener `<form onSubmit={...}>`, `<button type="submit">` y soporte para la tecla `Enter`.

## 3. Blindaje Anti-Regresiones (Matriz de Impacto Cruzado)
| Si modificas… | Revisa también… | Motivo crítico |
| :--- | :--- | :--- |
| `src/types.ts` o `promptConfig` / `productionType` | `src/utils/cloudSync.ts`, `src/utils/smartParsers.ts`, `src/App.tsx`, `server.ts`, `data/documentaries.json` | Ningún enum legado puede romper el selector, Etapa 1/6 ni causar tormentas CAS en `updatedAt`. |
| URLs de media / `serve-folder-file` / Intro / `@References` | `src/App.tsx`, `src/components/CapCutEditor.tsx`, `src/utils/cloudSync.ts`, `server.ts` | La app corre en Mac `:4200`, Render/iPhone (túnel Cloudflare HTTPS) y GitHub Pages (`docs/`). Nunca dejar `localhost:4200` o `trycloudflare.com` crudos. |
| Transiciones o Split Clip 1 | `src/components/CapCutEditor.tsx`, `server.ts` | La clave canónica es `'dip_black'` (jamás `'fade_black'`). |
| `data/documentaries.json` o `docs/data/documentaries.json` | `scripts/sync-public-docs-json.mjs` (`npm run sync:public-docs`), `server.ts` (`writeDocumentaries`) | Nunca usar `cp` directo sobre `data/documentaries.json` hacia `docs/data/`. |

## 4. Compuerta Obligatoria Antes de Terminar
Antes de dar por terminado cualquier cambio de código o subir a GitHub/Render, ejecuta siempre:
1. `npm run verify` (debe pasar los **6/6 gates**: TypeScript, AST JSX/extensión, paridad rutas API, anti-fugas, invariantes JSON J1–J5, UI Global).
2. `npm run build`
3. `git add ... && git commit -m "..." && git pull --rebase origin main && git push origin main`

## 5. Política de Effort (todas las sesiones, incluidas las de la nube)
- **Clasificar al empezar cada tarea**: antes de trabajar, indica en una línea el effort que pide la tarea (`low` / `medium` / `high` / `extra` / `max`) y si conviene **Ultracode**:
  - `low`: cambios mecánicos o claros.
  - `medium`: cambios en varios archivos o comportamiento de UI poco claro.
  - `high`: bugs sin causa conocida o que requieren análisis real.
  - `extra` (`xhigh` en `$CLAUDE_EFFORT`): cambios grandes en piezas delicadas o en varios sistemas a la vez (p. ej. el exportador `render-ffmpeg`), o investigaciones profundas.
  - `max`: solo lo crítico y muy complejo; gasta unas 3,5× o más.
  - **Ultracode** (interruptor del menú Effort: xhigh + subagentes en paralelo): solo para tareas muy grandes que se pueden repartir en partes independientes; gasta los límites más rápido, así que se recomienda activarlo solo para esa tarea.
- **Si coincide con el effort de la sesión, continúa.** Si la tarea pide más, **detente antes de hacer el trabajo** y avisa al usuario para que lo suba en el selector (una sesión no puede cambiar su propio effort).
- **Si la tarea pide menos que el effort de la sesión**, también **detente antes de hacer el trabajo** y pide al usuario que lo baje en el selector ("esta tarea es `low` y la sesión está en `medium`; bájalo y te sigo"); espera su respuesta antes de empezar. Si el usuario dice que siga así, continúa con el effort actual.
- **Al lanzar otra sesión para una tarea**, pásale el `effort` explícito según esa clasificación.
- Niveles: `low`, `medium`, `high`, `extra` y `max`, más el interruptor Ultracode; el valor por defecto es `low`. **Nunca cambies el modelo.**

## 6. Turno de Publicación entre Sesiones (una sola sesión cambia la página a la vez)
Varias sesiones trabajan sobre esta misma carpeta, y un `npm run build` o un `git push` publica todo lo que haya en disco, también lo que otra sesión dejó a medias. Por eso:
1. **Antes de editar código de la página** (`src/`, `server.ts`, `extension/`, `scripts/`, `vite.config.ts`) **y antes de `npm run build`, `git commit`, `git push` o reiniciar el servidor**, comprueba si otra sesión tiene el turno:
   - Archivo de turno: `"$(git rev-parse --git-common-dir)/claude-publish.lock"` (dentro de `.git`, nunca se sube).
   - `git status --short`: si hay archivos de código modificados que tú no tocaste, otra sesión está a mitad de un cambio aunque no exista el archivo de turno.
2. **Si otra sesión tiene el turno, espera**: no edites código, no compiles, no hagas commit ni push. Vuelve a comprobar cada minuto aproximadamente hasta que el archivo desaparezca y no queden cambios ajenos de código sin subir. Mientras tanto puedes leer, investigar y preparar el cambio. Avisa al usuario en una línea de que estás esperando y a qué sesión.
3. **Al tomar el turno**, crea el archivo con una línea: título o id de tu sesión, hora de Nueva York y qué vas a cambiar. **Bórralo en cuanto termines** (después del push y del reinicio del servidor) o si abandonas el cambio.
4. **Turno viejo**: si el archivo tiene más de 30 minutos y no cambia, no lo borres por tu cuenta; pregunta al usuario si esa sesión sigue trabajando.
5. Los archivos de datos que la propia app reescribe (`data/*.json`, `docs/data/*.json`, `docs/index.html`, `docs/tts-files/`) no cuentan como trabajo de otra sesión.
