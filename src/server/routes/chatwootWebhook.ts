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
      // Saliente que no es del agent bot: ¿eco de un envío nuestro o vendedor humano?
      // El bot nunca manda media, así que un saliente con media es siempre humano.
      if (!parsed.hasMedia && sentTracker.wasRecentlySent(parsed.conversationId, parsed.text)) {
        logger.debug({ conversationId: parsed.conversationId }, "Eco del propio bot ignorado (anti-loop)");
        return;
      }
      logger.info({ conversationId: parsed.conversationId }, "Vendedor humano respondió: el bot se silencia (handoff)");
      engine
        .markHandedOff(parsed.conversationId, parsed.accountId)
        .catch((err) => logger.error({ err }, "Error marcando handoff por mensaje de agente"));
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

    handleMessage(message).catch((err) => logger.error({ err, conversationId: message.conversationId }, "Error procesando mensaje"));
  });

  async function handleMessage(message: Parameters<BotEngine["handle"]>[0]): Promise<void> {
    logger.info({ conversationId: message.conversationId, text: message.text.slice(0, 80), attachments: message.attachments.length }, "Mensaje entrante");
    const reply = await engine.handle(message);
    if (reply.rich && reply.rich.length > 0) {
      // Versión enriquecida: foto de Enri y/o botones interactivos.
      for (const [i, item] of reply.rich.entries()) {
        if (item.kind === "image") {
          await chatwoot.sendWelcomeImage(message.conversationId, item.caption);
          // La imagen se procesa en el camino a WhatsApp; sin esta pausa el
          // siguiente mensaje la pasa de largo y llega primero (desordenado).
          if (i < reply.rich.length - 1 && config.WELCOME_IMAGE_DELAY_MS > 0) {
            await new Promise((r) => setTimeout(r, config.WELCOME_IMAGE_DELAY_MS));
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
    if (reply.handoff && config.HANDOFF_STATUS !== "none") {
      await chatwoot.setStatus(message.conversationId, config.HANDOFF_STATUS).catch((err) => logger.error({ err }, "No se pudo cambiar el estado de la conversación"));
    }
  }

  async function handleStatusChanged(conversationId: string, accountId: string, status: string, assigneeName?: string): Promise<void> {
    logger.info({ conversationId, status, assigneeName }, "Cambio de estado de conversación");
    if (status === "resolved") {
      await engine.reset(conversationId);
    } else if (assigneeName) {
      // Un agente humano tomó la conversación: el bot se calla por un rato.
      await engine.markHandedOff(conversationId, accountId);
    }
  }

  return router;
}
