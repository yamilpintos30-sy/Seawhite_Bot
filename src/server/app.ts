/** Construcción de la app Express (separada de `index.ts` para poder testearla). */
import path from "node:path";
import express, { type Express } from "express";
import { createChatwootWebhookRouter, type WebhookDeps } from "./routes/chatwootWebhook.js";

export function createApp(deps: WebhookDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: "2mb" }));

  // Archivos públicos del bot (la imagen de Enri para el saludo tipo "card").
  // Sólo lectura y sólo lo que está en assets/.
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets"), { maxAge: "1d" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "seawhite-whatsapp-bot", time: new Date().toISOString() });
  });

  app.use(createChatwootWebhookRouter(deps));

  return app;
}
