/**
 * Tests del motor: navegación de menús, consulta de chofer/camión y comandos globales.
 * La IA y SeaLink se reemplazan por dobles para no depender de servicios externos.
 */
import { beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import type { AiAnswerInput, AiService } from "../src/ai/types.js";
import { BotEngine } from "../src/bot/engine.js";
import { BotState, type BotServices, type IncomingMessage } from "../src/bot/types.js";
import { loadConfig } from "../src/config.js";
import { FakeSeaLink } from "../src/integrations/sealink/fake.js";
import { MemorySessionStore } from "../src/storage/memorySessionStore.js";

class FakeAi implements AiService {
  calls: AiAnswerInput[] = [];
  async answer(input: AiAnswerInput) {
    this.calls.push({ ...input, history: [...input.history] });
    return { text: `IA(${input.mode}): ${input.userText}` };
  }
}

const config = loadConfig({
  CHATWOOT_API_TOKEN: "t",
  CHATWOOT_ACCOUNT_ID: "1",
  WEBHOOK_SECRET: "secret-de-test",
  ANTHROPIC_API_KEY: "k",
  SEALINK_EMAIL: "e",
  SEALINK_PASSWORD: "p",
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SESSION_TTL_MINUTES: "60",
});

function setup(now = new Date("2026-08-26T15:00:00Z")) {
  const ai = new FakeAi();
  const sessions = new MemorySessionStore();
  const services: BotServices = {
    ai,
    sealink: new FakeSeaLink(),
    config,
    logger: pino({ level: "silent" }),
    now: () => now,
  };
  const engine = new BotEngine({ services, sessions });
  let counter = 0;
  const send = (text: string, conversationId = "c1") =>
    engine.handle({ id: String(++counter), conversationId, accountId: "1", text, attachments: [] } satisfies IncomingMessage);
  return { engine, ai, sessions, send };
}

describe("BotEngine — menús", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("saluda y va directo al menú BALANZA (el principal se saltea con una sola opción)", async () => {
    const reply = await t.send("hola");
    const text = reply.messages.join("\n");
    expect(text).toContain("Soy *Enri*");
    expect(text).toContain("¿Qué necesitás?");
    expect(text).toContain("*1)* Carga de Documentación");
    expect(text).not.toContain("A definir");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.BALANZA_MENU);
  });

  it("si el primer mensaje ya es una opción válida, la toma (saludo incluido)", async () => {
    const reply = await t.send("2");
    const text = reply.messages.join("\n");
    expect(text).toContain("Soy *Enri*");
    expect(text).toContain("DNI del chofer");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.CHOFER_DNI);
  });

  it("el menú muestra las aclaraciones de cada opción", async () => {
    const reply = await t.send("hola");
    const text = reply.messages.join("\n");
    expect(text).toContain("página web");
    expect(text).toContain("con su DNI");
    expect(text).toContain("con su patente");
  });

  it("en el menú, una consulta que no es una opción la responde la IA", async () => {
    await t.send("hola");
    const reply = await t.send("me rechazaron la art");
    expect(reply.messages[0]).toContain("IA(carga): me rechazaron la art");
  });

  it("una foto sola se ignora por completo: aviso fijo + menú real (sin IA)", async () => {
    await t.send("hola");
    const reply = await t.engine.handle({
      id: "img1",
      conversationId: "c1",
      accountId: "1",
      text: "",
      attachments: [{ url: "https://x/foto.jpg", fileType: "image" }],
    });
    expect(reply.messages[0]).toContain("no proceso fotos");
    expect(reply.messages.join(" ")).toContain("Carga de Documentación");
    expect(reply.rich?.some((r) => r.kind === "buttons")).toBe(true);
    expect(t.ai.calls).toHaveLength(0); // la IA jamas ve la imagen
  });

  it("'hola' con la conversación ya abierta muestra el menú real, sin pasar por la IA", async () => {
    await t.send("hola"); // saludo inicial (nueva)
    await t.send("1"); // entra a Carga de Documentación
    const reply = await t.send("hola"); // saluda de nuevo, mitad de conversación
    expect(reply.messages.join(" ")).toContain("¿Qué necesitás?");
    expect(reply.rich?.some((r) => r.kind === "buttons")).toBe(true);
    expect(t.ai.calls).toHaveLength(0); // nunca fue a la IA
  });

  it("un DNI escrito directo en el menú consulta al chofer de una", async () => {
    await t.send("hola");
    const reply = await t.send("35413889");
    expect(reply.messages.join(" ")).toContain("PEREZ JUAN");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.CHOFER_QA);
    expect(t.ai.calls).toHaveLength(0);
  });

  it("una patente escrita directo en el menú consulta al camión de una", async () => {
    await t.send("hola");
    const reply = await t.send("AA006QS");
    expect(reply.messages.join(" ")).toContain("AA006QS");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.CAMION_QA);
  });

  it("volver y menu llevan al menú BALANZA (no al principal salteado)", async () => {
    await t.send("hola");
    await t.send("1");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.CARGA_DOC);
    await t.send("volver");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.BALANZA_MENU);
    await t.send("1");
    await t.send("menu");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.BALANZA_MENU);
  });

  it("modo automático (default): 'persona' NO deriva; el bot explica y sigue atendiendo", async () => {
    await t.send("hola");
    const reply = await t.send("persona");
    expect(reply.handoff).toBeUndefined();
    expect(reply.messages[0]).toContain("automática");
    const next = await t.send("menu");
    expect(next.messages.join("\n")).toContain("¿Qué necesitás?");
  });

  it("'eso es todo, gracias' despide y cierra: el próximo mensaje arranca de cero", async () => {
    await t.send("hola");
    await t.send("1");
    const bye = await t.send("eso es todo, gracias");
    expect(bye.reset).toBe(true);
    expect(bye.messages[0]).toContain("Gracias por escribirme");
    expect(await t.sessions.get("c1")).toBeNull(); // sesión borrada

    const again = await t.send("hola");
    expect(again.messages.join("\n")).toContain("Soy *Enri*"); // saluda de nuevo
  });

  it("con HANDOFF_ENABLED=true, 'persona' deriva y silencia al bot", async () => {
    const configConHandoff = loadConfig({
      CHATWOOT_API_TOKEN: "t",
      CHATWOOT_ACCOUNT_ID: "1",
      WEBHOOK_SECRET: "secret-de-test",
      ANTHROPIC_API_KEY: "k",
      SEALINK_EMAIL: "e",
      SEALINK_PASSWORD: "p",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      HANDOFF_ENABLED: "true",
    });
    const sessions = new MemorySessionStore();
    const engine = new BotEngine({
      services: { ai: new FakeAi(), sealink: new FakeSeaLink(), config: configConHandoff, logger: pino({ level: "silent" }), now: () => new Date("2026-09-10T15:00:00Z") },
      sessions,
    });
    const send = (text: string) => engine.handle({ id: text, conversationId: "cp", accountId: "1", text, attachments: [] });
    await send("hola");
    const reply = await send("persona");
    expect(reply.handoff).toBe(true);
    expect((await send("hola?")).messages).toEqual([]);
  });
});

