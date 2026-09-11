/**
 * Cliente mínimo de la API de Chatwoot: enviar mensajes (texto, imagen, botones)
 * y cambiar el estado de una conversación.
 * Docs: https://developers.chatwoot.com/api-reference
 *
 * Botones: `content_type: "input_select"`; en inboxes de WhatsApp Cloud, Chatwoot
 * los convierte en botones interactivos nativos (hasta 3).
 */
import { readFile } from "node:fs/promises";
import type { ButtonSpec } from "../../bot/types.js";
import type { Logger } from "../../utils/logger.js";
import { sentTracker } from "./sentTracker.js";

export interface ChatwootClientOptions {
  baseUrl: string;
  apiToken: string;
  accountId: number;
  logger: Logger;
  timeoutMs?: number;
  /** Ruta de la imagen de bienvenida (avatar de Enri). Si falta el archivo, se envía sólo texto. */
  welcomeImagePath?: string;
}

export class ChatwootClient {
  private welcomeImage: Buffer | null | undefined; // undefined = todavía no se intentó cargar

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

  /** Mensaje con botones interactivos (WhatsApp: hasta 3 botones de respuesta). */
  async sendButtons(conversationId: string, text: string, buttons: ButtonSpec[]): Promise<void> {
    sentTracker.record(conversationId, text);
    await this.request(`/conversations/${conversationId}/messages`, {
      content: text,
      content_type: "input_select",
      content_attributes: { items: buttons.map((b) => ({ title: b.title, value: b.payload })) },
      message_type: "outgoing",
      private: false,
    });
  }

  /** Imagen de bienvenida con epígrafe. Si la imagen no está disponible, cae a texto. */
  async sendWelcomeImage(conversationId: string, caption: string): Promise<void> {
    const image = await this.loadWelcomeImage();
    if (!image) {
      await this.sendMessage(conversationId, caption);
      return;
    }
    sentTracker.record(conversationId, caption);
    const form = new FormData();
    form.append("content", caption);
    form.append("message_type", "outgoing");
    form.append("attachments[]", new Blob([new Uint8Array(image)], { type: "image/png" }), "enri.png");
    await this.requestForm(`/conversations/${conversationId}/messages`, form);
  }

  private async loadWelcomeImage(): Promise<Buffer | null> {
    if (this.welcomeImage !== undefined) return this.welcomeImage;
    const path = this.opts.welcomeImagePath;
    if (!path) {
      this.welcomeImage = null;
      return null;
    }
    try {
      this.welcomeImage = await readFile(path);
    } catch (err) {
      this.opts.logger.warn({ err, path }, "No se pudo leer la imagen de bienvenida; se usará sólo texto");
      this.welcomeImage = null;
    }
    return this.welcomeImage;
  }

  async setStatus(conversationId: string, status: "open" | "pending" | "resolved"): Promise<void> {
    await this.request(`/conversations/${conversationId}/toggle_status`, { status });
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    return this.send(path, { "Content-Type": "application/json" }, JSON.stringify(body));
  }

  /** Envío multipart (adjuntos). No se setea Content-Type: lo arma FormData con su boundary. */
  private async requestForm(path: string, form: FormData): Promise<unknown> {
    return this.send(path, {}, form);
  }

  private async send(path: string, headers: Record<string, string>, body: string | FormData): Promise<unknown> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/api/v1/accounts/${this.opts.accountId}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...headers, api_access_token: this.opts.apiToken },
        body,
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
