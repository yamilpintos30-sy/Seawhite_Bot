# Bot de WhatsApp — SEA WHITE S.A.

Asistente virtual por WhatsApp para consultas de documentación (choferes, camiones y acoplados).

> ## ⛔ REGLA Nº 1: EL SERVIDOR DE SEA WHITE ES SOLO LECTURA
> La base de datos y la API de SEA WHITE (`api.seawhite.com.ar`) **se consultan, jamás se editan**.
> El bot usa únicamente los 4 endpoints de consulta del manual y el cliente ([client.ts](src/integrations/sealink/client.ts)) tiene una lista blanca que bloquea cualquier otro path antes de salir a la red.
> **No agregar nunca** endpoints de alta, modificación o borrado, ni ejecutar SQL o scripts contra ese servidor. Las pruebas (`npm run sealink:check`) son sólo lecturas.
> Lo único que el bot escribe es en **su propia** base de Supabase (`bot_sessions`, `bot_messages`), que no tiene relación con la base de SEA WHITE.

```
WhatsApp ──▶ Meta Business ──▶ Chatwoot ──(webhook)──▶ este bot ──▶ Claude API (IA + base de conocimiento)
                                   ▲                      │      ├─▶ API SeaLink (vencimientos)
                                   └────── respuesta ─────┘      └─▶ Supabase (sesiones + logs)
```

## Qué hace

Implementa el flujo de `Esquema_Bot_IA.pdf`, afinado con las pruebas reales de producción:

**Saludo** (conversación nueva): foto de Enri + "¡Hola, Pedro Carlos Mentasti!" (nombre completo buscado en SeaLink por el teléfono, sólo lectura; si el número no figura, saludo genérico) + menú con botones. Mientras BALANZA sea la única sección, el menú principal se saltea (reaparece solo cuando B o C tengan destino).

| Opción (botón) | Comportamiento |
|---|---|
| **Carga de documentos** | Preguntas libres. Responde con IA usando **sólo** la base de conocimiento de `knowledge/` (editable sin tocar código). Aclara siempre que la carga se hace en la página web. |
| **Chofer por DNI** | Pide el DNI → `POST /api/vencimientos/chofer` → Licencia / 931 / ART con estado ✅ ⚠️ ❌ ➖ → preguntas sobre esos datos con IA. |
| **Camión por patente** | Ídem con la patente → Seguro / VTV. |

**Reglas de conversación** (decisiones del equipo, ver historial de commits):
- Cada respuesta cierra con dos botones: **[Menú 😊] [Eso es todo, gracias]** (estilo Banco Provincia). "Eso es todo" despide y cierra la conversación.
- **Fotos y archivos se ignoran por completo**: nunca se piden, nunca se procesan; una foto sola recibe un aviso fijo + el menú. La IA tiene prohibido pedirlas.
- **Buffer de mensajes** (`DEBOUNCE_SECONDS`, 12 s): junta lo que la persona escribe y responde una vez. Botones, opciones, saludos, DNI y patentes responden al instante. El primer mensaje también espera (salvo un saludo): si trae una consulta, el saludo sale junto con su respuesta.
- **Seguimientos desde el último mensaje del cliente**: 5 min "¿necesitás algo más?" (con botones), 30 min despedida + cierre, 35 min respaldo de reseteo.
- Un DNI, un CUIT/CUIL (se extrae el DNI, validando el dígito verificador) o una patente escritos en el menú (o dentro de una frase en la consulta de chofer/camión) **consultan directamente**; una consulta que no es una opción la responde la IA; un número suelto o un mensaje ininteligible muestra el menú real con botones.
- 100 % automático (`HANDOFF_ENABLED=false`): ante "quiero hablar con alguien" explica que la atención es automática. Si un humano del equipo escribe desde Chatwoot (con SU usuario, no el del token), el bot se aparta solo.
- Despedidas formales ("Saludos."), nunca coloquiales.
- Límites anti-abuso por chat y por día: `DAILY_AI_LIMIT` y `DAILY_LOOKUP_LIMIT` (30 c/u).

