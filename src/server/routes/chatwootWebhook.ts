/**
 * Endpoint que recibe los webhooks de Chatwoot.
 *
 * Seguridad: Chatwoot no firma los webhooks, así que exigimos un token compartido
 * en la URL (`?token=...`) o en el header `x-webhook-token`.
 *
 * Respondemos 200 de inmediato y procesamos en segundo plano para no superar el
 * timeout de Chatwoot mientras esperamos a Claude o a SeaLink.
 */
import { Router, type Request, type Response } from "express";
import type { BotEngine } from "../../bot/engine.js";
import { ChatwootClient } from "../../channels/chatwoot/client.js";
import { extractInboxId, parseChatwootWebhook } from "../../channels/chatwoot/parseWebhook.js";
import { sentTracker } from "../../channels/chatwoot/sentTracker.js";
import type { ChatwootWebhookPayload } from "../../channels/chatwoot/types.js";
import { activeStatuses, type AppConfig } from "../../config.js";
import type { Logger } from "../../utils/logger.js";
import { splitForWhatsApp } from "../../utils/text.js";
import { MessageDebouncer } from "../debounce.js";
import { FollowupScheduler } from "../followups.js";

export interface WebhookDeps {
  config: AppConfig;
  engine: BotEngine;
  chatwoot: ChatwootClient;
  logger: Logger;
}

/** Evita procesar dos veces el mismo mensaje si Chatwoot reintenta el webhook. */
class RecentIds {
  private readonly ids = new Set<string>();
  constructor(private readonly max = 2000) {}
  seen(id: string): boolean {
    if (this.ids.has(id)) return true;
    this.ids.add(id);
    if (this.ids.size > this.max) {
      const first = this.ids.values().next().value;
      if (first !== undefined) this.ids.delete(first);
    }
    return false;
  }
}

