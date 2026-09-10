/** Helpers compartidos por los handlers que usan IA. */
import { downloadAttachments } from "../../ai/attachments.js";
import { AiUnavailableError } from "../../ai/claudeService.js";
import type { AiMode } from "../../ai/types.js";
import { toWhatsAppFormat } from "../../utils/text.js";
import type { HandlerContext } from "../types.js";

export const HINT_NAVEGACION = "_Escribí *volver* para ir al menú anterior o *menu* para el menú principal._";

/**
 * Llama a la IA con el mensaje actual, mantiene el historial corto de la sesión
 * y devuelve las respuestas ya formateadas para WhatsApp.
 */
export async function answerWithAi(ctx: HandlerContext, mode: AiMode, data?: Record<string, unknown>): Promise<string[]> {
  const { session, message, services } = ctx;
  const { attachments, warnings } = await downloadAttachments(message.attachments, services.logger);

  if (!message.text.trim() && attachments.length === 0) {
    return warnings.length ? warnings : ["No recibí texto en tu mensaje. Contame tu consulta y te ayudo."];
  }

  try {
    const result = await services.ai.answer({
      mode,
      history: session.history,
      userText: message.text,
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
    return [...warnings, toWhatsAppFormat(result.text)];
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
