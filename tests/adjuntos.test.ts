/**
 * Fotos y PDF: el bot los descarga de Chatwoot y se los pasa a Claude para que
 * los lea (carnet, póliza, captura del error de la página).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { downloadAttachments } from "../src/ai/attachments.js";
import { BotEngine } from "../src/bot/engine.js";
import type { BotServices } from "../src/bot/types.js";
import { loadConfig } from "../src/config.js";
import { FakeSeaLink } from "../src/integrations/sealink/fake.js";
import { MemorySessionStore } from "../src/storage/memorySessionStore.js";
import type { AiAnswerInput, AiService } from "../src/ai/types.js";

const logger = pino({ level: "silent" });

/** Respuesta HTTP falsa con el contenido y el tipo indicados. */
function fakeResponse(body: string, contentType: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => contentType },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("descarga de adjuntos", () => {
  it("una imagen se convierte en base64 con su tipo", async () => {
    vi.stubGlobal("fetch", async () => fakeResponse("foto-binaria", "image/jpeg"));
    const { attachments, warnings } = await downloadAttachments([{ url: "https://chatwoot/x.jpg", fileType: "image" }], logger);
    expect(warnings).toEqual([]);
    expect(attachments[0]).toMatchObject({ kind: "image", mediaType: "image/jpeg" });
    expect(Buffer.from((attachments[0] as { base64: string }).base64, "base64").toString()).toBe("foto-binaria");
  });

  it("un PDF se manda como documento", async () => {
    vi.stubGlobal("fetch", async () => fakeResponse("%PDF-1.4", "application/pdf"));
    const { attachments } = await downloadAttachments([{ url: "https://chatwoot/poliza.pdf", fileType: "file" }], logger);
    expect(attachments[0]).toMatchObject({ kind: "pdf" });
  });

  it("un audio avisa que no se puede escuchar, sin romper", async () => {
    vi.stubGlobal("fetch", async () => fakeResponse("ogg", "audio/ogg"));
    const { attachments, warnings } = await downloadAttachments([{ url: "https://chatwoot/a.ogg", fileType: "audio" }], logger);
    expect(attachments).toEqual([]);
    expect(warnings[0]).toContain("audios");
  });

  it("si la descarga falla, se avisa y no se corta la respuesta", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNRESET");
    });
    const { attachments, warnings } = await downloadAttachments([{ url: "https://chatwoot/x.jpg" }], logger);
    expect(attachments).toEqual([]);
    expect(warnings[0]).toContain("No pude abrir el archivo");
  });
});

describe("la foto llega a la IA", () => {
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

  it("una foto con texto llega junto a la consulta, y el historial deja la marca", async () => {
    vi.stubGlobal("fetch", async () => fakeResponse("captura", "image/png"));
    const calls: AiAnswerInput[] = [];
    const ai: AiService = {
      answer: async (i) => {
        calls.push({ ...i, history: [...i.history] });
        return { text: "En la captura dice que falta la cláusula de no repetición." };
      },
    };
    const services: BotServices = { ai, sealink: new FakeSeaLink(), config, logger, now: () => new Date("2026-09-17T12:00:00Z") };
    const engine = new BotEngine({ services, sessions: new MemorySessionStore() });

    await engine.handle({ id: "1", conversationId: "a1", accountId: "1", text: "hola", attachments: [] });
    const reply = await engine.handle({
      id: "2",
      conversationId: "a1",
      accountId: "1",
      text: "me rechazaron esto, que hago?",
      attachments: [{ url: "https://chatwoot/captura.png", fileType: "image" }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.attachments).toHaveLength(1);
    expect(calls[0]!.attachments![0]).toMatchObject({ kind: "image", mediaType: "image/png" });
    expect(reply.messages[0]).toContain("cláusula de no repetición");

    // El adjunto no se guarda en el historial, pero queda constancia.
    await engine.handle({ id: "3", conversationId: "a1", accountId: "1", text: "y si es otro caso?", attachments: [] });
    expect(calls[1]!.history.map((h) => h.content).join(" ")).toContain("adjuntó 1 archivo");
  });
});
