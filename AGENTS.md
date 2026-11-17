# Directorio Oficial de Motores y Roles de `Huellas Master` (Escalera de 10 Niveles)

> Fuente canónica de protocolos y triaje: `.agents/plugins/raydel-global-rules/rules/AGENTS.md` (sincronizado con `~/.gemini/config/plugins/raydel-global-rules/rules/AGENTS.md`) y `./GEMINI.md`. Este archivo define los IDs verificados de Antigravity/`localhost:4200` y el rol técnico de cada motor.
> **Regla de Activación**: Por defecto (sin indicar modo), se usa directamente **solo el modelo seleccionado abajo** sin abrir modos ni `swarm`. La escalera de modos solo se activa cuando el usuario escribe **`modo auto`** (para que el coordinador evalúe qué nivel 1–10 usar) o un modo explícito (**`modo 1`** a **`modo 10`**).

## 1. Catálogo de 10 Motores Distintos (+ Upgrade `XHigh` en Nivel 10 / MÁXIMO y Fase 0 Web Automática en Niveles 6–10)

| Orden | Nombre de Roster / Puente | ID Canónico / Endpoint | Especialidad en el Debate |
| :--- | :--- | :--- | :--- |
| **#1** | `coordinador` | Modelo Seleccionado (por defecto `gemini-3.8-flash-high`) | Dirección general ágil, triaje inmediato, respuesta casi instantánea en Modo 1, síntesis de consenso R2, reparto de Fase 3 paralela (`1 archivo = 1 modelo` en 2+ archivos) y cierre único (`verify` + `build` + `git`). |
| **#2** | `carbon-low` | `gemini-4-carbon-low` | Arquitecto Principal: diseño estructural, estado en React/TypeScript e integración full-stack. (PROHIBIDO invocar carbon-medium o carbon-high). |
| **#3** | `argon-low` | `gemini-4-argon-low` | Contraparte & Auditor Estratégico: desafía supuestos, invariantes de datos y regresiones. (PROHIBIDO invocar argon-medium o argon-high). |
| **#4** | `orchestrator` *(Consultor Pro)* | `gemini-pro-orchestrator` | Razonador Pro y Planificador Profundo: entra a partir del Nivel 4 cuando la dificultad lo amerita. |
| **#5** | `hydrogen-high` *(Niveles 5–9)* | `gemini-4-hydrogen-high` | Especialista Profundo de Razonamiento: concurrencia, condiciones de carrera, FFmpeg y WebAudio. (PROHIBIDO invocar hydrogen-low o hydrogen-medium). |
| **#5★** | `hydrogen-xhigh` *(Nivel 10 / MÁXIMO)* | `gemini-4-hydrogen-xhigh` | Auditoría Exhaustiva Línea por Línea a máxima potencia de razonamiento (`XHigh`). |
| **#6** | `ChatGPT Web` *(Fase 0, Nivel 6+)* | `POST /api/chatgpt-web/ask-external` | Primera perspectiva externa independiente en inglés (`https://chatgpt.com/`, `active: false`), ejecutada **antes** de R1. |
| **#7** | `Gemini Web` *(Fase 0, Nivel 7+)* | `POST /api/gemini-web/ask-external` | Segunda perspectiva externa limpia fuera de Notebooks (`Quick answers`, `active: false`), ejecutada **antes** de R1. |
| **#8** | `Claude Web` *(Fase 0, Nivel 8+)* | `POST /api/claude-web/ask-external` | Tercera perspectiva externa independiente en inglés (`https://claude.ai/`, esfuerzo `Bajo` / `Low`, `active: false`), ejecutada en paralelo **antes** de R1. |
| **#9** | `Grok Web` *(Fase 0, Niveles 9–10)* | `POST /api/grok-web/ask-external` | Cuarta perspectiva externa independiente en inglés (`https://grok.com/`, modo `Fast`, `active: false`), ejecutada en paralelo **antes** de R1. |
| **#10** | `Copilot Web` *(Fase 0, Nivel 10 / MÁXIMO)* | `POST /api/copilot-web/ask-external` | Quinta perspectiva externa independiente en inglés (`https://copilot.microsoft.com/`, modo `Quick Response`, `active: false`), ejecutada automáticamente en paralelo en Nivel 10. |

## 2. Resumen Rápido de los 10 Niveles (`+1 Modelo por Nivel` + Fase 0 Web Automática en 6–10 antes de R1)

