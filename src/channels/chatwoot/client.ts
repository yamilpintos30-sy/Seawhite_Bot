/**
 * Cliente mínimo de la API de Chatwoot: enviar mensajes y cambiar el estado de una conversación.
 * Docs: https://developers.chatwoot.com/api-reference
 */
import type { Logger } from "../../utils/logger.js";
import { sentTracker } from "./sentTracker.js";

export interface ChatwootClientOptions {
  baseUrl: string;
  apiToken: string;
  accountId: number;
  logger: Logger;
  timeoutMs?: number;
}

export class ChatwootClient {
  constructor(private readonly opts: ChatwootClientOptions) {}

  async sendMessage(conversationId: string, content: string): Promise<void> {
    // Anti-eco: registrar ANTES de enviar, así el webhook del eco (que puede
    // llegar casi instantáneo) ya encuentra el texto registrado.
    sentTracker.record(conversationId, content);
    await this.request(`/conversations/${conversationId}/messages`, {
      content,
      message_type: "outgoing",
      private: false,
    });
  }

  /** Envía varios mensajes en orden (uno por "burbuja" de WhatsApp). */
  async sendMessages(conversationId: string, contents: string[]): Promise<void> {
    for (const content of contents) {
      if (content.trim()) await this.sendMessage(conversationId, content);
    }
  }

  async setStatus(conversationId: string, status: "open" | "pending" | "resolved"): Promise<void> {
    await this.request(`/conversations/${conversationId}/toggle_status`, { status });
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/api/v1/accounts/${this.opts.accountId}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", api_access_token: this.opts.apiToken },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Chatwoot respondió HTTP ${res.status} en ${path}: ${text.slice(0, 300)}`);
      }
      return await res.json().catch(() => ({}));
    } catch (err) {
      this.opts.logger.error({ err, path }, "Error llamando a la API de Chatwoot");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
