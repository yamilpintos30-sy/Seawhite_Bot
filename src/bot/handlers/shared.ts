/** Helpers compartidos por los handlers que usan IA. */
import { downloadAttachments } from "../../ai/attachments.js";
import { AiUnavailableError } from "../../ai/claudeService.js";
import type { AiMode } from "../../ai/types.js";
import { formatIso, todayInTimeZone } from "../../utils/dates.js";
import { dailyLimits } from "../../utils/rateLimiter.js";
import { toWhatsAppFormat } from "../../utils/text.js";
import { startState } from "../menus.js";
import type { HandlerContext, HandlerResult } from "../types.js";

export const LIMITE_DIARIO_IA =
  "Llegamos al límite de consultas por hoy para este chat 😅. Mañana podemos seguir. Si tu consulta es urgente, comunicate directamente con SEA WHITE.";

export const LIMITE_DIARIO_CONSULTAS =
  "Llegamos al límite de consultas de vencimientos por hoy para este chat 😅. Mañana podés volver a consultar. Si es urgente, comunicate directamente con SEA WHITE.";

/** Día calendario actual (zona horaria del bot) como clave del límite diario. */
export function dayKey(ctx: HandlerContext): string {
  return formatIso(todayInTimeZone(ctx.services.config.TIMEZONE, ctx.services.now()));
}

/** true si esta conversación todavía tiene cupo de consultas SeaLink por hoy. */
export function withinLookupLimit(ctx: HandlerContext): boolean {
  const ok = dailyLimits.hit(`lookup:${ctx.session.conversationId}`, ctx.services.config.DAILY_LOOKUP_LIMIT, dayKey(ctx));
  if (!ok) ctx.services.logger.warn({ conversationId: ctx.session.conversationId }, "Límite diario de consultas SeaLink alcanzado");
  return ok;
}

export const NOT_UNDERSTOOD_MESSAGE = "No entendí tu mensaje 🤔. Elegí una opción, o escribime tu consulta con tus palabras 👇";

export const NUMBER_NOT_UNDERSTOOD_MESSAGE =
  "No reconocí ese número 🤔. Si es un DNI, escribilo completo: 7 u 8 números, sin puntos. Si no, elegí una opción 👇";

/** Lo que responde la IA cuando el mensaje es ininteligible (ver regla en prompts.ts). */
const NOT_UNDERSTOOD_MARKER = /\[\[\s*NO_ENTENDI\s*\]\]/;

/** Mensaje no entendido: se muestra el menú real con botones, nunca uno escrito por la IA. */
function notUnderstood(text: string): HandlerResult {
  return { messages: [text], nextState: startState() };
}

/**
 * Llama a la IA con el mensaje actual, mantiene el historial corto de la sesión
 * y devuelve la respuesta ya formateada para WhatsApp.
 */
export async function answerWithAi(ctx: HandlerContext, mode: AiMode, data?: Record<string, unknown>): Promise<HandlerResult> {
  const { session, message, services } = ctx;

  // Las fotos y PDF se le mandan a la IA para que los lea (carnet, póliza,
  // captura del error de la página). Un mensaje sin texto NI adjuntos no tiene
  // nada que responder.
  if (!message.text.trim() && message.attachments.length === 0) {
    return { messages: ["Contame por escrito tu consulta y te ayudo."] };
  }

  // Sin una sola letra ("123", "123456", "?!") y SIN charla previa: no es una
  // consulta ni vale una llamada a la IA (respondía algo genérico que parecía la
  // opción 1). Con charla previa sí va a la IA: puede ser la respuesta a lo que
  // se venía hablando (p. ej. el teléfono que la página no le toma).
  if (!/\p{L}/u.test(message.text) && session.history.length === 0 && message.attachments.length === 0) {
    return notUnderstood(/\d/.test(message.text) ? NUMBER_NOT_UNDERSTOOD_MESSAGE : NOT_UNDERSTOOD_MESSAGE);
  }

  // Límite diario de respuestas con IA por conversación (anti-abuso).
  if (!dailyLimits.hit(`ai:${session.conversationId}`, services.config.DAILY_AI_LIMIT, dayKey(ctx))) {
    services.logger.warn({ conversationId: session.conversationId }, "Límite diario de IA alcanzado");
    return { messages: [LIMITE_DIARIO_IA] };
  }

  // Recorte defensivo de mensajes larguísimos (pegadas de texto, spam).
  const userText = message.text.length > services.config.AI_MAX_INPUT_CHARS ? message.text.slice(0, services.config.AI_MAX_INPUT_CHARS) : message.text;

  // Fotos/PDF del usuario: se descargan de Chatwoot y se le pasan a la IA. Los
  // que no se pueden leer (audios, formatos raros) devuelven un aviso.
  const { attachments, warnings } = message.attachments.length > 0 ? await downloadAttachments(message.attachments, services.logger) : { attachments: [], warnings: [] };

  try {
    const result = await services.ai.answer({
      mode,
      history: session.history,
      userText,
      attachments,
      data,
    });

    if (NOT_UNDERSTOOD_MARKER.test(result.text)) {
      services.logger.info({ conversationId: session.conversationId, mode }, "Mensaje no entendido por la IA; se muestra el menú");
      return notUnderstood(NOT_UNDERSTOOD_MESSAGE);
    }

    // En el historial queda el texto (los adjuntos no se guardan: pesan y no se
    // pueden persistir), con una marca de que había archivos.
    pushHistory(ctx, "user", attachments.length > 0 ? `${message.text.trim()} [el usuario adjuntó ${attachments.length} archivo(s)]`.trim() : message.text.trim());
    pushHistory(ctx, "assistant", result.text);

    if (result.usage) {
      services.logger.info({ conversationId: session.conversationId, mode, adjuntos: attachments.length, usage: result.usage }, "Consulta respondida con IA");
    }
    return { messages: [...warnings, toWhatsAppFormat(result.text)] };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      services.logger.error({ err: err.message, conversationId: session.conversationId }, "IA no disponible");
      return { messages: [...warnings, err.userMessage] };
    }
    throw err;
  }
}

function pushHistory(ctx: HandlerContext, role: "user" | "assistant", content: string): void {
  const max = ctx.services.config.HISTORY_MAX_TURNS * 2;
  ctx.session.history.push({ role, content });
  if (ctx.session.history.length > max) {
    ctx.session.history.splice(0, ctx.session.history.length - max);
  }
}