Reglas de vigencia (manual SeaLink): fecha `< hoy` = **VENCIDO**, `>= hoy` = **VIGENTE**, `null` = **SIN FECHA INFORMADA**; además **⚠️ por vencer** cuando faltan 15 días o menos. "Hoy" se calcula en hora argentina.

## Estructura del proyecto

```
bot/
├── knowledge/                  ← BASE DE CONOCIMIENTO (editable por el equipo, sin reiniciar)
│   └── CargaDocumentacion.md
├── supabase/migrations/        ← SQL de las tablas bot_sessions y bot_messages
├── src/
│   ├── index.ts                ← arranque del servidor HTTP
│   ├── container.ts            ← armado de dependencias
│   ├── config.ts               ← variables de entorno validadas (Zod)
│   ├── server/                 ← Express: /health, webhook, buffer y seguimientos
│   ├── channels/chatwoot/      ← parseo del webhook + cliente API de Chatwoot
│   ├── bot/                    ← MOTOR: máquina de estados
│   │   ├── engine.ts           ← flujo por mensaje (sesión, comandos, handler, transición)
│   │   ├── menus.ts            ← definición de menús (acá se agregan opciones nuevas)
│   │   ├── commands.ts         ← comandos globales (menu / volver / persona / ayuda)
│   │   └── handlers/           ← un archivo por funcionalidad (carga, chofer, camión, menús)
│   ├── ai/                     ← Claude: prompts, base de conocimiento, cliente
│   ├── integrations/sealink/   ← API de vencimientos (auth JWT, token cache, reintento 401)
│   ├── domain/                 ← reglas puras: validaciones (DNI, patente) y vencimientos
│   ├── storage/                ← sesiones (memoria / Supabase) y log de mensajes
│   ├── utils/                  ← fechas (zona horaria AR), texto WhatsApp, logger
│   └── cli/                    ← simulador de consola y chequeo de SeaLink
└── tests/                      ← vitest (dominio, motor, parseo Chatwoot)
```

**Cómo agregar una opción nueva al menú** (por ejemplo `B) LOGÍSTICA`):
1. Agregar el estado en `src/bot/types.ts` (`BotState`).
2. Crear el handler en `src/bot/handlers/` (implementa `enter()` y `handle()`).
3. Registrarlo en `src/bot/handlers/index.ts` (`HANDLERS` y `PARENT_STATE`).
4. Apuntar la opción del menú a ese estado en `src/bot/menus.ts` (`target`).

## Puesta en marcha

### 1. Requisitos
- Node.js 20 o superior.
- Las cuentas de `Alta_de_servicios_Sea-White-chatbot.pdf`: Meta Business, Chatwoot, Claude API, Supabase.
- Credenciales de la API SeaLink (correo y clave; las entrega SEA WHITE).

### 2. Instalar y configurar
```bash
cd bot
npm install
copy .env.example .env      # (Windows)  /  cp .env.example .env (Linux/Mac)
```
Completar `.env` (ver comentarios dentro del archivo). Lo mínimo para arrancar:
`CHATWOOT_API_TOKEN`, `CHATWOOT_ACCOUNT_ID`, `WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `SEALINK_EMAIL`, `SEALINK_PASSWORD`.

### 3. Supabase (recomendado en producción)
En el proyecto **Sea-White-chatbot** → SQL Editor → pegar y ejecutar `supabase/migrations/0001_init.sql`.
Luego completar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `.env`. Si se omiten, las sesiones se guardan en memoria (sirve para probar, se pierden al reiniciar).

### 4. Probar sin WhatsApp
```bash
npm run sealink:check      # verifica auth + DNIs y dominios de prueba del manual
npm run chat               # simulador de consola (usa Claude y SeaLink reales)
SEALINK_FAKE=1 npm run chat  # simulador con datos falsos de SeaLink
npm test                   # tests unitarios (no llaman a servicios externos)
```

### 5. Levantar el servidor
```bash
npm run dev      # desarrollo (recarga automática)
npm run build && npm start   # producción
```
Health check: `GET http://localhost:3000/health`.