export function createChatwootWebhookRouter(deps: WebhookDeps): Router {
  const { config, engine, chatwoot, logger } = deps;
  const router = Router();
  const recent = new RecentIds();
  const statuses = activeStatuses(config);

  // Buffer: juntar los mensajes del usuario y responder una sola vez.
  const debouncer = new MessageDebouncer(config.DEBOUNCE_SECONDS * 1000, (merged) => {
    handleMessage(merged).catch((err) => logger.error({ err, conversationId: merged.conversationId }, "Error procesando mensaje"));
  });

  // Seguimientos por inactividad (¿algo más? / despedida / reset).
  const followups = new FollowupScheduler({
    askMs: Math.round(config.FOLLOWUP_ASK_MINUTES * 60_000),
    byeMs: Math.round(config.FOLLOWUP_BYE_MINUTES * 60_000),
    resetMs: Math.round(config.FOLLOWUP_RESET_MINUTES * 60_000),
    sendText: (conversationId, text) => chatwoot.sendMessage(conversationId, text),
    resetConversation: async (conversationId) => {
      debouncer.clear(conversationId);
      await engine.reset(conversationId);
    },
    logger,
  });

  router.post("/webhooks/chatwoot", (req: Request, res: Response) => {
    const token = (req.query.token as string | undefined) ?? (req.header("x-webhook-token") ?? undefined);
    if (token !== config.WEBHOOK_SECRET) {
      logger.warn({ ip: req.ip }, "Webhook rechazado: token inválido");
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const payload = req.body as ChatwootWebhookPayload;
    res.status(200).json({ ok: true });

    // Filtro de inbox: los webhooks de Chatwoot son a nivel cuenta. Si hay
    // varios inboxes/bots en la misma cuenta, sólo procesamos el nuestro.
    const wantInbox = (config.CHATWOOT_INBOX_ID ?? "").trim();
    if (wantInbox) {
      const gotInbox = extractInboxId(payload);
      if (gotInbox && gotInbox !== wantInbox) {
        logger.debug({ gotInbox, wantInbox }, "Webhook ignorado: otro inbox");
        return;
      }
    }

    const parsed = parseChatwootWebhook(payload);

    if (parsed.kind === "ignore") {
      logger.debug({ reason: parsed.reason }, "Webhook ignorado");
      return;
    }

    if (parsed.kind === "agent_message") {
      handleAgentMessage(parsed).catch((err) => logger.error({ err }, "Error procesando mensaje de agente"));
      return;
    }

    if (parsed.kind === "status_changed") {
      handleStatusChanged(parsed.conversationId, parsed.accountId, parsed.status, parsed.assigneeName).catch((err) =>
        logger.error({ err }, "Error procesando cambio de estado"),
      );
      return;
    }

    const { message } = parsed;
    if (recent.seen(message.id)) {
      logger.debug({ id: message.id }, "Mensaje duplicado ignorado");
      return;
    }
    if (message.conversationStatus && !statuses.has(message.conversationStatus.toLowerCase())) {
      logger.debug({ status: message.conversationStatus }, "Conversación fuera de los estados activos del bot");
      return;
    }

    // El usuario escribió: se cancelan los seguimientos pendientes y el mensaje
    // entra al buffer (o se procesa al instante si es botón/comando/DNI/patente).
    followups.cancel(message.conversationId);
    debouncer.push(message);
  });

  async function handleMessage(message: Parameters<BotEngine["handle"]>[0]): Promise<void> {
    logger.info({ conversationId: message.conversationId, text: message.text.slice(0, 80), attachments: message.attachments.length }, "Mensaje entrante");
    const reply = await engine.handle(message);
    if (reply.rich && reply.rich.length > 0) {
      // EXPERIMENTO "card": saludo imagen+texto+botones en UN solo mensaje.
      // Si funciona, listo; si la API lo rechaza, seguimos con el formato split.
      if (await trySendAsCard(message.conversationId, reply.rich)) return await maybeHandoff(reply, message.conversationId);
      // Versión enriquecida: foto de Enri y/o botones interactivos.
      for (const [i, item] of reply.rich.entries()) {
        if (item.kind === "image") {
          const imageMessageId = await chatwoot.sendWelcomeImage(message.conversationId, item.caption);
          if (i < reply.rich.length - 1) {
            // Garantizar el orden imagen -> botones: esperar la confirmación de
            // ENTREGA de la imagen (delivered/read) antes del siguiente mensaje.
            if (imageMessageId) await chatwoot.waitMessageDelivered(message.conversationId, imageMessageId);
            if (config.WELCOME_IMAGE_DELAY_MS > 0) await new Promise((r) => setTimeout(r, config.WELCOME_IMAGE_DELAY_MS));
          }
        } else if (item.kind === "buttons") {
          await chatwoot.sendButtons(message.conversationId, item.text, item.buttons);
        } else {
          await chatwoot.sendMessages(message.conversationId, splitForWhatsApp(item.text));
        }
      }
    } else {
      const parts = reply.messages.flatMap((m) => splitForWhatsApp(m));
      await chatwoot.sendMessages(message.conversationId, parts);
    }
    await maybeHandoff(reply, message.conversationId);
    // Con la respuesta enviada, arranca la cadena de seguimientos por inactividad.
    if (!reply.handoff && (reply.messages.length > 0 || (reply.rich?.length ?? 0) > 0)) {
      followups.scheduleAfterReply(message.conversationId);
    }
  }

  async function maybeHandoff(reply: Awaited<ReturnType<BotEngine["handle"]>>, conversationId: string): Promise<void> {
    if (reply.handoff && config.HANDOFF_STATUS !== "none") {
      await chatwoot.setStatus(conversationId, config.HANDOFF_STATUS).catch((err) => logger.error({ err }, "No se pudo cambiar el estado de la conversación"));
    }
  }

  /**
   * Intenta el saludo como tarjeta única. Devuelve true si se envió (no hace
   * falta el split). Sólo aplica cuando el rich es exactamente imagen + botones,
   * el estilo es "card" y hay URL pública para servir la imagen.
   */
  async function trySendAsCard(conversationId: string, rich: NonNullable<Awaited<ReturnType<BotEngine["handle"]>>["rich"]>): Promise<boolean> {
    if (config.WELCOME_STYLE !== "card") return false;
    if (rich.length !== 2 || rich[0]?.kind !== "image" || rich[1]?.kind !== "buttons") return false;
    const publicBase = (config.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? "").replace(/\/$/, "");
    if (!publicBase) {
      logger.warn("WELCOME_STYLE=card pero no hay PUBLIC_URL/RENDER_EXTERNAL_URL; se usa el formato split");
      return false;
    }
    try {
      await chatwoot.sendWelcomeCard(conversationId, rich[0].caption, rich[1].buttons, `${publicBase}/assets/enri-marinero.png`);
      logger.info({ conversationId }, "Saludo enviado como card única (experimental)");
      return true;
    } catch (err) {
      logger.warn({ err, conversationId }, "La card experimental falló; se usa el formato split");
      return false;
    }
  }

  /**
   * Saliente que no es del agent bot: ¿eco de un envío nuestro o vendedor humano?
   * Señales de eco, en orden de confiabilidad:
   *   1. El remitente es el usuario dueño del token (= el bot). Sobrevive reinicios.
   *      OJO: los vendedores humanos deben usar SU PROPIO usuario de Chatwoot.
   *   2. El texto coincide con algo que este proceso envió hace poco (sentTracker).
   * El bot ahora también manda imágenes (el saludo), así que "tiene media" ya NO
   * significa humano: eso silenciaba al bot con el eco de su propia foto.
   */
  async function handleAgentMessage(parsed: Extract<ReturnType<typeof parseChatwootWebhook>, { kind: "agent_message" }>): Promise<void> {
    const botUserId = await chatwoot.getProfileId();
    if (botUserId && parsed.senderId === botUserId) {
      logger.debug({ conversationId: parsed.conversationId }, "Eco del propio bot ignorado (mismo usuario del token)");
      return;
    }
    if (sentTracker.wasRecentlySent(parsed.conversationId, parsed.text)) {
      logger.debug({ conversationId: parsed.conversationId }, "Eco del propio bot ignorado (texto reciente)");
      return;
    }
    logger.info({ conversationId: parsed.conversationId, senderId: parsed.senderId }, "Vendedor humano respondió: el bot se silencia (handoff)");
    followups.cancel(parsed.conversationId);
    debouncer.clear(parsed.conversationId);
    await engine.markHandedOff(parsed.conversationId, parsed.accountId);
  }

  async function handleStatusChanged(conversationId: string, accountId: string, status: string, assigneeName?: string): Promise<void> {
    logger.info({ conversationId, status, assigneeName }, "Cambio de estado de conversación");
    if (status === "resolved") {
      followups.cancel(conversationId);
      debouncer.clear(conversationId);
      await engine.reset(conversationId);
    } else if (assigneeName) {
      // Un agente humano tomó la conversación: el bot se calla por un rato.
      await engine.markHandedOff(conversationId, accountId);
    }
  }

  return router;
}
