# Directorio Oficial de Motores y Roles de `Huellas Master` (Escalera de 8 Niveles)

> Fuente canónica de protocolos y triaje: `~/.gemini/config/GEMINI.md` (`user_global`) y `./GEMINI.md`. Este archivo define los IDs verificados de Antigravity/`localhost:4200` y el rol técnico de cada motor.

## 1. Catálogo de 7 Motores Distintos (+ Upgrade `XHigh` en Nivel 8 / MÁXIMO)

| Orden | Nombre de Roster / Puente | ID Canónico / Endpoint | Especialidad en el Debate |
| :--- | :--- | :--- | :--- |
| **#1** | `orchestrator` *(Coordinador)* | `gemini-pro-orchestrator` | Dirección general, triaje, síntesis de consenso R2 y edición quirúrgica única (`edit_file`). |
| **#2** | `carbon-high` | `gemini-4-carbon-high` | Arquitecto Principal: diseño estructural, estado en React/TypeScript e integración full-stack. |
| **#3** | `argon-high` | `gemini-4-argon-high` | Contraparte & Auditor Estratégico: desafía supuestos, invariantes de datos y regresiones. |
| **#4** | `flash-high` | `gemini-3.8-flash-high` | Explorador Rápido & Auditor de Casos Borde: barrido veloz de archivos, selectores y cuellos de botella. |
| **#5** | `hydrogen-high` *(Niveles 5–7)* | `gemini-4-hydrogen-high` | Especialista Profundo de Razonamiento: concurrencia, condiciones de carrera, FFmpeg y WebAudio. |
| **#5★** | `hydrogen-xhigh` *(Nivel 8 / MÁXIMO)* | `gemini-4-hydrogen-xhigh` | Auditoría Exhaustiva Línea por Línea a máxima potencia de razonamiento (`XHigh`). |
| **#6** | `ChatGPT Web` *(Fase 0, Nivel 6+)* | `POST /api/chatgpt-web/ask-external` | Primera perspectiva externa independiente en inglés (`https://chatgpt.com/`, `active: false`), ejecutada **antes** de R1. |
| **#7** | `Gemini Web` *(Fase 0, Niveles 7–8)* | `POST /api/gemini-web/ask-external` | Segunda perspectiva externa limpia fuera de Notebooks (`4 Carbon · Low`, `active: false`), ejecutada **antes** de R1. |

## 2. Resumen Rápido de los 8 Niveles (`+1 Modelo por Nivel` + Fase 0 Web antes de R1)

- **`MODO 1` (`SOLO`, `0–1 pts`)**: `Orchestrator` (1 modelo — ejecución directa).
- **`MODO 2` (`DUO`, `2 pts`)**: `Orchestrator` + `Carbon High` (2 modelos — R1 + R2).
- **`MODO 3` (`TRIO`, `3 pts`)**: `+ Argon High` (3 modelos — R1 + R2).
- **`MODO 4` (`CUATRO`, `4 pts`)**: `+ Flash 3.8 High` (4 modelos — R1 + R2).
- **`MODO 5` (`CINCO`, `5 pts`)**: `+ Hydrogen High` (5 motores internos directos al código, 0 webs — R1 + R2).
- **`MODO 6` (`SEIS`, `6 pts`)**: `ChatGPT Web` **PRIMERO (Fase 0)** → al recibir respuesta, arranca R1 con los 5 motores internos + R2 (6 modelos).
- **`MODO 7` (`SIETE`, `7–8 pts`)**: `ChatGPT Web` + `Gemini Web` (`4 Carbon · Low`) **PRIMERO en paralelo (Fase 0)** → al recibir ambas respuestas, arranca R1 con los 5 motores internos + R2 (7 modelos).
- **`MODO 8` (`OCHO` / `MÁXIMO`, `9–10 pts`)**: `ChatGPT Web` + `Gemini Web` **PRIMERO en paralelo (Fase 0)** → al recibir ambas respuestas, arranca R1 con los 5 motores internos elevando `Hydrogen` → **`Hydrogen XHigh`** + **Auditoría Exhaustiva Línea por Línea** + R2 (7 modelos en potencia máxima).
