/**
 * Formateo de nombres. La API SeaLink devuelve la razón social como
 * "APELLIDO, NOMBRE" (o "APELLIDO NOMBRE"); para saludar usamos solo el
 * nombre de pila, con mayúscula inicial: "PEDROL, JOEL" -> "Joel".
 */

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Nombre de pila presentable a partir de la razón social. "" si no se puede. */
export function nombreDePila(razonSocial: string | null | undefined): string {
  const raw = (razonSocial ?? "").trim();
  if (!raw) return "";
  // "APELLIDO, NOMBRE SEGUNDO" -> tomamos lo que está después de la coma.
  const comma = raw.indexOf(",");
  const nombres = comma >= 0 ? raw.slice(comma + 1).trim() : raw;
  const first = nombres.split(/\s+/)[0] ?? "";
  if (!first || !/^[a-záéíóúüñ]+$/i.test(first)) return "";
  return titleCase(first);
}
