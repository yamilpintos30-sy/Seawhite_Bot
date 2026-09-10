/**
 * REGLA Nº 1: el servidor de SEA WHITE es SOLO LECTURA.
 * Este test garantiza que el cliente SeaLink sólo puede llamar a los 4 endpoints de consulta.
 */
import { describe, expect, it } from "vitest";
import { assertReadOnlyEndpoint, SEALINK_READ_ONLY_ENDPOINTS } from "../src/integrations/sealink/client.js";

describe("SeaLink — sólo lectura", () => {
  it("la lista blanca contiene exactamente los 5 endpoints de consulta (manual + anexo teléfono)", () => {
    expect([...SEALINK_READ_ONLY_ENDPOINTS].sort()).toEqual(
      [
        "/api/autenticacion/me",
        "/api/autenticacion/validar",
        "/api/vencimientos/camion",
        "/api/vencimientos/chofer",
        "/api/vencimientos/chofer/telefono",
      ].sort(),
    );
  });

  it("permite los endpoints de consulta", () => {
    for (const path of SEALINK_READ_ONLY_ENDPOINTS) expect(() => assertReadOnlyEndpoint(path)).not.toThrow();
  });

  it("bloquea cualquier otro path (alta, edición, borrado, SQL...)", () => {
    for (const path of [
      "/api/vencimientos/chofer/actualizar",
      "/api/choferes",
      "/api/choferes/35413889",
      "/api/camiones/AA006QS/eliminar",
      "/api/documentacion/aprobar",
      "/api/sql",
      "/",
      "",
    ]) {
      expect(() => assertReadOnlyEndpoint(path)).toThrow(/SOLO LECTURA/);
    }
  });
});
