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
  private profileId: string | null | undefined; // id del usuario dueño del token (= el bot)

  constructor(private readonly opts: ChatwootClientOptions) {}

  /**
   * Id del usuario de Chatwoot dueño del token (el "usuario bot"). Todo mensaje
   * saliente de ese usuario es un eco de este bot, NUNCA un vendedor humano.
   * Es la señal anti-eco infalible: sobrevive reinicios (el texto cacheado no).
   */
  async getProfileId(): Promise<string | null> {
    if (this.profileId !== undefined) return this.profileId;
    try {
      const url = `${this.opts.baseUrl.replace(/\/$/, "")}/api/v1/profile`;
      const res = await fetch(url, { headers: { api_access_token: this.opts.apiToken } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { id?: number };
      this.profileId = data.id !== undefined ? String(data.id) : null;
      this.opts.logger.info({ profileId: this.profileId }, "Usuario del bot en Chatwoot identificado (anti-eco)");
    } catch (err) {
      this.opts.logger.warn({ err }, "No se pudo obtener el perfil del bot en Chatwoot; anti-eco sólo por texto");
      this.profileId = null;
    }
    return this.profileId;
  }

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

  /**
   * EXPERIMENTAL: tarjeta única (imagen + texto + botones) vía content_type
   * "cards". Documentado por Chatwoot para Facebook; en WhatsApp depende de la
   * versión. El caller debe tener un plan B si esto lanza error.
   */
  async sendWelcomeCard(conversationId: string, caption: string, buttons: ButtonSpec[], mediaUrl: string): Promise<void> {
    sentTracker.record(conversationId, caption);
    await this.request(`/conversations/${conversationId}/messages`, {
      content: caption,
      content_type: "cards",
      content_attributes: {
        items: [
          {
            media_url: mediaUrl,
            title: "Enri ⚓",
            description: caption,
            actions: buttons.map((b) => ({ type: "postback", text: b.title, payload: b.payload })),
          },
        ],
      },
      message_type: "outgoing",
      private: false,
    });
  }

  /**
   * Imagen de bienvenida con epígrafe. Si la imagen no está disponible, cae a texto.
   * Devuelve el id del mensaje creado (para poder esperar su despacho) o null.
   */
  async sendWelcomeImage(conversationId: string, caption: string): Promise<string | null> {
    const image = await this.loadWelcomeImage();
    if (!image) {
      await this.sendMessage(conversationId, caption);
      return null;
    }
    sentTracker.record(conversationId, caption);
    const form = new FormData();
    form.append("content", caption);
    form.append("message_type", "outgoing");
    form.append("attachments[]", new Blob([new Uint8Array(image)], { type: "image/png" }), "enri.png");
    const created = (await this.requestForm(`/conversations/${conversationId}/messages`, form)) as { id?: number };
    return created?.id !== undefined ? String(created.id) : null;
  }

  /**
   * Espera a que WhatsApp confirme la ENTREGA del mensaje (status delivered/read).
   * Es la única garantía real de orden: "sent" solo significa que Chatwoot lo
   * despachó, pero Meta puede seguir procesando la imagen y entregarla después
   * que un mensaje posterior (visto en producción dos veces).
   * Devuelve el último estado observado ("timeout..." si venció el plazo).
   */
  async waitMessageDelivered(conversationId: string, messageId: string, timeoutMs = 15_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      try {
        const data = (await this.send(`/conversations/${conversationId}/messages`, {}, undefined, "GET")) as {
          payload?: Array<{ id?: number; status?: string }>;
        };
        const status = data?.payload?.find((m) => String(m.id) === messageId)?.status ?? "";
        if (status !== last) {
          this.opts.logger.info({ conversationId, messageId, status }, "Estado de la imagen del saludo");
          last = status;
        }
        if (status === "delivered" || status === "read" || status === "failed") return status;
      } catch (err) {
        this.opts.logger.warn({ err, conversationId }, "No se pudo consultar el estado del mensaje");
        return "unknown";
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    this.opts.logger.warn({ conversationId, messageId, last }, "La imagen del saludo no confirmó entrega dentro del plazo");
    return `timeout:${last || "sin-estado"}`;
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

  private async send(path: string, headers: Record<string, string>, body: string | FormData | undefined, method: "POST" | "GET" = "POST"): Promise<unknown> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/api/v1/accounts/${this.opts.accountId}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await fetch(url, {
        method,
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
