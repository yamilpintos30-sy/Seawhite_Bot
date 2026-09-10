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

Implementa el flujo definido en `Esquema_Bot_IA.pdf`:

| Menú | Opción | Comportamiento |
|---|---|---|
| Principal | **A) BALANZA** | Abre el submenú BALANZA (B y C quedan preparadas "a definir"). |
| BALANZA | **1) Carga de Documentación** | Preguntas libres. Responde con IA usando **sólo** la base de conocimiento de `knowledge/` (editable sin tocar código). Acepta capturas (JPG/PNG/WEBP) y PDF. |
| BALANZA | **2) Documentación de Chofer** | Pide el DNI → consulta `POST /api/vencimientos/chofer` → muestra Licencia / 931 / ART con estado ✅ ⚠️ ❌ ➖ → luego responde preguntas sobre esos datos con IA. |
| BALANZA | **3) Documentación de Camión o Acoplado** | Pide la patente → consulta `POST /api/vencimientos/camion` → muestra Seguro / VTV → preguntas con IA. |

Atajos en cualquier momento: `menu`, `volver`, `ayuda`, `persona` (deriva a un agente humano y el bot se calla).

**Saludo por nombre:** al iniciar una conversación, el bot busca el teléfono del remitente en SeaLink (`POST /api/vencimientos/chofer/telefono`, anexo del manual, sólo lectura) y saluda por el nombre ("¡Hola, Pedro! 👋..."). Si el número no figura o la consulta falla, saluda genérico sin trabarse. Nota: el anexo documenta el campo `Razon_Social` pero la API real responde `razon_Social`; el cliente tolera ambas.

Reglas de vigencia (manual SeaLink): fecha `< hoy` = **VENCIDO**, `>= hoy` = **VIGENTE**, `null` = **SIN FECHA INFORMADA**. Además se avisa **⚠️ por vencer** cuando faltan 15 días o menos (igual que la plataforma).

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
│   ├── server/                 ← Express: /health y /webhooks/chatwoot
│   ├── channels/chatwoot/      ← parseo del webhook + cliente API de Chatwoot
│   ├── bot/                    ← MOTOR: máquina de estados
│   │   ├── engine.ts           ← flujo por mensaje (sesión, comandos, handler, transición)
│   │   ├── menus.ts            ← definición de menús (acá se agregan opciones nuevas)
│   │   ├── commands.ts         ← comandos globales (menu / volver / persona / ayuda)
│   │   └── handlers/           ← un archivo por funcionalidad (carga, chofer, camión, menús)
│   ├── ai/                     ← Claude: prompts, base de conocimiento, adjuntos
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

- Modelo por defecto: `claude-opus-5`. La base de conocimiento (~9 K tokens) se envía con *prompt caching* (`CLAUDE_CACHE_TTL=1h`), por lo que la mayoría de las consultas pagan ~10 % del precio de entrada. Estimación: USD 30–50/mes para ~1.000 respuestas.
- Para bajar el costo se puede usar `CLAUDE_MODEL=claude-sonnet-5` (≈ 2,5× más barato) sin cambiar nada más.
- `CLAUDE_FALLBACKS=true` activa el fallback automático del lado del servidor si el modelo principal rechaza una consulta por política; el usuario nunca se queda sin respuesta.

## Operación

- **Logs**: pino en consola (`LOG_LEVEL=debug` para ver el uso de tokens y cache por consulta).
- **Sesión**: vuelve al menú principal tras `SESSION_TTL_MINUTES` de inactividad (60 min).
- **Derivación**: al escribir `persona` (o si un agente se asigna la conversación en Chatwoot) el bot se silencia `HANDOFF_SILENCE_MINUTES` (120 min). Al resolver la conversación en Chatwoot la sesión se borra.
- **Duplicados / orden**: los reintentos del webhook se descartan por ID y los mensajes de una misma conversación se procesan en orden.
- **Tablas Supabase**: `bot_sessions` (estado actual) y `bot_messages` (todo lo que entra y sale, útil para ver qué preguntan y mejorar `knowledge/`).

## Seguridad

- `.env` y `Credenciales.txt` **nunca** se suben a git (ver `.gitignore`).
- El webhook exige `?token=<WEBHOOK_SECRET>`; sin él responde 401.
- Se usa la *service role key* de Supabase sólo del lado del servidor; las tablas tienen RLS activo sin políticas públicas.
- Si la API SeaLink usa un certificado propio y falla el TLS, configurar el certificado en Node (`NODE_EXTRA_CA_CERTS=ruta/al/cert.pem`); no desactivar la validación en producción.
