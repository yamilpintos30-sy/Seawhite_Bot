/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  REGLA Nº 1 DEL PROYECTO: EL SERVIDOR DE SEA WHITE ES SOLO LECTURA.       ║
 * ║  Únicos endpoints permitidos: los 4 de consulta del manual SeaLink.       ║
 * ║  Cualquier otro path lanza error ANTES de salir a la red.                 ║
 * ║  NO AGREGAR endpoints de alta, modificación ni borrado. NUNCA.            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { SeaLinkError } from "./types.js";

export const SEALINK_READ_ONLY_ENDPOINTS: ReadonlySet<string> = new Set([
  "/api/autenticacion/validar",
  "/api/autenticacion/me",
  "/api/vencimientos/chofer",
  "/api/vencimientos/chofer/telefono", // anexo 2026-09: nombre del chofer por teléfono (consulta)
  "/api/vencimientos/camion",
]);

export function assertReadOnlyEndpoint(path: string): void {
  if (!SEALINK_READ_ONLY_ENDPOINTS.has(path)) {
    throw new SeaLinkError(`BLOQUEADO: "${path}" no es un endpoint de consulta permitido. El servidor de SEA WHITE es SOLO LECTURA.`);
  }
}