describe("BotEngine — Carga de Documentación", () => {
  it("responde preguntas libres con la IA en modo 'carga' y mantiene historial", async () => {
    const t = setup();
    await t.send("hola");
    await t.send("1");
    const r1 = await t.send("¿Qué pongo en DNI?");
    expect(r1.messages[0]).toContain("IA(carga): ¿Qué pongo en DNI?");
    await t.send("¿Y en teléfono?");
    expect(t.ai.calls[1]?.history).toHaveLength(2);
    expect(t.ai.calls[1]?.history[0]).toEqual({ role: "user", content: "¿Qué pongo en DNI?" });
  });
});

describe("BotEngine — Documentación de Chofer", () => {
  it("pide DNI, consulta SeaLink y muestra vencimientos", async () => {
    const t = setup();
    await t.send("hola");
    const ask = await t.send("2");
    expect(ask.messages[0]).toContain("DNI del chofer");

    const result = await t.send("35.413.889");
    const text = result.messages.join("\n");
    expect(text).toContain("PEREZ JUAN");
    expect(text).toContain("Licencia de conducir");
    expect(text).toContain("10/03/2027");
    expect(text).toContain("Formulario 931");
    expect(text).toContain("vence en 5 días");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.CHOFER_QA);
  });

  it("DNI inválido o inexistente da un mensaje claro", async () => {
    const t = setup();
    await t.send("hola");
    await t.send("2");
    expect((await t.send("123")).messages[0]).toContain("DNI");
    expect((await t.send("28885099")).messages[0]).toContain("No encontré ningún chofer");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.CHOFER_DNI);
  });

  it("en modo QA responde con IA usando los datos y permite consultar otro DNI", async () => {
    const t = setup();
    await t.send("hola");
    await t.send("2");
    await t.send("35413889");
    const qa = await t.send("¿Tiene la ART vigente?");
    expect(qa.messages[0]).toContain("IA(chofer): ¿Tiene la ART vigente?");
    expect(t.ai.calls[0]?.data).toMatchObject({ dni: "35413889", nombre: "PEREZ JUAN" });

    const otro = await t.send("28885090");
    expect(otro.messages.join("\n")).toContain("GOMEZ CARLOS");
    expect(otro.messages.join("\n")).toContain("VENCIDO");
  });
});

describe("BotEngine — Documentación de Camión", () => {
  it("consulta por patente y distingue vencido / sin fecha", async () => {
    const t = setup();
    await t.send("hola");
    await t.send("3");
    const r = await t.send("3437 bxl");
    const text = r.messages.join("\n");
    expect(text).toContain("3437BXL");
    expect(text).toContain("VENCIDO");
    expect(text).toContain("sin fecha informada");
    expect((await t.sessions.get("c1"))?.state).toBe(BotState.CAMION_QA);
  });

  it("patente inexistente", async () => {
    const t = setup();
    await t.send("hola");
    await t.send("3");
    expect((await t.send("ZZ999ZZ")).messages[0]).toContain("No encontré");
  });
});

describe("BotEngine — sesiones", () => {
  it("una sesión inactiva vuelve al menú principal", async () => {
    let now = new Date("2026-08-26T15:00:00Z");
    const ai = new FakeAi();
    const sessions = new MemorySessionStore();
    const engine = new BotEngine({
      services: { ai, sealink: new FakeSeaLink(), config, logger: pino({ level: "silent" }), now: () => now },
      sessions,
    });
    const send = (text: string) => engine.handle({ id: text, conversationId: "c9", accountId: "1", text, attachments: [] });
    await send("hola");
    await send("1");
    expect((await sessions.get("c9"))?.state).toBe(BotState.CARGA_DOC);

    now = new Date("2026-08-26T17:00:00Z"); // 2 horas después
    const reply = await send("hola");
    expect(reply.messages.join("\n")).toContain("¿Qué necesitás?");
    expect((await sessions.get("c9"))?.state).toBe(BotState.BALANZA_MENU);
  });

  it("procesa en orden mensajes concurrentes de la misma conversación", async () => {
    const t = setup();
    const [a, b, c] = await Promise.all([t.send("hola"), t.send("A"), t.send("2")]);
    expect(a.messages.join("\n")).toContain("¿Qué necesitás?");
    expect(b.messages[0]).toContain("IA(carga): A");
    expect(c.messages[0]).toContain("DNI del chofer");
  });
});
