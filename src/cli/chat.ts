/**
 * Simulador de consola: permite probar el bot sin WhatsApp ni Chatwoot.
 *
 *   npm run chat
 *
 * Usa Claude y SeaLink reales (según .env). Si querés probar sin SeaLink,
 * poné SEALINK_FAKE=1 y se usan los DNI/dominios de prueba del manual.
 */
import readline from "node:readline";
import { buildContainer } from "../container.js";
import { FakeSeaLink } from "../integrations/sealink/fake.js";
import { MemorySessionStore } from "../storage/memorySessionStore.js";
import { BotEngine } from "../bot/engine.js";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const config = loadConfig({
    // Valores de relleno para poder correr el simulador sin Chatwoot configurado.
    CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN ?? "cli",
    CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID ?? "1",
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET ?? "cli-secret",
    SEALINK_EMAIL: process.env.SEALINK_EMAIL ?? "fake",
    SEALINK_PASSWORD: process.env.SEALINK_PASSWORD ?? "fake",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
  });
  const container = buildContainer(config);

  const useFake = process.env.SEALINK_FAKE === "1" || process.env.SEALINK_EMAIL === undefined;
  const services = useFake ? { ...container.services, sealink: new FakeSeaLink() } : container.services;
  const engine = new BotEngine({ services, sessions: new MemorySessionStore() });

  console.log("=== Simulador del bot SEA WHITE ===");
  console.log(useFake ? "(SeaLink: datos de prueba falsos)" : "(SeaLink: API real)");
  console.log("Escribí un mensaje como si fueras el usuario. Ctrl+C para salir.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const conversationId = "cli-1";
  let counter = 0;

  const ask = () =>
    rl.question("Vos > ", async (line) => {
      const reply = await engine.handle({
        id: String(++counter),
        conversationId,
        accountId: "1",
        text: line,
        attachments: [],
        sender: { name: "Usuario CLI" },
      });
      for (const m of reply.messages) console.log(`\nBot > ${m}\n`);
      if (reply.handoff) console.log("[La conversación se derivaría a una persona]\n");
      ask();
    });

  ask();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
