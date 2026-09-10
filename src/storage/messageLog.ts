/**
 * Registro de mensajes (tabla `bot_messages`) para auditoría y para revisar qué
 * preguntan los usuarios y mejorar la base de conocimiento.
 * Nunca debe interrumpir la conversación: los errores sólo se loguean.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage } from "../bot/types.js";
import type { Logger } from "../utils/logger.js";

export interface MessageLog {
  logIncoming(message: IncomingMessage, state: string): Promise<void>;
  logOutgoing(message: IncomingMessage, replies: string[], state: string): Promise<void>;
}

export class SupabaseMessageLog implements MessageLog {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  async logIncoming(message: IncomingMessage, state: string): Promise<void> {
    await this.insert({
      conversation_id: message.conversationId,
      account_id: message.accountId,
      direction: "in",
      content: message.text,
      state,
      meta: {
        chatwoot_message_id: message.id,
        attachments: message.attachments.length,
        sender: message.sender ?? null,
      },
    });
  }

  async logOutgoing(message: IncomingMessage, replies: string[], state: string): Promise<void> {
    if (replies.length === 0) return;
    await this.insert({
      conversation_id: message.conversationId,
      account_id: message.accountId,
      direction: "out",
      content: replies.join("\n\n"),
      state,
      meta: { in_reply_to: message.id, parts: replies.length },
    });
  }

  private async insert(row: Record<string, unknown>): Promise<void> {
    const { error } = await this.client.from("bot_messages").insert(row);
    if (error) this.logger.warn({ error }, "No se pudo registrar el mensaje en Supabase");
  }
}

/** Implementación nula para cuando no hay Supabase. */
export class NoopMessageLog implements MessageLog {
  async logIncoming(): Promise<void> {}
  async logOutgoing(): Promise<void> {}
}
