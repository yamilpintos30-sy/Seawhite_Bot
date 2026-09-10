import { describe, expect, it } from "vitest";
import { looksLikeDni, looksLikePatente, normalizeDni, normalizePatente } from "../src/domain/validators.js";

describe("normalizeDni", () => {
  it("acepta DNI con puntos y lo devuelve sólo con números", () => {
    expect(normalizeDni("30.123.456")).toEqual({ ok: true, value: "30123456" });
    expect(normalizeDni("dni 30123456")).toEqual({ ok: true, value: "30123456" });
    expect(normalizeDni("7123456")).toEqual({ ok: true, value: "7123456" });
  });

  it("rechaza CUIT/CUIL y textos sin números", () => {
    expect(normalizeDni("20-30123456-7").ok).toBe(false);
    expect(normalizeDni("hola").ok).toBe(false);
    expect(normalizeDni("123").ok).toBe(false);
  });

  it("looksLikeDni detecta sólo números de 7-8 dígitos", () => {
    expect(looksLikeDni("30123456")).toBe(true);
    expect(looksLikeDni("30.123.456")).toBe(true);
    expect(looksLikeDni("tiene la ART vigente?")).toBe(false);
  });
});

describe("normalizePatente", () => {
  it("normaliza formatos Mercosur y viejos", () => {
    expect(normalizePatente("aa 123 bb")).toEqual({ ok: true, value: "AA123BB" });
    expect(normalizePatente("AA-123-BB")).toEqual({ ok: true, value: "AA123BB" });
    expect(normalizePatente("abc.123")).toEqual({ ok: true, value: "ABC123" });
    expect(normalizePatente("patente: 2367FUT")).toEqual({ ok: true, value: "2367FUT" });
  });

  it("rechaza textos que no son patentes", () => {
    expect(normalizePatente("hola que tal").ok).toBe(false);
    expect(normalizePatente("123456").ok).toBe(false);
    expect(normalizePatente("").ok).toBe(false);
  });

  it("looksLikePatente distingue patentes de preguntas", () => {
    expect(looksLikePatente("AA006QS")).toBe(true);
    expect(looksLikePatente("3437BXL")).toBe(true);
    expect(looksLikePatente("cuando vence el seguro")).toBe(false);
  });
});
