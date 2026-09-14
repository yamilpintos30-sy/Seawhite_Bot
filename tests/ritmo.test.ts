/**
 * Ritmo de conversación: buffer de mensajes (debounce) y seguimientos por inactividad.
 * Se testean las clases con tiempos chicos (ms) para no esperar de verdad.
 */
import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { isInstantMessage, MessageDebouncer } from "../src/server/debounce.js";
import { FOLLOWUP_ASK_TEXT, FOLLOWUP_BYE_TEXT, FollowupScheduler } from "../src/server/followups.js";
import { nombreCompleto } from "../src/utils/names.js";
import type { IncomingMessage } from "../src/bot/types.js";

const msg = (text: string, id = "1", conversationId = "d1"): IncomingMessage => ({
  id,
  conversationId,
  accountId: "1",
  text,
  attachments: [],
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("nombreCompleto", () => {
  it("da vuelta 'APELLIDO, NOMBRES' y capitaliza", () => {
    expect(nombreCompleto("MENTASTI, PEDRO CARLOS")).toBe("Pedro Carlos Mentasti");
    expect(nombreCompleto("PEREZ, JUAN")).toBe("Juan Perez");
    expect(nombreCompleto("GOMEZ CARLOS")).toBe("Gomez Carlos");
    expect(nombreCompleto("")).toBe("");
  });
});

describe("isInstantMessage", () => {
  it("botones, opciones, comandos, DNI y patentes son instantáneos", () => {
    for (const t of ["1", "2", "3", "Chofer por DNI", "Cargar documentación", "menu", "volver", "/bot", "35413889", "AA123BB", "hola", "Buenas tardes"]) {
      expect(isInstantMessage(t), t).toBe(true);
    }
  });

  it("las consultas escritas NO son instantáneas (van al buffer)", () => {
    for (const t of ["me rechazaron la art", "¿qué pongo en el campo dni?", "tengo un problema con la carga"]) {
      expect(isInstantMessage(t), t).toBe(false);
    }
  });
});

describe("MessageDebouncer", () => {
  it("junta varios mensajes y entrega UNO con todo el texto, tras el silencio", async () => {
    const flushed: IncomingMessage[] = [];
    const d = new MessageDebouncer(80, (m) => flushed.push(m));
    d.push(msg("hola, tengo un problema"));
    await sleep(30);
    d.push(msg("me rechazaron la ART", "2"));
    await sleep(30);
    d.push(msg("que hago?", "3"));
    expect(flushed).toHaveLength(0); // todavía juntando
    await sleep(120);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.text).toBe("hola, tengo un problema\nme rechazaron la ART\nque hago?");
  });

  it("un mensaje instantáneo sale ya, y arrastra el buffer pendiente", async () => {
    const flushed: IncomingMessage[] = [];
    const d = new MessageDebouncer(500, (m) => flushed.push(m));
    d.push(msg("2")); // opción de menú -> instantáneo
    expect(flushed).toHaveLength(1);

    d.push(msg("tengo una duda"));
    d.push(msg("35413889", "5")); // DNI -> instantáneo: sale todo junto ahora
    expect(flushed).toHaveLength(2);
    expect(flushed[1]!.text).toBe("tengo una duda\n35413889");
  });

  it("con waitMs=0 el buffer está apagado", () => {
    const flushed: IncomingMessage[] = [];
    const d = new MessageDebouncer(0, (m) => flushed.push(m));
    d.push(msg("cualquier texto largo de consulta"));
    expect(flushed).toHaveLength(1);
  });
});

describe("FollowupScheduler", () => {
  function setup(overrides: Partial<{ askMs: number; byeMs: number; resetMs: number }> = {}) {
    const sent: string[] = [];
    const resets: string[] = [];
    const s = new FollowupScheduler({
      askMs: overrides.askMs ?? 40,
      byeMs: overrides.byeMs ?? 80,
      resetMs: overrides.resetMs ?? 120,
      sendAsk: async (_c, text) => {
        sent.push(text);
      },
      sendBye: async (_c, text) => {
        sent.push(text);
      },
      resetConversation: async (c) => {
        resets.push(c);
      },
      logger: pino({ level: "silent" }),
    });
    return { s, sent, resets };
  }

  it("dispara en orden: ¿algo más? -> despedida (que CIERRA la conversación al instante)", async () => {
    const { s, sent, resets } = setup();
    s.scheduleAfterReply("f1");
    await sleep(60);
    expect(sent).toEqual([FOLLOWUP_ASK_TEXT]);
    expect(resets).toEqual([]);
    await sleep(50);
    expect(sent).toEqual([FOLLOWUP_ASK_TEXT, FOLLOWUP_BYE_TEXT]);
    expect(resets).toEqual(["f1"]); // la despedida resetea YA, sin esperar al timer de reset
    await sleep(60);
    expect(resets).toEqual(["f1"]); // y el timer de reset quedó cancelado (no duplica)
  });

  it("sin despedida (byeMs=0), el reset de los 30 min sigue funcionando", async () => {
    const { s, resets } = setup({ byeMs: 0, askMs: 0, resetMs: 50 });
    s.scheduleAfterReply("f9");
    await sleep(80);
    expect(resets).toEqual(["f9"]);
  });

  it("un mensaje del usuario cancela toda la cadena", async () => {
    const { s, sent, resets } = setup();
    s.scheduleAfterReply("f2");
    await sleep(20);
    s.cancel("f2"); // el usuario escribió
    await sleep(150);
    expect(sent).toEqual([]);
    expect(resets).toEqual([]);
  });

  it("reprogramar reemplaza la cadena anterior", async () => {
    const { s, sent } = setup({ askMs: 40, byeMs: 0, resetMs: 0 });
    s.scheduleAfterReply("f3");
    await sleep(20);
    s.scheduleAfterReply("f3"); // nueva respuesta del bot: reinicia el reloj
    await sleep(30);
    expect(sent).toEqual([]); // los 40ms de la primera cadena no cuentan
    await sleep(20);
    expect(sent).toEqual([FOLLOWUP_ASK_TEXT]);
  });
});
