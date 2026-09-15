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

function setup(ai: AiService = fakeAi) {
  const services: BotServices = { ai, sealink: new FakeSeaLink(), config, logger: pino({ level: "silent" }), now: () => new Date("2026-09-11T15:00:00Z") };
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

describe("mensajes no entendidos", () => {
  /** IA de prueba que cuenta llamadas y marca como ininteligible lo que contenga "hshdkf". */
  function trackedAi() {
    const calls: string[] = [];
    const ai: AiService = {
      answer: async (i) => {
        calls.push(i.userText);
        return { text: i.userText.includes("hshdkf") ? "[[NO_ENTENDI]]" : `IA: ${i.userText}` };
      },
    };
    return { ai, calls };
  }

  function buttonsOf(reply: Awaited<ReturnType<ReturnType<typeof setup>["send"]>>) {
    return reply.rich?.find((r) => r.kind === "buttons") as { text: string; buttons: unknown[] } | undefined;
  }

  it("un número que no es opción ni DNI muestra el menú real, sin llamar a la IA", async () => {
    const { ai, calls } = trackedAi();
    const t = setup(ai);
    await t.send("hola");
    for (const numero of ["123", "123456"]) {
      const reply = await t.send(numero);
      const botones = buttonsOf(reply);
      expect(botones?.buttons).toHaveLength(3);
      expect(botones?.text).toContain("No reconocí ese número");
    }
    expect(calls).toHaveLength(0);
  });

  it("si la IA no entiende, se muestra el menú real en un solo mensaje con botones", async () => {
    const { ai } = trackedAi();
    const t = setup(ai);
    await t.send("hola");
    const reply = await t.send("hshdkf");
    expect(reply.rich).toHaveLength(1);
    expect(buttonsOf(reply)?.text).toContain("No entendí tu mensaje");
    expect(reply.messages.join("\n")).not.toContain("NO_ENTENDI");
  });

  it("también desde Carga de Documentación vuelve al menú", async () => {
    const { ai } = trackedAi();
    const t = setup(ai);
    await t.send("hola");
    await t.send("1");
    const reply = await t.send("hshdkf");
    expect(buttonsOf(reply)?.buttons).toHaveLength(3);
    const despues = await t.send("2");
    expect(despues.messages[0]).toContain("DNI del chofer");
  });

  it("una consulta entendible sigue yendo a la IA", async () => {
    const { ai, calls } = trackedAi();
    const t = setup(ai);
    await t.send("hola");
    const reply = await t.send("que pongo en el campo dni");
    expect(reply.messages[0]).toBe("IA: que pongo en el campo dni");
    expect(calls).toHaveLength(1);
  });
});
