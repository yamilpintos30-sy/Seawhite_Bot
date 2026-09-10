import { describe, expect, it } from "vitest";
import { parseChatwootWebhook } from "../src/channels/chatwoot/parseWebhook.js";
import { matchOption, MAIN_MENU, BALANZA_MENU } from "../src/bot/menus.js";
import { detectGlobalCommand } from "../src/bot/commands.js";
import { splitForWhatsApp, toWhatsAppFormat } from "../src/utils/text.js";

describe("parseChatwootWebhook", () => {
  const base = {
    event: "message_created",
    id: 55,
    content: "hola",
    message_type: "incoming" as const,
    private: false,
    sender: { id: 1, name: "Juan", phone_number: "+5492914123456", type: "contact" },
    conversation: { id: 10, status: "pending" },
    account: { id: 1 },
  };

  it("convierte un mensaje entrante", () => {
    const ev = parseChatwootWebhook(base);
    expect(ev.kind).toBe("message");
    if (ev.kind === "message") {
      expect(ev.message.conversationId).toBe("10");
      expect(ev.message.text).toBe("hola");
      expect(ev.message.sender?.phone).toBe("+5492914123456");
    }
  });

  it("ignora notas privadas, otros eventos y mensajes vacíos", () => {
    expect(parseChatwootWebhook({ ...base, private: true }).kind).toBe("ignore");
    expect(parseChatwootWebhook({ ...base, event: "conversation_created" }).kind).toBe("ignore");
    expect(parseChatwootWebhook({ ...base, content: "", attachments: [] }).kind).toBe("ignore");
  });

  it("clasifica salientes: agent_bot = eco a ignorar; cualquier otro = posible humano", () => {
    expect(parseChatwootWebhook({ ...base, message_type: "outgoing", sender: { type: "agent_bot" } }).kind).toBe("ignore");
    const humano = parseChatwootWebhook({ ...base, message_type: "outgoing", content: "hola, soy Pedro", sender: { id: 9, name: "Pedro", type: "user" } });
    expect(humano).toMatchObject({ kind: "agent_message", conversationId: "10", text: "hola, soy Pedro", hasMedia: false });
    // Sender vacío también se trata como posible humano (Chatwoot no siempre lo puebla).
    expect(parseChatwootWebhook({ ...base, message_type: "outgoing", sender: undefined }).kind).toBe("agent_message");
    // Saliente sin contenido (status update) no es un vendedor.
    expect(parseChatwootWebhook({ ...base, message_type: "outgoing", content: "", sender: { type: "user" } }).kind).toBe("ignore");
  });

  it("un mensaje entrante no exige sender.type === 'contact'", () => {
    const ev = parseChatwootWebhook({ ...base, sender: { id: 1, name: "Juan" } });
    expect(ev.kind).toBe("message");
  });

  it("toma la identidad del contacto desde conversation.meta.sender", () => {
    const ev = parseChatwootWebhook({
      ...base,
      conversation: { id: 10, status: "open", meta: { sender: { id: 7, name: "Cliente Real", phone_number: "+549291000" } } },
    });
    expect(ev.kind).toBe("message");
    if (ev.kind === "message") expect(ev.message.sender).toEqual({ name: "Cliente Real", phone: "+549291000" });
  });

  it("encuentra adjuntos en content_attributes y URLs alternativas", () => {
    const ev = parseChatwootWebhook({
      ...base,
      content: null,
      attachments: [],
      content_attributes: { attachments: [{ file_type: "image", file_url: "https://x/alt.jpg" }] },
    });
    expect(ev.kind).toBe("message");
    if (ev.kind === "message") expect(ev.message.attachments[0]?.url).toBe("https://x/alt.jpg");
  });

  it("acepta message_type numérico (0 = incoming) y adjuntos", () => {
    const ev = parseChatwootWebhook({
      ...base,
      message_type: 0,
      content: null,
      attachments: [{ id: 1, file_type: "image", data_url: "https://x/y.jpg" }],
    });
    expect(ev.kind).toBe("message");
    if (ev.kind === "message") expect(ev.message.attachments[0]?.url).toBe("https://x/y.jpg");
  });

  it("detecta cambios de estado", () => {
    const ev = parseChatwootWebhook({ event: "conversation_status_changed", id: 10, status: "resolved", account: { id: 1 } });
    expect(ev).toMatchObject({ kind: "status_changed", conversationId: "10", status: "resolved" });
  });
});

describe("menús y comandos", () => {
  it("matchOption entiende teclas, alias y variantes", () => {
    expect(matchOption(MAIN_MENU, "a")?.key).toBe("A");
    expect(matchOption(MAIN_MENU, "A)")?.key).toBe("A");
    expect(matchOption(MAIN_MENU, "Balanza")?.key).toBe("A");
    expect(matchOption(MAIN_MENU, "opción B")?.key).toBe("B");
    expect(matchOption(BALANZA_MENU, "2")?.key).toBe("2");
    expect(matchOption(BALANZA_MENU, "documentación de chofer")?.key).toBe("2");
    expect(matchOption(BALANZA_MENU, "acoplado")?.key).toBe("3");
    expect(matchOption(BALANZA_MENU, "no se")).toBeUndefined();
  });

  it("detectGlobalCommand", () => {
    expect(detectGlobalCommand("Menú")).toBe("MAIN_MENU");
    expect(detectGlobalCommand("volver")).toBe("BACK");
    expect(detectGlobalCommand("quiero hablar con una persona")).toBe("HANDOFF");
    expect(detectGlobalCommand("ayuda")).toBe("HELP");
    expect(detectGlobalCommand("¿qué pongo en el menú de documentación?")).toBeUndefined();
  });

  it("frases de menú (visto en producción): 'quiero volver al menu principal'", () => {
    expect(detectGlobalCommand("quiero volver al menu principal")).toBe("MAIN_MENU");
    expect(detectGlobalCommand("llevame al menú")).toBe("MAIN_MENU");
    expect(detectGlobalCommand("volver al inicio")).toBe("MAIN_MENU");
    expect(detectGlobalCommand("mostrame el menu")).toBe("MAIN_MENU");
    // Consultas legítimas que mencionan "menú" NO son comandos.
    expect(detectGlobalCommand("¿qué pongo en el menú de documentación?")).toBeUndefined();
    expect(detectGlobalCommand("en el menu aprobados no aparece el chofer")).toBeUndefined();
  });
});

describe("formato WhatsApp", () => {
  it("convierte markdown a formato de WhatsApp", () => {
    expect(toWhatsAppFormat("## Título\n**negrita**\n- item")).toBe("*Título*\n*negrita*\n• item");
  });

  it("parte mensajes largos", () => {
    const long = Array.from({ length: 50 }, (_, i) => `Párrafo ${i} ${"x".repeat(150)}`).join("\n\n");
    const parts = splitForWhatsApp(long, 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join("\n\n")).toBe(long);
  });
});
