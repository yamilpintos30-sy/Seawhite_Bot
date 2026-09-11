/**
 * Seguimientos por inactividad, contados desde la última respuesta del bot:
 *   - a los N1 min: "¿Necesitás algo más?"
 *   - a los N2 min: despedida ("Espero haberte sido útil...")
 *   - a los N3 min: se resetea la conversación (el próximo mensaje arranca con el saludo)
 * Cualquier mensaje nuevo del usuario cancela la cadena.
 * In-memory: un reinicio del proceso pierde los timers pendientes (aceptable:
 * son mensajes de cortesía, no lógica de negocio).
 */
import type { Logger } from "../utils/logger.js";

export const FOLLOWUP_ASK_TEXT = "¿Necesitás algo más? Escribí tu consulta o tocá el botón 🙂";
export const FOLLOWUP_BYE_TEXT = "Espero haberte sido útil 🙌 Cualquier otra consulta, escribime cuando quieras. ¡Que andes bien!";

export interface FollowupDeps {
  askMs: number;
  byeMs: number;
  resetMs: number;
  /** Envía el "¿necesitás algo más?" (el canal puede acompañarlo con el botón de menú). */
  sendAsk: (conversationId: string, text: string) => Promise<void>;
  /** Envía la despedida (texto plano). */
  sendBye: (conversationId: string, text: string) => Promise<void>;
  resetConversation: (conversationId: string) => Promise<void>;
  logger: Logger;
}

interface Chain {
  timers: NodeJS.Timeout[];
}

export class FollowupScheduler {
  private readonly chains = new Map<string, Chain>();

  constructor(private readonly deps: FollowupDeps) {}

  /** Arranca (o reinicia) la cadena de seguimientos para una conversación. */
  scheduleAfterReply(conversationId: string): void {
    this.cancel(conversationId);
    const { askMs, byeMs, resetMs, sendAsk, sendBye, resetConversation, logger } = this.deps;
    const timers: NodeJS.Timeout[] = [];

    if (askMs > 0) {
      timers.push(
        setTimeout(() => {
          sendAsk(conversationId, FOLLOWUP_ASK_TEXT).catch((err) => logger.warn({ err, conversationId }, "No se pudo enviar el seguimiento"));
        }, askMs),
      );
    }
    if (byeMs > 0) {
      timers.push(
        setTimeout(() => {
          sendBye(conversationId, FOLLOWUP_BYE_TEXT).catch((err) => logger.warn({ err, conversationId }, "No se pudo enviar la despedida"));
        }, byeMs),
      );
    }
    if (resetMs > 0) {
      timers.push(
        setTimeout(() => {
          this.chains.delete(conversationId);
          logger.info({ conversationId }, "Conversación reseteada por inactividad");
          resetConversation(conversationId).catch((err) => logger.warn({ err, conversationId }, "No se pudo resetear la conversación"));
        }, resetMs),
      );
    }

    if (timers.length > 0) this.chains.set(conversationId, { timers });
  }

  /** El usuario volvió a escribir: se cancela todo lo pendiente. */
  cancel(conversationId: string): void {
    const chain = this.chains.get(conversationId);
    if (!chain) return;
    for (const t of chain.timers) clearTimeout(t);
    this.chains.delete(conversationId);
  }
}
