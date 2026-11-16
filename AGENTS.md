# Directorio Oficial de Motores y Roles de `Huellas Master` (Escalera de 10 Niveles)

> Fuente canónica de protocolos y triaje: `.agents/plugins/raydel-global-rules/rules/AGENTS.md` (sincronizado con `~/.gemini/config/plugins/raydel-global-rules/rules/AGENTS.md`) y `./GEMINI.md`. Este archivo define los IDs verificados de Antigravity/`localhost:4200` y el rol técnico de cada motor.

## 1. Catálogo de 10 Motores Distintos (+ Upgrade `XHigh` en Nivel 10 / MÁXIMO y Perspectivas Manuales Pre-Fase 0 en Niveles 6–9)

| Orden | Nombre de Roster / Puente | ID Canónico / Endpoint | Especialidad en el Debate |
| :--- | :--- | :--- | :--- |
| **#1** | `flash-high` *(Coordinador Rápido)* | `gemini-3.8-flash-high` | Dirección general ágil, triaje inmediato, respuesta casi instantánea en Modo 1, síntesis de consenso R2, reparto de Fase 3 paralela (`1 archivo = 1 modelo` en 2+ archivos) y cierre único (`verify` + `build` + `git`). |
| **#2** | `carbon-high` | `gemini-4-carbon-high` | Arquitecto Principal: diseño estructural, estado en React/TypeScript e integración full-stack. |
| **#3** | `argon-high` | `gemini-4-argon-high` | Contraparte & Auditor Estratégico: desafía supuestos, invariantes de datos y regresiones. |
| **#4** | `orchestrator` *(Consultor Pro)* | `gemini-pro-orchestrator` | Razonador Pro y Planificador Profundo: entra a partir del Nivel 4 cuando la tarea requiere músculo analítico pesado. |
| **#5** | `hydrogen-high` *(Niveles 5–9)* | `gemini-4-hydrogen-high` | Especialista Profundo de Razonamiento: concurrencia, condiciones de carrera, FFmpeg y WebAudio. |
| **#5★** | `hydrogen-xhigh` *(Nivel 10 / MÁXIMO)* | `gemini-4-hydrogen-xhigh` | Auditoría Exhaustiva Línea por Línea a máxima potencia de razonamiento (`XHigh`). |
| **#6** | `ChatGPT Web` *(Fase 0, Nivel 6+)* | `POST /api/chatgpt-web/ask-external` | Primera perspectiva externa independiente en inglés (`https://chatgpt.com/`, `active: false`), ejecutada **antes** de R1. |
| **#7** | `Gemini Web` *(Fase 0, Nivel 7+)* | `POST /api/gemini-web/ask-external` | Segunda perspectiva externa limpia fuera de Notebooks (`Quick answers`, `active: false`), ejecutada **antes** de R1. |
| **#8** | `Claude Web` *(Fase 0, Nivel 8+)* | `POST /api/claude-web/ask-external` | Tercera perspectiva externa independiente en inglés (`https://claude.ai/`, esfuerzo `Bajo` / `Low`, `active: false`), ejecutada en paralelo **antes** de R1. |
| **#9** | `Grok Web` *(Fase 0, Niveles 9–10)* | `POST /api/grok-web/ask-external` | Cuarta perspectiva externa independiente en inglés (`https://grok.com/`, modo `Fast`, `active: false`), ejecutada en paralelo **antes** de R1. |
| **#10** | `Copilot Web` *(Fase 0, Nivel 10 / MÁXIMO)* | `POST /api/copilot-web/ask-external` | Quinta perspectiva externa independiente en inglés (`https://copilot.microsoft.com/`, modo `Quick Response`, `active: false`), ejecutada automáticamente en paralelo en Nivel 10. |
| **#Pre-F0** *(Opcional)* | `Copilot` / `Claude` / `Grok` *(Pre-Fase 0, Niveles 6–9)* | Bloque ```` ```text ... ``` ```` en inglés entregado al usuario | Perspectivas externas manuales opcionales en inglés para las webs que aún no son automáticas en esos niveles; el coordinador pregunta al usuario justo antes de Fase 0 y, si acepta, entrega el prompt en inglés mientras lanza en paralelo las Webs automáticas esperando todas las respuestas antes de abrir R1. En Nivel 10 no se requiere al ser las 5 webs 100% automáticas. |

## 2. Resumen Rápido de los 10 Niveles (`+1 Modelo por Nivel` + Pre-Fase 0 en 6–9 + Fase 0 Web antes de R1)

