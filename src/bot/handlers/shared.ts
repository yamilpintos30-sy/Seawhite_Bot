/** Helpers compartidos por los handlers que usan IA. */
import { downloadAttachments } from "../../ai/attachments.js";
import { AiUnavailableError } from "../../ai/claudeService.js";
import type { AiMode } from "../../ai/types.js";
import { formatIso, todayInTimeZone } from "../../utils/dates.js";
import { dailyLimits } from "../../utils/rateLimiter.js";
import { toWhatsAppFormat } from "../../utils/text.js";
import type { HandlerContext } from "../types.js";

/** Cierre estándar de cada respuesta: corto e intuitivo. */
export const MENU_HINT = "_Escribí *menu* para ver las opciones._";

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

/**
 * Llama a la IA con el mensaje actual, mantiene el historial corto de la sesión
 * y devuelve las respuestas ya formateadas para WhatsApp.
 */
export async function answerWithAi(ctx: HandlerContext, mode: AiMode, data?: Record<string, unknown>): Promise<string[]> {
  const { session, message, services } = ctx;

  // Límite diario de respuestas con IA por conversación (anti-abuso).
  if (!dailyLimits.hit(`ai:${session.conversationId}`, services.config.DAILY_AI_LIMIT, dayKey(ctx))) {
    services.logger.warn({ conversationId: session.conversationId }, "Límite diario de IA alcanzado");
    return [LIMITE_DIARIO_IA];
  }

  const { attachments, warnings } = await downloadAttachments(message.attachments, services.logger);

  if (!message.text.trim() && attachments.length === 0) {
    return warnings.length ? warnings : ["No recibí texto en tu mensaje. Contame tu consulta y te ayudo."];
  }

  // Recorte defensivo de mensajes larguísimos (pegadas de texto, spam).
  const userText = message.text.length > services.config.AI_MAX_INPUT_CHARS ? message.text.slice(0, services.config.AI_MAX_INPUT_CHARS) : message.text;

  try {
    const result = await services.ai.answer({
      mode,
      history: session.history,
      userText,
      attachments,
      data,
    });

    const userTurn = message.text.trim() || "(envió un archivo)";
    const attachmentNote = attachments.length ? ` [adjuntó ${attachments.length} archivo(s)]` : "";
    pushHistory(ctx, "user", userTurn + attachmentNote);
    pushHistory(ctx, "assistant", result.text);

    if (result.usage) {
      services.logger.info({ conversationId: session.conversationId, mode, usage: result.usage }, "Consulta respondida con IA");
    }
    // Cada respuesta ofrece el camino de vuelta al menú (pedido del equipo).
    return [...warnings, `${toWhatsAppFormat(result.text)}\n\n${MENU_HINT}`];
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      services.logger.error({ err: err.message, conversationId: session.conversationId }, "IA no disponible");
      return [...warnings, err.userMessage];
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
