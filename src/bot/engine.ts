/**
 * Motor del bot: máquina de estados pura, independiente del canal.
 *
 * Flujo por cada mensaje entrante:
 *   1. Cargar la sesión (o crear una: conversación nueva o expirada por TTL).
 *   2. Conversación nueva -> saludo (identifica al chofer por teléfono en
 *      SeaLink para el nombre) + imagen + menú con botones; si el primer
 *      mensaje ya traía una consulta, el saludo va con su respuesta.
 *   3. Si una persona tomó la conversación -> silencio (el cliente puede
 *      despertar al bot con "/bot").
 *   4. Foto/archivo sin texto -> aviso fijo + menú (las fotos se IGNORAN,
 *      jamás llegan a la IA).
 *   5. Comandos globales (menu/saludos, volver, cierre, ayuda, persona).
 *   6. Handler del estado actual (menús, carga con IA, chofer, camión).
 *   7. Transición: si el destino es un menú, la respuesta lleva botones.
 *   8. Guardar sesión (o borrarla si la conversación se cerró) y registrar.
 *
 * Garantías: mensajes de una misma conversación en orden (cola por
 * conversación); una falla de Supabase degrada a sesión en memoria sin
 * cortar la respuesta; ninguna promesa perdida tumba el proceso.
 */
import type { MessageLog } from "../storage/messageLog.js";
import type { SessionStore } from "../storage/sessionStore.js";
import { nombreCompleto } from "../utils/names.js";
import { normalizeText } from "../utils/text.js";
import { detectGlobalCommand, helpText, isGreetingOnly } from "./commands.js";
import { getHandler, PARENT_STATE } from "./handlers/index.js";
import { welcomeLine } from "./handlers/menuHandlers.js";
import { BALANZA_MENU, MAIN_MENU, menuButtons, startState, type Menu } from "./menus.js";
import { BotState, type BotReply, type BotServices, type BotStateName, type IncomingMessage, type RichOutbound, type Session } from "./types.js";

/** Menú correspondiente a un estado, si el estado es un menú. */
const MENU_OF_STATE: Partial<Record<BotStateName, Menu>> = {
  [BotState.MAIN_MENU]: MAIN_MENU,
  [BotState.BALANZA_MENU]: BALANZA_MENU,
};

/** Cuerpo corto del mensaje con botones (los botones ya dicen qué hace cada uno). */
const BUTTONS_NOTE = "_La carga de documentación se hace en la página web; acá resuelvo dudas y consulto vencimientos al instante._";
const BUTTONS_BODY = `¿Qué necesitás? Tocá una opción 👇\n\n${BUTTONS_NOTE}`;

const HANDOFF_MESSAGE = "Perfecto, le paso tu consulta a una persona del equipo de SEA WHITE para que te responda por acá. 🙌";
const AUTOMATIC_ONLY_MESSAGE =
  "Por acá la atención es automática, pero te puedo resolver casi todo yo 🤖. Contame tu consulta sobre la documentación, o escribí *menu* para ver las opciones.";
const GENERIC_ERROR = "Uy, tuve un problema para procesar tu mensaje. Probá de nuevo en un momento o escribí *menu* para volver al inicio.";
const NO_PHOTOS_MESSAGE = "Por acá no proceso fotos ni archivos. Contame por escrito lo que necesitás, o elegí una opción 👇";
const FAREWELL_MESSAGE = "¡Gracias por escribirme! Cualquier consulta sobre documentación o vencimientos, acá estoy. Saludos.";

/** Comandos con los que el cliente despierta al bot mientras está derivado a una persona. */
const REACTIVATION_TRIGGERS = ["/bot", "bot", "volver al bot", "reactivar bot", "activar bot"];

function isReactivationCommand(text: string): boolean {
  const t = (text ?? "").trim().toLowerCase();
  return REACTIVATION_TRIGGERS.includes(t);
}

export interface BotEngineDeps {
  services: BotServices;
  sessions: SessionStore;
  messageLog?: MessageLog;
}

