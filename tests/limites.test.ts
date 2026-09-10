/**
 * Límites diarios por conversación (anti-abuso): cortan la IA y las consultas
 * SeaLink cuando un mismo chat excede el cupo del día; al día siguiente se renueva.
 */
import { beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import type { AiAnswerInput, AiService } from "../src/ai/types.js";
import { BotEngine } from "../src/bot/engine.js";
import type { BotServices } from "../src/bot/types.js";
import { loadConfig } from "../src/config.js";
import { FakeSeaLink } from "../src/integrations/sealink/fake.js";
import { MemorySessionStore } from "../src/storage/memorySessionStore.js";
import { DailyRateLimiter, dailyLimits } from "../src/utils/rateLimiter.js";

describe("DailyRateLimiter", () => {
  it("permite hasta el límite y corta después", () => {
    const l = new DailyRateLimiter();
    expect(l.hit("a", 2, "2026-09-10")).toBe(true);
    expect(l.hit("a", 2, "2026-09-10")).toBe(true);
    expect(l.hit("a", 2, "2026-09-10")).toBe(false);
    // Otra conversación tiene su propio cupo.
    expect(l.hit("b", 2, "2026-09-10")).toBe(true);
  });

  it("se renueva al cambiar el día", () => {
    const l = new DailyRateLimiter();
    expect(l.hit("a", 1, "2026-09-10")).toBe(true);
    expect(l.hit("a", 1, "2026-09-10")).toBe(false);
    expect(l.hit("a", 1, "2026-09-11")).toBe(true);
  });

  it("límite 0 = sin límite", () => {
    const l = new DailyRateLimiter();
    for (let i = 0; i < 100; i++) expect(l.hit("a", 0, "d")).toBe(true);
  });
});

describe("Límites en el bot", () => {
  const fakeAi: AiService = { answer: async (i: AiAnswerInput) => ({ text: `IA: ${i.userText}` }) };

  beforeEach(() => dailyLimits.clear());

  function setup(limits: { ai?: string; lookup?: string } = {}) {
    const config = loadConfig({
      CHATWOOT_API_TOKEN: "t",
      CHATWOOT_ACCOUNT_ID: "1",
      WEBHOOK_SECRET: "secret-de-test",
      ANTHROPIC_API_KEY: "k",
      SEALINK_EMAIL: "e",
      SEALINK_PASSWORD: "p",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      DAILY_AI_LIMIT: limits.ai ?? "30",
      DAILY_LOOKUP_LIMIT: limits.lookup ?? "30",
    });
    const services: BotServices = { ai: fakeAi, sealink: new FakeSeaLink(), config, logger: pino({ level: "silent" }), now: () => new Date("2026-09-10T15:00:00Z") };
    const engine = new BotEngine({ services, sessions: new MemorySessionStore() });
    let n = 0;
    const send = (text: string, conversationId = "L1") => engine.handle({ id: String(++n), conversationId, accountId: "1", text, attachments: [] });
    return { send };
  }

  it("corta las respuestas con IA al superar DAILY_AI_LIMIT", async () => {
    const t = setup({ ai: "2" });
    await t.send("A");
    await t.send("1");
    expect((await t.send("pregunta 1")).messages[0]).toContain("IA:");
    expect((await t.send("pregunta 2")).messages[0]).toContain("IA:");
    const limited = await t.send("pregunta 3");
    expect(limited.messages[0]).toContain("límite de consultas por hoy");
    // El menú sigue funcionando aunque la IA esté cortada.
    expect((await t.send("menu")).messages.join("\n")).toContain("¿Usted desea consultar por?");
  });

  it("corta las consultas SeaLink al superar DAILY_LOOKUP_LIMIT", async () => {
    const t = setup({ lookup: "1" });
    await t.send("A");
    await t.send("2");
    expect((await t.send("35413889")).messages.join("\n")).toContain("PEREZ JUAN");
    const limited = await t.send("28885090");
    expect(limited.messages[0]).toContain("límite de consultas de vencimientos");
  });

  it("el límite es por conversación: otro chat no queda afectado", async () => {
    const t = setup({ ai: "1" });
    await t.send("A", "L1");
    await t.send("1", "L1");
    await t.send("pregunta", "L1");
    expect((await t.send("otra", "L1")).messages[0]).toContain("límite");

    await t.send("A", "L2");
    await t.send("1", "L2");
    expect((await t.send("pregunta", "L2")).messages[0]).toContain("IA:");
  });
});