- **`MODO 1` (`SOLO`, `0–1 pts`)**: Coordinador en modelo seleccionado (por defecto `Flash 3.8 High`) (1 modelo — ejecución casi instantánea).
- **`MODO 2` (`DUO`, `2 pts`)**: Coordinador + `Carbon Low` (2 modelos — R1 + R2).
- **`MODO 3` (`TRIO`, `3 pts`)**: `+ Argon Low` (3 modelos — R1 + R2).
- **`MODO 4` (`CUATRO`, `4 pts`)**: `+ Orchestrator Pro` (4 modelos — R1 + R2, entra el modelo Pro pesado cuando la dificultad lo amerita).
- **`MODO 5` (`CINCO`, `5 pts`)**: `+ Hydrogen High` (5 motores internos: Coordinador + Carbon Low + Argon Low + Orchestrator Pro + Hydrogen High directos al código, 0 webs — R1 + R2).
- **`MODO 6` (`SEIS`, `6 pts`)**: **Fase 0 Automática** (`ChatGPT Web`, 100% inglés, `active: false`, cero preguntas al usuario) → al recibir la respuesta externa, arranca R1 con los 5 motores internos (Coordinador + Carbon Low + Argon Low + Orchestrator Pro + Hydrogen High) + R2 (6 modelos).
- **`MODO 7` (`SIETE`, `7 pts`)**: **Fase 0 Automática** (`ChatGPT Web` + `Gemini Web` `Quick answers`, 100% inglés, `active: false`) → al reunir las respuestas externas, arranca R1 con los 5 motores internos + R2 (7 modelos).
- **`MODO 8` (`OCHO`, `8 pts`)**: **Fase 0 Automática** (`ChatGPT Web` + `Gemini Web` `Quick answers` + `Claude Web` `Bajo`, 100% inglés, `active: false`) → al reunir las respuestas externas, arranca R1 con los 5 motores internos + R2 (8 modelos).
- **`MODO 9` (`NUEVE`, `9 pts`)**: **Fase 0 Automática** (`ChatGPT Web` + `Gemini Web` `Quick answers` + `Claude Web` `Bajo` + `Grok Web` `Fast`, 100% inglés, `active: false`) → al reunir las respuestas externas, arranca R1 con los 5 motores internos + R2 (9 modelos).
- **`MODO 10` (`DIEZ` / `MÁXIMO`, `10 pts`)**: **10 modelos simultáneos en potencia máxima (5 Webs Automáticas en Fase 0 + Coordinador + Carbon Low + Argon Low + Orchestrator Pro + Hydrogen XHigh)**: ejecuta en paralelo en Fase 0 las **5 Webs automáticas** (`ChatGPT Web` + `Gemini Web` `Quick answers` + `Claude Web` `Bajo` + `Grok Web` `Fast` + `Copilot Web` `Quick Response`, `active: false`, cero preguntas al usuario). Al reunir las 5 respuestas Web automáticas, arranca R1 con los 5 motores internos elevando `Hydrogen` → **`Hydrogen XHigh`** (`gemini-4-hydrogen-xhigh`) + **Auditoría Exhaustiva Línea por Línea** + R2 (10 modelos en potencia máxima). *(Aplica igualmente cuando ocurre Auto-Escalado desde Niveles inferiores hacia `10`)*.

## 3. Protocolo Estricto Anti-Simulación y Bloqueo de Herramienta #1 en Modos 2–10

1. **Prohibición Total de Trabajo en Solitario**: Si el triaje arroja Modo 2 al 10 (o por override explícito del usuario), el coordinador tiene **TERMINANTEMENTE PROHIBIDO** responder en solitario o simular las opiniones de sus compañeros en texto (cero ventriloquismo). Cada motor debe hablar por sí mismo en `swarm`.
2. **Precondición de Herramienta #1 en el Turno Inicial**: En Modos 2 al 5, la primera llamada a herramienta DEBE ser `swarm({ action: "add" })` (si los workers no existen) o `post_message({ text: "@<worker1> @<worker2> ... [RONDA 1: ...]" })` despertando a los workers existentes en `waiting`/`working`. En Modos 6 al 10, la primera llamada es la ejecución automática en paralelo de las Webs de Fase 0 del nivel (100% inglés, `active: false`, sin preguntas al usuario). Al reunir las respuestas web, la siguiente herramienta obligatoria es convocar a los workers en `swarm` para R1.
3. **Bloqueo Inquebrantable de Edición (`edit_file` / `write_file`)**: Ningún archivo de código puede ser modificado antes de recibir las respuestas de R1 de todos los workers convocados y emitir la síntesis de R2 en la pizarra. Si el coordinador se encuentra a punto de editar solo, debe detenerse y abrir la pizarra.
