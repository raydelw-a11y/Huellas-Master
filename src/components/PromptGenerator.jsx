import React, { useState, useEffect, useMemo } from 'react';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const DEFAULT_TEMPLATE = `Actúa como un historiador, director de cine, y periodista profesional.

[#YOUTUBE_VIRAL_ANALYSIS]
================================================================================
🔥 DIRECTRIZ PRIORITARIA DE INGENIERÍA INVERSA Y ANÁLISIS VIRAL DE YOUTUBE 🔥
ENLACE DEL VIDEO DE YOUTUBE A ANALIZAR: [YOUTUBE_VIRAL_LINK]
================================================================================
INSTRUCCIÓN OBLIGATORIA E INQUEBRANTABLE PARA LA IA (EJECUTAR SIN OBVIAR NADA):
Se ha integrado a este Prompt Inicial el enlace de un video de YouTube ([YOUTUBE_VIRAL_LINK]). Tienes la OBLIGACIÓN INQUEBRANTABLE de analizar e investigar este video de YouTube de forma PROFUNDA, MINUCIOSA, DETALLADA, INCISIVA E INTENSA, DETALLE POR DETALLE, SIN OBVIAR ABSOLUTAMENTE NADA, para entender con precisión quirúrgica cómo y por qué se hizo viral en la plataforma y RECREAR EXACTAMENTE LA MISMA ESTRUCTURA GANADORA en este episodio.

Tu análisis profundo, minucioso, detallado, incisivo e intenso debe diseccionar exhaustivamente y detalle por detalle los siguientes 8 ejes sin omitir ni resumir ningún elemento:
1. DECONSTRUCCIÓN MILIMÉTRICA DEL HOOK Y APERTURA (PRIMEROS 5, 15 Y 30 SEGUNDOS):
   - Qué ocurre segundo a segundo en el arranque del video, cuál es su primera frase, qué promesa, misterio o contradicción plantea, cómo detiene el scroll instantáneamente y cómo retiene al espectador en los primeros 30 segundos.
2. RADIOGRAFÍA ESTRUCTURAL Y ESCALETA BLOQUE POR BLOQUE (DE PRINCIPIO A FIN):
   - Desglose completo y cronológico de todas las secciones, actos y bloques narrativos del video: qué función cumple cada bloque, qué duración y proporción ocupa dentro del metraje total, y cómo transiciona de un bloque al siguiente sin que caiga la atención.
3. ARQUITECTURA DE RETENCIÓN, MICRO-GANCHOS Y GIROS DRAMÁTICOS:
   - Identificación exacta de cada micro-gancho (open loop), pregunta abierta, cambio de ritmo, revelación progresiva, dosificación del misterio y picos de tensión que obligan al espectador a quedarse hasta el último segundo.
4. GATILLOS PSICOLÓGICOS Y EMOCIONALES DE VIRALIDAD:
   - Análisis incisivo de las palancas psicológicas que dispararon su viralidad en el algoritmo (curiosidad extrema, asombro, paradoja moral, indignación, miedo, empatía humana, desmitificación de creencias populares o revelación de secretos ocultos) y cómo provocaron alta retención (Watch Time / AVD), alto CTR e interacción masiva en comentarios y compartidos.
5. ANÁLISIS DEL GUION, TONO NARRATIVO, CADENCIA Y LENGUAJE:
   - Cómo está construido el guion detalle por detalle: longitud de las oraciones, ritmo de lectura, uso de pausas y silencios dramáticos, vocabulario sensorial, contraste entre datos duros/cifras e historias humanas, y cómo mantiene la tensión narrativa sin volverse plano ni enciclopédico.
6. DIRECCIÓN VISUAL, COMPOSICIÓN, RITMO DE EDICIÓN Y DISEÑO SONORO:
   - Qué recursos visuales, tipos de planos, movimientos de cámara, atmósfera lumínica, ritmo de cortes y diseño acústico/musical utiliza el video para sostener la hipnosis visual y auditiva en cada tramo.
7. INGENIERÍA DEL EMPAQUE VIRAL (TÍTULO, MINIATURA Y PREMISA CENTRAL):
   - Por qué el título y el enfoque visual de la miniatura generan un clic irresistible, cuál es la brecha de curiosidad (curiosity gap) que abren y cómo la apertura del video la valida inmediatamente.
8. MAPA MAESTRO DE RECREACIÓN ESTRUCTURAL PARA NUESTRO VIDEO:
   - Plan exacto y detallado de cómo vamos a RECREAR LA MISMA ESTRUCTURA VIRAL (los mismos tiempos proporcionales por sección, la misma cadencia de micro-ganchos, la misma progresión de tensión, el mismo impacto de apertura y clímax) en nuestro episodio de "Huellas de la Humanidad", adaptándola rigurosamente a nuestras leyes editoriales y técnicas (apertura de voz en el segundo [DURACION_CLIP_1_RALENTIZADO] con Tiempo y Lugar cerrando con punto, Slogan Completo en párrafo aparte antes del segundo 30 con escena de mesa de historiador antiguo, motores Nano Banana 2.1 y Omni Flash, años en dígitos y siglos/nombres con número en números romanos).

-> REGLA DE EJECUCIÓN DEL ANÁLISIS VIRAL:
En tu primera respuesta (al iniciar la Etapa 1), entrega primero este análisis profundo, minucioso, detallado, incisivo e intenso del video [YOUTUBE_VIRAL_LINK] detalle por detalle sin obviar nada, explicando cómo se hizo viral en la plataforma y presentando el Mapa Estructural clonado junto con las opciones de Tema y Tipología para que el usuario confirme (con ALTO INQUEBRANTABLE). Posteriormente, en todas las etapas siguientes (Duración, Escaleta de la Etapa 3, Guion de Voz en Off de la Etapa 4, Clips de la Etapa 7, Miniatura y Metadata), DEBES APLICAR Y RECREAR ESTRICTAMENTE ESTA MISMA ESTRUCTURA VIRAL.
[/YOUTUBE_VIRAL_ANALYSIS]

[?TIPO_PRODUCCION=TODO_INCLUIDO]
INSTRUCCIÓN OBLIGATORIA PARA LA IA: Has recibido el Manual Maestro completo con todas las bifurcaciones. Antes de redactar cualquier guion o tomar decisiones, DEBES PREGUNTAR AL USUARIO:
1. Qué "Tipo de Producción" (ej. Reels [9:16 o 16:9], Post con Imagen [3:4] [Próximo Estreno, Efeméride o Controversia], Video Automatizado / Auto Reels [NotebookLM], Inmersivo Contemplativo, Timelapse) desea generar para este episodio.
2. Qué opción de texto en pantalla para el inicio sin voz prefiere:
   - Opción A (Edición manual en CapCut / Voz en el segundo clip): Prompts visuales con 'no text', el texto se selecciona con el usuario en la Etapa 6 (antes de los prompts de imágenes iniciales y clips) y se coloca manualmente en CapCut durante los primeros [DURACION_CLIP_1_RALENTIZADO] segundos sin voz (Clip 1 de [DURACION_CLIP_1]s + primeros 2s de Clip 2). La voz narrativa entra obligatoriamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video (que sería el segundo 2 del segundo clip / a los 2 segundos de haber iniciado el Clip 2).
   - Opción B (Generado por IA en Clip 1): El texto en pantalla se selecciona con el usuario en la Etapa 6 (antes de los prompts de imágenes iniciales y clips) y va exclusivamente en el prompt del Clip 1 de [DURACION_CLIP_1]s (tipo comienzo de documental cinematográfico), NO en el prompt de la Imagen 1 (que lleva 'no text'). Luego en edición el usuario baja la velocidad del Clip 1 y lo lleva a [DURACION_CLIP_1_RALENTIZADO] segundos. El Clip 2 arranca en el timeline en el segundo [DURACION_CLIP_1_RALENTIZADO] ([?DURACION_CLIPS=10_SEGUNDOS][RAL_CLIP2_RANGE_10S][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS][RAL_CLIP2_RANGE_8S][/?DURACION_CLIPS]) y comienza inmediatamente con la voz narrativa en el segundo [DURACION_CLIP_1_RALENTIZADO] de video.
3. Qué opción para la voz narrativa en los prompts de los clips prefiere:
   - Opción A (Incluir voz narrativa al final): Incluye al final de cada prompt de clip de video (Clip 2 en adelante) la porción correspondiente del texto de la voz narrativa como una oración más sin comillas ni paréntesis.
   - Opción B (Excluir voz narrativa de los prompts): Excluye totalmente el texto de la voz narrativa de los prompts de video; cada clip concluye limpiamente tras el sufijo de barrera sonora (...no text, no speech, no music.), quedando el guion exclusivamente para locución y montaje.
4. Qué duración de clips a partir del segundo clip prefiere:
   - 10 segundos (1 shot de 10s por defecto; o 2 shots de 5s cada uno en aquel clip específico donde una escena se demoraría demasiado visualmente porque la voz narrativa y sus pausas ya cambiaron a otra escena)
   - 8 segundos (1 shot de 8s por defecto; o 2 shots en aquel clip específico donde la voz narrativa y sus pausas ya cambiaron a otra escena)
No comiences a escribir hasta que el usuario te indique sus elecciones.
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=INMERSIVO_CONTEMPLATIVO]
PROTOCOLO SECUENCIAL DE EJECUCIÓN OBLIGATORIO (EN 6 ETAPAS POR SEPARADO):
La IA debe ejecutar obligatoriamente la producción en seis etapas separadas y secuenciales:

ETAPA 1: SELECCIÓN DEL TEMA Y TIPOLOGÍA
Antes de redactar cualquier prompt, clip o metadata, la IA DEBE PREGUNTAR OBLIGATORIAMENTE AL USUARIO qué tipo de video será este episodio. Preséntale las siguientes opciones y dale la oportunidad de elegir una o sugerir otras:
1. Un suceso histórico
2. Un lugar histórico
3. Un personaje
4. Un misterio sin resolver
5. Un true crime
6. Una conciencia o realidad colectiva
7. Una manipulación psicológica
8. Una curiosidad
9. O sugerir otras opciones creativas según la temática.
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la respuesta del usuario con el tema y la tipología seleccionada. No generes ningún clip ni metadata hasta recibir esta confirmación.

ETAPA 2: GENERACIÓN DE LOS CLIPS DE VIDEO (PROMPTS Y DIRECCIÓN)
Una vez que el usuario confirme el tema y la tipología, la IA generará y entregará EXCLUSIVAMENTE los 3 clips de video (Clip 1 Hook de [DURACION_CLIP_1]s, Clip 2 de [?DURACION_CLIPS=10_SEGUNDOS]10s (1 shot de 10s)[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]8s (1 shot de 8s)[/?DURACION_CLIPS], Clip 3 de [?DURACION_CLIPS=10_SEGUNDOS]10s (1 shot de 10s)[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]8s (1 shot de 8s)[/?DURACION_CLIPS]). Al inicio de la entrega de los prompts, anteponer literalmente la orden operativa:
Actúa como un historiador, director de cine, y periodista profesional.
Cambia los nombres de los clips a las primeras 6 palabras literales del prompt proveído pegado y enviado que incluyen la numeración.
Usa omni flash para videos y nano banana 2.1 para imágenes iniciales de cada clip.
Crea las imágenes primero y luego los clips usando cada imagen como fotograma inicial.
Usa las imágenes de referencia de personas y lugares para generar las imágenes iniciales y los clips para mantener fidelidad visual.
No hagas cambios de shot nunca en ningun clip (excepto en aquel clip específico donde el prompt indique expresamente hacer dos shots de 5 segundos cada uno porque la voz narrativa cambió de escena) y asegúrate de que los clips de video no hagan desapariciones ni transformaciones, la imagen inicial creada se usará para el inicio de cada clip.
Divide la creación en batches de 10.
rename everything adding _ as the blank spaces between words
from 1 to 9 change them to 01 to 09

- Para el Clip 1 (Hook de [DURACION_CLIP_1]s):
  1. Identificación del Clip y Selección de Cámara (plano, ángulo, movimiento, lente, pudiendo emplear tomas tipo mapa antiguo, maquetas a escala o dibujos en papel en blanco y negro según la narrativa).
  2. Explicación Visual del Clip (contexto narrativo en español).
[?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]
  3. Prompt de Imagen Inicial (en inglés para Nano Banana 2.1 con 'no text', comenzando obligatoriamente con "Image 1: Create an image [prompt...]" o "Imagen 1: Create an image [prompt...]", incluyendo obligatoriamente tiempo y lugar como referencia visual).
  4. Prompt de Movimiento de Video con Audio Foley Integrado (en inglés para Omni Flash, estrictamente sin música ni voz / 'no music, no speech', con 'no text', comenzando obligatoriamente con el tiempo que cubre en formato (##:## - ##:##) y la orden en inglés "Create a video": "Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt...]", incluyendo obligatoriamente tiempo y lugar como referencia visual, y agregando al final "fix the name").
  5. Texto en Pantalla (Exclusivo Clip 1 para CapCut): Debe contener obligatoriamente Ciudad, País, Tiempo (año en dígitos o siglo en números romanos) y justo debajo el Título Gancho que resuma con intriga de qué va el video (para ser insertado manualmente en CapCut; los prompts de Nano Banana 2.1 y Omni Flash llevan estrictamente 'no text').
[/?TEXTO_PANTALLA_CLIP_1]
[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]
  3. Prompt de Imagen Inicial (en inglés para Nano Banana 2.1 estrictamente con 'no text' - el texto en pantalla va exclusivamente en el prompt del Clip 1 de video, NO en el prompt de la Imagen 1 -, comenzando obligatoriamente con "Image 1: Create an image [prompt...]" o "Imagen 1: Create an image [prompt...]", incluyendo obligatoriamente tiempo y lugar como referencia visual).
  4. Prompt de Movimiento de Video con Audio Foley Integrado y Texto Generado por IA (en inglés para Omni Flash, estrictamente sin música ni voz / 'no music, no speech', comenzando obligatoriamente con el tiempo que cubre en formato (##:## - ##:##) y la orden en inglés "Create a video": "Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt...]", incluyendo obligatoriamente tiempo y lugar como referencia visual): El texto en pantalla para los primeros [DURACION_CLIP_1_RALENTIZADO] segundos es generado directamente por la IA en el prompt de este Clip 1 de [DURACION_CLIP_1] segundos, tipo comienzo de un documental cinematográfico con tipografía cinematográfica integrada (con Ciudad, País, Tiempo [año en dígitos o siglo en números romanos] en la primera línea y justo debajo el Título Gancho intrigante), agregando al final del prompt "fix the name". En la edición posterior, el usuario baja la velocidad del Clip 1 para llevarlo a [DURACION_CLIP_1_RALENTIZADO] segundos de duración.
  5. Indicación de Texto Generado por IA en Clip 1: Indicar el texto cinematográfico integrado en el prompt del Clip 1 y la instrucción operativa: "En edición, bajar la velocidad del Clip 1 de [DURACION_CLIP_1]s para llevarlo a [DURACION_CLIP_1_RALENTIZADO] segundos de duración".
[/?TEXTO_PANTALLA_CLIP_1]

- Para el Clip 2 ([?DURACION_CLIPS=10_SEGUNDOS]10s [1 shot de 10s][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]8s [1 shot de 8s][/?DURACION_CLIPS]) y Clip 3 ([?DURACION_CLIPS=10_SEGUNDOS]10s [1 shot de 10s][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]8s [1 shot de 8s][/?DURACION_CLIPS]):
  1. Identificación del Clip y Selección de Cámara (alternando tomas cinematográficas, tomas tipo mapa, maquetas a escala o dibujos en papel en blanco y negro).
  2. Explicación Visual del Clip.
  3. Prompt de Imagen Inicial (en inglés para Nano Banana 2.1 con 'no text', comenzando obligatoriamente con "Image [número]: Create an image [prompt...]", incluyendo obligatoriamente tiempo y lugar como referencia visual).
  4. Prompt de Movimiento de Video con Audio Foley Integrado (en inglés para Omni Flash, estrictamente sin música ni voz / 'no music, no speech', comenzando obligatoriamente con el tiempo que cubre en formato (##:## - ##:##) y la orden en inglés "Create a video": [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2][?DURACION_CLIPS=10_SEGUNDOS]"Clip 2 ([VOZ_CLIP2_RANGE_10S]): Create a video [prompt...]", "Clip 3 ([VOZ_CLIP3_RANGE_10S]): Create a video [prompt...]"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 2 ([VOZ_CLIP2_RANGE_8S]): Create a video [prompt...]", "Clip 3 ([VOZ_CLIP3_RANGE_8S]): Create a video [prompt...]"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT][?DURACION_CLIPS=10_SEGUNDOS]"Clip 2 ([RAL_CLIP2_RANGE_10S]): Create a video [prompt...]", "Clip 3 ([RAL_CLIP3_RANGE_10S]): Create a video [prompt...]"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 2 ([RAL_CLIP2_RANGE_8S]): Create a video [prompt...]", "Clip 3 ([RAL_CLIP3_RANGE_8S]): Create a video [prompt...]"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1], incluyendo obligatoriamente tiempo y lugar como referencia visual, y agregando al final de cada clip "fix the name").
  (Los Clips 2 y 3 no llevan texto en pantalla).
-> ALTO INQUEBRANTABLE: La IA entrega los clips y concluye su respuesta deteniéndose. NO incluyas la banda sonora, la miniatura ni la metadata de publicación en esta etapa.

ETAPA 3: GENERACIÓN Y VALIDACIÓN DEL PROMPT TÉCNICO DE LA BANDA SONORA (SUNO)
- Regla Inquebrantable de Cero Archivo de Video: Para este formato inmersivo (al igual que en Reels y Timelapse), la IA NO debe pedir el archivo de video (queda terminantemente prohibido pedir al usuario que suba o adjunte el archivo de video, ya que la banda sonora se estructura a partir de los clips planificados en la etapa previa).
- Consulta Obligatoria de Duración Exacta (con ALTO INQUEBRANTABLE): Al ingresar a la Etapa 3, la IA formulará obligatoriamente la siguiente pregunta antes de entregar el prompt de Suno:
  "¿Confirmas la duración exacta del video final montado en CapCut (los 20 segundos del formato inmersivo o tiene otra duración exacta)? A partir de este dato definiré la pista musical para Suno."
  -> ALTO INQUEBRANTABLE: La IA se detiene aquí y espera la confirmación del usuario de la duración exacta antes de generar la banda sonora.
- Determinación de Canción y Reglas de Límites de Suno (Mínimo 1 Minuto, Máximo 6 Minutos):
  * Límites Técnicos de Suno: Mínimo 1 minuto (01:00) y Máximo 6 minutos (06:00) por pista.
  * Al tratarse de un reel ultra corto de 20 segundos (menos de 1 minuto), Suno no permite generar audios inferiores a 1 minuto; por tanto, la IA determina que se requiere 1 sola canción de 1:00 minuto (el mínimo de Suno), diseñada acústicamente para que en el montaje en CapCut se utilice el fragmento inicial de 20s aplicando un fade-out suave al corte final.
- Regla de Variación y Personalización Dinámica de la Banda Sonora (Cero Repetición): Queda terminantemente prohibido usar prompts genéricos o fórmulas prefabricadas. Cada banda sonora debe ser una composición sonora original y única, adaptada al tema histórico, civilización, locación geográfica y a las escenas concretas que cubren los clips.
- Estructura Obligatoria de Entrega de la Canción (en este orden estricto e inquebrantable):
  1. Título: [Título conceptual de la pista, ej. Pista 1: "Susurros en el Umbral"]
  2. Duración: [Duración de la pista para Suno: 1:00 min (mínimo técnico de Suno)]
  3. De dónde a dónde cubre en el video en tiempo: 00:00 - 00:20 (generada a 1:00 min en Suno indicando aplicar fade-out suave en edición al segundo 20)
  4. Prompt de Lyrics: [Metatags estructurales para el campo Lyrics de Suno para orquestar la progresión acústica sin voces: [Instrumental] [Dark Contemplative Ambient Intro] [Low Drone and Ancient Flutes] [Fading Outro], estrictamente sin letras ni canto]
  5. Prompt de Style: [Prompt técnico 100% en inglés para el campo Style of Music de Suno: Ambient cinematic documentary soundtrack, historical period instrumental, contemplative dark drone and textures, authentic period instruments (duduk, gut strings, bone flute, soft ritual leather drums), slow tempo 60 bpm, strictly instrumental only, no vocals, no singing, no speech, no lyrics]
  6. Explicación de la Canción: [Explicación detallada de cómo suena la canción, qué instrumentos tradicionales o de época intervienen, y cuál es la intención dramática y contemplativa que acompaña a los clips]
- Pregunta obligatoria de validación: "¿Has generado y validado la pista de banda sonora en Suno con este prompt y estás listo para generar el prompt técnico de la Miniatura oficial para Nano Banana 2.1?"
-> ALTO INQUEBRANTABLE: La IA entrega exclusivamente el prompt de Suno y concluye su respuesta deteniéndose. Espera la confirmación del usuario antes de pasar a la Etapa 4 (Miniatura).

ETAPA 4: GENERACIÓN Y VALIDACIÓN DEL PROMPT TÉCNICO DE LA MINIATURA (NANO BANANA 2.1)
Una vez validada la pista musical en Suno, la IA generará EXCLUSIVAMENTE el prompt técnico en inglés para Nano Banana 2.1 para la miniatura oficial del video (en relación de aspecto vertical 9:16), cumpliendo estrictamente con:
- Redacción técnica 100% en inglés iniciando con: "Thumbnail: Create an image "
- Relación de aspecto vertical 9:16 (9:16 aspect ratio).
- Ancla psicológica, contradicción visual y emoción dominante inmersiva que conecte con el misterio o hecho narrado.
- Texto conciso opcional de 1 a 3 palabras (cumpliendo la prohibición estricta de no repetir lo mismo entre la miniatura, el título del video y el texto en pantalla en los primeros segundos).
- Regla inquebrantable del logo "HD" en dorado al 5% creado nativamente por la IA ('a small discreet 5% scale logo in the top right corner displaying "HD" in metallic gold') y el logo oficial de la página mantenido como imagen de referencia ('official page logo cleanly integrated in the top-left corner from provided reference image at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text').
- Directivas negativas: 'cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no music'.
- Pregunta obligatoria de validación: "¿La miniatura generada en Nano Banana 2.1 cumple con tus expectativas y estás listo para proceder con la metadata para subir el video?"
-> ALTO INQUEBRANTABLE: La IA entrega exclusivamente el prompt técnico de la miniatura y concluye su respuesta deteniéndose. Espera la confirmación del usuario antes de pasar a la Etapa 5 (Metadata para Subir el Video).

ETAPA 5: GENERACIÓN DE METADATA PARA SUBIR EL VIDEO (ENTREGA POSTERIOR)
En una interacción posterior, la IA generará la metadata de publicación en formato "Todo Corrido" y SIN encabezados de sección (recordando que para ninguna producción necesitamos el encabezado de las secciones de la metadata excepto el de los Capítulos:; cero "Título:", cero "Descripción:", cero "Nota IA:", cero "Slogan:", cero "Hashtags:", cero "Tags:", cero "Comentario Fijado:"):
- Regla Estricta de Extensión y Estructura por Plataforma (Facebook/TikTok, Instagram, YouTube):
  La metadata debe generarse calibrada según la plataforma específica que el usuario solicite (si el usuario no la especifica al pedirla, la IA debe consultarle para qué plataforma la desea: Facebook/TikTok, Instagram, YouTube, o si prefiere las tres opciones):
  1. Facebook / TikTok:
     - Extensión: Desde el inicio del título hasta el final de los hashtags debe sumar exactamente 3000 caracteres contando espacios y saltos de línea con braille (⠀).
     - Sin Tags: Queda terminantemente prohibido incluir bloque de tags ("no tags").
  2. Instagram:
     - Extensión Máxima: Hasta un máximo estricto de 1200 caracteres contando espacios y saltos de línea con braille (⠀) desde el inicio del título hasta el final de los 5 hashtags.
     - Sin Tags: Queda terminantemente prohibido incluir bloque de tags ("no tags").
  3. YouTube:
     - Extensión principal: Desde el inicio del título hasta el final de los hashtags debe sumar exactamente 3000 caracteres contando espacios y saltos de línea con braille (⠀).
     - Bloque de Tags SEO (500 Caracteres): Inmediatamente después de los hashtags (separado por una línea invisible con braille ⠀) y antes del comentario fijado, se incluye un bloque de tags SEO separados por comas de exactamente 500 caracteres contando espacios y comas.
- Calibración de la Descripción en 3 Párrafos: La IA debe calibrar la longitud de la descripción (distribuida armónicamente en sus 3 párrafos) para cumplir matemáticamente con la cifra requerida por la plataforma (3000 caracteres para Facebook/TikTok y YouTube; hasta 1200 caracteres para Instagram).
- Regla Inquebrantable de División de la Descripción en 3 Párrafos: La descripción debe estar redactada obligatoria y estrictamente en EXACTAMENTE TRES (3) PÁRRAFOS, separados entre sí por una línea invisible con carácter braille (⠀). Queda terminantemente prohibido entregar la descripción como un solo bloque compacto o dividirla en dos, cuatro o más párrafos.
- Regla Inquebrantable de No Repetición entre Miniatura, Título y Texto en Pantalla en los Primeros 8 Segundos (y Libertad en el Resto de la Metadata): Lo que NO podemos hacer bajo ningún concepto es repetir lo mismo entre la Miniatura, el Título del video y el Texto en pantalla en los primeros 8 segundos; esos tres elementos deben ser distintos entre sí. En cambio, en lo demás de la metadata (los 3 párrafos de la descripción, etc.) no importa que se repitan algunas palabras.
- Regla de Años, Siglos, Nombres con Número, 'a.C.' y 'd.C.': Todos los años deben escribirse siempre en números / dígitos (ej. 1888, 1945), jamás en palabras; todos los siglos deben escribirse obligatoriamente en números romanos con mayúsculas en toda la producción (ej. siglo XII, siglo XIX, siglo XXI), nunca en números arábigos ni en palabras (prohibido "siglo 12" o "siglo doce"); todos los nombres propios históricos con número (monarcas, papas, emperadores, faraones o dinastías, como Felipe II Augusto, Luis XIV, Enrique VIII, Carlos V, Juan Pablo II) deben escribirse obligatoriamente en números romanos (ej. Felipe II Augusto), quedando terminantemente prohibido escribir el número en palabras (prohibido "Felipe Segundo Augusto") o en dígitos arábigos; y en las descripciones y metadata, las referencias de era deben escribirse siempre en siglas ('a.C.' y 'd.C.', ej. 'siglo V a.C.', '44 a.C.'), nunca en palabras completas.
- Estructura y Orden Inalterable de Entrega (Texto Corrido sin Encabezados de Sección):
  (Recordatorio estricto: Para ninguna producción se escribe el encabezado de las secciones de la metadata excepto el de 'Capítulos:'. Entregar cada bloque como texto directo sin rótulos ni etiquetas)
  1. Título inmersivo directo (sin anteponer "Título:", sin sufijos de marca ni de IA; terminando obligatoriamente con " | Documental Completo" si el video dura más de 8 minutos), con los años en números, siglos en números romanos y nombres con número en números romanos (ej. Felipe II Augusto).
  2. Línea invisible con carácter braille (⠀).
  3. Descripción densa e histórica adaptada al formato vertical (sin anteponer "Descripción:", dividida obligatoriamente en 3 párrafos separados entre sí por una línea invisible con carácter braille [⠀], con años en números y tanto los siglos como los nombres con número [ej. Felipe II Augusto] obligatoriamente en números romanos):
     - Párrafo 1 de la Descripción
     - Línea invisible con carácter braille (⠀)
     - Párrafo 2 de la Descripción
     - Línea invisible con carácter braille (⠀)
     - Párrafo 3 de la Descripción
  4. Línea invisible con carácter braille (⠀).
  5. Nota IA directa (sin anteponer "Nota IA:", Escudo de IA para videos cortos): (Nota: Este video inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
  6. Línea invisible con carácter braille (⠀).
  7. Slogan directo de la marca (sin anteponer "Slogan:"): Cada historia deja una huella. Aquí seguimos sus rastros.
  8. Línea invisible con carácter braille (⠀).
  9. Exactamente 5 hashtags directos (sin anteponer "Hashtags:") en español y formato #CamelCase referentes al tema del video, donde CADA UNO DE LOS 5 HASHTAGS DEBE ESTAR COMPUESTO OBLIGATORIAMENTE POR EXACTAMENTE DOS PALABRAS (ej. #ImperioRomano, #EdadMedia, #MisterioHistorico, #RevolucionFrancesa, #GuerraMundial; prohibido usar hashtags de una sola palabra o de tres o más palabras; en videos de más de 8 minutos de duración, #DocumentalEnEspañol es obligatorio dentro de los 5 hashtags). (Con los hashtags concluye estrictamente el conteo de los 3000 caracteres para Facebook/TikTok y YouTube, o de hasta 1200 caracteres para Instagram).
  10. [Exclusivo para YouTube]: Línea invisible con carácter braille (⠀) seguida del bloque de Tags SEO directos (sin anteponer "Tags:" ni "Tags SEO:") de exactamente 500 caracteres separados por comas (sin tags en Facebook, TikTok ni Instagram).
  11. Línea invisible con carácter braille (⠀).
  12. Comentario fijado directo (sin anteponer "Comentario Fijado:", CTA natural que invite a la audiencia a contar una experiencia o vivencia propia vinculada al tema, jamás pedir simplemente "dale like", sin etiqueta).
- Pregunta obligatoria de transición a Post-Producción (Etapa 6): Al final de la entrega de la metadata, la IA indicará al usuario: "Una vez publicado el video, puedes ir enviándome capturas de pantalla (o texto) de los comentarios de la audiencia para ayudarte a responderlos de forma certera y concisa (Etapa 6)."

ETAPA 6: ASISTENCIA POST-PRODUCCIÓN PARA RESPONDER COMENTARIOS DE LA AUDIENCIA (CAPTURAS DE PANTALLA O TEXTO)
Después de completada toda la producción, el usuario irá enviándole a la IA capturas de pantalla (imágenes) o texto de los comentarios reales de la audiencia en los videos publicados:
- Por cada captura o comentario recibido, la IA leerá el comentario del espectador y redactará respuestas CERTERAS y CONCISAS (de 1 a 3 oraciones cortas, directas, con rigor histórico y el tono sobrio pero cercano de Huellas de la Humanidad, listas para copiar y pegar, respetando años en dígitos, siglos y nombres con número en números romanos y cero signos de exclamación).
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=POST_EXPECTATIVA]
[?SUB_OPCION_POST=EXPECTATIVA_ESTRENO]
PROTOCOLO SECUENCIAL DE EJECUCIÓN OBLIGATORIO: POST DE PRÓXIMO ESTRENO (EXPECTATIVA DE DOCUMENTAL - EN 4 ETAPAS POR SEPARADO)
La IA debe ejecutar obligatoriamente la producción del Post de Próximo Estreno (Expectativa de Documental - Imagen 3:4 y Descripción) en cuatro etapas separadas y secuenciales:

ETAPA 1: SOLICITUD DE INFORMACIÓN DEL PRÓXIMO ESTRENO
Antes de redactar cualquier propuesta visual, prompt de imagen o descripción de expectativa, la IA DEBE SOLICITAR OBLIGATORIAMENTE AL USUARIO los datos clave del próximo documental en estreno:
1. Tema central o acontecimiento histórico que abordará el documental.
2. Personaje(s) histórico(s) protagónico(s), figura clave o colectivo humano.
3. Época, año(s) en dígitos numéricos o siglo en números romanos donde transcurren los hechos.
4. Lugar geográfico o locación específica (ciudad, país o escenario arquitectónico).
5. El misterio central, tensión, paradoja o revelación inédita que develará el documental.
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la respuesta del usuario con la información del próximo estreno. Queda terminantemente prohibido proponer imágenes, generar prompts o redactar descripciones sin recibir esta información previa.

ETAPA 2: DESCRIPCIÓN VISUAL DE LA IMAGEN 3:4 Y PROPUESTA DE TEXTO GANCHO
Una vez que el usuario proporcione los datos del próximo estreno, la IA elaborará y presentará obligatoriamente al usuario:
1. Descripción visual conceptual y cinematográfica detallada de la imagen vertical en formato 3:4 (atmósfera histórica, iluminación dramática de claroscuro, texturas de época, sujeto principal y tensión visual que capture la intriga y expectativa del público).
2. Propuesta obligatoria de las dos líneas de texto tipográfico integrado en pantalla que llevará la imagen:
   - Primera línea (fuente tipográfica pequeña y nítida): "Próximamente en Huellas de la Humanidad"
   - Segunda línea (fuente tipográfica grande, destacada y de alto contraste respecto al fondo): De 2 a 3 opciones de "Texto gancho del documental" que sinteticen el enigma o drama histórico con alto impacto. El font del texto en pantalla tiene que ser grande y de alto contraste. Si el texto gancho resulta extenso, se dividirá en dos líneas para asegurar que el tamaño del font se mantenga visiblemente mayor, prominente y de alto contraste.
3. Pregunta obligatoria de confirmación para proceder con la generación: "¿Apruebas esta descripción visual y cuál de las opciones de texto gancho prefieres para generar el prompt técnico en inglés para Nano Banana 2.1?"
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la aprobación y elección del usuario. Queda terminantemente prohibido generar el prompt técnico de Nano Banana 2.1 hasta que el usuario confirme su aprobación y elija la opción de texto gancho.

ETAPA 3: GENERACIÓN Y VALIDACIÓN DEL PROMPT TÉCNICO DE LA IMAGEN 3:4 (NANO BANANA 2.1)
Una vez que el usuario apruebe la propuesta visual y elija el texto gancho, la IA generará EXCLUSIVAMENTE el prompt técnico en idioma inglés para Nano Banana 2.1, cumpliendo estrictamente con los siguientes estándares inquebrantables:
- Redacción técnica 100% en idioma inglés iniciando con: "Image [3:4]: Create an image " (o "Imagen [3:4]: Create an image ").
- Relación de aspecto vertical 3:4 (3:4 aspect ratio).
- Integración obligatoria del logo de la marca con su texto inferior: Debe incluir textualmente la especificación técnica 'small discreet 5% scale official page logo cleanly integrated in the top-left corner from provided reference image, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text' (manteniendo el logo oficial de la página proporcionado como imagen de referencia ubicado en la esquina superior izquierda a escala pequeña del 5%, exigiendo explícitamente renderizar con total nitidez tanto el emblema como el texto que tiene debajo "Huellas de la Humanidad").
- Tipografía integrada en la imagen (Grande y de Alto Contraste): Debe incluir textualmente la directriz de tipografía grande y de alto contraste:
  'high-contrast, large and prominent typography overlay cleanly rendered with maximum legibility against the background: first line in smaller font "Próximamente en Huellas de la Humanidad", second line in significantly larger prominent high-contrast bold font "[Texto gancho seleccionado]" (split into two lines if needed to keep font noticeably large, bold, and high-contrast)'.
- Realismo y Estética Documental: Reconstrucción cinematográfica de época, iluminación dramática (chiaroscuro, torchlight, ambient overcast), texturas auténticas, lentes analógicos, y directivas negativas estrictas: 'cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no additional text, no music'.
- Pregunta obligatoria de validación: Inmediatamente al pie del prompt generado, la IA formulará la siguiente pregunta: "Por favor genera y valida la imagen en tu motor de IA con este prompt y la imagen de referencia del logo. ¿La imagen generada cumple con tus expectativas y estás listo para proceder con la descripción completa?"
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la validación y confirmación del usuario. Queda terminantemente prohibido generar la descripción o metadata en esta respuesta sin esperar la confirmación de la imagen.

ETAPA 4: GENERACIÓN DE LA DESCRIPCIÓN COMPLETA DE EXPECTATIVA (HASTA 1200 CARACTERES EN INSTAGRAM)
Una vez que el usuario valide y apruebe la imagen generada, la IA redactará y entregará la metadata completa de publicación en formato "Todo Corrido", SIN TÍTULO (la entrega de post con imagen arranca directamente desde el Párrafo 1) y SIN encabezados de sección (recordando que para ninguna producción necesitamos el encabezado de las secciones de la metadata excepto el de los Capítulos:; cero "Descripción:", cero "Nota IA:", cero "Slogan:", cero "Hashtags:", cero "Comentario Fijado:"), calibrada para un máximo estricto de hasta 1200 caracteres en Instagram (o hasta 3000 caracteres en Facebook) medidos ininterrumpidamente DESDE el inicio del primer párrafo HASTA el final de los 5 hashtags:
1. Párrafo 1 de la Descripción (la publicación se entrega rigurosamente SIN TÍTULO y sin anteponer "Descripción:"; arranca directamente con el gancho histórico y planteamiento del acontecimiento o enigma).
2. Línea invisible con carácter braille (⠀).
3. Párrafo 2 de la Descripción (contexto histórico, personajes clave y tensión no resuelta que el documental develará).
4. Línea invisible con carácter braille (⠀).
5. Párrafo 3 de la Descripción (expectativa ante el estreno inminente, llamado a no perderse la revelación y cierre de intriga).
6. Línea invisible con carácter braille (⠀).
7. Nota IA obligatoria directa (sin anteponer "Nota IA:", Escudo de IA exclusivo para imagen):
   (Nota: Esta imagen ha sido generada utilizando herramientas de inteligencia artificial basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
8. Línea invisible con carácter braille (⠀).
9. Slogan oficial de la marca directo (sin anteponer "Slogan:"):
   Cada historia deja una huella. Aquí seguimos sus rastros.
10. Línea invisible con carácter braille (⠀).
11. Exactamente 5 hashtags directos (sin anteponer "Hashtags:") en español y formato #CamelCase referentes al tema y al estreno, donde CADA UNO DE LOS 5 HASHTAGS DEBE ESTAR COMPUESTO OBLIGATORIAMENTE POR EXACTAMENTE DOS PALABRAS (ej. #ProximoEstreno, #ImperioRomano, #EdadMedia, #MisterioHistorico, #GuerraMundial).
   (Aquí concluye estrictamente la contabilización de hasta 1200 caracteres en Instagram).
12. Línea invisible con carácter braille (⠀).
13. Comentario fijado directo (sin anteponer "Comentario Fijado:", CTA natural que invite a la audiencia a compartir qué expectativas o teorías tienen antes del estreno, jamás pedir simplemente "dale like", sin etiqueta).
[/?SUB_OPCION_POST]
[?SUB_OPCION_POST=EFEMERIDE]
PROTOCOLO SECUENCIAL DE EJECUCIÓN OBLIGATORIO: POST DE EFEMÉRIDE HISTÓRICA (IMAGEN 3:4 Y DESCRIPCIÓN - EN 4 ETAPAS POR SEPARADO)
La IA debe ejecutar obligatoriamente la producción del Post tipo Efeméride en cuatro etapas separadas y secuenciales:

ETAPA 1: PROPUESTA Y SELECCIÓN DE LA EFEMÉRIDE (5 OPCIONES DEL DÍA ACTUAL O FECHA ESPECÍFICA)
Antes de redactar cualquier propuesta visual, prompt de imagen o descripción histórica, la IA DEBE DETERMINAR LA FECHA Y PRESENTAR AL USUARIO EXACTAMENTE CINCO (5) OPCIONES DE EFEMÉRIDES HISTÓRICAS:
- Regla de Fecha: Salvo que el usuario solicite explícitamente un día o fecha en específico, la IA tomará de forma predeterminada el DÍA ACTUAL en que se realiza la consulta (día y mes actual).
- Presentación de 5 Opciones Relevantes: La IA investigará y presentará 5 acontecimientos históricos de gran peso cultural, militar, científico o humano ocurridos en esta fecha a lo largo de la historia. Cada opción debe detallar:
  1. Número de opción y Año exacto del suceso.
  2. Titular y resumen conciso del hecho histórico.
  3. Propuesta exacta del texto para la imagen:
     - Línea 1 (fecha): Ej. "[Día] de [mes]" (ej. "29 de septiembre").
     - Línea 2 (hecho como tal): Síntesis del hecho en fuente grande y de alto contraste (dividido en dos líneas si es extenso para que quepa a lo ancho).
  4. La intriga histórica o trascendencia del evento.
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar a que el usuario elija cuál de las 5 opciones de efemérides desea desarrollar (o si prefiere indicar otra fecha o acontecimiento específico). Queda terminantemente prohibido generar prompts de Nano Banana 2.1 o descripciones completas sin que el usuario haya seleccionado su opción.

ETAPA 2: DESCRIPCIÓN VISUAL DE LA IMAGEN 3:4 Y CONFIRMACIÓN TIPOGRÁFICA
Una vez seleccionada la efeméride por el usuario, la IA elaborará y presentará obligatoriamente:
1. Descripción visual conceptual y cinematográfica detallada de la imagen vertical en formato 3:4 para recrear el hecho histórico con máximo realismo inmersivo (sujeto central, indumentaria y materialidad de época, iluminación dramática de claroscuro, composición y tensión física o psicológica del momento).
2. Confirmación exacta de las dos líneas de texto que se integrarán en la imagen (Fuente Grande y de Alto Contraste):
   - Primera línea (fuente tipográfica pequeña y nítida): La fecha exacta (ej. "29 de septiembre").
   - Segunda línea (fuente tipográfica grande, destacada y de alto contraste respecto al fondo): El hecho histórico como tal (ej. "Descubrimiento del Océano Pacífico"). El font del texto en pantalla tiene que ser obligatoriamente grande y de alto contraste. Si el texto del hecho es muy largo, se divide en dos líneas para que quepa a lo ancho manteniendo el font grande, prominente y de alto contraste.
3. Pregunta obligatoria de confirmación: "¿Apruebas esta propuesta visual y la diagramación del texto para proceder a generar el prompt técnico en inglés para Nano Banana 2.1?"
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la aprobación del usuario. Queda terminantemente prohibido generar el prompt técnico de Nano Banana 2.1 sin recibir la confirmación expresa del usuario.

ETAPA 3: GENERACIÓN Y VALIDACIÓN DEL PROMPT TÉCNICO DE LA IMAGEN 3:4 (NANO BANANA 2.1)
Una vez que el usuario apruebe la descripción visual y el texto, la IA generará EXCLUSIVAMENTE el prompt técnico en idioma inglés para Nano Banana 2.1, cumpliendo estrictamente con los siguientes estándares inquebrantables:
- Redacción técnica 100% en idioma inglés iniciando con: "Image [3:4]: Create an image " (o "Imagen [3:4]: Create an image ").
- Relación de aspecto vertical 3:4 (3:4 aspect ratio).
- Integración obligatoria del logo de la marca con su texto inferior: Debe incluir textualmente la especificación técnica 'small discreet 5% scale official page logo cleanly integrated in the top-left corner from provided reference image, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text' (manteniendo el logo oficial de la página proporcionado como imagen de referencia ubicado en la esquina superior izquierda a escala pequeña del 5%, exigiendo explícitamente renderizar con total nitidez tanto el emblema como el texto que tiene debajo "Huellas de la Humanidad").
- Tipografía integrada en la imagen (Grande y de Alto Contraste): Debe incluir textualmente la directriz de tipografía grande y de alto contraste:
  'high-contrast, large and prominent typography overlay cleanly rendered with maximum legibility against the background: first line in smaller font "[Fecha, ej. 29 de septiembre]", second line in significantly larger prominent high-contrast bold font "[Hecho histórico]" (split into two lines if needed to comfortably fit the width and keep font noticeably large, bold, and high-contrast)'.
- Realismo y Estética Documental: Reconstrucción cinematográfica de época, iluminación dramática (chiaroscuro, candlelight, torchlight, ambient daylight), texturas auténticas, lentes analógicos, y directivas negativas estrictas: 'cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no additional text, no music'.
- Pregunta obligatoria de validación: Inmediatamente al pie del prompt generado, la IA formulará la siguiente pregunta: "Por favor genera y valida la imagen en tu motor de IA con este prompt y la imagen de referencia del logo. ¿La imagen generada cumple con tus expectativas y estás listo para proceder con la descripción completa?"
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la validación y confirmación de la imagen por parte del usuario. Queda terminantemente prohibido redactar la descripción o metadata en esta respuesta sin esperar la confirmación de la imagen.

ETAPA 4: GENERACIÓN DE LA DESCRIPCIÓN COMPLETA DE LA EFEMÉRIDE (HASTA 1200 CARACTERES EN INSTAGRAM)
Una vez que el usuario valide y apruebe la imagen generada, la IA redactará y entregará la metadata completa de publicación en formato "Todo Corrido", SIN TÍTULO (la entrega de post con imagen arranca directamente desde el Párrafo 1) y SIN encabezados de sección (recordando que para ninguna producción necesitamos el encabezado de las secciones de la metadata excepto el de los Capítulos:; cero "Descripción:", cero "Nota IA:", cero "Slogan:", cero "Hashtags:", cero "Comentario Fijado:"), calibrada para un máximo estricto de hasta 1200 caracteres en Instagram (o hasta 3000 caracteres en Facebook) medidos ininterrumpidamente DESDE el inicio del primer párrafo HASTA el final de los 5 hashtags:
1. Párrafo 1 de la Descripción (la publicación se entrega rigurosamente SIN TÍTULO y sin anteponer "Descripción:"; arranca directamente con el hecho histórico ocurrido en esta fecha, su impacto inmediato y el ambiente de aquel día).
2. Línea invisible con carácter braille (⠀).
3. Párrafo 2 de la Descripción (el contexto histórico profundo, figuras o protagonistas involucrados y detalles dramáticos o poco conocidos).
4. Línea invisible con carácter braille (⠀).
5. Párrafo 3 de la Descripción (el legado histórico de la efeméride, su huella en el presente y una reflexión envolvente).
6. Línea invisible con carácter braille (⠀).
7. Nota IA obligatoria directa (sin anteponer "Nota IA:", Escudo de IA exclusivo para imagen):
   (Nota: Esta imagen ha sido generada utilizando herramientas de inteligencia artificial basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
8. Línea invisible con carácter braille (⠀).
9. Slogan oficial de la marca directo (sin anteponer "Slogan:"):
   Cada historia deja una huella. Aquí seguimos sus rastros.
10. Línea invisible con carácter braille (⠀).
11. Exactamente 5 hashtags directos (sin anteponer "Hashtags:") en español y formato #CamelCase referentes a la efeméride, donde CADA UNO DE LOS 5 HASHTAGS DEBE ESTAR COMPUESTO OBLIGATORIAMENTE POR EXACTAMENTE DOS PALABRAS (ej. #EfemérideHistórica, #TalDía, #ImperioRomano, #EdadMedia, #HuellasHumanidad).
   (Aquí concluye estrictamente la contabilización de hasta 1200 caracteres en Instagram).
12. Línea invisible con carácter braille (⠀).
13. Comentario fijado directo (sin anteponer "Comentario Fijado:", CTA natural que invite a la audiencia a compartir qué conocían sobre este hecho histórico o su opinión sobre el acontecimiento, jamás pedir simplemente "dale like", sin etiqueta).
[/?SUB_OPCION_POST]

[?SUB_OPCION_POST=CONTROVERSIA]
PROTOCOLO SECUENCIAL DE EJECUCIÓN OBLIGATORIO: POST DE DEBATE Y CONTROVERSIA HISTÓRICA (IMAGEN 3:4 Y DESCRIPCIÓN - EN 4 ETAPAS POR SEPARADO)
La IA debe ejecutar obligatoriamente la producción del Post tipo Debate y Controversia (diseñado para polarizar opiniones fundamentadas, generar debate apasionado y máximo engagement en redes) en cuatro etapas separadas y secuenciales:

ETAPA 1: PROPUESTA Y SELECCIÓN DEL TEMA DE CONTROVERSIA (5 OPCIONES DE ALTO ENGAGEMENT)
Antes de redactar cualquier propuesta visual, prompt de imagen o descripción histórica, la IA DEBE PRESENTAR AL USUARIO EXACTAMENTE CINCO (5) OPCIONES DE TEMAS POLÉMICOS HISTÓRICOS:
- Enfoque de Engagement: Conflictos morales, paradojas éticas, juicios controvertidos, figuras históricas polarizantes (¿héroe o villano?), conspiraciones documentadas, mitos desmentidos o decisiones militares y políticas extremas de la historia humana.
- Cada opción debe detallar:
  1. Número de opción y Geolocalización con Tiempo: "Ciudad, País, Año" o "País, Año" o cualquier combinación coherente de estos tres (ej. "Londres, Inglaterra, 1888", "Roma, Italia, 44 a.C.", "Atenas, Grecia, 399 a.C.", "Francia, 1793").
  2. Titular polémico y planteamiento de las dos posturas históricas en conflicto.
  3. Propuesta exacta del texto para la imagen (con tipografía grande y de alto contraste):
     - Línea 1 (Ciudad/País/Año): Ej. "Londres, Inglaterra, 1888" o "Roma, Italia, 44 a.C.".
     - Línea 2 (Gancho polémico de controversia en fuente grande y de alto contraste): Pregunta o premisa provocadora (ej. "¿Héroe o Monstruo Despiadado?", "¿Justicia o Traición Imperial?", "¿Genio Militar o Tirano Sanguinario?"). Si es extenso, se divide en dos líneas manteniendo el font grande y visible.
  4. La pregunta detonante que polarizará la caja de comentarios.
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar a que el usuario elija cuál de las 5 opciones de controversia desea desarrollar (o sugiera otro tema polémico). Queda terminantemente prohibido generar prompts de Nano Banana 2.1 o descripciones completas sin que el usuario haya seleccionado su opción.

ETAPA 2: DESCRIPCIÓN VISUAL DE LA IMAGEN 3:4 Y CONFIRMACIÓN TIPOGRÁFICA DE ALTO CONTRASTE
Una vez seleccionado el tema de controversia por el usuario, la IA elaborará y presentará obligatoriamente:
1. Descripción visual conceptual y cinematográfica detallada de la imagen vertical en formato 3:4 para capturar la tensión psicológica, el dilema moral y el conflicto histórico con máximo impacto visual (rostro expresivo o escena de alta carga emocional, iluminación de claroscuro dramático, sombras envolventes y texturas orgánicas de época).
2. Confirmación exacta de las dos líneas de texto que se integrarán en la imagen (Fuente Grande y de Alto Contraste):
   - Primera línea (fuente tipográfica pequeña y nítida): "Ciudad, País, Año" o "País, Año" o combinación de estos tres con sentido histórico (ej. "Londres, Inglaterra, 1888").
   - Segunda línea (fuente tipográfica grande, destacada y de alto contraste respecto al fondo): El tema o gancho polémico de controversia. El font del texto en pantalla tiene que ser obligatoriamente grande y de alto contraste para garantizar lectura inmediata en el feed. Si el texto es largo, se divide en dos líneas para que quepa cómodamente manteniendo el font grande, prominente y de alto contraste.
3. Pregunta obligatoria de confirmación: "¿Apruebas esta propuesta visual y la diagramación del texto para proceder a generar el prompt técnico en inglés para Nano Banana 2.1?"
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la aprobación del usuario antes de redactar el prompt técnico.

ETAPA 3: GENERACIÓN Y VALIDACIÓN DEL PROMPT TÉCNICO DE LA IMAGEN 3:4 (NANO BANANA 2.1)
Una vez que el usuario apruebe la descripción visual y el texto, la IA generará EXCLUSIVAMENTE el prompt técnico en idioma inglés para Nano Banana 2.1, cumpliendo estrictamente con los siguientes estándares inquebrantables:
- Redacción técnica 100% en idioma inglés iniciando con: "Image [3:4]: Create an image " (o "Imagen [3:4]: Create an image ").
- Relación de aspecto vertical 3:4 (3:4 aspect ratio).
- Integración obligatoria del logo de la marca con su texto inferior: Debe incluir textualmente la especificación técnica 'small discreet 5% scale official page logo cleanly integrated in the top-left corner from provided reference image, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text' (manteniendo el logo oficial de la página proporcionado como imagen de referencia ubicado en la esquina superior izquierda a escala pequeña del 5%, exigiendo explícitamente renderizar con total nitidez tanto el emblema como el texto que tiene debajo "Huellas de la Humanidad").
- Tipografía integrada en la imagen (Grande y de Alto Contraste): Debe incluir textualmente la directriz de tipografía grande y de alto contraste:
  'high-contrast, large and prominent typography overlay cleanly rendered with maximum legibility against the background: first line in smaller font "[Ciudad, País, Año / País y Año]", second line in significantly larger prominent high-contrast bold font "[Tema polémico seleccionado]" (split into two lines if needed to comfortably fit the width and keep font noticeably large, bold, and high-contrast)'.
- Realismo y Estética Documental: Reconstrucción cinematográfica de época, iluminación dramática de claroscuro, tensión psicológica extrema, texturas auténticas, lentes analógicos, y directivas negativas estrictas: 'cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no additional text, no music'.
- Pregunta obligatoria de validación: Inmediatamente al pie del prompt generado, la IA formulará la siguiente pregunta: "Por favor genera y valida la imagen en tu motor de IA con este prompt y la imagen de referencia del logo. ¿La imagen generada cumple con tus expectativas y estás listo para proceder con la descripción completa?"
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la validación y confirmación de la imagen por parte del usuario. Queda terminantemente prohibido redactar la descripción o metadata en esta respuesta sin esperar la confirmación de la imagen.

ETAPA 4: GENERACIÓN DE LA DESCRIPCIÓN DE DEBATE Y CONTROVERSIA (HASTA 1200 CARACTERES EN INSTAGRAM)
Una vez que el usuario valide y apruebe la imagen generada, la IA redactará y entregará la metadata completa de publicación en formato "Todo Corrido", SIN TÍTULO (la entrega de post con imagen arranca directamente desde el Párrafo 1) y SIN encabezados de sección (recordando que para ninguna producción necesitamos el encabezado de las secciones de la metadata excepto el de los Capítulos:; cero "Descripción:", cero "Nota IA:", cero "Slogan:", cero "Hashtags:", cero "Comentario Fijado:"), calibrada para un máximo estricto de hasta 1200 caracteres en Instagram (o hasta 3000 caracteres en Facebook) medidos ininterrumpidamente DESDE el inicio del primer párrafo HASTA el final de los 5 hashtags:
1. Párrafo 1 de la Descripción (la publicación se entrega rigurosamente SIN TÍTULO y sin anteponer "Descripción:"; arranca directamente planteando la polémica histórica, el dilema moral y el choque de perspectivas sobre el acontecimiento o personaje).
2. Línea invisible con carácter braille (⠀).
3. Párrafo 2 de la Descripción (contexto documental profundo, evidencia histórica contrastada y las contradicciones que dividen a historiadores y a la opinión pública).
4. Línea invisible con carácter braille (⠀).
5. Párrafo 3 de la Descripción (el impacto de esta controversia en la posteridad y la pregunta abierta para que la audiencia tome postura).
6. Línea invisible con carácter braille (⠀).
7. Nota IA obligatoria directa (sin anteponer "Nota IA:", Escudo de IA exclusivo para imagen):
   (Nota: Esta imagen ha sido generada utilizando herramientas de inteligencia artificial basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
8. Línea invisible con carácter braille (⠀).
9. Slogan oficial de la marca directo (sin anteponer "Slogan:"):
   Cada historia deja una huella. Aquí seguimos sus rastros.
10. Línea invisible con carácter braille (⠀).
11. Exactamente 5 hashtags directos (sin anteponer "Hashtags:") en español y formato #CamelCase referentes a la controversia histórica, donde CADA UNO DE LOS 5 HASHTAGS DEBE ESTAR COMPUESTO OBLIGATORIAMENTE POR EXACTAMENTE DOS PALABRAS (ej. #DebateHistórico, #ImperioRomano, #EdadMedia, #MisterioHistórico, #JuicioMoral).
   (Aquí concluye estrictamente la contabilización de hasta 1200 caracteres en Instagram).
12. Línea invisible con carácter braille (⠀).
13. Comentario fijado directo (sin anteponer "Comentario Fijado:", CTA provocador y natural de debate que invite a la audiencia a argumentar su veredicto o postura en comentarios, sin pedir "dale like", sin etiqueta).
[/?SUB_OPCION_POST]
- ASISTENCIA POST-PRODUCCIÓN PARA RESPONDER COMENTARIOS DE LA AUDIENCIA (CAPTURAS DE PANTALLA O TEXTO): Después de toda la producción y entrega de la descripción, el usuario irá enviándole a la IA capturas de pantalla (imágenes) o texto de los comentarios de la audiencia en la publicación para que la IA le ayude a responderlos de forma CERTERA y CONCISA (respuestas breves de 1 a 3 oraciones, con rigor histórico verificable, listas para copiar y pegar).
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=REELS]
PROTOCOLO SECUENCIAL DE EJECUCIÓN OBLIGATORIO: REELS (12 ETAPAS POR SEPARADO):
Este formato corresponde a un video cinematográfico ([?SUB_OPCION_REELS=9X16]vertical 9:16[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal 16:9[/?SUB_OPCION_REELS]) con duración aproximada definida por el usuario (la duración total no tiene que ser exacta, sino aproximada a la pedida). [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]La arquitectura de audio y video inicial es estricta: los primeros [DURACION_CLIP_1_RALENTIZADO] segundos de video no llevan voz en off (el primer clip [Clip 1 de [DURACION_CLIP_1] segundos, 00:00 - 00:[DURACION_CLIP_1_PAD]] es un hook de puro impacto sensorial visual y Foley sin voz, y los primeros 2 segundos del Clip 2 [00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]] se mantienen igualmente sin voz con exclusivo Foley). La locución narrativa (voz en off) entra obligatoriamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video (que sería el segundo 2 del segundo clip / a los 2 segundos de iniciar el Clip 2) y fluye de forma continua hasta el final.[/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]La arquitectura de audio y video inicial es estricta: los primeros [DURACION_CLIP_1_RALENTIZADO] segundos de video no llevan voz en off (cubiertos por el Clip 1 de [DURACION_CLIP_1]s cuya velocidad se reduce en edición para llevarlo a [DURACION_CLIP_1_RALENTIZADO] segundos [00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]] con puro Foley ambiental). La locución narrativa (voz en off) entra obligatoriamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video (inmediatamente al comenzar el Clip 2 de [?DURACION_CLIPS=10_SEGUNDOS][RAL_CLIP2_RANGE_10S][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS][RAL_CLIP2_RANGE_8S][/?DURACION_CLIPS]) y fluye de forma continua hasta el final.[/?SINCRONIZACION_CLIP_1] Por lo tanto, la duración total del video es aproximada a la duración pedida por el usuario, componiéndose de los [DURACION_CLIP_1_RALENTIZADO] segundos iniciales sin voz más el tiempo de duración de la voz en off (Duración Total Aproximada ≈ [DURACION_CLIP_1_RALENTIZADO]s + Tiempo de Voz en Off; es decir, Tiempo de Voz en Off ≈ Duración Total Pedida - [DURACION_CLIP_1_RALENTIZADO]s). La IA debe ejecutar obligatoriamente la producción en doce etapas separadas y secuenciales:

ETAPA 1: SELECCIÓN DEL TEMA Y TIPOLOGÍA[#YOUTUBE_VIRAL_ANALYSIS] + ANÁLISIS PROFUNDO, MINUCIOSO, DETALLADO, INCISIVO E INTENSO DEL VIDEO VIRAL DE YOUTUBE ([YOUTUBE_VIRAL_LINK])[/YOUTUBE_VIRAL_ANALYSIS]
[#YOUTUBE_VIRAL_ANALYSIS]
- OBLIGACIÓN PRIORITARIA EN ESTA ETAPA 1 (ANÁLISIS VIRAL DETALLE POR DETALLE SIN OBVIAR NADA): Antes de pasar a cualquier otra etapa, analiza profunda, minuciosa, detallada, incisiva e intensamente el video de YouTube proporcionado en el enlace [YOUTUBE_VIRAL_LINK], detalle por detalle y sin obviar absolutamente nada (Hook de primeros segundos, escaleta minuto a minuto, micro-ganchos de retención, gatillos psicológicos de viralidad, ritmo del guion, dirección visual/sonora y empaque), explicando con exactitud cómo se hizo viral en la plataforma y presentando el plano exacto para recrear esa misma estructura en nuestro video.
[/YOUTUBE_VIRAL_ANALYSIS]
Antes de redactar la duración, voz en off, clips o metadata, la IA DEBE PREGUNTAR OBLIGATORIAMENTE AL USUARIO qué tema o tipología histórica abordará este video de Reels. Preséntale las siguientes opciones y dale la oportunidad de elegir una o sugerir otras:
1. Un suceso histórico
2. Un lugar histórico
3. Un personaje
4. Un misterio sin resolver
5. Un true crime
6. Una conciencia o realidad colectiva
7. Una manipulación psicológica
8. Una curiosidad
9. O sugerir otras opciones creativas según la temática.
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la respuesta y confirmación del usuario con el tema elegido antes de avanzar. No pases a la siguiente etapa ni generes contenido hasta recibir esta confirmación.

ETAPA 2: DEFINICIÓN DE LA DURACIÓN APROXIMADA DEL VIDEO
Una vez confirmado el tema por el usuario, la IA DEBE PREGUNTAR OBLIGATORIAMENTE AL USUARIO LA DURACIÓN APROXIMADA DESEADA PARA EL VIDEO (aclarando que la duración total no tiene que ser exacta al segundo, sino aproximada a la pedida).
Explícale al usuario la arquitectura de tiempos:
[?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]
- Los primeros [DURACION_CLIP_1_RALENTIZADO] segundos de video NO llevan voz en off (Clip 1 de [DURACION_CLIP_1]s completo sin voz [00:00 - 00:[DURACION_CLIP_1_PAD]] + los primeros 2 segundos del Clip 2 sin voz [00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]], con exclusivo diseño sonoro Foley ambiental).
- La voz en off entra obligatoriamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video (que sería el segundo 2 del segundo clip / a los 2 segundos de iniciar el Clip 2) y fluye de forma continua hasta el final.
[/?SINCRONIZACION_CLIP_1]
[?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]
- Los primeros [DURACION_CLIP_1_RALENTIZADO] segundos de video NO llevan voz en off (cubiertos por el Clip 1 de [DURACION_CLIP_1]s ralentizado en edición a [DURACION_CLIP_1_RALENTIZADO]s [00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]], con puro Foley ambiental).
- La voz en off entra obligatoriamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video (inmediatamente al iniciar el Clip 2 de [?DURACION_CLIPS=10_SEGUNDOS][RAL_CLIP2_RANGE_10S][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS][RAL_CLIP2_RANGE_8S][/?DURACION_CLIPS]) y fluye de forma continua hasta el final.
[/?SINCRONIZACION_CLIP_1]
- La duración total no tiene que ser exacta, sino aproximada a la pedida (Duración Total Aproximada ≈ [DURACION_CLIP_1_RALENTIZADO] segundos iniciales sin voz + Tiempo de la Voz en Off).
Preséntale opciones sugeridas de duración aproximada y dale la opción de indicar cualquier otra duración:
[?DURACION_CLIPS=10_SEGUNDOS]
1. ~35 a 40 segundos aprox. (Clip 1 de [DURACION_CLIP_1]s + ~3 clips de 10s / ~450 caracteres de voz en off)
2. ~45 a 50 segundos aprox. (Clip 1 de [DURACION_CLIP_1]s + ~4 clips de 10s / ~600 caracteres de voz en off)
3. ~55 a 60 segundos / 1 min aprox. (Clip 1 de [DURACION_CLIP_1]s + ~5 clips de 10s / ~750-800 caracteres de voz en off)
4. ~65 a 70 segundos aprox. (Clip 1 de [DURACION_CLIP_1]s + ~6 clips de 10s / ~900 caracteres de voz en off)
5. ~75 a 80 segundos aprox. (Clip 1 de [DURACION_CLIP_1]s + ~7 clips de 10s / ~1050 caracteres de voz en off)
6. ~90 segundos / 1:30 min aprox. (Clip 1 de [DURACION_CLIP_1]s + ~8 clips de 10s / ~1200 caracteres de voz en off)
7. ~120 segundos / 2 min aprox. (Clip 1 de [DURACION_CLIP_1]s + ~11 clips de 10s / ~1650-1700 caracteres de voz en off)
8. ~180 segundos / 3 min aprox. (Clip 1 de [DURACION_CLIP_1]s + ~17 clips de 10s / ~2550 caracteres de voz en off)
[/?DURACION_CLIPS]
[?DURACION_CLIPS=8_SEGUNDOS]
1. ~35 a 40 segundos aprox. (Clip 1 de [DURACION_CLIP_1]s + ~4 clips de 8s / ~450 caracteres de voz en off)
2. ~45 segundos aprox. (Clip 1 de [DURACION_CLIP_1]s + ~5 clips de 8s / ~570 caracteres de voz en off)
3. ~55 a 60 segundos / 1 min aprox. (Clip 1 de [DURACION_CLIP_1]s + ~6 a 7 clips de 8s / ~700-810 caracteres de voz en off)
4. ~70 a 75 segundos aprox. (Clip 1 de [DURACION_CLIP_1]s + ~8 a 9 clips de 8s / ~930-1050 caracteres de voz en off)
5. ~85 a 90 segundos / 1:30 min aprox. (Clip 1 de [DURACION_CLIP_1]s + ~10 a 11 clips de 8s / ~1170-1290 caracteres de voz en off)
6. ~120 segundos / 2 min aprox. (Clip 1 de [DURACION_CLIP_1]s + ~14 clips de 8s / ~1650-1710 caracteres de voz en off)
7. ~180 segundos / 3 min aprox. (Clip 1 de [DURACION_CLIP_1]s + ~21 a 22 clips de 8s / ~2550 caracteres de voz en off)
[/?DURACION_CLIPS]
9. O especificar cualquier otra duración aproximada en segundos o minutos que el usuario prefiera.
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar a que el usuario indique la duración aproximada elegida antes de avanzar a la Etapa 3 (Recuento Estructural de Secciones, Datos Insólitos, Curiosidades y Contradicciones Históricas[?SUB_OPCION_REELS=16X9] + Prompt Maestro para Desarrollar Investigación Profunda por Fuera[/?SUB_OPCION_REELS]). No redactes el guion de locución ni avances de etapa sin confirmación.

ETAPA 3: RECUENTO ESTRUCTURAL DE SECCIONES, DATOS INSÓLITOS, CURIOSIDADES Y CONTRADICCIONES HISTÓRICAS[?SUB_OPCION_REELS=16X9] + PROMPT PARA DESARROLLAR INVESTIGACIÓN PROFUNDA POR FUERA[/?SUB_OPCION_REELS]
Una vez confirmados el tema y la duración aproximada del video por parte del usuario (y ANTES de redactar el guion de la voz en off), la IA DEBE PRESENTAR OBLIGATORIAMENTE UN RECUENTO ESTRUCTURAL Y DE FONDO HISTÓRICO DEL DOCUMENTAL[?SUB_OPCION_REELS=16X9] JUNTO CON UN PROMPT MAESTRO PARA DESARROLLAR UNA INVESTIGACIÓN PROFUNDA POR FUERA[/?SUB_OPCION_REELS] que servirá de brújula analítica y matriz narrativa para toda la producción audiovisual posterior. Este entregable debe estructurarse de forma clara, densa y fascinante en los siguientes bloques:

1. Escaleta y Desglose de Secciones del Documental (Adaptada a la Duración Aproximada Elegida[#YOUTUBE_VIRAL_ANALYSIS] y Recreando Exactamente la Estructura del Video Viral de YouTube [YOUTUBE_VIRAL_LINK][/YOUTUBE_VIRAL_ANALYSIS]):
[#YOUTUBE_VIRAL_ANALYSIS]
   - REGLA DE RECREACIÓN ESTRUCTURAL VIRAL: Esta escaleta debe recrear con exactitud milimétrica la misma estructura narrativa, ritmo de bloques, cadencia de micro-ganchos y progresión de tensión extraída en el análisis profundo del video viral ([YOUTUBE_VIRAL_LINK]), adaptada a la duración aproximada elegida y a las leyes de Huellas de la Humanidad.
[/YOUTUBE_VIRAL_ANALYSIS]
   La IA debe desglosar la progresión narrativa del video en sus secciones clave según la duración aproximada confirmada en la Etapa 2:
   - Sección 1: Apertura / Hook Visual y Sensorial (00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD] sin voz en off, puro diseño sonoro Foley de máxima tensión; la voz narrativa arranca en el segundo [DURACION_CLIP_1_RALENTIZADO] [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2][que es el segundo 2 del segundo clip / a los 2 segundos de iniciar el Clip 2][/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT][al iniciar el Clip 2][/?SINCRONIZACION_CLIP_1] anclando obligatoriamente Tiempo y Lugar completos cerrando con punto, seguido de la descripción breve y gancho perturbador).
   - Sección 2: Conflicto y Promesa Narrativa (~segundos 20-30): Planteamiento del dilema o enigma y ubicación del Slogan Completo oficial en párrafo aparte antes del segundo 30 de metraje (el clip que cubre la parte donde la voz narrativa dice el Slogan Completo al principio debe ser obligatoriamente una escena de una mesa de un historiador antiguo llena de objetos antiguos, además de pergaminos, plumas de escritura, bote de tinta, entre otros).
   - Sección 3: Desarrollo Histórico Inmersivo y Tensión Modular: Evolución cronológica y contextual del suceso o figura histórica, articulando micro-ganchos de intriga cada 90 segundos para que el espectador nunca lo sepa todo prematuramente.
   - Sección 4: Clímax, Revelación o Punto de No Retorno: El momento de mayor impacto emocional, giro histórico o desenlace inevitable.
   - Sección 5: Cierre Reflexivo y Escena Panorámica Amplia: Conclusión con llamado natural a la audiencia ("Déjanos saber en los comentarios..."), el Slogan Corto oficial ("Cada historia deja una huella. Aquí seguimos sus rastros.") en párrafo aparte, y para el último clip del video una escena panorámica amplia y rica visualmente (quedando prohibido poner un objeto close-up en el último clip).

2. Datos Insólitos y Cifras de Alto Impacto:
   Una selección rigurosa de hechos insólitos, estadísticas documentadas, registros de archivo, detalles forenses o sucesos anómalos poco conocidos sobre el tema que desmitifiquen la versión simplista de la historia y causen asombro inmediato.

3. Curiosidades Históricas y Textura Sensorial:
   Anécdotas verídicas de la época, costumbres cotidianas, rituales, tecnologías arcaicas, texturas, olores, alimentación o vestimenta que enriquecerán tanto el tono del relato como los detalles del diseño visual de Nano Banana 2.1 y del diseño de sonido Foley en Omni Flash.

4. Contradicciones Históricas y Paradojas Morales:
   La contradicción central, la ironía histórica o la paradoja moral irresoluble que rodea al acontecimiento o a los protagonistas (el conflicto de fondo que mantendrá la intriga activa del espectador de principio a fin, evitando un relato plano o meramente enciclopédico).

5. Dilemas Abiertos y Puntos de Debate:
   Interrogantes abiertas, enigmas no resueltos o interpretaciones históricas encontradas que motiven el debate orgánico de la audiencia en la sección de comentarios del video.
[?SUB_OPCION_REELS=16X9]
6. Prompt Maestro para Desarrollar una Investigación Profunda por Fuera (Obligatorio en Reels Largos Horizontales 16:9):
   Además de los 5 bloques anteriores, en las producciones de Reels largos horizontales (16:9) la IA DEBE GENERAR OBLIGATORIAMENTE UN PROMPT MAESTRO DE INVESTIGACIÓN PROFUNDA EXTERNA (Deep Research Prompt), listo para que el usuario lo copie, lo ejecute por fuera (en herramientas de investigación profunda como Gemini Deep Research, Perplexity, ChatGPT Deep Research o Google NotebookLM) y luego pegue o comparta toda esa información en esta conversación para utilizarla íntegramente en el video. Este prompt de investigación profunda externa debe estar diseñado a la medida exacta del tema y de la duración acordada, exigiendo investigar exhaustivamente:
   - Rastreo y contraste de fuentes históricas primarias (crónicas, cartas, edictos, registros arqueológicos o forenses) y fuentes académicas secundarias de alto rigor.
   - Cronología milimétrica y verificada de los sucesos sin anacronismos (con años en dígitos numéricos, siglos en números romanos y nombres con número en números romanos, ej. Felipe II Augusto).
   - Fichas biográficas, fisonómicas y psicológicas de los personajes principales (@Personas): edad exacta durante los hechos, rasgos físicos reales documentados, indumentaria precisa de la época y motivaciones ocultas.
   - Datos insólitos verificados, estadísticas, micro-detalles cotidianos, mitos populares desmentidos y secretos poco conocidos que eleven la retención del documental.
   - Reconstrucción sensorial, material, arquitectónica y geográfica del entorno (texturas, iluminación de época, clima, objetos, armas, vestimenta y atmósfera acústica Foley) para nutrir con precisión histórica los prompts de Nano Banana 2.1 y Omni Flash.
   - Contradicciones históricas centrales, paradojas morales y puntos de giro dramático para sostener los micro-ganchos narrativos cada 90 segundos a lo largo de todo el metraje.
   Al final de este bloque 6, la IA incluirá el siguiente mensaje para el usuario:
   "Copia y ejecuta este Prompt de Investigación Profunda por fuera y pégame aquí toda la información resultante (o confírmame cuando la tengas lista) para usar toda esa información en la redacción del guion de la voz en off (Etapa 4), en el modelado de personajes, en las escenas visuales del video y en la metadata."
[/?SUB_OPCION_REELS]

-> ALTO INQUEBRANTABLE: La IA entrega exclusivamente este recuento estructural de secciones, datos insólitos, curiosidades, contradicciones y dilemas históricos[?SUB_OPCION_REELS=16X9] junto con el Prompt Maestro para desarrollar la Investigación Profunda por fuera[/?SUB_OPCION_REELS], y concluye su respuesta deteniéndose por completo. Espera la confirmación, visto bueno[?SUB_OPCION_REELS=16X9] y la información obtenida de la investigación profunda externa que el usuario pegue o comparta[/?SUB_OPCION_REELS] antes de pasar a la redacción del guion de la voz en off (Etapa 4). Queda terminantemente prohibido redactar el guion de locución, generar prompts de referencia o avanzar de etapa sin la aprobación explícita del usuario.

ETAPA 4: GUION DE LA VOZ EN OFF (CALCULADA SEGÚN LA DURACIÓN APROXIMADA[?SUB_OPCION_REELS=16X9] Y NUTRIDA CON LA INVESTIGACIÓN PROFUNDA EXTERNA[/?SUB_OPCION_REELS])
Una vez validada la Etapa 3 por el usuario[?SUB_OPCION_REELS=16X9] y recibida la información de la investigación profunda realizada por fuera, la IA DEBE USAR E INTEGRAR OBLIGATORIAMENTE TODA ESA INFORMACIÓN DE LA INVESTIGACIÓN PROFUNDA (incorporando sus datos verificados, cronología exacta, hallazgos, curiosidades, contradicciones, detalles sensoriales y perfiles históricos tanto en el guion de locución como posteriormente en los modelos @Personas, en los clips de video y en la descripción) y[/?SUB_OPCION_REELS] la IA redactará EXCLUSIVAMENTE el guion completo de la voz narrativa (voiceover):
- Regla Fundamental de Audio (Entrada de Voz en el Segundo [DURACION_CLIP_1_RALENTIZADO]): Los primeros [DURACION_CLIP_1_RALENTIZADO] segundos de video NO llevan voz en off bajo ningún concepto ([?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]Clip 1 de [DURACION_CLIP_1]s completo sin voz [00:00 - 00:[DURACION_CLIP_1_PAD]] + primeros 2 segundos del Clip 2 sin voz [00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]][/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]Clip 1 de [DURACION_CLIP_1]s llevado a [DURACION_CLIP_1_RALENTIZADO]s en edición [00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]][/?SINCRONIZACION_CLIP_1], con Foley ambiental puro). La locución entra obligatoriamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video ([?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]que sería el segundo 2 del segundo clip / a los 2 segundos de iniciar el Clip 2[/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]inmediatamente al inicio del Clip 2[/?SINCRONIZACION_CLIP_1]) y fluye de forma continua hasta el final.
- Cálculo de Duración Aproximada, Pausas y Extensión (Tasa Calibrada de ~15 caracteres/segundo / ~900 caracteres/minuto — Duración Aproximada a la Pedida):
  * Regla de Duración Total Aproximada: La duración total del video y de la locución NO tiene que ser exacta al segundo, sino aproximada a la duración pedida por el usuario, priorizando siempre un desarrollo y cierre narrativo natural, orgánico y completo.
  * Tiempo Aproximado de la Pista de Locución ≈ Duración Total Pedida - [DURACION_CLIP_1_RALENTIZADO] segundos iniciales sin voz.
  * Tiempo de Pausas Narrativas = Suma total de todas las etiquetas [pausa: Xs] insertadas por la IA en el guion (en segundos).
  * Tiempo Neto Aproximado de Voz Hablada ≈ Tiempo de la Pista de Locución - Tiempo de Pausas Narrativas.
  * Tasa de Lectura Calibrada: ~15 caracteres por segundo de voz hablada incluyendo los espacios ([?DURACION_CLIPS=10_SEGUNDOS]~150 caracteres por cada 10 segundos de locución continua[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]~120 caracteres por cada 8 segundos de locución continua[/?DURACION_CLIPS]; equivalente a ~900 caracteres por minuto).
  * Extensión Aproximada del Guion (Texto Hablado, excluyendo las etiquetas [pausa: Xs]): Se estima mediante la referencia:
    Caracteres del Guion (texto hablado) ≈ Tiempo Neto de Voz Hablada x 15 caracteres con espacios.
    (Ejemplo orientativo: Video de ~120s -> ~[DURACION_CLIP_1_RALENTIZADO]s sin voz + ~112-114s de pista de locución. Si la IA determina e inserta ~8s de pausas en total, el Tiempo Neto de Voz Hablada es ~104-106s -> Caracteres del Guion ≈ 1560-1650 caracteres con espacios de texto hablado; la duración total no tiene que ser exacta sino aproximada a la pedida).
  * Reporte Obligatorio al Pie del Guion (Caracteres, Pausas y Duración Total Estimada): Al finalizar la entrega del guion, la IA debe indicar obligatoriamente el recuento en el siguiente formato literal:
    Caracteres Totales (texto hablado): [número] ([número] caracteres por minuto)
    Pausas Narrativas: [cantidad de pausas] ([segundos totales de pausas]s de pausa total)
    Duración Total Estimada de Locución: [MM:SS] (Voz hablada: [MM:SS] + Pausas: [segundos]s)
    (mostrando justo al lado de Caracteres Totales cuántos caracteres por minuto de voz hablada representa: 900 caracteres por minuto).
- Hook de Inicio Obligatorio (Estructura de Apertura al Segundo [DURACION_CLIP_1_RALENTIZADO] / [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]Segundo 2 del Clip 2[/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]Inicio de Clip 2[/?SINCRONIZACION_CLIP_1]): La locución arranca obligatoriamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video ([?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]que sería el segundo 2 del segundo clip / a los 2 segundos de haber iniciado el Clip 2[/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]inmediatamente al inicio del Clip 2[/?SINCRONIZACION_CLIP_1]) y su frase inicial DEBE ESTRUCTURARSE DE FORMA INNEGOCIABLE EN LA SIGUIENTE TRÍADA SECUENCIAL:
  1. Tiempo: Año o fecha exacta, con todos los años escritos obligatoriamente en números / dígitos y los siglos obligatoriamente en números romanos (ej. siglo XII, siglo XIX). Regla de "Año [número]": Si la referencia temporal al principio es únicamente el año (sin mes, día o estación), debe comenzar obligatoriamente con la palabra "Año" seguida del número (ej. "Año 1888", "Año 44 antes de Cristo"). Si incluye mes, día o estación (ej. "Invierno de 1789", "Mayo de 1943", "15 de marzo de 44 antes de Cristo"), se formula directamente sin anteponer "Año".
  2. Lugar, Ciudad y País: Anclaje geográfico completo especificando el lugar concreto, la ciudad y el país, mencionando el lugar ACTO SEGUIDO del año sin anteponer "en el" ni preposiciones de relleno (ej. "callejón de Whitechapel, Londres, Inglaterra", "Plaza de la Concordia, París, Francia", "profundidades del Mar del Norte, Noruega"). Queda terminantemente prohibido escribir "en el" después del año.
  * REGLA INQUEBRANTABLE DE CIERRE DE ORACIÓN TRAS TIEMPO Y LUGAR: Al principio de la voz en off, JUSTO DESPUÉS DEL TIEMPO Y EL LUGAR COMPLETO (Ciudad y País), LA VOZ NARRATIVA DEBE CERRAR OBLIGATORIAMENTE LA PRIMERA ORACIÓN CON UN PUNTO (.) Y COMENZAR UNA NUEVA ORACIÓN con letra inicial mayúscula para la descripción breve y gancho intrigante (ejemplo obligatorio: "Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba un cazador nocturno que la policía jamás atrapó.", "Año 44 antes de Cristo, Curia de Pompeyo, Roma, Italia. El senado donde se fraguaba la traición más célebre de la antigüedad."). Queda terminantemente prohibido unir el lugar con la descripción usando una coma.
  3. Descripción Breve: Comenzando obligatoriamente como una nueva oración tras el punto que cierra el tiempo y lugar, una descripción breve, directa y fascinante del lugar, suceso histórico, personaje o temática de la que trate el video (ej. "El laberinto donde operaba un cazador nocturno que la policía jamás atrapó.", "El escenario sangriento donde una multitud enfurecida derrocó una monarquía milenaria.", "El médico militar que desafió las órdenes del estado mayor."), enlazando inmediatamente con la premisa intrigante, perturbadora o revelación que detenga el scroll al instante.
- Slogan Completo Oficial y Promesa en Párrafo Aparte Antes del Segundo 30 de Video (~segundos 20–30): Antes del segundo 30 de video (~segundos 20–30 de metraje), TODO el bloque del Slogan Completo (desde "En los próximos minutos..." hasta "...Aquí seguimos sus rastros.") DEBE COLOCARSE OBLIGATORIAMENTE EN UN PÁRRAFO APARTE dentro del guion de locución, estructurado internamente en tres partes secuenciales unificadas:
  1. Comienza obligatoria y literalmente con la frase: "En los próximos minutos..."
  2. Justo entre "En los próximos minutos..." y la llamada a la acción, va la EXPLICACIÓN BREVE de lo que estará pasando en el documental (el enigma histórico, el conflicto, la tensión o los hechos que el espectador descubrirá si se queda hasta el final; ej. "En los próximos minutos descubrirás cómo una sola decisión militar selló el destino de todo un imperio...", "En los próximos minutos revelaremos el enigma que la policía victoriana jamás pudo resolver...").
  3. Inmediatamente a continuación de dicha explicación breve, se integra de forma continua la llamada y cierre oficial de la marca: "Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros."
  (Estructura obligatoria de párrafos en el guion de voz en off:
  [Párrafo 1 - Hook inicial y contexto]: "Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba un cazador nocturno que la policía jamás atrapó..."

  [Párrafo 2 - Párrafo aparte completo exclusivo para el Slogan Completo antes del segundo 30]: "En los próximos minutos [explicación breve de lo que estará pasando en el documental]. Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros."

  [Párrafo 3 - Desarrollo de la historia principal]: Desarrollo cronológico y temático con micro-ganchos cada 90 segundos...

  [Párrafo final - Cierre en párrafo aparte]: "Déjanos saber en los comentarios... Cada historia deja una huella. Aquí seguimos sus rastros.").
- Micro-ganchos cada 90 Segundos: El espectador no puede saberlo todo en el minuto 2; en producciones de 90 segundos o más, cada sección debe plantear una nueva interrogante antes de resolver la anterior, manteniendo un ciclo de intriga continuo a lo largo de todo el metraje.
- Cierre Obligatorio de la Locución con Llamada a Comentarios y Slogan Corto en Párrafo Aparte: Antes del slogan del cierre de la voz narrativa, la locución debe incluir obligatoriamente la frase: "Déjanos saber en los comentarios..." (pudiendo formularse textualmente con los puntos suspensivos o completarse de forma orgánica con una pregunta o reflexión breve sobre el enigma o suceso histórico tratado, ej. "Déjanos saber en los comentarios qué piensas sobre este suceso. Cada historia deja una huella. Aquí seguimos sus rastros." o "Déjanos saber en los comentarios... Cada historia deja una huella. Aquí seguimos sus rastros."). La locución culmina obligatoriamente pronunciando como frase final de cierre el slogan corto oficial: "Cada historia deja una huella. Aquí seguimos sus rastros." Todo este bloque de cierre ("Déjanos saber en los comentarios..." + slogan corto oficial) DEBE COLOCARSE OBLIGATORIAMENTE SEPARADO EN UN PÁRRAFO APARTE al final del guion de locución, y sus caracteres se contabilizan dentro de la extensión matemática del guion.
- Regla Estricta de Años en Número y Cantidades de Miles/Millones como "70 mil": Todos los años deben escribirse obligatoriamente en números / dígitos (ej. 1888, 1789, 1943), quedando totalmente prohibido escribirlos en letras o palabras completas (prohibido escribir "mil ochocientos ochenta y ocho"). Asimismo, cuando se haga el texto de la voz narrativa, todos los números o cantidades en miles o millones como "setenta mil", "diez mil", "trescientos mil", "dos millones" deben entregarse SIEMPRE Y OBLIGATORIAMENTE con el número en dígitos seguido de la palabra "mil" o "millones" (ej. "70 mil", "10 mil", "300 mil", "2 millones", "1 millón"), quedando terminantemente prohibido escribir el número en letras (prohibido escribir "setenta mil", "diez mil") o escribir todos los ceros en cifras ("70,000", "70.000", "70000"). Esta norma rige tanto para el guion de la voz narrativa como para los captions .srt y la metadata.
- Regla Estricta de Siglos y Nombres con Número en Números Romanos: Tanto en el guion de la voz en off como en textos en pantalla, prompts, títulos y descripciones, TODOS los siglos deben escribirse obligatoriamente en números romanos con mayúsculas (ej. siglo XII, siglo XIX, siglo V antes de Cristo, siglo XXI), quedando terminantemente prohibido escribirlos en palabras (prohibido escribir "siglo doce", "siglo diecinueve") o en números arábigos (prohibido "siglo 12", "siglo 19"). Asimismo, todos los nombres propios históricos que lleven número (monarcas, reyes, emperadores, papas, faraones o dinastías, tales como Felipe II Augusto, Luis XIV, Enrique VIII, Carlos V, Alfonso X, Juan Pablo II, Pío XII, Ramsés II, Isabel I) deben escribirse SIEMPRE Y OBLIGATORIAMENTE en números romanos (ej. "Felipe II Augusto"), quedando terminantemente prohibido escribir el número en palabras (prohibido escribir "Felipe Segundo Augusto", "Luis Catorce", "Enrique Octavo") o en dígitos arábigos (prohibido "Felipe 2 Augusto").
- Regla Estricta de 'antes de Cristo' y 'después de Cristo' en la Voz en Off: En el guion de voz en off / locución, queda terminantemente prohibido utilizar siglas o abreviaturas como 'a.C.' o 'd.C.'; deben escribirse obligatoriamente en palabras completas: "antes de Cristo" y "después de Cristo" (ej. "44 antes de Cristo", "año 27 antes de Cristo", "siglo V antes de Cristo", manteniendo el año en número y el siglo en números romanos, pero la era en palabras para una pronunciación natural y perfecta en el motor TTS).
- Tono documental inmersivo, periodístico, sobrio y cinematográfico.
- Perfil de la Voz Narrativa (Voz Masculina Documental Cinematográfica): La locución está concebida obligatoriamente para una voz masculina profunda, solemne, sobria, autoritaria y cinematográfica de historiador de élite en idioma español neutro.
- Inserción Inteligente y Estratégica de Pausas Narrativas ([pausa: Xs] o [pausa: X.Ys]): La IA debe determinar y colocar de manera inteligente, justificada y cinematográfica etiquetas explícitas de pausa [pausa: Xs] (ej. [pausa: 1s], [pausa: 1.5s], [pausa: 2s], [pausa: 2.5s]) dentro del texto de la voz narrativa, las cuales son procesadas por el sintetizador VoxFlow para insertar silencios limpios y matemáticamente exactos sin pronunciar la palabra "pausa" ni las etiquetas. Queda terminantemente prohibido usar barras diagonales o formatos informales (/2s, /#s); debe usarse estrictamente la sintaxis [pausa: Xs] o [pausa: X.Ys]. La IA determinará la ubicación y duración de cada pausa según la dramaturgia, el ritmo y las escenas bajo las siguientes pautas:
  1. Revelaciones impactantes y giros dramáticos ([pausa: 1.5s] a [pausa: 2s]): Inmediatamente tras revelar un dato demoledor, una cifra sobrecogedora o una verdad oculta, para que el peso psicológico de la revelación cale hondo en el espectador antes de continuar el relato.
  2. Transiciones de escena, cambios de escenario o saltos temporales ([pausa: 1s] a [pausa: 2s]): Al concluir el relato en una locación o época y saltar a otro escenario, marcando un corte cinematográfico en el timeline sonoro.
  3. Momentos de misterio, máxima tensión o preguntas retóricas ([pausa: 1s] a [pausa: 1.5s]): Antes o después de formular una interrogante intrigante o antes de revelar un desenlace crítico.
  4. Antes del Slogan Completo Oficial (~segundos 20–30) ([pausa: 1s] a [pausa: 1.5s]): Justo antes de comenzar el párrafo independiente de "En los próximos minutos...", separando con elegancia el gancho inicial de la promesa de la marca.
  5. Antes del Cierre y Slogan Corto Final ([pausa: 1.5s] a [pausa: 2s]): Inmediatamente antes de "Déjanos saber en los comentarios..." o entre este y el lema oficial de cierre "Cada historia deja una huella. Aquí seguimos sus rastros.", otorgando solemnidad y peso institucional al final del video.
- Voz narrativa en tercera persona (Prohibido hablar en "nosotros"): La voz en off no debe hablar en primera persona del plural ("nosotros", "caminamos", "vemos", "nos encontramos", "nuestra historia"). La locución debe limitarse a narrar los hechos y la historia de forma directa, objetiva y cinematográfica en tercera persona.
- Referencias naturales a las personas (Cero anonimización forzada): No es necesario ni se debe decir "x tipo de persona o profesión anónimos" (ej. "campesinos anónimos", "un soldado anónimo", "testigos anónimos") ni emplear fórmulas artificiales para intentar anonimizar a las figuras históricas. Nombra a los protagonistas, testigos, colectivos o profesiones con total naturalidad según lo exija el relato histórico.
- Prohibición absoluta del uso de signos de exclamación (!).
- Prohibición estricta de las palabras "adultos", "muertos", "homicidio".
-> ALTO INQUEBRANTABLE: La IA entrega únicamente el guion de voz en off y concluye su respuesta. Espera la confirmación del usuario antes de pasar a la siguiente etapa (Etapa 5: Prompt Técnico de la Miniatura Oficial en Nano Banana 2.1).

ETAPA 5: PROMPT TÉCNICO DE LA MINIATURA (NANO BANANA 2.1)
Una vez validado el guion de la voz en off de la Etapa 4, antes de generar el prompt de la miniatura es OBLIGATORIO contar con el texto en pantalla en la imagen (1 a 3 palabras contundentes, cumpliendo la regla inquebrantable de NO repetir lo mismo entre la miniatura, el título del video y el texto en pantalla en los primeros [DURACION_CLIP_1_RALENTIZADO] segundos). La IA generará EXCLUSIVAMENTE el prompt técnico en inglés para Nano Banana 2.1 para la miniatura oficial del video ([?SUB_OPCION_REELS=9X16]vertical 9:16[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal 16:9[/?SUB_OPCION_REELS]), cumpliendo con los siguientes requerimientos ineludibles:
- Redacción técnica 100% en idioma inglés iniciando con: "Thumbnail: Create an image "
- Relación de aspecto [?SUB_OPCION_REELS=9X16]vertical 9:16 (9:16 vertical aspect ratio)[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal 16:9 (16:9 horizontal aspect ratio)[/?SUB_OPCION_REELS].
- Ancla psicológica y contradicción visual: La miniatura funciona como ancla pre-inmersiva, no como fotograma pasivo. Debe inyectar una emoción dominante evidente, contradicción visual que desestabilice expectativas (ej. un monarca rodeado de miseria extrema), anclaje de tiempo y lugar, y composición limpia y legible optimizada para pantallas móviles.
- Texto en Pantalla en la Imagen (OBLIGATORIO): Máximo inquebrantable de 1 a 3 palabras que complementen semánticamente el título y la apertura sin repetir jamás lo mismo que el título del video ni que el texto en pantalla de los primeros [DURACION_CLIP_1_RALENTIZADO] segundos:
  * [?SUB_OPCION_REELS=9X16]Formato Vertical (9:16): El texto en pantalla va OBLIGATORIAMENTE centrado y justificado en el medio de la imagen ('bold high-contrast cinematic documentary typography text overlay centered and middle-justified right in the middle center of the image reading "[TEXTO EN PANTALLA]"').[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]Formato Horizontal (16:9): El texto en pantalla va OBLIGATORIAMENTE abajo a la izquierda de la imagen ('bold high-contrast cinematic documentary typography text overlay positioned in the bottom-left area of the image reading "[TEXTO EN PANTALLA]"').[/?SUB_OPCION_REELS]
- Regla Inquebrantable del Logo en Dorado al 5% en la Esquina Superior Derecha ([?SUB_OPCION_REELS=9X16]Logo "HD"[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]Logo "8K"[/?SUB_OPCION_REELS] Generado por IA) y Logo Oficial de la Página como Imagen de Referencia: Debe incluir textualmente:
  1) [?SUB_OPCION_REELS=9X16]'a small discreet 5% scale logo in the top-right corner displaying "HD" in metallic gold' (logo HD en dorado al 5% en la esquina superior derecha creado nativamente por la IA para formato vertical 9:16).[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]'a small discreet 5% scale logo in the top-right corner displaying "8K" in metallic gold' (logo 8K en dorado al 5% en la esquina superior derecha creado nativamente por la IA para formato horizontal 16:9).[/?SUB_OPCION_REELS]
  2) 'official page logo cleanly integrated in the top-left corner from provided reference image at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text' (manteniendo e integrando con nitidez total tanto el emblema del logo oficial como el texto exacto ubicado debajo del logo "Huellas de la Humanidad", quedando terminantemente prohibido recortarlo u omitir dicho texto).
- Directivas negativas y estilo: Reconstrucción cinematográfica de época, iluminación de alto impacto dramático, cerrando con: 'cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no music'.
- Pregunta obligatoria de validación: Inmediatamente al pie del prompt generado, la IA formulará la siguiente pregunta:
  "Por favor genera y valida la miniatura en tu motor de IA (Nano Banana 2.1) con este prompt y la imagen de referencia del logo. ¿La miniatura generada cumple con tus expectativas y estás listo para proceder con los Prompts de Imágenes Modelo de Referencia (@Personas y Lugares) de la Etapa 6?"
-> ALTO INQUEBRANTABLE: La IA entrega exclusivamente el prompt técnico de la miniatura y concluye su respuesta deteniéndose. Espera la confirmación del usuario antes de pasar a la siguiente etapa (Etapa 6: Prompts de Imágenes Modelo de Referencia de Personas y Lugares Principales).

ETAPA 6: PROMPTS DE IMÁGENES MODELO DE REFERENCIA (PERSONAS Y LUGARES PRINCIPALES CON '@')
Tras la validación de la miniatura oficial (Etapa 5) y ANTES de generar las imágenes iniciales y los clips de video, la IA debe extraer del guion las figuras históricas o personajes principales Y los lugares o escenarios principales donde transcurre el relato (sin generar imágenes de referencia para objetos sueltos). Para cada persona principal y cada lugar principal, generará sus prompts técnicos de imagen fija modelo de referencia en Nano Banana 2.1 ([?SUB_OPCION_REELS=9X16]vertical 9:16[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal 16:9[/?SUB_OPCION_REELS] con 'no text').
- Orden Operativa Inicial en una Sola Oración: Al inicio obligatorio de la entrega de los prompts de referencia, la IA DEBE ANTEPONER LITERALMENTE EN UNA SOLA ORACIÓN la siguiente instrucción para la IA generadora:
  Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente.
- Regla Inquebrantable de Identificación con '@' en Imágenes de Referencia (con Nombres con Número en Números Romanos): Al referirse a las figuras históricas principales (ej. @Jack The Ripper, @Julio César, @Napoleón Bonaparte, @Felipe II Augusto, @Luis XIV) y a los lugares principales en esta Etapa 6 (ej. @Whitechapel London, @Palacio de Versalles, @Curia de Pompeyo), la IA DEBE ANTEPONER OBLIGATORIAMENTE EL SÍMBOLO '@' AL COMIENZO DEL NOMBRE en el título e identificador de cada imagen modelo (ej. 'Image @Jack The Ripper: Create an image...', 'Image @Felipe II Augusto: Create an image...', 'Image @Whitechapel London: Create an image...'). Si el personaje histórico tiene un nombre con número (monarcas, papas, emperadores, faraones, ej. Felipe II Augusto, Enrique VIII, Carlos V), el número debe escribirse SIEMPRE en números romanos, jamás en palabras (prohibido '@Felipe Segundo Augusto').
- Regla Estricta de un Solo '@' por Cada Prompt: En cada prompt de imagen modelo de referencia (Etapa 6), así como en los prompts de imágenes iniciales y clips de video (Etapa 8), SOLO HABRÁ UN ÚNICO SÍMBOLO '@' POR CADA PROMPT (en la Etapa 8 reservando el único '@' del prompt para el personaje si aparece en escena, o para el lugar de referencia si la toma es exclusivamente del entorno sin personaje, evitando poner múltiples '@' en un mismo prompt).
- Regla Inquebrantable: Imágenes de Referencia de Personas y Lugares Exclusivas para Referencia Visual (Prohibido Usarlas como Primer Fotograma del Video): Las imágenes generadas en la Etapa 6 (modelos de personas y de lugares principales) son ÚNICA Y EXCLUSIVAMENTE para referencia visual en la herramienta de IA (actúan como activos de referencia / asset references para mantener consistencia fisonómica de los personajes y consistencia arquitectónica/espacial de los lugares a lo largo de los clips). Queda TERMINANTEMENTE PROHIBIDO utilizar estas imágenes de referencia como primer fotograma (fotograma inicial) de ningún clip de video. El primer fotograma de cada clip de video se genera obligatoriamente en la Etapa 8 con su prompt específico numerado (Image 1 para Clip 1, Image 2 para Clip 2, etc.).
- Estructura de Entrega de las Imágenes Modelo de Referencia (en idioma inglés para Nano Banana 2.1):
  (Anteponiendo siempre la orden: "Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente.")
  1. Personas Principales (@Personas): Prompts de modelo de personaje / retrato conceptual (character reference sheet / portrait), identificados como Image @[Nombre de la Persona]: Create an image... (ej. "Image @Jack The Ripper: Create an image..."), detallando rostro, edad histórica, rasgos fisonómicos distintivos, indumentaria de época rigurosamente auténtica, iluminación y textura de la piel (manteniendo un solo '@' en todo el prompt), cerrando con: cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no text, no speech, no music.
  2. Lugares Principales (@Lugares): Prompts de modelo de escenario / locación histórica principal (environment / historical location reference sheet), identificados como Image @[Nombre del Lugar]: Create an image... (ej. "Image @Whitechapel London: Create an image..."), detallando la arquitectura exacta de la época (incluyendo el año o época histórica), topografía, texturas de muros y calles, atmósfera climática e iluminación característica del lugar (manteniendo un solo '@' en todo el prompt), cerrando con: cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no text, no speech, no music.
Estas imágenes modelo de referencia de personas y lugares constituyen el anclaje visual ('ground truth') que la IA y el usuario utilizarán única y exclusivamente para mantener una rigurosa consistencia facial, corporal y arquitectónica a lo largo de todos los clips del video (quedando estrictamente prohibido usarlas como primer fotograma de ningún clip de video).
-> ALTO INQUEBRANTABLE: La IA entrega exclusivamente los prompts de imágenes modelo de referencia de personas y lugares principales precedidos por la orden en una sola oración ("Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente."), y concluye su respuesta deteniéndose. Espera la confirmación del usuario antes de pasar a la selección del texto en pantalla del Clip 1 (Etapa 7).

ETAPA 7: SELECCIÓN DEL TEXTO EN PANTALLA DEL CLIP 1 (APERTURA DEL VIDEO SIN VOZ)
Tras la validación de las imágenes modelo de referencia de personas y lugares de la Etapa 6 y ANTES de pasar a los prompts de imágenes iniciales y clips de video, la IA DEBE ACORDAR OBLIGATORIAMENTE CON EL USUARIO LA SELECCIÓN DEL TEXTO EN PANTALLA DEL CLIP 1 (correspondiente a la ventana inicial sin voz del video):
[?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]
La IA DEBE PREGUNTAR OBLIGATORIAMENTE AL USUARIO:
"¿Qué texto ponemos en la apertura del video para el Clip 1?"
La IA debe explicar al usuario que este texto corresponde al letrero o rótulo de gancho visual en pantalla durante los primeros [DURACION_CLIP_1_RALENTIZADO] segundos del video (la ventana del Hook sin voz en off de 00:00 a 00:[DURACION_CLIP_1_RALENTIZADO_PAD], correspondiente a Clip 1 de [DURACION_CLIP_1]s [00:00 - 00:[DURACION_CLIP_1_PAD]] más los primeros 2 segundos de Clip 2 [00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]], con exclusivo diseño sonoro Foley ambiental, entrando la voz en el segundo [DURACION_CLIP_1_RALENTIZADO] que es el segundo 2 del Clip 2).
Diseño para Reproducción en Silencio: Como alrededor del 70% de los usuarios ven los primeros segundos sin audio, este apoyo visual claro y los subtítulos dinámicos posteriores en CapCut son obligatorios para retener al espectador. Para facilitarle la selección y decisión al usuario, la IA debe proponerle obligatoriamente de 2 a 3 opciones atractivas, intrigantes y de alto impacto adaptadas al tema del video, estructuradas obligatoriamente en el siguiente formato de dos líneas:
- Primera línea: Ciudad, País, Tiempo (con años en dígitos numéricos y siglos obligatoriamente en números romanos; ej. "Londres, Inglaterra, 1888" o "París, Francia, siglo XIX").
- Segunda línea (justo debajo): El Gancho (frase corta y contundente, enigma intrigante o revelación perturbadora que detenga el scroll al instante, cumpliendo la regla inquebrantable de NO repetir lo mismo entre este texto en pantalla de los primeros [DURACION_CLIP_1_RALENTIZADO] segundos, el título del video y el texto de la miniatura).
Ejemplo visual del formato a entregar:
[Ciudad], [País], [Tiempo]
[Frase de gancho intrigante o perturbadora]

Y darle al usuario la opción de elegir una de las opciones sugeridas, editarla o indicar su propio texto.
Se debe aclarar al usuario que dicho texto es para ser insertado manualmente durante la edición posterior en CapCut (los prompts de Nano Banana 2.1 y Omni Flash se mantienen estrictamente con la directriz 'no text').
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la respuesta y confirmación del usuario con el texto elegido para el Clip 1 antes de pasar a la siguiente etapa (Etapa 8: Prompts de Imágenes Iniciales y Clips).
[/?TEXTO_PANTALLA_CLIP_1]
[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]
La IA DEBE PRESENTAR OBLIGATORIAMENTE AL USUARIO LA SELECCIÓN DEL TEXTO EN PANTALLA QUE SE INTEGRARÁ EN EL PROMPT DEL CLIP 1:
La IA presentará al usuario de 2 a 3 opciones atractivas, intrigantes y cinematográficas adaptadas al tema del video para que el usuario seleccione la que irá integrada en el prompt de video del Clip 1 de [DURACION_CLIP_1] segundos (tipo comienzo de un documental cinematográfico con tipografía cinematográfica integrada).
Dichas opciones deben estructuramente obligatoriamente en el formato de dos líneas:
- Primera línea: Ciudad, País, Tiempo (con años en números/dígitos y siglos obligatoriamente en números romanos; ej. "Londres, Inglaterra, 1888" o "París, Francia, siglo XIX").
- Segunda línea (justo debajo): El Gancho (frase corta e intrigante con tipografía cinematográfica integrada, cumpliendo la regla inquebrantable de NO repetir lo mismo entre este texto en pantalla de los primeros [DURACION_CLIP_1_RALENTIZADO] segundos, el título del video y el texto de la miniatura).
Ejemplo visual del formato a entregar:
[Ciudad], [País], [Tiempo]
[Frase de gancho intrigante o perturbadora]

Y darle al usuario la opción de elegir una de las opciones sugeridas, editarla o indicar su propio texto.
La IA recordará que este texto seleccionado se integrará única y exclusivamente en el prompt del Clip 1 de video (la Imagen 1 se mantendrá estrictamente con 'no text'), y recordará la instrucción operativa para el montaje: "En edición, baja la velocidad de este Clip 1 de [DURACION_CLIP_1] segundos para llevarlo a [DURACION_CLIP_1_RALENTIZADO] segundos de duración".
Diseño para Reproducción en Silencio: Como alrededor del 70% de los usuarios ven los primeros segundos sin audio, este rótulo cinematográfico de apertura integrado y los subtítulos dinámicos posteriores en CapCut garantizan la máxima retención.
-> ALTO INQUEBRANTABLE: La IA formula la propuesta de opciones de texto en pantalla para el Clip 1 y concluye su respuesta deteniéndose. Espera la selección y confirmación del usuario antes de pasar a la siguiente etapa (Etapa 8: Prompts de Imágenes Iniciales y Clips).
[/?TEXTO_PANTALLA_CLIP_1]

ETAPA 8: PROMPTS DE IMÁGENES INICIALES Y CLIPS (CONSULTA DE ENTREGA: DE 10 EN 10 O TODOS JUNTOS)
Tras la selección y confirmación del texto en pantalla del Clip 1 (Etapa 7), y ANTES de generar o entregar cualquier prompt de imagen inicial o clip de video, la IA DEBE CONSULTAR OBLIGATORIAMENTE AL USUARIO cómo desea recibir los prompts:
"¿Prefieres que te entregue los prompts de imágenes iniciales y clips de video de 10 en 10 o todos juntos?"
-> ALTO INQUEBRANTABLE: La IA formula únicamente esta pregunta y concluye su respuesta deteniéndose. Espera la respuesta y decisión del usuario antes de redactar o entregar ningún prompt de imagen inicial o clip de video.

Una vez que el usuario elija su preferencia, la IA generará y entregará los prompts de imágenes iniciales (Image 1, Image 2, etc., que fungirán como primer fotograma de cada clip) y los clips de video correspondientes a la duración aproximada elegida según la modalidad seleccionada (en bloques de 10 clips con ALTO INQUEBRANTABLE entre bloques, o todos juntos en una sola entrega continua):
- Cantidad de Clips y Duración Total Aproximada (Sin Obligación de Cuadre Exacto al Segundo):
[?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]
  * Clip 1: Cobertura temporal y duración obligatoria de [DURACION_CLIP_1] segundos en el prompt de clip (00:00 - 00:[DURACION_CLIP_1_PAD]). Prompt técnico en inglés para Omni Flash de [DURACION_CLIP_1]s de duración con puro diseño sonoro Foley ambiental (Hook de apertura de alto impacto sensorial). Estrictamente SIN voz en off.
[?DURACION_CLIPS=10_SEGUNDOS]
  * Clip 2: Cobertura temporal de [VOZ_CLIP2_RANGE_10S] (10 segundos de duración, 1 shot de 10s). Sus primeros 2 segundos (00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]) continúan sin voz en off con diseño Foley, y exactamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video (00:[DURACION_CLIP_1_RALENTIZADO_PAD], que es el segundo 2 del segundo clip / a los 2 segundos de iniciar el Clip 2) da comienzo la voz narrativa continua.
  * Clips subsiguientes (Clip 3 en adelante): Clips de 10 segundos cada uno (Clip 3: [VOZ_CLIP3_RANGE_10S], Clip 4: [VOZ_CLIP4_RANGE_10S], etc.), estructurados por defecto como 1 solo shot continuo de 10s (o 2 shots de 5s cada uno si la voz narrativa cambia de escena a mitad del clip).
  * Regla Inquebrantable de Compensación de Timestamps (+[DURACION_CLIP_1_RALENTIZADO] Segundos): La IA debe tener en cuenta que el software de audio y transcripción del usuario arranca sus marcas de tiempo desde 00:00 (mientras que en edición el audio se coloca a partir del segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD], es decir, en el segundo 2 del Clip 2). Por tanto, la IA realiza automáticamente la compensación de +[DURACION_CLIP_1_RALENTIZADO] segundos: el fragmento de voz inicial (00:00 - 00:08) se asigna a los 8 segundos con voz de Clip 2 ([VOZ_CLIP2_RANGE_10S], donde la voz entra al segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD]), el de 00:08 - 00:18 a Clip 3 ([VOZ_CLIP3_RANGE_10S]), el de 00:18 - 00:28 a Clip 4 ([VOZ_CLIP4_RANGE_10S]), etc., mostrando en los prompts exclusivamente el tiempo real del timeline de video en CapCut (##:## - ##:##).
  * Regla de Duración Total Aproximada: La duración total del video NO tiene que ser exacta al segundo, sino aproximada a la duración pedida por el usuario. La IA generará los clips completos de 10 segundos necesarios (a partir del Clip 2) para cubrir de forma natural y completa toda la voz narrativa hasta el cierre con el slogan oficial y la escena panorámica amplia y rica visualmente (sin objeto close-up), sin necesidad de forzar ni recortar micro-clips para clavar un segundo exacto.
[/?DURACION_CLIPS]
[?DURACION_CLIPS=8_SEGUNDOS]
  * Clip 2: Cobertura temporal de [VOZ_CLIP2_RANGE_8S] (8 segundos de duración, 1 shot de 8s). Sus primeros 2 segundos (00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]) continúan sin voz en off con diseño Foley, y exactamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video (00:[DURACION_CLIP_1_RALENTIZADO_PAD], que es el segundo 2 del segundo clip / a los 2 segundos de iniciar el Clip 2) da comienzo la voz narrativa continua.
  * Clips subsiguientes (Clip 3 en adelante): Clips de 8 segundos cada uno (Clip 3: [VOZ_CLIP3_RANGE_8S], Clip 4: [VOZ_CLIP4_RANGE_8S], etc.), estructurados por defecto como 1 solo shot continuo de 8s.
  * Regla Inquebrantable de Compensación de Timestamps (+[DURACION_CLIP_1_RALENTIZADO] Segundos): La IA debe tener en cuenta que el software de audio y transcripción del usuario arranca sus marcas de tiempo desde 00:00 (mientras que en edición el audio se coloca a partir del segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD], es decir, en el segundo 2 del Clip 2). Por tanto, la IA realiza automáticamente la compensación de +[DURACION_CLIP_1_RALENTIZADO] segundos: el fragmento de voz inicial (00:00 - 00:06) se asigna a los 6 segundos con voz de Clip 2 ([VOZ_CLIP2_RANGE_8S], donde la voz entra al segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD]), el de 00:06 - 00:14 a Clip 3 ([VOZ_CLIP3_RANGE_8S]), el de 00:14 - 00:22 a Clip 4 ([VOZ_CLIP4_RANGE_8S]), etc., mostrando en los prompts exclusivamente el tiempo real del timeline de video en CapCut (##:## - ##:##).
  * Regla de Duración Total Aproximada: La duración total del video NO tiene que ser exacta al segundo, sino aproximada a la duración pedida por el usuario. La IA generará los clips completos de 8 segundos necesarios (a partir del Clip 2) para cubrir de forma natural y completa toda la voz narrativa hasta el cierre con el slogan oficial y la escena panorámica amplia y rica visualmente (sin objeto close-up), sin necesidad de forzar ni recortar micro-clips para clavar un segundo exacto.
[/?DURACION_CLIPS]
[/?SINCRONIZACION_CLIP_1]
[?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]
  * Clip 1: Cobertura temporal de [DURACION_CLIP_1] segundos en el prompt de clip (00:00 - 00:[DURACION_CLIP_1_PAD]) para Omni Flash con puro diseño sonoro Foley ambiental, estrictamente SIN voz en off. (En edición, el usuario reduce la velocidad de este clip llevándolo a [DURACION_CLIP_1_RALENTIZADO] segundos de duración [00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]] para cubrir la ventana inicial sin locución).
[?DURACION_CLIPS=10_SEGUNDOS]
  * Clip 2: Cobertura temporal en timeline de [RAL_CLIP2_RANGE_10S] (10 segundos de duración, 1 shot de 10s). Al haberse llevado el Clip 1 a [DURACION_CLIP_1_RALENTIZADO] segundos en edición, el Clip 2 arranca en el timeline de CapCut en el segundo [DURACION_CLIP_1_RALENTIZADO] de video (00:[DURACION_CLIP_1_RALENTIZADO_PAD]) y da comienzo de inmediato a la voz narrativa continua en el segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD] (sin los 2 segundos de foley mudo iniciales de Clip 2, cubriendo los 10 segundos del Clip 2 con locución continua).
  * Clips subsiguientes (Clip 3 en adelante): Clips de 10 segundos cada uno (Clip 3: [RAL_CLIP3_RANGE_10S], Clip 4: [RAL_CLIP4_RANGE_10S], etc.), estructurados por defecto como 1 solo shot continuo de 10s (o 2 shots de 5s cada uno si la voz narrativa cambia de escena a mitad del clip).
  * Regla Inquebrantable de Compensación de Timestamps (+[DURACION_CLIP_1_RALENTIZADO] Segundos): La IA debe tener en cuenta que el software de audio y transcripción del usuario arranca sus marcas de tiempo desde 00:00 (mientras que en edición el audio se coloca a partir del segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD] al iniciar el Clip 2). Por tanto, la IA realiza automáticamente la compensación de +[DURACION_CLIP_1_RALENTIZADO] segundos: el fragmento de voz inicial (00:00 - 00:10) se asigna a los 10 segundos completos con voz de Clip 2 ([RAL_CLIP2_RANGE_10S], donde la voz arranca desde el segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD]), el de 00:10 - 00:20 a Clip 3 ([RAL_CLIP3_RANGE_10S]), etc., mostrando en los prompts exclusivamente el tiempo real del timeline de video en CapCut (##:## - ##:##).
  * Regla de Duración Total Aproximada: La duración total en el timeline final de edición NO tiene que ser exacta al segundo, sino aproximada a la duración pedida por el usuario. La IA generará los clips completos de 10 segundos necesarios (a partir del Clip 2) para cubrir de forma natural y completa toda la voz narrativa hasta el cierre con el slogan oficial y la escena panorámica amplia y rica visualmente (sin objeto close-up), sin necesidad de forzar micro-clips residuales para clavar un segundo exacto.
[/?DURACION_CLIPS]
[?DURACION_CLIPS=8_SEGUNDOS]
  * Clip 2: Cobertura temporal en timeline de [RAL_CLIP2_RANGE_8S] (8 segundos de duración, 1 shot de 8s). Al haberse llevado el Clip 1 a [DURACION_CLIP_1_RALENTIZADO] segundos en edición, el Clip 2 arranca en el timeline de CapCut en el segundo [DURACION_CLIP_1_RALENTIZADO] de video (00:[DURACION_CLIP_1_RALENTIZADO_PAD]) y da comienzo de inmediato a la voz narrativa continua en el segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD] (sin los 2 segundos de foley mudo iniciales de Clip 2, cubriendo los 8 segundos del Clip 2 con locución continua).
  * Clips subsiguientes (Clip 3 en adelante): Clips de 8 segundos cada uno (Clip 3: [RAL_CLIP3_RANGE_8S], Clip 4: [RAL_CLIP4_RANGE_8S], etc.), estructurados por defecto como 1 solo shot continuo de 8s.
  * Regla Inquebrantable de Compensación de Timestamps (+[DURACION_CLIP_1_RALENTIZADO] Segundos): La IA debe tener en cuenta que el software de audio y transcripción del usuario arranca sus marcas de tiempo desde 00:00 (mientras que en edición el audio se coloca a partir del segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD] al iniciar el Clip 2). Por tanto, la IA realiza automáticamente la compensación de +[DURACION_CLIP_1_RALENTIZADO] segundos: el fragmento de voz inicial (00:00 - 00:08) se asigna a los 8 segundos completos con voz de Clip 2 ([RAL_CLIP2_RANGE_8S], donde la voz arranca desde el segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD]), el de 00:08 - 00:16 a Clip 3 ([RAL_CLIP3_RANGE_8S]), el de 00:16 - 00:24 a Clip 4 ([RAL_CLIP4_RANGE_8S]), etc., mostrando en los prompts exclusivamente el tiempo real del timeline de video en CapCut (##:## - ##:##).
  * Regla de Duración Total Aproximada: La duración total en el timeline final de edición NO tiene que ser exacta al segundo, sino aproximada a la duración pedida por el usuario. La IA generará los clips completos de 8 segundos necesarios (a partir del Clip 2) para cubrir de forma natural y completa toda la voz narrativa hasta el cierre con el slogan oficial y la escena panorámica amplia y rica visualmente (sin objeto close-up), sin necesidad de forzar micro-clips residuales para clavar un segundo exacto.
[/?DURACION_CLIPS]
[/?SINCRONIZACION_CLIP_1]

- Regla Inquebrantable del Clip del Slogan Completo al Principio (Escena de una Mesa de un Historiador Antiguo):
  Para el clip (o los clips) que cubre la parte donde la voz narrativa pronuncia el Slogan Completo al principio del video (~segundos 20–30: desde "En los próximos minutos..." hasta "...Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros."), tanto su imagen inicial (Nano Banana 2.1) como su clip de video (Omni Flash) DEBEN SER OBLIGATORIAMENTE una escena de una mesa de un historiador antiguo llena de objetos antiguos, además de pergaminos, plumas de escritura, bote de tinta, entre otros artefactos históricos de época (an antique historian's wooden desk richly covered with ancient historical objects, aged parchment scrolls, quill pens, inkpot, antique maps, wax seals, and period relics).

- Regla Inquebrantable del Último Clip de los Reels (Escena Panorámica Amplia y Rica Visualmente - Prohibido Objeto Close-Up):
  Para el último clip de todos los Reels (tanto en formato vertical 9:16 como horizontal 16:9), queda TERMINANTEMENTE PROHIBIDO poner un objeto en close-up, plano macro o detalle aislado. Tanto la última imagen inicial (Nano Banana 2.1) como el último clip de video (Omni Flash) DEBEN SER OBLIGATORIAMENTE una escena panorámica amplia y rica visualmente (wide panoramic shot / sweeping cinematic vista) que muestre la amplitud, atmósfera, arquitectura o paisaje histórico del episodio con máxima riqueza visual como cierre épico del video.

- Relación de Aspecto ([?SUB_OPCION_REELS=9X16]9:16 Vertical[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]16:9 Horizontal[/?SUB_OPCION_REELS]):
  Todos los prompts de imagen inicial en Nano Banana 2.1 deben configurarse obligatoriamente en relación de aspecto [?SUB_OPCION_REELS=9X16]vertical 9:16[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal 16:9[/?SUB_OPCION_REELS]. El resto de la estructura de prompts, voz en off, tiempos y foley se mantiene exactamente idéntica.

[?DURACION_CLIPS=10_SEGUNDOS]
- Regla Inquebrantable de Sincronización con las Pausas de la Voz Narrativa ([pausa: Xs]) y Opción de Dos Shots de 5 Segundos (5s + 5s) Cuando la Voz Narrativa Cambia de Escena:
  1. Tener en Cuenta las Pausas de la Voz Narrativa para Imágenes Iniciales y Clips: Al generar los prompts de las imágenes iniciales y de los clips de video, la IA DEBE TENER OBLIGATORIAMENTE EN CUENTA la ubicación y duración exacta de todas las pausas de la voz narrativa ([pausa: 1s], [pausa: 1.5s], [pausa: 2s], etc.) definidas en el guion de la Etapa 4. Cada pausa consume segundos reales dentro del intervalo de tiempo del clip (ej. si en un clip de 10s hay una [pausa: 2s], ese clip contiene 8s de voz hablada [~120 caracteres] + 2s de pausa = 10s totales), marcando transiciones dramáticas, silencios de impacto o cambios de escena que deben reflejarse con exactitud en el diseño visual y acústico Foley de los prompts.
  2. Regla General de 1 Shot de 10s vs. Regla de Dos Shots de 5 Segundos cada uno (5s + 5s) ante Cambio de Escena en la Voz Narrativa:
     - Por defecto, cada clip de video a partir del segundo clip se estructura como un solo shot cinematográfico continuo de 10 segundos de duración (1 shot de 10s) cuando la voz narrativa permanece dentro de una misma escena o acción visual.
     - EXCEPCIÓN INTELIGENTE DE DOS SHOTS DE 5 SEGUNDOS (5s + 5s): En dado caso que una escena se vaya a demorar demasiado visualmente y ya la voz narrativa (especialmente tras una pausa [pausa: Xs] o cambio de oración a mitad del clip) cambió a otra escena, lugar, sujeto o acontecimiento distinto, la IA DEBE HACER QUE ESE CLIP ESPECÍFICO TENGA DOS (2) SHOTS CADA UNO DE 5 SEGUNDOS:
       * La Imagen Inicial (Image [número]: Create an image...) de ese clip corresponderá al primer fotograma que abre el Shot 1 (los primeros 5 segundos del clip).
       * En el Prompt del Clip de Video (Clip [número] (##:## - ##:##): Create a video...), en lugar de restringirlo a un solo shot, la IA estructurará explícitamente en inglés los dos shots de 5 segundos cada uno sincronizados con la pausa y el cambio de escena de la voz narrativa:
         "two-shot sequence of 5 seconds each: Shot 1 (0s-5s, first 5 seconds) [descripción visual detallada de la primera escena a partir de la imagen inicial, movimiento de cámara y foley hasta la pausa narrativa]; followed at second 5 by a clean cinematic cut to Shot 2 (5s-10s, final 5 seconds) [descripción visual detallada de la nueva escena a la que cambió la voz narrativa, nuevo encuadre/cámara y foley], strictly no morphing or disappearing elements within each 5-second shot..."
       * Así se garantiza que ninguna escena se demore demasiado en pantalla cuando la voz narrativa ya pasó a otra escena.
[/?DURACION_CLIPS]
[?DURACION_CLIPS=8_SEGUNDOS]
- Regla Inquebrantable de Sincronización con las Pausas de la Voz Narrativa ([pausa: Xs]) y Opción de Dos Shots Cuando la Voz Narrativa Cambia de Escena:
  1. Tener en Cuenta las Pausas de la Voz Narrativa para Imágenes Iniciales y Clips: Al generar los prompts de las imágenes iniciales y de los clips de video, la IA DEBE TENER OBLIGATORIAMENTE EN CUENTA la ubicación y duración exacta de todas las pausas de la voz narrativa ([pausa: 1s], [pausa: 1.5s], [pausa: 2s], etc.) definidas en el guion de la Etapa 4. Cada pausa consume segundos reales dentro del intervalo de tiempo del clip, marcando silencios dramáticos o cambios de escena que deben reflejarse en los prompts.
  2. Regla General de 1 Shot vs. Dos Shots ante Cambio de Escena en la Voz Narrativa:
     - Por defecto, cada clip de video a partir del segundo clip se estructura como un solo shot cinematográfico continuo (1 shot de 8s).
     - En dado caso que una escena se vaya a demorar demasiado visualmente y ya la voz narrativa (tras una pausa [pausa: Xs] o cambio de oración a mitad del clip) cambió a otra escena distinta, la IA puede hacer que ese clip específico tenga dos shots divididos en mitades iguales (Shot 1 para la primera escena y corte limpio al Shot 2 para la nueva escena a la que cambió la voz narrativa), evitando que la imagen inicial se quede estancada mientras la locución ya narra otra escena.
[/?DURACION_CLIPS]

- Regla Inquebrantable de Variación Cinematográfica Intra-Escena (Tomas Diferentes ante Escenas Prolongadas en la Locución):
  * Principio Fundamental y Prohibición Estricta: Cuando un tramo de la voz narrativa permanezca por más de 10 segundos (o abarque dos o más clips consecutivos) describiendo una misma escena, suceso, entorno histórico o momento auditivo, queda TERMINANTEMENTE PROHIBIDO que la IA genere clips consecutivos con la misma escena visual repetida o composiciones idénticas.
  * Obligatoriedad de Tomas Diferentes: Para mantener una narrativa visual dinámica y cinematográfica mientras la locución continúa sobre el mismo hecho o momento histórico, la IA debe entregar obligatoriamente tomas completamente diferentes en cada clip consecutivo variando:
    1) Movimiento de Cámara: Alternar fluidamente entre movimientos contrastantes (ej. slow dolly push-in frontal en un clip, tracking shot lateral o gentle crane up en el siguiente, y handheld immersive en el subsiguiente).
    2) Perspectiva y Ángulo de Visión: Cambiar radicalmente el ángulo visual (ej. de plano frontal a nivel de ojos eye-level a un contrapicado imponente low angle, ángulo cenital/overhead o plano over-the-shoulder / POV de un testigo).
    3) Enfoque, Escala y Encuadre: Alternar drásticamente entre planos generales de situación (wide establishing shots) y planos macro de detalle (extreme close-up o rack focus a texturas, manos temblorosas, polvo, armamento, sudor o miradas en penumbra).
    4) Puntos de Atención y Acciones Simultáneas: Explorar diferentes micro-acciones o focos de interés simultáneos dentro del mismo entorno histórico mientras el narrador prosigue su relato.
    5) Diversidad de Tipos de Tomas de Apoyo Histórico: Intercalar recursos visuales de alto valor documental como la toma tipo mapa (recorrido sobre cartografía y atlas de época), la toma de maqueta (diorama a escala arquitectónico o táctico de batallas/ciudades) y la toma de dibujo en papel en blanco y negro (bocetos a tinta, carboncillo o grabados de época).
    (Nota Operativa: Esta variación de tomas ocurre ENTRE clips contiguos y convive armónicamente con la orden "No hagas cambios de shot nunca en ningun clip y asegúrate de que los clips de video no hagan desapariciones ni transformaciones ni cambios de shot dentro del clip", la cual rige internamente dentro de cada clip individual para asegurar que cada clip sea 1 solo shot continuo sin cortes internos, sin desapariciones y sin transformaciones).

- Diseño para Reproducción en Silencio:
  Alrededor del 70% de los usuarios ven los primeros segundos sin audio, por lo que subtítulos dinámicos y un apoyo visual claro son obligatorios. Cada plano debe tener un foco compositivo evidente e inequívoco, permitiendo al espectador comprender la tensión y la historia inmediatamente sin necesidad de sonido activo.

- Protocolo Obligatorio de Consulta y Entrega de Prompts (De 10 en 10 o Todos Juntos):
  * Consulta Previa Ineludible: Antes de entregar cualquier prompt de imagen o video, la IA debe formular la pregunta: "¿Prefieres que te entregue los prompts de imágenes iniciales y clips de video de 10 en 10 o todos juntos?" y detenerse con el ALTO INQUEBRANTABLE esperando la elección del usuario.
  * Modalidad 1: Entrega de 10 en 10:
    - Si la producción tiene más de 10 clips en total (ej. un video de 120s con 13 o 16 clips), la IA generará y entregará en la primera tanda ÚNICAMENTE el Bloque 1 correspondiente a los primeros 10 clips (Clips 1 al 10), encabezando OBLIGATORIA E INQUEBRANTABLEMENTE su respuesta con el párrafo inicial de 9 líneas ("Actúa como un historiador, director de cine, y periodista profesional...") justo antes de "Image 1: Create an image".
    - Al finalizar los 10 clips del Bloque 1, la IA DEBE DETENERSE OBLIGATORIAMENTE mediante la instrucción:
      -> ALTO INQUEBRANTABLE: La IA entrega el bloque de 10 clips (Clips 1 al 10) y concluye su respuesta deteniéndose. Espera la confirmación del usuario para generar y entregar el siguiente bloque (Clips 11 al 13/16 o restantes). NO entregues la miniatura ni la metadata ni pases a la siguiente etapa hasta completar todos los clips.
    - Tras la confirmación del usuario, la IA entregará el Bloque 2 (Clips 11 al 13/16 o restantes) comenzando DIRECTAMENTE con los prompts (ej. Image 11: Create an image, Clip 11 (##:## - ##:##): Create a video) SIN repetir la orden operativa, ya que el párrafo inicial de 9 líneas se da EXCLUSIVAMENTE y por única vez al inicio del primer envío de prompts (Bloque 1).
    - Si la producción tiene 10 clips o menos en total (ej. un video de 60s con 7 u 8 clips), la IA entregará la totalidad de los clips en un único bloque encabezando OBLIGATORIA E INQUEBRANTABLEMENTE su respuesta con el párrafo inicial de 9 líneas antes de "Image 1: Create an image", y se detendrá con el ALTO INQUEBRANTABLE antes de pasar a la siguiente etapa (Etapa 8: Corrección de Captions Automáticos de CapCut [Archivo .srt] con la Voz Narrativa Original).
  * Modalidad 2: Entrega de Todos Juntos:
    - La IA generará y entregará en una sola respuesta continua la totalidad de los prompts de imágenes iniciales y clips de video de la producción (desde el Clip 1 hasta el último clip), encabezando OBLIGATORIA E INQUEBRANTABLEMENTE su respuesta con el párrafo inicial de 9 líneas ("Actúa como un historiador, director de cine, y periodista profesional...") justo antes de "Image 1: Create an image", sin pausas intermedias entre clips.
    - Al finalizar la entrega completa de todos los clips, la IA se detendrá con el ALTO INQUEBRANTABLE antes de pasar a la siguiente etapa (Etapa 8: Corrección de Captions Automáticos de CapCut [Archivo .srt] con la Voz Narrativa Original).

- Formato Estricto de los Prompts (PÁRRAFO INICIAL OBLIGATORIO DE 9 LÍNEAS AL COMIENZO DE LA ENTREGA):
  La IA entregará exclusivamente los prompts de forma limpia, directa y consecutiva en párrafos sin tablas ni bloques de código Markdown:
  * Regla Inquebrantable de Simplicidad y Concisión en Prompts de Video e Imagen (Evitar Sobrecarga para que la IA de Clips No Cometa Errores):
    - En 'Image [N]': Redacta una descripción clara, concisa y directa (~20 a 35 palabras) enfocada en 1 escena/sujeto principal con su época y lugar, cerrando limpiamente con 'cinematic lighting, historical accuracy, no text.' (sin sobrecargar con listas interminables de lentes o etiquetas redundantes).
    - En 'Clip [N] (##:## - ##:##)': Como la IA generadora de video (Omni Flash) ya recibe 'Image [N]' como fotograma inicial, NO vuelvas a describir todo el vestuario, mobiliario ni arquitectura en el prompt del clip. Redacta UNA SOLA ORACIÓN SIMPLE Y DIRECTA (~12 a 22 palabras) que indique únicamente 1 movimiento suave de cámara ('slow zoom-in', 'panning slowly', 'gliding slowly', 'slow tilt-up') y 1 micro-acción física simple y natural sobre lo que ya está en la imagen inicial (ej. 'Create a video showing the troubadour gently strumming the lute while kneeling, the noblewoman looking down at him gracefully.'). Inmediatamente después coloca 'Ambient Foley: [2 o 3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text.' seguido de la voz narrativa (si aplica) y 'fix the name'. Mientras más simple y física sea la acción del clip, menos deformaciones y errores comete la IA generadora de video.
  * Regla Inquebrantable de Prompts 100% en Inglés y Apertura ("Create an image" / "Create a video"): Todos los prompts deben estar redactados obligatoria y estrictamente en idioma INGLÉS para los comandos y la descripción técnica cinematográfica. Inmediatamente después de la numeración en las imágenes estáticas, debe colocarse obligatoriamente la orden de acción en inglés "Create an image " ("Image [número]: Create an image [prompt...]" o "Imagen [número]: Create an image [prompt...]"). Inmediatamente después de la numeración y el timestamp en los clips de video, debe colocarse obligatoriamente la orden de acción en inglés "Create a video " ("Clip [número] (##:## - ##:##): Create a video [prompt...]"). Queda estrictamente prohibido usar frases en español (como "Crea una imagen" o "Crea un video") dentro de las órdenes técnicas de los prompts.
  * Regla Inquebrantable de Tiempo y Lugar y Máximo un Solo '@' por Cada Prompt: En absolutamente CADA prompt de imagen estática (Nano Banana 2.1) y en CADA prompt de clip de video (Omni Flash), la IA DEBE INCLUIR OBLIGATORIAMENTE el TIEMPO (año exacto en dígitos o época histórica, ej. '1888', '1944', 'Victorian era') y el LUGAR (ciudad, país, entorno geográfico o locación específica, ej. 'in Whitechapel, London, England', 'in Paris, France') como anclaje y referencia visual ineludible. Cuando en la escena aparezca una figura histórica principal modelada en la Etapa 5, se incluirá el prefijo '@' en dicho personaje (ej. '@Jack The Ripper in Whitechapel, London, England, 1888...'), manteniendo como máximo un único símbolo '@' por cada prompt.
  * Regla Inquebrantable de Un Solo Shot por Defecto vs. Dos Shots de 5 Segundos cada uno (5s + 5s) si la Voz Narrativa Cambia de Escena: Teniendo en cuenta las pausas de la voz narrativa ([pausa: Xs]), en todos los clips de video donde la escena se mantenga en una misma unidad visual, la IA DEBE INCLUIR OBLIGATORIAMENTE en inglés dentro del propio prompt la directriz de un único shot continuo: "single continuous shot, strictly no shot changes, no camera cuts, no jump cuts, no morphing or disappearing elements". Sin embargo, en dado caso que una escena se vaya a demorar demasiado visualmente y ya la voz narrativa (tras una pausa o giro a mitad del clip) cambió a otra escena distinta, la IA estructurará ese clip específico con DOS SHOTS DE 5 SEGUNDOS CADA UNO ("two-shot sequence of 5 seconds each: Shot 1 [0s-5s]: ...; Shot 2 [5s-10s]: clean cinematic cut at second 5 to ..., strictly no morphing or disappearing elements within each 5-second shot").
  * Regla Inquebrantable de Inclusión de "fix the name" al Final de Cada Prompt de Clip: En absolutamente TODOS los prompts de clips de video (Clip 1 en adelante, sin excepción), la IA DEBE AGREGAR OBLIGATORIAMENTE al final de todo el prompt la orden en inglés: "fix the name" (agregada al final de la línea del clip, [?VOZ_NARRATIVA_EN_CLIPS=INCLUIR]tras la voz narrativa si está incluida[/?VOZ_NARRATIVA_EN_CLIPS][?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR]tras el sufijo de barrera sonora 'no text, no speech, no music.'[/?VOZ_NARRATIVA_EN_CLIPS]). Queda terminantemente prohibido omitir "fix the name" al final de cualquier prompt de clip de video.
[?VOZ_NARRATIVA_EN_CLIPS]
  * Regla Inquebrantable de la Voz Narrativa al Final como una Oración Más (Sin Comillas ni Paréntesis): En cada prompt de clip de video que lleve locución (Clip 2 en adelante), la IA DEBE COLOCAR OBLIGATORIAMENTE al final de todo el prompt la porción correspondiente del guion de voz en off. Dicho texto se sitúa al final como UNA ORACIÓN MÁS, inmediatamente después del punto del sufijo obligatorio de barrera sonora en inglés (...no text, no speech, no music. [Texto de la locución]. fix the name). Queda TERMINANTEMENTE PROHIBIDO encerrar la voz narrativa entre comillas (""), envolverla en paréntesis (()) o escribir etiquetas burocráticas como '(Voz narrativa: ...)'. Se anexa directamente como una última oración continua y limpia antes de "fix the name". Para Clip 1 (00:00 - 00:04), al tener una duración obligatoria de 4 segundos y ser el Hook inicial sin voz en off de puro diseño sonoro Foley, el prompt concluye directamente con el sufijo y "fix the name" sin ninguna oración adicional de voz.
[/?VOZ_NARRATIVA_EN_CLIPS]
[?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR]
  * Regla Estricta de Exclusión de la Voz Narrativa en Prompts de Clips (Prompts Limpios): En los prompts de clips de video (Clip 1 en adelante), queda TERMINANTEMENTE PROHIBIDO incluir el texto de la voz narrativa o locución al final del prompt. Cada prompt de clip de video debe concluir obligatoria y limpiamente con el sufijo de barrera sonora en inglés (...no text, no speech, no music. fix the name), sin añadir ninguna oración de voz en off. El guion de voz narrativa generado en la Etapa 4 se reserva exclusivamente para la grabación de la locución, el cronometraje y el montaje en CapCut, manteniéndose fuera del texto de los prompts de video para evitar contaminar la generación visual y acústica Foley.
[/?VOZ_NARRATIVA_EN_CLIPS]
  * ⚠️ OBLIGACIÓN INQUEBRANTABLE DEL PÁRRAFO INICIAL DE 9 LÍNEAS ANTES DE "Image 1: Create an image": Al comienzo obligatorio del primer envío de prompts de esta Etapa 7 (ya sea al inicio del Bloque 1 si se eligió de 10 en 10, o al inicio de la lista completa si se eligió todos juntos), queda TERMINANTEMENTE PROHIBIDO empezar directamente con "Image 1: Create an image". La respuesta de la IA DEBE COMENZAR OBLIGATORIA Y LITERALMENTE ESCRIBIENDO EN SU SALIDA EL SIGUIENTE PÁRRAFO INICIAL DE 9 LÍNEAS (sin omitir ni una sola línea) e inmediatamente debajo "Image 1: Create an image...":

  Actúa como un historiador, director de cine, y periodista profesional.
  Cambia los nombres de los clips a las primeras 6 palabras literales del prompt proveído pegado y enviado que incluyen la numeración.
  Usa omni flash para videos y nano banana 2.1 para imágenes iniciales de cada clip.
  Crea las imágenes primero y luego los clips usando cada imagen como fotograma inicial.
  Usa las imágenes de referencia de personas y lugares para generar las imágenes iniciales y los clips para mantener fidelidad visual.
  No hagas cambios de shot nunca en ningun clip (excepto en aquel clip específico donde el prompt indique expresamente hacer dos shots de 5 segundos cada uno porque la voz narrativa cambió de escena) y asegúrate de que los clips de video no hagan desapariciones ni transformaciones, la imagen inicial creada se usará para el inicio de cada clip.
  Divide la creación en batches de 10.
  rename everything adding _ as the blank spaces between words
  from 1 to 9 change them to 01 to 09

[?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]
  Image 1: Create an image of [escena principal clara con TIEMPO y LUGAR en formato [?SUB_OPCION_REELS=9X16]vertical 9:16[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal 16:9[/?SUB_OPCION_REELS], ej. a majestic 13th-century royal court hall in Paris, France, large limestone walls illuminated by flickering wall torches, colorful heraldic banners hanging], cinematic lighting, historical accuracy, no text.
  Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video featuring [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial, ej. a slow zoom-in on the grand stone hall, torches flickering naturally, dust motes dancing in the warm light, [DURACION_CLIP_1] seconds duration, strictly no voiceover]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name
[/?TEXTO_PANTALLA_CLIP_1]
[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]
  Image 1: Create an image of [escena principal clara con TIEMPO y LUGAR en formato [?SUB_OPCION_REELS=9X16]vertical 9:16[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal 16:9[/?SUB_OPCION_REELS] estrictamente con 'no text'], cinematic lighting, historical accuracy, no text.
  Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video featuring [1 movimiento suave de cámara + 1 acción física simple de [DURACION_CLIP_1]s, integrando el texto en pantalla seleccionado en la Etapa 6 con Ciudad, País, Tiempo en la línea 1 y Gancho en la línea 2]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech. fix the name (Nota para edición: luego en edición el usuario baja la velocidad del Clip 1 y lo lleva a [DURACION_CLIP_1_RALENTIZADO] segundos).
[/?TEXTO_PANTALLA_CLIP_1]

  Image 2: Create an image of [escena clara y concisa para Nano Banana 2.1 con TIEMPO y LUGAR manteniendo como máximo un solo '@' exclusivo para personas], cinematic lighting, historical accuracy, no text.
[?VOZ_NARRATIVA_EN_CLIPS=INCLUIR]
[?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]
[?DURACION_CLIPS=10_SEGUNDOS]
  Clip 2 ([VOZ_CLIP2_RANGE_10S]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial (first 2 seconds from 00:0[DURACION_CLIP_1] to 00:[DURACION_CLIP_1_RALENTIZADO_PAD] with pure Foley and no voiceover, narrative voice enters exactly at second 00:[DURACION_CLIP_1_RALENTIZADO_PAD])]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. [Oración de la voz narrativa correspondiente sin comillas ni paréntesis]. fix the name

  (Continuar consecutivamente con Image 3: Create an image of [escena simple y clara con tiempo y lugar, cinematic lighting, historical accuracy, no text.], Clip 3 ([VOZ_CLIP3_RANGE_10S]): Create a video showing [1 movimiento de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text. [Locución]. fix the name... manteniendo siempre prompts simples, concisos y directos para que la IA de video no cometa errores, cada clip como 1 shot continuo de 10s [o de 2 shots de 5s si la voz narrativa cambia de escena a mitad del clip], hasta completar el bloque de 10 clips [Clips 1 al 10]).
[/?DURACION_CLIPS]
[?DURACION_CLIPS=8_SEGUNDOS]
  Clip 2 ([VOZ_CLIP2_RANGE_8S]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial (first 2 seconds from 00:0[DURACION_CLIP_1] to 00:[DURACION_CLIP_1_RALENTIZADO_PAD] with pure Foley and no voiceover, narrative voice enters exactly at second 00:[DURACION_CLIP_1_RALENTIZADO_PAD])]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. [Oración de la voz narrativa correspondiente sin comillas ni paréntesis]. fix the name

  (Continuar consecutivamente con Image 3: Create an image of [escena simple y clara con tiempo y lugar, cinematic lighting, historical accuracy, no text.], Clip 3 ([VOZ_CLIP3_RANGE_8S]): Create a video showing [1 movimiento de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text. [Locución]. fix the name... manteniendo siempre prompts simples, concisos y directos hasta completar el bloque de 10 clips [Clips 1 al 10]).
[/?DURACION_CLIPS]
[/?SINCRONIZACION_CLIP_1]
[?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]
[?DURACION_CLIPS=10_SEGUNDOS]
  Clip 2 ([RAL_CLIP2_RANGE_10S]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. [Oración de la voz narrativa correspondiente sin comillas ni paréntesis]. fix the name

  (Continuar consecutivamente con Image 3: Create an image of [escena simple y clara con tiempo y lugar, cinematic lighting, historical accuracy, no text.], Clip 3 ([RAL_CLIP3_RANGE_10S]): Create a video showing [1 movimiento de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text. [Locución]. fix the name... manteniendo siempre prompts simples, concisos y directos hasta completar el bloque de 10 clips [Clips 1 al 10]).
[/?DURACION_CLIPS]
[?DURACION_CLIPS=8_SEGUNDOS]
  Clip 2 ([RAL_CLIP2_RANGE_8S]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. [Oración de la voz narrativa correspondiente sin comillas ni paréntesis]. fix the name

  (Continuar consecutivamente con Image 3: Create an image of [escena simple y clara con tiempo y lugar, cinematic lighting, historical accuracy, no text.], Clip 3 ([RAL_CLIP3_RANGE_8S]): Create a video showing [1 movimiento de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text. [Locución]. fix the name... manteniendo siempre prompts simples, concisos y directos hasta completar el bloque de 10 clips [Clips 1 al 10]).
[/?DURACION_CLIPS]
[/?SINCRONIZACION_CLIP_1]
[/?VOZ_NARRATIVA_EN_CLIPS]
[?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR]
[?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]
[?DURACION_CLIPS=10_SEGUNDOS]
  Clip 2 ([VOZ_CLIP2_RANGE_10S]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name

  (Continuar consecutivamente con Image 3: Create an image of [escena simple y clara con tiempo y lugar, cinematic lighting, historical accuracy, no text.], Clip 3 ([VOZ_CLIP3_RANGE_10S]): Create a video showing [1 movimiento de cámara + 1 acción física simple]. Ambient Foley: [sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name... manteniendo siempre prompts simples, concisos y directos sin voz narrativa hasta completar el bloque de 10 clips [Clips 1 al 10]).
[/?DURACION_CLIPS]
[?DURACION_CLIPS=8_SEGUNDOS]
  Clip 2 ([VOZ_CLIP2_RANGE_8S]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name

  (Continuar consecutivamente con Image 3: Create an image of [escena simple y clara con tiempo y lugar, cinematic lighting, historical accuracy, no text.], Clip 3 ([VOZ_CLIP3_RANGE_8S]): Create a video showing [1 movimiento de cámara + 1 acción física simple]. Ambient Foley: [sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name... manteniendo siempre prompts simples, concisos y directos sin voz narrativa hasta completar el bloque de 10 clips [Clips 1 al 10]).
[/?DURACION_CLIPS]
[/?SINCRONIZACION_CLIP_1]
[?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]
[?DURACION_CLIPS=10_SEGUNDOS]
  Clip 2 ([RAL_CLIP2_RANGE_10S]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name

  (Continuar consecutivamente con Image 3: Create an image of [escena simple y clara con tiempo y lugar, cinematic lighting, historical accuracy, no text.], Clip 3 ([RAL_CLIP3_RANGE_10S]): Create a video showing [1 movimiento de cámara + 1 acción física simple]. Ambient Foley: [sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name... manteniendo siempre prompts simples, concisos y directos sin voz narrativa hasta completar el bloque de 10 clips [Clips 1 al 10]).
[/?DURACION_CLIPS]
[?DURACION_CLIPS=8_SEGUNDOS]
  Clip 2 ([RAL_CLIP2_RANGE_8S]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name

  (Continuar consecutivamente con Image 3: Create an image of [escena simple y clara con tiempo y lugar, cinematic lighting, historical accuracy, no text.], Clip 3 ([RAL_CLIP3_RANGE_8S]): Create a video showing [1 movimiento de cámara + 1 acción física simple]. Ambient Foley: [sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name... manteniendo siempre prompts simples, concisos y directos sin voz narrativa hasta completar el bloque de 10 clips [Clips 1 al 10]).
[/?DURACION_CLIPS]
[/?SINCRONIZACION_CLIP_1]
[/?VOZ_NARRATIVA_EN_CLIPS]
-> ALTO INQUEBRANTABLE: La IA entrega el bloque de 10 clips y concluye su respuesta deteniéndose. Espera la confirmación del usuario para entregar el siguiente bloque (Clips 11 al 13 o restantes, el cual iniciará directamente con Image 11: Create an image [prompt], Clip 11 (01:36 - 01:46): Create a video [prompt], sin la orden operativa). Una vez completados y entregados todos los clips de video del proyecto, la IA pasará obligatoriamente a la Etapa 9 (Corrección de Captions Automáticos de CapCut [Archivo .srt] con la Voz Narrativa Original). NO generes el archivo .srt, la banda sonora ni la metadata de publicación en esta etapa.

ETAPA 9: CORRECCIÓN DE CAPTIONS AUTOMÁTICOS DE CAPCUT (ARCHIVO .SRT) CON LA VOZ NARRATIVA ORIGINAL Y ENTREGA EN FORMATO .SRT DESCARGABLE (MANTENIENDO TIMESTAMPS DE CAPCUT)
Una vez que se hayan generado y entregado todos los clips de imágenes iniciales y videos de la Etapa 8, y el usuario haya montado el proyecto en CapCut y exportado los subtítulos automáticos (Auto Captions) en formato .srt, esta etapa tiene como propósito corregir todas las palabras mal escritas por el reconocedor automático de CapCut contrastándolas con nuestra Voz Narrativa Original de la Etapa 4, pero manteniendo intactos los timestamps de CapCut y devolviendo un archivo .srt descargable listo:
- Solicitud Obligatoria del Archivo .srt de CapCut (Fase 1 con ALTO INQUEBRANTABLE):
  Al entrar a la Etapa 9, la IA formulará obligatoriamente la siguiente instrucción al usuario:
  "Por favor, adjunta el archivo .srt (o pega su contenido) exportado de los captions automáticos de CapCut. Lo revisaré línea por línea comparándolo con nuestra Voz Narrativa Original (Etapa 4) para corregir todas las palabras mal escritas, nombres históricos, cifras y signos de puntuación, manteniendo intactos los timestamps exactos de CapCut, y te devolveré otro archivo en formato .srt descargable listo para importar en CapCut."
  -> ALTO INQUEBRANTABLE: La IA concluye su respuesta deteniéndose aquí y espera a que el usuario suba o pegue el archivo .srt de CapCut antes de continuar.
- Protocolo Inquebrantable de Corrección y Generación del Archivo .srt Descargable (Fase 2 tras recibir el .srt del usuario):
  Una vez que el usuario proporcione el archivo o texto .srt de CapCut, la IA procesará y devolverá el archivo .srt corregido cumpliendo estrictamente estas 4 leyes:
  1. Cotejo Fiel con la Voz Narrativa Original (Etapa 4) y Arreglo de Cantidades a Formato "70 mil": La IA comparará cada bloque de subtítulo del .srt contra el guion exacto de la Voz Narrativa Original aprobado en la Etapa 4. Corregirá toda palabra mal escrita, confusión fonética de CapCut, nombres propios de personajes históricos, dinastías, ciudades, lugares, términos de época, ortografía, tildes, años en dígitos numéricos (ej. 1888), siglos en números romanos (ej. siglo XIX), nombres con número en números romanos (ej. Felipe II Augusto, Luis XIV), y hará el arreglo si es necesario en todas las cantidades de miles o millones para que números como "setenta mil" o "70,000" / "70.000" / "70000" queden escritos obligatoriamente como "70 mil" (ej. "70 mil", "10 mil", "300 mil", "2 millones").
  2. Inmutabilidad Absoluta de los Timestamps y Numeración de CapCut: Queda TERMINANTEMENTE PROHIBIDO modificar, desplazar, recalcular, unir o dividir los timestamps (00:00:XX,XXX --> 00:00:XX,XXX) o alterar la numeración correlativa de los bloques generados por CapCut. Cada bloque del archivo .srt devuelto debe conservar milimétrica e idénticamente el número de bloque y el código de tiempo de inicio y fin original de CapCut, sustituyendo única y exclusivamente el texto mal transcrito por las palabras exactas que se pronuncian en ese segmento según nuestra Voz Narrativa Original.
  3. Entrega Obligatoria en Bloque de Código Limpio Copiable en 1 Clic (y Archivo .srt Descargable si el Motor lo Soporta): Si la plataforma de IA permite generar archivos descargables, entregará el archivo físico 'captions_corregidos.srt'; y SIEMPRE E INELUDIBLEMENTE (especialmente en Gemini, donde el chat entrega texto) mostrará el contenido íntegro del nuevo archivo .srt dentro de un ÚNICO BLOQUE DE CÓDIGO LIMPIO (\`\`\`srt ... \`\`\`) sin ningún texto introductorio ni comentarios dentro del bloque, para que el usuario pueda presionar el botón "Copiar" de Gemini en un solo clic y descargarlo directamente como archivo .srt en nuestra aplicación generadora (usando el botón "📥 Pegar de Gemini y Descargar .SRT").
  4. Pregunta obligatoria de validación: "¿Has descargado el archivo .srt corregido y estás listo para pasar a la Etapa 10 (Prompt Técnico de la Banda Sonora en Suno)?"
-> ALTO INQUEBRANTABLE: La IA entrega exclusivamente el archivo .srt descargable corregido con los timestamps originales de CapCut y concluye su respuesta deteniéndose. Espera la confirmación del usuario antes de pasar a la Etapa 10 (Banda Sonora en Suno). Queda terminantemente prohibido generar la banda sonora ni la metadata en esta etapa.

ETAPA 10: PROMPT TÉCNICO DE LA BANDA SONORA (SUNO)
- Regla Inquebrantable de Cero Archivo de Video: Para este tipo de producción (Reels y Timelapse), la IA NO debe pedir el archivo de video (queda terminantemente prohibido pedir al usuario que suba o adjunte el archivo de video, ya que la banda sonora se estructura y planifica a partir del guion de locución y el timeline de clips previamente acordados).
- Consulta Obligatoria de Duración Exacta del Video (Fase 1 con ALTO INQUEBRANTABLE):
  Antes de generar los prompts de Suno, la IA formulará obligatoriamente la siguiente pregunta:
  "¿Cuál es la duración exacta del video final montado en CapCut (en minutos y segundos) para estructurar la banda sonora en Suno?"
  -> ALTO INQUEBRANTABLE: La IA concluye su respuesta deteniéndose aquí y espera la confirmación del usuario con la duración exacta antes de generar las pistas musicales.
- Determinación Inteligente de Canciones, Silencios entre Cada Canción y Última Canción de Solo 1:30 en Suno (Fase 2 tras la respuesta del usuario):
  A partir de la duración exacta informada por el usuario, la IA calcula y determina CUÁNTAS CANCIONES SERÁN NECESARIAS y LA DURACIÓN EXACTA DE CADA UNA:
  * Límites Técnicos Inquebrantables de Suno:
    - Duración MÁXIMA por pista en Suno: 6 minutos (06:00).
    - Duración MÍNIMA por pista en Suno: 1 minuto (01:00).
  * Regla Inquebrantable de Silencios entre Cada Canción (Pausas sin Música entre Pistas):
    - Es OBLIGATORIO dejar silencios musicales entre cada canción (de unos 10 a 20 segundos o el margen dramático que marque el cambio de escena/acto, donde el video queda únicamente con la voz narrativa y el audio Foley ambiental sin música de fondo).
    - Queda terminantemente prohibido pegar una canción tras otra sin pausa; entre el final de una canción y el inicio de la siguiente siempre debe existir e indicarse explícitamente un intervalo de silencio musical en el timeline.
  * Regla Inquebrantable de la Última Canción de Solo 1:30 (01:30):
    - La ÚLTIMA canción de la banda sonora debe tener OBLIGATORIA E INQUEBRANTABLEMENTE una duración exacta de solo 1:30 (1 minuto y 30 segundos), cubriendo el último minuto y medio del video hasta su cierre final (ej. si el video dura 12:00, la última canción dura 1:30 y cubre 10:30 - 12:00; o si es un video corto de una sola canción de cierre, su duración será de 1:30).
  * Criterio de Partición Narrativa y Acústica:
    - La cantidad de canciones y su duración no es una división matemática genérica, sino que se diseña minuciosamente dependiendo del video, la época histórica, las escenas concretas que cubre cada tramo, la intención emocional y los momentos de tensión o clímax, respetando siempre los silencios entre cada canción y que la última canción sea de solo 1:30.
    - Si el video dura más de 6 minutos (ej. 8, 10, 12 o más minutos): Es OBLIGATORIO dividir la banda sonora en múltiples canciones (cada una entre 1:00 y 6:00 minutos) dejando un silencio musical entre cada canción y cerrando obligatoriamente con una última canción de solo 1:30 (ej. para un video de 12:00: Canción 1 [00:00 - 05:00] de 5:00 min -> Silencio sin música [05:00 - 05:15] -> Canción 2 [05:15 - 10:15] de 5:00 min -> Silencio sin música [10:15 - 10:30] -> Última Canción [10:30 - 12:00] de 1:30 min).
    - Si el video dura hasta 6 minutos (y más de 2:30): Dividir dejando silencio entre canciones y asegurando que la última canción sea de solo 1:30 (y si dura alrededor de 1:30 a 2:00, generar la pista de 1:30).
    - Si el video dura menos de 1 minuto (ej. 30s-45s): Generar 1 pista de 1:00 minuto (el mínimo de Suno) indicando en edición aplicar corte o fade-out al segundo final.
- Regla de Variación y Personalización Dinámica de la Banda Sonora (Cero Repetición):
  Queda terminantemente prohibido utilizar prompts genéricos o bandas sonoras repetitivas. Cada banda sonora debe ser una composición sonora original y única, diseñada a la medida exacta del episodio: la IA debe analizar las escenas específicas, la civilización histórica, la geografía y el arco de tensión dramática del guion para seleccionar una instrumentación de época real y autóctona, calibrando el tempo (BPM) y la dinámica emocional según los giros narrativos particulares del metraje.
- Estructura Obligatoria de Entrega de Cada Canción (en este orden estricto e inquebrantable para cada una de las canciones determinadas, indicando los silencios entre cada canción y garantizando que la última canción sea de solo 1:30):
  1. Título: [Título conceptual de la canción o pista musical, ej. Canción 1: "Las Calles de Whitechapel", Última Canción: "El Veredicto Final"]
  2. Duración: [Duración exacta de la canción para Suno, respetando entre 1:00 y 6:00 minutos en las primeras pistas y OBLIGATORIAMENTE 1:30 en la última canción]
  3. De dónde a dónde cubre en el video en tiempo: [Intervalo cronológico exacto que cubre en el timeline del video dejando los silencios entre cada canción, ej. Canción 1: 00:00 - 05:00 (Silencio musical de 05:00 a 05:15), Canción 2: 05:15 - 10:15 (Silencio musical de 10:15 a 10:30), Última Canción (1:30): 10:30 - 12:00]
  4. Prompt de Lyrics: [Metatags estructurales en corchetes para el campo 'Lyrics' de Suno para guiar la evolución musical sin generar voces, ej:
     [Instrumental]
     [Cinematic Overture]
     [Slow Period Suspense Build]
     [Heavy Period Drums and Dark Brass]
     [Melancholic Resolution Climax]
     [Quiet Fading Outro]
     (Estrictamente sin letras, sin canto y sin voz humana)]
  5. Prompt de Style: [Prompt técnico 100% en inglés para el campo 'Style of Music' de Suno, detallando género cinemático, tempo/BPM, instrumentación de época auténtica, atmósfera y directivas negativas, ej:
     Cinematic orchestral score, historical period tension, dark classical suspense, authentic period instrumentation (gut strings, lute, cathedral bells, war drums, dark brass, ritual percussion, duduk), dynamic emotional arc, slow to mid tempo 68 bpm, strictly instrumental only, no vocals, no singing, no speech, no lyrics]
  6. Explicación de la Canción: [Explicación detallada de cómo suena la canción, qué instrumentos históricos o tradicionales intervienen y cuál es la intención dramática y emocional según las escenas específicas que cubre en el metraje]
- Pregunta obligatoria de validación: "¿Has generado y validado las pistas de la banda sonora en Suno con estos prompts musicales y estás listo para proceder con la metadata para subir el video (Etapa 11)?"
-> ALTO INQUEBRANTABLE: La IA entrega exclusivamente los prompts técnicos musicales de Suno y concluye su respuesta deteniéndose. Queda terminantemente prohibido generar la metadata de publicación en esta respuesta sin esperar la confirmación del usuario.

ETAPA 11: METADATA PARA SUBIR EL VIDEO (ENTREGA POSTERIOR)
Una vez validada y confirmada la banda sonora de la Etapa 10, en una interacción posterior la IA generará la metadata de publicación en formato "Todo Corrido" y SIN encabezados de sección (recordando que para ninguna producción necesitamos el encabezado de las secciones de la metadata excepto el de los Capítulos:; cero "Título:", cero "Descripción:", cero "Nota IA:", cero "Slogan:", cero "Hashtags:", cero "Tags:", cero "Comentario Fijado:"):
- Consulta y Selección de Plataforma: La IA debe generar la metadata adaptada a la plataforma específica que el usuario le pida. Si el usuario no la especifica al solicitar la metadata, la IA le preguntará: "¿Para qué plataforma deseas la metadata? (Facebook/TikTok [3000 caracteres, sin tags], Instagram [máximo 1200 caracteres, sin tags], o YouTube [3000 caracteres + 500 caracteres de tags tras los hashtags]) o indica si prefieres que te entregue las tres opciones":
  1. Facebook / TikTok:
     - Extensión: Exactamente 3000 caracteres contando espacios y líneas braille (⠀), medidos de forma continua DESDE el inicio del título HASTA el final de los 5 hashtags.
     - Sin Tags: Queda terminantemente prohibido incluir bloque de tags ("no tags").
  2. Instagram:
     - Extensión Máxima: Hasta un máximo estricto de 1200 caracteres contando espacios y líneas braille (⠀), medidos de forma continua DESDE el inicio del título HASTA el final de los 5 hashtags.
     - Sin Tags: Queda terminantemente prohibido incluir bloque de tags ("no tags").
  3. YouTube:
     - Extensión principal: Exactamente 3000 caracteres contando espacios y líneas braille (⠀), medidos de forma continua DESDE el inicio del título HASTA el final de los 5 hashtags.
     - Regla Inquebrantable de Capítulos en YouTube (Prohibido Poner "Prólogo" en el Primer Capítulo): En la metadata de YouTube, cuando se incluyan los capítulos (con el único encabezado permitido "Capítulos:"), NUNCA pongas el primer capítulo (00:00) como "Prólogo" (ni "Introducción", "Intro" o "Inmersión Visual"), sino OBLIGATORIAMENTE como parte directa de la historia (nombrando el hecho, escenario o acontecimiento histórico inicial del relato).
     - Bloque de Tags SEO (500 Caracteres): Inmediatamente después de los 5 hashtags (separado por una línea invisible con braille ⠀) y antes del comentario fijado, se incluye un bloque de tags SEO separados por comas de exactamente 500 caracteres contando espacios y comas.
- Calibración de la Descripción en 3 Párrafos: La IA debe calibrar la longitud de la descripción (distribuida armónicamente en sus 3 párrafos) para cumplir con la cifra de la plataforma solicitada (3000 caracteres para Facebook/TikTok y YouTube; hasta 1200 caracteres para Instagram).
- Regla Inquebrantable de División de la Descripción en 3 Párrafos: El cuerpo de la descripción del video debe redactarse y estructurarse obligatoria e inquebrantablemente en EXACTAMENTE TRES (3) PÁRRAFOS, separados entre sí por una línea invisible con carácter braille (⠀). Queda terminantemente prohibido redactar la descripción como un solo bloque macizo de texto o dividirla en dos, cuatro o más párrafos. Los 3 párrafos deben distribuir armónicamente la narrativa histórica (Párrafo 1: Gancho histórico y planteamiento inicial; Párrafo 2: Contexto, personajes clave y tensión central; Párrafo 3: Consecuencias históricas, legado o revelación final envolvente).
- Regla Inquebrantable de No Repetición entre Miniatura, Título y Texto en Pantalla en los Primeros [DURACION_CLIP_1_RALENTIZADO] Segundos (y Libertad en el Resto de la Metadata): Lo que NO podemos hacer bajo ningún concepto es repetir lo mismo entre la Miniatura, el Título del video y el Texto en pantalla en los primeros [DURACION_CLIP_1_RALENTIZADO] segundos; estos tres elementos deben ser distintos entre sí y complementarse sin repetirse. En cambio, en lo demás de la metadata (los 3 párrafos de la descripción, capítulos, etc.) no importa que se repitan algunas palabras.
- Regla de Años, Siglos, Nombres con Número, 'a.C.' y 'd.C.': Todos los años deben escribirse siempre en número (dígitos, ej: 1888, 1945), nunca en letras; todos los siglos deben escribirse obligatoriamente en números romanos con mayúsculas (ej: siglo XII, siglo XIX, siglo XXI), jamás en números arábigos ni en letras (prohibido "siglo 12" o "siglo doce"); todos los nombres propios históricos con número (monarcas, papas, emperadores, faraones o dinastías, como Felipe II Augusto, Luis XIV, Enrique VIII, Carlos V, Juan Pablo II) deben escribirse SIEMPRE en números romanos (ej: Felipe II Augusto), quedando terminantemente prohibido escribir el número en palabras (prohibido "Felipe Segundo Augusto") o en dígitos arábigos; y en las descripciones y metadata, las referencias de era deben escribirse obligatoriamente en siglas ('a.C.' y 'd.C.', ej: '44 a.C.', 'siglo V a.C.'), nunca en palabras completas.
- Estructura y Orden Inalterable de Entrega (Texto Corrido sin Encabezados de Sección):
  (Recordatorio estricto: Para ninguna producción se escribe el encabezado de las secciones de la metadata excepto el de 'Capítulos:'. Entregar cada bloque como texto directo sin rótulos ni etiquetas)
  1. Título inmersivo directo (sin anteponer "Título:") para formato [?SUB_OPCION_REELS=9X16]vertical[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal[/?SUB_OPCION_REELS] (con los años en números, siglos en números romanos y nombres con número en números romanos como Felipe II Augusto). REGLA OBLIGATORIA PARA VIDEOS DE MÁS DE 8 MINUTOS: Si el video tiene una duración de más de 8 minutos, el título DEBE FINALIZAR OBLIGATORIAMENTE con el sufijo " | Documental Completo" (ej. "[Título Inmersivo] | Documental Completo"). Para videos de hasta 8 minutos, termina con un separador "|" y una palabra clave corta referente al tema (sin sufijo de IA ni "| Huellas de la Humanidad").
  2. Línea invisible con carácter braille (⠀).
  3. Descripción densa, contextual y envolvente adaptada a formato [?SUB_OPCION_REELS=9X16]vertical[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal[/?SUB_OPCION_REELS] (sin anteponer "Descripción:", dividida obligatoriamente en 3 párrafos separados entre sí por una línea invisible con carácter braille [⠀], con todos los años en números y tanto los siglos como los nombres con número [ej. Felipe II Augusto] obligatoriamente en números romanos):
     - Párrafo 1 de la Descripción
     - Línea invisible con carácter braille (⠀)
     - Párrafo 2 de la Descripción
     - Línea invisible con carácter braille (⠀)
     - Párrafo 3 de la Descripción
  4. Línea invisible con carácter braille (⠀).
  5. Nota IA directa (sin anteponer "Nota IA:", Escudo de IA obligatorio: "video" para 9x16 o "documental" para 16:9):
     (Nota: Este [?SUB_OPCION_REELS=9X16]video[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]documental[/?SUB_OPCION_REELS] inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
  6. Línea invisible con carácter braille (⠀).
  7. Slogan directo de la marca (sin anteponer "Slogan:"):
     Cada historia deja una huella. Aquí seguimos sus rastros.
  8. Línea invisible con carácter braille (⠀).
  9. Exactamente 5 hashtags directos (sin anteponer "Hashtags:") en español y formato #CamelCase referentes al tema del video, donde CADA UNO DE LOS 5 HASHTAGS DEBE ESTAR COMPUESTO OBLIGATORIAMENTE POR EXACTAMENTE DOS PALABRAS (ej. #ImperioRomano, #EdadMedia, #MisterioHistorico, #RevolucionFrancesa, #GuerraMundial; prohibido usar hashtags de una sola palabra o de tres o más palabras; en videos de más de 8 minutos de duración, #DocumentalEnEspañol es obligatorio dentro de los 5 hashtags).
     (Aquí concluye estrictamente el conteo de los 3000 caracteres para Facebook/TikTok y YouTube, o de hasta 1200 caracteres para Instagram).
  10. [Exclusivo para YouTube]: Línea invisible con carácter braille (⠀) seguida del bloque de Tags SEO directos (sin anteponer "Tags:" ni "Tags SEO:") de exactamente 500 caracteres separados por comas (sin tags en Facebook, TikTok ni Instagram).
  11. Línea invisible con carácter braille (⠀).
  12. Comentario fijado directo (sin anteponer "Comentario Fijado:", CTA natural que invite a la audiencia a contar una experiencia o vivencia propia vinculada al tema, jamás pedir simplemente "dale like", sin etiqueta).
- Pregunta obligatoria de transición a Post-Producción (Etapa 12): Al final de la entrega de la metadata, la IA indicará obligatoriamente al usuario:
  "¡Metadata completada! Una vez publicado el video, entramos en la Etapa 12 (Post-Producción: Respuestas a Comentarios de la Audiencia). A medida que tu audiencia comente el video, ve enviándome capturas de pantalla (imágenes) o el texto de los comentarios y te ayudaré a responderlos de forma certera y concisa."

ETAPA 12: ASISTENCIA POST-PRODUCCIÓN PARA RESPONDER COMENTARIOS DE LA AUDIENCIA (MEDIANTE CAPTURAS DE PANTALLA O TEXTO — RESPUESTAS CERTERAS Y CONCISAS)
Después de toda la producción y una vez publicado el video en redes, el usuario irá enviándole a la IA capturas de pantalla (imágenes) o texto de los comentarios de la audiencia en los videos para que la IA le ayude a responderlos de forma certera y concisa:
- Protocolo Inquebrantable de Respuesta a Comentarios:
  1. Lectura de Capturas de Pantalla (Visión) o Texto: Cada vez que el usuario adjunte o pegue una captura de pantalla de comentarios (o escriba el comentario), la IA leerá con precisión el nombre del comentarista, el comentario exacto (y su tono: duda histórica, elogio, debate, corrección o experiencia personal) y el contexto del episodio producido.
  2. Respuestas Certeras y Concisas (Tono Huellas de la Humanidad): Por cada comentario en la captura, la IA redactará una respuesta CERTERA (históricamente exacta, aguda, fundamentada en la investigación del episodio y que aporte un dato de valor o cierre reflexivo) y CONCISA (directa al grano, de 1 a 3 oraciones cortas, sin rodeos ni párrafos largos, lista para copiar y pegar).
  3. Cumplimiento de Reglas Editoriales en las Respuestas: Mantener el tono sobrio, culto, cercano y respetuoso de Huellas de la Humanidad; escribir todos los años en dígitos numéricos, siglos en números romanos (ej. siglo XIX) y nombres con número en números romanos (ej. Felipe II Augusto, Luis XIV), sin usar signos de exclamación exagerados y fomentando la conversación en la comunidad.
  4. Si el usuario desea explorar distintos enfoques para un comentario polémico o complejo, la IA ofrecerá 2 opciones breves (Opción 1: Histórica/Informativa concisa; Opción 2: Reflexiva/Comunidad concisa) para que el usuario elija y copie en un clic.
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=NOTEBOOKLM_VIDEO]
PROTOCOLO SECUENCIAL DE EJECUCIÓN OBLIGATORIO: VIDEO AUTOMATIZADO / AUTO REELS CON GOOGLE NOTEBOOKLM (EN 8 ETAPAS POR SEPARADO)
En este tipo de producción no se generan prompts individuales de clips ni de imágenes por fotogramas. La IA debe ejecutar obligatoriamente la producción en ocho (8) etapas separadas y secuenciales con ALTO INQUEBRANTABLE entre cada una:

ETAPA 1: SOLICITUD Y DEFINICIÓN DEL TEMA DOCUMENTAL
Antes de redactar cualquier prompt de investigación, la IA DEBE SOLICITAR OBLIGATORIAMENTE AL USUARIO los datos clave del episodio:
1. Tema central o acontecimiento histórico a recrear.
2. Personaje(s) protagónico(s), colectivo humano o figuras históricas en conflicto (escribiendo siempre en números romanos cualquier nombre con número, ej. Felipe II Augusto, Luis XIV).
3. Época precisa (años en dígitos numéricos y siglos siempre en números romanos, ej. siglo XII, siglo XIX) y locaciones geográficas (ciudades, imperios, escenarios).
4. El misterio central, tensión no resuelta, paradoja o tesis inédita que estructurará el relato.
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la respuesta del usuario con la temática confirmada. Queda terminantemente prohibido generar prompts de investigación o video sin recibir estos datos previos.

ETAPA 2: PROMPT MAESTRO DE INVESTIGACIÓN PROFUNDA PARA GOOGLE NOTEBOOKLM
Una vez confirmado el tema, la IA redactará un PROMPT MAESTRO DE INVESTIGACIÓN exhaustivo y riguroso para ser pegado directamente en Google NotebookLM como instrucción de análisis o para guiar la búsqueda y curaduría de fuentes. Este prompt maestro debe exigir a NotebookLM:
- Rastreo y cruce de fuentes históricas primarias y secundarias académicas fidedignas.
- Cronología milimétrica de los acontecimientos sin anacronismos.
- Detección de contradicciones históricas, paradojas, mitos populares desmentidos y datos insólitos poco conocidos.
- Fichas biográficas concisas de las figuras clave con sus motivaciones psicológicas reales.
- Citas textuales históricas documentadas y testimonios de la época.
- Síntesis organizada en bloques temáticos para alimentar la creación audiovisual.
Al pie del prompt, la IA formulará la siguiente pregunta de confirmación: "Copia y pega este prompt en Google NotebookLM junto con tus fuentes o úsalo para realizar la investigación profunda. Una vez que tengas las notas y fuentes cargadas en tu cuaderno de NotebookLM, confírmamelo para proceder a definir el estilo cinematográfico del documental."
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la confirmación del usuario tras haber realizado la investigación en NotebookLM. Queda terminantemente prohibido generar propuestas de estilo o prompts de video en esta respuesta.

ETAPA 3: CONSULTA, PROPUESTA Y SELECCIÓN DEL ESTILO CINEMATOGRÁFICO DEL VIDEO
Una vez que el usuario confirme que las notas y fuentes están cargadas y listas en NotebookLM, y ANTES de redactar el Prompt Maestro de Creación de Video, la IA DEBE CONSULTAR OBLIGATORIAMENTE AL USUARIO EL ESTILO CINEMATOGRÁFICO DE LA PRODUCCIÓN:
- Propuesta Obligatoria de Opciones: La IA no puede asumir ningún estilo cinematográfico por defecto sin consultar previamente. Debe proponer al usuario entre 3 y 5 opciones concretas de estilos cinematográficos diferenciados, detallando su atmósfera, esquema de iluminación, textura visual y tono dramático adaptados a la época y al conflicto del episodio.
  (Ejemplos de estilos cinematográficos a sugerir y adaptar según la temática):
  1. Documental de Época Hiperrealista / Claroscuro Dramático (Estilo BBC / Rembrandt): Iluminación naturalista de antorchas, velas o luz difusa de ventana, sombras profundas, texturas orgánicas palpables (madera, piedra, telas desgastadas) y solemnidad histórica inmersiva.
  2. Cine Épico Histórico / Gran Angular Monumental (Estilo Ridley Scott / Gladiator / Kingdom of Heaven): Atmósferas polvorientas, bruma matutina o humo de conflicto, escala colosal de masas y paisajes, planos aéreos majestuosos y dramatismo visual imponente.
  3. Misterio y Thriller Arqueológico / Film Noir Histórico: Claroscuro tenso, penumbras en catacumbas, pasadizos o callejones nocturnos, ángulos contrapicados, paleta fría o desaturada que potencia la conspiración, la intriga y los secretos no revelados.
  4. Crónica de Archivo y Celuloide Vintage (Estilo Documental Clásico 16mm/35mm): Grano fílmico visible, textura de celuloide histórico desgastado, tonalidades sepia o blanco y negro contrastado, evocando testimonios y crónicas desenterradas del pasado.
  5. Diorama Táctico y Cartografía Viva: Perspectiva visual analítica centrada en maquetas a escala, mapas antiguos en movimiento, planos tácticos y grabados en papel de época cobrando vida.
- Opción Abierta a Estilos Personalizados: La IA debe invitar explícitamente al usuario a seleccionar una de las opciones propuestas o a indicar cualquier otro estilo cinematográfico diferente que prefiera para el video ("o indícame otro estilo cinematográfico diferente que tengas en mente").
- Aclaración Inquebrantable de la Voz Narrativa (Prohibido Preguntar sobre la Voz): En esta etapa se consulta ÚNICA Y EXCLUSIVAMENTE el estilo cinematográfico visual. Queda estrictamente prohibido a la IA preguntar qué tipo o género de voz prefiere el usuario, ya que la voz narrativa de los auto reels es MASCULINA SIEMPRE (narrador único masculino documental cinematográfico predefinido).
- Pregunta obligatoria de confirmación: "¿Cuál de estos estilos cinematográficos prefieres para la atmósfera visual del video en NotebookLM, o prefieres indicarme otro estilo cinematográfico diferente?"
-> ALTO INQUEBRANTABLE: La IA entrega EXCLUSIVAMENTE la propuesta de estilos cinematográficos y concluye su respuesta deteniéndose. Espera la respuesta y elección del usuario. Queda TERMINANTEMENTE PROHIBIDO generar el Prompt Maestro de Creación de Video en esta respuesta sin haber acordado previamente el estilo cinematográfico con el usuario.

ETAPA 4: PROMPT MAESTRO PARA LA CREACIÓN DEL VIDEO EN GOOGLE NOTEBOOKLM (LA VOZ NARRATIVA DE LOS AUTO REELS ES MASCULINA SIEMPRE - MÁXIMO 4000 CARACTERES)
Una vez que el usuario confirme que la investigación está lista en NotebookLM, la IA generará el PROMPT MAESTRO DE CREACIÓN DE VIDEO optimizado para la herramienta de generación audiovisual/video overview de NotebookLM. Este prompt maestro debe estar rigurosamente calibrado para tener una extensión máxima de HASTA 4000 CARACTERES (contando espacios y saltos de línea), adaptándose estrictamente al límite de caracteres permitido por NotebookLM, y debe contener las siguientes directrices inquebrantables:
- Regla Inquebrantable: La Voz Narrativa de los Auto Reels es MASCULINA SIEMPRE (Cero Voces Femeninas y Prohibido Consultar al Usuario):
  La voz narrativa en los Auto Reels es MASCULINA SIEMPRE, de forma inalterable y no negociable. Queda TERMINANTEMENTE PROHIBIDO preguntar al usuario qué voz o género de voz prefiere (la IA jamás debe consultar si prefiere voz de hombre o mujer), y queda terminantemente prohibido utilizar, sugerir o generar prompts con voces femeninas o formato de podcast/debate con dos presentadores. La locución está predeterminada como un monólogo continuo de NARRADOR ÚNICO EN OFF CON VOZ MASCULINA DOCUMENTAL CINEMATOGRÁFICA (voz masculina profunda, grave, autoritaria, solemne, cálida e inmersiva de historiador y narrador de cine documental de élite de Huellas de la Humanidad, exclusivamente en idioma español neutro y arrancando en el segundo 00:06). En el prompt entregado para NotebookLM, se debe blindar expresamente la instrucción ordenando un narrador masculino único ('Narrated exclusively by a single deep, authoritative, masculine documentary cinematic voice in neutral Spanish, strictly solo male narrator, absolutely no female voices, no two-host dialogue').
1. Límite Estricto de Extensión (Hasta 4000 Caracteres): La longitud total del prompt no puede superar bajo ninguna circunstancia los 4000 caracteres contando espacios. La IA debe condensar al máximo las directrices narrativas y documentales sin rebasar jamás este tope. Al pie del prompt entregado, la IA debe indicar obligatoriamente el reporte de conteo: "Caracteres del Prompt: [número] / 4000".
2. Estilo de Narración y Perfil de Voz: NARRADOR ÚNICO EN OFF CON VOZ MASCULINA DOCUMENTAL CINEMATOGRÁFICA (Voz narrativa masculina siempre: profunda, solemne, autoritaria, cálida e inmersiva de historiador y narrador de cine documental de élite de Huellas de la Humanidad; monólogo cinematográfico continuo que inicia obligatoriamente a partir del segundo 00:06; NO formato debate ni diálogo de dos presentadores ni voces agudas/juveniles ni femeninas. La voz narrativa de los auto reels es masculina siempre).
3. Arquitectura de Audio Inicial (Primeros 6 Segundos de Puro Video con Audio Foley Sin Voz): Los primeros seis (6) segundos del video deben transcurrir rigurosamente SIN VOZ NARRATIVA (exclusivo video visual cinematográfico y audio Foley ambiental inmersivo: texturas acústicas reales, viento, pasos, crujidos o resonancias del entorno histórico). La voz narrativa en off masculina entra obligatoriamente en el segundo 00:06 del video para arrancar la locución.
4. Idioma, Cadencia y Formato de Siglos y Nombres con Número: LA VOZ NARRATIVA MASCULINA DEBE SER EXCLUSIVAMENTE EN IDIOMA ESPAÑOL (español neutro, cadencia documental cinematográfica grave y envolvente, rica en vocabulario histórico, dicción impecable y libre de modismos coloquiales, escribiendo todos los años en dígitos numéricos, todos los siglos en números romanos [ej. siglo XII, siglo XIX] y todos los nombres con número en números romanos [ej. Felipe II Augusto, Luis XIV, Enrique VIII, jamás "Felipe Segundo Augusto"]).
5. Estructura Dramática del Relato:
   - Gancho de Apertura y Entrada de Voz (Segundo 00:06): Los primeros 6 segundos sumergen al espectador con puro impacto visual y diseño sonoro Foley sin voz narrativa; al segundo 00:06 entra la voz en off con el anclaje inmediato en tiempo y lugar, planteando la contradicción o misterio central.
   - Desarrollo Tensional: Micro-ganchos narrativos continuos que exploran los descubrimientos de la investigación, desmintiendo mitos y sumergiendo al espectador en la atmósfera psicológica de los protagonistas.
   - Clímax y Cierre Reflexivo: Resolución de la tensión histórica y culminación solemne enlazando con la trascendencia del legado humano y el lema: "Cada historia deja una huella. Aquí seguimos sus rastros."
6. Dinámica Visual Híbrida (Duración Adaptativa por Escena y B-Roll de Imágenes):
   - Duración Inteligente según la Escena: Instruir explícitamente a NotebookLM para que decida y calibre de forma autónoma la duración de cada clip visual según las necesidades dramáticas de la escena (planos más breves y rítmicos en momentos de tensión o revelación rápida, y planos más pausados y extendidos en momentos de contemplación o clímax).
   - Combinación de Video con Imágenes B-Roll y Diversidad de Tomas: Indicar obligatoriamente a NotebookLM que alterne y combine de forma armónica secuencias de video en movimiento con imágenes estáticas de apoyo tipo B-roll, integrando explícitamente en la lista de tipos de tomas la toma tipo mapa (cartografía histórica y rutas de época), la toma de maqueta (dioramas o maquetas a escala de fortalezas, ciudades o batallas) y la toma de dibujo en papel en blanco y negro (bocetos a tinta, carboncillo o grabados históricos monocromáticos), junto a fotografías de época, documentos antiguos, retratos de personajes y planos detalle arqueológicos para enriquecer el lenguaje documental.
7. Estética Visual y Rigor Histórico bajo el Estilo Cinematográfico Acordado: Indicaciones explícitas e ineludibles para que toda la atmósfera visual, recreaciones, gráficos, transiciones, colorimetría e iluminación del video en NotebookLM sigan estrictamente las directrices del estilo cinematográfico acordado con el usuario en la Etapa 3 ([Nombre del Estilo Cinematográfico Seleccionado] y sus atributos visuales), sin elementos anacrónicos y con fidelidad histórica absoluta.
Al pie del prompt de video, la IA formulará la siguiente pregunta: "Pega este prompt en la sección de generación de video de Google NotebookLM para producir el documental con 6 segundos iniciales de puro video y Foley sin voz, voz narrativa masculina documental cinematográfica en español (recordando que la voz narrativa de los auto reels es masculina siempre) y el estilo cinematográfico acordado. Una vez generado el video: 1) por favor adjunta o proporciona el archivo de video generado (para analizar sus escenas reales, cortes y ritmo visual) y 2) confírmame su duración exacta en minutos y segundos para estructurar las canciones de la Banda Sonora en Suno."
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar a que el usuario valide el video, adjunte el archivo de video e indique la duración exacta antes de pasar a la banda sonora.

ETAPA 5: PROMPT TÉCNICO DE LA BANDA SONORA (SUNO)
- Regla Obligatoria de Solicitud de Archivo de Video Exclusiva para Auto Reels (NotebookLM):
  A diferencia de todos los demás tipos de video (donde queda estrictamente prohibido pedir el archivo de video), en los Auto Reels generados con NotebookLM la IA TIENE LA OBLIGACIÓN INQUEBRANTABLE DE PEDIR EL ARCHIVO DE VIDEO al usuario. Si el usuario no lo adjuntó al validar la Etapa 4, la IA debe solicitarlo expresamente antes de generar los prompts de música ("Por favor, adjunta o sube el archivo de video generado en NotebookLM para analizar su ritmo visual, cortes y escenas...") junto con la confirmación de la duración exacta en minutos y segundos, deteniéndose con ALTO INQUEBRANTABLE.
- Determinación Inteligente de Canciones, Silencios entre Cada Canción y Última Canción de Solo 1:30 en Suno (Límites Estrictos de 1 a 6 Minutos):
  A partir del análisis del archivo de video y de la duración exacta informada por el usuario:
  * La IA calcula y determina obligatoriamente CUÁNTAS CANCIONES SERÁN NECESARIAS y LA DURACIÓN EXACTA DE CADA UNA:
    - Límites Técnicos Inquebrantables de Suno:
      * Duración MÁXIMA por pista en Suno: 6 minutos (06:00).
      * Duración MÍNIMA por pista en Suno: 1 minuto (01:00).
    - Regla Inquebrantable de Silencios entre Cada Canción (Pausas sin Música entre Pistas):
      * Es OBLIGATORIO dejar silencios musicales entre cada canción (de unos 10 a 20 segundos o el margen dramático del cambio de escena/acto, donde el documental queda únicamente con la voz narrativa y el Foley ambiental sin música de fondo). Queda terminantemente prohibido pegar una canción inmediatamente después de otra sin silencio intermedio.
    - Regla Inquebrantable de la Última Canción de Solo 1:30 (01:30):
      * La ÚLTIMA canción de la banda sonora debe tener OBLIGATORIA E INQUEBRANTABLEMENTE una duración exacta de solo 1:30 (1 minuto y 30 segundos), cubriendo el último minuto y medio del documental hasta su cierre final.
    - Criterio de Partición Narrativa y Acústica:
      * La partición de pistas no es arbitraria ni fija, sino adaptada orgánicamente al video, la época histórica, las escenas concretas que abarca cada tramo, la intención dramática y el arco emocional (crescendos, tensión, clímax y desenlace), respetando siempre los silencios entre cada canción y que la última canción sea de solo 1:30.
      * Para videos de más de 6 minutos (lo común en documentales de NotebookLM, ej. 8, 10, 15, 20 o más minutos): Es OBLIGATORIO dividir la banda sonora en múltiples canciones (cada una entre 1:00 y 6:00 minutos) dejando silencios musicales entre cada canción y cerrando con la última canción de solo 1:30 (ej. en un documental de 14:30: Canción 1 [00:00 - 05:45] de 5:45 min -> Silencio sin música [05:45 - 06:00] -> Canción 2 [06:00 - 12:45] de 5:45 min o dos pistas intermedias -> Silencio sin música [12:45 - 13:00] -> Última Canción [13:00 - 14:30] de 1:30 min).
      * Para videos de hasta 6 minutos (y más de 2:30): Dividir dejando silencio entre canciones y asegurando que la última canción sea de solo 1:30 (y si dura alrededor de 1:30 a 2:00, generar la pista de 1:30).
      * Para videos de menos de 1 minuto: Generar 1 pista de 1 minuto (mínimo de Suno) indicando corte o fade-out en edición.
- Regla de Variación y Personalización Dinámica de la Banda Sonora (Cero Repetición):
  Queda terminantemente prohibido utilizar prompts genéricos o bandas sonoras repetitivas. Cada canción debe ser original y única, diseñada a la medida exacta de los temas, personajes, época y escenas concretas del video generado en NotebookLM.
- Estructura Obligatoria de Entrega de Cada Canción (en este orden estricto e inquebrantable para cada una de las canciones determinadas, indicando los silencios entre cada canción y garantizando que la última canción sea de solo 1:30):
  1. Título: [Título conceptual de la canción o pista musical, ej. Canción 1: "Las Sombras del Oráculo", Última Canción: "El Colapso del Imperio"]
  2. Duración: [Duración exacta de la canción para Suno, respetando entre 1:00 y 6:00 minutos en las pistas previas y OBLIGATORIAMENTE 1:30 en la última canción]
  3. De dónde a dónde cubre en el video en tiempo: [Intervalo cronológico exacto que cubre en el timeline del video dejando los silencios entre cada canción, ej. Canción 1: 00:00 - 05:45 (Silencio musical de 05:45 a 06:00), ..., Última Canción (1:30): 13:00 - 14:30]
  4. Prompt de Lyrics: [Metatags estructurales en corchetes para el campo 'Lyrics' de Suno para guiar la evolución musical sin generar voces, ej:
     [Instrumental]
     [Cinematic Documentary Intro]
     [Historical Period Tension Build]
     [Climactic Orchestral Swell]
     [Solemn Outro]
     (Estrictamente sin letras, sin canto y sin voz humana)]
  5. Prompt de Style: [Prompt técnico 100% en inglés para el campo 'Style of Music' de Suno, detallando género cinemático, tempo/BPM, instrumentación de época auténtica, atmósfera y directivas negativas, ej:
     Cinematic documentary orchestral score, historical period tension, authentic period instrumentation (gut strings, dark brass, ancient flutes, ritual drums), solemn dynamic arc, slow to mid tempo, strictly instrumental only, no vocals, no singing, no speech, no lyrics]
  6. Explicación de la Canción: [Explicación detallada de cómo suena la canción, qué instrumentos históricos o tradicionales intervienen y cuál es la intención dramática y emocional según las escenas específicas que cubre en el metraje]
- Pregunta obligatoria de validación: "¿Has generado y validado las pistas de la banda sonora en Suno con estos prompts musicales y estás listo para preparar el prompt técnico de la Miniatura oficial para Nano Banana 2.1?"
-> ALTO INQUEBRANTABLE: La IA entrega exclusivamente el prompt de Suno y concluye su respuesta deteniéndose. Espera la confirmación del usuario antes de pasar a la miniatura.

ETAPA 6: PROMPT TÉCNICO DE LA MINIATURA OFICIAL (NANO BANANA 2.1)
Una vez validada la banda sonora en Suno, la IA generará el prompt técnico para Nano Banana 2.1 para la portada/miniatura cinematográfica oficial del documental (en formato 16:9 horizontal de alta resolución):
- Redacción técnica 100% en idioma inglés iniciando con: "Image [16:9]: Create an image " (o "Imagen [16:9]: Create an image ").
- Relación de aspecto panorámica 16:9 (16:9 aspect ratio).
- Composición cinematográfica de portada: Un primer plano dramático o composición épica que concentre la emoción nuclear y el conflicto del episodio (rostro expresivo, iluminación de claroscuro, lentes anamórficos, hipertextura de época).
- Texto en Pantalla Obligatorio (Tipografía Cinematográfica de Portada): En las producciones de Auto Reels (NotebookLM), la miniatura TIENE QUE TENER texto en pantalla obligatoriamente. Debe incluir texto de alto impacto de 1 a 3 palabras contundentes con tipografía cinematográfica de alto contraste integrada orgánicamente en la composición (ej. 'bold high-contrast cinematic typography text overlay reading "[1 a 3 palabras de impacto]" cleanly integrated into the scene composition'), sintetizando la intriga, revelación o conflicto nuclear del documental sin repetir jamás lo mismo entre la miniatura, el título del video y el texto en pantalla de los primeros segundos.
- Integración obligatoria de los logos oficiales:
  1. En la parte superior derecha: Un logo pequeño al 5% que diga "8K" en dorado (metallic gold) creado directamente por la IA ('small discreet metallic gold "8K" logo in the top-right corner, 5% scale').
  2. En la parte superior izquierda: El logo oficial de la página al 5% a partir de la imagen de referencia suministrada por el usuario, preservando obligatoriamente el texto inferior ('maintain official page logo provided as reference image in the top-left corner at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text').
- Restricciones negativas estrictas: 'cinematic documentary realism, dramatic lighting, sharp focus, 8k resolution, no cartoon, no CGI artifacts, no modern elements, no unintended floating text, no typos, no watermark'.
- Pregunta obligatoria de validación: "Por favor genera y valida la miniatura en Nano Banana 2.1 con este prompt y la imagen de referencia del logo. ¿La miniatura generada cumple con tus expectativas y estás listo para redactar la metadata final de publicación?"
-> ALTO INQUEBRANTABLE: La IA debe detenerse aquí y esperar la validación de la miniatura antes de redactar la metadata.

ETAPA 7: METADATA PARA SUBIR EL VIDEO (PUBLICACIÓN EN REDES)
Una vez que el usuario apruebe la miniatura, la IA entregará la metadata final de publicación en formato "Todo Corrido", SIN encabezados de sección (para ninguna producción necesitamos el encabezado de las secciones de la metadata excepto el de los Capítulos:; cero "Título:", cero "Descripción:", cero "Nota IA:", cero "Slogan:", cero "Hashtags:", cero "Tags:", cero "Comentario Fijado:"), siendo el encabezado de "Capítulos:" el ÚNICO permitido en toda la entrega:
1. Título inmersivo directo (sin anteponer "Título:") con los años en números arábigos, siglos en números romanos y nombres con número en números romanos (ej. Felipe II Augusto), FINALIZANDO OBLIGATORIA E INQUEBRANTABLEMENTE con el sufijo " | Documental Completo" al final del título (ejemplo: "[Título Inmersivo] | Documental Completo"). Queda terminantemente prohibido omitir el sufijo " | Documental Completo" en cualquier video de NotebookLM.
2. Línea invisible con carácter braille (⠀).
3. Descripción envolvente (sin anteponer "Descripción:", con años en dígitos, siglos en números romanos y nombres con número como Felipe II Augusto en números romanos) dividida obligatoriamente en EXACTAMENTE TRES (3) PÁRRAFOS separados entre sí por una línea con carácter braille (⠀):
   - Párrafo 1: Gancho e introducción al misterio histórico.
   - Línea invisible con carácter braille (⠀).
   - Párrafo 2: Desarrollo del contexto, contradicción y hallazgos revelados.
   - Línea invisible con carácter braille (⠀).
   - Párrafo 3: Reflexión profunda sobre el impacto histórico y llamado al espectador.
4. [Exclusivo para YouTube - Sección Obligatoria de Capítulos / Timestamps]:
   Línea invisible con carácter braille (⠀) seguida obligatoriamente del encabezado "Capítulos:" (EL ÚNICO ENCABEZADO DE SECCIÓN PERMITIDO EN TODA LA METADATA) y la lista cronológica de EXACTAMENTE DIEZ (10) Capítulos con marcas de tiempo (timestamps) para activar los capítulos interactivos en el reproductor de YouTube, iniciando en 00:00 directamente como parte de la historia (NUNCA pongas el primer capítulo como "Prólogo", "Introducción" ni "Inmersión Visual", sino directamente como parte de la historia del video) y marcando la entrada de la locución en 00:06 tras los 6 segundos de Foley ambiental:
   Capítulos:
   00:00 - [Primer Capítulo Directo como Parte de la Historia (NUNCA poner "Prólogo")]
   00:06 - [Capítulo 2 / Planteamiento del Enigma y Voz Narrativa]
   [MM:SS] - [Capítulo 3 / Contexto y Antecedentes]
   [MM:SS] - [Capítulo 4 / Las Figuras Históricas]
   [MM:SS] - [Capítulo 5 / El Punto de Inflexión]
   [MM:SS] - [Capítulo 6 / La Paradoja o Conflicto Central]
   [MM:SS] - [Capítulo 7 / Revelaciones Inéditas o Hallazgos]
   [MM:SS] - [Capítulo 8 / El Clímax del Suceso]
   [MM:SS] - [Capítulo 9 / Consecuencias Históricas]
   [MM:SS] - [Capítulo 10 / Conclusión y Legado Eterno]
   (REGLAS INQUEBRANTABLES DE YOUTUBE: 1) NO PUEDE FALTAR EL ENCABEZADO "Capítulos:" bajo ninguna circunstancia, siendo este el único encabezado admisible en toda la metadata; 2) TIENEN QUE SER OBLIGATORIA Y ESTRICTAMENTE DIEZ (10) CAPÍTULOS con sus marcas de tiempo cronológicas acordes a la duración del metraje; 3) En los capítulos de YouTube NUNCA pongas el primer capítulo (00:00) como "Prólogo", sino OBLIGATORIAMENTE como parte de la historia del video [un título histórico sustantivo que narre el inicio del suceso], quedando TERMINANTEMENTE PROHIBIDO nombrarlo "Prólogo", "Introducción", "Inmersión Visual", "Intro", "Foley" o términos genéricos similares; en Facebook, Instagram y TikTok se omite por completo esta sección).
5. Línea invisible con carácter braille (⠀).
6. Nota IA oficial directa (sin anteponer "Nota IA:") para documental:
   (Nota: Este documental inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
7. Línea invisible con carácter braille (⠀).
8. Slogan oficial directo (sin anteponer "Slogan:"):
   Cada historia deja una huella. Aquí seguimos sus rastros.
9. Línea invisible con carácter braille (⠀).
10. Exactamente 5 hashtags directos (sin anteponer "Hashtags:") en español y formato #CamelCase referentes al tema del video, donde CADA UNO DE LOS 5 HASHTAGS DEBE ESTAR COMPUESTO OBLIGATORIAMENTE POR EXACTAMENTE DOS PALABRAS (ej. #ImperioRomano, #EdadMedia, #MisterioHistorico, #RevolucionFrancesa; con el hashtag #DocumentalEnEspañol OBLIGATORIO dentro de este bloque de 5 hashtags para todos los videos de NotebookLM).
   (Aquí concluye estrictamente el conteo de los 3000 caracteres para Facebook/TikTok y YouTube, o de hasta 1200 caracteres para Instagram).
11. [Exclusivo para YouTube]: Línea invisible con carácter braille (⠀) seguida del bloque de Tags SEO directos (sin anteponer "Tags:" ni "Tags SEO:") de exactamente 500 caracteres separados por comas (sin tags en Facebook, TikTok ni Instagram).
12. Línea invisible con carácter braille (⠀).
13. Comentario fijado directo (sin anteponer "Comentario Fijado:", CTA natural que invite a la audiencia a compartir una vivencia o reflexión propia vinculada al tema, jamás pedir simplemente "dale like", sin etiqueta).
- Pregunta obligatoria de transición a Post-Producción (Etapa 8): Al final de la entrega de la metadata, la IA indicará al usuario: "Una vez publicado el video, puedes ir enviándome capturas de pantalla (o texto) de los comentarios de la audiencia para ayudarte a responderlos de forma certera y concisa (Etapa 8)."

ETAPA 8: ASISTENCIA POST-PRODUCCIÓN PARA RESPONDER COMENTARIOS DE LA AUDIENCIA (CAPTURAS DE PANTALLA O TEXTO)
Después de completada toda la producción, el usuario irá enviándole a la IA capturas de pantalla (imágenes) o texto de los comentarios reales de la audiencia en los videos publicados:
- Por cada captura o comentario recibido, la IA leerá el comentario del espectador y redactará respuestas CERTERAS y CONCISAS (de 1 a 3 oraciones cortas, directas, con rigor histórico y el tono sobrio pero cercano de Huellas de la Humanidad, listas para copiar y pegar, respetando años en dígitos, siglos y nombres con número en números romanos y cero signos de exclamación).
[/?TIPO_PRODUCCION]
### FICHA TÉCNICA DEL EPISODIO ###
INSTRUCCIONES PARA EL EPISODIO ACTUAL:
[?TIPO_PRODUCCION=REELS|INMERSIVO_CONTEMPLATIVO|NOTEBOOKLM_VIDEO]
Tema del Video / Documental: [TEMA_DEL_VIDEO]
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=POST_EXPECTATIVA][?SUB_OPCION_POST=EXPECTATIVA_ESTRENO]
Tema del Video / Documental en Estreno: [TEMA_DEL_VIDEO]
[/?SUB_OPCION_POST][?SUB_OPCION_POST=EFEMERIDE]
Fecha de la Efeméride (dejar en blanco para día actual): [FECHA_EFEMERIDE]
[/?SUB_OPCION_POST][/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=TIMELAPSE]
Tema del Video: [TEMA_DEL_VIDEO]
Contradicción Central: [CONTRADICCION_CENTRAL]
Promesa Narrativa y Slogan Completo en Párrafo Aparte (Antes del segundo 30 de video / Todo el bloque desde "En los próximos minutos [explicación breve]" hasta "Aquí seguimos sus rastros." en párrafo aparte): [PROMESA_NARRATIVA]
Anclaje del Hook (Fecha o Lugar): [ANCLAJE_DEL_HOOK]
Imagen Final del Episodio: [IMAGEN_FINAL]
Orden de Creación de Imágenes con Banana 2.1 (Regla Inversa): En los videos timelapse, la creación de imágenes fijas se realiza obligatoria y exclusivamente con Nano Banana 2.1 (Banana 2.1) desde la última hacia la primera (de la culminación final a los cimientos o estado inicial).
Naturaleza de la Transición en Prompts de Clips: En los prompts de cada clip de video timelapse, la evolución visual debe ser obligatoriamente una transición constructiva gradual y continua, sin cambios bruscos ni saltos repentinos.
[/?TIPO_PRODUCCION]
[?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]
Sincronización de Clip 1 y Comienzo de Voz: El primer clip sin voz narrativa se creará de [DURACION_CLIP_1] segundos pero en ediciones CapCut yo le bajaré la velocidad y lo llevaré a [DURACION_CLIP_1_RALENTIZADO] segundos (Clip 1 cubre 00:00 - 00:[DURACION_CLIP_1_PAD] ralentizado a [DURACION_CLIP_1_RALENTIZADO]s [00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]], Clip 2 comienza en 00:[DURACION_CLIP_1_RALENTIZADO_PAD] y arranca directamente con la voz narrativa).
[/?SINCRONIZACION_CLIP_1]
[?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]
Sincronización de Clip 1 y Comienzo de Voz: El primer clip sin voz narrativa se creará de [DURACION_CLIP_1] segundos y la voz narrativa comenzará a partir de los primeros 2 segundos del segundo clip, entrando exactamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video (Clip 1 cubre 00:00 - 00:[DURACION_CLIP_1_PAD], Clip 2 inicia en 00:[DURACION_CLIP_1_PAD], sus primeros 2 segundos [00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]] son de Foley sin voz, y la voz entra en el segundo [DURACION_CLIP_1_RALENTIZADO] [00:[DURACION_CLIP_1_RALENTIZADO_PAD]], que es el segundo 2 del segundo clip).
[/?SINCRONIZACION_CLIP_1]
[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]
Texto en Pantalla del Clip 1: El texto en pantalla del primer clip lo creará la IA dentro del Clip 1 (integrado directamente en el prompt de video de Clip 1 con tipografía cinematográfica; Imagen 1 con 'no text').
[/?TEXTO_PANTALLA_CLIP_1]
[?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]
Texto en Pantalla del Clip 1: El texto en pantalla del primer clip lo insertaré en edición manual en CapCut (los prompts de Nano Banana 2.1 y Omni Flash llevan estrictamente 'no text'; la IA proporciona las opciones de texto en la Etapa 6 para montaje manual).
[/?TEXTO_PANTALLA_CLIP_1]
[?DURACION_CLIPS=10_SEGUNDOS]
Duración de Clips (a partir del Clip 2): 10 segundos (1 shot de 10s por defecto teniendo en cuenta las pausas de la voz narrativa [pausa: Xs]; en dado caso que una escena se vaya a demorar demasiado visualmente y ya la voz narrativa cambió a otra escena a mitad del clip, ese clip específico tendrá dos shots cada uno de 5 segundos).
[/?DURACION_CLIPS]
[?DURACION_CLIPS=8_SEGUNDOS]
Duración de Clips (a partir del Clip 2): 8 segundos (1 shot de 8s por defecto teniendo en cuenta las pausas de la voz narrativa [pausa: Xs]; en dado caso que una escena se vaya a demorar demasiado visualmente y ya la voz narrativa cambió a otra escena a mitad del clip, ese clip específico tendrá dos shots).
[/?DURACION_CLIPS]
[?VOZ_NARRATIVA_EN_CLIPS=INCLUIR]
Opción de Voz Narrativa en Prompts de Clips: Incluir (la porción del texto de la voz narrativa se anexa obligatoriamente al final de cada prompt de clip de video [desde Clip 2 en adelante] como una oración más sin comillas ni paréntesis).
[/?VOZ_NARRATIVA_EN_CLIPS]
[?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR]
Opción de Voz Narrativa en Prompts de Clips: Excluir (los prompts de video concluyen limpiamente tras el sufijo de barrera sonora 'no text, no speech, no music', sin incluir el texto de la locución en los clips; el guion se reserva exclusivamente para locución y montaje).
[/?VOZ_NARRATIVA_EN_CLIPS]
####################################

MANUAL MAESTRO DE PRODUCCIÓN ABSOLUTO Y DEFINITIVO: HUELLAS DE LA HUMANIDAD

VOLUMEN I: IDENTIDAD, FILOSOFÍA Y ARQUITECTURA NARRATIVA
Capítulo 1: La Razón de Ser y el Paradigma de la Experiencia
La historia, como disciplina, nunca ha carecido de información. Durante décadas, la humanidad ha redactado bibliotecas enteras, producido incontables documentales y erigido museos con el propósito fundamental de explicar el pasado. Sin embargo, la vasta mayoría de estos contenidos audiovisuales y literarios parten de una misma premisa estructural que hoy resulta obsoleta: observar los acontecimientos desde afuera. El ecosistema de producción de Huellas de la Humanidad nace con el imperativo de romper este paradigma. El objetivo del canal no radica en que el espectador memorice una fecha, aprenda el nombre de un monarca o entienda la táctica de una batalla de forma abstracta. El objetivo, mucho más ambicioso y complejo, es lograr que el usuario experimente de primera mano cómo pudo sentirse vivir dentro de ese preciso momento temporal.En este sistema, no nos limitamos a contar lo que ocurrió; nuestra función es reconstruir el mundo físico y emocional donde dicho evento tuvo lugar. Cuando se aborda la historia de una ciudad antigua, no se describe únicamente su topografía; se invita al espectador a caminar sensorialmente por sus calles. Cuando se narra la hegemonía de un imperio, se muestra cómo era despertar inmerso en su cotidianidad. Cada documental, cada plano y cada diseño sonoro debe trabajar en conjunto para reducir la distancia psicológica entre el presente y el pasado, hasta lograr que dicha distancia desaparezca por completo. El espectador debe dejar de sentirse frente a un producto audiovisual educativo y comenzar a percibir que está observando fragmentos orgánicos de una época desaparecida. Esa ilusión continua de presencia es el principio rector que define la identidad innegociable de Huellas de la Humanidad.Para el canal, la historia no se concibe como una sucesión árida de fechas o tratados, sino como la suma incalculable de millones de experiencias humanas. Cada edificación fue levantada por individuos que sufrían fatiga; cada imperio se sostuvo sobre familias, comerciantes, soldados y artesanos; cada desastre natural impactó a personas que, hasta unos minutos antes de la catástrofe, asumían que su jornada sería ordinaria. Cuando el guion y la imagen logran transmitir esta dimensión, la historia abandona su naturaleza de dato frío y se transmuta en una experiencia emocional irreversible. El compromiso editorial dicta que toda decisión creativa —desde la investigación hasta el diseño del prompt— debe responder a una única pregunta métrica: ¿Esto ayuda al espectador a vivir la historia desde dentro? Si la respuesta es afirmativa, el elemento pertenece al corte final; si es negativa, debe purgarse.

[?TIPO_PRODUCCION=TIMELAPSE]
Capítulo 2: La Promesa Narrativa y el Slogan Completo en Párrafo Aparte antes del Segundo 30, Llamada a Comentarios y Slogan Corto al Final, y los Micro-Ganchos cada 90 Segundos
Todo episodio que aspire a construir una audiencia leal requiere una promesa clara y transparente. Esta debe aparecer obligatoriamente antes del segundo 30 de video (~segundos 20–30) de cada episodio, ubicando TODO el bloque del slogan completo (desde "En los próximos minutos..." hasta "...Aquí seguimos sus rastros.") obligatoriamente en un párrafo aparte dentro del guion de locución. Comienza obligatoria y estrictamente con la frase "En los próximos minutos...", insertando entre dicha frase y la llamada de acción la explicación breve de lo que estará pasando en el documental (el enigma histórico, la contradicción central o los hechos cruciales que se develarán), y culminando inmediatamente con el cierre oficial de la marca: "Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros." (Fórmula unificada del bloque en párrafo aparte: "En los próximos minutos [explicación breve de lo que estará pasando en el documental]. Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros."). No es un simple truco de marketing; es un contrato donde le aseguramos al espectador que no recibirá una clase de historia tradicional. Debe dejar claro de qué trata el episodio, qué enigma histórico, tensión social o perspectiva inédita descubrirá si se queda hasta el final, prometiéndole habitar el pasado desde adentro. Al concluir el episodio, la locución incluye obligatoriamente antes del slogan la llamada "Déjanos saber en los comentarios..." (formulada textualmente o completada con la pregunta sobre el tema) y cierra obligatoriamente con el slogan corto ("Cada historia deja una huella. Aquí seguimos sus rastros.") ubicados obligatoriamente juntos en un párrafo aparte final ("Déjanos saber en los comentarios... Cada historia deja una huella. Aquí seguimos sus rastros.").
Micro-ganchos cada 90 Segundos: El espectador no puede saberlo todo en el minuto 2; cada sección debe plantear una nueva interrogante antes de resolver la anterior. Esta cadencia de micro-ganchos impide la caída de la retención y renueva la intriga del público cada 90 segundos a lo largo de todo el metraje.
Para que este contrato se cumpla, la arquitectura del contenido opera simultáneamente en tres niveles de profundidad:
- Nivel de Información: Garantiza que el espectador comprenda los hechos fácticos de lo que ocurrió, manteniendo una precisión histórica inquebrantable.
- Nivel de Contexto: Explica las causas profundas y las condiciones sociales, económicas y geográficas que detonaron el acontecimiento, respondiendo al "por qué" de la historia.
- Nivel de Experiencia: Constituye el diferenciador absoluto del canal. Reconstruye la historia desde la percepción psicológica, sensorial y física, permitiendo al usuario sentir "cómo" se vivió aquel momento.
[/?TIPO_PRODUCCION]

Capítulo 3: Los Cinco Pilares Fundamentales
La coherencia operativa y estética del canal se apoya en cinco pilares que actúan como cimientos inamovibles. Si alguno de estos elementos es omitido durante la producción, el resultado deja de ser un documental de Huellas de la Humanidad para convertirse en un video histórico genérico.El primer pilar es el Rigor Histórico. La espectacularidad visual y la inteligencia artificial nunca pueden sustituir a la evidencia académica. Cada proyecto comienza con una investigación exhaustiva que identifica fuentes primarias y consensos. En casos de ambigüedad histórica, el contenido debe reflejar las diversas hipótesis sin imponer especulaciones como verdades absolutas. La credibilidad del mundo reconstruido depende enteramente de este rigor.El segundo pilar es la Inmersión Cinematográfica. La meta no es ilustrar un guion, sino crear un hábitat visual. La cámara generada por los motores de IA debe comportarse como un testigo invisible con masa y volumen físico dentro del escenario. Las texturas, la incidencia de la luz, el comportamiento de los materiales y el diseño acústico deben acatar una lógica coherente con el periodo histórico. Un solo anacronismo visual o tecnológico tiene el potencial de destruir la ilusión completa de inmersión.El tercer pilar se enfoca en la Narrativa Psicológica. La historia ocurre tanto en el mundo material como en la psique de quienes la experimentan. El documental debe insinuar de manera constante el miedo, la incertidumbre, la esperanza, la adaptación o la resignación de la población. Esta capa invisible transforma los hechos abstractos en tensiones humanas comprensibles y empáticas para la audiencia moderna.El cuarto pilar es la generación de un Asombro Basado en la Realidad. Queda terminantemente prohibido exagerar eventos o inventar fricciones narrativas para retener la atención. La espectacularidad nace de la escala colosal de los hechos reales: desastres abrumadores, innovaciones tecnológicas prematuras y el esfuerzo humano masivo. El asombro debe brotar de la revelación de una verdad histórica fascinante y cruda, no de una hipérbole artificial o efectos de Hollywood.El quinto pilar, la Humanización de la Historia, exige que el foco de la reconstrucción no recaiga en mapas abstractos o monarcas lejanos, sino en la población real. Las ciudades y las guerras fueron experimentadas por personas reales con rutinas y ansiedades cotidianas. Devolverle la escala humana a los macro-eventos es la misión fundamental que cohesiona a todos los pilares anteriores.

[?TIPO_PRODUCCION=TIMELAPSE]
Capítulo 4: Dimensión Dominante, Contradicción Central y la Imagen Final
Dimensión Dominante: Cada episodio debe tener un lente a través del cual analizamos la historia. Esto evita que el documental divague y nos permite enfocar el diseño sonoro y visual en esa dimensión específica. La IA debe evaluar la naturaleza del episodio y decidir si el enfoque principal del guion será: 1) Psicológico y Social, 2) Tecnológico y Arquitectónico, 3) Militar y Táctico, 4) Económico o Simbólico (u otra dimensión adecuada según la producción).
Contradicción Central (El Motor del Relato): Todo video debe orbitar sobre una paradoja. No hacemos listados de curiosidades. La narrativa tiene la obligación de contraponer dos fuerzas estructurales antagónicas. Ejemplo: La estructura monumental que se construyó para proteger a los habitantes, pero que terminó convirtiéndolos en prisioneros. O el gran avance tecnológico que prometía emancipación, pero que dependía del sacrificio físico de miles de operarios en condiciones extremas. La contradicción es el eje que estructura la progresión emocional del espectador.
La Imagen Final y Creación Inversa de Imágenes (con Banana 2.1): Como culminación de esta tensión, el sistema establece una norma arquitectónica inversa: cada episodio debe construirse comenzando por el final. Antes de redactar la primera línea del relato, el director debe definir la Imagen Final del Episodio. Esta imagen constituye una síntesis emocional y visual que actuará como ancla en la memoria del espectador. Todo el metraje precedente, cada escena, cada foley y cada pausa, debe funcionar como un vector narrativo diseñado exclusivamente para desembocar en esa imagen y concepto final predefinidos. En los videos de tipo Timelapse, este principio rige de manera absoluta la producción de imágenes fijas y keyframes: las imágenes deben ser creadas obligatoria y exclusivamente con Nano Banana 2.1 (Banana 2.1) desde la última hacia la primera (de la culminación final hacia el origen inicial o cimientos), asegurando que el horizonte, la volumetría 3D, la escala y la iluminación tomen como ancla irrefutable el resultado final.
[/?TIPO_PRODUCCION]

[?TIPO_PRODUCCION=TIMELAPSE]
VOLUMEN II: FORMATOS EDITORIALES Y BIFURCACIÓN VISUAL
El crecimiento de la productora requiere una diversificación de enfoques narrativos que permitan abordar la historia desde distintos ángulos periodísticos e institucionales. Por ello, se ha establecido una bifurcación exacta e innegociable en los formatos editoriales a ejecutar, dependiendo de las instrucciones del Productor Ejecutivo para cada episodio.

[?FORMATO_EDITORIAL=A_INSTITUCIONAL]
Capítulo 5: Formato A — El Documental Institucional (Inmersión Pura)
El Formato A representa el estándar operativo por defecto de Huellas de la Humanidad. Está diseñado para ofrecer una experiencia contemplativa, enciclopédica pero profundamente emocional, manteniendo una distancia respetuosa pero inmersiva con el sujeto histórico.Vibras y Tono: Se nutre de la estética de las producciones de alta gama de cadenas como Discovery Channel, Netflix Documentaries y BBC History. El tono es majestuoso, riguroso y poético.Leyes de Locución: La voz en off opera como una presencia omnisciente e impersonal. El guion debe redactarse utilizando estrictamente el "Plural Institucional" para fomentar un viaje compartido con la audiencia (ejemplos obligatorios: "Caminamos entre las ruinas", "Vemos cómo la sociedad colapsa"). El narrador no es un personaje dentro de la historia, sino un guía a través del tiempo.Regla de Lip-Sync vs Voiceover: En el Formato A, todo el peso interpretativo recae en la locución. Aunque los rostros humanos generados por IA están plenamente permitidos en pantalla, existe una prohibición absoluta de lip-sync forzado. Los personajes nunca hablan directamente a la cámara. Para evitar el denominado "valle inquietante" (la artificialidad en rostros IA), la dirección cinematográfica exige que los humanos sean anclados constantemente a acciones físicas (trabajando la tierra, forjando metal, observando el horizonte). Los encuadres deben priorizar siluetas a contraluz, perfiles y planos sobre el hombro (over-the-shoulder), permitiendo que la escena respire de forma orgánica.
[/?FORMATO_EDITORIAL]

[?FORMATO_EDITORIAL=B_CRONICA]
Capítulo 6: Formato B — La Crónica de [NOMBRE_CORRESPONSAL] (Corresponsal en el Tiempo)
El Formato B rompe deliberadamente la cuarta pared temporal. Está diseñado para episodios que requieren urgencia, inmersión cruda y una perspectiva visceral desde la primera línea de los acontecimientos.Vibras y Tono: La inspiración directa proviene de los reportajes de Vice News. El formato simula un periodismo de trinchera, donde un corresponsal de guerra o investigador documenta la historia en tiempo real, enfrentándose a la crudeza del entorno.Leyes de Locución y Lip-Sync: A diferencia del modelo institucional, el Formato B permite y requiere el uso de lip-sync exclusivamente para el personaje central, el corresponsal denominado "[NOMBRE_CORRESPONSAL]". Este personaje se dirige a la audiencia para reportar el caos, el contexto o la crisis, aportando un testimonio directo y urgente. El resto de la población histórica de fondo sigue sujeta a la regla de no hablar.Lenguaje Visual: La cinematografía abandona los planos majestuosos y estabilizados para adoptar un formato Handheld (cámara en mano) o Selfie Documental. Se instruye a los motores de generación a utilizar profundidades de campo reducidas (enfocando al corresponsal mientras el caos se desenfoca en el fondo) y a integrar texturas analógicas, grano fílmico o defectos de lente que simulen una transmisión histórica realista y accidentada.
[/?FORMATO_EDITORIAL]
[/?TIPO_PRODUCCION]

VOLUMEN III: REGLAS ESTRICTAS E INQUEBRANTABLES
La preservación del rigor, la seguridad algorítmica y la calidad inmersiva exigen el cumplimiento de reglas prohibitivas que no admiten interpretación. Cualquier desviación de este marco invalida automáticamente el clip o el guion generado.
Capítulo 7: Seguridad de Personajes y Lenguaje Narrativo
Prohibición Absoluta de Menores: Está terminantemente prohibido incluir niños, bebés, adolescentes o cualquier figura de un menor de edad en toda la cadena de producción. Esta restricción aplica al guion narrativo, a los personajes secundarios o de fondo, a los prompts de generación de video y a las miniaturas de YouTube. Si la escena histórica normalmente implicaría la presencia de menores, estos deben ser completamente omitidos. La reconstrucción de la vida y el drama histórico debe focalizarse de manera exclusiva en soldados, ancianos, artesanos, comerciantes y trabajadores.
Prohibición Total de la Palabra "Adulto": Queda terminantemente prohibido escribir las palabras "adulto", "adultos", "adult", "adults" en cualquier guion, descripción o prompt. Es redundante, innecesario y antiestético. La identidad y presencia de los personajes debe expresarse únicamente a través de sus oficios, roles o descripciones contextuales (ej. soldado, campesino, mujer, hombre, pescador, herrero, monje), sin etiquetarlos jamás como "adultos".
Prohibición de Anonimización Forzada: No es necesario decir "x tipo de persona o profesión anónimos" (ej. "campesinos anónimos", "un marinero anónimo", "soldados anónimos") ni recurrir a etiquetas artificiales para intentar anonimizar a las personas de la historia. Las personas, figuras y grupos deben mencionarse de forma orgánica y directa según el contexto histórico (ej. los campesinos, los monjes, el emperador, una mujer, los soldados), sin obligar al guion a calificarlos como "anónimos".
Prohibición de Lenguaje Violento Explícito: Por políticas estrictas de monetización algorítmica, queda terminantemente prohibido utilizar en los guiones palabras como "matar", "asesinar", "suicidar", "masacrar" o sus derivados. Para describir bajas históricas, la IA está obligada a utilizar eufemismos y lenguaje periodístico refinado (ej. "perdió la vida", "cayó en combate", "fue ejecutado", "pereció", "silenciado", "erradicado").
Regla Estricta de Años en Número y Cantidades de Miles/Millones como "70 mil": Todos los años deben escribirse obligatoriamente en números / dígitos (ej. 1888, 1789, 1943, 44), quedando estrictamente prohibido escribirlos en letras o palabras (prohibido escribir "mil ochocientos ochenta y ocho"). Asimismo, todas las cantidades o números en miles o millones en el texto de la voz narrativa y en los captions (como "setenta mil", "diez mil", "doscientos mil", "dos millones") deben escribirse obligatoriamente con el número en dígitos seguido de la palabra "mil" o "millones" (ej. "70 mil", "10 mil", "200 mil", "2 millones"; prohibido escribir "setenta mil" o "70,000"). Esta norma es universal para todo el ecosistema de Huellas de la Humanidad: aplica a los títulos, anclajes de fecha, guiones de locución TTS, corrección de captions .srt de CapCut, textos en pantalla de CapCut, miniaturas, descripciones y metadata.
Regla Estricta de Distinción de Era ('antes de Cristo' / 'después de Cristo' en Voz en Off vs. 'a.C.' / 'd.C.' en Descripciones): En los guiones de locución y voz en off (TTS), queda terminantemente prohibido usar siglas o abreviaturas; las referencias de era deben escribirse obligatoriamente en palabras completas: "antes de Cristo" y "después de Cristo" (ej. "44 antes de Cristo"). Por el contrario, en las descripciones, títulos y metadata escrita, las eras deben redactarse obligatoriamente en siglas: "a.C." y "d.C." (ej. "44 a.C.", "siglo V a.C.", "siglo I d.C.").
Regla Estricta de Siglos y Nombres con Número en Números Romanos: En absolutamente toda la producción (guiones de voz en off / locución TTS, textos en pantalla, prompts, modelos @Personas, títulos, capítulos, descripciones históricas y textos de metadata), TODOS los siglos deben escribirse obligatoriamente en números romanos con mayúsculas (ej. siglo XII, siglo XIX, siglo V a.C. / siglo V antes de Cristo, siglo XXI), quedando terminantemente prohibido escribirlos en números arábigos (prohibido "siglo 12", "siglo 19") o en palabras (prohibido "siglo doce", "siglo diecinueve"). Asimismo, todos los nombres propios históricos con número (reyes, monarcas, emperadores, papas, faraones o dinastías, tales como Felipe II Augusto, Luis XIV, Enrique VIII, Carlos V, Alfonso X, Juan Pablo II, Pío XII, Ramsés II, Isabel I) deben escribirse SIEMPRE Y OBLIGATORIAMENTE en números romanos (ej. "Felipe II Augusto"), quedando terminantemente prohibido escribir el número en palabras (prohibido escribir "Felipe Segundo Augusto", "Luis Catorce", "Enrique Octavo") o en dígitos arábigos (prohibido "Felipe 2 Augusto").
Estructura Obligatoria de Apertura de la Voz en Off (Hook Inicial y Cierre de Oración tras Tiempo y Lugar): Al comenzar la narración (al segundo 6 en Reels), la frase de apertura debe estructurarse obligatoriamente con la siguiente tríada secuencial: 1) Tiempo (año o fecha exacta, con los años en números/dígitos; si la referencia al inicio es únicamente el año sin mes ni día, debe iniciar obligatoriamente con "Año" [número], ej. "Año 1888", "Año 44 antes de Cristo"), 2) Lugar, ciudad y país (anclaje geográfico completo detallando el sitio específico, la ciudad y la nación, mencionado acto seguido sin anteponer jamás "en el"). Justo después de enunciar el tiempo y el lugar completo, la locución DEBE CERRAR OBLIGATORIAMENTE LA ORACIÓN CON UN PUNTO (.) Y COMENZAR UNA NUEVA ORACIÓN con letra mayúscula para: 3) Descripción breve del lugar, suceso histórico, personaje o tema central abordado en el video (ej. "Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba un cazador nocturno que la policía jamás atrapó."), enlazando directamente con la premisa intrigante o dramática que captura a la audiencia al instante.
[?TIPO_PRODUCCION=REELS|TIMELAPSE]
Regla de Cero Exclamaciones para el Motor TTS: En la redacción del guion final que será procesado por sistemas de Text-To-Speech (TTS) o interpretado por locutores, está totalmente prohibido el uso de signos de exclamación (!). La intensidad emocional, el drama y la urgencia de la historia no deben forzarse mediante gritos artificiales o entonaciones hiperbólicas. La gravedad narrativa se controla de forma exclusiva a través de la sobriedad vocal, el ritmo de lectura, la contención emocional, los silencios estructurales y el peso intrínseco de las palabras elegidas. La voz debe transmitir autoridad sin arrogancia y asombro sin melodrama.
[/?TIPO_PRODUCCION]
Capítulo 8: Integridad Visual y Tensión Psicológica
Para garantizar la estabilidad del contenido frente a las políticas de moderación de plataformas (YouTube, redes sociales) y para mantener un realismo documental sin recurrir al sensacionalismo violento, se aplican las siguientes normativas visuales:
Prohibición Absoluta de Sangre y Gore (Disociación de la Violencia): Queda estrictamente prohibido incluir palabras como "blood", "bloody", "gore", "mutilation" o descripciones de heridas abiertas en los prompts de generación visual, garantizando así la seguridad y monetización del canal. No necesitamos sangre gráfica para asustar al espectador; el terror táctico se construye a través de la tensión psicológica extrema. Se logra mediante el desgaste biomecánico, la asfixia acústica (ruidos abrumadores), el silencio prolongado, o el encierro claustrofóbico. Ejemplo: En lugar de mostrar la explosión de un cuerpo, mostramos las manos temblorosas de un soldado apretando un fusil en la oscuridad absoluta o el polvo cayendo del techo de un sótano.
Escudo Anti-Fuego Humano: En la recreación de batallas campales, asedios urbanos, catástrofes naturales o desastres industriales, está rigurosamente prohibido instruir a la IA para que coloque fuego directo sobre modelos humanos. Para retratar el horror de las llamas y la destrucción sin caer en el gore explícito, los personajes deben representarse a través de siluetas a contraluz situadas a distancias seguras. La tragedia se construye atmosféricamente utilizando el resplandor volcánico (volcanic glow), la refracción del humo, el colapso del entorno arquitectónico y la reacción corporal de los sobrevivientes.
Anulación de Estilos Anacrónicos: Queda prohibida la inclusión de elementos visuales modernos en épocas pasadas. Se veta el uso de modificadores como "3D", "CGI look", "hyperrealistic" o "cartoon", debiendo primar siempre el "realismo cinematográfico documental". Las consecuencias de la guerra se muestran mediante ruinas, abandono y silencio.
Sincronización Temática (No Literalidad Visual): La imagen no tiene la obligación de ser una traducción literal o calco exacto de lo que el narrador está relatando palabra por palabra. El objetivo es que los clips fluyan orgánicamente con la historia. Se fomenta el uso de metáforas visuales y planos atmosféricos que capturen la esencia de la escena, sin necesidad de ilustrar lo obvio de forma redundante (ej. si la voz habla del "colapso de la economía", la imagen puede mostrar un puesto de panadero vacío y polvoriento en lugar de monedas cayendo).

VOLUMEN IV: FLUJO DE TRABAJO Y ARQUITECTURA TEMPORAL
[?TIPO_PRODUCCION=TIMELAPSE]
Capítulo 9: Flujo de Trabajo Paso a Paso (Sincronización Inversa)
El proceso de manufactura audiovisual en Huellas de la Humanidad repudia la improvisación visual. Se rige por un principio operativo denominado Sincronización Inversa Absoluta. En la producción tradicional, a menudo la imagen dicta el ritmo; en nuestro sistema, la voz humana es el metrónomo inalterable. La generación de prompts sobre tiempos teóricos está prohibida. El flujo inquebrantable desde la investigación hasta la exportación consta de los siguientes pasos:Investigación Multidimensional (Filtro de Realidad): Toda producción comienza con una investigación organizada en cinco capas progresivas: 1) Hechos básicos y cronología; 2) Contexto estructural sociopolítico; 3) Experiencia humana a través de testimonios y reconstrucciones; 4) Interpretación y debate histórico; 5) Dimensión visual y arquitectónica real. Si un elemento no es historically verificable o lógicamente inferible, se descarta.Arquitectura Conceptual: El equipo define explícitamente la Contradicción Central, redacta la Promesa Narrativa (ubicada antes del segundo 30 de video, estructurada como todo el bloque del slogan completo en un párrafo aparte desde "En los próximos minutos [explicación breve de lo que estará pasando en el documental]" hasta "...Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros.") y establece la Imagen Final hacia la cual convergerá el episodio.Redacción Cronometrada: El guion se escribe optimizado para mantener una cadencia rigurosa de 112 a 114 Palabras Por Minuto (WPM), articulando micro-ganchos cada 90 segundos para que el espectador no lo sepa todo en el minuto 2 y culminando la voz en off con la llamada "Déjanos saber en los comentarios..." antes del eslogan corto oficial de la marca, separados en un párrafo aparte final ("Déjanos saber en los comentarios... Cada historia deja una huella. Aquí seguimos sus rastros.").Grabación de la Pista Maestra: La locución se registra respetando los tonos institucionales (Formato A) o de crónica (Formato B), y se masteriza como el eje de la producción.Construcción del Timeline Real: Una vez renderizado el audio, se mapean las marcas de tiempo milimétricas. El guion se transforma en una hoja de cálculo temporal. Si el locutor menciona "el colapso de la torre" en el minuto 03:14, el clip visual generado debe coordinar esa acción física exactamente en esa marca de tiempo.[?DURACION_CLIPS=10_SEGUNDOS]Diseño de Escenas y Asignación Foley (1 Shot de 10s): Se fragmenta el timeline en bloques de 10 segundos con Omni Flash estructurados obligatoriamente como un solo shot continuo de 10 segundos, asignando la acción visual precisa y el diseño acústico (Foley) que acompañará a cada escena.[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]Diseño de Escenas y Asignación Foley (1 Shot de 8s): Se fragmenta el timeline en bloques de 8 segundos con Omni Flash estructurados obligatoriamente como un solo shot continuo de 8 segundos, asignando la acción visual precisa y el diseño acústico (Foley) que acompañará a cada escena.[/?DURACION_CLIPS]Ingeniería de Prompts y Renderizado (Creación Inversa y Transición Constructiva en Timelapse): Redacción técnica de las instrucciones en inglés para los motores oficiales: Nano Banana 2.1 (creación de imágenes de transformación en orden inverso) y Omni Flash (clips de video con transición constructiva) e inicio de la generación de lotes bajo el principio de diseño para reproducción en silencio (subtítulos dinámicos y apoyo visual claro obligatorios). En los videos timelapse, las imágenes serán creadas obligatoriamente en orden inverso, desde la última hacia la primera (generando primero la imagen final del timelapse y retrocediendo secuencialmente hasta la primera imagen), garantizando que cada etapa previa se ancle con exactitud matemática al marco visual, perspectiva y arquitectura de la imagen final preestablecida. Asimismo, en los prompts de cada clip de video timelapse, la evolución visual debe ser obligatoriamente una transición constructiva fluida y gradual sin cambios bruscos, describiendo el ensamblaje progresivo de materiales y capas arquitectónicas sin cortes repentinos ni metamorfosis súbitas.Edición Invisible: Montaje en software con cortes motivados por la emoción o el cambio de espacio, aplicando una sincronización audiovisual total.Empaque Acústico, Visual y QA: Pregunta obligatoria de la duración exacta del video final montado en CapCut sin pedir el archivo de video (quedando terminantemente prohibido solicitar el archivo de video), determinación inteligente de la cantidad de canciones y su duración respetando los límites de Suno (mínimo 1 min, máximo 6 min por pista, dejando silencios entre cada canción y haciendo que la última canción sea de solo 1:30) adaptadas a la época, escenas e intención dramática, creación de la banda sonora oficial en Suno (soundtrack cinematográfico instrumental sin voces), elaboración de miniaturas con Nano Banana 2.1 (con logo HD en dorado al 5% para formato vertical 9:16 o logo 8K en dorado al 5% para horizontal 16:9 en la parte superior derecha creado por la IA y manteniendo el logo de la página proporcionado como imagen de referencia, especificados en su prompt), auditoría final mediante el checklist y configuración del algoritmo de publicación.
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=REELS]
Capítulo 9: Flujo de Trabajo (Formato Reels)
El formato "Reels" es un video cinematográfico ([?SUB_OPCION_REELS=9X16]vertical 9:16[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal 16:9[/?SUB_OPCION_REELS]) estructurado con duración flexible definida por el usuario (donde la duración total no tiene que ser exacta al segundo, sino aproximada a la duración pedida). [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]Los primeros [DURACION_CLIP_1_RALENTIZADO] segundos de video no llevan voz en off (Clip 1 Hook de [DURACION_CLIP_1]s completo sin voz [00:00 - 00:[DURACION_CLIP_1_PAD]] + los primeros 2 segundos del Clip 2 sin voz [00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]], dedicados exclusivamente al impacto visual y atmósfera sonora Foley). La locución narrativa entra obligatoriamente a los 2 segundos de haber iniciado el Clip 2 (segundo [DURACION_CLIP_1_RALENTIZADO] del video total [00:[DURACION_CLIP_1_RALENTIZADO_PAD]]), con voz narrativa en tercera persona (estrictamente sin hablar en "nosotros", con inserción inteligente de pausas narrativas [pausa: Xs] procesadas en VoxFlow sin marcas informales /2s, y sin forzar anonimización con palabras como "anónimos").[/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]Los primeros [DURACION_CLIP_1_RALENTIZADO] segundos de video no llevan voz en off (cubiertos por el Clip 1 generado a [DURACION_CLIP_1]s [00:00 - 00:[DURACION_CLIP_1_PAD]] pero cuya velocidad se reduce en edición para llevarlo a [DURACION_CLIP_1_RALENTIZADO]s [00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]] con puro Foley ambiental). Por tanto, el Clip 2 comienza en el segundo [DURACION_CLIP_1_RALENTIZADO] de video en el timeline de CapCut ([?DURACION_CLIPS=10_SEGUNDOS][RAL_CLIP2_RANGE_10S][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS][RAL_CLIP2_RANGE_8S][/?DURACION_CLIPS]) y arranca obligatoriamente de inmediato con la voz narrativa en el segundo [DURACION_CLIP_1_RALENTIZADO] (sin los 2s iniciales de foley mudo en Clip 2), con voz narrativa en tercera persona (estrictamente sin hablar en "nosotros", con inserción inteligente de pausas narrativas [pausa: Xs] procesadas en VoxFlow sin marcas informales /2s, y sin forzar anonimización con palabras como "anónimos").[/?SINCRONIZACION_CLIP_1] La voz en off arranca obligatoriamente en ese segundo [DURACION_CLIP_1_RALENTIZADO] con un preámbulo estructurado estrictamente en: 1) Tiempo (años en números/dígitos; iniciando obligatoriamente con "Año" [número] si es únicamente el año sin mes ni día, ej. "Año 1888", "Año 44 antes de Cristo"), 2) Lugar, ciudad y país mencionado acto seguido sin poner "en el" (cerrando obligatoriamente la oración con un punto justo después del tiempo y el lugar, e iniciando una nueva oración con mayúscula: ej. "Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba..."), y 3) Descripción breve del lugar, suceso histórico, personaje o temática del video, capturando de inmediato al espectador con un elemento intrigante o perturbador. La duración total aproximada del video es igual a los [DURACION_CLIP_1_RALENTIZADO] segundos iniciales sin voz más el tiempo de la voz en off (Tiempo de Voz en Off ≈ Duración Total Pedida - [DURACION_CLIP_1_RALENTIZADO]s), calculando la extensión del guion con la métrica calibrada de 15 caracteres por segundo de locución (900 caracteres por minuto) ([?DURACION_CLIPS=10_SEGUNDOS]150 caracteres por cada 10 segundos de locución[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]120 caracteres por cada 8 segundos de locución[/?DURACION_CLIPS]). El guion integra la promesa narrativa antes del segundo 30 de video ubicando todo el slogan completo en un párrafo aparte (desde "En los próximos minutos...", seguida de la explicación breve de lo que estará pasando en el documental, hasta culminar con "Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros."), articula micro-ganchos cada 90 segundos para sostener la intriga sin revelarlo todo prematuramente, y culmina obligatoriamente la voz narrativa incluyendo antes del slogan la frase "Déjanos saber en los comentarios..." y pronunciando como cierre el slogan corto oficial en un párrafo aparte al final del guion: "Déjanos saber en los comentarios... Cada historia deja una huella. Aquí seguimos sus rastros." Todo el metraje se concibe bajo el principio de Diseño para Reproducción en Silencio (el 70% consume inicialmente sin audio, por lo que el apoyo visual y los subtítulos dinámicos en CapCut son obligatorios). Se ejecuta de forma innegociable en 12 etapas por separado: 1) Selección del tema y tipología; 2) Pregunta y definición de la duración total aproximada del video; 3) Recuento estructural de secciones del documental, datos insólitos, curiosidades y contradicciones históricas[?SUB_OPCION_REELS=16X9], incluyendo en formato largo horizontal 16:9 la generación obligatoria de un Prompt Maestro para desarrollar una investigación profunda por fuera para luego usar toda esa información en el guion y en todo el video[/?SUB_OPCION_REELS] (con ALTO INQUEBRANTABLE); 4) Guion de voz en off con inserción inteligente de pausas narrativas [pausa: Xs] proporcional a la duración aproximada pedida (descontando el tiempo total de pausas del metraje hablado para mantener los 15 caracteres/segundo de voz hablada: (Tiempo Total Aproximado - [DURACION_CLIP_1_RALENTIZADO]s iniciales - Tiempo de Pausas) x 15 caracteres con espacios)[?SUB_OPCION_REELS=16X9] integrando toda la información obtenida en la investigación profunda externa[/?SUB_OPCION_REELS], indicando obligatoriamente al pie del guion el formato "Caracteres Totales (texto hablado): [número] ([X] caracteres por minuto)" junto al desglose de pausas y duración total aproximada; 5) Generación de prompts de imágenes modelo de referencia para las personas (@Personas) y los lugares principales (@Lugares) del relato (sin generar imágenes de referencia de objetos sueltos; única y exclusivamente para referencia visual y NO para ser usadas como primer fotograma del video), anteponiendo al inicio en una sola oración la orden "Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente." y asegurando un único '@' por cada prompt para fijar la consistencia fisonómica y arquitectónica; 6) Selección del texto en pantalla del Clip 1 para el inicio del video (con ALTO INQUEBRANTABLE): [?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]pregunta y definición de opciones de texto (Ciudad, País, Tiempo en la primera línea, y justo debajo el Gancho) para edición manual en CapCut;[/?TEXTO_PANTALLA_CLIP_1][?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]presentación y selección de opciones de texto cinematográfico (Ciudad, País, Tiempo y Gancho) para ser integrado directamente por la IA en el prompt de video del Clip 1 de [DURACION_CLIP_1]s (tipo comienzo de documental cinematográfico);[/?TEXTO_PANTALLA_CLIP_1] 7) Consulta previa al usuario sobre si desea recibir los prompts de 10 en 10 o todos juntos (con ALTO INQUEBRANTABLE), seguida de la generación y entrega de prompts de imágenes iniciales (que actúan como primer fotograma de cada clip) e indicando en cada clip de video el tiempo que cubre en formato (##:## - ##:##) teniendo obligatoriamente en cuenta las pausas de la voz narrativa ([pausa: Xs]) según la modalidad elegida (en bloques de 10 clips con ALTO INQUEBRANTABLE entre bloques, o todos juntos en una sola entrega continua) con Nano Banana 2.1 ([?SUB_OPCION_REELS=9X16]9:16[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]16:9[/?SUB_OPCION_REELS] 'no text') y Omni Flash con Foley integrado (strictly no music), con Clip 1 con duración obligatoria de [DURACION_CLIP_1] segundos (00:00 - 00:[DURACION_CLIP_1_PAD])[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1] integrando el texto en pantalla previamente seleccionado en la Etapa 6[/?TEXTO_PANTALLA_CLIP_1], manteniendo la regla estricta de que en los prompts de imágenes y clips solo habrá como máximo un '@' por cada uno y será exclusivo para personas[?VOZ_NARRATIVA_EN_CLIPS=INCLUIR] e incluyendo al final de cada clip que lleve locución la porción de voz correspondiente como una oración más sin comillas ni paréntesis[/?VOZ_NARRATIVA_EN_CLIPS][?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR] y excluyendo limpiamente el texto de la voz narrativa de los prompts de video (concluyendo con el sufijo 'no text, no speech, no music')[/?VOZ_NARRATIVA_EN_CLIPS], agregando obligatoriamente al final de CADA prompt de clip de video "fix the name", estructurado cada clip por defecto como 1 solo shot continuo ([?DURACION_CLIPS=10_SEGUNDOS]1 shot de 10s, o 2 shots cada uno de 5 segundos en aquel clip específico donde una escena se vaya a demorar demasiado visualmente y ya la voz narrativa cambió a otra escena[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]1 shot de 8s, o 2 shots en aquel clip específico donde la voz narrativa cambió a otra escena a mitad del clip[/?DURACION_CLIPS]) bajo la Regla Inquebrantable de Variación Cinematográfica Intra-Escena (si la locución describe la misma escena por más de 10 segundos o clips consecutivos, la IA debe entregar tomas diferentes variando cámara, perspectiva, escala y foco para erradicar planos repetidos), anteponiendo la orden operativa EXCLUSIVAMENTE al inicio del primer envío de prompts (Bloque 1 si es de 10 en 10, o al inicio general si es todos juntos); 8) Corrección de los captions automáticos de CapCut (archivo .srt): el usuario le pasa el archivo .srt exportado de CapCut a la IA y esta corrige todas las palabras mal escritas, nombres propios históricos, años, siglos y cantidades como "setenta mil" o "70,000" a formato "70 mil" si es necesario, chequeando contra nuestra Voz Narrativa Original de la Etapa 4, pero manteniendo intactos los timestamps y la estructura de bloques de CapCut, y se lo devuelve obligatoriamente en formato archivo .srt descargable listo para importar en CapCut (con ALTO INQUEBRANTABLE); 9) Pregunta obligatoria de la duración exacta del video final montado en CapCut sin pedir el archivo de video (quedando terminantemente prohibido solicitar el archivo de video), determinación inteligente de la cantidad de canciones y duración de cada una respetando los límites de Suno (mínimo 1 minuto y máximo 6 minutos por pista, dejando silencios obligatorios entre cada canción y asegurando que la última canción sea de solo 1:30) según la época, escenas e intención dramática, y entrega de los prompts técnicos musicales de la banda sonora oficial para Suno (soundtrack cinematográfico de época, tempo calibrado e instrumental sin voces, con ALTO INQUEBRANTABLE); 10) Generación y validación del prompt técnico de la miniatura oficial para Nano Banana 2.1 ([?SUB_OPCION_REELS=9X16]vertical 9:16 con logo HD en dorado al 5% en la parte superior derecha creado directamente por la IA[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]horizontal 16:9 con logo 8K en dorado al 5% en la parte superior derecha creado directamente por la IA[/?SUB_OPCION_REELS] y manteniendo el logo oficial de la página proporcionado como imagen de referencia en la parte superior izquierda, con ALTO INQUEBRANTABLE); 11) Consulta y entrega de Metadata adaptada a la plataforma solicitada (Facebook/TikTok: 3000 caracteres sin tags; Instagram: hasta 1200 caracteres sin tags; YouTube: 3000 caracteres + 500 caracteres de tags tras los hashtags) en formato Todo Corrido sin encabezados con la descripción dividida obligatoriamente en 3 párrafos separados por líneas invisibles con braille (⠀), cumpliendo la regla inquebrantable de NO repetir lo mismo entre la Miniatura, el Título y el Texto en pantalla en los primeros [DURACION_CLIP_1_RALENTIZADO] segundos (mientras que en lo demás de la metadata no importa que se repitan algunas palabras) y con CTA natural en comentarios; 12) Asistencia Post-Producción para Responder Comentarios de la Audiencia: después de toda la producción, el usuario le envía a la IA capturas de pantalla (imágenes) o texto de los comentarios de la audiencia en los videos para que la IA le ayude a responderlos de forma certera y concisa.
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=INMERSIVO_CONTEMPLATIVO]
Capítulo 9: Flujo de Trabajo (Inmersivo Contemplativo)
El formato "Inmersivo Contemplativo" es un reel ultra corto de 20 segundos que se ejecuta en 6 etapas secuenciales con ALTO INQUEBRANTABLE: 1) Selección del tema y tipología; 2) Clips inmersivos (Omni Flash y Nano Banana 2.1 con puro Foley); 3) Pregunta obligatoria de confirmación de la duración exacta del video final sin pedir el archivo de video (quedando terminantemente prohibido pedir el archivo de video), y prompt técnico de banda sonora ambiental para Suno (1 pista de 1 minuto [mínimo técnico de Suno] indicando fade-out en edición al segundo 20, soundtrack instrumental sin voces, con ALTO INQUEBRANTABLE); 4) Prompt técnico de la miniatura oficial para Nano Banana 2.1 (9:16 con logo HD al 5% en la esquina superior derecha y logo oficial al 5% en la esquina superior izquierda); 5) Metadata de publicación; 6) Asistencia Post-Producción para responder comentarios de la audiencia mediante capturas de pantalla o texto de forma certera y concisa. Por su brevedad, se omite deliberadamente la "Investigación Multidimensional" (no hay las 5 capas del Filtro de Realidad ni deep research), así como la Contradicción Central y la Promesa Narrativa.
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=POST_EXPECTATIVA]
Capítulo 9: Flujo de Trabajo (Post con Imagen - Próximo Estreno, Efemérides y Debate/Controversia [3:4])
El formato de imagen estática en relación de aspecto vertical 3:4 con descripción inmersiva (calibrada hasta 1200 caracteres en Instagram o 3000 caracteres en Facebook) se divide en tres modalidades editoriales. Todas las modalidades se entregan obligatoria y estrictamente SIN TÍTULO en la descripción (arrancando directamente con el Párrafo 1) y cuentan con asistencia post-publicación para responder comentarios de la audiencia mediante capturas de pantalla de forma certera y concisa:
1. Modalidad Próximo Estreno (Expectativa de Documental): Diseñada para generar suspenso y expectativa ante un documental próximo a estrenarse. Se ejecuta en 4 etapas (+ post-producción de comentarios): 1) Solicitud de datos del estreno; 2) Descripción visual y propuesta de 2 líneas de texto en fuente grande y de alto contraste (línea 1: "Próximamente en Huellas de la Humanidad"; línea 2 mayor: texto gancho); 3) Prompt técnico para Nano Banana 2.1 en ratio 3:4 con logo oficial al 5% en la esquina superior izquierda preservando obligatoriamente el texto inferior "Huellas de la Humanidad" y tipografía grande de alto contraste, con validación obligatoria; 4) Descripción SIN TÍTULO en Todo Corrido (3 párrafos con braille, Nota IA oficial para imagen, Slogan oficial, 5 hashtags de dos palabras y Comentario Fijado con CTA natural), seguida de respuestas certeras y concisas a capturas de comentarios.
2. Modalidad Efeméride Histórica: Diseñada para conmemorar acontecimientos históricos relevantes. Se ejecuta en 4 etapas (+ post-producción de comentarios): 1) Presentación de 5 opciones de efemérides del día actual (o de la fecha específica si el usuario la solicita) para que el usuario elija; 2) Descripción visual y confirmación de 2 líneas de texto en fuente grande y de alto contraste (línea 1 menor: fecha tipo "29 de septiembre"; línea 2 significativamente mayor: el hecho histórico como tal, dividida en dos líneas si es muy largo para que quepa a lo ancho); 3) Prompt técnico para Nano Banana 2.1 en ratio 3:4 con logo oficial al 5% en la esquina superior izquierda preservando obligatoriamente el texto inferior "Huellas de la Humanidad" y tipografía de alto contraste, con validación de imagen previa; 4) Descripción SIN TÍTULO en Todo Corrido (3 párrafos con braille, Nota IA oficial para imagen, Slogan oficial, 5 hashtags de dos palabras y Comentario Fijado con CTA natural), seguida de respuestas certeras y concisas a capturas de comentarios.
3. Modalidad Debate y Controversia Histórica: Diseñada para polarizar constructivamente, generar debate apasionado y máximo engagement en redes. Se ejecuta en 4 etapas (+ post-producción de comentarios): 1) Presentación de 5 opciones de temas polémicos con geolocalización y tiempo (Línea 1: "Ciudad, País, Año" o "País, Año" o combinación con sentido) y gancho de controversia en fuente grande y de alto contraste (Línea 2), contexto del dilema moral o histórico y pregunta detonante para comentarios (con ALTO INQUEBRANTABLE); 2) Descripción visual conceptual 3:4 y confirmación de las dos líneas de texto de alto contraste; 3) Prompt técnico para Nano Banana 2.1 en ratio 3:4 con logo oficial al 5% preservando obligatoriamente el texto inferior "Huellas de la Humanidad" y tipografía de alto contraste (con ALTO INQUEBRANTABLE); 4) Descripción de controversia SIN TÍTULO en Todo Corrido (3 párrafos de debate, Nota IA oficial para imagen, Slogan oficial, 5 hashtags de dos palabras y Comentario Fijado con CTA de debate), seguida de respuestas certeras y concisas a capturas de comentarios.
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=NOTEBOOKLM_VIDEO]
Capítulo 9: Flujo de Trabajo (Video Automatizado con Google NotebookLM)
El formato "Video Automatizado (NotebookLM)" está concebido para la creación de documentales históricos de alto impacto mediante la suite de inteligencia artificial de Google NotebookLM. Prescinde deliberadamente de la generación de prompts de clips individuales o imágenes por fotogramas, estructurándose en 8 etapas secuenciales con ALTO INQUEBRANTABLE:
1. Etapa 1 (Tema y Enigma): Definición del tema, personajes y paradoja histórica central (con ALTO INQUEBRANTABLE).
2. Etapa 2 (Investigación en NotebookLM): Generación de un Prompt Maestro exhaustivo para NotebookLM diseñado para buscar, cruzar y curar fuentes primarias y secundarias, cronología, contradicciones y datos insólitos (con ALTO INQUEBRANTABLE).
3. Etapa 3 (Consulta y Selección del Estilo Cinematográfico): Propuesta obligatoria al usuario de 3 a 5 opciones de estilos cinematográficos adaptados al tema histórico o la opción abierta de que el usuario especifique otro estilo personalizado de su preferencia (con ALTO INQUEBRANTABLE).
4. Etapa 4 (Creación de Video en NotebookLM): Generación del Prompt Maestro para la creación del video overview en NotebookLM con una extensión máxima estricta de hasta 4000 caracteres (reportando el conteo de caracteres al pie), integrando obligatoriamente el estilo cinematográfico acordado en la Etapa 3, cumpliendo la REGLA INQUEBRANTABLE DE QUE LA VOZ NARRATIVA DE LOS AUTO REELS ES MASCULINA SIEMPRE (exclusivamente narrador único en off con voz masculina documental cinematográfica profunda, solemne y autoritaria en español neutro; rigurosamente sin voces femeninas, sin formato de dos presentadores ni debate y sin consultar jamás al usuario qué género de voz prefiere), primeros 6 segundos de video sin voz narrativa con solo video y audio Foley ambiental entrando la locución en el segundo 6, voz narrativa obligatoriamente en IDIOMA ESPAÑOL neutro, arco dramático de tensión, lema de cierre de Huellas de la Humanidad, duración inteligente y adaptativa de cada clip según la escena, y combinación híbrida de secuencias de video con imágenes estáticas de apoyo (b-roll de archivo: fotografías históricas, tomas tipo mapa antiguo, tomas de maquetas a escala, tomas de dibujo en papel en blanco y negro, grabados y documentos) (con ALTO INQUEBRANTABLE).
5. Etapa 5 (Banda Sonora en Suno - Solicitud de Archivo de Video, Duración Exacta y Partición de Canciones): Solicitud obligatoria del archivo de video generado en NotebookLM para analizar su ritmo y escenas reales, y consulta obligatoria de la duración exacta del metraje (con ALTO INQUEBRANTABLE); a partir de dicha duración y del análisis del video, determinación de cuántas canciones serán necesarias y la duración de cada una respetando los límites de Suno (mínimo 1 minuto y máximo 6 minutos por pista, dejando silencios entre cada canción y haciendo que la última canción sea de solo 1:30) adaptadas a la época, escenas concretas e intención emocional, entregando los prompts técnicos musicales para la creación de la banda sonora oficial en Suno (soundtrack documental de época, variado y adaptado por escena, instrumental sin voces, con ALTO INQUEBRANTABLE).
6. Etapa 6 (Miniatura Nano Banana 2.1): Prompt técnico en inglés en relación de aspecto 16:9 con texto en pantalla obligatorio (1 a 3 palabras contundentes en tipografía cinematográfica de alto contraste), con logo dorado "8K" al 5% en la esquina superior derecha y el logo oficial de la página al 5% en la esquina superior izquierda a partir de la imagen de referencia preservando obligatoriamente el texto inferior "Huellas de la Humanidad" (con ALTO INQUEBRANTABLE).
7. Etapa 7 (Metadata de Publicación): Título con el sufijo obligatorio e inquebrantable ' | Documental Completo' al final, descripción en 3 párrafos en formato Todo Corrido con líneas invisibles braille (⠀) sin ningún encabezado de sección (recordando que para ninguna producción necesitamos el encabezado de las secciones de la metadata excepto el de los Capítulos:; cero "Título:", cero "Descripción:", cero "Nota IA:", cero "Slogan:", cero "Hashtags:", etc.), sección obligatoria de Capítulos para YouTube (con encabezado ineludible "Capítulos:" como el único encabezado de sección permitido en toda la metadata, exactamente diez [10] capítulos cronológicos con timestamps iniciando en 00:00 [con título relevante a la historia del video; prohibido "Prólogo" o "Inmersión Visual"] y 00:06), Nota IA oficial para documental, Slogan de la marca, 5 hashtags de dos palabras en #CamelCase (con #DocumentalEnEspañol obligatorio) y Comentario Fijado con llamado a la acción natural.
8. Etapa 8 (Asistencia Post-Producción para Responder Comentarios de la Audiencia): Después de toda la producción, el usuario le envía a la IA capturas de pantalla (imágenes) o texto de los comentarios de la audiencia en los videos para que la IA le ayude a responderlos de forma certera y concisa.
[/?TIPO_PRODUCCION]
Capítulo 10: Arquitectura Temporal y Tensión Narrativa
[?TIPO_PRODUCCION=TIMELAPSE]
El tiempo es tratado como una herramienta de ingeniería emocional. La distribución de los bloques narrativos se diseña para capturar y sostener la atención humana, estructurándose de la siguiente forma :El Hook Extremo (0–24s): Fase de impacto sensorial máximo diseñada para detener el desplazamiento (scroll) del usuario. Consta de 3 clips iniciales. La locución debe iniciar obligatoriamente con la tríada: 1) Tiempo (años en dígitos; si es únicamente el año sin mes ni día, iniciando con "Año" [número], ej. "Año 1888", "Año 44 antes de Cristo"), 2) Lugar, ciudad y país mencionado acto seguido sin anteponer "en el" (cerrando obligatoriamente la oración con un punto tras tiempo y lugar, e iniciando una nueva oración con mayúscula), y 3) Descripción breve del lugar, suceso o personaje del video, sin explicaciones enciclopédicas. 
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=REELS][?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]Texto en Pantalla y Diseño para Reproducción en Silencio (Primeros [DURACION_CLIP_1_RALENTIZADO] Segundos - Edición Manual en CapCut): Alrededor del 70% de los usuarios ven los primeros segundos sin audio, por lo que subtítulos dinámicos y apoyo visual claro son obligatorios. Durante los primeros [DURACION_CLIP_1_RALENTIZADO] segundos del video (Clip 1 de [DURACION_CLIP_1]s + primeros 2s de Clip 2, ventana que transcurre sin voz en off), se coloca un texto o letrero en pantalla para enganchar visualmente al espectador. Dicho texto debe estructurarse obligatoriamente incluyendo: Ciudad, País, Tiempo (años en dígitos o siglos en romanos) en la línea superior, y justo debajo la frase de Gancho intrigante o perturbadora. Dicho texto NO debe insertarse en los prompts de IA (los cuales llevan estrictamente 'no text'), sino que la IA debe acordar con el usuario la selección del texto en pantalla del Clip 1 previamente en la Etapa 6 (tras validar las imágenes de referencia de personas y lugares y antes de los prompts de imágenes iniciales y clips de video), proponiendo de 2 a 3 opciones con esta estructura para ser colocado manualmente en CapCut durante el montaje. El resto del video permanece completamente limpio sin texto en pantalla.[/?TEXTO_PANTALLA_CLIP_1][?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]Texto en Pantalla y Diseño para Reproducción en Silencio (Primeros [DURACION_CLIP_1_RALENTIZADO] Segundos - Generado por IA en Clip 1): Alrededor del 70% de los usuarios ven los primeros segundos sin audio, por lo que subtítulos dinámicos y apoyo visual claro son obligatorios. El texto en pantalla para los primeros [DURACION_CLIP_1_RALENTIZADO] segundos se selecciona previamente con el usuario en la Etapa 6 (antes de los prompts de imágenes iniciales y clips) y va ÚNICA Y EXCLUSIVAMENTE en el prompt del Clip 1 de video ([DURACION_CLIP_1]s), generado directamente por la IA tipo comienzo de un documental cinematográfico con tipografía cinematográfica integrada (Ciudad, País, Tiempo en la primera línea y justo debajo el Gancho intrigante). Dicho texto NO debe ir en el prompt de la Imagen 1 (la cual lleva estrictamente 'no text'). En la edición posterior, el usuario baja la velocidad del Clip 1 y lo lleva a [DURACION_CLIP_1_RALENTIZADO] segundos de duración (o lo mantiene en [DURACION_CLIP_1]s si la voz entra a los 2s del Clip 2). Los clips restantes no llevan texto en pantalla.[/?TEXTO_PANTALLA_CLIP_1][/?TIPO_PRODUCCION][?TIPO_PRODUCCION=TIMELAPSE][?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]Queda estrictamente prohibido incluir cualquier tipo de texto en pantalla para estos videos cortos; la imagen debe permanecer completamente limpia y visual.[/?TEXTO_PANTALLA_CLIP_1][?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]Texto en Pantalla en Timelapse (Generado por IA en Clip 1): El texto en pantalla para los primeros [DURACION_CLIP_1_RALENTIZADO] segundos va exclusivamente en el prompt del Clip 1 de [DURACION_CLIP_1] segundos (tipo comienzo de un documental cinematográfico), NO en el prompt de la Imagen 1 (que lleva estrictamente 'no text'). Luego en edición el usuario baja la velocidad del Clip 1 y lo lleva a [DURACION_CLIP_1_RALENTIZADO] segundos. Los clips restantes permanecen completamente limpios y visuales.[/?TEXTO_PANTALLA_CLIP_1][/?TIPO_PRODUCCION][?TIPO_PRODUCCION=INMERSIVO_CONTEMPLATIVO][?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]Texto en Pantalla (Edición Manual en CapCut): El texto en pantalla será exclusivo del Clip 1 e incluirá lugar, tiempo (año/siglo) y título que resuma con gancho de qué va el video. Este texto NO debe ser generado por herramientas de IA ni insertado en los prompts visuales (los prompts deben incluir estrictamente 'no text'). La IA debe especificar claramente en la ficha del Clip 1 qué texto colocar manualmente en CapCut durante la edición posterior. Los clips 2 y 3 no llevan texto en pantalla.[/?TEXTO_PANTALLA_CLIP_1][?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]Texto en Pantalla (Generado por IA en Clip 1): El texto en pantalla será exclusivo del Clip 1 e incluirá lugar, tiempo (año/siglo) y título que resuma con gancho de qué va el video, generado directamente por la IA en el prompt de video del Clip 1 ([DURACION_CLIP_1]s) tipo comienzo de documental cinematográfico. Dicho texto va ÚNICAMENTE en el prompt de video del Clip 1, NO en el prompt de la Imagen 1 (que lleva estrictamente 'no text'). En la edición posterior, el usuario baja la velocidad del Clip 1 para llevarlo a [DURACION_CLIP_1_RALENTIZADO] segundos de duración. Los clips 2 y 3 no llevan texto en pantalla.[/?TEXTO_PANTALLA_CLIP_1][/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=TIMELAPSE]
Pausas y Silencios Narrativos Estructurales: Los silencios no son huecos por falta de contenido; son herramientas deliberadas para la asimilación emocional entre el Hook Extremo, el Hook Extendido y la Historia Principal. La IA integrará pausas narrativas estratégicas mediante etiquetas explícitas [pausa: Xs] (ej. [pausa: 1.5s], [pausa: 2s]) procesadas por VoxFlow para generar silencios limpios y exactos, quedando terminantemente prohibido utilizar barras o marcas informales (/2s, /#s).El Hook Extendido y Promesa antes del Segundo 30: Una vez capturada la atención, este bloque expande el contexto histórico, establece las bases del conflicto y articula de forma natural la Promesa Narrativa antes del segundo 30 de video (~segundos 20–30), ubicando todo el bloque del slogan completo en un párrafo aparte exclusivo (desde "En los próximos minutos...", insertando de inmediato la explicación breve de lo que estará pasando en el documental, hasta culminar con "Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros.").La Historia Principal y Micro-Ganchos cada 90 Segundos: Desarrollo profundo del relato con un ritmo de edición variable que fluctúa entre la densidad informativa y la contemplación visual, alternando entre planos humanos directos y amplios paisajes atmosféricos. El espectador no puede saberlo todo en el minuto 2; cada sección debe plantear una nueva interrogante antes de resolver la anterior, manteniendo vivo el misterio cada 90 segundos hasta el desenlace.
[/?TIPO_PRODUCCION]

Capítulo 11: Geometría del Encuadre y Relación de Aspecto
El proyecto exige la creación simultánea de entregables generados a partir de este único prompt maestro. El motor debe comprender las diferencias radicales de composición entre ambos:

[?TIPO_PRODUCCION=INMERSIVO_CONTEMPLATIVO]
- Regla de Títulos (Exclusión): Título inmersivo y directo. Queda terminantemente prohibido añadir el sufijo "| Huellas de la Humanidad", "| Documental Completo" o "(Reconstrucción con IA)".
- Restricciones Léxicas: Bajo ningún concepto utilices la palabra "muertos", "homicidio", u otros sinónimos banales de violencia directa. Mantén el tono periodístico e histórico.
- Formato de Fechas, Siglos y Nombres con Número: Escribe todos los años utilizando números arábigos (ej. 1945, 1492), todos los siglos obligatoriamente en números romanos (ej. siglo XII, siglo XX, siglo XV) y todos los nombres con número obligatoriamente en números romanos (ej. Felipe II Augusto, Luis XIV, jamás en palabras como "Felipe Segundo Augusto").
- Regla de Movimiento de Cámara (Lento): Paneos horizontales extremadamente lentos y panorámicos.
- Arquitectura del Reel Contemplativo Panorámico: El metraje se compone exactamente de tres clips: un clip inicial de 4 segundos para el hook, seguido de dos clips de [?DURACION_CLIPS=10_SEGUNDOS]10 segundos (Total 24 segundos)[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]8 segundos (Total 20 segundos)[/?DURACION_CLIPS]. Queda totalmente prohibida la edición acelerada.
- Audio y Tono Emocional: El video no lleva voz narrativa ni música en ningún clip. Su diseño acústico es exclusivamente Foley ambiental e imagen con el objetivo explícito de causar horror y angustia psicológica en el espectador.
- Herramientas de Generación: Utiliza "nano banana 2.1" para la generación de las imágenes iniciales estáticas de cada clip. Posteriormente, emplea el modelo de video "omni flash" para darle movimiento a dichas imágenes.
[?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]
- Regla de Texto en Pantalla (Exclusivo Clip 1 - Edición Manual en CapCut): El texto en pantalla se coloca ÚNICA Y EXCLUSIVAMENTE en el Clip 1 (Hook). Los Clips 2 y 3 van completamente limpios sin texto en pantalla. En el Clip 1, el texto debe contener obligatoriamente: Ciudad, País, Tiempo (año/siglo) y justo debajo el Título Gancho que resuma con intriga de qué va el video. Dicho texto NO debe incluirse dentro de los prompts de generación de imagen/video (Google Flow debe recibir prompts con 'no text'). La IA debe suministrar en la entrega el texto exacto correspondiente para ser colocado manualmente en CapCut durante el montaje posterior.
[/?TEXTO_PANTALLA_CLIP_1]
[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]
- Regla de Texto en Pantalla (Exclusivo Clip 1 - Generado por IA en Clip 1): El texto en pantalla va ÚNICA Y EXCLUSIVAMENTE en el prompt de video del Clip 1 (Hook de [DURACION_CLIP_1]s), generado directamente por la IA tipo comienzo de un documental cinematográfico (incluyendo Ciudad, País, Tiempo [año/siglo] y justo debajo el Título Gancho con tipografía cinematográfica). Queda terminantemente prohibido incluir el texto en el prompt de la Imagen 1 (la Imagen 1 lleva estrictamente 'no text'). En la edición posterior, el usuario baja la velocidad del Clip 1 y lo lleva a [DURACION_CLIP_1_RALENTIZADO] segundos de duración. Los Clips 2 y 3 van completamente limpios sin texto en pantalla.
[/?TEXTO_PANTALLA_CLIP_1]
- Estructura de Entrega Obligatoria para los 3 Clips:
  * CLIP 1 (HOOK DE [DURACION_CLIP_1]s):
    1. Identificación del Clip y Selección de Cámara: Plano, angulación, movimiento de cámara y óptica seleccionados de los catálogos.
    2. Explicación Visual del Clip: Descripción narrativa y contextual en español explicando con precisión qué ocurre en la escena y cuál es la atmósfera psicológica que transmite el plano.
[?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]
    3. Prompt de Imagen Inicial: En idioma inglés para 'nano banana 2.1' (comenzando obligatoriamente tras la numeración con "Image 1: Create an image " o "Imagen 1: Create an image ", con sufijos obligatorios, 'no text' e incluyendo obligatoriamente tiempo y lugar como referencia visual).
    4. Prompt de Movimiento de Video (con Audio Foley Integrado): En idioma inglés para 'omni flash' (comenzando obligatoriamente con la numeración, el timestamp y la orden en inglés: "Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video ", con diseño foley acústico integrado dentro del propio prompt, incluyendo obligatoriamente tiempo y lugar como referencia visual, y agregando obligatoriamente al final "fix the name").
    5. Texto en Pantalla (Manual CapCut): Ciudad, País, Tiempo (año/siglo) y justo debajo el Título Gancho.
[/?TEXTO_PANTALLA_CLIP_1]
[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]
    3. Prompt de Imagen Inicial: En idioma inglés para 'nano banana 2.1' (comenzando obligatoriamente tras la numeración con "Image 1: Create an image " o "Imagen 1: Create an image ", con sufijos obligatorios, estrictamente 'no text' - el texto en pantalla va exclusivamente en el prompt del Clip 1 de video, NO en la Imagen 1 -, e incluyendo obligatoriamente tiempo y lugar como referencia visual).
    4. Prompt de Movimiento de Video con Texto Integrado (con Audio Foley Integrado): En idioma inglés para 'omni flash' (comenzando obligatoriamente con la numeración, el timestamp y la orden en inglés: "Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video ", con diseño foley acústico integrado, tiempo y lugar como referencia visual, integrando el texto cinematográfico de apertura tipo comienzo de documental cinematográfico, y cerrando obligatoriamente con "fix the name"). En edición posterior se baja la velocidad a [DURACION_CLIP_1_RALENTIZADO] segundos.
    5. Texto en Pantalla (Generado por IA en Clip 1): Ciudad, País, Tiempo (año/siglo) y Título Gancho integrado en el prompt de video del Clip 1 (no en Imagen 1). Indicación de edición: bajar la velocidad de [DURACION_CLIP_1]s a [DURACION_CLIP_1_RALENTIZADO]s.
[/?TEXTO_PANTALLA_CLIP_1]
  * [?DURACION_CLIPS=10_SEGUNDOS]CLIP 2 (10s) y CLIP 3 (10s)[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]CLIP 2 (8s) y CLIP 3 (8s)[/?DURACION_CLIPS]:
    1. Identificación del Clip y Selección de Cámara: Plano, angulación, movimiento de cámara y óptica.
    2. Explicación Visual del Clip: Descripción narrativa y contextual en español.
    3. Prompt de Imagen Inicial: En idioma inglés para 'nano banana 2.1' (comenzando obligatoriamente tras la numeración con "Image [número]: Create an image " o "Imagen [número]: Create an image ", con sufijos obligatorios, 'no text' e incluyendo obligatoriamente tiempo y lugar como referencia visual).
    4. Prompt de Movimiento de Video (con Audio Foley Integrado): En idioma inglés para 'omni flash' (comenzando obligatoriamente con la numeración, el timestamp y la orden en inglés: "Clip [número] (##:## - ##:##): Create a video ", incluyendo obligatoriamente tiempo y lugar como referencia visual, y agregando obligatoriamente al final de cada clip "fix the name").
    (Los Clips 2 y 3 van completamente limpios sin texto en pantalla).
- Tipos de Cámara a Utilizar (Escoge dependiendo de la historia y las escenas):
  1. ESCALA Y ENCUADRE (DISTANCIA PSICOLÓGICA):
  - Gran Plano General / Plano Panorámico: Despoja al ser humano de su agencia y lo convierte en una silueta devorada por el entorno. Transmite asombro melancólico, soledad absoluta e insignificancia ante la inmensidad del tiempo, la geografía o la arquitectura industrial.
  - Plano General (Wide Shot): Establece el contexto espacial, la arquitectura y las condiciones materiales de la escena. Permite situar la magnitud del suceso histórico sin perder la referencia de la presencia humana.
  - Plano Medio (Medium Shot): Encuadra al sujeto desde la cintura o el pecho. Funciona como el puente de la empatía cotidiana: rompe la distancia histórica y conecta al espectador directamente con el esfuerzo físico, la fatiga y la humanidad del individuo.
  - Primer Plano (Close-up): Aísla las emociones en su estado más puro. Arranca al sujeto de su contexto exterior para forzar a la audiencia a confrontar directamente el miedo, la desesperación, la duda o la determinación.
  - Plano Detalle / Macro: Genera una asfixia sensorial y táctil al enfocar micro-texturas (herramientas desgastadas, óxido, papel antiguo, manos temblorosas, sudor). Dirige la atención psicológica hacia la fragilidad material y la tensión acumulada.
  - Toma Tipo Mapa (Historical Map Shot): Encuadre o barrido sobre un mapa antiguo o cartografía histórica de la época (rutas marítimas o terrestres, fronteras o avance territorial dibujado en pergamino antiguo), situando la geografía y escala del relato.
  - Toma de Maqueta (Scale Model / Diorama Shot): Encuadre cinematográfico sobre una maqueta a escala o diorama táctico-arquitectónico histórico (fortificaciones, ciudades antiguas o formaciones de batalla en miniatura hiperdetallada).
  - Toma de Dibujo en Papel en Blanco y Negro (Black and White Paper Sketch Shot): Encuadre sobre un dibujo, boceto o grabado monocromático en blanco y negro sobre papel o pergamino de época (trazos a tinta, carboncillo o aguafuerte de archivo), transmitiendo autenticidad testimonial y rigor documental.
  2. ANGULACIÓN DE CÁMARA (JERARQUÍAS Y PODER):
  - Plano Picado (High Angle): La cámara apunta de arriba hacia abajo, empequeñeciendo y oprimiendo visualmente al sujeto. Comunica vulnerabilidad, derrota, sumisión, inferioridad o impotencia frente a fuerzas superiores.
  - Plano Contrapicado (Low Angle): La cámara mira de abajo hacia arriba. Dota al personaje, máquina o estructura de monumentalidad, poder amenazante, autoridad incontestable o soberbia extrema.
  - Plano Cenital / Ojo de Dios (Overhead Shot - 90°): La lente se sitúa completamente perpendicular al suelo. Deshumaniza el caos o la tragedia reduciéndolos a patrones geométricos abstractos, induciendo en el espectador una sensación de fatalismo distante e inescapable.
  - Plano Nadir (90° hacia el cenit): Perspectiva vertical extrema desde el suelo apuntando hacia el cielo. Provoca una sensación de escala abrumadora, colapso inminente y vértigo arquitectónico.
  3. MOVIMIENTOS CINEMATOGRÁFICOS (CINÉTICA EMOCIONAL):
  - Cámara Fija (Locked-off Shot): Elimina cualquier artificio cinético para obligar al espectador a contemplar la pesadez del tiempo, el silencio y la crudeza de la escena sin filtros narrativos.
  - Slow Dolly Push-in: Acercamiento lento y deliberado hacia un sujeto u objeto fatal. Incrementa la claustrofobia, el suspense y la certeza psicológica de un destino ineludible.
  - Dolly Pull-out / Travelling de retroceso: La cámara se aleja lentamente del centro de atención, amplificando la sensación de abandono, pérdida irremediable o aislamiento en medio de un escenario vacío.
  - Inclinación Suave (Gentle Tilt Up / Down): Revela progresivamente la magnitud vertical de un edificio, ruina o figura humana. Dosifica la información visual para construir asombro o desolación de forma pausada.
  - Plano de Seguimiento (Tracking Shot): Acompaña el desplazamiento continuo del sujeto, arrastrando al espectador dentro del ritmo de la acción e induciendo una tensión constante.
  - Cámara en Mano Inmersiva (Handheld): Movimiento orgánico, reactivo e inestable que replica la mirada de un testigo real sobre el terreno. Transmite desorientación, adrenalina y peligro físico inmediato.
  - Plano Orbital (Orbit Shot - 360°): Gira en torno a un punto o personaje fijo, creando un vórtice visual que separa al elemento central del flujo exterior del tiempo y del mundo.
  - Despliegue Aéreo / Barrido (Drone Reveal): Ascenso o desplazamiento en altura que eleva la perspectiva para dimensionar la escala colosal de un territorio, cataclismo o proceso histórico.
  4. ÓPTICA Y PERSPECTIVA VISUAL:
  - Profundidad de Campo Reducida (Bokeh): Desenfoca agresivamente el fondo para obligar al ojo a concentrarse en un único elemento, aislando el drama emocional del ruido del entorno.
  - Gran Angular / Ultra Gran Angular (14mm - 24mm): Exagera la separación espacial y las líneas de fuga, acentuando la inmensidad de los recintos o la claustrofobia de los espacios cerrados.
  - Lente Teleobjetivo (85mm - 200mm+): Comprime los planos de profundidad, acercando el fondo al sujeto para generar una sensación de agobio, asfixia en masas o vigilancia distante.
  - Punto de Vista en Primera Persona (POV Spectator): Coloca la lente en la posición exacta de los ojos del testigo, eliminando la barrera psicológica para que la audiencia habite físicamente el acontecimiento histórico.
[/?TIPO_PRODUCCION]

[?TIPO_PRODUCCION=REELS]
2. ENTREGABLE: FORMATO REELS ([?SUB_OPCION_REELS=9X16]9:16 VERTICAL[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]16:9 HORIZONTAL[/?SUB_OPCION_REELS])
(Video cinematográfico con duración aproximada definida por el usuario para Reels, TikTok, Shorts o YouTube)
- Composición de Planos: Encuadre centrado (center framed). La profundidad de campo debe comprimirse. El sujeto u objeto principal debe abarcar el 60% del cuadro vertical para retener la atención del escroleo rápido.
- Regla de Movimiento de Cámara: Estaticidad relativa o zoom in digital muy sutil. Se prohíben los paneos horizontales en el formato vertical para evitar desorientación espacial.
- Integración de Enlaces (CTA): Enlace de redirección ubicado exclusivamente en el Comentario Fijado.
- Ley Tipográfica de Seguridad: En los primeros clips del Hook, cualquier letrero exigido por el prompt debe estar perfectamente centrado, con un margen lateral de seguridad ancho y limpio para evitar que la interfaz nativa del móvil lo recorte.
[?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]
- Arquitectura Temporal (Fórmula de Duración Total Aproximada): La duración total del video no tiene que ser exacta al segundo, sino aproximada a la duración pedida, y se compone de: [DURACION_CLIP_1_RALENTIZADO] segundos iniciales sin voz en off cubiertos por el Clip 1 de [DURACION_CLIP_1] segundos de duración (00:00 - 00:[DURACION_CLIP_1_PAD]) más los primeros 2 segundos del Clip 2 (00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]) con puro Foley ambiental, seguidos por la voz narrativa continua que entra exactamente en el segundo [DURACION_CLIP_1_RALENTIZADO] de video [00:[DURACION_CLIP_1_RALENTIZADO_PAD]] (a los 2 segundos de haber iniciado el Clip 2, es decir, el segundo 2 del segundo clip). La suma de los [DURACION_CLIP_1_RALENTIZADO] segundos iniciales sin voz más el tiempo de duración de la voz en off da el total aproximado del video (Total ≈ [DURACION_CLIP_1_RALENTIZADO]s + Tiempo de Voz en Off; es decir, Tiempo de Voz en Off ≈ Duración Total Pedida - [DURACION_CLIP_1_RALENTIZADO]s).
- Voz en Off, Foley y Compensación de Timestamps (+[DURACION_CLIP_1_RALENTIZADO]s): Acompañado de locución narrativa solemne y continua que arranca obligatoriamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video [00:[DURACION_CLIP_1_RALENTIZADO_PAD]] (a los 2 segundos de haber iniciado el Clip 2). Los primeros [DURACION_CLIP_1_RALENTIZADO] segundos (Clip 1 de [DURACION_CLIP_1]s [00:00 - 00:[DURACION_CLIP_1_PAD]] + primeros 2s de Clip 2 [00:[DURACION_CLIP_1_PAD] - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]]) carecen por completo de locución para maximizar el misterio y el impacto sensorial visual con Foley. La IA debe compensar automáticamente el desfase de +[DURACION_CLIP_1_RALENTIZADO] segundos entre la transcripción/audio del usuario (que empieza en 00:00) y el timeline de video en CapCut (que arranca la voz en 00:[DURACION_CLIP_1_RALENTIZADO_PAD]): [?DURACION_CLIPS=10_SEGUNDOS]el bloque inicial de locución (00:00 - 00:08) se asigna a los 8 segundos con voz de Clip 2 ([VOZ_CLIP2_RANGE_10S], donde la voz entra al segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD]), el de 00:08 - 00:18 a Clip 3 ([VOZ_CLIP3_RANGE_10S]), etc.[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]el bloque inicial de locución (00:00 - 00:06) se asigna a los 6 segundos con voz de Clip 2 ([VOZ_CLIP2_RANGE_8S], donde la voz entra al segundo 00:[DURACION_CLIP_1_RALENTIZADO_PAD]), el de 00:06 - 00:14 a Clip 3 ([VOZ_CLIP3_RANGE_8S]), etc.[/?DURACION_CLIPS] La extensión del texto de la voz en off debe calibrarse con la métrica empírica de 15 caracteres por segundo de voz hablada (900 caracteres por minuto) ((Tiempo Total Aproximado - [DURACION_CLIP_1_RALENTIZADO]s iniciales - Tiempo de Pausas) x 15 caracteres con espacios; integrando pausas narrativas estratégicas con etiquetas explícitas [pausa: Xs] según el ritmo dramático y las escenas, las cuales descuentan su duración del tiempo hablado para mantener una duración total aproximada a la pedida, sin utilizar marcas informales /2s o /#s), complementada con el paisaje sonoro de Foley integrado en cada prompt de video (estrictamente sin música en ningún clip). El preámbulo inicial de la voz en off (al segundo [DURACION_CLIP_1_RALENTIZADO] de video / segundo 2 del Clip 2) debe estructurarse obligatoriamente en tres partes: 1) Tiempo (años siempre en números/dígitos; si es únicamente el año sin mes ni día, iniciando obligatoriamente con "Año" [número], ej. "Año 1888", "Año 44 antes de Cristo"), 2) Lugar, ciudad y país mencionado acto seguido sin anteponer "en el" ni preposiciones de relleno (quedando terminantemente prohibido escribir "en el" después del año; cerrando obligatoriamente la oración con un punto justo después de tiempo y lugar, e iniciando una nueva oración con mayúscula), y 3) Descripción breve del lugar, suceso histórico, personaje o tema central abordado (ej. "Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba un cazador nocturno que la policía jamás atrapó."), capturando de inmediato con un gancho profundamente intrigante o terrorífico. La voz en off debe narrar en tercera persona de forma directa y cinematográfica, sin hablar jamás en primera persona del plural ("nosotros") y sin forzar anonimizaciones artificiales ("anónimos").
[/?SINCRONIZACION_CLIP_1]
[?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]
- Arquitectura Temporal (Fórmula de Duración Total Aproximada): La duración total del video no tiene que ser exacta al segundo, sino aproximada a la duración pedida, y se compone de: [DURACION_CLIP_1_RALENTIZADO] segundos iniciales sin voz en off cubiertos exclusivamente por el Clip 1 generado a [DURACION_CLIP_1] segundos (00:00 - 00:[DURACION_CLIP_1_PAD]) cuya velocidad se reduce en edición para llevarlo a [DURACION_CLIP_1_RALENTIZADO] segundos (00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD])[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1] con texto cinematográfico de apertura integrado[/?TEXTO_PANTALLA_CLIP_1] y puro Foley ambiental, seguidos por el Clip 2 que arranca en el segundo [DURACION_CLIP_1_RALENTIZADO] ([?DURACION_CLIPS=10_SEGUNDOS][RAL_CLIP2_RANGE_10S][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS][RAL_CLIP2_RANGE_8S][/?DURACION_CLIPS]) dando comienzo inmediato a la voz narrativa en el segundo [DURACION_CLIP_1_RALENTIZADO] de video (sin los 2s iniciales de foley mudo en Clip 2). La suma de los [DURACION_CLIP_1_RALENTIZADO] segundos iniciales sin voz más el tiempo de duración de la voz en off da el total aproximado del video en el timeline final (Total ≈ [DURACION_CLIP_1_RALENTIZADO]s + Tiempo de Voz en Off; es decir, Tiempo de Voz en Off ≈ Duración Total Pedida - [DURACION_CLIP_1_RALENTIZADO]s).
- Voz en Off, Foley y Compensación de Timestamps (+[DURACION_CLIP_1_RALENTIZADO]s): Acompañado de locución narrativa solemne y continua que arranca obligatoriamente en el segundo [DURACION_CLIP_1_RALENTIZADO] del video (inmediatamente al comenzar el Clip 2 de [?DURACION_CLIPS=10_SEGUNDOS][RAL_CLIP2_RANGE_10S][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS][RAL_CLIP2_RANGE_8S][/?DURACION_CLIPS], al haber cubierto el Clip 1 los [DURACION_CLIP_1_RALENTIZADO] segundos iniciales sin voz al bajarse su velocidad en edición). Por tanto, en el Clip 2 no hay segundos iniciales mudos sin voz; el Clip 2 arranca directamente con la locución narrativa en el segundo [DURACION_CLIP_1_RALENTIZADO]. La IA debe compensar automáticamente el desfase de +[DURACION_CLIP_1_RALENTIZADO] segundos entre la transcripción/audio del usuario (que empieza en 00:00) y el timeline de video en CapCut (que arranca la voz en 00:[DURACION_CLIP_1_RALENTIZADO_PAD]): [?DURACION_CLIPS=10_SEGUNDOS]el bloque inicial de locución (00:00 - 00:10) se asigna a los 10 segundos completos con voz de Clip 2 ([RAL_CLIP2_RANGE_10S]), el de 00:10 - 00:20 a Clip 3 ([RAL_CLIP3_RANGE_10S]), etc.[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]el bloque inicial de locución (00:00 - 00:08) se asigna a los 8 segundos completos con voz de Clip 2 ([RAL_CLIP2_RANGE_8S]), el de 00:08 - 00:16 a Clip 3 ([RAL_CLIP3_RANGE_8S]), etc.[/?DURACION_CLIPS] La extensión del texto de la voz en off debe calibrarse con la métrica empírica de 15 caracteres por segundo de voz hablada (900 caracteres por minuto) ((Tiempo Total Aproximado - [DURACION_CLIP_1_RALENTIZADO]s iniciales - Tiempo de Pausas) x 15 caracteres con espacios; integrando pausas narrativas estratégicas con etiquetas explícitas [pausa: Xs] según el ritmo dramático y las escenas, las cuales descuentan su duración del tiempo hablado para mantener una duración total aproximada a la pedida, sin utilizar marcas informales /2s o /#s), complementada con el paisaje sonoro de Foley integrado en cada prompt de video (estrictamente sin música en ningún clip). El preámbulo inicial de la voz en off (al segundo [DURACION_CLIP_1_RALENTIZADO] de video / inicio de Clip 2) debe estructurarse obligatoriamente en tres partes: 1) Tiempo (años siempre en números/dígitos; si es únicamente el año sin mes ni día, iniciando obligatoriamente con "Año" [número], ej. "Año 1888", "Año 44 antes de Cristo"), 2) Lugar, ciudad y país mencionado acto seguido sin anteponer "en el" ni preposiciones de relleno (quedando terminantemente prohibido escribir "en el" después del año; cerrando obligatoriamente la oración con un punto justo después de tiempo y lugar, e iniciando una nueva oración con mayúscula), y 3) Descripción breve del lugar, suceso histórico, personaje o tema central abordado (ej. "Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba un cazador nocturno que la policía jamás atrapó."), capturando de inmediato con un gancho profundamente intrigante o terrorífico. La voz en off debe narrar en tercera persona de forma directa y cinematográfica, sin hablar jamás en primera persona del plural ("nosotros") y sin forzar anonimizaciones artificiales ("anónimos").
[/?SINCRONIZACION_CLIP_1]
- Estructura de Consulta y Generación de Clips (De 10 en 10 o Todos Juntos): Antes de entregar los prompts de esta etapa, la IA preguntará obligatoriamente al usuario si prefiere recibirlos de 10 en 10 o todos juntos (con ALTO INQUEBRANTABLE esperando su decisión). Si el usuario elige "de 10 en 10", para producciones con más de 10 clips (ej. ~120s con ~12-13 clips totales), la IA entregará los prompts en bloques controlados de 10 clips (Bloque 1: Clips 1 al 10 con ALTO INQUEBRANTABLE esperando confirmación para el Bloque 2: Clips 11 al 13 o restantes). Si el usuario elige "todos juntos", la IA entregará la totalidad de los clips en una sola respuesta continua. Al inicio EXCLUSIVO DEL PRIMER ENVÍO de prompts (Bloque 1 si se eligió de 10 en 10, o al inicio de la entrega continua si se eligió todos juntos), la IA debe anteponer la orden operativa:
Actúa como un historiador, director de cine, y periodista profesional.
Cambia los nombres de los clips a las primeras 6 palabras literales del prompt proveído pegado y enviado que incluyen la numeración.
Usa omni flash para videos y nano banana 2.1 para imágenes iniciales de cada clip.
Crea las imágenes primero y luego los clips usando cada imagen como fotograma inicial.
Usa las imágenes de referencia de personas y lugares para generar las imágenes iniciales y los clips para mantener fidelidad visual.
No hagas cambios de shot nunca en ningun clip (excepto en aquel clip específico donde el prompt indique expresamente hacer dos shots de 5 segundos cada uno porque la voz narrativa cambió de escena) y asegúrate de que los clips de video no hagan desapariciones ni transformaciones, la imagen inicial creada se usará para el inicio de cada clip.
Divide la creación en batches de 10.
rename everything adding _ as the blank spaces between words
from 1 to 9 change them to 01 to 09
(Aclaración Fundamental: Las imágenes con '@' creadas previamente en la Etapa 5 son única y exclusivamente para referencia visual y NO para ser usadas como primer fotograma del video. La orden de usar "cada imagen como fotograma inicial" aplica exclusiva y estrictamente a las imágenes iniciales numeradas de esta etapa: Image 1 para Clip 1, Image 2 para Clip 2, etc.).
(Esta orden operativa NO se repite en el Bloque 2 ni en entregas posteriores). Seguida obligatoriamente de la secuencia de prompts en formato limpio y consecutivo: [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]Image 1: Create an image [prompt], Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt de [DURACION_CLIP_1]s de duración cerrando con fix the name], Image 2: Create an image [prompt], [?DURACION_CLIPS=10_SEGUNDOS]Clip 2 ([VOZ_CLIP2_RANGE_10S]): Create a video [prompt de 10s (1 shot de 10s, la voz entra al segundo [DURACION_CLIP_1_RALENTIZADO] / segundo 2 del Clip 2) cerrando con fix the name], Image 3: Create an image [prompt], Clip 3 ([VOZ_CLIP3_RANGE_10S]): Create a video [prompt de 10s (1 shot de 10s) cerrando con fix the name][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]Clip 2 ([VOZ_CLIP2_RANGE_8S]): Create a video [prompt de 8s (1 shot de 8s, la voz entra al segundo [DURACION_CLIP_1_RALENTIZADO] / segundo 2 del Clip 2) cerrando con fix the name], Image 3: Create an image [prompt], Clip 3 ([VOZ_CLIP3_RANGE_8S]): Create a video [prompt de 8s (1 shot de 8s) cerrando con fix the name][/?DURACION_CLIPS], etc.[/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]Image 1: Create an image [prompt], Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt de [DURACION_CLIP_1]s[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1] con texto integrado[/?TEXTO_PANTALLA_CLIP_1] (bajar a [DURACION_CLIP_1_RALENTIZADO]s en edición) cerrando con fix the name], Image 2: Create an image [prompt], [?DURACION_CLIPS=10_SEGUNDOS]Clip 2 ([RAL_CLIP2_RANGE_10S]): Create a video [prompt de 10s (1 shot de 10s) comenzando con la voz narrativa en el segundo [DURACION_CLIP_1_RALENTIZADO] cerrando con fix the name], Image 3: Create an image [prompt], Clip 3 ([RAL_CLIP3_RANGE_10S]): Create a video [prompt de 10s (1 shot de 10s) cerrando con fix the name][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]Clip 2 ([RAL_CLIP2_RANGE_8S]): Create a video [prompt de 8s (1 shot de 8s) comenzando con la voz narrativa en el segundo [DURACION_CLIP_1_RALENTIZADO] cerrando con fix the name], Image 3: Create an image [prompt], Clip 3 ([RAL_CLIP3_RANGE_8S]): Create a video [prompt de 8s (1 shot de 8s) cerrando con fix the name][/?DURACION_CLIPS], etc.[/?SINCRONIZACION_CLIP_1] Prompt visual para generar la imagen inicial estática utilizando el modelo "nano banana 2.1" ([?SUB_OPCION_REELS=9X16]9:16[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]16:9[/?SUB_OPCION_REELS] con 'no text', redactado al 100% en inglés, comenzando obligatoriamente tras la numeración con "Image [número]: Create an image [prompt]" o "Imagen [número]: Create an image [prompt]", incluyendo obligatoriamente tiempo y lugar como anclaje y referencia visual histórica con prefijo '@' exclusivo para personas (lugares siempre sin '@')), y prompt técnico de movimiento con Foley integrado para generar el clip de video utilizando el modelo "omni flash" (redactado al 100% en inglés, comenzando obligatoriamente con la numeración, el intervalo de tiempo exacto que cubre cada clip en el timeline de CapCut en formato (##:## - ##:##) y la orden de acción obligatoria en inglés "Create a video": "Clip [número] (##:## - ##:##): Create a video [prompt técnico en inglés...]", incluyendo obligatoriamente tiempo y lugar de referencia visual histórica con prefijo '@' exclusivo para personas (lugares siempre sin '@'), [?VOZ_NARRATIVA_EN_CLIPS=INCLUIR]cerrando tras el sufijo de barrera sonora en inglés, incluyendo al final de todo el prompt la porción correspondiente de la voz narrativa colocada directamente como una oración más sin comillas ("") ni paréntesis (()), y agregando obligatoriamente al final "fix the name", ej. [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2][?DURACION_CLIPS=10_SEGUNDOS]"Clip 2 ([VOZ_CLIP2_RANGE_10S]): Create a video [prompt en inglés con tiempo, lugar con '@', foley y sufijo]. Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba... fix the name"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 2 ([VOZ_CLIP2_RANGE_8S]): Create a video [prompt en inglés con tiempo, lugar con '@', foley y sufijo]. Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba... fix the name"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT][?DURACION_CLIPS=10_SEGUNDOS]"Clip 2 ([RAL_CLIP2_RANGE_10S]): Create a video [prompt en inglés con tiempo, lugar con '@', foley y sufijo]. Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba... fix the name"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 2 ([RAL_CLIP2_RANGE_8S]): Create a video [prompt en inglés con tiempo, lugar con '@', foley y sufijo]. Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba... fix the name"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1], quedando terminantemente prohibido omitir "Create an image" o "Create a video", incluir términos en español en los descriptores técnicos del prompt, omitir tiempo y lugar, encerrar la voz narrativa entre comillas o paréntesis, u omitir "fix the name" al final[/?VOZ_NARRATIVA_EN_CLIPS][?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR]cerrando limpiamente tras el sufijo de barrera sonora en inglés (...no text, no speech, no music. fix the name), excluyendo terminantemente el texto de la voz narrativa de los prompts de video, ej. [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2][?DURACION_CLIPS=10_SEGUNDOS]"Clip 2 ([VOZ_CLIP2_RANGE_10S]): Create a video [prompt en inglés con tiempo, lugar con '@', foley y sufijo]. fix the name"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 2 ([VOZ_CLIP2_RANGE_8S]): Create a video [prompt en inglés con tiempo, lugar con '@', foley y sufijo]. fix the name"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT][?DURACION_CLIPS=10_SEGUNDOS]"Clip 2 ([RAL_CLIP2_RANGE_10S]): Create a video [prompt en inglés con tiempo, lugar con '@', foley y sufijo]. fix the name"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 2 ([RAL_CLIP2_RANGE_8S]): Create a video [prompt en inglés con tiempo, lugar con '@', foley y sufijo]. fix the name"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1], quedando terminantemente prohibido omitir "Create an image" o "Create a video", incluir términos en español en los descriptores técnicos del prompt, omitir tiempo y lugar, omitir "fix the name", o añadir texto de locución al final del clip[/?VOZ_NARRATIVA_EN_CLIPS]).
[?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]
- Consulta y Selección Previa de Texto en Pantalla (Apertura del Video - Edición Manual en CapCut): Previamente en la Etapa 6 (tras validar las imágenes de referencia de personas y lugares y antes de los prompts de imágenes iniciales y clips de video), la IA preguntará obligatoriamente al usuario qué texto colocar durante la apertura del video en el Clip 1, proponiéndole de 2 a 3 opciones de gancho visual estructuradas obligatoriamente en: Ciudad, País, Tiempo en la primera línea, y justo debajo la frase de Gancho intrigante, para ser aplicadas manualmente en CapCut (los prompts de Nano Banana 2.1 y Omni Flash se mantienen estrictamente con 'no text').
[/?TEXTO_PANTALLA_CLIP_1]
[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]
- Texto en Pantalla en la Apertura del Video Generado por IA en Clip 1 ([DURACION_CLIP_1]s a [DURACION_CLIP_1_RALENTIZADO]s en Edición): El texto en pantalla para la apertura del video se selecciona previamente con el usuario en la Etapa 6 y es generado directamente por la IA en el prompt técnico del Clip 1 de [DURACION_CLIP_1] segundos (tipo comienzo de un documental cinematográfico con Ciudad, País, Tiempo en la primera línea y justo debajo el Gancho intrigante). Dicho texto va ÚNICA Y EXCLUSIVAMENTE en el prompt del Clip 1, NO en el prompt de la Imagen 1 (la cual lleva estrictamente 'no text'). Recuerda al usuario la instrucción: "En edición, bajar la velocidad del Clip 1 de [DURACION_CLIP_1]s y llevarlo a [DURACION_CLIP_1_RALENTIZADO] segundos de duración".
[/?TEXTO_PANTALLA_CLIP_1]
[/?TIPO_PRODUCCION]

VOLUMEN V: INGENIERÍA DE PROMPTS Y GENERACIÓN VISUAL
Capítulo 12: Reglas de "Text para Flow" (Gestión del Prompter)
El operario o especialista en ingeniería de prompts encargado de alimentar el sistema de IA (Text para Flow) debe adherirse textual, estricta e incondicionalmente a las siguientes directrices de ejecución para salvaguardar la arquitectura del guion, la estabilidad de los servidores de generación y el orden del archivo [Instrucción de Usuario]:Cero Modificaciones: "No modifiques los prompts que te mando, mándalos así mismo y no les hagas cambios". La ingeniería semántica ya ha sido optimizada en la preproducción; la intervención del operario durante el copiado y pegado altera la matriz matemática de los descriptores.Nomenclatura Estricta de Archivos: "Cambia los nombres de los clips a las primeras 6 palabras literales del prompt proveído pegado y enviado que incluyen la numeración y los códigos de tiempo", "rename everything adding _ as the blank spaces between words" y "from 1 to 9 change them to 01 to 09". Esta regla es vital para la sincronización inversa del editor; permite ubicar el clip visual instantáneamente dentro del timeline del audio sin espacios conflictivos y con numeración correlativa estandarizada (01 a 09).Prohibición Estricta de Desapariciones, Transformaciones y Cambios de Shot: "Asegúrate de que los clips de video no hagan desapariciones ni transformaciones ni cambios de shot dentro del clip". En la generación de movimiento con Omni Flash, queda terminantemente prohibido que ocurran cortes internos o saltos de plano dentro del mismo clip, así como la desaparición repentina de personas, ropajes, objetos o elementos arquitectónicos, o su mutación y metamorfosis en elementos incoherentes; cada clip individual debe fluir como un solo shot continuo donde la materia y los personajes preserven su volumen, masa e identidad física de principio a fin.Tolerancia a Fallos: "No reintentes clips que hayan fallado, espera a ver si se generan primero". Saturar el motor con reintentos simultáneos degrada la calidad de renderizado general del servidor.Generación por Lotes (Batches): "Genera los clips en batches de 10". El ecosistema de producción se maneja en bloques controlados para auditar la calidad progresiva.Refrigeración del Motor: "Espera 20 segundos entre cada batch". Esta pausa técnica previene la asfixia del sistema de generación y asegura tiempos de respuesta óptimos.Coherencia Visual Perenne: "Asegúrate de mantener continuidad visual a lo largo de la historia". Si un batch de 10 clips desvía drásticamente la paleta de colores, la materialidad o la arquitectura respecto al bloque anterior, el especialista debe reportar la anomalía para ajustar la semilla, en lugar de continuar ciegamente.
Capítulo 13: Plantilla Base y Motores Oficiales (Omni Flash para Video / Nano Banana 2.1 Universal para Imágenes)
A partir de este hito técnico, Huellas de la Humanidad consolida de manera universal e inquebrantable sus motores oficiales de inteligencia artificial: toda la creación de movimiento y clips de video se realiza sobre el modelo Omni Flash, y la creación de imágenes fijas en CUALQUIER tipo de producción (imágenes iniciales de cada clip, modelos de referencia fisonómica de personas @Personas y lugares @Lugares, keyframes de timelapse, miniaturas oficiales y posts estáticos de próximo estreno, efemérides o controversia) se realiza OBLIGATORIA Y EXCLUSIVAMENTE con el motor Nano Banana 2.1 (Banana 2.1). Queda terminantemente prohibido el uso de motores genéricos o alternativos (como Midjourney, Flux o DALL-E) para la generación de imágenes en todo el ecosistema del canal. Todo prompt debe redactarse en idioma inglés, conformando un único párrafo sólido sin saltos de línea, respetando un orden sintáctico algorítmicamente inalterable.
Prohibición de Bloques de Código / Plain Text: Queda terminantemente prohibido envolver los prompts dentro de bloques de código (evitar el uso de bloques de código Markdown, formato 'plain text' o cajas de código). La IA debe entregar todos los prompts como TEXTO NORMAL y continuo, facilitando su lectura y copiado directo sin cajas de código.
Inclusión Obligatoria de Tiempo y Lugar en Cada Prompt y Regla Estricta de '@' Exclusivo para Personas en Clips/Imágenes Iniciales (Máximo un Solo '@' por Prompt): En CADA prompt de imagen estática (Nano Banana 2.1) y en CADA prompt de clip de video (Omni Flash), la IA tiene la obligación inquebrantable de incluir explícitamente el TIEMPO (año exacto en números/dígitos o época histórica precisa, ej: '1888', '1943', 'Victorian era', 'ancient Rome, 44 BC') y el LUGAR (ciudad, país, entorno geográfico o locación arquitectónica específica redactado estrictamente sin '@', ej: 'Whitechapel, London, England', 'Normandy, France', 'Kyoto, Japan'). Cuando se mencione a un personaje o figura histórica principal modelada previamente en la Etapa 5, se antepondrá obligatoriamente el prefijo '@' en dicho personaje (ej. '@Jack The Ripper in Whitechapel, London, England'). REGLA ESTRICTA DE '@' EXCLUSIVO PARA PERSONAS EN PROMPTS DE IMÁGENES INICIALES Y CLIPS (Y MÁXIMO UN SOLO '@' POR PROMPT): Mientras que en la Etapa 5 se generan imágenes de referencia tanto para personas (@Persona) como para lugares (@Lugar) con un único '@' por prompt, en los prompts de imágenes iniciales y clips de la Etapa 7 los '@' son única y exclusivamente de personas (los lugares y objetos van siempre sin '@'), y solo habrá como máximo un '@' por cada uno. Queda terminantemente prohibido colocar más de un símbolo '@' dentro del mismo prompt. Si la escena incluye al personaje, lleva '@' el personaje; si es un paisaje o arquitectura sin personaje, se redacta sin ningún '@'. Esta referencia visual histórica con un único '@' para personas es indispensable para que el motor generador configure con fidelidad documental la escena sin saturación de etiquetas.
Inclusión Obligatoria de "Create an image" y "Create a video" en Idioma Inglés tras Numeración y Timestamp: En CADA prompt generado, la redacción técnica de la instrucción visual debe realizarse obligatoria y exclusivamente en idioma INGLÉS. Inmediatamente después de la numeración en las imágenes estáticas ("Image [número]: " o "Imagen [número]: "), es obligatorio anteponer la orden de acción en inglés: "Create an image ". En cada prompt de clip de video (Omni Flash), inmediatamente después de la numeración y el timestamp del timeline de CapCut ("Clip [número] (##:## - ##:##): "), es obligatorio anteponer la orden de acción en inglés: "Create a video ". Esto actúa como comando directo para los motores generadores de IA (Nano Banana 2.1 y Omni Flash) que operan en inglés. Queda terminantemente prohibido utilizar palabras en español (como "Crea una imagen" o "Crea un video") dentro del texto de los prompts.
Inclusión Obligatoria de "fix the name" al Final de Cada Clip de Video: En absolutamente CADA prompt de clip de video generado para Omni Flash (Clip 1 en adelante, sin excepción), la IA DEBE AGREGAR OBLIGATORIAMENTE al final de todo el prompt la orden literal en inglés: "fix the name" (agregada al final de la línea del clip, [?VOZ_NARRATIVA_EN_CLIPS=INCLUIR]tras el texto de la voz narrativa si está incluida[/?VOZ_NARRATIVA_EN_CLIPS][?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR]tras el sufijo de barrera sonora 'no text, no speech, no music.'[/?VOZ_NARRATIVA_EN_CLIPS]). Queda terminantemente prohibido omitir "fix the name" al final de cualquier prompt de clip de video.
[?VOZ_NARRATIVA_EN_CLIPS=INCLUIR]
Regla Inquebrantable: Inclusión de la Voz Narrativa al Final como una Oración Más (Sin Comillas ni Paréntesis): En cada prompt de clip de video entregado que tenga locución asignada (Clip 2 en adelante), la IA debe incluir la parte exacta de la voz narrativa que le corresponde según el intervalo de tiempo del timeline de CapCut (##:## - ##:##) compensando los +[DURACION_CLIP_1_RALENTIZADO] segundos. Dicho texto de locución DEBE COLOCARSE OBLIGATORIA Y ESTRICTAMENTE AL FINAL DE TODO EL PROMPT como una oración más, cerrando inmediatamente después del sufijo de barrera sonora en inglés (...no text, no speech, no music. [Texto de la locución]. fix the name). Queda TERMINANTEMENTE PROHIBIDO encerrar la voz narrativa entre comillas (""), ponerla entre paréntesis (()), o anteponer etiquetas burocráticas como '(Voz narrativa: ...)'. El texto del guion se añade limpiamente antes de "fix the name". Para clips sin locución (Clip 1 de 00:00 - 00:[DURACION_CLIP_1_PAD] con duración obligatoria de [DURACION_CLIP_1] segundos), el prompt concluye directamente con el sufijo de barrera sonora y "fix the name" sin oración de voz en off.
[/?VOZ_NARRATIVA_EN_CLIPS]
[?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR]
Regla Estricta: Exclusión de la Voz Narrativa de los Prompts de Clips (Prompts Limpios): En cada prompt de clip de video entregado (Clip 1 en adelante), la IA DEBE EXCLUIR TOTALMENTE el texto de la voz narrativa o locución. El prompt concluye obligatoria y directamente con el sufijo de barrera sonora en inglés (...no text, no speech, no music. fix the name). Queda TERMINANTEMENTE PROHIBIDO anexar el texto del guion o voz en off al final de los prompts de video. La voz narrativa permanece exclusivamente en el guion de la Etapa 4 para locución y sincronización manual en el software de edición (CapCut).
[/?VOZ_NARRATIVA_EN_CLIPS]
[?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2]
Compensación de Timestamps (+[DURACION_CLIP_1_RALENTIZADO]s) en los Intervalos de los Clips (##:## - ##:##): La numeración de los intervalos de tiempo en el timeline de CapCut (##:## - ##:##) debe reflejar con exactitud la sincronización: [?DURACION_CLIPS=10_SEGUNDOS]Clip 1 cubre 00:00 - 00:[DURACION_CLIP_1_PAD] ([DURACION_CLIP_1]s de duración sin voz), Clip 2 cubre [VOZ_CLIP2_RANGE_10S] (primeros 2s sin voz de 00:[DURACION_CLIP_1_PAD] a 00:[DURACION_CLIP_1_RALENTIZADO_PAD], segundo [DURACION_CLIP_1_RALENTIZADO] [segundo 2 del Clip 2] donde entra la voz), Clip 3 cubre [VOZ_CLIP3_RANGE_10S], etc.[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]Clip 1 cubre 00:00 - 00:[DURACION_CLIP_1_PAD] ([DURACION_CLIP_1]s de duración sin voz), Clip 2 cubre [VOZ_CLIP2_RANGE_8S] (primeros 2s sin voz de 00:[DURACION_CLIP_1_PAD] a 00:[DURACION_CLIP_1_RALENTIZADO_PAD], segundo [DURACION_CLIP_1_RALENTIZADO] [segundo 2 del Clip 2] donde entra la voz), Clip 3 cubre [VOZ_CLIP3_RANGE_8S], etc.[/?DURACION_CLIPS]
[/?SINCRONIZACION_CLIP_1]
[?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT]
Compensación de Timestamps (+[DURACION_CLIP_1_RALENTIZADO]s) en los Intervalos de los Clips (##:## - ##:##): La numeración de los intervalos de tiempo en el timeline de CapCut (##:## - ##:##) debe reflejar con exactitud la sincronización: [?DURACION_CLIPS=10_SEGUNDOS]Clip 1 cubre en el prompt 00:00 - 00:[DURACION_CLIP_1_PAD] ([DURACION_CLIP_1]s de duración sin voz, indicando bajar la velocidad en edición a [DURACION_CLIP_1_RALENTIZADO]s para cubrir 00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]), Clip 2 cubre [RAL_CLIP2_RANGE_10S] (al haberse llevado Clip 1 a [DURACION_CLIP_1_RALENTIZADO]s en edición, el Clip 2 comienza directamente con la voz narrativa en el segundo [DURACION_CLIP_1_RALENTIZADO] [00:[DURACION_CLIP_1_RALENTIZADO_PAD]]), Clip 3 cubre [RAL_CLIP3_RANGE_10S], etc.[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]Clip 1 cubre en el prompt 00:00 - 00:[DURACION_CLIP_1_PAD] ([DURACION_CLIP_1]s de duración sin voz, indicando bajar la velocidad en edición a [DURACION_CLIP_1_RALENTIZADO]s para cubrir 00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]), Clip 2 cubre [RAL_CLIP2_RANGE_8S] (al haberse llevado Clip 1 a [DURACION_CLIP_1_RALENTIZADO]s en edición, el Clip 2 comienza directamente con la voz narrativa en el segundo [DURACION_CLIP_1_RALENTIZADO] [00:[DURACION_CLIP_1_RALENTIZADO_PAD]]), Clip 3 cubre [RAL_CLIP3_RANGE_8S], etc.[/?DURACION_CLIPS]
[/?SINCRONIZACION_CLIP_1]
Integración de Audio Foley dentro del Prompt: La descripción acústica y sensorial de los efectos de sonido (Foley) debe quedar redactada e integrada directamente dentro del propio texto del prompt de video en idioma inglés, detallando los sonidos ambientales, acústica del entorno y texturas sonoras de la escena (ej. 'ambient sound of heavy wind, muffled impacts, creaking floorboards, no music, no speech').
Prohibición Absoluta de Música en Clips (Regla de Cero Música en Prompts de Video) y Producción Aislada de Banda Sonora con Suno: Queda terminantemente prohibido incluir música, bandas sonoras de fondo, melodías o pistas musicales en los prompts de generación de cualquier clip de video (aplicable sin excepciones a Reels, Inmersivo Contemplativo, Timelapse y cualquier otro formato de clips). El paisaje sonoro de cada clip debe construirse única y exclusivamente a base de audio Foley ambiental y texturas acústicas reales ('no music'). La banda sonora musical oficial se elabora de forma independiente en una etapa dedicada inmediatamente posterior a la generación de los videos mediante Suno, garantizando pistas aisladas y limpias de Foley, voz narrativa y música para un montaje profesional.
Protocolo Maestro de Banda Sonora en Suno (Consulta de Duración Exacta, Solicitud de Archivo Exclusiva para Auto Reels y Partición Inteligente de 1 a 6 Minutos):
1. Solicitud de Archivo de Video: Exclusiva para Auto Reels (NotebookLM) vs. Cero Archivo en los Demás Formatos:
   - En Auto Reels (Video Automatizado con NotebookLM): La IA tiene la OBLIGACIÓN INQUEBRANTABLE de pedir al usuario el archivo de video generado/exportado. Esta solicitud es indispensable para que la IA inspeccione las secuencias reales del video, su cadencia de montaje, cortes y transiciones visuales, sincronizando la música con precisión milimétrica.
   - En TODOS los demás tipos de video (Reels, Inmersivo Contemplativo, Timelapse): La IA NO debe pedir el archivo de video (queda TERMINANTEMENTE PROHIBIDO pedir o exigir el archivo de video al usuario), ya que la banda sonora se concibe y estructura directamente a partir del guion de locución y el timeline de clips ya acordados en etapas previas.
2. Consulta Obligatoria de la Duración Exacta del Video (Universal para Todos los Tipos de Video):
   En absolutamente todos los formatos de video, al entrar a la etapa de la banda sonora, la IA debe formular obligatoriamente la pregunta al usuario solicitando la duración exacta del metraje final en minutos y segundos (en NotebookLM solicitando video + duración exacta; en los demás tipos solicitando únicamente la duración exacta sin pedir archivo de video), deteniéndose con ALTO INQUEBRANTABLE para esperar la respuesta del usuario.
3. Límites Técnicos Inquebrantables de Suno:
   - Duración MÁXIMA por canción en Suno: 6 minutos (06:00). Suno no permite crear canciones que superen los 6 minutos en una sola pista.
   - Duración MÍNIMA por canción en Suno: 1 minuto (01:00). Suno no permite crear composiciones de menos de 1 minuto de duración.
4. Determinación Inteligente de la Cantidad de Canciones y su Duración:
   A partir de la duración exacta informada por el usuario (y del video en Auto Reels), la IA determina de forma inteligente y fundamentada cuántas canciones serán necesarias y la duración exacta de cada una:
   - Criterio Narrativo y Emocional (Cero Repetición): La partición y diseño musical no es una división fría o aleatoria, sino que se adapta estrictamente al video, la época histórica, la civilización, las escenas y actos específicos que cubre cada pista, la intención dramática y la modulación de tensión (misterio, intriga, crisis, clímax, caída y trascendencia).
   - Metrajes de hasta 6 minutos (y al menos 1 minuto): Determinar si se cubren con 1 sola canción de la duración exacta del video, o con 2 canciones (cada una de al menos 1 minuto) si el metraje experimenta un giro dramático o cambio de acto significativo.
   - Metrajes de más de 6 minutos (ej. 8, 10, 15, 20 o más minutos): Es OBLIGATORIO fraccionar la banda sonora en múltiples canciones consecutivas (cada una con duración calibrada entre 1:00 y 6:00 minutos), asignando cada pista a los distintos bloques temáticos y escenas del video, cubriendo entre todas el 100% de la duración total del video sin que ninguna pista exceda los 6 minutos ni sea menor a 1 minuto.
   - Metrajes de menos de 1 minuto (ej. Inmersivo de 20s): Al tener Suno un mínimo de 1 minuto, la IA genera 1 pista de 1:00 minuto indicando al usuario en el montaje aplicar un fade-out suave al corte final.
5. Estructura y Orden Obligatorio de Entrega de Cada Canción (Ficha Técnica en Orden Estricto e Inquebrantable):
   Por cada canción determinada en cualquier formato de video, la IA debe entregar obligatoria y estrictamente los campos en este orden secuencial:
   1) Título: [Título conceptual de la canción o pista musical]
   2) Duración: [Duración exacta de la pista para Suno, respetando entre 1:00 y 6:00 min]
   3) De dónde a dónde cubre en el video en tiempo: [Intervalo cronológico exacto en el timeline del video, ej. 00:00 - 05:00]
   4) Prompt de Lyrics: [Metatags estructurales en corchetes para el campo 'Lyrics' de Suno para orquestar la progresión acústica sin generar voces, ej. [Instrumental], [Intro], [Period Strings], [Climax], [Outro], estrictamente sin letras ni canto]
   5) Prompt de Style: [Prompt técnico 100% en inglés para el campo 'Style of Music' de Suno: género cinemático, instrumentos auténticos de época, tempo/BPM, dinámicas y directivas negativas: 'strictly instrumental only, no vocals, no singing, no speech, no lyrics']
   6) Explicación de la Canción: [Explicación detallada de cómo suena la canción, qué instrumentos históricos o de época intervienen y cuál es la intención dramática o emocional según las escenas que cubre en el video]
Hiper-Detalle Explicativo y Descriptivo: Los prompts generados no pueden ser escuetos ni genéricos (ej. "a medieval battle"). La IA tiene la obligación inquebrantable de redactar instrucciones visuales densas, inmersivas y altamente detalladas. Cada prompt debe pintar el escenario de forma exhaustiva, especificando meticulosamente la materialidad, las texturas, el estado atmosférico, la incidencia de la luz, la acción física específica y el movimiento exacto de la cámara (ej. "A tight macro shot of a weathered Roman soldier's mud-caked leather armor as heavy rain streaks across his exhausted face, dramatic chiaroscuro lighting casting deep shadows, slow continuous push-in tracking shot").
Nomenclatura Obligatoria de Entrada de Prompts:
- Orden Operativa en una Sola Oración para Prompts de Referencia (Etapa 5): Al inicio obligatorio de la entrega de los prompts de imágenes modelo de referencia de personas y lugares principales (excluyendo objetos sueltos), la IA debe colocar obligatoriamente como preámbulo inicial en una sola oración la siguiente instrucción textual:
  Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente.
- Regla Estricta: Imágenes de Referencia de Personas (@Personas) y Lugares Principales (@Lugares) y Máximo un Solo '@' por Prompt (Etapa 5 y Etapa 7): En la Etapa 5, las imágenes modelo de referencia se generan para las PERSONAS principales (@Personas) y los LUGARES principales (@Lugares) del episodio (sin generar imágenes de referencia para objetos sueltos). Asimismo, tanto en los prompts de imágenes modelo de referencia (Etapa 5) como en los prompts de imágenes iniciales y clips de video (Etapa 7), SOLO HABRÁ COMO MÁXIMO UN ÚNICO SÍMBOLO '@' POR CADA PROMPT (en los prompts de imágenes iniciales y clips de la Etapa 7, si hay un personaje en escena se coloca el único '@' en la persona, ej. '@Jack The Ripper in Whitechapel, London, England, 1888...'; y si la escena muestra únicamente el lugar de referencia sin personaje, puede referenciarse el lugar o escribirse sin acumular múltiples '@').
- Regla Inquebrantable: Imágenes de Referencia Exclusivas para Referencia Visual (Prohibido Usarlas como Primer Fotograma del Video): Las imágenes generadas en la Etapa 5 (modelos de personas @Personas y lugares @Lugares) son ÚNICA Y EXCLUSIVAMENTE para referencia visual en la herramienta de IA (actúan como activos de referencia / asset references para mantener consistencia fisonómica y arquitectónica). Queda TERMINANTEMENTE PROHIBIDO utilizar estas imágenes de referencia como primer fotograma (fotograma inicial) de ningún clip de video. El primer fotograma de cada clip de video se genera obligatoria y exclusivamente en la Etapa 7 con su prompt numerado correspondiente (Image 1 para Clip 1, Image 2 para Clip 2, etc.).
- Orden Operativa Exclusiva al Inicio del Primer Envío de Prompts: Al inicio obligatorio del primer envío de prompts de imágenes y videos (Bloque 1 si se eligió de 10 en 10, o al inicio de la entrega si se eligió todos juntos), la IA debe colocar obligatoriamente como preámbulo inicial la siguiente orden operativa textual (quedando estrictamente prohibido repetirla en bloques posteriores si se entrega de 10 en 10):
  Actúa como un historiador, director de cine, y periodista profesional.
  Cambia los nombres de los clips a las primeras 6 palabras literales del prompt proveído pegado y enviado que incluyen la numeración.
  Usa omni flash para videos y nano banana 2.1 para imágenes iniciales de cada clip.
  Crea las imágenes primero y luego los clips usando cada imagen como fotograma inicial.
  Usa las imágenes de referencia de personas y lugares para generar las imágenes iniciales y los clips para mantener fidelidad visual.
  No hagas cambios de shot nunca en ningun clip (excepto en aquel clip específico donde el prompt indique expresamente hacer dos shots de 5 segundos cada uno porque la voz narrativa cambió de escena) y asegúrate de que los clips de video no hagan desapariciones ni transformaciones, la imagen inicial creada se usará para el inicio de cada clip.
  Divide la creación en batches de 10.
  rename everything adding _ as the blank spaces between words
  from 1 to 9 change them to 01 to 09
  (Aclaración Fundamental: Las imágenes de referencia de personas y lugares son única y exclusivamente para referencia visual —con el fin de mantener fidelidad visual al generar las imágenes iniciales y los clips— y NO para ser usadas como primer fotograma del video. La orden de usar "cada imagen como fotograma inicial" aplica estricta y únicamente a las imágenes iniciales numeradas de esta etapa: Image 1 para Clip 1, Image 2 para Clip 2, etc.).
- Prompts de Imagen Inicial con "Create an image", Tiempo, Lugar y Regla de un Solo '@' Exclusivo para Personas: Todo prompt para generar la imagen fija inicial debe estar redactado al 100% en idioma inglés, comenzando obligatoriamente tras la numeración con la frase: "Image [número]: Create an image " (o "Imagen [número]: Create an image "), e incluir obligatoriamente el TIEMPO y LUGAR como anclaje histórico visual. Si aparece un personaje principal modelado en la Etapa 5, se incluye con '@' (ej. '@Jack The Ripper in Whitechapel, London, England, 1888...'), y si no hay personaje, el lugar y tiempo van sin '@' (ej. 'in Whitechapel, London, England, 1888...'), manteniendo estrictamente que los '@' sean solo de personas y como máximo un único '@' en todo el prompt.
[?VOZ_NARRATIVA_EN_CLIPS=INCLUIR]
- Prompts de Clips de Video con Intervalo Temporal (##:## - ##:##), "Create a video", Tiempo, Lugar, un Solo '@' para Personas, Voz Narrativa y "fix the name" al Final: Todo prompt técnico de movimiento para generar el video con Foley integrado debe estar redactado al 100% en idioma inglés para los comandos y la descripción técnica cinematográfica, comenzando obligatoriamente indicando la numeración, el intervalo de tiempo exacto que cubre cada clip en el timeline de CapCut en formato (##:## - ##:##) y la orden de acción literal en inglés "Create a video ": ("Clip [número] (##:## - ##:##): Create a video [prompt técnico en inglés...]"), incluir obligatoriamente dentro de la descripción técnica en inglés el TIEMPO y LUGAR como referencia visual histórica manteniendo estrictamente que los '@' sean solo de personas y como máximo un solo '@' por cada prompt (en los prompts de imágenes y clips, solo habrá un '@' por cada uno y solo para personas, ej. '@Jack The Ripper in Whitechapel, London, England, 1888...' o 'in Whitechapel, London, England, 1888...'), cerrar la descripción con el sufijo obligatorio de barrera sonora (...no text, no speech, no music.), colocar la porción correspondiente de la voz narrativa como una oración más sin comillas ("") ni paréntesis (()), y agregar obligatoriamente al final "fix the name". Queda estrictamente prohibido omitir la orden "Create a video", incluir términos en español en la orden o descripción técnica del video, colocar '@' a lugares u objetos, colocar múltiples '@', encerrar la voz narrativa entre comillas o paréntesis, u omitir "fix the name" al final. (Ejemplos: [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2][?DURACION_CLIPS=10_SEGUNDOS]"Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt técnico en inglés de [DURACION_CLIP_1]s de duración con tiempo, lugar sin '@', foley, sufijo y fix the name]", "Clip 2 (00:04 - 00:14): Create a video [prompt técnico en inglés con tiempo, lugar, un solo '@' para persona si aplica, foley y sufijo]. Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba... fix the name"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt técnico en inglés de [DURACION_CLIP_1]s de duración con tiempo, lugar sin '@', foley, sufijo y fix the name]", "Clip 2 (00:04 - 00:12): Create a video [prompt técnico en inglés con tiempo, lugar, un solo '@' para persona si aplica, foley y sufijo]. Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba... fix the name"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT][?DURACION_CLIPS=10_SEGUNDOS]"Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt técnico en inglés de [DURACION_CLIP_1]s[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1] con texto cinematográfico[/?TEXTO_PANTALLA_CLIP_1], foley, sufijo (en edición bajar a [DURACION_CLIP_1_RALENTIZADO]s) y fix the name]", "Clip 2 (00:06 - 00:16): Create a video [prompt técnico en inglés con tiempo, lugar, un solo '@' para persona si aplica, foley y sufijo]. Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba... fix the name"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt técnico en inglés de [DURACION_CLIP_1]s[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1] con texto cinematográfico[/?TEXTO_PANTALLA_CLIP_1], foley, sufijo (en edición bajar a [DURACION_CLIP_1_RALENTIZADO]s) y fix the name]", "Clip 2 (00:06 - 00:14): Create a video [prompt técnico en inglés con tiempo, lugar, un solo '@' para persona si aplica, foley y sufijo]. Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba... fix the name"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1], etc.).
[/?VOZ_NARRATIVA_EN_CLIPS]
[?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR]
- Prompts de Clips de Video con Intervalo Temporal (##:## - ##:##), "Create a video", Tiempo, Lugar, un Solo '@' para Personas, Exclusión de Voz y "fix the name" al Final (Prompts Limpios): Todo prompt técnico de movimiento para generar el video con Foley integrado debe estar redactado al 100% en idioma inglés para los comandos y la descripción técnica cinematográfica, comenzando obligatoriamente indicando la numeración, el intervalo de tiempo exacto que cubre cada clip en el timeline de CapCut en formato (##:## - ##:##) y la orden de acción literal en inglés "Create a video ": ("Clip [número] (##:## - ##:##): Create a video [prompt técnico en inglés...]"), incluir obligatoriamente dentro de la descripción técnica en inglés el TIEMPO y LUGAR como referencia visual histórica manteniendo estrictamente que los '@' sean solo de personas y como máximo un solo '@' por cada prompt (en los prompts de imágenes y clips, solo habrá un '@' por cada uno y solo para personas, ej. '@Jack The Ripper in Whitechapel, London, England, 1888...' o 'in Whitechapel, London, England, 1888...'), y cerrar la descripción estrictamente con el sufijo obligatorio de barrera sonora y la directiva al final (...no text, no speech, no music. fix the name), excluyendo terminantemente cualquier texto de locución o voz narrativa al final del prompt. Queda estrictamente prohibido omitir la orden "Create a video", incluir términos en español en la orden o descripción técnica del video, colocar '@' a lugares u objetos, colocar múltiples '@', omitir "fix the name" al final, o agregar texto de voz en off al final del clip. (Ejemplos: [?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2][?DURACION_CLIPS=10_SEGUNDOS]"Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt técnico en inglés de [DURACION_CLIP_1]s de duración con tiempo, lugar sin '@', foley, sufijo y fix the name]", "Clip 2 (00:04 - 00:14): Create a video [prompt técnico en inglés con tiempo, lugar, un solo '@' para persona si aplica, foley y sufijo y fix the name]"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt técnico en inglés de [DURACION_CLIP_1]s de duración con tiempo, lugar sin '@', foley, sufijo y fix the name]", "Clip 2 (00:04 - 00:12): Create a video [prompt técnico en inglés con tiempo, lugar, un solo '@' para persona si aplica, foley y sufijo y fix the name]"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT][?DURACION_CLIPS=10_SEGUNDOS]"Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt técnico en inglés de [DURACION_CLIP_1]s[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1] con texto cinematográfico[/?TEXTO_PANTALLA_CLIP_1], foley, sufijo (en edición bajar a [DURACION_CLIP_1_RALENTIZADO]s) y fix the name]", "Clip 2 (00:06 - 00:16): Create a video [prompt técnico en inglés con tiempo, lugar, un solo '@' para persona si aplica, foley y sufijo]. fix the name"[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]"Clip 1 (00:00 - 00:[DURACION_CLIP_1_PAD]): Create a video [prompt técnico en inglés de [DURACION_CLIP_1]s[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1] con texto cinematográfico[/?TEXTO_PANTALLA_CLIP_1], foley, sufijo (en edición bajar a [DURACION_CLIP_1_RALENTIZADO]s) y fix the name]", "Clip 2 (00:06 - 00:14): Create a video [prompt técnico en inglés con tiempo, lugar, un solo '@' para persona si aplica, foley y sufijo]. fix the name"[/?DURACION_CLIPS][/?SINCRONIZACION_CLIP_1], etc.).
[/?VOZ_NARRATIVA_EN_CLIPS]
- Consulta Previa y Modalidad de Entrega (De 10 en 10 o Todos Juntos): Antes de entregar los prompts de imágenes y videos, la IA debe consultar obligatoriamente al usuario: "¿Prefieres que te entregue los prompts de imágenes iniciales y clips de video de 10 en 10 o todos juntos?", deteniéndose con un ALTO INQUEBRANTABLE para esperar su decisión. Si el usuario elige "de 10 en 10", la entrega para producciones de más de 10 clips se realiza obligatoriamente en bloques de 10 clips (Clips 1 al 10; luego Clips 11 al final), deteniéndose con un ALTO INQUEBRANTABLE al final de cada bloque de 10 para esperar la confirmación del usuario antes de proceder con el siguiente bloque. Si el usuario elige "todos juntos", la IA entrega la totalidad de los clips en una sola respuesta continua.
- Creación Inversa de Imágenes en Timelapse con Nano Banana 2.1 (Desde la Última hacia la Primera): En las producciones de formato Timelapse, la creación de imágenes fijas de transformación debe realizarse obligatoria y exclusivamente con Nano Banana 2.1 (Banana 2.1) en orden inverso: desde la última imagen (el estado final completado) hacia la primera imagen (el origen o cimientos). Esta metodología garantiza que la IA no sufra derivas de escala, deformaciones de perspectiva o desplazamientos de horizonte al generar la evolución temporal.
- Transición Constructiva sin Cambios Bruscos en Prompts de Videos Timelapse: En los prompts de cada clip de videos timelapse, la transformación visual DEBE SER OBLIGATORIAMENTE una transición constructiva fluida, continua y gradual, sin cambios bruscos, sin saltos abruptos (jump cuts) y sin metamorfosis repentinas. El prompt de cada clip debe describir con precisión milimétrica la progresión física constructiva (ej. ensamblaje progresivo de materiales, elevación hilada por hilada, andamiaje orgánico, solidificación de cimientos y muros), blindando la instrucción con comandos en inglés como 'seamless constructive transition, gradual and smooth architectural assembly, strictly no abrupt changes, no sudden cuts, no jarring morphs'.
[?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL]
- Regla de Texto en Pantalla en Prompts (Edición Manual en CapCut): Todos los prompts de imagen y video se mantienen estrictamente con la directriz 'no text'. El texto de apertura se selecciona previamente con el usuario en la Etapa 6 y se coloca manualmente en edición en CapCut durante el montaje.
[/?TEXTO_PANTALLA_CLIP_1]
[?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1]
- Regla de Texto en Pantalla en Prompts (Generado por IA en Clip 1): El texto en pantalla para la apertura se selecciona previamente con el usuario en la Etapa 6 y va ÚNICA Y EXCLUSIVAMENTE en el prompt de video del Clip 1 de [DURACION_CLIP_1] segundos, generado directamente por la IA tipo comienzo de un documental cinematográfico (Ciudad, País, Tiempo en la primera línea y justo debajo el Gancho intrigante con tipografía cinematográfica integrada). Queda TERMINANTEMENTE PROHIBIDO incluir el texto en el prompt de la Imagen 1 (la Imagen 1 lleva estrictamente 'no text'). Asimismo, la IA debe incluir la indicación operativa: "En edición, bajar la velocidad del Clip 1 de [DURACION_CLIP_1]s para llevarlo a [DURACION_CLIP_1_RALENTIZADO] segundos de duración". Los prompts de video restantes van limpios sin texto en pantalla.
[/?TEXTO_PANTALLA_CLIP_1]
Ley de Redundancia y Barrera Sonora (El Sufijo Obligatorio):
Para garantizar la estética documental, evitar mutaciones hacia el 3D o la fantasía, e impedir que la IA genere murmullos acústicos o pistas musicales, cada prompt de imagen debe finalizar cerrando matemáticamente con esta cadena literal:
cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no text, no speech, no music.
Y cada prompt de clip de video (Omni Flash) debe incluir obligatoriamente en su cierre la directriz de un solo shot continuo sin saltos de shot ni cortes ni transformaciones ni desapariciones (o la estructura explícita de dos shots de 5 segundos cada uno ["two-shot sequence of 5 seconds each: Shot 1 [0s-5s]...; Shot 2 [5s-10s]: clean cinematic cut at second 5 to..."] en aquel clip específico donde una escena se demoraría demasiado visualmente porque la voz narrativa y sus pausas ya cambiaron a otra escena) junto con el sufijo obligatorio:
single continuous shot, strictly no shot changes, no camera cuts, no jump cuts, no morphing or disappearing elements, strictly no music, no speech, cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no text, no speech, no music.

Capítulo 14: Catálogos Íntegros de Parametrización
Con el fin de erradicar la ambigüedad que produce alucinaciones en la IA, los directores deben utilizar exclusivamente términos pertenecientes a los siguientes catálogos estandarizados para construir los bloques del prompt.

14.1 Banco de Planos y Movimientos Cinematográficos
Existe una auditoría visual implacable: Está terminantemente prohibido reutilizar el mismo tipo de plano o movimiento de cámara de forma idéntica en un rango de 6 a 8 clips consecutivos.
Regla Inquebrantable de Variación Cinematográfica Intra-Escena: Cuando la voz narrativa permanezca durante más de 10 segundos (o a lo largo de clips consecutivos) describiendo una misma escena, hecho o acontecimiento histórico, queda estrictamente prohibido generar la misma escena visual repetida; la IA debe ofrecer tomas cinematográficas totalmente distintas en cada clip consecutivo variando obligatoriamente la dinámica de cámara, el ángulo de visión (frontal, contrapicado, cenital, POV), la escala de encuadre (alternando entre planos generales y planos macro de detalle) y los focos de atención o acciones simultáneas dentro del entorno histórico.
- Movimientos Clave: Orbit shot (movimiento orbital 360 para artefactos), Slow dolly push-in (acercamiento lento hacia un sujeto para tensión), Tracking shot (cámara de seguimiento tras un personaje), Gentle tilt up/down (inclinaciones verticales para revelaciones lentas).
- Perspectivas Aéreas y Escala: Drone reveal, Overhead, Fast aerial sweep, Crane up / Crane down.
- Inmersión y Textura: Macro / Rack focus, POV spectator, Handheld immersive (cámara en mano para crisis).
- Tomas Documentales de Archivo, Cartografía y Contexto Histórico (Válidas para Todos los Tipos de Videos):
  * Toma Tipo Mapa (Historical Map / Cartographic Sweep Shot): Paneo, zoom o recorrido cinematográfico lento sobre un mapa antiguo, atlas histórico o cartografía de época plasmada sobre pergamino envejecido (detallando rutas de expedición militar, travesías marítimas, fronteras imperiales en disputa, orografía y planos tácticos).
  * Toma de Maqueta (Scale Model / Architectural Diorama Shot): Encuadre cinematográfico a escala sobre una maqueta táctica o diorama histórico tridimensional hiperdetallado (recreación en miniatura a escala de la ciudadela amurallada, fortaleza, acrópolis, campo de batalla, navío de guerra o complejo arquitectónico con iluminación dramática).
  * Toma de Dibujo en Papel en Blanco y Negro (Black and White Paper Sketch / Vintage Monochrome Engraving Shot): Toma o plano cinematográfico enfocado en un dibujo, boceto, ilustración o grabado monocromático en blanco y negro plasmado sobre papel de época o pergamino texturizado (trazos a pluma, tinta china, carboncillo, xilografía o aguafuerte histórico de archivo testimonial).
- Efectos Narrativos: Archival reel zoom, Silhouette / Shadow composition, Museum miniature, Reflection shot, Interior tracking, Timelapse / Hyperlapse, Push through smoke, Dolly in / Dolly out, Simulated TV news.

14.2 Óptica y Lentes (Textura Cinematográfica)
Para evitar el aspecto plástico hiperrealista (CGI), es obligatorio especificar la textura del lente:
- 35mm film grain: Textura clásica de cine histórico.
- 16mm vintage footage: Desgaste auténtico de celuloide antiguo (para evocar metraje de archivo, noticieros de época y conflictos bélicos del pasado reciente).
- Shallow depth of field (f/2.8): Enfoque nítido en el sujeto y fondo difuminado (bokeh) para aislar emociones en entornos caóticos.
- Anamorphic lens flare: Destellos horizontales cinemáticos ante luz directa o fuego de fondo.

14.3 Catálogo de Iluminación y Atmosférica
La luz prescribe la respuesta emocional antes de que se entienda la imagen:
- Ciclos de Claridad: Amanecer, dawn fog, golden hour, midday haze, overcast.
- Intimidad y Oscuridad: Torchlight, candlelight, oil lamp, gaslight. Esenciales para interiores de época.
- Tensión y Catástrofe: Moonlight, storm light, volcanic glow, industrial smoke diffusion.

14.4 Catálogo de Materialidad y Sustrato
El entorno carece de peso si no se especifica el origen de su materia:
- Telas y Vestimentas: Tattered linen (lino desgarrado), heavy wool (lana gruesa), rusted chainmail (cota de malla oxidada), faded silk (seda descolorida).
- Texturas de Época: Parchment paper (pergamino), cracked leather (cuero agrietado), cobblestone (adoquines).
- Estructuras Geológicas: Granite, limestone, sandstone, basalt, wet mud, volcanic ash.
- Ingeniería Humana y Metalurgia: Weathered timber, hemp rope, adobe, brick masonry, slate roof, cast iron, oxidized copper, brass.

14.5 Modificadores de Tiempo y Ritmo
Candados de velocidad para evitar animaciones erráticas en la generación de video:
- Ultra-slow motion: Para capturar micro-expresiones o destrucción detallada (ej. polvo cayendo).
- Steady pace / Deliberate movement: Mantiene el tono solemne y evita paneos frenéticos o temblorosos.

14.6 Catálogo de Emociones (El Paisaje Psicológico)
La historia ocurre tanto en el mundo material como en la psique de quienes la experimentan. Debemos insinuar de manera constante estas emociones en la población anónima para que el espectador conecte:
- Miedo e Incertidumbre: Ante lo desconocido o el peligro inminente (ej. observar el horizonte en completo silencio antes de un impacto o asedio).
- Desesperación y Agotamiento (Despair/Collapse): El colapso físico y mental ante situaciones extremas.
- Esperanza y Triunfo (Hope/Triumph): La resiliencia humana y la dignidad frente a la catástrofe.
- Soledad (Loneliness): El aislamiento en medio del caos o en la inmensidad de la historia.
- Adaptación y Resignación: Cómo la vida cotidiana continúa a pesar de que el mundo se desmorona.
- Asombro (Awe): Frente a la majestuosidad de la ingeniería o la fuerza de la naturaleza.

[?TIPO_PRODUCCION=TIMELAPSE]
Capítulo 15: Las 7 Leyes de Oro del Timelapse 3D Histórico (Módulo Veo 3.1)
1. La Arquitectura del Prompt "Punto A al Punto B" (Anclaje Inverso y Transición Constructiva): La IA no sabe hacer un timelapse por sí sola si le damos una idea abstracta; alucinará imágenes desconectadas. Hay que anclarla dándole los dos extremos de la transformación, habiendo concebido y generado previamente la imagen final de destino para derivar con precisión milimétrica la imagen de origen. En los prompts de cada clip, la evolución visual debe plantearse obligatoriamente como una transición constructiva sin cambios bruscos. La Fórmula Mágica: "Create a fast-paced [tipo] timelapse video showing a seamless constructive transition of [sujeto] gradually, organically and smoothly without abrupt changes from the first frame ([describir Imagen A]) to the final frame ([describir Imagen B]), progressive architectural assembly, strictly no abrupt cuts, no sudden shifts."
2. Creación Inversa de Imágenes con Nano Banana 2.1 y Flujo en Cadena (Desde la Última hacia la Primera): En los videos timelapse, las imágenes fijas serán creadas obligatoria y exclusivamente con el motor Nano Banana 2.1 (Banana 2.1) desde la última hacia la primera. Para blindar la coherencia geométrica, la estabilidad del horizonte y la escala tridimensional exacta, se genera primero la imagen final del timelapse (la culminación arquitectónica o estado final del proceso histórico) y a partir de esa referencia fija se conciben y crean en retroceso las imágenes previas hasta llegar a la primera imagen (los cimientos o estado inicial). Para que una secuencia de clips parezca un solo video ininterrumpido en el montaje final cronológico, el flujo opera en cadena: la Imagen Final del Clip 1 se convierte automáticamente en la Imagen Inicial del Clip 2. Solo el primer clip en el flujo de producción necesita concebirse con base en la imagen ancla ya establecida, facilitando la definición de hacia dónde van (Imagen Final) y cómo se mueven (Prompt de Video con Omni Flash).
3. El Diccionario de la Fluidez y la Transición Constructiva (Prohibido los cambios bruscos y el lenguaje agresivo): En los prompts de cada clip, el cambio debe ser rigurosamente una transición constructiva sin cambios bruscos. Usar palabras violentas o repentinas confunde a la IA, haciéndole creer que ocurre un cataclismo o un salto temporal descontrolado. Palabras Prohibidas: Violently, aggressively, rapidly, collapsing, crashing, sudden, abrupt, abrupt changes, jarring morph, popping, instant jump cut. Palabras Obligatorias: Seamless constructive transition, smoothly assemble, organically weave, fluid transition, gradually rising, chronological progression, layer-by-layer assembly, graceful physical materialization, without abrupt changes. Todo debe sonar como una danza matemática elegante donde la materia se construye de manera continua y orgánica.
4. El Escudo Anti-Violencia y Alucinaciones: Cuando le pedimos a la IA que marchite o destruya un escenario, alucina destellos de artillería o fuego. Hay que declarar la zona geográficamente muerta. Comandos en el Prompt: Usar la frase "EMPTY of people / absolutely no people", y blindar con el comando negativo estricto: "No explosions, no artillery flashes, no smoke, no bombs, no sudden blasts, no fire, no violence." El drama debe ser climático, no bélico.
5. La Cámara Tridimensional Continua: Obligar a la cámara a mantener un movimiento direccional lento y constante (ej. continuous, steady 3D slow push-through o continuous 3D slow pull-back). El contraste entre el mundo transformándose en cámara rápida y la cámara moviéndose suavemente genera la hipnosis 3D.
6. El Diseño Sonoro (Foley) Transicional: El sonido debe mutar sincronizado con la imagen. El prompt de Foley debe indicar de dónde viene y hacia dónde va. Ejemplo: "Synchronized foley of melting ice dripping rapidly shifting smoothly into a gentle spring breeze, strictly no music." Estrictamente sin música ni melodías de fondo en ningún clip.
7. Cierres Orgánicos (Cero Pantallas Negras Artificiales): El último clip no debe ser un corte duro. La cámara debe avanzar suavemente hacia una sombra profunda del propio escenario (un callejón, un bosque oscuro) hasta que el ambiente oscurezca la pantalla. De ese negro natural emerge el logotipo. Queda estrictamente prohibido mostrar el logotipo en pantalla en cualquier otro momento del documental; su aparición es exclusiva del plano final.
[/?TIPO_PRODUCCION]

VOLUMEN VI: DISEÑO SONORO Y PAISAJES ACÚSTICOS
Capítulo 16: Ingeniería de Foley y Regla de Cero Música y No-Voces
El audio es la argamasa que consolida la reconstrucción tridimensional. En Huellas de la Humanidad, queda estrictamente prohibido el uso de música, bandas sonoras de fondo o cualquier pista melódica en todos los clips y formatos; se orquesta única y exclusivamente un paisaje acústico foley y ambiental de ultra realismo ('no music, no speech').
Regla de Cero Música y No-Voces IA: Queda terminantemente prohibida la inclusión de música o de voces humanas generadas por motores visuales en cualquier clip de cualquier formato. Las inteligencias artificiales de video a menudo alucinan pistas musicales no deseadas, coros fantasmales, risas inconexas o murmullos robóticos. Los prompts de video deben incluir obligatoriamente las directrices negativas 'no music, no spoken voice, no human speech' además del sufijo maestro 'no music, no speech'. La edición en postproducción debe silenciar cualquier filtración musical o vocal restante.
Foley Obligatorio por Shot Interno: La textura visual exige correspondencia sonora puramente ambiental. Cada clip general ([?DURACION_CLIPS=10_SEGUNDOS]de 10 segundos[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]de 8 segundos[/?DURACION_CLIPS] en Reels / formato vertical, o duración correspondiente según el formato), debe tener asignada una capa de diseño sonoro (Foley natural). El guionista o editor debe detallar el audio exacto para cada corte (ej. synchronized foley of a wooden cart creaking on cobblestone, strictly no music). Si la acción acústica fluye continuamente desde el plano anterior, se debe declarar la instrucción operativa: Continuation of previous shot's acoustic ambience.
Regla Inquebrantable de la Voz Narrativa en Auto Reels (Masculina Siempre): En las producciones de Auto Reels (Video Automatizado con Google NotebookLM), la voz narrativa es MASCULINA SIEMPRE. Queda terminantemente prohibido utilizar voces femeninas, sugerir alternativas de voz o consultar al usuario qué género de voz prefiere. La locución está predefinida e inalterablemente sellada como un monólogo continuo de narrador único en off con voz masculina documental cinematográfica (profunda, solemne, cálida, autoritaria e inmersiva en idioma español neutro).

[?TIPO_PRODUCCION=REELS|TIMELAPSE]
Anclaje Visual al Eslogan y Cierre Oficial de la Voz Narrativa:
- Escena Obligatoria de la Mesa de un Historiador Antiguo para el Slogan Completo al Principio (~segundos 20–30): Para el clip que cubre la parte donde la voz narrativa dice el Slogan Completo al principio del video ("En los próximos minutos... Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros."), la imagen inicial y el clip de video deben retratar obligatoriamente una escena de una mesa de un historiador antiguo llena de objetos antiguos, además de pergaminos, plumas de escritura, bote de tinta, entre otros artefactos históricos.
- Cierre Obligatorio de la Locución con Llamada a Comentarios, Eslogan Corto en Párrafo Aparte y Último Clip en Escena Panorámica Amplia y Rica Visualmente (Prohibido Objeto Close-Up): En la pista de audio / locución del video, antes del slogan del cierre de la voz narrativa, la voz en off debe incluir obligatoriamente la frase: "Déjanos saber en los comentarios..." (formulada textualmente con los puntos suspensivos o completada orgánicamente con la interrogante histórica), y culminar pronunciando como frase final de cierre el slogan corto de la marca: "Cada historia deja una huella. Aquí seguimos sus rastros." (ej. "Déjanos saber en los comentarios... Cada historia deja una huella. Aquí seguimos sus rastros."), ubicado obligatoriamente separado en un párrafo aparte al final del guion. En los Reels, su pronunciación debe coincidir milimétricamente con el último clip del metraje, el cual NO debe ser un objeto close-up ni un plano macro, sino OBLIGATORIAMENTE una escena panorámica amplia y rica visualmente (wide panoramic shot / sweeping cinematic vista) que cierre el episodio con grandeza e inmersión histórica.
- En la METADATA de publicación (texto de la descripción), el eslogan también se incluye de forma obligatoria ubicado inmediatamente después de la Nota IA y antes de los hashtags ("Cada historia deja una huella. Aquí seguimos sus rastros.").
[/?TIPO_PRODUCCION]

VOLUMEN VII: EMPAQUE, SEO Y DISTRIBUCIÓN ALGORÍTMICA
Capítulo 17: Arquitectura del Empaque (YouTube / Redes)
La publicación del episodio requiere una estrategia algorítmica tan precisa como su creación visual, orientada a dominar el CTR (Click-Through Rate) y la retención profunda.1. Dirección de Arte para Miniaturas, Regla del Logo de la Derecha ("HD" para 9:16 y "8K" para 16:9 en Dorado al 5%), Texto en Pantalla y Logo Oficial de la Página:
La miniatura funciona como un ancla psicológica pre-inmersiva, no como un fotograma pasivo.Debe inyectar una emoción dominante evidente y una contradicción visual que desestabilice las expectativas (ej. un monarca rodeado de miseria extrema).Toda la composición debe evaluarse reduciendo su tamaño a la escala de una pantalla móvil para asegurar legibilidad.En contextos históricos densos, la miniatura debe emplear el lugar y el año como ancla de autoridad.
Regla del Texto en Pantalla en Miniaturas (Obligatorio): La miniatura TIENE QUE TENER texto en pantalla obligatoriamente (de 1 a 3 palabras de impacto brutal con tipografía cinematográfica de alto contraste integrada orgánicamente en la imagen: abajo a la izquierda en formato horizontal 16:9 y centrado y justificado en el medio de la imagen en formato vertical 9:16). Bajo ningún concepto se puede repetir lo mismo entre el texto de la miniatura, el título del video y el texto en pantalla en los primeros 8 segundos; su función es complementarse semánticamente sin repetirse.
Regla Inquebrantable del Logo en Dorado al 5% en la Esquina Superior Derecha (Diferenciado por Relación de Aspecto: "HD" para Videos 9:16 y "8K" para Videos 16:9) y Preservación Estricta del Logo Oficial con su Texto Inferior ('Huellas de la Humanidad'): Para todos los videos en formato vertical 9:16 (Inmersivo Contemplativo, Reels 9:16, Timelapse 9:16), el logo en la esquina superior derecha creado nativamente por la IA será obligatoriamente "HD" en dorado al 5% ('a small discreet 5% scale logo in the top right corner displaying "HD" in metallic gold'). Para videos en formato horizontal 16:9 (NotebookLM / Auto Reels 16:9, Reels 16:9), dicho logo será "8K" en dorado al 5% ('a small discreet 5% scale logo in the top right corner displaying "8K" in metallic gold'). Todas las miniaturas y posts con imagen llevarán el logo oficial de la página mantenido como imagen de referencia en la esquina superior izquierda al 5%, preservando de forma obligatoria el texto inferior "Huellas de la Humanidad".
Énfasis Inquebrantable en el Texto Inferior del Logo de la Marca: La IA tiende a obviar o recortar el texto que tiene debajo el logo oficial de nuestra página; por ende, en CADA prompt de imagen (miniaturas y posts 3:4), es OBLIGATORIO instruir de forma explícita e imperativa la preservación y renderizado nítido de dicho texto inferior: 'official page logo cleanly integrated in the top-left corner from provided reference image at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text'. Queda terminantemente prohibido omitir el texto "Huellas de la Humanidad" del logo.
Formato del Prompt de la Miniatura: Al generar o solicitar el prompt de la miniatura, se redactará al 100% en inglés iniciando con 'Thumbnail: Create an image [descripción visual de alto impacto cinematográfico, sujeto, atmósfera, tiempo y lugar, contradicción visual, composición segura para móviles, texto en pantalla obligatorio de 1 a 3 palabras en Auto Reels (opcional en otros formatos), y obligatoriamente: a small discreet 5% scale logo in the top right corner displaying "HD" (para videos 9:16) o "8K" (para videos 16:9) in metallic gold, official page logo cleanly integrated from provided reference image at 5% scale strictly preserving text "Huellas de la Humanidad", cinematic documentary realism, safe framing composition, no CGI look, no modern objects]'.
2. Estrategia de la Metadata ("Todo Corrido" Sin Encabezados):
Regla del Título (Cero Menciones IA y Regla para Videos >8 min): Al proponer el título del video, queda terminantemente prohibido utilizar el sufijo "(Reconstrucción con IA)", "| Huellas de la Humanidad" o similares.
[?TIPO_PRODUCCION=NOTEBOOKLM_VIDEO]
Regla Inquebrantable del Título en Video Automatizado (NotebookLM):
En TODOS los videos generados con Google NotebookLM, el título DEBE CONCLUIR OBLIGATORIA E INQUEBRANTABLEMENTE con el sufijo " | Documental Completo" al final (ejemplo: "[Título Inmersivo] | Documental Completo"). Queda terminantemente prohibido omitir " | Documental Completo".
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=REELS|TIMELAPSE]
Para videos de más de 8 minutos de duración, el título DEBE CONCLUIR OBLIGATORIA E INVARIABLEMENTE con el sufijo " | Documental Completo" al final (ej. "[Título Inmersivo] | Documental Completo"). Para videos de hasta 8 minutos (formato Reels y promocionales), deben finalizar con un separador vertical "|" seguido de una palabra o frase muy corta y referente al tema (ej. " | Historia", " | Roma", " | Misterio"). Queda estrictamente prohibido utilizar "(Reconstrucción con IA)".
[/?TIPO_PRODUCCION]
Prohibición Universal de Encabezados de Sección y Excepción Única y Obligatoria del Encabezado "Capítulos:" en YouTube: Para ninguna producción necesitamos el encabezado de las secciones de la metadata excepto el de los Capítulos:. Elimina de forma absoluta y universal los encabezados burocráticos y etiquetas de sección en cualquier tipo de producción (Reels, Post con Imagen, Inmersivo, Timelapse, Auto Reels / NotebookLM). Queda terminantemente prohibido escribir encabezados o etiquetas identificativas como "Título:", "Descripción:", "Nota IA:", "Slogan:", "Hashtags:", "Tags:", "Tags SEO:", "Comentario Fijado:", etc. Ninguna sección de la metadata debe llevar una etiqueta o encabezado identificativo antes de su contenido. La redacción de la metadata debe aplicar rigurosamente el sistema "Todo Corrido", CON LA ÚNICA EXCEPCIÓN OBLIGATORIA DEL ENCABEZADO "Capítulos:" EN LA METADATA PARA YOUTUBE: en YouTube NO PUEDE FALTAR EL ENCABEZADO "Capítulos:" antes del bloque de marcas de tiempo para activar e identificar de forma estándar los capítulos interactivos en el reproductor. Queda terminantemente prohibido omitir la palabra "Capítulos:" en YouTube, y queda igualmente prohibido colocar cualquier otro encabezado en cualquier plataforma o formato. Para separar cada bloque lógico de metadata, se debe dejar una línea en blanco utilizando obligatoriamente el carácter de espacio invisible braille (⠀) para forzar el salto de línea visual en las plataformas.
Regla Inquebrantable de División de la Descripción en 3 Párrafos: El cuerpo de la descripción del video debe redactarse y estructurarse obligatoria e inquebrantablemente en EXACTAMENTE TRES (3) PÁRRAFOS, separados entre sí por una línea en blanco con el carácter de espacio invisible braille (⠀). Queda terminantemente prohibido redactar la descripción como un solo bloque macizo de texto, en dos párrafos o en cuatro o más párrafos. Los 3 párrafos deben distribuir armónicamente la narrativa histórica (Párrafo 1: Gancho histórico y planteamiento inicial; Párrafo 2: Contexto, personajes clave y tensión dramática; Párrafo 3: Consecuencias históricas, legado o reflexión final envolvente), garantizando máxima legibilidad y retención en plataformas móviles.
Regla Inquebrantable de No Repetición entre Miniatura, Título y Texto en Pantalla en los Primeros 8 Segundos (y Libertad en el Resto de la Metadata): Lo que NO podemos hacer bajo ningún concepto es repetir lo mismo entre el texto en pantalla de la Miniatura, el Título del video y el Texto en pantalla en los primeros 8 segundos (apertura del video). Estos tres elementos de impacto deben ser completamente distintos entre sí y complementarse sin repetir la misma frase. En cambio, en lo demás de la metadata (los 3 párrafos de la descripción, capítulos, etc.) no importa que se repitan algunas palabras.

[?TIPO_PRODUCCION=REELS|TIMELAPSE|INMERSIVO_CONTEMPLATIVO|NOTEBOOKLM_VIDEO]
Regla Estricta de Extensión y Estructura por Plataforma (Facebook/TikTok, Instagram, YouTube):
En todos los formatos, la metadata no se entrega de forma genérica, sino calibrada matemáticamente para la plataforma específica que el usuario le pida a la IA (si no se especifica, la IA consultará para cuál plataforma se requiere):
1. Facebook / TikTok:
   - Extensión Total: Exactamente 3000 caracteres contando espacios y líneas con carácter braille (⠀), medidos ininterrumpidamente DESDE el inicio del título HASTA el final de los 5 hashtags (incluyendo título, descripción dividida en sus 3 párrafos, nota IA, slogan y 5 hashtags).
   - Sin Tags: Queda terminantemente prohibido incluir bloque de tags ("no tags").
2. Instagram:
   - Extensión Máxima Estricta (Hasta 1200 Caracteres): Las descripciones de Instagram no pueden tener más de 1200 caracteres bajo ninguna circunstancia. La extensión debe calibrarse hasta un máximo estricto de 1200 caracteres contando espacios y líneas con carácter braille (⠀), medidos ininterrumpidamente DESDE el inicio de la descripción (o título en videos) HASTA el final de los 5 hashtags (incluyendo descripción dividida en sus 3 párrafos, nota IA oficial, slogan y 5 hashtags de dos palabras).
   - Sin Tags: Queda terminantemente prohibido incluir bloque de tags ("no tags").
3. YouTube:
   - Extensión Total: Exactamente 3000 caracteres contando espacios y líneas con carácter braille (⠀), medidos ininterrumpidamente DESDE el inicio del título HASTA el final de los 5 hashtags (incluyendo título, descripción dividida en sus 3 párrafos, sección de Capítulos con encabezado "Capítulos:" y sus 10 marcas de tiempo en documentales de NotebookLM para YouTube, nota IA, slogan y 5 hashtags).
   - Bloque de Tags SEO (500 Caracteres): Inmediatamente después de los 5 hashtags (separado por una línea invisible con braille ⠀) y antes del comentario fijado, se incluye obligatoriamente un bloque de tags SEO de exactamente 500 caracteres separados por comas contando espacios y comas.
En todas las plataformas, la IA debe graduar la densidad y extensión de la descripción (distribuida armónicamente en sus 3 párrafos) para que todo el conjunto alcance matemáticamente la cifra requerida.
[/?TIPO_PRODUCCION]

Regla Estricta de Fechas, Siglos, Nombres con Número y Siglas en la Metadata: Todos los años mencionados en el título y en la descripción deben escribirse invariablemente en formato numérico (dígitos, ej: 1888, 1943), jamás en palabras o letras. Asimismo, todos los siglos deben escribirse obligatoriamente en números romanos con mayúsculas tanto en la voz en off como en los títulos y descripciones (ej. siglo XII, siglo XIX, siglo IV a.C., siglo XXI), quedando terminantemente prohibido escribirlos en arábigos (ej. prohibido "siglo 19") o en palabras (ej. prohibido "siglo diecinueve"). De igual forma, todos los nombres con número (monarcas, papas, emperadores, faraones o dinastías, ej. Felipe II Augusto, Luis XIV, Enrique VIII, Carlos V, Juan Pablo II) deben escribirse SIEMPRE en números romanos (ej. "Felipe II Augusto"), quedando terminantemente prohibido escribirlos en palabras (prohibido "Felipe Segundo Augusto") o en números arábigos (prohibido "Felipe 2 Augusto"). En las descripciones y metadata escrita, las referencias de era deben escribirse obligatoriamente en siglas ("a.C." y "d.C.", ej: "44 a.C.", "siglo IV a.C."), a diferencia de la voz en off donde se escriben obligatoriamente en palabras ("antes de Cristo" y "después de Cristo").

[?TIPO_PRODUCCION=REELS|TIMELAPSE|INMERSIVO_CONTEMPLATIVO]
Regla de Capítulos en YouTube (Prohibido Poner el Primer Capítulo como "Prólogo"): En Reels cortos verticales y videos promocionales no se incluyen capítulos; sin embargo, en videos largos horizontales (16:9) para YouTube donde se incluya la sección "Capítulos:", NUNCA pongas el primer capítulo (00:00) como "Prólogo" (ni "Introducción" o "Intro"), sino OBLIGATORIAMENTE como parte directa de la historia.
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=NOTEBOOKLM_VIDEO]
Regla Obligatoria de Capítulos para YouTube (Encabezado Ineludible "Capítulos:", Exactamente 10 Capítulos y Primer Capítulo 00:00 como Parte de la Historia, NUNCA como "Prólogo"):
En la metadata para YouTube de los videos y documentales de NotebookLM, es OBLIGATORIO incluir la sección de Capítulos con marcas de tiempo (timestamps) en la descripción:
- Encabezado Ineludible: NO PUEDE FALTAR EL ENCABEZADO "Capítulos:". Debe escribirse obligatoria e invariablemente la palabra "Capítulos:" como encabezado antes de la lista de marcas de tiempo.
- Regla Inquebrantable del Primer Capítulo (00:00) como Parte de la Historia (NUNCA "Prólogo"): En la metadata de YouTube, en los capítulos NUNCA pongas el primer capítulo (marca 00:00) como "Prólogo", sino OBLIGATORIAMENTE como parte directa de la historia. Queda TERMINANTEMENTE PROHIBIDO utilizar "Prólogo", "Introducción", "Inmersión Visual", "Intro", "Foley" o etiquetas genéricas similares. El capítulo 00:00 debe nombrarse directamente como el primer episodio o escena histórica del relato.
- Exactamente 10 Capítulos Obligatorios: La lista debe contener rigurosa y matemáticamente EXACTAMENTE DIEZ (10) CAPÍTULOS cronológicos con sus marcas de tiempo distribuidos armónicamente a lo largo de la duración total del video, comenzando estrictamente en 00:00:
  Capítulos:
  00:00 - [Primer Capítulo Directo como Parte de la Historia (NUNCA poner "Prólogo")]
  00:06 - [Capítulo 2 / Entrada de la Locución Masculina y Planteamiento del Enigma]
  [MM:SS] - [Capítulo 3 / Contexto y Antecedentes]
  [MM:SS] - [Capítulo 4 / Las Figuras Históricas]
  [MM:SS] - [Capítulo 5 / El Punto de Inflexión]
  [MM:SS] - [Capítulo 6 / La Paradoja o Conflicto Central]
  [MM:SS] - [Capítulo 7 / Revelaciones Inéditas o Hallazgos]
  [MM:SS] - [Capítulo 8 / El Clímax del Suceso]
  [MM:SS] - [Capítulo 9 / Consecuencias Históricas]
  [MM:SS] - [Capítulo 10 / Conclusión y Legado Eterno]
Esta sección de capítulos con su encabezado "Capítulos:" se ubica inmediatamente después de los 3 párrafos de la descripción (separada por una línea invisible con braille ⠀) y antes de la Nota IA oficial. Queda terminantemente prohibido omitir el encabezado "Capítulos:", poner el primer capítulo (00:00) como "Prólogo" en lugar de como parte de la historia, o entregar una cantidad distinta a diez (10) capítulos en YouTube. (En Facebook, Instagram y TikTok se omiten los capítulos).
[/?TIPO_PRODUCCION]

[?TIPO_PRODUCCION=REELS|TIMELAPSE|INMERSIVO_CONTEMPLATIVO|NOTEBOOKLM_VIDEO]
3. El Escudo de IA Obligatorio y Diferenciado por Formato (Prohibición Absoluta de Afirmar que la Información es de IA):
Como medida de protección comunitaria y rigor documental, la Nota IA debe insertarse literalmente en la descripción adaptándose con exactitud al tipo de producción:
- Para Producciones Audiovisuales con Video (Reels, Timelapse, Inmersivo, NotebookLM):
  (Nota: Este [?SUB_OPCION_REELS=9X16]video[/?SUB_OPCION_REELS][?SUB_OPCION_REELS=16X9]documental[/?SUB_OPCION_REELS] inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
- Para Producciones de Post con Imagen (3:4: Efemérides, Próximo Estreno, Controversia):
  (Nota: Esta imagen ha sido generada utilizando herramientas de inteligencia artificial basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
-> REGLA INQUEBRANTABLE: Queda TERMINANTEMENTE PROHIBIDO afirmar en cualquier formato o publicación que la "información" fue creada o generada con IA. Todo el rigor histórico de Huellas de la Humanidad proviene estrictamente de registros y fuentes académicas reales; la IA solo se emplea para la recreación visual o audiovisual.
[/?TIPO_PRODUCCION]

4. Orden Secuencial del Empaque y Hashtags (Texto Corrido sin Encabezados de Sección):
Para salvaguardar la presentación y el rendimiento algorítmico, los bloques de metadata deben entregarse en este orden riguroso.
RECORDATORIO CRÍTICO DE ENTREGA: Los números "1), 2), 3)..." y los nombres de bloque indicados a continuación son EXCLUSIVAMENTE para que la IA comprenda el orden secuencial. Para NINGUNA producción se escribe el encabezado de las secciones de la metadata excepto el de los Capítulos:. Queda terminantemente prohibido incluir rótulos o encabezados como "Título:", "Descripción:", "Nota IA:", "Slogan:", "Hashtags:", "Tags:", "Tags SEO:", "Comentario Fijado:". La metadata se entrega directamente como texto corrido separado únicamente por la línea invisible braille (⠀), siendo "Capítulos:" el ÚNICO encabezado de sección que existe en toda la entrega:
[?TIPO_PRODUCCION=POST_EXPECTATIVA]
Orden Secuencial del Empaque para Post con Imagen (Sin Título):
Todas las publicaciones de Post con Imagen (Efemérides, Próximo Estreno, Controversia) se entregan obligatoria y estrictamente SIN TÍTULO (arrancando de forma inmediata con el Párrafo 1 en formato Todo Corrido y sin encabezados de sección):
1) Texto directo de la descripción envolvente en 3 párrafos (sin anteponer "Descripción:" y sin título; con años en números y siglos obligatoriamente en números romanos):
   - Párrafo 1 de la Descripción (arranque directo sin título)
   (⠀)
   - Párrafo 2 de la Descripción
   (⠀)
   - Párrafo 3 de la Descripción
   (⠀)
2) Texto directo de la Nota IA oficial para imagen (sin anteponer "Nota IA:"):
   (Nota: Esta imagen ha sido generada utilizando herramientas de inteligencia artificial basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
   (⠀)
3) Texto directo del Slogan oficial de la marca (sin anteponer "Slogan:"): "Cada historia deja una huella. Aquí seguimos sus rastros."
   (⠀)
4) Texto directo de los 5 hashtags (sin anteponer "Hashtags:"): Exactamente 5 hashtags en español y formato #CamelCase referentes al tema del post, donde CADA UNO DE LOS 5 HASHTAGS DEBE ESTAR COMPUESTO OBLIGATORIAMENTE POR EXACTAMENTE DOS PALABRAS (ej. #ImperioRomano, #EdadMedia, #MisterioHistorico, #RevolucionFrancesa, #GuerraMundial). (Con los hashtags concluye la contabilización de hasta 1200 caracteres para Instagram o 3000 caracteres para Facebook).
   (⠀)
5) Texto directo del Comentario Fijado (sin anteponer "Comentario Fijado:"): Directo (CTA natural o de debate, sin pedir "dale like"), sin etiqueta.
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=REELS|TIMELAPSE|INMERSIVO_CONTEMPLATIVO]
1) Texto directo del título inmersivo (sin anteponer "Título:", con los años en números; finalizando obligatoriamente con " | Documental Completo" en videos de más de 8 minutos de duración)
   (⠀)
2) Texto directo de la descripción envolvente en 3 párrafos (sin anteponer "Descripción:", dividida obligatoriamente en 3 párrafos separados entre sí por una línea con carácter braille [⠀], con años en números y siglos obligatoriamente en números romanos):
   - Párrafo 1 de la Descripción
   (⠀)
   - Párrafo 2 de la Descripción
   (⠀)
   - Párrafo 3 de la Descripción
   (⠀)
3) Texto directo de la Nota IA (sin anteponer "Nota IA:", Escudo de IA obligatorio)
   (⠀)
4) Texto directo del Slogan oficial de la marca (sin anteponer "Slogan:"): "Cada historia deja una huella. Aquí seguimos sus rastros."
   (⠀)
5) Texto directo de los 5 hashtags (sin anteponer "Hashtags:"): Exactamente 5 hashtags en español y formato #CamelCase referentes al tema del video, donde CADA UNO DE LOS 5 HASHTAGS DEBE ESTAR COMPUESTO OBLIGATORIAMENTE POR EXACTAMENTE DOS PALABRAS (ej. #ImperioRomano, #EdadMedia, #MisterioHistorico, #RevolucionFrancesa, #GuerraMundial; en videos de más de 8 minutos de duración, #DocumentalEnEspañol es un hashtag OBLIGATORIO dentro del bloque de 5 hashtags). (Con los hashtags concluye estrictamente la contabilización de los 3000 caracteres para Facebook/TikTok y YouTube, o de hasta 1200 caracteres para Instagram).
   (⠀)
6) [Exclusivo para YouTube] Texto directo de Tags SEO (sin anteponer "Tags:" ni "Tags SEO:"): Bloque de etiquetas separadas por comas de exactamente 500 caracteres colocado inmediatamente después de los hashtags y antes del comentario fijado (sin tags en Facebook, TikTok ni Instagram).
   (⠀)
7) Texto directo del Comentario Fijado (sin anteponer "Comentario Fijado:"): Directo (CTA natural invitando a contar una experiencia propia, no solo pedir "dale like"), sin etiqueta.
[/?TIPO_PRODUCCION]
[?TIPO_PRODUCCION=NOTEBOOKLM_VIDEO]
1) Texto directo del título inmersivo (sin anteponer "Título:", con los años en números; finalizando OBLIGATORIA E INQUEBRANTABLEMENTE con el sufijo " | Documental Completo" al final del título)
   (⠀)
2) Texto directo de la descripción envolvente en 3 párrafos (sin anteponer "Descripción:", dividida obligatoriamente en 3 párrafos separados entre sí por una línea con carácter braille [⠀], con años en números y siglos obligatoriamente en números romanos):
   - Párrafo 1 de la Descripción
   (⠀)
   - Párrafo 2 de la Descripción
   (⠀)
   - Párrafo 3 de la Descripción
   (⠀)
3) [Exclusivo para YouTube] Sección Obligatoria de Capítulos: Encabezado ineludible "Capítulos:" (EL ÚNICO ENCABEZADO DE SECCIÓN PERMITIDO EN TODA LA METADATA) seguido obligatoriamente de EXACTAMENTE DIEZ (10) capítulos cronológicos con sus marcas de tiempo (donde el primer capítulo en 00:00 NUNCA se pone como "Prólogo", sino obligatoriamente como parte directa de la historia del video, 00:06 con la entrada de la locución masculina, más 8 capítulos intermedios y finales hasta la conclusión)
   (⠀)
4) Texto directo de la Nota IA oficial (sin anteponer "Nota IA:", Escudo de IA obligatorio para documental)
   (⠀)
5) Texto directo del Slogan oficial de la marca (sin anteponer "Slogan:"): "Cada historia deja una huella. Aquí seguimos sus rastros."
   (⠀)
6) Texto directo de los 5 hashtags (sin anteponer "Hashtags:"): Exactamente 5 hashtags en español y formato #CamelCase referentes al tema del video, donde CADA UNO DE LOS 5 HASHTAGS DEBE ESTAR COMPUESTO OBLIGATORIAMENTE POR EXACTAMENTE DOS PALABRAS (#DocumentalEnEspañol es un hashtag OBLIGATORIO dentro de este bloque de 5 hashtags). (Con los hashtags concluye estrictamente la contabilización de los 3000 caracteres para Facebook/TikTok y YouTube, o de hasta 1200 caracteres para Instagram).
   (⠀)
7) [Exclusivo para YouTube] Texto directo de Tags SEO (sin anteponer "Tags:" ni "Tags SEO:"): Bloque de etiquetas separadas por comas de exactamente 500 caracteres colocado inmediatamente después de los hashtags y antes del comentario fijado (sin tags en Facebook, TikTok ni Instagram).
   (⠀)
8) Texto directo del Comentario Fijado (sin anteponer "Comentario Fijado:"): Directo (CTA natural invitando a contar una experiencia propia, no solo pedir "dale like"), sin etiqueta.
[/?TIPO_PRODUCCION]
Comentario Fijado (Llamado a la Acción Natural): El Comentario Fijado es obligatoriamente lo último que debe aparecer en la estructura del documento del empaque, cerrando la entrega (rigurosamente sin la palabra "Comentario Fijado:", solo el texto directo del mensaje). Debe formular un llamado a la acción (CTA) natural que invite a la audiencia a compartir una experiencia personal, vivencia familiar o recuerdo vinculado al hecho histórico, quedando estrictamente prohibido pedir genéricamente "dale like" o "suscríbete".

VOLUMEN VIII: AUDITORÍA DE ÉLITE Y CONTROL DE CALIDAD
Capítulo 18: Checklist de Control de Calidad Final (QA)
La publicación de un documento de Huellas de la Humanidad es irreversible. Antes de presionar el botón de exportación y programar el video en la plataforma, el Director Ejecutivo, el Editor o el Arquitecto de Sistemas Audiovisuales debe confrontar el metraje final contra el siguiente escrutinio inflexible. Un solo fallo en este checklist implica la retención del episodio y la re-ingeniería del bloque defectuoso :[ ] 1. Contradicción Central[?SUB_OPCION_REELS=16X9] y Prompt de Investigación Profunda Externa en Etapa 3 (Reels Largos Horizontales 16:9)[/?SUB_OPCION_REELS]: ¿La tensión histórica o paradoja planteada en el inicio permea de manera constante hasta la resolución del documental?[?SUB_OPCION_REELS=16X9] ¿Y en Reels largos horizontales (16:9) se ha verificado que en la Etapa 3 la IA genere obligatoriamente (junto al recuento estructural de secciones, datos insólitos, curiosidades y contradicciones) un Prompt Maestro para desarrollar una investigación profunda por fuera (con ALTO INQUEBRANTABLE), para luego integrar y usar toda esa información recolectada tanto en el guion de la voz en off como en los personajes, escenas y metadata del video?[/?SUB_OPCION_REELS][ ] 2. Promesa Narrativa, Slogan Completo en Párrafo Aparte Antes del Segundo 30 (con Escena de Mesa de Historiador Antiguo en su Clip) y Micro-Ganchos cada 90s: ¿La promesa narrativa fue ubicada antes del segundo 30 de video (~segundos 20–30), colocando TODO el bloque del slogan completo (desde "En los próximos minutos...", incluyendo la explicación breve de lo que estará pasando en el documental, hasta culminar con "Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros.") estrictamente en un párrafo aparte dentro del guion? ¿Se ha verificado que el clip que cubre esta parte donde la voz narrativa dice el slogan completo al principio sea obligatoriamente una escena de una mesa de un historiador antiguo llena de objetos antiguos, además de pergaminos, plumas de escritura, bote de tinta, entre otros? ¿Se articulan micro-ganchos cada 90 segundos planteando una nueva interrogante antes de resolver la anterior sin que el espectador lo sepa todo prematuramente?[ ] 3. Estandarización Universal de Motores de IA (Banana 2.1 para Imágenes / Omni Flash para Video), Filtro de Realidad (Anacronismos), Tiempo y Lugar y Regla de '@' Exclusivo para Personas en Clips: ¿Se ha verificado rigurosamente que la creación de imágenes fijas en CUALQUIER tipo de producción (imágenes iniciales de cada clip, modelos de personas @Personas y lugares @Lugares, keyframes de timelapse, miniaturas oficiales y posts estáticos de próximo estreno, efemérides o controversia) se realice exclusiva y obligatoriamente con el motor Nano Banana 2.1 (Banana 2.1), vetando de forma absoluta cualquier otro motor de imagen alternativo o genérico? ¿Y que en CADA prompt de imagen (Nano Banana 2.1) y en CADA prompt de clip de video (Omni Flash) se incluya obligatoriamente el TIEMPO (año en números o época precisa) y el LUGAR (ciudad, país o locación) como referencia visual indispensable para erradicar anacronismos en prendas, arquitectura y tecnología, garantizando que en los prompts de imágenes iniciales y clips de la Etapa 7 los '@' sean exclusiva y únicamente de personas (lugares y objetos sin '@') y que solo haya como máximo un '@' por cada uno?[ ] 4. Auditoría Anti-Estancamiento (Planos) y Variación Cinematográfica Intra-Escena ante Locución Prolongada (>10s): ¿Se ha verificado que ningún tipo de plano (ej. Drone reveal) se repita idénticamente en el rango cercano de los últimos 6 a 8 clips? ¿Y se ha constatado que cuando un tramo de la voz narrativa permanezca por más de 10 segundos (o abarque dos o más clips consecutivos) describiendo una misma escena o acontecimiento auditivo, la IA haya entregado tomas cinematográficas totalmente diferentes en cada clip consecutivo (variando radicalmente el movimiento de cámara, la perspectiva/ángulo, el enfoque/escala de plano general a macro, e intercalando recursos de la lista de tomas como tomas tipo mapa antiguo, maquetas a escala o dibujos en papel en blanco y negro en lugar de repetir la misma composición visual)?[ ] 5. Auditoría Anti-Estancamiento (Cámara): ¿Se ha constatado que el mismo movimiento de cámara no se encadena consecutivamente sin una justificación narrativa extrema?[ ] 6. Continuidad Ambiental: ¿Las transiciones entre clips mantienen una coherencia impecable en el uso del catálogo de iluminación, la materialidad de las ruinas y la textura del espacio?[ ] 7. Sinergia y Validación Previa de la Miniatura con Nano Banana 2.1, Logo de la Derecha Diferenciado ("HD" para 9:16 y "8K" para 16:9) en Dorado al 5% y Preservación del Texto Inferior del Logo de la Marca: ¿Se ha verificado que el prompt técnico de la miniatura se genere y valide con Nano Banana 2.1 en una etapa previa e independiente (Etapa 10 en Reels, Etapa 4 en Inmersivo, Etapa 6 en NotebookLM con ALTO INQUEBRANTABLE) antes de pasar a la metadata final? ¿La miniatura gráfica proyecta una emoción dominante que intriga y que es complementaria respecto al título del video? ¿Se ha verificado que para todos los videos en formato vertical 9:16 el logo de la esquina superior derecha sea "HD" en dorado al 5% ('displaying "HD" in metallic gold') y para videos en formato horizontal 16:9 sea "8K" en dorado al 5% ('displaying "8K" in metallic gold') creado nativamente por la IA? ¿Y se ha verificado que en el prompt técnico de la miniatura y de los posts con imagen se especifique obligatoriamente la integración del logo oficial al 5% en la esquina superior izquierda exigiendo explícitamente preservar y renderizar con nitidez total tanto el emblema como el texto que tiene debajo ("Huellas de la Humanidad") sin recortarlo ni omitirlo?[ ] 8. Contención de Hashtags, Regla de Dos Palabras y Obligatoriedad de #DocumentalEnEspañol: ¿El bloque final de la descripción contiene un recuento estricto y exacto de cinco (5) hashtags? ¿Se ha verificado que en todos los tipos de producción (Reels, Posts, NotebookLM, Inmersivo, Timelapse) CADA UNO de los 5 hashtags esté compuesto obligatoriamente por exactamente DOS (2) PALABRAS en formato #CamelCase (ej. #ImperioRomano, #EdadMedia, #MisterioHistorico; prohibido hashtags de una sola palabra o de tres o más palabras)? En videos de más de 8 minutos de duración y en NotebookLM, ¿se ha verificado que #DocumentalEnEspañol esté incluido obligatoriamente dentro del bloque de 5 hashtags?[ ] 9. Regla Universal de Cero Encabezados en Metadata (Excepto "Capítulos:"), Formato "Todo Corrido", División de la Descripción en 3 Párrafos, Regla de Sin Título en Posts con Imagen y Prohibición de Repetir lo Mismo entre Miniatura, Título y Texto en Pantalla en los Primeros 8 Segundos: ¿Se ha verificado rigurosamente que para NINGUNA producción se incluya el encabezado de las secciones de la metadata excepto el de los Capítulos: (eliminando y vetando por completo etiquetas y rótulos como "Título:", "Descripción:", "Nota IA:", "Slogan:", "Hashtags:", "Tags SEO:", "Comentario Fijado:"), siendo "Capítulos:" en YouTube la única excepción permitida? ¿La metadata de la plataforma fluye orgánicamente en formato "Todo Corrido" separada únicamente por líneas invisibles con braille (⠀) y con la descripción dividida obligatoriamente en exactamente tres (3) párrafos? ¿Se ha verificado que en TODAS las producciones de Post con Imagen (Efemérides, Próximo Estreno, Controversia) la descripción se entregue rigurosamente SIN TÍTULO (arrancando de forma inmediata con el Párrafo 1)? ¿Y se ha constatado que NO se repita lo mismo entre la Miniatura, el Título y el Texto en pantalla en los primeros 8 segundos (importando poco si en lo demás de la metadata se repiten algunas palabras)?[ ] 10. Cierre de Locución con Llamada a Comentarios, Acoplamiento del Eslogan Corto en Párrafo Aparte y Último Clip en Escena Panorámica Amplia y Rica Visualmente (Sin Objeto Close-Up): ¿La voz narrativa incluye obligatoriamente antes del slogan de cierre la frase "Déjanos saber en los comentarios..." y culmina pronunciando como frase de cierre el lema oficial ("Cada historia deja una huella. Aquí seguimos sus rastros.") ubicados obligatoriamente separados en un párrafo aparte al final del guion, coincidiendo en el último clip de los Reels obligatoriamente con una escena panorámica amplia y rica visualmente (verificando que para el último clip NO se ponga un objeto close-up ni plano macro)?[ ] 11. Sincronización Inversa Perfecta, Duración Total Aproximada a la Pedida, Inserción Estratégica de Pausas Narrativas ([pausa: Xs]) y Reporte de Caracteres por Minuto: ¿La cadencia de la locución humana concuerda rítmicamente con los impactos visuales, determinando e integrando la IA de forma inteligente y estratégica etiquetas de pausa [pausa: Xs] (ej. [pausa: 1.5s], [pausa: 2s]) según giros dramáticos, escenas y transiciones (sin usar marcas informales /2s o /#s), descontando los segundos totales de pausa del tiempo de voz hablada para cumplir la calibración de 15 caracteres por segundo de voz hablada (900 caracteres por minuto) con una duración total aproximada a la duración pedida (sin que tenga que ser exacta al segundo), e indicando obligatoriamente al pie del guion el reporte en formato estricto "Caracteres Totales: [número] ([número] caracteres por minuto)" junto al desglose de pausas y duración total aproximada?[?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2][ ] 12. Arquitectura de Audio, Hook de Inicio (Reels) y Cierre de Oración tras Tiempo y Lugar: ¿Se ha verificado que los primeros [DURACION_CLIP_1_RALENTIZADO] segundos de video carezcan de voz en off (Clip 1 de [DURACION_CLIP_1] segundos de duración de 00:00 a 00:[DURACION_CLIP_1_PAD] + primeros 2 segundos de Clip 2 de 00:[DURACION_CLIP_1_PAD] a 00:[DURACION_CLIP_1_RALENTIZADO_PAD] con exclusivo Foley) y que la locución arranque exactamente en el segundo [DURACION_CLIP_1_RALENTIZADO] de video [00:[DURACION_CLIP_1_RALENTIZADO_PAD]] (a los 2 segundos de haber iniciado Clip 2, es decir, el segundo 2 del segundo clip) comenzando obligatoriamente con la tríada: TIEMPO (años en números/dígitos; si es únicamente el año sin mes ni día, iniciando con "Año" [número], ej. "Año 1888", "Año 44 antes de Cristo"), LUGAR, CIUDAD Y PAÍS (mencionando el lugar acto seguido del año, quedando terminantemente prohibido escribir "en el" después del año; cerrando obligatoriamente la oración con un punto justo después de tiempo y lugar, e iniciando una nueva oración con mayúscula), y DESCRIPCIÓN BREVE del lugar, suceso o personaje con premisa intrigante o perturbadora (ej. "Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba...")? ¿La voz en off relata en tercera persona sin hablar jamás en "nosotros", y se nombran las figuras históricas con naturalidad sin forzar etiquetas como "anónimos"?[/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT][ ] 12. Arquitectura de Audio, Hook de Inicio (Reels) y Cierre de Oración tras Tiempo y Lugar: ¿Se ha verificado que los primeros [DURACION_CLIP_1_RALENTIZADO] segundos de video carezcan de voz en off (cubiertos por Clip 1 de [DURACION_CLIP_1] segundos con texto de inicio generado por IA ralentizado en edición a [DURACION_CLIP_1_RALENTIZADO] segundos [00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]] con exclusivo Foley) y que la locución arranque exactamente en el segundo [DURACION_CLIP_1_RALENTIZADO] de video (al inicio de Clip 2 de [?DURACION_CLIPS=10_SEGUNDOS][RAL_CLIP2_RANGE_10S][/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS][RAL_CLIP2_RANGE_8S][/?DURACION_CLIPS]) comenzando obligatoriamente con la tríada: TIEMPO (años en números/dígitos; si es únicamente el año sin mes ni día, iniciando con "Año" [número], ej. "Año 1888", "Año 44 antes de Cristo"), LUGAR, CIUDAD Y PAÍS (mencionando el lugar acto seguido del año, quedando terminantemente prohibido escribir "en el" después del año; cerrando obligatoriamente la oración con un punto justo después de tiempo y lugar, e iniciando una nueva oración con mayúscula), y DESCRIPCIÓN BREVE del lugar, suceso o personaje con premisa intrigante o perturbadora (ej. "Año 1888, callejón de Whitechapel, Londres, Inglaterra. El laberinto donde operaba...")? ¿La voz en off relata en tercera persona sin hablar jamás en "nosotros", y se nombran las figuras históricas con naturalidad sin forzar etiquetas como "anónimos"?[/?SINCRONIZACION_CLIP_1][?VOZ_NARRATIVA_EN_CLIPS=INCLUIR][ ] 13. Consulta de Modalidad de Entrega (De 10 en 10 o Todos Juntos), Orden Operativa Exclusiva al Inicio, Nomenclatura, Intervalos Temporales (##:## - ##:##), Prompts 100% en Inglés con "Create an image / Create a video", Tiempo y Lugar con un Solo '@' (Solo de Personas), Voz Narrativa al Final de Clips y Orden "fix the name" al Final: ¿La IA preguntó previamente al usuario si prefería la entrega de prompts de 10 en 10 o todos juntos (deteniéndose con ALTO INQUEBRANTABLE) y respetó la modalidad elegida? ¿La entrega de prompts arranca en el primer envío obligatoriamente con la orden operativa de 9 líneas (Actúa como un historiador..., Cambia los nombres a las primeras 6 palabras..., Usa omni flash y nano banana 2.1..., Crea las imágenes primero y luego los clips..., Usa las imágenes de referencia de personas y lugares para generar las imágenes iniciales y los clips para mantener fidelidad visual..., No hagas cambios de shot nunca en ningun clip (excepto en aquel clip específico donde el prompt indique expresamente hacer dos shots de 5 segundos cada uno porque la voz narrativa cambió de escena) y asegúrate de que los clips de video no hagan desapariciones ni transformaciones, la imagen inicial creada se usará para el inicio de cada clip..., Divide la creación en batches de 10..., rename everything adding _ as the blank spaces between words..., from 1 to 9 change them to 01 to 09...), asegurando que las entregas posteriores NO repitan dicha orden y comiencen directamente con los prompts? ¿Se entrega según la modalidad elegida (en bloques de 10 clips con ALTO INQUEBRANTABLE entre bloques, o todos juntos en una sola respuesta continua), están todos los prompts redactados al 100% en idioma INGLÉS iniciando obligatoriamente con "Image [número]: Create an image " (o "Imagen [número]: Create an image ") para imágenes estáticas y "Clip [número] (##:## - ##:##): Create a video " para clips de video, incluye obligatoriamente el TIEMPO y LUGAR como ancla histórica visual cumpliendo la regla estricta de que los '@' son solo de personas (cero '@' en lugares y objetos) y que en los prompts de imágenes y clips solo habrá como máximo un '@' por cada uno, incluye obligatoriamente en cada clip de video el tiempo exacto que cubre en el timeline de CapCut en formato (##:## - ##:##) compensando los +[DURACION_CLIP_1_RALENTIZADO]s de la transcripción, se cumple estrictamente la regla de colocar al final del prompt de video (desde Clip 2 en adelante) el texto de la voz narrativa correspondiente a ese clip como una oración más, terminada en punto, sin comillas "", sin paréntesis (), y sin etiquetas burocráticas (manteniendo Clip 1 sin texto de locución), y se agrega obligatoriamente al final de CADA prompt de clip "fix the name"?[/?VOZ_NARRATIVA_EN_CLIPS][?VOZ_NARRATIVA_EN_CLIPS=EXCLUIR][ ] 13. Consulta de Modalidad de Entrega (De 10 en 10 o Todos Juntos), Orden Operativa Exclusiva al Inicio, Nomenclatura, Intervalos Temporales (##:## - ##:##), Prompts 100% en Inglés con "Create an image / Create a video", Tiempo y Lugar con un Solo '@' (Solo de Personas), Exclusión de Voz Narrativa y Orden "fix the name" al Final: ¿La IA preguntó previamente al usuario si prefería la entrega de prompts de 10 en 10 o todos juntos (deteniéndose con ALTO INQUEBRANTABLE) y respetó la modalidad elegida? ¿La entrega de prompts arranca en el primer envío obligatoriamente con la orden operativa de 9 líneas (Actúa como un historiador..., Cambia los nombres a las primeras 6 palabras..., Usa omni flash y nano banana 2.1..., Crea las imágenes primero y luego los clips..., Usa las imágenes de referencia de personas y lugares para generar las imágenes iniciales y los clips para mantener fidelidad visual..., No hagas cambios de shot nunca en ningun clip (excepto en aquel clip específico donde el prompt indique expresamente hacer dos shots de 5 segundos cada uno porque la voz narrativa cambió de escena) y asegúrate de que los clips de video no hagan desapariciones ni transformaciones, la imagen inicial creada se usará para el inicio de cada clip..., Divide la creación en batches de 10..., rename everything adding _ as the blank spaces between words..., from 1 to 9 change them to 01 to 09...), asegurando que las entregas posteriores NO repitan dicha orden y comiencen directamente con los prompts? ¿Se entrega según la modalidad elegida (en bloques de 10 clips con ALTO INQUEBRANTABLE entre bloques, o todos juntos en una sola respuesta continua), están todos los prompts redactados al 100% en idioma INGLÉS iniciando obligatoriamente con "Image [número]: Create an image " (o "Imagen [número]: Create an image ") para imágenes estáticas y "Clip [número] (##:## - ##:##): Create a video " para clips de video, incluye obligatoriamente el TIEMPO y LUGAR como ancla histórica visual cumpliendo la regla estricta de que los '@' son solo de personas (cero '@' en lugares y objetos) y que en los prompts de imágenes y clips solo habrá como máximo un '@' por cada uno, incluye obligatoriamente en cada clip de video el tiempo exacto que cubre en el timeline de CapCut en formato (##:## - ##:##) compensando los +[DURACION_CLIP_1_RALENTIZADO]s de la transcripción, se cumple estrictamente la regla de excluir por completo el texto de la voz narrativa de los prompts de video (concluyendo con el sufijo 'no text, no speech, no music.'), y se agrega obligatoriamente al final de CADA prompt de clip "fix the name"?[/?VOZ_NARRATIVA_EN_CLIPS] [ ] 14. Regla Estricta de Cero Música en Clips, Protocolo de Banda Sonora en Suno (Consulta de Duración Exacta, Archivo de Video Exclusivo en Auto Reels, Partición de 1 a 6 Minutos y Orden Estricto de 6 Campos): ¿Se ha verificado que ningún clip de video contenga música de fondo ('no music'), garantizando que el diseño acústico de cada clip sea exclusivamente Foley ambiental? En la etapa de banda sonora con Suno, ¿se constató que la IA solicite el archivo de video ÚNICA Y EXCLUSIVAMENTE en el caso de los Auto Reels (NotebookLM) y que para todos los demás tipos de video (Reels, Timelapse, Inmersivo) NO pida el archivo de video? ¿Se verificó que en todos los tipos de video la IA consulte obligatoriamente la duración exacta del metraje final con ALTO INQUEBRANTABLE? ¿A partir de dicha duración (y del video en Auto Reels), determinó la IA cuántas canciones son necesarias y la duración exacta de cada una respetando rigurosamente los límites de Suno (mínimo 1 minuto y máximo 6 minutos por pista), dejando silencios obligatorios entre cada canción y asegurando que la última canción sea de solo 1:30, según la época histórica, las escenas y la intención dramática, con composiciones originales e instrumentales sin voces? ¿Y se ha verificado que cada pista musical entregue obligatoriamente los 6 campos en este orden estricto e inquebrantable: 1) Título, 2) Duración, 3) De dónde a dónde cubre en el video en tiempo, 4) Prompt de Lyrics, 5) Prompt de Style, y 6) Explicación de la Canción (cómo suena, instrumentos e intención dramática)?[ ] 15. Instrucción de Rol Universal: ¿El prompt comienza obligatoriamente con "Actúa como un historiador, director de cine, y periodista profesional." para todos los tipos de video?[ ] 16. Formato de Años en Dígitos, Cantidades de Miles/Millones como "70 mil", Siglos y Nombres con Número en Números Romanos (ej. Felipe II Augusto) y Distinción de Era ('a.C.'/'d.C.' vs 'antes de Cristo'/'después de Cristo'): ¿Todos los años en el título, anclajes de fecha, guion de locución y metadata están escritos estrictamente en dígitos numéricos (ej. 1888, 1943) sin palabras, todas las cantidades en miles o millones en la voz narrativa y en los captions (como "setenta mil", "diez mil", "doscientos mil") están escritas obligatoriamente con el número en dígitos seguido de "mil" o "millones" (ej. "70 mil", "10 mil", "200 mil", "2 millones"; prohibido "setenta mil" o "70,000"), todos los siglos en toda la producción (guion de voz en off, textos en pantalla, títulos y descripciones) están escritos obligatoriamente en números romanos con mayúsculas (ej. siglo XII, siglo XIX, siglo XXI; prohibido "siglo 12" o "siglo doce"), todos los nombres históricos con número (monarcas, papas, emperadores, faraones, ej. Felipe II Augusto, Luis XIV, Enrique VIII, Carlos V) están escritos obligatoriamente en números romanos en toda la producción (guion de voz en off, @Personas, prompts, títulos y descripciones; prohibido escribir "Felipe Segundo Augusto" o "Felipe 2 Augusto"), y las referencias de era están redactadas obligatoriamente en palabras completas en la voz en off ("antes de Cristo" y "después de Cristo", ej. "44 antes de Cristo", "siglo V antes de Cristo") y estrictamente en siglas en las descripciones y metadata ("a.C." y "d.C.", ej. "44 a.C.", "siglo V a.C.")?[ ] 17. Orden, Extensión de Metadata por Plataforma (Etapa Final: Facebook/TikTok 3000 Chars sin Tags, Instagram hasta 1200 Chars sin Tags, YouTube 3000 Chars + 500 Chars de Tags), Cero Encabezados de Sección (Excepto "Capítulos:"), División en 3 Párrafos, Título con ' | Documental Completo' (>8 min) y Escudo de IA: ¿Se ha verificado que en todos los videos de más de 8 minutos de duración el título finalice obligatoriamente con el sufijo " | Documental Completo"? ¿Se ha verificado que para NINGUNA producción se incluya el encabezado de las secciones de la metadata excepto el de los Capítulos: (cero "Título:", cero "Descripción:", cero "Nota IA:", cero "Slogan:", cero "Hashtags:", cero "Tags SEO:", cero "Comentario Fijado:"), presentándose todo el contenido corrido? ¿Se ha verificado que la metadata se entregue calibrada exactamente según la plataforma solicitada (Facebook/TikTok: 3000 caracteres desde el título hasta los hashtags, sin tags; Instagram: hasta 1200 caracteres desde el título hasta los hashtags, sin tags; YouTube: 3000 caracteres desde el título hasta los hashtags, más un bloque de 500 caracteres de tags SEO después de los hashtags y antes del comentario fijado), calibrando la descripción distribuida armónicamente en sus 3 párrafos con líneas braille (⠀)? ¿Sigue el orden estricto: Título -> Descripción (3 párrafos) -> (Capítulos: con 10 capítulos si es documental en YouTube, verificando que el primer capítulo 00:00 NUNCA se ponga como "Prólogo" sino como parte directa de la historia) -> Nota IA -> Slogan -> Hashtags -> (Tags de 500 caracteres solo en YouTube) -> Comentario Fijado? ¿La Nota IA se formula con exactitud histórica oficial ("(Nota: Este video/documental inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).") empleando obligatoriamente "video" para formato 9x16 y "documental" para formato 16:9, quedando estrictamente prohibido afirmar que la información fue creada con IA?[?SINCRONIZACION_CLIP_1=VOZ_EN_CLIP_2][ ] 18. Cuadre de Clips con Duración Total Aproximada a la Pedida y Modalidad de Entrega (De 10 en 10 o Todos Juntos) (Reels): ¿La suma de segundos de todos los clips cubre el 100% de la voz narrativa y las pausas logrando una duración total aproximada a la duración pedida (sin requerir exactitud matemática al segundo ni forzar micro-clips de relleno; ej. ~120s ≈ [DURACION_CLIP_1]s de Clip 1 [00:00 - 00:[DURACION_CLIP_1_PAD]] + [?DURACION_CLIPS=10_SEGUNDOS]11 o 12 clips completos de 10s[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]14 o 15 clips completos de 8s[/?DURACION_CLIPS]) y se respeta la modalidad de entrega acordada tras la consulta previa (entregando en bloques de 10 clips con ALTO INQUEBRANTABLE entre bloques si se eligió de 10 en 10, o entregando todos los clips en una sola respuesta continua si se eligió todos juntos)?[/?SINCRONIZACION_CLIP_1][?SINCRONIZACION_CLIP_1=RALENTIZAR_CAPCUT][ ] 18. Cuadre de Clips con Duración Total Aproximada a la Pedida y Modalidad de Entrega (De 10 en 10 o Todos Juntos) (Reels): ¿La suma de segundos de todos los clips cubre el 100% de la voz narrativa y las pausas logrando una duración total aproximada a la duración pedida (sin requerir exactitud matemática al segundo ni forzar micro-clips de relleno; ej. ~120s ≈ [DURACION_CLIP_1_RALENTIZADO]s de Clip 1 ralentizado en edición [00:00 - 00:[DURACION_CLIP_1_RALENTIZADO_PAD]] + [?DURACION_CLIPS=10_SEGUNDOS]11 o 12 clips completos de 10s[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]14 o 15 clips completos de 8s[/?DURACION_CLIPS]) y se respeta la modalidad de entrega acordada tras la consulta previa (entregando en bloques de 10 clips con ALTO INQUEBRANTABLE entre bloques si se eligió de 10 en 10, o entregando todos los clips en una sola respuesta continua si se eligió todos juntos)?[/?SINCRONIZACION_CLIP_1][?TEXTO_PANTALLA_CLIP_1=CAPCUT_MANUAL][ ] 19. Selección y Estructura Previa de Texto en Pantalla del Clip 1 (Etapa 6 - Edición Manual en CapCut): ¿Se ha verificado que la IA, tras validar las imágenes de referencia de la Etapa 5 y antes de pasar a los prompts de imágenes iniciales y clips de video (Etapa 7), pregunte obligatoriamente al usuario la selección del texto para la apertura del video en el Clip 1 (con ALTO INQUEBRANTABLE), proponiendo de 2 a 3 opciones estructuradas obligatoriamente con Ciudad, País, Tiempo en la primera línea y justo debajo la frase de Gancho intrigante, para ser colocadas manualmente en CapCut (manteniendo 'no text' en los prompts de IA)?[/?TEXTO_PANTALLA_CLIP_1][?TEXTO_PANTALLA_CLIP_1=IA_CLIP_1][ ] 19. Selección Previa y Generación de Texto en Pantalla por IA en Clip 1 (Etapa 6 y Etapa 7): ¿Se ha verificado que la selección del texto en pantalla para el Clip 1 se haya realizado previamente en la Etapa 6 (con ALTO INQUEBRANTABLE) antes de generar los prompts de imágenes iniciales y clips de video, proponiendo de 2 a 3 opciones estructuradas con Ciudad, País, Tiempo y Gancho intrigante, que dicho texto se haya incluido ÚNICA Y EXCLUSIVAMENTE en el prompt del Clip 1 de [DURACION_CLIP_1] segundos (tipo comienzo de un documental cinematográfico), que el prompt de la Imagen 1 se haya mantenido estrictamente con 'no text', y que se indique claramente la instrucción para el montaje de bajar la velocidad del Clip 1 en edición para llevarlo a [DURACION_CLIP_1_RALENTIZADO] segundos de duración?[/?TEXTO_PANTALLA_CLIP_1][ ] 20. Diseño para Reproducción en Silencio, Corrección de Captions Automáticos de CapCut con Entrega en Formato .srt Descargable Manteniendo Timestamps y Arreglo de Cantidades a "70 mil" (Etapa 8 en Reels) y CTA Natural: ¿Se ha verificado que la producción esté optimizada para el ~70% de usuarios que miran inicialmente sin sonido (apoyo visual claro y subtítulos dinámicos en CapCut obligatorios), y que en la Etapa 8 de Reels (inmediatamente después de generar todos los prompts de imágenes iniciales y clips de video de la Etapa 7) la IA solicite al usuario el archivo .srt de los captions automáticos de CapCut (con ALTO INQUEBRANTABLE), corrija todas las palabras mal escritas, nombres propios históricos, años, siglos y haga el arreglo si es necesario en números como "setenta mil" o "70,000" para dejarlos como "70 mil" chequeando fielmente con nuestra Voz Narrativa Original (Etapa 4), manteniendo intactos los timestamps y la estructura de bloques de CapCut, y se lo devuelva obligatoriamente en formato archivo .srt descargable listo para importar antes de pasar a la banda sonora en Suno (Etapa 9)? ¿El comentario fijado plantea un CTA natural que invite orgánicamente a contar una experiencia propia en lugar de limitarse a pedir "dale like"?[ ] 21. Sincronización con las Pausas de la Voz Narrativa ([pausa: Xs]), Regla de Shot Continuo por Defecto ([?DURACION_CLIPS=10_SEGUNDOS]1 Shot de 10s[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]1 Shot de 8s[/?DURACION_CLIPS]) y Opción de Dos Shots de 5 Segundos cada uno (5s + 5s) si la Voz Narrativa Cambia de Escena: ¿Se ha verificado que la IA tenga obligatoriamente en cuenta las pausas de la voz narrativa ([pausa: Xs]) al calcular y generar los prompts de imágenes iniciales y clips de video? ¿Se ha verificado que por defecto cada clip a partir del Clip 2 esté estructurado como un solo shot continuo ([?DURACION_CLIPS=10_SEGUNDOS]1 shot de 10 segundos[/?DURACION_CLIPS][?DURACION_CLIPS=8_SEGUNDOS]1 shot de 8 segundos[/?DURACION_CLIPS]) con la instrucción en inglés de no hacer saltos de shot ("single continuous shot, strictly no shot changes, no camera cuts, no jump cuts, no morphing or disappearing elements"), pero que en dado caso que una escena se vaya a demorar demasiado visualmente y ya la voz narrativa cambió a otra escena a mitad del clip, ese clip específico se estructure con DOS (2) SHOTS cada uno de 5 segundos ("two-shot sequence of 5 seconds each: Shot 1 [0s-5s]...; Shot 2 [5s-10s]: clean cinematic cut at second 5 to...") para mantener la sincronía visual con el cambio de escena de la locución?[ ] 22. Generación Previa de Prompts de Imágenes Modelo de Referencia con Nano Banana 2.1 de Personas y Lugares Principales (Etapa 5 con Orden en una Sola Oración, Máximo un '@' por Prompt, y Exclusividad como Referencia Visual sin Usarse como Primer Fotograma): ¿Se generaron y validaron previamente en una etapa separada e independiente (Etapa 5 con ALTO INQUEBRANTABLE) los prompts técnicos de imágenes modelo de referencia con Nano Banana 2.1 para las figuras históricas principales (@Personas) y los lugares principales (@Lugares) del relato (sin objetos sueltos), anteponiendo al inicio en una sola oración la orden obligatoria ("Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente."), garantizando que en cada prompt haya como máximo un único símbolo '@', y asegurando que dichas imágenes de referencia de personas y lugares sean ÚNICA Y EXCLUSIVAMENTE para referencia visual (asset references para consistencia fisonómica y arquitectónica), quedando terminantemente prohibido usarlas como primer fotograma de los clips de video, ya que el primer fotograma corresponde exclusiva y estrictamente a las imágenes iniciales numeradas de la Etapa 7 (Image 1 para Clip 1, Image 2 para Clip 2, etc.)?[ ] 23. Creación Inversa de Imágenes en Videos Timelapse con Nano Banana 2.1 (Desde la Última hacia la Primera): En producciones de formato Timelapse, ¿se ha verificado rigurosamente que las imágenes fijas de transformación hayan sido creadas obligatoria y exclusivamente con Nano Banana 2.1 (Banana 2.1) en orden inverso, comenzando obligatoriamente por la última imagen (estado final de culminación) y retrocediendo paso a paso hasta la primera imagen (cimientos o estado inicial), garantizando anclaje volumétrico, horizonte inalterable y consistencia geométrica absoluta?[ ] 24. Transición Constructiva sin Cambios Bruscos en Prompts de Videos Timelapse: En producciones de formato Timelapse, ¿se ha verificado rigurosamente que en los prompts de cada clip de video la transformación esté planteada obligatoriamente como una transición constructiva fluida, progresiva y gradual (ej. ensamblaje capa por capa, elevación arquitectónica orgánica), vetando de forma absoluta cualquier cambio brusco, corte repentino (jump cut), salto de escala descontrolado o metamorfosis violenta?[?TIPO_PRODUCCION=POST_EXPECTATIVA][?SUB_OPCION_POST=EXPECTATIVA_ESTRENO][ ] 25. Control de Calidad Post con Imagen (Próximo Estreno 3:4): ¿Se ha verificado que la producción siga las 4 etapas secuenciales con ALTO INQUEBRANTABLE? ¿El prompt técnico en inglés para Nano Banana 2.1 está en ratio 3:4, incluye el logo al 5% preservando obligatoriamente el texto inferior 'Huellas de la Humanidad', y las dos líneas de texto con 'Próximamente en Huellas de la Humanidad' en fuente menor y el texto gancho en fuente grande y de alto contraste? ¿La descripción se entrega SIN TÍTULO, con un máximo de 1200 caracteres en Instagram en formato Todo Corrido dividida en 3 párrafos con braille (⠀), Nota IA oficial exclusiva para imagen (sin decir que la información fue creada con IA), Slogan oficial, 5 hashtags de dos palabras en #CamelCase y Comentario Fijado con CTA natural?[/?SUB_OPCION_POST][?SUB_OPCION_POST=EFEMERIDE][ ] 25. Control de Calidad Post de Efeméride Histórica (Imagen 3:4): ¿Se ha verificado que la IA entregue en la Etapa 1 cinco (5) opciones de efemérides del día actual (o fecha solicitada) con ALTO INQUEBRANTABLE? ¿El prompt técnico en inglés para Nano Banana 2.1 está en ratio 3:4, incluye el logo oficial al 5% preservando el texto inferior 'Huellas de la Humanidad', y tipografía integrada en fuente grande y de alto contraste (fecha en línea 1 y hecho histórico en línea 2)? ¿La descripción se entrega SIN TÍTULO, con un máximo de 1200 caracteres en Instagram en Todo Corrido en 3 párrafos con braille (⠀), Nota IA exclusiva para imagen (sin mencionar información de IA), Slogan, 5 hashtags de dos palabras y Comentario Fijado?[/?SUB_OPCION_POST][?SUB_OPCION_POST=CONTROVERSIA][ ] 25. Control de Calidad Post de Debate y Controversia Histórica (Imagen 3:4): ¿Se ha verificado que la IA entregue en la Etapa 1 cinco (5) opciones de temas polémicos con geolocalización/tiempo en la línea 1 (Ciudad, País, Año; o País, Año) y gancho de controversia en la línea 2 en fuente grande y de alto contraste con ALTO INQUEBRANTABLE? ¿El prompt técnico en inglés para Nano Banana 2.1 está en ratio 3:4, incluye el logo oficial al 5% preservando el texto inferior 'Huellas de la Humanidad' y tipografía grande de alto contraste? ¿La descripción se entrega SIN TÍTULO, con un máximo de 1200 caracteres en Instagram dividida en 3 párrafos de debate con braille (⠀), Nota IA exclusiva para imagen (sin decir información de IA), Slogan, 5 hashtags de dos palabras y Comentario Fijado con CTA de debate?[/?SUB_OPCION_POST][/?TIPO_PRODUCCION][?TIPO_PRODUCCION=NOTEBOOKLM_VIDEO][ ] 26. Control de Calidad Video Automatizado (NotebookLM): ¿Se ha verificado que la producción siga rigurosamente las ocho (8) etapas secuenciales con ALTO INQUEBRANTABLE? ¿El Prompt Maestro de Investigación exige a Google NotebookLM contrastar fuentes académicas, cronología exacta, contradicciones y datos insólitos? ¿Se consulta y acuerda obligatoriamente en la Etapa 3 el estilo cinematográfico del video proponiendo de 3 a 5 opciones adaptadas a la época o permitiendo al usuario ingresar uno personalizado (con ALTO INQUEBRANTABLE)? ¿El Prompt Maestro de Creación de Video (Etapa 4) tiene una extensión máxima estricta de hasta 4000 caracteres (con reporte de caracteres al pie), incorpora obligatoriamente las directrices visuales del estilo cinematográfico acordado, cumple la regla inquebrantable de que la voz narrativa de los auto reels es MASCULINA SIEMPRE (exclusivamente narrador único en off con voz masculina documental cinematográfica profunda y solemne en español neutro, sin voces femeninas, sin formato diálogo/podcast de dos presentadores y sin consultar jamás al usuario qué género de voz prefiere), deja los primeros 6 segundos de video sin voz narrativa con solo video y audio Foley ambiental entrando la locución en el segundo 6, voz narrativa obligatoriamente en idioma español neutro, estructura de gancho, tensión, lema de cierre de Huellas de la Humanidad, duración adaptativa por clip según la escena y combinación híbrida de video con imágenes b-roll (incluyendo tomas tipo mapa, tomas de maquetas a escala, tomas de dibujos en papel en blanco y negro, fotografías y grabados)? ¿Se solicita obligatoriamente el archivo de video generado en NotebookLM y la duración exacta del metraje en la Etapa 5 con ALTO INQUEBRANTABLE, determinando cuántas canciones son necesarias y la duración exacta de cada una respetando los límites de Suno (mínimo 1 minuto y máximo 6 minutos por pista, dejando silencios entre cada canción y haciendo que la última canción sea de solo 1:30) según la época, escenas e intención dramática, con composiciones originales e instrumentales sin voces, entregando cada canción obligatoriamente en el orden estricto de 6 campos (1. Título, 2. Duración, 3. De dónde a dónde cubre en el video en tiempo, 4. Prompt de Lyrics, 5. Prompt de Style, 6. Explicación de la Canción)? ¿El prompt de la miniatura oficial para Nano Banana 2.1 está en 16:9 con texto en pantalla obligatorio (de 1 a 3 palabras contundentes con tipografía cinematográfica de alto contraste integrada en la imagen, sin repetir el título), con el logo dorado "8K" al 5% en la esquina superior derecha y el logo oficial de la página al 5% en la esquina superior izquierda a partir de la imagen de referencia preservando obligatoriamente el texto inferior 'Huellas de la Humanidad' (Etapa 6 con ALTO INQUEBRANTABLE)? ¿La metadata de publicación se entrega en la Etapa 7 e incluye título con el sufijo obligatorio e inquebrantable ' | Documental Completo' al final, descripción en 3 párrafos en formato Todo Corrido con braille (⠀) sin ningún encabezado de sección (recordando que para ninguna producción necesitamos el encabezado de las secciones de la metadata excepto el de los Capítulos:; cero "Título:", cero "Descripción:", cero "Nota IA:", cero "Slogan:", cero "Hashtags:", etc.), sección obligatoria de Capítulos para YouTube (con encabezado ineludible "Capítulos:" y exactamente diez [10] capítulos cronológicos con timestamps iniciando en 00:00 con un título relevante a la historia del video [vetando "Prólogo" o "Inmersión Visual"] y 00:06; sin omitir jamás el encabezado ni alterar la cantidad de 10 capítulos, siendo "Capítulos:" el único encabezado de sección permitido en toda la metadata), Nota IA oficial para documental, Slogan, 5 hashtags de dos palabras (con #DocumentalEnEspañol obligatorio) y Comentario Fijado con CTA natural?[/?TIPO_PRODUCCION][ ] 27. Asistencia Post-Producción para Responder Comentarios de la Audiencia mediante Capturas de Pantalla (Etapa 12 en Reels y Post-Producción Universal): ¿Se ha verificado que después de toda la producción y entregada la metadata final, la IA quede lista para recibir capturas de pantalla (imágenes) o texto de los comentarios de la audiencia en los videos publicados y ayudar al usuario a responderlos de forma CERTERA (con rigor histórico y precisión sobre el episodio) y CONCISA (de 1 a 3 oraciones directas, listas para copiar y pegar)?
Este Manual Maestro de Producción no es un compendio de sugerencias; es el código genético inalterable que estructura el núcleo de Huellas de la Humanidad. Su ejecución meticulosa es el único mecanismo validado capaz de transformar simples secuencias algorítmicas en la reconstrucción viviente de nuestro pasado colectivo.
`;


const PromptGenerator = ({
  initialFormData = null,
  onSaveToProject = null,
  onChangeConfig = null,
  initialVoiceover = '',
  onSrtFixed = null,
  initialTab = 'generator',
  embedded = false,
} = {}) => {
  const [activeTab, setActiveTab] = useState(initialTab || 'generator');
  const [theme, setTheme] = useState(() => localStorage.getItem('huellas_theme') || 'dark');
  const [voiceoverInput, setVoiceoverInput] = useState(initialVoiceover || '');
  const [capcutSrtRaw, setCapcutSrtRaw] = useState('');
  const [srtInput, setSrtInput] = useState('');
  const [srtFileName, setSrtFileName] = useState('captions_corregidos');
  const [srtStats, setSrtStats] = useState(null);
  const [srtMaxChars, setSrtMaxChars] = useState(32);
  const [srtLineMode, setSrtLineMode] = useState('subdivide');
  
  // History State for Undo/Redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [templateText, setTemplateText] = useState('');
  
  const [formData, setFormData] = useState(() => {
    const base = {
      TIPO_PRODUCCION: 'REELS',
      SUB_OPCION_POST: 'EXPECTATIVA_ESTRENO',
      SUB_OPCION_REELS: '16X9',
      SINCRONIZACION_CLIP_1: 'VOZ_EN_CLIP_2',
      TEXTO_PANTALLA_CLIP_1: 'CAPCUT_MANUAL',
      DURACION_CLIP_1: '6',
      DURACION_CLIPS: '10_SEGUNDOS',
      DURACION_CLIPS_SEGUNDOS: '10',
      VOZ_NARRATIVA_EN_CLIPS: 'INCLUIR',
      YOUTUBE_VIRAL_LINK: '',
      ...(initialFormData || {}),
    };
    if (!base.DURACION_CLIPS_SEGUNDOS) {
      base.DURACION_CLIPS_SEGUNDOS = base.DURACION_CLIPS === '8_SEGUNDOS' ? '8' : '10';
    }
    return base;
  });

  useEffect(() => {
    if (initialVoiceover !== undefined) {
      setVoiceoverInput(initialVoiceover || '');
    }
  }, [initialVoiceover]);

  // Sincronizar tema con el DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('huellas_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Cargar plantilla desde LocalStorage al iniciar
  useEffect(() => {
    const key = 'huellas_master_template_v181';
    const savedTemplate = localStorage.getItem(key);
    const initialText = savedTemplate ? savedTemplate : DEFAULT_TEMPLATE.trim();
    setTemplateText(initialText);
    setHistory([initialText]);
    setHistoryIndex(0);
  }, []);

  // Guardar plantilla en LocalStorage MANUALMENTE
  const saveTemplate = () => {
    const key = 'huellas_master_template_v181';
    localStorage.setItem(key, templateText);
    alert('✅ Plantilla Base guardada con éxito.');
  };

  const handleTemplateChange = (e) => {
    const newText = e.target.value;
    setTemplateText(newText);
    
    // Add to history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newText);
    if (newHistory.length > 50) newHistory.shift(); // Max 50 states
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setTemplateText(history[newIndex]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setTemplateText(history[newIndex]);
    }
  };

  // 1. Extraer condicionales y grupos de radio globalmente
  const { conditionals, radioGroups } = useMemo(() => {
    const conds = new Set();
    const groups = {}; 
    
    if (!templateText) return { conditionals: [], radioGroups: {} };

    // Buscar condicionales simples (Checkboxes): [#NOMBRE]
    const condRegex = /\[#([A-Z0-9_]+)\]/g;
    let match;
    while ((match = condRegex.exec(templateText)) !== null) {
      if (match[1] !== 'YOUTUBE_VIRAL_ANALYSIS') {
        conds.add(match[1]);
      }
    }

    // Buscar grupos mutuamente excluyentes (Radios): [?GRUPO=VALOR|VALOR2]
    const radioRegex = /\[\?([A-Z0-9_]+)=([A-Z0-9_\|]+)\]/g;
    while ((match = radioRegex.exec(templateText)) !== null) {
      const group = match[1];
      const values = match[2].split('|');
      if (!groups[group]) groups[group] = new Set();
      values.forEach(val => groups[group].add(val));
    }

    const finalGroups = {};
    const groupKeys = Object.keys(groups).sort((a, b) => {
      if (a === 'TIPO_PRODUCCION') return -1;
      if (b === 'TIPO_PRODUCCION') return 1;
      if (a === 'SUB_OPCION_POST') return -1;
      if (b === 'SUB_OPCION_POST') return 1;
      if (a === 'SUB_OPCION_REELS') return -1;
      if (b === 'SUB_OPCION_REELS') return 1;
      if (a === 'SINCRONIZACION_CLIP_1') return -1;
      if (b === 'SINCRONIZACION_CLIP_1') return 1;
      if (a === 'TEXTO_PANTALLA_CLIP_1') return -1;
      if (b === 'TEXTO_PANTALLA_CLIP_1') return 1;
      if (a === 'DURACION_CLIPS') return -1;
      if (b === 'DURACION_CLIPS') return 1;
      if (a === 'VOZ_NARRATIVA_EN_CLIPS') return -1;
      if (b === 'VOZ_NARRATIVA_EN_CLIPS') return 1;
      return a.localeCompare(b);
    });

    groupKeys.forEach(k => {
      let arr = Array.from(groups[k]);
      if (k === 'TIPO_PRODUCCION') {
        const order = ['REELS', 'POST_EXPECTATIVA', 'NOTEBOOKLM_VIDEO', 'INMERSIVO_CONTEMPLATIVO', 'TIMELAPSE', 'TODO_INCLUIDO'];
        arr.sort((a, b) => {
          const idxA = order.indexOf(a);
          const idxB = order.indexOf(b);
          return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });
      } else if (k === 'SUB_OPCION_POST') {
        const order = ['EXPECTATIVA_ESTRENO', 'EFEMERIDE', 'CONTROVERSIA'];
        arr.sort((a, b) => {
          const idxA = order.indexOf(a);
          const idxB = order.indexOf(b);
          return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });
      } else if (k === 'SUB_OPCION_REELS') {
        const order = ['16X9', '9X16'];
        arr.sort((a, b) => {
          const idxA = order.indexOf(a);
          const idxB = order.indexOf(b);
          return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });
      } else if (k === 'SINCRONIZACION_CLIP_1') {
        const order = ['RALENTIZAR_CAPCUT', 'VOZ_EN_CLIP_2'];
        arr.sort((a, b) => {
          const idxA = order.indexOf(a);
          const idxB = order.indexOf(b);
          return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });
      } else if (k === 'TEXTO_PANTALLA_CLIP_1') {
        const order = ['IA_CLIP_1', 'CAPCUT_MANUAL'];
        arr.sort((a, b) => {
          const idxA = order.indexOf(a);
          const idxB = order.indexOf(b);
          return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });
      } else if (k === 'DURACION_CLIPS') {
        const order = ['10_SEGUNDOS', '8_SEGUNDOS'];
        arr.sort((a, b) => {
          const idxA = order.indexOf(a);
          const idxB = order.indexOf(b);
          return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });
      } else if (k === 'VOZ_NARRATIVA_EN_CLIPS') {
        const order = ['INCLUIR', 'EXCLUIR'];
        arr.sort((a, b) => {
          const idxA = order.indexOf(a);
          const idxB = order.indexOf(b);
          return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });
      }
      finalGroups[k] = arr;
    });

    return { 
      conditionals: Array.from(conds),
      radioGroups: finalGroups
    };
  }, [templateText]);

  // Inicializar formData con los valores por defecto
  useEffect(() => {
    setFormData(prev => {
      const defaults = {
        TIPO_PRODUCCION: 'REELS',
        SUB_OPCION_POST: 'EXPECTATIVA_ESTRENO',
        SUB_OPCION_REELS: '16X9',
        SINCRONIZACION_CLIP_1: 'VOZ_EN_CLIP_2',
        TEXTO_PANTALLA_CLIP_1: 'CAPCUT_MANUAL',
        DURACION_CLIP_1: '6',
        DURACION_CLIPS: '10_SEGUNDOS',
        VOZ_NARRATIVA_EN_CLIPS: 'INCLUIR',
      };
      const newData = { ...prev };
      if (!newData.DURACION_CLIP_1) {
        newData.DURACION_CLIP_1 = '6';
      }
      Object.keys(radioGroups).forEach(group => {
        if (!newData[group] && radioGroups[group].length > 0) {
          newData[group] = defaults[group] && radioGroups[group].includes(defaults[group])
            ? defaults[group]
            : radioGroups[group][0];
        }
      });
      return newData;
    });
  }, [radioGroups]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => {
      const next = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      };
      if (name === 'SINCRONIZACION_CLIP_1') {
        if (value === 'VOZ_EN_CLIP_2' && (!prev.DURACION_CLIP_1 || prev.DURACION_CLIP_1 === '4')) {
          next.DURACION_CLIP_1 = '6';
        } else if (value === 'RALENTIZAR_CAPCUT' && prev.DURACION_CLIP_1 === '6') {
          next.DURACION_CLIP_1 = '4';
        }
      }
      if (name === 'DURACION_CLIPS') {
        next.DURACION_CLIPS_SEGUNDOS = value === '8_SEGUNDOS' ? '8' : '10';
      }
      return next;
    });
  };

  // Auto-sincronizar cambios de configuración de Etapa 1 con el proyecto activo en tiempo real
  useEffect(() => {
    if (typeof onChangeConfig === 'function') {
      onChangeConfig(formData);
    }
  }, [formData]);

  // 2. Determinar variables visibles basado en los bloques activos
  const visibleVariables = useMemo(() => {
    if (!templateText) return [];
    let activeText = templateText;

    // Remover bloques de radio inactivos
    const isTodoIncluido = formData.TIPO_PRODUCCION === 'TODO_INCLUIDO';
    Object.keys(radioGroups).forEach(group => {
      const selectedValue = formData[group];
      
      const blockRegex = new RegExp(`\\[\\?${group}=([A-Z0-9_\\|]+)\\]([\\s\\S]*?)\\[\\/\\?${group}\\]`, 'g');
      activeText = activeText.replace(blockRegex, (match, valStr, content) => {
        if (isTodoIncluido) return content;
        const values = valStr.split('|');
        if (values.includes(selectedValue)) return content;
        return '';
      });
    });

    // Remover bloques condicionales inactivos
    conditionals.forEach(cond => {
      if (!formData[cond]) {
        const blockRegex = new RegExp(`\\[#${cond}\\]([\\s\\S]*?)\\[\\/${cond}\\]`, 'g');
        activeText = activeText.replace(blockRegex, '');
      }
    });

    // Remover bloque de análisis viral de YouTube si el campo está vacío
    const hasYoutubeLink = Boolean((formData.YOUTUBE_VIRAL_LINK || '').trim());
    if (!hasYoutubeLink) {
      activeText = activeText.replace(/\[#YOUTUBE_VIRAL_ANALYSIS\]([\s\S]*?)\[\/YOUTUBE_VIRAL_ANALYSIS\]/g, '');
    } else {
      activeText = activeText.replace(/\[#YOUTUBE_VIRAL_ANALYSIS\]([\s\S]*?)\[\/YOUTUBE_VIRAL_ANALYSIS\]/g, '$1');
    }

    // Encontrar variables solo en el texto resultante
    const vars = new Set();
    const varRegex = /\[([^#\/?][A-Z0-9_]+)\]/g;
    let match;
    while ((match = varRegex.exec(activeText)) !== null) {
      if (
        match[1].trim() !== '' && 
        match[1] !== 'YOUTUBE_VIRAL_LINK' &&
        match[1] !== 'DURACION_CLIP_1' && 
        match[1] !== 'DURACION_CLIP_1_PAD' &&
        match[1] !== 'DURACION_CLIP_1_RALENTIZADO' &&
        match[1] !== 'DURACION_CLIP_1_RALENTIZADO_PAD' &&
        match[1] !== 'VOZ_CLIP2_RANGE_10S' &&
        match[1] !== 'VOZ_CLIP3_RANGE_10S' &&
        match[1] !== 'VOZ_CLIP4_RANGE_10S' &&
        match[1] !== 'VOZ_CLIP2_RANGE_8S' &&
        match[1] !== 'VOZ_CLIP3_RANGE_8S' &&
        match[1] !== 'VOZ_CLIP4_RANGE_8S' &&
        match[1] !== 'RAL_CLIP2_RANGE_10S' &&
        match[1] !== 'RAL_CLIP3_RANGE_10S' &&
        match[1] !== 'RAL_CLIP4_RANGE_10S' &&
        match[1] !== 'RAL_CLIP2_RANGE_8S' &&
        match[1] !== 'RAL_CLIP3_RANGE_8S' &&
        match[1] !== 'RAL_CLIP4_RANGE_8S'
      ) {
        vars.add(match[1]);
      }
    }
    return Array.from(vars);
  }, [templateText, formData, conditionals, radioGroups]);

  // Función para compilar la plantilla con los datos actuales
  const compileTemplate = () => {
    if (!templateText) return '';
    let compiled = templateText;

    // Procesar bloque opcional de análisis viral de YouTube según si el text box tiene enlace o está vacío
    const youtubeViralLink = (formData.YOUTUBE_VIRAL_LINK || '').trim();
    if (youtubeViralLink) {
      if (compiled.includes('[#YOUTUBE_VIRAL_ANALYSIS]')) {
        compiled = compiled.replace(/\[#YOUTUBE_VIRAL_ANALYSIS\]([\s\S]*?)\[\/YOUTUBE_VIRAL_ANALYSIS\]/g, '$1');
        compiled = compiled.replace(/\[YOUTUBE_VIRAL_LINK\]/g, youtubeViralLink);
      } else {
        const viralFallbackBlock = `\n\n================================================================================\n🔥 DIRECTRIZ PRIORITARIA DE INGENIERÍA INVERSA Y ANÁLISIS VIRAL DE YOUTUBE 🔥\nENLACE DEL VIDEO DE YOUTUBE A ANALIZAR: ${youtubeViralLink}\n================================================================================\nINSTRUCCIÓN OBLIGATORIA E INQUEBRANTABLE PARA LA IA (EJECUTAR SIN OBVIAR NADA):\nSe ha integrado a este Prompt Inicial el enlace de un video de YouTube (${youtubeViralLink}). Tienes la OBLIGACIÓN INQUEBRANTABLE de analizar e investigar este video de YouTube de forma PROFUNDA, MINUCIOSA, DETALLADA, INCISIVA E INTENSA, DETALLE POR DETALLE, SIN OBVIAR ABSOLUTAMENTE NADA, para entender con precisión quirúrgica cómo y por qué se hizo viral en la plataforma y RECREAR EXACTAMENTE LA MISMA ESTRUCTURA GANADORA en este episodio (Hook de primeros segundos, escaleta minuto a minuto, micro-ganchos de retención, gatillos psicológicos de viralidad, ritmo del guion, dirección visual/sonora y empaque).\n`;
        const firstNewlineIdx = compiled.indexOf('\n');
        if (firstNewlineIdx !== -1) {
          compiled = compiled.slice(0, firstNewlineIdx) + viralFallbackBlock + compiled.slice(firstNewlineIdx);
        } else {
          compiled = compiled + viralFallbackBlock;
        }
      }
    } else {
      compiled = compiled.replace(/\[#YOUTUBE_VIRAL_ANALYSIS\]([\s\S]*?)\[\/YOUTUBE_VIRAL_ANALYSIS\]/g, '');
      compiled = compiled.replace(/\[YOUTUBE_VIRAL_LINK\]/g, '');
    }

    // Procesar bloques mutuamente excluyentes [?GRUPO=VALOR]...[/?GRUPO]
    const isTodoIncluido = formData.TIPO_PRODUCCION === 'TODO_INCLUIDO';
    Object.keys(radioGroups).forEach(group => {
      const selectedValue = formData[group];
      
      const blockRegex = new RegExp(`\\[\\?${group}=([A-Z0-9_\\|]+)\\]([\\s\\S]*?)\\[\\/\\?${group}\\]`, 'g');
      compiled = compiled.replace(blockRegex, (match, valStr, content) => {
        if (isTodoIncluido) return content;
        const values = valStr.split('|');
        if (values.includes(selectedValue)) return content;
        return '';
      });
    });

    // Procesar bloques condicionales simples [#COND]...[/COND]
    conditionals.forEach(cond => {
      const isChecked = !!formData[cond];
      const blockRegex = new RegExp(`\\[#${cond}\\]([\\s\\S]*?)\\[\\/${cond}\\]`, 'g');
      
      if (isChecked) {
        compiled = compiled.replace(blockRegex, '$1');
      } else {
        compiled = compiled.replace(blockRegex, '');
      }
    });

    // Procesar TODAS las variables para reemplazarlas en el texto final
    // (Incluso si no son visibles, aunque si no son visibles ya fueron borradas)
    const varRegexGlobal = /\[([^#\/?][A-Z0-9_]+)\]/g;
    let match;
    const allVars = new Set();
    while ((match = varRegexGlobal.exec(templateText)) !== null) {
      allVars.add(match[1]);
    }

    Array.from(allVars).forEach(v => {
      let value = formData[v];
      
      // Lógica de fallback para campos en blanco
      if (!value || value.trim() === '') {
        const deepResearchVars = ['CONTRADICCION_CENTRAL', 'PROMESA_NARRATIVA', 'ANCLAJE_DEL_HOOK', 'IMAGEN_FINAL'];
        if (deepResearchVars.includes(v)) {
          value = 'por definir en deep research';
        } else if (v === 'TEMA_DEL_VIDEO') {
          value = 'por definir';
        } else if (v === 'FECHA_EFEMERIDE') {
          value = 'Día actual (o según solicite el usuario)';
        } else {
          value = `[${v}]`; // Marcador visual por defecto si no hay fallback
        }
      }

      const varRegex = new RegExp(`\\[${v}\\]`, 'g');
      compiled = compiled.replace(varRegex, value);
    });

    // Garantizar que la duración del primer clip, su ralentizado y la duración de los demás clips elegida en Etapa 1 se reflejen en la plantilla
    const duracionNum = parseInt(formData.DURACION_CLIP_1 || '6', 10) || 6;
    const duracionVal = String(duracionNum);
    const duracionPad = String(duracionVal).padStart(2, '0');
    const duracionRalentizada = duracionNum + 2;
    const duracionRalentizadaVal = String(duracionRalentizada);
    const duracionRalentizadaPad = String(duracionRalentizadaVal).padStart(2, '0');

    const duracionClipsNum =
      parseInt(
        formData.DURACION_CLIPS_SEGUNDOS ||
          (formData.DURACION_CLIPS === '8_SEGUNDOS' ? '8' : '10'),
        10
      ) || (formData.DURACION_CLIPS === '8_SEGUNDOS' ? 8 : 10);

    const fmtSec = (sec) => {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const step10 = duracionClipsNum !== 8 ? duracionClipsNum : 10;
    const step8 = duracionClipsNum === 8 ? 8 : duracionClipsNum !== 10 ? duracionClipsNum : 8;

    compiled = compiled.replace(/\[DURACION_CLIP_1\]/g, duracionVal);
    compiled = compiled.replace(/\[DURACION_CLIP_1_PAD\]/g, duracionPad);
    compiled = compiled.replace(/\[DURACION_CLIP_1_RALENTIZADO\]/g, duracionRalentizadaVal);
    compiled = compiled.replace(/\[DURACION_CLIP_1_RALENTIZADO_PAD\]/g, duracionRalentizadaPad);
    compiled = compiled.replace(/\[VOZ_CLIP2_RANGE_10S\]/g, `${fmtSec(duracionNum)} - ${fmtSec(duracionNum + step10)}`);
    compiled = compiled.replace(/\[VOZ_CLIP3_RANGE_10S\]/g, `${fmtSec(duracionNum + step10)} - ${fmtSec(duracionNum + step10 * 2)}`);
    compiled = compiled.replace(/\[VOZ_CLIP4_RANGE_10S\]/g, `${fmtSec(duracionNum + step10 * 2)} - ${fmtSec(duracionNum + step10 * 3)}`);
    compiled = compiled.replace(/\[VOZ_CLIP2_RANGE_8S\]/g, `${fmtSec(duracionNum)} - ${fmtSec(duracionNum + step8)}`);
    compiled = compiled.replace(/\[VOZ_CLIP3_RANGE_8S\]/g, `${fmtSec(duracionNum + step8)} - ${fmtSec(duracionNum + step8 * 2)}`);
    compiled = compiled.replace(/\[VOZ_CLIP4_RANGE_8S\]/g, `${fmtSec(duracionNum + step8 * 2)} - ${fmtSec(duracionNum + step8 * 3)}`);
    compiled = compiled.replace(/\[RAL_CLIP2_RANGE_10S\]/g, `${fmtSec(duracionRalentizada)} - ${fmtSec(duracionRalentizada + step10)}`);
    compiled = compiled.replace(/\[RAL_CLIP3_RANGE_10S\]/g, `${fmtSec(duracionRalentizada + step10)} - ${fmtSec(duracionRalentizada + step10 * 2)}`);
    compiled = compiled.replace(/\[RAL_CLIP4_RANGE_10S\]/g, `${fmtSec(duracionRalentizada + step10 * 2)} - ${fmtSec(duracionRalentizada + step10 * 3)}`);
    compiled = compiled.replace(/\[RAL_CLIP2_RANGE_8S\]/g, `${fmtSec(duracionRalentizada)} - ${fmtSec(duracionRalentizada + step8)}`);
    compiled = compiled.replace(/\[RAL_CLIP3_RANGE_8S\]/g, `${fmtSec(duracionRalentizada + step8)} - ${fmtSec(duracionRalentizada + step8 * 2)}`);
    compiled = compiled.replace(/\[RAL_CLIP4_RANGE_8S\]/g, `${fmtSec(duracionRalentizada + step8 * 2)} - ${fmtSec(duracionRalentizada + step8 * 3)}`);
    compiled = compiled.replace(/(Sincronización de Clip 1 y Comienzo de Voz: El primer clip sin voz narrativa se creará de )\d+( segundos)/g, `$1${duracionVal}$2`);

    // Limpiar saltos de línea sobrantes por bloques eliminados
    compiled = compiled.replace(/\n{3,}/g, '\n\n').trim();

    return compiled;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(compileTemplate());
    alert('¡Guion copiado al portapapeles!');
  };

  const downloadDoc = async () => {
    const textContent = compileTemplate();
    if (!textContent) return;

    try {
      const lines = textContent.split('\n');
      const paragraphs = lines.map(line => {
        return new Paragraph({
          children: [
            new TextRun({
              text: line,
              font: "Arial",
              size: 24, // 12pt
            }),
          ],
        });
      });

      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs,
        }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Guion_Huellas_de_la_Humanidad.docx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error al generar DOCX:', err);
      alert('Hubo un error al generar el archivo DOCX.');
    }
  };

  const downloadDocAs = async () => {
    const textContent = compileTemplate();
    if (!textContent) return;

    try {
      const lines = textContent.split('\n');
      const paragraphs = lines.map(line => {
        return new Paragraph({
          children: [
            new TextRun({
              text: line,
              font: "Arial",
              size: 24, // 12pt
            }),
          ],
        });
      });

      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs,
        }],
      });

      const blob = await Packer.toBlob(doc);

      if (window.showSaveFilePicker) {
        try {
          const defaultTitle = formData.TITULO_PRODUCCION || 'Huellas_de_la_Humanidad';
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: `${defaultTitle.replace(/\s+/g, '_')}_Guion.docx`,
            types: [{
              description: 'Documento DOCX',
              accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
            }],
          });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (err) {
          if (err.name !== 'AbortError') {
             alert('Error al guardar el archivo: ' + err.message);
          }
        }
      } else {
        alert('Tu navegador actual no soporta seleccionar carpeta. Se usará la descarga normal.');
        downloadDoc();
      }
    } catch (error) {
      console.error('Error generando DOCX:', error);
      alert('Hubo un error al generar el archivo DOCX.');
    }
  };

  const downloadTemplateRaw = () => {
    if (!templateText) return;
    const blob = new Blob([templateText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const fileName = 'Plantilla_Base_Atemporal.txt';
    link.download = fileName;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const SPANISH_HUNDREDS_VAL = {
    cien: 100, ciento: 100,
    doscientos: 200, doscientas: 200,
    trescientos: 300, trescientas: 300,
    cuatrocientos: 400, cuatrocientas: 400,
    quinientos: 500, quinientas: 500,
    seiscientos: 600, seiscientas: 600,
    setecientos: 700, setecientas: 700,
    ochocientos: 800, ochocientas: 800,
    novecientos: 900, novecientas: 900
  };

  const SPANISH_TENS_VAL = {
    treinta: 30, cuarenta: 40, cincuenta: 50,
    sesenta: 60, setenta: 70, ochenta: 80, noventa: 90
  };

  const SPANISH_UNDER_30_VAL = {
    un: 1, uno: 1, una: 1,
    dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
    dieciseis: 16, dieciséis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiun: 21, veintiún: 21, veintiuno: 21, veintiuna: 21,
    veintidos: 22, veintidós: 22, veintitres: 23, veintitrés: 23, veinticuatro: 24,
    veinticinco: 25, veintiseis: 26, veintiséis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29
  };

  const parseSpanishPhraseUnder1000 = (phrase) => {
    if (!phrase) return null;
    const words = phrase
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter((w) => w && w !== 'y');
    if (words.length === 0) return null;
    let total = 0;
    for (const w of words) {
      if (SPANISH_HUNDREDS_VAL[w] !== undefined) {
        total += SPANISH_HUNDREDS_VAL[w];
      } else if (SPANISH_TENS_VAL[w] !== undefined) {
        total += SPANISH_TENS_VAL[w];
      } else if (SPANISH_UNDER_30_VAL[w] !== undefined) {
        total += SPANISH_UNDER_30_VAL[w];
      } else {
        return null;
      }
    }
    return total > 0 ? total : null;
  };

  // Convierte números escritos en palabras antes de "mil" / "millón" / "millones" (ej. "setenta mil" -> "70 mil")
  // y cifras con ceros en miles exactos (ej. "70,000" / "70.000" / "70000" -> "70 mil")
  const normalizeQuantitiesToMil = (text) => {
    if (!text) return '';
    let result = text;

    // 1. Convertir frases en palabras seguidas de "mil", "millón" o "millones" (ej. "setenta mil" -> "70 mil", "doscientos cincuenta mil" -> "250 mil")
    const numWordRegex = /\b((?:(?:cien|ciento|doscient[oa]s|trescient[oa]s|cuatrocient[oa]s|quinient[oa]s|seiscient[oa]s|setecient[oa]s|ochocient[oa]s|novecient[oa]s)\s+)?(?:(?:treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)(?:\s+y\s+(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve))?|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veinti[uú]n[oa]?|veintid[oó]s|veintitr[eé]s|veinticuatro|veinticinco|veintis[eé]is|veintisiete|veintiocho|veintinueve)|(?:cien|ciento|doscient[oa]s|trescient[oa]s|cuatrocient[oa]s|quinient[oa]s|seiscient[oa]s|setecient[oa]s|ochocient[oa]s|novecient[oa]s))\s+(mil|mill[oó]n|millones)\b(?![\s,]+(?:cien|ciento|doscient|trescient|cuatrocient|quinient|seiscient|setecient|ochocient|novecient|diez|once|doce|trece|catorce|quince|dieci|veint|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b)/gi;

    result = result.replace(numWordRegex, (fullMatch, numPhrase, scaleWord) => {
      const val = parseSpanishPhraseUnder1000(numPhrase);
      if (!val) return fullMatch;
      const lowerScale = scaleWord.toLowerCase();
      if (lowerScale === 'mil' && val === 1 && numPhrase.trim().toLowerCase() === 'un') {
        return fullMatch;
      }
      return `${val} ${lowerScale}`;
    });

    // 2. Convertir cifras con separador de miles en ceros exactos (ej. "70,000" o "70.000" -> "70 mil"), evitando líneas de timestamp SRT
    result = result.replace(/(?<![:\d])\b([1-9]\d{0,2})[.,]000\b(?!\s*(?:mil|-->))/gi, '$1 mil');

    // 3. Convertir cifras de 5 o 6 dígitos terminadas en 000 sin separador (ej. "70000" -> "70 mil", "100000" -> "100 mil")
    result = result.replace(/(?<![:\d])\b([1-9]\d{1,2})000\b(?!\s*mil\b)/gi, '$1 mil');

    return result;
  };

  const cleanSrtContent = (raw) => {
    if (!raw) return '';
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:srt|plaintext|text)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    const timeRegex = /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;
    const lines = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const fixedLines = lines.map((line) => {
      if (timeRegex.test(line) || /^\s*\d+\s*$/.test(line)) {
        return line;
      }
      return normalizeQuantitiesToMil(line);
    });
    return fixedLines.join('\n').trim() + '\n';
  };

  const normalizeToken = (str) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  };

  const phoneticSpanish = (str) => {
    let s = normalizeToken(str);
    if (!s) return '';
    s = s
      .replace(/ch/g, 'x')
      .replace(/h/g, '')
      .replace(/v/g, 'b')
      .replace(/z/g, 's')
      .replace(/ce/g, 'se')
      .replace(/ci/g, 'si')
      .replace(/ll/g, 'y')
      .replace(/qu/g, 'k')
      .replace(/ca/g, 'ka')
      .replace(/co/g, 'ko')
      .replace(/cu/g, 'ku')
      .replace(/ge/g, 'je')
      .replace(/gi/g, 'ji')
      .replace(/gu/g, 'g')
      .replace(/w/g, 'g')
      .replace(/ph/g, 'f')
      .replace(/sh/g, 'x')
      .replace(/th/g, 't')
      .replace(/([a-z])\1+/g, '$1');
    return s;
  };

  const numberToSpanishText = (n) => {
    const num = parseInt(String(n).replace(/[.,]/g, ''), 10);
    if (isNaN(num) || num < 0 || num > 999999999) return '';
    const units = ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciseis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidos','veintitres','veinticuatro','veinticinco','veintiseis','veintisiete','veintiocho','veintinueve'];
    const tens = ['','','veinte','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
    const hundreds = ['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];
    const convertUnder100 = (x) => {
      if (x < 30) return units[x];
      const t = Math.floor(x / 10);
      const u = x % 10;
      return u === 0 ? tens[t] : `${tens[t]} y ${units[u]}`;
    };
    const convertUnder1000 = (x) => {
      if (x === 0) return '';
      if (x === 100) return 'cien';
      if (x < 100) return convertUnder100(x);
      const h = Math.floor(x / 100);
      const rem = x % 100;
      return rem === 0 ? hundreds[h] : `${hundreds[h]} ${convertUnder100(rem)}`;
    };
    const convertUnderMillion = (x) => {
      if (x < 1000) return convertUnder1000(x);
      const th = Math.floor(x / 1000);
      const rem = x % 1000;
      const thText = th === 1 ? 'mil' : `${convertUnder1000(th)} mil`;
      return rem === 0 ? thText : `${thText} ${convertUnder1000(rem)}`;
    };
    if (num < 1000000) return convertUnderMillion(num);
    const mil = Math.floor(num / 1000000);
    const rem = num % 1000000;
    const milText = mil === 1 ? 'un millon' : `${convertUnder1000(mil)} millones`;
    return rem === 0 ? milText : `${milText} ${convertUnderMillion(rem)}`;
  };

  const ROMAN_EQUIVALENTS = {
    I: ['1', 'uno', 'primero', 'primera', 'primer'],
    II: ['2', 'dos', 'segundo', 'segunda'],
    III: ['3', 'tres', 'tercero', 'tercera', 'tercer'],
    IV: ['4', 'cuatro', 'cuarto', 'cuarta'],
    V: ['5', 'cinco', 'quinto', 'quinta'],
    VI: ['6', 'seis', 'sexto', 'sexta'],
    VII: ['7', 'siete', 'septimo', 'septima'],
    VIII: ['8', 'ocho', 'octavo', 'octava'],
    IX: ['9', 'nueve', 'noveno', 'novena'],
    X: ['10', 'diez', 'decimo', 'decima'],
    XI: ['11', 'once'],
    XII: ['12', 'doce'],
    XIII: ['13', 'trece'],
    XIV: ['14', 'catorce'],
    XV: ['15', 'quince'],
    XVI: ['16', 'dieciseis'],
    XVII: ['17', 'diecisiete'],
    XVIII: ['18', 'dieciocho'],
    XIX: ['19', 'diecinueve'],
    XX: ['20', 'veinte'],
    XXI: ['21', 'veintiuno', 'veintiun']
  };

  const editDistance = (a, b) => {
    if (a === b) return 0;
    const la = a.length;
    const lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev;
      prev = curr;
      curr = tmp;
    }
    return prev[lb];
  };

  const getOrigTokenVariants = (origTokens) => {
    const joinedRaw = origTokens.join(' ');
    const baseNorm = normalizeToken(joinedRaw);
    const basePhon = phoneticSpanish(joinedRaw);
    const variants = [{ norm: baseNorm, phon: basePhon }];

    if (origTokens.length === 1) {
      const cleanUpper = origTokens[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (ROMAN_EQUIVALENTS[cleanUpper]) {
        ROMAN_EQUIVALENTS[cleanUpper].forEach((eq) => {
          variants.push({ norm: normalizeToken(eq), phon: phoneticSpanish(eq) });
        });
      }
      const digitsOnly = origTokens[0].replace(/[^0-9]/g, '');
      if (digitsOnly && digitsOnly.length >= 1 && digitsOnly.length <= 4) {
        const sp = numberToSpanishText(digitsOnly);
        if (sp) {
          variants.push({ norm: normalizeToken(sp), phon: phoneticSpanish(sp) });
        }
      }
    }
    return variants;
  };

  const computeMatchScore = (capSlice, origSlice) => {
    const cRaw = capSlice.join(' ');
    const cNorm = normalizeToken(cRaw);
    const cPhon = phoneticSpanish(cRaw);
    if (!cNorm) return -1.0;

    const origVariants = getOrigTokenVariants(origSlice);
    let bestSim = 0;

    for (let v = 0; v < origVariants.length; v++) {
      const { norm: oNorm, phon: oPhon } = origVariants[v];
      if (!oNorm) continue;
      if (cNorm === oNorm || (cPhon && cPhon === oPhon)) {
        bestSim = 1.0;
        break;
      }
      const distNorm = editDistance(cNorm, oNorm);
      const simNorm = 1 - distNorm / Math.max(cNorm.length, oNorm.length, 1);
      const distPhon = editDistance(cPhon, oPhon);
      const simPhon = 1 - distPhon / Math.max(cPhon.length, oPhon.length, 1);
      const sim = Math.max(simNorm, simPhon * 0.98);
      if (sim > bestSim) bestSim = sim;
    }

    return bestSim * 4.6 - 1.25;
  };

  const parseSrtBlocks = (srtText) => {
    const lines = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const timeRegex = /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      if (timeRegex.test(lines[i])) {
        const timestampLine = lines[i].trim();
        let id = String(blocks.length + 1);
        if (i > 0 && /^\s*\d+\s*$/.test(lines[i - 1])) {
          id = lines[i - 1].trim();
        }
        i++;
        const textLines = [];
        while (i < lines.length && lines[i].trim() !== '') {
          if (i + 1 < lines.length && /^\s*\d+\s*$/.test(lines[i]) && timeRegex.test(lines[i + 1])) {
            break;
          }
          if (timeRegex.test(lines[i])) {
            break;
          }
          textLines.push(lines[i].trim());
          i++;
        }
        const words = textLines.join(' ').split(/\s+/).filter(Boolean);
        blocks.push({
          id,
          timestampLine,
          textLines,
          lineCount: Math.max(1, textLines.length),
          words
        });
      } else {
        i++;
      }
    }
    return blocks;
  };

  const handleCapcutSrtFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const base = file.name.replace(/\.srt$|\.txt$/i, '');
    setSrtFileName(`${base}_corregido`);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || '');
      setCapcutSrtRaw(content);
      setSrtInput('');
      setSrtStats(null);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const tokenToPhonetic = (str) => {
    if (!str) return '';
    const cleanUpper = str.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const lettersOnly = str.replace(/[^A-Za-z]/g, '');
    if (ROMAN_EQUIVALENTS[cleanUpper] && lettersOnly === cleanUpper) {
      // Para números romanos (ej. XIX -> diecinueve, II -> segundo), usar la forma hablada
      const spokenForm = ROMAN_EQUIVALENTS[cleanUpper][2] || ROMAN_EQUIVALENTS[cleanUpper][1] || cleanUpper;
      return phoneticSpanish(spokenForm);
    }
    if (/^\d{1,9}$/.test(cleanUpper)) {
      const sp = numberToSpanishText(cleanUpper);
      if (sp) return phoneticSpanish(sp);
    }
    return phoneticSpanish(str);
  };

  const singleWordSim = (capW, origW) => {
    const cP = tokenToPhonetic(capW);
    const oP = tokenToPhonetic(origW);
    if (!cP || !oP) return 0;
    if (cP === oP) return 1.0;
    // También probar equivalentes romanos (ej. "dos" vs "segundo")
    const cleanUpper = (origW || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const lettersOnly = (origW || '').replace(/[^A-Za-z]/g, '');
    let best = 1 - editDistance(cP, oP) / Math.max(cP.length, oP.length, 1);
    if (ROMAN_EQUIVALENTS[cleanUpper] && lettersOnly === cleanUpper) {
      for (const eq of ROMAN_EQUIVALENTS[cleanUpper]) {
        const eqP = phoneticSpanish(eq);
        if (eqP) {
          const s = 1 - editDistance(cP, eqP) / Math.max(cP.length, eqP.length, 1);
          if (s > best) best = s;
        }
      }
    }
    return Math.max(0, best);
  };

  const splitWordsIntoShortLines = (words, maxChars = 32) => {
    if (!words || words.length === 0) return [];
    if (maxChars <= 0) return [words];
    const fullText = words.join(' ');
    const hasSentenceBreakInside = words.slice(0, -1).some((w) => /[.?!:;]$/.test(w));
    if (fullText.length <= maxChars && !hasSentenceBreakInside) {
      return [words];
    }
    const WEAK_END = new Set([
      'el','la','los','las','un','una','unos','unas','al','del','de','en','a','con',
      'por','para','sin','sobre','entre','hacia','hasta','desde','tras','ante','bajo',
      'según','segun','contra','mi','mis','tu','tus','su','sus','nuestro','nuestra',
      'nuestros','nuestras','se','le','les','lo','me','te','nos','no','mas','más',
      'muy','tan','ya','y','e','o','u','ni','que','quien','cuyo','cuya','cuyos','cuyas',
      'san','santa','santo','don','doña','dona','siglo','año','ano','rey','reina','princesa',
      'príncipe','principe','duque','conde','papa','obispo','tratado','castillo'
    ]);
    const STARTERS = new Set([
      'y','e','o','u','ni','pero','sino','aunque','donde','cuando','como','mientras',
      'hasta','desde','para','por','según','segun','hacia','contra','sobre','entre',
      'sin','tras','ante','bajo','que','quien','cuyo','cuya'
    ]);
    const cleanW = (w) => (w || '').toLowerCase().replace(/^[^a-záéíóúüñ0-9]+|[^a-záéíóúüñ0-9]+$/gi, '');
    const m = words.length;
    const minChunks = Math.max(hasSentenceBreakInside ? 2 : 1, Math.ceil(fullText.length / maxChars));
    const targetLen = fullText.length / minChunks;
    const dp = new Array(m + 1).fill(Infinity);
    const parent = new Array(m + 1).fill(-1);
    dp[0] = 0;
    for (let i = 0; i < m; i++) {
      if (dp[i] === Infinity) continue;
      let lineLen = 0;
      for (let j = i + 1; j <= m; j++) {
        const w = words[j - 1];
        lineLen += j === i + 1 ? w.length : 1 + w.length;
        if (j > i + 1 && lineLen > maxChars + 5) break;
        let cost = Math.pow(lineLen - targetLen, 2) * 0.25 + 8;
        if (lineLen > maxChars) cost += Math.pow(lineLen - maxChars, 2) * 3.0;
        if (lineLen < 9 && j < m) cost += (9 - lineLen) * 2.5;
        if (j < m) {
          const lastW = words[j - 1];
          const nextW = words[j];
          const cleanLast = cleanW(lastW);
          const cleanNext = cleanW(nextW);
          if (/[.?!:;…]$/.test(lastW)) cost -= 22;
          else if (/[,]$/.test(lastW)) cost -= 12;
          else {
            if (STARTERS.has(cleanNext)) cost -= 6;
            if (WEAK_END.has(cleanLast)) cost += 28;
            if (/^[IVXLCDM]+$/i.test(nextW.replace(/[^A-Za-z]/g, ''))) cost += 35;
            if (/^\d+$/.test(cleanLast)) cost += 25;
          }
        }
        if (dp[i] + cost < dp[j]) {
          dp[j] = dp[i] + cost;
          parent[j] = i;
        }
      }
    }
    const chunks = [];
    let curr = m;
    while (curr > 0) {
      const prev = parent[curr] >= 0 ? parent[curr] : 0;
      chunks.push(words.slice(prev, curr));
      curr = prev;
    }
    chunks.reverse();
    return chunks;
  };

  const subdivideTimestampRange = (timestampLine, chunks) => {
    if (chunks.length <= 1) return [timestampLine];
    const parts = timestampLine.split('-->');
    if (parts.length !== 2) return chunks.map(() => timestampLine);
    const parseMs = (str) => {
      const m = str.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
      if (!m) return null;
      return ((parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 1000) + parseInt(m[4].padEnd(3, '0'), 10);
    };
    const fmtMs = (totalMs) => {
      const clamped = Math.max(0, Math.round(totalMs));
      const hh = Math.floor(clamped / 3600000);
      const rem1 = clamped % 3600000;
      const mm = Math.floor(rem1 / 60000);
      const rem2 = rem1 % 60000;
      const ss = Math.floor(rem2 / 1000);
      const ms = rem2 % 1000;
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    const startMs = parseMs(parts[0]);
    const endMs = parseMs(parts[1]);
    if (startMs === null || endMs === null || endMs <= startMs) return chunks.map(() => timestampLine);
    const totalDur = endMs - startMs;
    const weights = chunks.map((chunk) => {
      const text = chunk.join(' ');
      const lastW = chunk[chunk.length - 1] || '';
      const punctBonus = /[.?!:;…]$/.test(lastW) ? 5 : /[,]$/.test(lastW) ? 2 : 0;
      return Math.max(1, text.length + punctBonus);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const result = [];
    let accWeight = 0;
    let prevMs = startMs;
    for (let i = 0; i < chunks.length; i++) {
      accWeight += weights[i];
      const nextMs = i === chunks.length - 1 ? endMs : startMs + Math.round((accWeight / totalWeight) * totalDur);
      const safeNextMs = Math.max(prevMs + 10, Math.min(endMs, nextMs));
      result.push(`${fmtMs(prevMs)} --> ${fmtMs(safeNextMs)}`);
      prevMs = safeNextMs;
    }
    return result;
  };

  const processCapcutSrt = (autoDownload = false, customMaxChars = srtMaxChars, customMode = srtLineMode) => {
    if (!voiceoverInput.trim()) {
      alert('⚠️ Primero pega el texto de la Voz Narrativa Original (sin timestamps) en el Paso 1.');
      return;
    }
    if (!capcutSrtRaw.trim()) {
      alert('⚠️ Primero carga o pega el archivo .SRT de CapCut en el Paso 2.');
      return;
    }

    let blocks = parseSrtBlocks(capcutSrtRaw);
    if (blocks.length === 0) {
      alert('⚠️ No se detectaron bloques con timestamps válidos (00:00:XX,XXX --> 00:00:XX,XXX) en el archivo .SRT de CapCut.');
      return;
    }

    // Limpiar el texto de la voz narrativa (quitando etiquetas de pausas y reportes)
    // y arreglar automáticamente números como "setenta mil" o "70,000" a "70 mil" si es necesario
    const cleanedVoiceover = normalizeQuantitiesToMil(
      voiceoverInput
        .replace(/\[(?:pausa|pause|silencio)[^\]]*\]/gi, '')
        .replace(/<break[^>]*\/>/gi, '')
        .replace(/Caracteres\s+Totales[^:\n]*:.*$/gim, '')
        .replace(/Pausas\s+Narrativas\s*:.*$/gim, '')
        .replace(/Duraci[oó]n\s+Total\s+Estimada\s*:.*$/gim, '')
        .trim()
    );
    const origTokens = cleanedVoiceover.split(/\s+/).filter(Boolean);
    if (origTokens.length === 0) {
      alert('⚠️ El texto de la Voz Narrativa está vacío.');
      return;
    }

    const N = origTokens.length;
    const origPhons = origTokens.map((t) => tokenToPhonetic(t));

    // Detectar si al final del .SRT quedaron bloques sobrantes de un video anterior en el timeline de CapCut
    let removedTailBlocks = 0;
    const rawTotalCapWords = blocks.reduce((acc, b) => acc + b.words.length, 0);
    if (blocks.length > 10 && rawTotalCapWords > N * 1.05 && N >= 20) {
      const tailOrigPhon = origPhons.slice(Math.max(0, N - 5)).join('');
      let cumWords = 0;
      for (let b = 0; b < blocks.length - 1; b++) {
        cumWords += blocks[b].words.length;
        if (b >= Math.floor(blocks.length * 0.45) && cumWords >= N * 0.85 && cumWords <= N * 1.15) {
          const windowWords = [
            ...(b > 0 ? blocks[b - 1].words : []),
            ...blocks[b].words,
          ];
          const tailCapWords = windowWords.slice(Math.max(0, windowWords.length - 5));
          const tailCapPhon = tailCapWords.map((w) => tokenToPhonetic(w)).join('');
          const distTail = editDistance(tailCapPhon, tailOrigPhon);
          const simTail = 1 - distTail / Math.max(tailCapPhon.length, tailOrigPhon.length, 1);
          const lastBlockPhon = blocks[blocks.length - 1].words.map((w) => tokenToPhonetic(w)).join('');
          const simVeryLast = 1 - editDistance(lastBlockPhon.slice(-tailOrigPhon.length), tailOrigPhon) / Math.max(tailOrigPhon.length, 1);

          if (simTail >= 0.78 && simVeryLast < 0.6) {
            removedTailBlocks = blocks.length - (b + 1);
            blocks = blocks.slice(0, b + 1);
            break;
          }
        }
      }
    }

    const B = blocks.length;
    const totalCapWords = blocks.reduce((acc, b) => acc + b.words.length, 0);

    // Precomputar representación fonética unificada de cada token original (incluyendo años en letras y números romanos)
    const cumOrigPhonLen = new Int32Array(N + 1);
    for (let j = 0; j < N; j++) {
      cumOrigPhonLen[j + 1] = cumOrigPhonLen[j] + origPhons[j].length;
    }
    const totalOrigPhonLen = Math.max(1, cumOrigPhonLen[N]);

    // Precomputar representación fonética de cada bloque de CapCut
    const blockPhons = blocks.map((b) => b.words.map((w) => tokenToPhonetic(w)).join(''));
    const cumCapPhonLen = new Int32Array(B + 1);
    for (let b = 0; b < B; b++) {
      cumCapPhonLen[b + 1] = cumCapPhonLen[b] + blockPhons[b].length;
    }
    const totalCapPhonLen = Math.max(1, cumCapPhonLen[B]);

    // Programación Dinámica por Bloques Acotada (Block-Level Constrained DP)
    // Impide matemáticamente que cualquier bloque (intermedio o final) reciba texto de más
    const cols = N + 1;
    const dp = new Float32Array((B + 1) * cols);
    const parentJ = new Int32Array((B + 1) * cols);
    const NEG_INF = -1e9;
    dp.fill(NEG_INF);
    parentJ.fill(-1);
    dp[0] = 0;

    const avgWordRatio = N / Math.max(totalCapWords, 1);
    const maxGlobalSlack = Math.max(3, Math.ceil(Math.abs(N - totalCapWords) / Math.max(B, 1)) + 2);

    for (let b = 0; b < B; b++) {
      const bRow = b * cols;
      const nextRow = (b + 1) * cols;
      const w_b = blocks[b].words.length;
      const capPhon = blockPhons[b];
      const L_b = capPhon.length;
      const firstCapW = blocks[b].words[0] || '';
      const lastCapW = blocks[b].words[w_b - 1] || '';

      if (w_b === 0) {
        for (let j = 0; j <= N; j++) {
          if (dp[bRow + j] > NEG_INF / 2) {
            dp[nextRow + j] = dp[bRow + j];
            parentJ[nextRow + j] = j;
          }
        }
        continue;
      }

      const expW = Math.max(1, Math.round(w_b * avgWordRatio));
      const minK = N >= B ? 1 : 0;
      const maxK = Math.max(w_b, expW) + maxGlobalSlack;
      const expectedCumJ = Math.round((cumCapPhonLen[b + 1] / totalCapPhonLen) * N);

      for (let jPrev = 0; jPrev <= N; jPrev++) {
        const prevScore = dp[bRow + jPrev];
        if (prevScore <= NEG_INF / 2) continue;

        const maxJCurr = Math.min(N, jPrev + maxK);
        let concatOrigPhon = '';

        for (let jCurr = jPrev + minK; jCurr <= maxJCurr; jCurr++) {
          if (jCurr > jPrev) {
            // Construir fonética acumulada del segmento origTokens[jPrev .. jCurr - 1]
            if (concatOrigPhon === '' && jCurr > jPrev + 1) {
              for (let t = jPrev; t < jCurr; t++) concatOrigPhon += origPhons[t];
            } else {
              concatOrigPhon += origPhons[jCurr - 1];
            }
          }

          const k = jCurr - jPrev;
          const origLen = concatOrigPhon.length;

          // 1) Similitud fonética global del bloque completo (sin espacios)
          const distBlock = editDistance(capPhon, concatOrigPhon);
          const simBlock = 1 - distBlock / Math.max(L_b, origLen, 1);

          // 2) Anclaje de la primera palabra y la última palabra del bloque
          const simFirst = k > 0 ? singleWordSim(firstCapW, origTokens[jPrev]) : 0;
          const simLast = k > 0 ? singleWordSim(lastCapW, origTokens[jCurr - 1]) : 0;

          // 3) Anclaje de prefijo y sufijo fonético (6 caracteres) por si CapCut dividió una palabra compuesta
          const pLen = Math.min(6, L_b, origLen);
          const simPrefix = pLen > 0 ? 1 - editDistance(capPhon.slice(0, pLen), concatOrigPhon.slice(0, pLen)) / pLen : 0;
          const simSuffix = pLen > 0 ? 1 - editDistance(capPhon.slice(-pLen), concatOrigPhon.slice(-pLen)) / pLen : 0;

          // 4) Penalización cuadrática por diferencia de longitud fonética y de número de palabras
          const charDiffRatio = Math.abs(origLen - L_b) / Math.max(L_b, 6);
          const wordDiff = Math.abs(k - expW);
          const lenPenalty = charDiffRatio * 2.4 + charDiffRatio * charDiffRatio * 2.0 + wordDiff * 0.35 + (wordDiff > 2 ? (wordDiff - 2) * 0.9 : 0);

          // 5) Penalización suave de deriva respecto a la posición proporcional esperada
          const driftPenalty = Math.abs(jCurr - expectedCumJ) * 0.03;

          const stepScore =
            simBlock * 6.5 +
            simFirst * 1.8 +
            simLast * 1.8 +
            simPrefix * 1.0 +
            simSuffix * 1.0 -
            lenPenalty -
            driftPenalty;

          const cand = prevScore + stepScore;
          if (cand > dp[nextRow + jCurr]) {
            dp[nextRow + jCurr] = cand;
            parentJ[nextRow + jCurr] = jPrev;
          }
        }
      }
    }

    // Reconstruir los puntos de corte óptimos splits[0..B]
    const splits = new Array(B + 1);
    let endJ = N;
    if (dp[B * cols + N] <= NEG_INF / 2) {
      // Si el usuario pegó texto extra al final que supera la cota por bloque, elegir el mejor final válido
      let bestFinalScore = NEG_INF;
      for (let j = N; j >= 0; j--) {
        if (dp[B * cols + j] > bestFinalScore) {
          bestFinalScore = dp[B * cols + j];
          endJ = j;
        }
      }
    }
    splits[B] = endJ;
    for (let b = B; b >= 1; b--) {
      const p = parentJ[b * cols + splits[b]];
      splits[b - 1] = p >= 0 ? p : Math.max(0, splits[b] - blocks[b - 1].words.length);
    }
    splits[0] = 0;

    // Reconstruir los bloques .SRT manteniendo intactos el ID y el timestamp de CapCut
    let totalMatchedChars = 0;
    let totalCompChars = 0;
    const rebuiltBlocks = [];

    for (let b = 0; b < B; b++) {
      const block = blocks[b];
      const slice = origTokens.slice(splits[b], splits[b + 1]);
      // Nunca hacer fallback a block.textLines para evitar colar captions de otro video si sobran bloques
      if (slice.length === 0) continue;

      const origSlicePhon = origPhons.slice(splits[b], splits[b + 1]).join('');
      const capPhon = blockPhons[b];
      const maxLen = Math.max(origSlicePhon.length, capPhon.length, 1);
      const dist = editDistance(capPhon, origSlicePhon);
      totalMatchedChars += Math.max(0, maxLen - dist);
      totalCompChars += maxLen;

      if (customMode === 'subdivide' && customMaxChars > 0) {
        const chunks = splitWordsIntoShortLines(slice, customMaxChars);
        const subTimestamps = subdivideTimestampRange(block.timestampLine, chunks);
        for (let c = 0; c < chunks.length; c++) {
          const cleanIdx = rebuiltBlocks.length + 1;
          rebuiltBlocks.push(`${cleanIdx}\n${subTimestamps[c]}\n${chunks[c].join(' ')}`);
        }
      } else if (customMode === 'wrap' && customMaxChars > 0) {
        const chunks = splitWordsIntoShortLines(slice, customMaxChars);
        const formattedText = chunks.map((c) => c.join(' ')).join('\n');
        const cleanIdx = rebuiltBlocks.length + 1;
        rebuiltBlocks.push(`${cleanIdx}\n${block.timestampLine}\n${formattedText}`);
      } else {
        let formattedText = '';
        if (block.lineCount >= 2 && slice.length >= 4) {
          const mid = Math.ceil(slice.length / 2);
          formattedText = `${slice.slice(0, mid).join(' ')}\n${slice.slice(mid).join(' ')}`;
        } else {
          formattedText = slice.join(' ');
        }
        const cleanIdx = rebuiltBlocks.length + 1;
        rebuiltBlocks.push(`${cleanIdx}\n${block.timestampLine}\n${formattedText}`);
      }
    }

    const similarityPct = totalCompChars > 0 ? Math.round((totalMatchedChars / totalCompChars) * 100) : 100;
    const warnings = [];
    if (removedTailBlocks > 0) {
      warnings.push(
        `🛡️ Se detectaron y eliminaron automáticamente ${removedTailBlocks} bloques sobrantes al final del .SRT que pertenecían a un video anterior en la línea de tiempo de CapCut.`
      );
    }
    if (similarityPct < 45) {
      warnings.push(
        `⚠️ ¡ATENCIÓN! Coincidencia fonética muy baja (${similarityPct}%) entre el archivo .SRT y el Guion de Voz Narrativa. Verifica que no hayas dejado el .SRT o el Guion de un video anterior.`
      );
    }

    const finalSrt = rebuiltBlocks.join('\n\n') + '\n';
    setSrtInput(finalSrt);
    const statsObj = {
      blocksCount: rebuiltBlocks.length,
      originalWordsCount: N,
      capcutWordsCount: totalCapWords,
      similarityPct,
      warningMsg: warnings.join(' ')
    };
    setSrtStats(statsObj);
    if (typeof onSrtFixed === 'function') {
      onSrtFixed({ rawSrt: capcutSrtRaw, fixedSrt: finalSrt, stats: statsObj });
    }

    if (autoDownload) {
      triggerSrtDownload(finalSrt);
    }
  };

  const triggerSrtDownload = (content, customName) => {
    const cleaned = cleanSrtContent(content);
    if (!cleaned.trim()) {
      alert('⚠️ No hay contenido SRT para descargar.');
      return;
    }
    const baseName = (customName || srtFileName || 'captions_corregidos').replace(/\.srt$/i, '').trim() || 'captions_corregidos';
    const blob = new Blob([cleaned], { type: 'text/srt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}.srt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const pasteAndDownloadSrt = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        setSrtInput(clipText);
        triggerSrtDownload(clipText);
      } else {
        setActiveTab('srt');
      }
    } catch {
      setActiveTab('srt');
    }
  };

  const compiledOutput = compileTemplate();
  const lastUpdatedText = typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : '7:48 PM - 10/31/2026';

  return (
    <div className="app-container" style={{ position: 'relative' }}>
      <div
        style={{
          position: 'fixed',
          bottom: '8px',
          right: '12px',
          fontSize: '0.7rem',
          color: 'var(--accent-gold)',
          opacity: 0.9,
          zIndex: 9999,
          fontFamily: 'monospace',
          backgroundColor: 'var(--paper-color)',
          padding: '2px 8px',
          borderRadius: '4px',
          border: '1px solid var(--accent-gold)',
          pointerEvents: 'none'
        }}
      >
        Actualizado: {lastUpdatedText}
      </div>
      <div className="panel input-panel" style={{ display: 'flex', flexDirection: 'column', height: '92vh', overflow: 'hidden' }}>
        <div className="brand-header" style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Huellas de la Humanidad</h1>
            <p style={{ marginBottom: '0.15rem' }}>Motor de Plantillas Maestro</p>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontFamily: 'monospace', opacity: 0.85 }}>
              Actualizado: {lastUpdatedText}
            </span>
          </div>
          <button 
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title="Cambiar entre modo claro y oscuro"
          >
            {theme === 'dark' ? '☀️ Claro' : '🌙 Oscuro'}
          </button>
        </div>

        <div className="tabs" style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button 
            className={`btn ${activeTab === 'generator' ? '' : 'btn-secondary'}`} 
            onClick={() => setActiveTab('generator')}
          >
            Generador
          </button>
          <button 
            className={`btn ${activeTab === 'srt' ? '' : 'btn-secondary'}`} 
            onClick={() => setActiveTab('srt')}
          >
            🎬 Arreglar .SRT de CapCut
          </button>
          <button 
            className={`btn ${activeTab === 'editor' ? '' : 'btn-secondary'}`} 
            onClick={() => setActiveTab('editor')}
          >
            Editor de Plantilla
          </button>
        </div>

        {activeTab === 'generator' && (
          <div className="generator-view" style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '1rem' }}>
            <h3 style={{ marginBottom: '1rem' }}>Datos del Nuevo Episodio</h3>

            {/* TEXT BOX PARA ANALIZAR VIDEO VIRAL DE YOUTUBE Y RECREAR SU ESTRUCTURA */}
            <div
              style={{
                marginBottom: '1.5rem',
                padding: '1rem',
                backgroundColor: (formData.YOUTUBE_VIRAL_LINK || '').trim()
                  ? 'rgba(197, 160, 89, 0.16)'
                  : 'rgba(197, 160, 89, 0.08)',
                border: (formData.YOUTUBE_VIRAL_LINK || '').trim()
                  ? '1.5px solid var(--accent-gold)'
                  : '1px solid var(--border-color)',
                borderRadius: '6px',
                boxShadow: '0 2px 8px var(--shadow-color)',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                <label
                  htmlFor="youtube_viral_link_input"
                  style={{
                    fontWeight: 700,
                    fontSize: '0.96rem',
                    color: 'var(--accent-gold)',
                    margin: 0,
                    cursor: 'pointer',
                  }}
                >
                  🔥 Enlace de Video de YouTube para Análisis Viral Profundo y Recreación de Estructura (Opcional):
                </label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
                    onClick={async () => {
                      try {
                        const clip = await navigator.clipboard.readText();
                        if (clip) {
                          setFormData(prev => ({ ...prev, YOUTUBE_VIRAL_LINK: clip.trim() }));
                        }
                      } catch {
                        // ignore clipboard permission error
                      }
                    }}
                  >
                    📋 Pegar Enlace
                  </button>
                  {(formData.YOUTUBE_VIRAL_LINK || '').trim() && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
                      onClick={() => setFormData(prev => ({ ...prev, YOUTUBE_VIRAL_LINK: '' }))}
                    >
                      🗑️ Limpiar
                    </button>
                  )}
                </div>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem 0', lineHeight: 1.4 }}>
                Pega aquí el link de un video de YouTube para analizarlo profunda, minuciosa, detallada, incisiva e intensamente, detalle por detalle, sin obviar nada, entender cómo se hizo viral en la plataforma y recrear exactamente la misma estructura. <strong>Si este campo queda vacío, se obvia este paso; de lo contrario, el prompt para investigarlo y el link del video se integran automáticamente al Prompt Inicial.</strong>
              </p>
              <input
                id="youtube_viral_link_input"
                type="text"
                className="form-control"
                name="YOUTUBE_VIRAL_LINK"
                value={formData.YOUTUBE_VIRAL_LINK || ''}
                onChange={handleInputChange}
                placeholder="Pega aquí el enlace del video de YouTube (ej. https://www.youtube.com/watch?v=... o https://youtu.be/...) — Déjalo vacío para obviar este paso"
                style={{
                  width: '100%',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '5px',
                  border: (formData.YOUTUBE_VIRAL_LINK || '').trim()
                    ? '1.5px solid var(--accent-gold)'
                    : '1px solid var(--border-color)',
                  backgroundColor: 'var(--focus-bg)',
                  color: 'var(--text-primary)',
                  fontSize: '0.92rem',
                  fontFamily: 'monospace',
                }}
              />
              <div
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: (formData.YOUTUBE_VIRAL_LINK || '').trim() ? '#10b981' : 'var(--text-secondary)',
                }}
              >
                {(formData.YOUTUBE_VIRAL_LINK || '').trim()
                  ? '✅ Paso activo: El prompt de investigación viral profunda (detalle por detalle, sin obviar nada) y el link del video están integrados al Prompt Inicial.'
                  : '⚪ Campo vacío: Este paso se obvia y no se incluye en el Prompt Inicial.'}
              </div>
            </div>
            
            {visibleVariables.length === 0 && conditionals.length === 0 && Object.keys(radioGroups).length === 0 && (
              <p>No se detectaron variables en la plantilla. Ve al editor y usa [VARIABLE] o [?GRUPO=VALOR].</p>
            )}

            {/* Renderizar Grupos Mutuamente Excluyentes (Radio / Selects) */}
            {Object.keys(radioGroups).length > 0 && (
              <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: 'rgba(197, 160, 89, 0.1)', border: '1px solid var(--border-color)' }}>
                <h4 style={{ marginBottom: '1rem' }}>Configuración Exclusiva</h4>
                {Object.keys(radioGroups).map(group => {
                  // SUB_OPCION_POST se renderiza de forma integrada e inmediata justo debajo de Post con Imagen
                  if (group === 'SUB_OPCION_POST') {
                    return null;
                  }
                  if ((formData.TIPO_PRODUCCION === 'POST_EXPECTATIVA' || formData.TIPO_PRODUCCION === 'NOTEBOOKLM_VIDEO') && group !== 'TIPO_PRODUCCION') {
                    return null;
                  }
                  if (group === 'SUB_OPCION_REELS' && formData.TIPO_PRODUCCION !== 'REELS' && formData.TIPO_PRODUCCION !== 'TODO_INCLUIDO') {
                    return null;
                  }

                  const groupTitle = group === 'TIPO_PRODUCCION' ? 'Tipo de Producción' :
                                     group === 'SUB_OPCION_POST' ? 'Sub-opción del Post (Imagen 3:4)' :
                                     group === 'SUB_OPCION_REELS' ? 'Aspect Ratio / Sub-opción Reels' :
                                     group === 'SINCRONIZACION_CLIP_1' ? 'Sincronización de Clip 1 y Comienzo de Voz Narrativa' :
                                     group === 'TEXTO_PANTALLA_CLIP_1' ? 'Texto en Pantalla del Primer Clip (Clip 1)' :
                                     group === 'DURACION_CLIPS' ? 'Duración de Clips (a partir del Clip 2)' :
                                     group === 'VOZ_NARRATIVA_EN_CLIPS' ? 'Texto de Voz Narrativa en Prompts de Clips' :
                                     group.replace(/_/g, ' ');

                  const duracionNum = parseInt(formData.DURACION_CLIP_1 || '6', 10) || 6;
                  const duracionSecsText = `${duracionNum} segundo${duracionNum === 1 ? '' : 's'}`;
                  const duracionRalentizada = duracionNum + 2;
                  const duracionRalentizadaText = `${duracionRalentizada} segundo${duracionRalentizada === 1 ? '' : 's'}`;

                  return (
                    <div className="form-group" key={group} style={{ marginBottom: '1.25rem' }}>
                      <label style={{ fontWeight: 'bold' }}>{groupTitle}</label>

                      {group === 'SINCRONIZACION_CLIP_1' && (
                        <div style={{
                          marginTop: '0.75rem',
                          marginBottom: '1rem',
                          padding: '0.85rem 1rem',
                          backgroundColor: 'var(--box-bg)',
                          borderRadius: '6px',
                          border: '1.5px solid var(--accent-gold)',
                          boxShadow: '0 2px 8px var(--shadow-color)'
                        }}>
                          <label 
                            htmlFor="duracion_clip_1_input" 
                            style={{ 
                              display: 'block', 
                              fontWeight: 700, 
                              fontSize: '0.95rem', 
                              color: 'var(--accent-gold)', 
                              marginBottom: '0.5rem', 
                              cursor: 'pointer' 
                            }}
                          >
                            ⏱️ Campo de Texto - Duración del Primer Clip (en segundos):
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => {
                                const current = parseInt(formData.DURACION_CLIP_1 || '6', 10) || 6;
                                if (current > 1) {
                                  setFormData(prev => ({ ...prev, DURACION_CLIP_1: String(current - 1) }));
                                }
                              }}
                              style={{
                                width: '36px',
                                height: '38px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--paper-color)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '1.2rem',
                                transition: 'all 0.2s'
                              }}
                              title="Disminuir 1 segundo"
                            >
                              -
                            </button>
                            <input
                              id="duracion_clip_1_input"
                              type="number"
                              className="form-control"
                              name="DURACION_CLIP_1"
                              min="1"
                              max="60"
                              value={formData.DURACION_CLIP_1 !== undefined ? formData.DURACION_CLIP_1 : '6'}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormData(prev => ({ ...prev, DURACION_CLIP_1: val }));
                              }}
                              placeholder="6"
                              style={{
                                width: '100px',
                                padding: '0.45rem 0.6rem',
                                borderRadius: '4px',
                                border: '1.5px solid var(--accent-gold)',
                                backgroundColor: 'var(--focus-bg)',
                                color: 'var(--text-primary)',
                                fontWeight: 'bold',
                                textAlign: 'center',
                                fontSize: '1.15rem'
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const current = parseInt(formData.DURACION_CLIP_1 || '6', 10) || 6;
                                setFormData(prev => ({ ...prev, DURACION_CLIP_1: String(current + 1) }));
                              }}
                              style={{
                                width: '36px',
                                height: '38px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--paper-color)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '1.2rem',
                                transition: 'all 0.2s'
                              }}
                              title="Aumentar 1 segundo"
                            >
                              +
                            </button>
                            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginLeft: '0.25rem' }}>
                              segundos (Teclea aquí el número)
                            </span>
                          </div>
                        </div>
                      )}

                      {group === 'DURACION_CLIPS' && (
                        <div style={{
                          marginTop: '0.75rem',
                          marginBottom: '0.85rem',
                          padding: '0.85rem 1rem',
                          backgroundColor: 'var(--box-bg)',
                          borderRadius: '6px',
                          border: '1.5px solid var(--accent-gold)',
                          boxShadow: '0 2px 8px var(--shadow-color)'
                        }}>
                          <label
                            htmlFor="duracion_clips_input"
                            style={{
                              display: 'block',
                              fontWeight: 700,
                              fontSize: '0.95rem',
                              color: 'var(--accent-gold)',
                              marginBottom: '0.5rem',
                              cursor: 'pointer'
                            }}
                          >
                            ⏱️ Duración Exacta de los Clips (Clip 2 en adelante, en segundos):
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => {
                                const current = parseInt(
                                  formData.DURACION_CLIPS_SEGUNDOS ||
                                    (formData.DURACION_CLIPS === '8_SEGUNDOS' ? '8' : '10'),
                                  10
                                ) || 10;
                                if (current > 1) {
                                  const nextVal = current - 1;
                                  setFormData(prev => ({
                                    ...prev,
                                    DURACION_CLIPS_SEGUNDOS: String(nextVal),
                                    DURACION_CLIPS: nextVal <= 8 ? '8_SEGUNDOS' : '10_SEGUNDOS',
                                  }));
                                }
                              }}
                              style={{
                                width: '36px',
                                height: '38px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--paper-color)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '1.2rem',
                                transition: 'all 0.2s'
                              }}
                              title="Disminuir 1 segundo"
                            >
                              -
                            </button>
                            <input
                              id="duracion_clips_input"
                              type="number"
                              className="form-control"
                              name="DURACION_CLIPS_SEGUNDOS"
                              min="1"
                              max="60"
                              value={
                                formData.DURACION_CLIPS_SEGUNDOS !== undefined
                                  ? formData.DURACION_CLIPS_SEGUNDOS
                                  : formData.DURACION_CLIPS === '8_SEGUNDOS'
                                  ? '8'
                                  : '10'
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                const numVal = parseInt(val || '10', 10) || 10;
                                setFormData(prev => ({
                                  ...prev,
                                  DURACION_CLIPS_SEGUNDOS: val,
                                  DURACION_CLIPS: numVal <= 8 ? '8_SEGUNDOS' : '10_SEGUNDOS',
                                }));
                              }}
                              placeholder="10"
                              style={{
                                width: '100px',
                                padding: '0.45rem 0.6rem',
                                borderRadius: '4px',
                                border: '1.5px solid var(--accent-gold)',
                                backgroundColor: 'var(--focus-bg)',
                                color: 'var(--text-primary)',
                                fontWeight: 'bold',
                                textAlign: 'center',
                                fontSize: '1.15rem'
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const current = parseInt(
                                  formData.DURACION_CLIPS_SEGUNDOS ||
                                    (formData.DURACION_CLIPS === '8_SEGUNDOS' ? '8' : '10'),
                                  10
                                ) || 10;
                                const nextVal = current + 1;
                                setFormData(prev => ({
                                  ...prev,
                                  DURACION_CLIPS_SEGUNDOS: String(nextVal),
                                  DURACION_CLIPS: nextVal <= 8 ? '8_SEGUNDOS' : '10_SEGUNDOS',
                                }));
                              }}
                              style={{
                                width: '36px',
                                height: '38px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--paper-color)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '1.2rem',
                                transition: 'all 0.2s'
                              }}
                              title="Aumentar 1 segundo"
                            >
                              +
                            </button>
                            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginLeft: '0.25rem' }}>
                              segundos por clip (o selecciona abajo 10s / 8s)
                            </span>
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                        {radioGroups[group].map(val => {
                          const isChecked = formData[group] === val;

                          let labelText = val.replace(/_/g, ' ');
                          if (val === 'REELS') labelText = 'Reels';
                          else if (val === 'POST_EXPECTATIVA') labelText = 'Post con Imagen';
                          else if (val === 'NOTEBOOKLM_VIDEO') labelText = 'Video Automatizado (NotebookLM)';
                          else if (val === 'EXPECTATIVA_ESTRENO') labelText = 'Próximo Estreno de Documental (Expectativa)';
                          else if (val === 'EFEMERIDE') labelText = 'Efeméride Histórica (5 opciones del día actual o fecha específica)';
                          else if (val === 'CONTROVERSIA') labelText = 'Debate y Controversia Histórica (Engagement)';
                          else if (val === '9X16') labelText = '9:16 (Vertical)';
                          else if (val === '16X9') labelText = '16:9 (Horizontal)';
                          else if (val === 'INMERSIVO_CONTEMPLATIVO') labelText = 'Inmersivo Contemplativo';
                          else if (val === 'TIMELAPSE') labelText = 'Timelapse';
                          else if (val === 'TODO_INCLUIDO') labelText = 'Todo Incluido';
                          else if (val === 'RALENTIZAR_CAPCUT') {
                            labelText = `El primer clip sin voz narrativa se creará de ${duracionSecsText} pero en ediciones CapCut yo le bajaré la velocidad y lo llevaré a ${duracionRalentizadaText}`;
                          } else if (val === 'VOZ_EN_CLIP_2') {
                            labelText = `El primer clip sin voz narrativa se creará de ${duracionSecsText} y la voz narrativa comenzará a partir de los primeros 2 segundos del segundo clip (entra en el segundo ${duracionRalentizada} del video)`;
                          } else if (val === 'IA_CLIP_1') {
                            labelText = 'El texto en pantalla del primer clip lo creará la IA dentro del Clip 1';
                          } else if (val === 'CAPCUT_MANUAL') {
                            labelText = 'El texto en pantalla del primer clip lo insertaré en edición manual en CapCut';
                          } else if (val === '10_SEGUNDOS') labelText = '10 segundos (1 shot de 10s)';
                          else if (val === '8_SEGUNDOS') labelText = '8 segundos (1 shot de 8s)';
                          else if (val === 'INCLUIR') labelText = 'Incluir texto de la voz narrativa al final de los prompts de los clips (como una oración más sin comillas ni paréntesis)';
                          else if (val === 'EXCLUIR') labelText = 'Excluir texto de la voz narrativa de los prompts de los clips (prompts limpios cerrando solo con el sufijo "no text, no speech, no music")';

                          return (
                            <React.Fragment key={val}>
                              <label 
                                style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '0.5rem', 
                                  cursor: 'pointer',
                                  padding: isChecked && (group === 'SINCRONIZACION_CLIP_1' || group === 'TEXTO_PANTALLA_CLIP_1' || val === 'POST_EXPECTATIVA' || val === 'NOTEBOOKLM_VIDEO') ? '0.4rem 0.6rem' : '0.2rem 0',
                                  borderRadius: '4px',
                                  backgroundColor: isChecked && (group === 'SINCRONIZACION_CLIP_1' || group === 'TEXTO_PANTALLA_CLIP_1' || val === 'POST_EXPECTATIVA' || val === 'NOTEBOOKLM_VIDEO') ? 'rgba(197, 160, 89, 0.15)' : 'transparent',
                                  border: isChecked && (group === 'SINCRONIZACION_CLIP_1' || group === 'TEXTO_PANTALLA_CLIP_1' || val === 'POST_EXPECTATIVA' || val === 'NOTEBOOKLM_VIDEO') ? '1px solid rgba(197, 160, 89, 0.4)' : '1px solid transparent',
                                  transition: 'all 0.2s ease'
                                }}
                              >
                                <input 
                                  type="radio" 
                                  name={group} 
                                  value={val}
                                  checked={isChecked}
                                  onChange={handleInputChange}
                                  style={{ accentColor: 'var(--accent-gold)', marginTop: '0.1rem' }}
                                />
                                <span style={{ fontWeight: isChecked ? 700 : 400, color: 'var(--text-primary)' }}>
                                  {labelText}
                                </span>
                                {val === 'POST_EXPECTATIVA' && (
                                  <span style={{ fontSize: '0.8rem', color: 'var(--accent-gold)', marginLeft: '0.35rem', fontWeight: 600 }}>
                                    (Próximo Estreno, Efeméride o Controversia)
                                  </span>
                                )}
                              </label>

                              {/* Modalidades Mutuamente Excluyentes integradas de Post con Imagen */}
                              {val === 'POST_EXPECTATIVA' && isChecked && (
                                <div style={{
                                  marginTop: '0.5rem',
                                  marginBottom: '0.85rem',
                                  marginLeft: '1.5rem',
                                  padding: '0.85rem 1.1rem',
                                  backgroundColor: 'var(--box-bg)',
                                  borderRadius: '6px',
                                  border: '1.5px solid var(--accent-gold)',
                                  boxShadow: '0 3px 10px var(--shadow-color)',
                                  width: 'calc(100% - 1.5rem)'
                                }}>
                                  <label style={{ 
                                    display: 'block', 
                                    fontWeight: 700, 
                                    fontSize: '0.92rem', 
                                    color: 'var(--accent-gold)', 
                                    marginBottom: '0.65rem' 
                                  }}>
                                    ✨ Modalidad del Post con Imagen (Mutuamente Excluyentes):
                                  </label>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {[
                                      { id: 'EXPECTATIVA_ESTRENO', label: 'Próximo Estreno de Documental (Expectativa)' },
                                      { id: 'EFEMERIDE', label: 'Efeméride Histórica (5 opciones del día actual o fecha específica)' },
                                      { id: 'CONTROVERSIA', label: 'Debate y Controversia Histórica (Engagement)' }
                                    ].map(sub => {
                                      const isSubChecked = (formData.SUB_OPCION_POST || 'EXPECTATIVA_ESTRENO') === sub.id;
                                      return (
                                        <label
                                          key={sub.id}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.6rem',
                                            cursor: 'pointer',
                                            padding: '0.45rem 0.7rem',
                                            borderRadius: '5px',
                                            backgroundColor: isSubChecked ? 'rgba(197, 160, 89, 0.22)' : 'transparent',
                                            border: isSubChecked ? '1px solid var(--accent-gold)' : '1px solid transparent',
                                            transition: 'all 0.2s ease'
                                          }}
                                        >
                                          <input
                                            type="radio"
                                            name="SUB_OPCION_POST"
                                            value={sub.id}
                                            checked={isSubChecked}
                                            onChange={handleInputChange}
                                            style={{ accentColor: 'var(--accent-gold)' }}
                                          />
                                          <span style={{ 
                                            fontWeight: isSubChecked ? 700 : 400, 
                                            color: isSubChecked ? 'var(--accent-gold)' : 'var(--text-primary)',
                                            fontSize: '0.92rem'
                                          }}>
                                            {sub.label}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Renderizar Inputs Textuales SOLO si son visibles en el template final */}
            {visibleVariables.map(v => (
              <div className="form-group" key={v}>
                <label>{v.replace(/_/g, ' ')}</label>
                <textarea 
                  className="form-control" 
                  name={v} 
                  value={formData[v] || ''} 
                  onChange={handleInputChange} 
                  placeholder={`Ingrese ${v.toLowerCase()}...`}
                  rows="2"
                />
              </div>
            ))}

            {/* Renderizar Checkboxes (Condicionales Simples) */}
            {conditionals.length > 0 && (
              <div className="form-group" style={{ marginTop: '2rem' }}>
                <label>Opciones Adicionales</label>
                <div style={{ display: 'grid', gap: '0.8rem', marginTop: '0.5rem' }}>
                  {conditionals.map(c => (
                    <label key={c} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'normal', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        name={c} 
                        checked={!!formData[c]} 
                        onChange={handleInputChange} 
                        style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--accent-gold)' }}
                      />
                      <span>Incluir: <strong>{c.replace(/_/g, ' ')}</strong></span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'srt' && (
          <div className="srt-view" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '0.85rem', overflowY: 'auto', paddingRight: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>Arreglar Captions Automáticos de CapCut (.SRT)</h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              1) Pega tu <strong>Voz Narrativa Original</strong> (sin timestamps), 2) Carga tu archivo <strong>.SRT de CapCut</strong> con errores en las palabras, y 3) Presiona <strong>"⚙️ Procesar y Descargar .SRT Arreglado"</strong> para corregir todas las palabras manteniendo intactos los timestamps de CapCut.
            </p>

            {/* PASO 1: VOZ NARRATIVA ORIGINAL SIN TIMESTAMPS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'rgba(197, 160, 89, 0.08)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <label style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent-gold)', margin: 0 }}>
                  1️⃣ Voz Narrativa Original (sin timestamps):
                </label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
                    onClick={async () => {
                      try {
                        const t = await navigator.clipboard.readText();
                        if (t) setVoiceoverInput(t);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    📋 Pegar Voz Narrativa
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
                    onClick={() => setVoiceoverInput('')}
                  >
                    🗑️ Limpiar
                  </button>
                </div>
              </div>
              <textarea
                className="form-control"
                rows="5"
                style={{ fontFamily: 'sans-serif', fontSize: '0.86rem', resize: 'vertical' }}
                value={voiceoverInput}
                onChange={(e) => setVoiceoverInput(e.target.value)}
                placeholder="Pega aquí el texto limpio de nuestra Voz Narrativa Original (sin timestamps)..."
              />
            </div>

            {/* PASO 2: CARGAR ARCHIVO .SRT DE CAPCUT CON ERRORES */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'rgba(197, 160, 89, 0.08)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <label style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent-gold)', margin: 0 }}>
                  2️⃣ Cargar Archivo .SRT de CapCut (con errores en las palabras):
                </label>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <label
                    className="btn"
                    style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', cursor: 'pointer', margin: 0 }}
                  >
                    📂 Cargar archivo .SRT de CapCut
                    <input
                      type="file"
                      accept=".srt,.txt"
                      onChange={handleCapcutSrtFileUpload}
                      style={{ display: 'none' }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
                    onClick={() => setCapcutSrtRaw('')}
                  >
                    🗑️ Limpiar
                  </button>
                </div>
              </div>
              <textarea
                className="form-control"
                rows="4"
                style={{ fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical' }}
                value={capcutSrtRaw}
                onChange={(e) => setCapcutSrtRaw(e.target.value)}
                placeholder={`Carga arriba tu archivo .srt de CapCut (o pega su contenido aquí)...\n\n1\n00:00:06,000 --> 00:00:09,500\naño 1888 callejon de guaitchapel...`}
              />
            </div>

            {/* SELECTOR DE LARGO DE LÍNEA DE CAPTIONS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', padding: '0.65rem 0.75rem', borderRadius: '6px', backgroundColor: 'rgba(15, 23, 42, 0.65)', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-gold)' }}>
                📏 Largo Máximo de Línea por Caption:
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {[
                  { val: 22, label: '⚡ Muy Corto (22 caract. / 3-4 pal.)' },
                  { val: 32, label: '🎯 Corto Ideal (32 caract. / 4-6 pal.)' },
                  { val: 42, label: '📐 Medio (42 caract. / 6-7 pal.)' },
                  { val: 0, label: '📄 Original CapCut (Sin acortar)' },
                ].map((opt) => {
                  const isSel = (opt.val === 0 && srtLineMode === 'original') || (opt.val > 0 && srtLineMode !== 'original' && srtMaxChars === opt.val);
                  return (
                    <button
                      key={opt.val}
                      type="button"
                      className={isSel ? 'btn' : 'btn btn-secondary'}
                      style={{ padding: '0.28rem 0.65rem', fontSize: '0.76rem', fontWeight: 700 }}
                      onClick={() => {
                        const nextMode = opt.val === 0 ? 'original' : srtLineMode === 'original' ? 'subdivide' : srtLineMode;
                        const nextMax = opt.val === 0 ? srtMaxChars : opt.val;
                        setSrtMaxChars(nextMax);
                        setSrtLineMode(nextMode);
                        if (voiceoverInput.trim() && capcutSrtRaw.trim()) {
                          processCapcutSrt(false, nextMax, nextMode);
                        }
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* PASO 3: BOTONES SEPARADOS DE PROCESAR Y DESCARGAR */}
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn"
                onClick={() => processCapcutSrt(false)}
                style={{ flexGrow: 1, fontWeight: 700, padding: '0.65rem 1rem' }}
              >
                ⚙️ Procesar .SRT
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!srtInput.trim()}
                onClick={() => triggerSrtDownload(srtInput)}
                style={{ flexGrow: 1, fontWeight: 700, padding: '0.65rem 0.9rem', opacity: srtInput.trim() ? 1 : 0.5 }}
              >
                ⬇️ Descargar .SRT Arreglado
              </button>
            </div>

            {srtStats && (
              <div style={{ fontSize: '0.8rem', color: 'var(--accent-gold)', backgroundColor: 'rgba(197, 160, 89, 0.14)', padding: '0.45rem 0.75rem', borderRadius: '5px', border: '1px solid var(--accent-gold)' }}>
                ✅ <strong>¡SRT Arreglado con éxito!</strong> Bloques de tiempo conservados: <strong>{srtStats.blocksCount}</strong> | Palabras de CapCut analizadas: <strong>{srtStats.capcutWordsCount}</strong> → Reemplazadas con las <strong>{srtStats.originalWordsCount}</strong> palabras exactas de tu Voz Narrativa Original (Coincidencia: <strong>{srtStats.similarityPct ?? 100}%</strong>).
                {srtStats.warningMsg && (
                  <div style={{ marginTop: '0.35rem', color: '#fbbf24', fontWeight: 700 }}>
                    {srtStats.warningMsg}
                  </div>
                )}
              </div>
            )}

            {/* VISTA PREVIA Y DESCARGA DEL SRT ARREGLADO */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flexGrow: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <label style={{ fontSize: '0.84rem', fontWeight: 700, whiteSpace: 'nowrap', margin: 0 }}>
                    3️⃣ Resultado .SRT Arreglado:
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    value={srtFileName}
                    onChange={(e) => setSrtFileName(e.target.value)}
                    placeholder="captions_corregidos"
                    style={{ maxWidth: '210px', padding: '0.28rem 0.55rem', fontSize: '0.82rem' }}
                  />
                  <span style={{ fontSize: '0.82rem', color: 'var(--accent-gold)', fontFamily: 'monospace' }}>.srt</span>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                    onClick={() => triggerSrtDownload(srtInput)}
                  >
                    ⬇️ Descargar .SRT Arreglado
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
                    onClick={() => {
                      if (!srtInput.trim()) return;
                      navigator.clipboard.writeText(cleanSrtContent(srtInput));
                      alert('✅ .SRT arreglado copiado al portapapeles.');
                    }}
                  >
                    📋 Copiar .SRT
                  </button>
                </div>
              </div>
              <textarea
                className="form-control"
                style={{ flexGrow: 1, minHeight: '160px', fontFamily: 'monospace', fontSize: '0.83rem', resize: 'vertical' }}
                value={srtInput}
                onChange={(e) => setSrtInput(e.target.value)}
                placeholder="Aquí aparecerá el archivo .SRT arreglado con los mismos timestamps de CapCut..."
              />
            </div>
          </div>
        )}

        {activeTab === 'editor' && (
          <div className="editor-view" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Modificar el ADN</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button 
                  className="btn btn-secondary" 
                  onClick={undo} 
                  disabled={historyIndex <= 0}
                  title="Deshacer"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}
                >
                  ↩ Deshacer
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={redo} 
                  disabled={historyIndex >= history.length - 1}
                  title="Rehacer"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}
                >
                  ↪ Rehacer
                </button>
                <button 
                  className="btn" 
                  onClick={saveTemplate}
                  style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}
                >
                  💾 Guardar Cambios
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={downloadTemplateRaw}
                  style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}
                >
                  ⬇️ Descargar Plantilla
                </button>
              </div>
            </div>
            
            <p style={{ fontSize: '0.85rem', marginBottom: '1rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
              Texto: <code>[VARIABLE]</code> | Checkbox: <code>[#CONDICION]...[/CONDICION]</code> | Excluyentes: <code>[?GRUPO=OPCION1]...[/?GRUPO]</code>
            </p>
            <textarea 
              className="form-control" 
              style={{ flexGrow: 1, minHeight: '0', fontFamily: 'monospace', fontSize: '0.9rem', resize: 'none' }}
              value={templateText}
              onChange={handleTemplateChange}
            />
          </div>
        )}
      </div>

      <div className="panel output-panel" style={{ display: 'flex', flexDirection: 'column', height: '92vh', overflow: 'hidden' }}>
        <div className="brand-header" style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Pergamino Final</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-card, rgba(255,255,255,0.05))', padding: '0.2rem 0.6rem', borderRadius: '4px', border: '1px solid var(--border-color, rgba(255,255,255,0.1))' }}>
            Caracteres Totales: {compiledOutput.length} (~900 car/min)
          </span>
        </div>
        <div className="result-box" style={{ flexGrow: 1, overflowY: 'auto', marginBottom: '1rem' }}>
          {compiledOutput || "Esperando datos..."}
        </div>
        {typeof onSaveToProject === 'function' && (
          <button
            className="btn"
            style={{ marginBottom: '0.6rem', flexShrink: 0, backgroundColor: '#b45309', color: '#fffdf7' }}
            onClick={() => onSaveToProject(compiledOutput, formData)}
          >
            📌 Guardar Prompt Maestro y Configuración en este Documental
          </button>
        )}
        <button className="btn btn-secondary" style={{ marginBottom: '0.6rem', flexShrink: 0 }} onClick={copyToClipboard}>Copiar al Portapapeles</button>
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, marginBottom: '0.6rem' }}>
          <button className="btn" style={{ flexGrow: 1 }} onClick={downloadDoc}>📄 Descarga Rápida</button>
          <button className="btn btn-secondary" style={{ flexGrow: 1 }} onClick={downloadDocAs}>📁 Descargar en...</button>
        </div>
        <button
          className="btn btn-secondary"
          style={{ flexShrink: 0, border: '1px solid var(--accent-gold)', color: 'var(--accent-gold)' }}
          onClick={pasteAndDownloadSrt}
          title="Copia el texto .srt que te dio Gemini y haz clic aquí para descargarlo directamente como archivo .srt"
        >
          🎬 Pegar de Gemini y Descargar .SRT
        </button>
      </div>
    </div>
  );
};

export default PromptGenerator;
