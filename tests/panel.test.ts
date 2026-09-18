/**
 * Panel web: acceso con contraseña, lectura y reemplazo del contexto.
 * No se toca la red: Supabase y Chatwoot se reemplazan por dobles.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { createToken, isValidToken, LoginThrottle, samePassword } from "../src/admin/auth.js";
import { StatsRepository } from "../src/admin/statsRepository.js";
import { KnowledgeStore } from "../src/ai/knowledge.js";
import { loadConfig } from "../src/config.js";

const logger = pino({ level: "silent" });

describe("acceso al panel", () => {
  it("la cookie firmada vale y vence", () => {
    const token = createToken("secreto-largo-de-prueba");
    expect(isValidToken(token, "secreto-largo-de-prueba")).toBe(true);
    expect(isValidToken(token, "otro-secreto")).toBe(false);
    expect(isValidToken(token, "secreto-largo-de-prueba", Date.now() + 13 * 60 * 60 * 1000)).toBe(false);
  });

  it("no se puede falsificar cambiando el vencimiento", () => {
    const token = createToken("secreto-largo-de-prueba");
    const [, firma] = token.split(".");
    const falso = `${Date.now() + 999999999}.${firma}`;
    expect(isValidToken(falso, "secreto-largo-de-prueba")).toBe(false);
  });

  it("la comparación de contraseña no se rompe con largos distintos", () => {
    expect(samePassword("abc", "abc")).toBe(true);
    expect(samePassword("abc", "abcd")).toBe(false);
    expect(samePassword("", "")).toBe(true);
  });

  it("bloquea después de varios intentos fallidos", () => {
    const t = new LoginThrottle(3, 60_000);
    expect(t.bloqueado("1.1.1.1")).toBe(false);
    t.fallo("1.1.1.1");
    t.fallo("1.1.1.1");
    expect(t.bloqueado("1.1.1.1")).toBe(false);
    t.fallo("1.1.1.1");
    expect(t.bloqueado("1.1.1.1")).toBe(true);
    t.exito("1.1.1.1");
    expect(t.bloqueado("1.1.1.1")).toBe(false);
  });
});

describe("contexto: el del panel manda sobre el del repositorio", () => {
  it("si Supabase tiene contexto, se usa ese", async () => {
    const store = new KnowledgeStore({
      dir: "knowledge",
      reloadSeconds: 0,
      logger,
      source: { list: async () => [{ id: "CargaDocumentacion", content: "TEXTO DEL PANEL", updatedAt: new Date("2026-09-17T10:00:00Z") }] },
    });
    const snapshot = await store.get();
    expect(snapshot.text).toContain("TEXTO DEL PANEL");
    expect(snapshot.files).toEqual(["CargaDocumentacion"]);
  });

  it("si no hay nada en Supabase, se usan los archivos del repositorio", async () => {
    const store = new KnowledgeStore({ dir: "knowledge", reloadSeconds: 0, logger, source: { list: async () => [] } });
    const snapshot = await store.get();
    expect(snapshot.files).toContain("CargaDocumentacion.md");
    expect(snapshot.text).toContain("SEA WHITE");
  });

  it("si Supabase falla, el bot sigue con los archivos del repositorio", async () => {
    const store = new KnowledgeStore({
      dir: "knowledge",
      reloadSeconds: 0,
      logger,
      source: {
        list: async () => {
          throw new Error("supabase caído");
        },
      },
    });
    const snapshot = await store.get();
    expect(snapshot.files).toContain("CargaDocumentacion.md");
  });
});

describe("estadísticas", () => {
  /** Doble de Supabase: devuelve las filas indicadas para cualquier consulta. */
  function fakeSupabase(rows: unknown[]) {
    const builder = {
      select: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: async () => ({ data: rows, error: null }),
    };
    return { from: () => builder } as never;
  }

  const hoy = "2026-09-17T13:00:00.000Z"; // 10:00 en Argentina
  const ayer = "2026-09-16T18:30:00.000Z"; // 15:30 en Argentina

  it("cuenta personas, conversaciones y mensajes por día", async () => {
    const repo = new StatsRepository(
      fakeSupabase([
        { conversation_id: "c1", direction: "in", content: "hola", state: "BALANZA_MENU", meta: { sender: { phone: "+5491100000001" } }, created_at: ayer },
        { conversation_id: "c1", direction: "out", content: "respuesta", state: "BALANZA_MENU", meta: {}, created_at: ayer },
        { conversation_id: "c2", direction: "in", content: "que necesito", state: "CARGA_DOC", meta: { sender: { phone: "+5491100000002" } }, created_at: hoy },
        { conversation_id: "c3", direction: "in", content: "35413889", state: "CHOFER_DNI", meta: { sender: { phone: "+5491100000002" } }, created_at: hoy },
      ]),
      "America/Argentina/Buenos_Aires",
    );

    const s = await repo.summary(7);
    expect(s.totalMensajes).toBe(3); // los salientes no cuentan
    expect(s.totalConversaciones).toBe(3);
    expect(s.totalPersonas).toBe(2); // el mismo teléfono en dos conversaciones es una persona
    expect(s.porDia).toEqual([
      { fecha: "2026-09-16", personas: 1, conversaciones: 1, mensajes: 1 },
      { fecha: "2026-09-17", personas: 1, conversaciones: 2, mensajes: 2 },
    ]);
    expect(s.porHora.find((h) => h.hora === 10)?.mensajes).toBe(2);
    expect(s.porSeccion).toContainEqual({ seccion: "Carga de documentos", mensajes: 1 });
    expect(s.porSeccion).toContainEqual({ seccion: "Chofer por DNI", mensajes: 1 });
    // Los menús y las conversaciones cerradas no cuentan como "uso".
    expect(s.porSeccion.map((x) => x.seccion)).not.toContain("Menú");
  });

  it("las consultas para la IA excluyen las respuestas del bot y los mensajes vacíos", async () => {
    const repo = new StatsRepository(
      fakeSupabase([
        { conversation_id: "c1", direction: "in", content: "no me toma el telefono", state: "CARGA_DOC", meta: {}, created_at: hoy },
        { conversation_id: "c1", direction: "out", content: "te explico", state: "CARGA_DOC", meta: {}, created_at: hoy },
        { conversation_id: "c1", direction: "in", content: "ok", state: "CARGA_DOC", meta: {}, created_at: hoy },
      ]),
      "America/Argentina/Buenos_Aires",
    );
    const consultas = await repo.consultas(7);
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.texto).toBe("no me toma el telefono");
    expect(consultas[0]!.estado).toBe("Carga de documentos");
  });
});

describe("configuración del panel", () => {
  it("sin ADMIN_PASSWORD el panel queda apagado", () => {
    const config = loadConfig({
      CHATWOOT_API_TOKEN: "t",
      CHATWOOT_ACCOUNT_ID: "1",
      WEBHOOK_SECRET: "secret-de-test",
      ANTHROPIC_API_KEY: "k",
      SEALINK_EMAIL: "e",
      SEALINK_PASSWORD: "p",
    });
    expect(config.ADMIN_PASSWORD).toBeUndefined();
  });

  it("una contraseña corta no se acepta", () => {
    expect(() =>
      loadConfig({
        CHATWOOT_API_TOKEN: "t",
        CHATWOOT_ACCOUNT_ID: "1",
        WEBHOOK_SECRET: "secret-de-test",
        ANTHROPIC_API_KEY: "k",
        SEALINK_EMAIL: "e",
        SEALINK_PASSWORD: "p",
        ADMIN_PASSWORD: "corta",
      }),
    ).toThrow(/ADMIN_PASSWORD/);
  });
});

afterEach(() => vi.restoreAllMocks());
