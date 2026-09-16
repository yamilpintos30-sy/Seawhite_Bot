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

/**
 * DNI dentro de un CUIT/CUIL ("20-38925270-1" -> "38925270"). Se valida el
 * dígito verificador para no confundir un CUIT con cualquier número de 11
 * cifras (una póliza, un teléfono). Devuelve undefined si no es un CUIT.
 */
export function dniFromCuit(digits: string): string | undefined {
  if (!/^(20|23|24|25|26|27|30|33|34)\d{9}$/.test(digits)) return undefined;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(digits[i]), 0);
  const resto = suma % 11;
  const verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  if (verificador !== Number(digits[10])) return undefined;
  return digits.slice(2, 10).replace(/^0+/, "");
}

/** DNI: acepta "30.123.456", "30123456", "dni 30123456" y también el CUIT/CUIL que lo contiene. */
export function normalizeDni(input: string): ValidationResult {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 0) {
    return { ok: false, value: "", error: "No encontré un número de DNI en el mensaje. Escribilo sólo con números, sin puntos. Ejemplo: 30123456" };
  }
  if (digits.length === 11) {
    const desdeCuit = dniFromCuit(digits);
    if (desdeCuit) return { ok: true, value: desdeCuit };
    return {
      ok: false,
      value: digits,
      error: "Ese número de 11 cifras no es un CUIT/CUIL válido. Revisalo o mandame directamente el DNI (7 u 8 números, sin puntos). Ejemplo: 30123456",
    };
  }
  if (digits.length < 7 || digits.length > 8) {
    return {
      ok: false,
      value: digits,
      error: "El DNI tiene que tener 7 u 8 números, sin puntos. También podés mandarme el CUIT o CUIL completo. Ejemplo: 30123456",
    };
  }
  return { ok: true, value: digits };
}

/**
 * DNI escrito dentro de una frase ("quiero revisar también 92791217", "el 30.123.456").
 * Devuelve los dígitos sólo si hay UN único número de 7 u 8 cifras; no toma
 * partes de números más largos ni de CUIT/CUIL con guiones.
 */
export function findDniInText(input: string): string | undefined {
  // Primero los CUIT/CUIL ("20-38925270-1"): contienen un DNI adentro.
  const cuits = new Set(
    ((input.match(/(?<!\d)\d{2}[\s.\-]?\d{8}[\s.\-]?\d(?!\d)/g) ?? []).map((m) => dniFromCuit(m.replace(/\D/g, ""))).filter(Boolean) as string[]),
  );
  if (cuits.size === 1) return [...cuits][0];
  const found = new Set((input.match(/(?<![\d.\-])\d{1,2}\.?\d{3}\.?\d{3}(?!\d|[.\-]\d)/g) ?? []).map((m) => m.replace(/\D/g, "")));
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * Patente escrita dentro de una frase ("y la del acoplado AB 123 CD?"). Sólo
 * formatos reales (AA123BB, ABC123, 1234ABC) y sólo si hay UNA en el texto.
 */
export function findPatenteInText(input: string): string | undefined {
  const pattern = /(?<![A-Z0-9])([A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}|[A-Z]{3}[\s-]?\d{3}|\d{3,4}[\s-]?[A-Z]{3})(?![A-Z0-9])/g;
  const found = new Set((input.toUpperCase().match(pattern) ?? []).map((m) => m.replace(/[\s-]/g, "")));
  return found.size === 1 ? [...found][0] : undefined;
}

/** ¿El texto es un DNI (o el CUIT/CUIL que lo contiene) y nada más? */
export function looksLikeDni(input: string): boolean {
  const cleaned = input.replace(/[\s.\-]/g, "").replace(/^(dni|cuit|cuil):?/i, "");
  if (/^\d{7,8}$/.test(cleaned)) return true;
  return cleaned.length === 11 && dniFromCuit(cleaned) !== undefined;
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
