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

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "seawhite-whatsapp-bot", time: new Date().toISOString() });
  });

  app.use(createChatwootWebhookRouter(deps));

  // Panel web: sólo si hay contraseña configurada.
  if (deps.admin && deps.config.ADMIN_PASSWORD) {
    app.use(createAdminRouter({ ...deps.admin, config: deps.config, logger: deps.logger }));
    deps.logger.info("Panel web disponible en /panel");
  } else {
    deps.logger.info("Panel web desactivado (falta ADMIN_PASSWORD)");
  }

  return app;
}
