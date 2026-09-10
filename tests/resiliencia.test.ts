/**
 * Resiliencia ante fallas del almacenamiento (visto en producción: un
 * SUPABASE_URL mal configurado tiraba abajo el proceso y el usuario no
 * recibía respuesta). Regla: Supabase roto => el bot responde igual.
 */
import { describe, expect, it } from "vitest";
import pino from "pino";
import { BotEngine } from "../src/bot/engine.js";
import type { BotServices, Session } from "../src/bot/types.js";
import { loadConfig } from "../src/config.js";
import { FakeSeaLink } from "../src/integrations/sealink/fake.js";
import type { SessionStore } from "../src/storage/sessionStore.js";
import type { AiService } from "../src/ai/types.js";

/** Simula el error real de producción (PGRST125). */
class BrokenSessionStore implements SessionStore {
  async get(): Promise<Session | null> {
    throw new Error("Supabase get session: Invalid path specified in request URL");
  }
  async save(): Promise<void> {
    throw new Error("Supabase save session: Invalid path specified in request URL");
  }
  async delete(): Promise<void> {
    throw new Error("Supabase delete session: Invalid path specified in request URL");
  }
}

describe("Resiliencia — Supabase roto", () => {
  const fakeAi: AiService = { answer: async (i) => ({ text: `IA: ${i.userText}` }) };
  const config = loadConfig({
    CHATWOOT_API_TOKEN: "t",
    CHATWOOT_ACCOUNT_ID: "1",
    WEBHOOK_SECRET: "secret-de-test",
    ANTHROPIC_API_KEY: "k",
    SEALINK_EMAIL: "e",
    SEALINK_PASSWORD: "p",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
  });

  it("el bot responde el menú aunque la sesión no se pueda leer ni guardar", async () => {
    const services: BotServices = {
      ai: fakeAi,
      sealink: new FakeSeaLink(),
      config,
      logger: pino({ level: "silent" }),
      now: () => new Date("2026-09-11T15:00:00Z"),
    };
    const engine = new BotEngine({ services, sessions: new BrokenSessionStore() });

    const reply = await engine.handle({ id: "1", conversationId: "r1", accountId: "1", text: "Hola!", attachments: [] });
    expect(reply.messages.join("\n")).toContain("¿Usted desea consultar por?");

    // Y no queda ninguna promesa suelta que reviente después.
    await new Promise((r) => setTimeout(r, 20));
  });

  it("markHandedOff tampoco lanza con el almacenamiento roto", async () => {
    const services: BotServices = {
      ai: fakeAi,
      sealink: new FakeSeaLink(),
      config,
      logger: pino({ level: "silent" }),
      now: () => new Date("2026-09-11T15:00:00Z"),
    };
    const engine = new BotEngine({ services, sessions: new BrokenSessionStore() });
    await expect(engine.markHandedOff("r1", "1")).resolves.toBeUndefined();
  });
});
