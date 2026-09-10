/**
 * Anexo "Consulta de Chofer por Teléfono": al iniciar la conversación, el bot
 * busca el nombre por el teléfono del remitente y saluda por el nombre.
 */
import { describe, expect, it } from "vitest";
import pino from "pino";
import { BotEngine } from "../src/bot/engine.js";
import type { BotServices } from "../src/bot/types.js";
import { loadConfig } from "../src/config.js";
import { FakeSeaLink } from "../src/integrations/sealink/fake.js";
import { MemorySessionStore } from "../src/storage/memorySessionStore.js";
import { nombreDePila } from "../src/utils/names.js";
import type { AiService } from "../src/ai/types.js";

describe("nombreDePila", () => {
  it("extrae el nombre de 'APELLIDO, NOMBRE' y lo capitaliza", () => {
    expect(nombreDePila("PEDROL, JOEL")).toBe("Joel");
    expect(nombreDePila("SPINOLO, PEDRO LUIS")).toBe("Pedro");
    expect(nombreDePila("GOMEZ CARLOS")).toBe("Gomez"); // sin coma: primera palabra
    expect(nombreDePila("  ")).toBe("");
    expect(nombreDePila(null)).toBe("");
  });
});

describe("Saludo por nombre (teléfono → SeaLink)", () => {
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

  function engineWith(sealink = new FakeSeaLink()) {
    const services: BotServices = { ai: fakeAi, sealink, config, logger: pino({ level: "silent" }), now: () => new Date("2026-09-10T15:00:00Z") };
    return new BotEngine({ services, sessions: new MemorySessionStore() });
  }

  it("si el teléfono figura en SeaLink, saluda por el nombre", async () => {
    const engine = engineWith();
    const reply = await engine.handle({
      id: "1",
      conversationId: "s1",
      accountId: "1",
      text: "hola",
      attachments: [],
      sender: { name: "WhatsApp Name", phone: "+5492392526070" },
    });
    expect(reply.messages[0]).toContain("¡Hola, Juan! 👋"); // "PEREZ, JUAN" -> "Juan"
  });

  it("si el teléfono no figura, saludo genérico", async () => {
    const engine = engineWith();
    const reply = await engine.handle({
      id: "1",
      conversationId: "s2",
      accountId: "1",
      text: "hola",
      attachments: [],
      sender: { phone: "+5491100000000" },
    });
    expect(reply.messages[0]).toContain("¡Hola! 👋");
    expect(reply.messages[0]).not.toContain("¡Hola, ");
  });

  it("si SeaLink falla, el saludo genérico no se rompe", async () => {
    const broken = new FakeSeaLink();
    broken.consultarChoferPorTelefono = async () => {
      throw new Error("timeout");
    };
    const engine = engineWith(broken);
    const reply = await engine.handle({
      id: "1",
      conversationId: "s3",
      accountId: "1",
      text: "hola",
      attachments: [],
      sender: { phone: "+5492392526070" },
    });
    expect(reply.messages[0]).toContain("¡Hola! 👋");
  });

  it("sin teléfono (CLI/tests) no consulta y saluda genérico", async () => {
    const engine = engineWith();
    const reply = await engine.handle({ id: "1", conversationId: "s4", accountId: "1", text: "hola", attachments: [] });
    expect(reply.messages[0]).toContain("¡Hola! 👋");
  });
});
