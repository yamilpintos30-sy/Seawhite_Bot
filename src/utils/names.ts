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

/** Nombre completo presentable: "MENTASTI, PEDRO CARLOS" -> "Pedro Carlos Mentasti". */
export function nombreCompleto(razonSocial: string | null | undefined): string {
  const raw = (razonSocial ?? "").trim();
  if (!raw) return "";
  const comma = raw.indexOf(",");
  const full = comma >= 0 ? `${raw.slice(comma + 1).trim()} ${raw.slice(0, comma).trim()}` : raw;
  const words = full.split(/\s+/).filter((w) => /^[a-záéíóúüñ.'-]+$/i.test(w));
  if (words.length === 0) return "";
  return words.map(titleCase).join(" ");
}
