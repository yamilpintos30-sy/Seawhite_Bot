/**
 * Implementación falsa de SeaLink con los datos de prueba del manual.
 * Se usa en tests y en el simulador de consola (SEALINK_FAKE=1).
 */
import type { CamionLookup, ChoferLookup, SeaLinkService, TelefonoLookup } from "./types.js";

const CHOFERES: Record<string, Omit<Extract<ChoferLookup, { found: true }>, "found" | "dni">> = {
  "35413889": { razonSocial: "PEREZ JUAN", licenciaVto: "2027-03-10T00:00:00", f931Vto: "2026-08-31T00:00:00", artVto: "2026-09-15T00:00:00" },
  "28885090": { razonSocial: "GOMEZ CARLOS", licenciaVto: "2026-01-05T00:00:00", f931Vto: null, artVto: "2026-12-01T00:00:00" },
};

const CAMIONES: Record<string, Omit<Extract<CamionLookup, { found: true }>, "found" | "dominio">> = {
  AA006QS: { seguroVto: "2026-12-20T00:00:00", vtvVto: "2027-01-15T00:00:00" },
  AA119NR: { seguroVto: "2026-09-01T00:00:00", vtvVto: null },
  "2367FUT": { seguroVto: "2025-11-30T00:00:00", vtvVto: "2026-02-10T00:00:00" },
  "3437BXL": { seguroVto: "2026-03-01T00:00:00", vtvVto: null },
};

// Teléfonos de prueba del anexo. La API real busca con LIKE, tolera el +549
// y devuelve la razón social como "APELLIDO, NOMBRE".
const TELEFONOS: Record<string, string> = {
  "2392526070": "PEREZ, JUAN",
  "2392406419": "GOMEZ, CARLOS",
};

export class FakeSeaLink implements SeaLinkService {
  async consultarChoferPorTelefono(telefono: string): Promise<TelefonoLookup> {
    const key = telefono.replace(/^\+549/, "").replace(/\D/g, "");
    const razonSocial = TELEFONOS[key];
    return razonSocial ? { found: true, telefono, razonSocial } : { found: false, telefono };
  }

  async consultarChofer(dni: string): Promise<ChoferLookup> {
    const data = CHOFERES[dni];
    return data ? { found: true, dni, ...data } : { found: false, dni };
  }

  async consultarCamion(dominio: string): Promise<CamionLookup> {
    const data = CAMIONES[dominio];
    return data ? { found: true, dominio, ...data } : { found: false, dominio };
  }
}
