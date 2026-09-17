/** Construcción de la app Express (separada de `index.ts` para poder testearla). */
import express, { type Express } from "express";
import { createAdminRouter, type AdminDeps } from "../admin/router.js";
import { createChatwootWebhookRouter, type WebhookDeps } from "./routes/chatwootWebhook.js";

export function createApp(deps: WebhookDeps & { admin?: Omit<AdminDeps, "config" | "logger"> }): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  // El contexto que se sube desde el panel puede pesar varios cientos de KB.
  app.use(express.json({ limit: "2mb" }));

  const panelActivo = Boolean(deps.admin && deps.config.ADMIN_PASSWORD);

  // La raíz no tiene contenido propio: quien entra a mano busca el panel.
  app.get("/", (_req, res) => {
    if (panelActivo) res.redirect("/panel/");
    else res.type("html").send("<h1>Bot de WhatsApp SEA WHITE</h1><p>El servicio está funcionando. El panel se publica al cargar <code>ADMIN_PASSWORD</code>.</p>");
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "seawhite-whatsapp-bot", panel: panelActivo, time: new Date().toISOString() });
  });

  app.use(createChatwootWebhookRouter(deps));

  // Panel web: sólo si hay contraseña configurada. Si no la hay, /panel explica
  // qué falta (antes respondía un "Cannot GET /panel" que no decía nada).
  if (panelActivo) {
    app.use(createAdminRouter({ ...deps.admin!, config: deps.config, logger: deps.logger }));
    deps.logger.info("Panel web disponible en /panel");
  } else {
    deps.logger.warn("Panel web desactivado: falta la variable de entorno ADMIN_PASSWORD");
    app.use("/panel", (_req, res) => {
      res
        .status(503)
        .type("html")
        .send(
          "<h1>Panel desactivado</h1><p>Para publicarlo, cargá la variable de entorno <code>ADMIN_PASSWORD</code> (mínimo 8 caracteres) en el servicio de Render y esperá el reinicio.</p>",
        );
    });
  }

  return app;
}
