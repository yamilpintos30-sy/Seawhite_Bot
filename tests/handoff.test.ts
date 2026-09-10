/**
 * Handoff estilo BOT MIAMI: anti-eco de envíos propios y reactivación por el cliente.
 */
import { describe, expect, it } from "vitest";
import pino from "pino";
import { SentTracker } from "../src/channels/chatwoot/sentTracker.js";
import { BotEngine } from "../src/bot/engine.js";
import { BotState, type BotServices } from "../src/bot/types.js";
import { loadConfig } from "../src/config.js";
import { FakeSeaLink } from "../src/integrations/sealink/fake.js";
import { MemorySessionStore } from "../src/storage/memorySessionStore.js";
import type { AiService } from "../src/ai/types.js";

describe("SentTracker (anti-eco)", () => {
  it("reconoce el eco exacto de lo que el bot envió", () => {
    const t = new SentTracker(() => 1000);
    t.record("c1", "Hola! ¿En qué te puedo ayudar?");
    expect(t.wasRecentlySent("c1", "hola!  ¿en qué te puedo ayudar?")).toBe(true);
    expect(t.wasRecentlySent("c2", "Hola! ¿En qué te puedo ayudar?")).toBe(false);
  });

  it("NO confunde a un vendedor que comparte una palabra corta con el bot", () => {
    const t = new SentTracker(() => 1000);
    t.record("c1", "Dale");
    // El vendedor escribe algo que CONTIENE "dale": no es eco (texto del bot < 15 chars).
    expect(t.wasRecentlySent("c1", "Dale, te ayudo yo con eso")).toBe(false);
    // Pero el eco exacto sí se reconoce.
    expect(t.wasRecentlySent("c1", "dale")).toBe(true);
  });

  it("tolera prefijo/sufijo del proveedor sólo con texto sustancial", () => {
    const t = new SentTracker(() => 1000);
    t.record("c1", "Encontré la documentación del dominio AA006QS");
    expect(t.wasRecentlySent("c1", "Encontré la documentación del dominio AA006QS ✓")).toBe(true);
  });

  it("olvida los envíos fuera de la ventana de tiempo", () => {
    let now = 1000;
    const t = new SentTracker(() => now);
    t.record("c1", "mensaje del bot con texto largo");
    now += 200_000; // > 180s
    expect(t.wasRecentlySent("c1", "mensaje del bot con texto largo")).toBe(false);
  });
});

describe("BotEngine — reactivación durante handoff", () => {
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

  function setup() {
    const sessions = new MemorySessionStore();
    const services: BotServices = { ai: fakeAi, sealink: new FakeSeaLink(), config, logger: pino({ level: "silent" }), now: () => new Date("2026-08-26T15:00:00Z") };
    const engine = new BotEngine({ services, sessions });
    let n = 0;
    const send = (text: string) => engine.handle({ id: String(++n), conversationId: "h1", accountId: "1", text, attachments: [] });
    return { engine, sessions, send };
  }

  it("markHandedOff silencia al bot y '/bot' lo despierta al menú principal", async () => {
    const t = setup();
    await t.send("hola");
    await t.engine.markHandedOff("h1", "1");

    expect((await t.send("¿estás ahí?")).messages).toEqual([]);

    const wake = await t.send("/bot");
    expect(wake.messages.join("\n")).toContain("¿Usted desea consultar por?");
    expect((await t.sessions.get("h1"))?.state).toBe(BotState.MAIN_MENU);
    expect((await t.sessions.get("h1"))?.handedOffUntil).toBeNull();

    // Después de despertar, responde normal.
    const next = await t.send("A");
    expect(next.messages.join("\n")).toContain("BALANZA");
  });

  it("una frase cualquiera que menciona 'bot' NO despierta al bot", async () => {
    const t = setup();
    await t.send("hola");
    await t.engine.markHandedOff("h1", "1");
    expect((await t.send("el bot no me sirvió")).messages).toEqual([]);
  });
});
