/**
 * Forma (parcial) del payload que Chatwoot envía a los webhooks.
 * Sólo tipamos lo que usamos. Referencia: https://developers.chatwoot.com/docs/product/others/webhooks
 * Los campos "alternativos" (file_url/thumb_url/url, content_attributes.attachments)
 * existen porque Chatwoot no es consistente entre canales y versiones.
 */

export interface ChatwootAttachment {
  id?: number;
  file_type?: string; // "image" | "file" | "audio" | "video" | "story_mention" | "ig_reel" | ...
  data_url?: string;
  file_url?: string;
  thumb_url?: string;
  url?: string;
  content_type?: string;
}

export interface ChatwootContact {
  id?: number;
  name?: string;
  phone_number?: string;
  type?: string; // "contact" | "user" | "agent_bot"
  additional_attributes?: { username?: string };
}

export interface ChatwootWebhookPayload {
  event?: string; // "message_created" | "conversation_status_changed" | ...
  id?: number;
  content?: string | null;
  message_type?: "incoming" | "outgoing" | "activity" | "template" | number;
  content_type?: string;
  content_attributes?: { attachments?: ChatwootAttachment[] } & Record<string, unknown>;
  private?: boolean;
  attachments?: ChatwootAttachment[];
  sender?: ChatwootContact;
  conversation?: {
    id?: number;
    status?: string; // "open" | "pending" | "resolved" | "snoozed"
    inbox_id?: number;
    channel?: string;
    meta?: {
      assignee?: { id?: number; name?: string } | null;
      /** El CONTACTO de la conversación: estable aunque el mensaje sea saliente. */
      sender?: ChatwootContact | null;
    };
  };
  account?: { id?: number; name?: string };
  inbox?: { id?: number; name?: string };
  // Para conversation_status_changed, Chatwoot manda la conversación "aplanada".
  status?: string;
}
