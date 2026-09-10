/** Punto de entrada: levanta el servidor HTTP que recibe los webhooks de Chatwoot. */
import { buildContainer } from "./container.js";
import { createApp } from "./server/app.js";

async function main(): Promise<void> {
  const container = buildContainer();
  const { config, logger, engine, chatwoot, knowledge } = container;

  // Red de seguridad: ninguna promesa perdida ni excepción suelta debe tumbar
  // el proceso entero (un bot caído es peor que un error logueado).
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Promesa sin capturar (unhandledRejection); el bot sigue");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Excepción no capturada (uncaughtException); el bot sigue");
  });

  // Cargar la base de conocimiento al inicio para detectar errores temprano.
  const kb = await knowledge.get();
  logger.info({ files: kb.files }, "Base de conocimiento lista");

  const app = createApp({ config, engine, chatwoot, logger });
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, model: config.CLAUDE_MODEL }, "Bot de WhatsApp SEA WHITE escuchando");
    logger.info(`Webhook: POST http://localhost:${config.PORT}/webhooks/chatwoot?token=<WEBHOOK_SECRET>`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Apagando...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