### 5b. Desplegar en Render (producción)
El repo incluye [render.yaml](render.yaml): en Render, **New + → Blueprint** → conectar `Seawhite_Bot` → Render crea el servicio (instancia *starter*, ~US$7/mes, según la guía) y pide completar los secretos (tokens de Chatwoot/Claude/SeaLink/Supabase). El `WEBHOOK_SECRET` lo genera Render solo. La URL pública queda como `https://seawhite-bot.onrender.com` (o similar) y es la que se usa en el webhook de Chatwoot. Cada push a `main` redespliega automáticamente.

### 6. Conectar Chatwoot
El bot tiene que ser accesible por HTTPS desde internet (en desarrollo: `ngrok http 3000` o similar).

**Esquema recomendado — Webhook de cuenta + token de perfil** (el mismo que usa el BOT MIAMI en producción):
1. Chatwoot → Settings → Integrations → *Webhooks* → agregar:
   `https://TU-DOMINIO/webhooks/chatwoot?token=<WEBHOOK_SECRET>`
   con los eventos `message_created` y `conversation_status_changed`.
2. Perfil → Configuración de perfil → *Access Token* → copiarlo en `CHATWOOT_API_TOKEN`.
3. Si la cuenta tiene más de un inbox (u otro bot), completar `CHATWOOT_INBOX_ID`; los webhooks de Chatwoot son a nivel cuenta y sin el filtro los bots se pisan.

Con este esquema el handoff es automático en ambos sentidos:
- Si **un vendedor humano escribe** desde Chatwoot, el bot lo detecta por el webhook (mensaje saliente que no coincide con nada que el bot haya enviado — anti-eco) y **se silencia solo** por `HANDOFF_SILENCE_MINUTES`.
- Si **el usuario pide una persona** (`persona`, "quiero hablar con alguien"), el bot avisa y se silencia.
- El cliente puede despertar al bot escribiendo `/bot` (o `volver al bot`); si no, despierta solo al vencer el silencio, o al resolverse la conversación.

**Alternativa — Agent Bot de Chatwoot:** crear el bot en Settings → Integrations → *Agent Bots*, asignarlo al inbox y usar su token. En ese caso conviene `HANDOFF_STATUS=open` para que al derivar la conversación pase de `pending` a `open` y la tome un agente.

## Editar la base de conocimiento

Todo lo que el bot "sabe" sobre procedimientos está en `knowledge/*.md`. Se puede:
- Editar `CargaDocumentacion.md` (es el *Schema maestro*).
- Agregar más archivos `.md` o `.txt` (se cargan todos, en orden alfabético).

El bot detecta los cambios solo (cada `KNOWLEDGE_RELOAD_SECONDS`, 30 s por defecto). **No hace falta reiniciar ni tocar código.**

El tono y las reglas de oro (no inventar, pedir captura, no prometer aprobación) están en `src/ai/prompts.ts`.

## Costos y modelo

- Modelo por defecto: `claude-sonnet-5`. La base de conocimiento (~9 K tokens) se envía con *prompt caching* (`CLAUDE_CACHE_TTL=1h`), por lo que la mayoría de las consultas pagan ~10 % del precio de entrada. Estimación: USD 12–20/mes para ~1.000 respuestas.
- Si algún día se necesita el modelo tope de línea, se cambia con `CLAUDE_MODEL=claude-opus-5` sin tocar código (≈ 2,5× más caro).
- `CLAUDE_FALLBACKS=true` activa el fallback automático del lado del servidor si el modelo principal rechaza una consulta por política; el usuario nunca se queda sin respuesta.

## Operación

