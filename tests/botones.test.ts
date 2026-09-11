/**
 * Saludo con imagen + botones interactivos del menú (estilo "Guspi").
 * El motor genera `rich` para el canal WhatsApp; `messages` queda como respaldo texto.
 */
import { describe, expect, it } from "vitest";
import pino from "pino";
import { BotEngine } from "../src/bot/engine.js";
import { BALANZA_MENU, matchOption, menuButtons } from "../src/bot/menus.js";
import type { BotServices } from "../src/bot/types.js";
import { loadConfig } from "../src/config.js";
import { FakeSeaLink } from "../src/integrations/sealink/fake.js";
import { MemorySessionStore } from "../src/storage/memorySessionStore.js";
import type { AiService } from "../src/ai/types.js";

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
  const services: BotServices = { ai: fakeAi, sealink: new FakeSeaLink(), config, logger: pino({ level: "silent" }), now: () => new Date("2026-09-11T15:00:00Z") };
  const engine = new BotEngine({ services, sessions: new MemorySessionStore() });
  let n = 0;
  const send = (text: string, conversationId = "b1") => engine.handle({ id: String(++n), conversationId, accountId: "1", text, attachments: [] });
  return { send };
}

describe("menuButtons", () => {
  it("genera exactamente 3 botones (límite de WhatsApp) con títulos de hasta 20 caracteres", () => {
    const buttons = menuButtons(BALANZA_MENU);
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b.title.length).toBeLessThanOrEqual(20);
    expect(buttons.map((b) => b.payload)).toEqual(["1", "2", "3"]);
  });

  it("el texto de cada botón selecciona su opción al volver como mensaje", () => {
    // Al tocar un botón, WhatsApp manda el TÍTULO como texto (o Chatwoot el value).
    expect(matchOption(BALANZA_MENU, "Cargar documentación")?.key).toBe("1");
    expect(matchOption(BALANZA_MENU, "Chofer por DNI")?.key).toBe("2");
    expect(matchOption(BALANZA_MENU, "Camión por patente")?.key).toBe("3");
    expect(matchOption(BALANZA_MENU, "1")?.key).toBe("1");
  });
});

describe("saludo enriquecido", () => {
  it("el primer mensaje trae imagen con el saludo y botones del menú", async () => {
    const t = setup();
    const reply = await t.send("hola");
    expect(reply.rich).toBeDefined();
    expect(reply.rich![0]).toMatchObject({ kind: "image" });
    expect((reply.rich![0] as { caption: string }).caption).toContain("Soy *Enri*");
    const botones = reply.rich!.find((r) => r.kind === "buttons");
    expect(botones).toBeDefined();
    // Y el respaldo de texto sigue completo para canales sin botones.
    expect(reply.messages.join("\n")).toContain("*1)* Carga de Documentación");
  });

  it("volver a un menú también ofrece botones", async () => {
    const t = setup();
    await t.send("hola");
    await t.send("1");
    const back = await t.send("volver");
    expect(back.rich?.some((r) => r.kind === "buttons")).toBe(true);
  });

  it("una respuesta común (no menú) no lleva rich", async () => {
    const t = setup();
    await t.send("hola");
    const ask = await t.send("2");
    expect(ask.rich).toBeUndefined();
    expect(ask.messages[0]).toContain("DNI del chofer");
  });

  it("con el menú principal salteado, el menú BALANZA no muestra la opción 0", async () => {
    const t = setup();
    const reply = await t.send("hola");
    expect(reply.messages.join("\n")).not.toContain("Volver al menú principal");
  });
});
