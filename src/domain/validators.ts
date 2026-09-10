/**
 * Validación y normalización de los datos que el usuario escribe por WhatsApp.
 * Las reglas siguen el "Schema maestro": DNI sin puntos, patente sin espacios/puntos/guiones.
 */

export interface ValidationResult {
  ok: boolean;
  /** Valor normalizado listo para enviar a la API. */
  value: string;
  /** Explicación amigable cuando `ok` es false. */
  error?: string;
}

/** DNI: acepta "30.123.456", "30123456", "dni 30123456"; devuelve sólo dígitos (7 u 8). */
export function normalizeDni(input: string): ValidationResult {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 0) {
    return { ok: false, value: "", error: "No encontré un número de DNI en el mensaje. Escribilo sólo con números, sin puntos. Ejemplo: 30123456" };
  }
  if (digits.length < 7 || digits.length > 8) {
    return {
      ok: false,
      value: digits,
      error: "El DNI tiene que tener 7 u 8 números, sin puntos. Si escribiste un CUIT o CUIL, mandame sólo el DNI. Ejemplo: 30123456",
    };
  }
  return { ok: true, value: digits };
}

/** ¿El texto parece ser un DNI y nada más? (para detectar re-consultas dentro del modo chofer). */
export function looksLikeDni(input: string): boolean {
  const cleaned = input.replace(/[\s.]/g, "").replace(/^dni:?/i, "");
  return /^\d{7,8}$/.test(cleaned);
}

/**
 * Patente/dominio: acepta "AA 123 BB", "aa-123-bb", "ABC123", "2367FUT" (formatos viejos
 * y de acoplados). Devuelve mayúsculas sin espacios, puntos ni guiones.
 */
export function normalizePatente(input: string): ValidationResult {
  const cleaned = input
    .toUpperCase()
    .replace(/^(PATENTE|DOMINIO)\s*:?\s*/i, "")
    .replace(/[\s.\-_/]/g, "");
  if (cleaned.length === 0) {
    return { ok: false, value: "", error: "No encontré la patente en el mensaje. Escribila toda junta, sin espacios ni guiones. Ejemplo: AA123BB" };
  }
  if (!/^[A-Z0-9]{6,8}$/.test(cleaned) || !/\d/.test(cleaned) || !/[A-Z]/.test(cleaned)) {
    return {
      ok: false,
      value: cleaned,
      error: "Esa patente no parece válida. Escribila toda junta, con letras y números, sin espacios, puntos ni guiones. Ejemplo: AA123BB o ABC123",
    };
  }
  return { ok: true, value: cleaned };
}

/** ¿El texto parece ser una patente y nada más? */
export function looksLikePatente(input: string): boolean {
  const cleaned = input.toUpperCase().replace(/^(PATENTE|DOMINIO)\s*:?\s*/i, "").replace(/[\s.\-_/]/g, "");
  return /^[A-Z0-9]{6,8}$/.test(cleaned) && /\d/.test(cleaned) && /[A-Z]/.test(cleaned);
}