- **`MODO 1` (`SOLO`, `0–1 pts`)**: `Flash 3.8 High` (1 modelo — ejecución casi instantánea).
- **`MODO 2` (`DUO`, `2 pts`)**: `Flash 3.8 High` + `Carbon High` (2 modelos — R1 + R2).
- **`MODO 3` (`TRIO`, `3 pts`)**: `+ Argon High` (3 modelos — R1 + R2).
- **`MODO 4` (`CUATRO`, `4 pts`)**: `+ Orchestrator Pro` (4 modelos — R1 + R2, entra el modelo Pro pesado cuando la dificultad lo amerita).
- **`MODO 5` (`CINCO`, `5 pts`)**: `+ Hydrogen High` (5 motores internos directos al código, 0 webs — R1 + R2).
- **`MODO 6` (`SEIS`, `6 pts`)**: **Pre-Fase 0** (preguntar al usuario si desea consultar manualmente a `Copilot` en `Quick Response`, `Claude` en `Bajo` o `Grok` en `Fast`; si acepta, entregar el mismo prompt 100% en inglés en bloque ```` ```text ... ``` ```` y arrancar en paralelo `ChatGPT Web`) → al reunir todas las respuestas externas (`ChatGPT Web` + manuales si aplican), arranca R1 con los 5 motores internos + R2 (6+ modelos).
- **`MODO 7` (`SIETE`, `7 pts`)**: **Pre-Fase 0** (preguntar al usuario si desea consultar manualmente a `Copilot` en `Quick Response`, `Claude` en `Bajo` o `Grok` en `Fast`; si acepta, entregar el mismo prompt 100% en inglés en bloque ```` ```text ... ``` ```` y arrancar en paralelo `ChatGPT Web` + `Gemini Web` `Quick answers`) → al reunir todas las respuestas externas, arranca R1 con los 5 motores internos + R2 (7+ modelos).
- **`MODO 8` (`OCHO`, `8 pts`)**: **Pre-Fase 0** (preguntar al usuario si desea consultar manualmente a `Copilot` en `Quick Response` o `Grok` en `Fast`; si acepta, entregar el mismo prompt 100% en inglés en bloque ```` ```text ... ``` ```` y arrancar en paralelo `ChatGPT Web` + `Gemini Web` `Quick answers` + `Claude Web` `Bajo`) → al reunir todas las respuestas externas, arranca R1 con los 5 motores internos (`Hydrogen High`) + R2 (8+ modelos).
- **`MODO 9` (`NUEVE`, `9 pts`)**: **Pre-Fase 0** (preguntar al usuario si desea consultar manualmente a `Copilot` en `Quick Response`; si acepta, entregar el mismo prompt 100% en inglés en bloque ```` ```text ... ``` ```` y arrancar en paralelo `ChatGPT Web` + `Gemini Web` `Quick answers` + `Claude Web` `Bajo` + `Grok Web` `Fast`) → al reunir todas las respuestas externas, arranca R1 con los 5 motores internos (`Hydrogen High`) + R2 (9+ modelos).
- **`MODO 10` (`DIEZ` / `MÁXIMO`, `10 pts`)**: **10 modelos simultáneos en potencia máxima (5 Webs Automáticas en Fase 0 + 5 Motores Internos con Hydrogen XHigh)**: ejecuta en paralelo en Fase 0 las **5 Webs automáticas** (`ChatGPT Web` + `Gemini Web` `Quick answers` + `Claude Web` `Bajo` + `Grok Web` `Fast` + `Copilot Web` `Quick Response`, `active: false`). Al reunir las 5 respuestas Web automáticas, arranca R1 con los 5 motores internos elevando `Hydrogen` → **`Hydrogen XHigh`** + **Auditoría Exhaustiva Línea por Línea** + R2 (10 modelos en potencia máxima). *(Aplica igualmente cuando ocurre Auto-Escalado desde Niveles inferiores hacia `10`)*.

## 3. Protocolo Estricto Anti-Simulación y Bloqueo de Herramienta #1 en Modos 2–10

1. **Prohibición Total de Trabajo en Solitario**: Si el triaje arroja Modo 2 al 10 (o por override explícito del usuario), el coordinador tiene **TERMINANTEMENTE PROHIBIDO** responder en solitario o simular las opiniones de sus compañeros en texto (cero ventriloquismo). Cada motor debe hablar por sí mismo en `swarm`.
2. **Precondición de Herramienta #1 en el Turno Inicial**: En Modos 2 al 5, la primera llamada a herramienta DEBE ser `swarm({ action: "add" })` (si los workers no existen) o `post_message({ text: "@<worker1> @<worker2> ... [RONDA 1: ...]" })` despertando a los workers existentes en `waiting`/`working`. En Modos 6 al 10, tras las llamadas de Fase 0 Web, la siguiente herramienta obligatoria es convocar a los workers en `swarm` para R1.
3. **Bloqueo Inquebrantable de Edición (`edit_file` / `write_file`)**: Ningún archivo de código puede ser modificado antes de recibir las respuestas de R1 de todos los workers convocados y emitir la síntesis de R2 en la pizarra. Si el coordinador se encuentra a punto de editar solo, debe detenerse y abrir la pizarra.
