/**
 * Motor del bot.
 *
 * Flujo por cada mensaje entrante:
 *   1. Cargar (o crear) la sesión de la conversación.
 *   2. Si la sesión expiró por inactividad -> volver al menú principal.
 *   3. Si una persona tomó la conversación -> no responder.
 *   4. Comandos globales (menu / volver / persona / ayuda).
 *   5. Delegar en el handler del estado actual.
 *   6. Si hubo cambio de estado -> mostrar la "entrada" del nuevo estado.
 *   7. Guardar la sesión y registrar los mensajes.
 *
 * Los mensajes de una misma conversación se procesan en orden (cola por conversación).
 */
import type { MessageLog } from "../storage/messageLog.js";
import type { SessionStore } from "../storage/sessionStore.js";
import { nombreDePila } from "../utils/names.js";
import { detectGlobalCommand, helpText } from "./commands.js";
import { getHandler, PARENT_STATE } from "./handlers/index.js";
import { welcomeLine } from "./handlers/menuHandlers.js";
import { startState } from "./menus.js";
import { BotState, type BotReply, type BotServices, type BotStateName, type IncomingMessage, type Session } from "./types.js";

const HANDOFF_MESSAGE = "Perfecto, le paso tu consulta a una persona del equipo de SEA WHITE para que te responda por acá. 🙌";
const AUTOMATIC_ONLY_MESSAGE =
  "Por acá la atención es automática, pero te puedo resolver casi todo yo 🤖. Contame tu consulta sobre la documentación, o escribí *menu* para ver las opciones.";
const GENERIC_ERROR = "Uy, tuve un problema para procesar tu mensaje. Probá de nuevo en un momento o escribí *menu* para volver al inicio.";

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
      reply = isNew ? await this.startConversation(session, message) : await this.dispatch(session, message);
    } catch (err) {
      logger.error({ err, conversationId: message.conversationId, state: session.state }, "Error procesando mensaje");
      reply = { messages: [GENERIC_ERROR] };
    }

    session.updatedAt = services.now().toISOString();
    await this.safeSaveSession(session);
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

    // Si el primer mensaje ya es una opción válida del menú inicial ("2", "chofer"), la respetamos.
    const result = await getHandler(start).handle(ctx);
    if (result.nextState && result.nextState !== start) {
      const reply = await this.transition(session, message, result.nextState);
      return { messages: [greeting, ...reply.messages] };
    }

    const entry = await getHandler(start).enter(ctx);
    const [first, ...rest] = entry;
    return { messages: [`${greeting}\n\n${first ?? ""}`.trim(), ...rest] };
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
      // Mismo estado pero pidieron re-entrar (por ejemplo, volver a mostrar el menú).
      const entry = await handler.enter(ctx);
      return { messages: [...result.messages, ...entry], handoff: result.handoff };
    }
    return { messages: result.messages, handoff: result.handoff };
  }

  private async transition(session: Session, message: IncomingMessage, nextState: BotStateName, before: string[] = []): Promise<BotReply> {
    session.state = nextState;
    const entry = await getHandler(nextState).enter({ session, message, services: this.deps.services });
    return { messages: [...before, ...entry] };
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
        const displayName = nombreDePila(lookup.razonSocial);
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
