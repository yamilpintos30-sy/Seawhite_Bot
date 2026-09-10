/**
 * Traduce el payload crudo de Chatwoot a los eventos que entiende el bot.
 *
 * Clasificación (esquema probado en producción por el BOT MIAMI):
 *   - message_created + incoming (o 0)          -> mensaje del CLIENTE.
 *     No se exige sender.type === "contact": según canal/versión, Chatwoot
 *     no siempre lo puebla, y un incoming es siempre del cliente.
 *   - message_created + outgoing + agent_bot    -> eco del propio bot -> ignorar.
 *   - message_created + outgoing + otro sender  -> POSIBLE vendedor humano.
 *     Quien decide es el webhook con el anti-eco (sentTracker): si el texto
 *     coincide con un envío reciente del bot es eco; si no, es un humano y
 *     el bot debe callarse (handoff).
 *   - conversation_status_changed               -> para resetear/derivar.
 *   - todo lo demás                             -> ignorar.
 */
import type { IncomingMessage } from "../../bot/types.js";
import type { ChatwootAttachment, ChatwootWebhookPayload } from "./types.js";

export type ChatwootEvent =
  | { kind: "message"; message: IncomingMessage }
  /** Mensaje saliente que NO es del agent bot: puede ser un vendedor humano o el eco del propio bot. */
  | { kind: "agent_message"; conversationId: string; accountId: string; inboxId?: string; text: string; hasMedia: boolean }
  | { kind: "status_changed"; conversationId: string; accountId: string; status: string; assigneeName?: string }
  | { kind: "ignore"; reason: string };

/** inbox_id del evento (los webhooks de Chatwoot son a nivel cuenta). */
export function extractInboxId(payload: ChatwootWebhookPayload): string | undefined {
  const id = payload.conversation?.inbox_id ?? payload.inbox?.id;
  return id === undefined || id === null ? undefined : String(id);
}

/** URL descargable de un adjunto: Chatwoot no es consistente entre canales/versiones. */
function attachmentUrl(att: ChatwootAttachment): string {
  return att.data_url ?? att.file_url ?? att.thumb_url ?? att.url ?? "";
}

/** Adjuntos: pueden venir en `attachments` o en `content_attributes.attachments`. */
function collectAttachments(payload: ChatwootWebhookPayload): ChatwootAttachment[] {
  const direct = payload.attachments;
  if (Array.isArray(direct) && direct.length > 0) return direct;
  const nested = payload.content_attributes?.attachments;
  return Array.isArray(nested) ? nested : [];
}

function messageTypeRaw(payload: ChatwootWebhookPayload): "incoming" | "outgoing" | "" {
  const mt = payload.message_type;
  if (typeof mt === "string") {
    const s = mt.trim().toLowerCase();
    return s === "incoming" || s === "outgoing" ? s : "";
  }
  if (mt === 0) return "incoming";
  if (mt === 1) return "outgoing";
  return "";
}

export function parseChatwootWebhook(payload: ChatwootWebhookPayload): ChatwootEvent {
  const event = payload.event ?? "";

  if (event === "conversation_status_changed" || event === "conversation_updated") {
    const conversationId = payload.id ?? payload.conversation?.id;
    const status = payload.status ?? payload.conversation?.status;
    if (!conversationId || !status) return { kind: "ignore", reason: "status_changed sin id/estado" };
    return {
      kind: "status_changed",
      conversationId: String(conversationId),
      accountId: String(payload.account?.id ?? ""),
      status,
      assigneeName: payload.conversation?.meta?.assignee?.name ?? undefined,
    };
  }

  if (event !== "message_created") return { kind: "ignore", reason: `evento ${event || "desconocido"}` };
  if (payload.private) return { kind: "ignore", reason: "nota privada" };

  const conversationId = payload.conversation?.id;
  const accountId = payload.account?.id;
  if (!conversationId || !accountId) return { kind: "ignore", reason: "falta conversation.id o account.id" };

  const direction = messageTypeRaw(payload);
  const attachments = collectAttachments(payload)
    .map((a) => ({ url: attachmentUrl(a), fileType: a.file_type, contentType: a.content_type }))
    .filter((a) => a.url.length > 0);
  const text = (payload.content ?? "").trim();

  if (direction === "outgoing") {
    const senderType = (payload.sender?.type ?? "").trim().toLowerCase();
    if (senderType === "agent_bot") return { kind: "ignore", reason: "eco del agent bot" };
    // Saliente sin contenido (status update / read receipt / system): no es un vendedor.
    if (!text && attachments.length === 0) return { kind: "ignore", reason: "saliente sin contenido" };
    return {
      kind: "agent_message",
      conversationId: String(conversationId),
      accountId: String(accountId),
      inboxId: extractInboxId(payload),
      text,
      hasMedia: attachments.length > 0,
    };
  }

  if (direction !== "incoming") return { kind: "ignore", reason: "message_type desconocido" };
  if (!text && attachments.length === 0) return { kind: "ignore", reason: "mensaje vacío" };

  // Identidad del CLIENTE: conversation.meta.sender es estable en ambas
  // direcciones; payload.sender sólo es el cliente en mensajes entrantes.
  const contact = payload.conversation?.meta?.sender ?? payload.sender;

  return {
    kind: "message",
    message: {
      id: String(payload.id ?? `${conversationId}-${Date.now()}`),
      conversationId: String(conversationId),
      accountId: String(accountId),
      text,
      attachments,
      sender: { name: contact?.name, phone: contact?.phone_number },
      conversationStatus: payload.conversation?.status,
    },
  };
}