export class BotEngine {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: BotEngineDeps) {}

  /** Procesa un mensaje garantizando orden por conversación. */
  async handle(message: IncomingMessage): Promise<BotReply> {
    const previous = this.queues.get(message.conversationId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.process(message));
    this.queues.set(message.conversationId, run);
    // El .finally crea una promesa NUEVA: sin el .catch final, un error acá era
    // un "unhandled rejection" que tiraba abajo TODO el proceso (visto en Render).
    run
      .finally(() => {
        if (this.queues.get(message.conversationId) === run) this.queues.delete(message.conversationId);
      })
      .catch(() => undefined);
    return run;
  }

  /** Olvida la sesión (por ejemplo, cuando la conversación se resuelve en Chatwoot). */
  async reset(conversationId: string): Promise<void> {
    await this.deps.sessions.delete(conversationId);
  }

  /** Marca la conversación como tomada por una persona. */
  async markHandedOff(conversationId: string, accountId: string): Promise<void> {
    const { services } = this.deps;
    const session = (await this.safeGetSession(conversationId)) ?? this.newSession(conversationId, accountId);
    session.handedOffUntil = new Date(services.now().getTime() + services.config.HANDOFF_SILENCE_MINUTES * 60_000).toISOString();
    session.updatedAt = services.now().toISOString();
    await this.safeSaveSession(session);
  }

  // ---------------------------------------------------------------------------

  private async process(message: IncomingMessage): Promise<BotReply> {
    const { services, sessions, messageLog } = this.deps;
    const { logger, config } = services;
    const now = services.now();

    let session = await this.safeGetSession(message.conversationId);
    let isNew = false;

    if (!session) {
      session = this.newSession(message.conversationId, message.accountId, message.sender);
      isNew = true;
    } else if (now.getTime() - Date.parse(session.updatedAt) > config.SESSION_TTL_MINUTES * 60_000) {
      logger.info({ conversationId: message.conversationId }, "Sesión expirada por inactividad; reiniciando");
      session = this.newSession(message.conversationId, message.accountId, message.sender);
      isNew = true;
    }

    if (session.handedOffUntil && Date.parse(session.handedOffUntil) > now.getTime()) {
      // El cliente puede despertar al bot explícitamente (idea del BOT MIAMI).
      if (isReactivationCommand(message.text)) {
        logger.info({ conversationId: message.conversationId }, "Handoff desactivado por comando del cliente");
        session.handedOffUntil = null;
        session.state = startState();
        session.updatedAt = now.toISOString();
        await messageLog?.logIncoming(message, session.state);
        const reply = await this.transition(session, message, startState());
        await this.safeSaveSession(session);
        await messageLog?.logOutgoing(message, reply.messages, session.state);
        return reply;
      }
      logger.debug({ conversationId: message.conversationId }, "Conversación derivada a una persona; el bot no responde");
      // Se registra igual, así el historial queda completo para la persona que atiende.
      await messageLog?.logIncoming(message, session.state);
      return { messages: [] };
    }
    session.handedOffUntil = null;

    await messageLog?.logIncoming(message, session.state);

    let reply: BotReply;
    try {
      if (!isNew && !message.text.trim() && message.attachments.length > 0) {
        // Foto/archivo SOLO, sin texto: se ignora por completo (decisión del
        // equipo) y se responde con el menú real de botones.
        reply = await this.transition(session, message, startState(), [NO_PHOTOS_MESSAGE]);
      } else {
        reply = isNew ? await this.startConversation(session, message) : await this.dispatch(session, message);
      }
    } catch (err) {
      logger.error({ err, conversationId: message.conversationId, state: session.state }, "Error procesando mensaje");
      reply = { messages: [GENERIC_ERROR] };
    }

    if (reply.reset) {
      // Conversación cerrada por el usuario: se borra la sesión (el próximo
      // mensaje arranca con el saludo desde cero).
      await this.reset(message.conversationId).catch(() => undefined);
    } else {
      session.updatedAt = services.now().toISOString();
      await this.safeSaveSession(session);
    }
    await messageLog?.logOutgoing(message, reply.messages, session.state);
    return reply;
  }

  /**
   * Lectura/escritura de sesión que NUNCA rompe la conversación: si Supabase
   * falla (mal configurado, caído), se loguea y se sigue con una sesión nueva
   * en memoria. El usuario recibe su respuesta igual.
   */
  private async safeGetSession(conversationId: string): Promise<Session | null> {
    try {
      return await this.deps.sessions.get(conversationId);
    } catch (err) {
      this.deps.services.logger.error({ err, conversationId }, "No se pudo LEER la sesión (¿Supabase mal configurado?); se continúa con sesión nueva");
      return null;
    }
  }

  private async safeSaveSession(session: Session): Promise<void> {
    try {
      await this.deps.sessions.save(session);
    } catch (err) {
      this.deps.services.logger.error(
        { err, conversationId: session.conversationId },
        "No se pudo GUARDAR la sesión (¿Supabase mal configurado?); la conversación sigue pero sin memoria persistente",
      );
    }
  }

  /** Primer mensaje de una conversación nueva (o expirada): saludo + menú inicial. */
  private async startConversation(session: Session, message: IncomingMessage): Promise<BotReply> {
    await this.identifyContact(session, message);
    const start = startState();
    session.state = start;
    const ctx = { session, message, services: this.deps.services };
    const greeting = welcomeLine(this.deps.services.config.BOT_NAME, session.contact?.displayName);

    // Si el primer mensaje ya trae algo concreto (una opción, un DNI, una consulta
    // como "ingreso el teléfono y no me lo toma"), se responde JUNTO con el saludo:
    // antes se ignoraba y el cliente tenía que volver a escribirlo. Un saludo
    // solo, una o dos letras sueltas ("ok", "A"), o algo que no se entiende,
    // recibe el saludo con el menú.
    const firstText = normalizeText(message.text);
    if (firstText && (firstText.length > 2 || /\d/.test(firstText)) && !isGreetingOnly(message.text)) {
      const reply = await this.dispatch(session, message);
      if (reply.reset) return reply;
      const volvioAlMenu = session.state === start && reply.rich?.some((r) => r.kind === "buttons");
      if (!volvioAlMenu) {
        return {
          ...reply,
          messages: [greeting, ...reply.messages],
          rich: [{ kind: "image", caption: greeting }, ...(reply.rich ?? reply.messages.map((text) => ({ kind: "text" as const, text })))],
        };
      }
      session.state = start;
    }

    const entry = await getHandler(start).enter(ctx);
    const [first, ...rest] = entry;
    const messages = [`${greeting}\n\n${first ?? ""}`.trim(), ...rest];

    // Versión enriquecida del saludo: la foto de Enri con el saludo como epígrafe
    // y, si el estado inicial es un menú, los botones.
    const rich: RichOutbound[] = [{ kind: "image", caption: greeting }];
    const menu = MENU_OF_STATE[start];
    const buttons = menu ? menuButtons(menu) : [];
    if (buttons.length > 0) {
      rich.push({ kind: "buttons", text: BUTTONS_BODY, buttons });
    } else {
      for (const text of entry) rich.push({ kind: "text", text });
    }
    return { messages, rich };
  }

  private async dispatch(session: Session, message: IncomingMessage): Promise<BotReply> {
    const ctx = { session, message, services: this.deps.services };

    const command = detectGlobalCommand(message.text);
    switch (command) {
      case "MAIN_MENU":
        return this.transition(session, message, startState());
      case "BACK": {
        // Si el menú principal está salteado (una sola opción), "volver" no debe caer en él.
        const parent = PARENT_STATE[session.state];
        return this.transition(session, message, parent === BotState.MAIN_MENU ? startState() : parent);
      }
      case "HELP":
        return { messages: [helpText(this.deps.services.config.HANDOFF_ENABLED)] };
      case "FINISH":
        // "Eso es todo, gracias": despedida y conversación cerrada (arranca de cero la próxima).
        return { messages: [FAREWELL_MESSAGE], reset: true };
      case "HANDOFF": {
        const { config, now } = this.deps.services;
        if (!config.HANDOFF_ENABLED) {
          // Modo completamente automático: no se deriva; se le explica y se sigue ayudando.
          return { messages: [AUTOMATIC_ONLY_MESSAGE] };
        }
        session.handedOffUntil = new Date(now().getTime() + config.HANDOFF_SILENCE_MINUTES * 60_000).toISOString();
        return { messages: [HANDOFF_MESSAGE], handoff: true };
      }
    }

    const handler = getHandler(session.state);
    const result = await handler.handle(ctx);

    if (result.nextState && result.nextState !== session.state) {
      if (result.skipEnter) {
        session.state = result.nextState;
        return { messages: result.messages, handoff: result.handoff };
      }
      return this.transition(session, message, result.nextState, result.messages);
    }
    if (result.nextState === session.state && !result.skipEnter) {
      // Mismo estado pero pidieron re-entrar (por ejemplo, volver a mostrar el
      // menú tras un mensaje no entendido): con transition salen los botones.
      return this.transition(session, message, result.nextState, result.messages);
    }
    return { messages: result.messages, handoff: result.handoff };
  }

  private async transition(session: Session, message: IncomingMessage, nextState: BotStateName, before: string[] = []): Promise<BotReply> {
    // El menú principal salteado nunca se muestra: redirigir al inicio real.
    if (nextState === BotState.MAIN_MENU && startState() !== BotState.MAIN_MENU) {
      nextState = startState();
    }
    session.state = nextState;
    const entry = await getHandler(nextState).enter({ session, message, services: this.deps.services });
    const messages = [...before, ...entry];

    // Si el destino es un menú con botones, armar la versión enriquecida
    // (texto previo + mensaje con botones). El texto plano queda de respaldo.
    const menu = MENU_OF_STATE[nextState];
    const buttons = menu ? menuButtons(menu) : [];
    if (buttons.length > 0) {
      // Un aviso corto ("No entendí...", "No proceso fotos...") va en el MISMO
      // mensaje que los botones; uno largo, en su propio mensaje antes.
      const intro = before.join("\n\n");
      if (intro && intro.length + BUTTONS_NOTE.length <= 1000) {
        return { messages, rich: [{ kind: "buttons", text: `${intro}\n\n${BUTTONS_NOTE}`, buttons }] };
      }
      const rich: RichOutbound[] = before.map((text) => ({ kind: "text", text }));
      rich.push({ kind: "buttons", text: BUTTONS_BODY, buttons });
      return { messages, rich };
    }
    return { messages };
  }

  /**
   * Busca el nombre del chofer por su teléfono en SeaLink (endpoint del anexo,
   * sólo lectura) para saludarlo por el nombre. Si falla o no existe, el saludo
   * queda genérico: nunca bloquea la conversación.
   */
  private async identifyContact(session: Session, message: IncomingMessage): Promise<void> {
    const { services } = this.deps;
    const phone = message.sender?.phone?.trim();
    if (!phone) return;
    try {
      const lookup = await services.sealink.consultarChoferPorTelefono(phone);
      if (lookup.found) {
        const displayName = nombreCompleto(lookup.razonSocial);
        session.contact = { ...session.contact, phone, displayName: displayName || undefined };
        services.logger.info({ conversationId: session.conversationId, displayName }, "Contacto identificado por teléfono en SeaLink");
      }
    } catch (err) {
      services.logger.warn({ err, conversationId: session.conversationId }, "No se pudo identificar el contacto por teléfono (saludo genérico)");
    }
  }

  private newSession(conversationId: string, accountId: string, contact?: IncomingMessage["sender"]): Session {
    const ts = this.deps.services.now().toISOString();
    return {
      conversationId,
      accountId,
      state: BotState.MAIN_MENU,
      context: {},
      history: [],
      handedOffUntil: null,
      contact,
      createdAt: ts,
      updatedAt: ts,
    };
  }
}
