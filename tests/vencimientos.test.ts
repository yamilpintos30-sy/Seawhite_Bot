import { describe, expect, it } from "vitest";
import { clasificarVencimiento, lineaVencimiento, resumenGeneral } from "../src/domain/vencimientos.js";
import { diffDays, parseCalendarDate, todayInTimeZone } from "../src/utils/dates.js";

const HOY = { year: 2026, month: 8, day: 26 };

describe("fechas", () => {
  it("parsea el formato de SeaLink y dd/mm/aaaa", () => {
    expect(parseCalendarDate("2027-03-10T00:00:00")).toEqual({ year: 2027, month: 3, day: 10 });
    expect(parseCalendarDate("09/06/2027")).toEqual({ year: 2027, month: 6, day: 9 });
    expect(parseCalendarDate(null)).toBeNull();
    expect(parseCalendarDate("sin fecha")).toBeNull();
  });

  it("calcula diferencias en días", () => {
    expect(diffDays(HOY, { year: 2026, month: 8, day: 31 })).toBe(5);
    expect(diffDays(HOY, { year: 2026, month: 8, day: 25 })).toBe(-1);
  });

  it("obtiene el día de hoy en la zona horaria de Argentina", () => {
    // 02:30 UTC del 27/08 son las 23:30 del 26/08 en Buenos Aires
    const utc = new Date("2026-08-27T02:30:00Z");
    expect(todayInTimeZone("America/Argentina/Buenos_Aires", utc)).toEqual(HOY);
  });
});

describe("clasificarVencimiento", () => {
  it("VIGENTE cuando la fecha es posterior a hoy (más de 15 días)", () => {
    const v = clasificarVencimiento("ART", "2026-12-01T00:00:00", HOY);
    expect(v.estado).toBe("VIGENTE");
    expect(lineaVencimiento(v)).toContain("01/12/2026");
  });

  it("POR_VENCER dentro de los 15 días (incluye hoy)", () => {
    expect(clasificarVencimiento("931", "2026-08-31T00:00:00", HOY).estado).toBe("POR_VENCER");
    expect(clasificarVencimiento("931", "2026-08-26T00:00:00", HOY).estado).toBe("POR_VENCER");
    expect(clasificarVencimiento("931", "2026-09-10T00:00:00", HOY).estado).toBe("POR_VENCER");
    expect(clasificarVencimiento("931", "2026-09-11T00:00:00", HOY).estado).toBe("VIGENTE");
  });

  it("VENCIDO cuando la fecha es anterior a hoy", () => {
    const v = clasificarVencimiento("Seguro", "2025-11-30T00:00:00", HOY);
    expect(v.estado).toBe("VENCIDO");
    expect(lineaVencimiento(v)).toContain("VENCIDO");
  });

  it("SIN_FECHA cuando la API devuelve null", () => {
    const v = clasificarVencimiento("VTV", null, HOY);
    expect(v.estado).toBe("SIN_FECHA");
    expect(lineaVencimiento(v)).toContain("sin fecha informada");
  });
});

describe("resumenGeneral", () => {
  it("informa todo vigente", () => {
    const r = resumenGeneral([clasificarVencimiento("ART", "2027-01-01", HOY)]);
    expect(r).toContain("vigente");
  });

  it("lista vencidos, por vencer y sin fecha", () => {
    const r = resumenGeneral([
      clasificarVencimiento("ART", "2025-01-01", HOY),
      clasificarVencimiento("931", "2026-08-30", HOY),
      clasificarVencimiento("Licencia", null, HOY),
    ]);
    expect(r).toContain("vencida: ART");
    expect(r).toContain("Próximo a vencer: 931");
    expect(r).toContain("Sin fecha informada: Licencia");
  });
});