- **Logs**: pino en consola (`LOG_LEVEL=debug` para ver el uso de tokens y cache por consulta).
- **Sesión**: vuelve al menú principal tras `SESSION_TTL_MINUTES` de inactividad (60 min).
- **Derivación**: al escribir `persona` (o si un agente se asigna la conversación en Chatwoot) el bot se silencia `HANDOFF_SILENCE_MINUTES` (120 min). Al resolver la conversación en Chatwoot la sesión se borra.
- **Duplicados / orden**: los reintentos del webhook se descartan por ID y los mensajes de una misma conversación se procesan en orden.
- **Tablas Supabase**: `bot_sessions` (estado actual) y `bot_messages` (todo lo que entra y sale, útil para ver qué preguntan y mejorar `knowledge/`).

## Notas operativas

- **SIEMPRE 1 sola instancia en Render.** El bot guarda estado en memoria (buffer de mensajes, anti-eco, cola por conversación, timers de seguimiento). Escalar a 2+ instancias rompe esos mecanismos de formas difíciles de diagnosticar. Si algún día hace falta más capacidad, subir el tamaño de la instancia, no la cantidad.
- **Qué se pierde en cada deploy/reinicio** (tolerable, pero explica rarezas puntuales): los timers de seguimiento pendientes (un "¿necesitás algo más?" que no llega), los contadores de límite diario y el anti-eco de texto (el anti-eco principal, por usuario del token, se reconstruye solo). El buffer de mensajes se vacía y procesa antes de apagar (SIGTERM). Las sesiones viven en Supabase y sobreviven.
- **Los logs de Render contienen datos personales** (nombres, teléfonos, texto de las consultas): acceso a Render = acceso a conversaciones.
- **Si el WEBHOOK_SECRET se filtra** (viaja en la URL del webhook): rotarlo lleva 1 minuto — cambiar la variable en Render y actualizar la URL en Chatwoot.

## Seguridad

- `.env` y `Credenciales.txt` **nunca** se suben a git (ver `.gitignore`).
- El webhook exige `?token=<WEBHOOK_SECRET>`; sin él responde 401.
- Se usa la *service role key* de Supabase sólo del lado del servidor; las tablas tienen RLS activo sin políticas públicas.
- Si la API SeaLink usa un certificado propio y falla el TLS, configurar el certificado en Node (`NODE_EXTRA_CA_CERTS=ruta/al/cert.pem`); no desactivar la validación en producción.

## Panel web (`/panel`)

Panel interno para el equipo de SEA WHITE, servido por el mismo servicio de Render:
`https://seawhite-bot.onrender.com/panel`.

Se publica **sólo** si existe la variable `ADMIN_PASSWORD` (mínimo 8 caracteres). El acceso es
por contraseña, con cookie firmada (HMAC con `WEBHOOK_SECRET`, 12 h) y freno a la fuerza bruta
(5 intentos por IP cada 10 minutos).

| Pestaña | Qué muestra |
|---|---|
| **Contexto del bot** | El texto con el que responde Enri: se lee, se edita o se reemplaza subiendo un `.txt`/`.md`. Al guardar, el bot lo toma en menos de un minuto. Guarda historial de versiones y permite restaurar. |
| **Actividad** | Personas distintas, conversaciones y mensajes por día, horarios de mayor uso y qué parte del bot se usa más. |
| **Temas y quejas** | Análisis con IA de los mensajes de los usuarios: temas más consultados, errores de carga mencionados, quejas y sugerencias de mejora. Se cachea 30 minutos. |

**Dónde vive el contexto.** En Render el disco es efímero: un archivo subido se perdería en el
próximo deploy. Por eso el contexto del panel se guarda en Supabase (`bot_knowledge`, con
historial en `bot_knowledge_versions`) y **manda sobre** los archivos de `knowledge/`. Si Supabase
no está configurado o falla, el bot sigue funcionando con los archivos del repositorio.

**Puesta en marcha**: ejecutar `supabase/migrations/0002_panel.sql` en el SQL Editor y cargar
`ADMIN_PASSWORD` en Render.
