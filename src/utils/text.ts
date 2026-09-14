/** Utilidades de texto para interpretar mensajes del usuario y formatear respuestas. */

/**
 * Minúsculas, sin tildes, sin emojis ni símbolos, sin espacios repetidos.
 * Clave para los botones: "Menú 😊" debe normalizar a "menu" — sin limpiar el
 * emoji, el toque del botón no coincidía con el comando y terminaba en la IA.
 * Se conservan letras, números, espacios y "/" (por el comando /bot).
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convierte markdown "clásico" (lo que suele producir un modelo) al formato de WhatsApp.
 * - **negrita** -> *negrita*
 * - ### Título  -> *Título*
 * - "- item"    -> "• item"
 */
export function toWhatsAppFormat(text: string): string {
  return text
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** WhatsApp limita cada mensaje a 4096 caracteres; partimos por párrafos si hace falta. */
export function splitForWhatsApp(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n\n/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxLength && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.flatMap((c) => (c.length > maxLength ? c.match(new RegExp(`[\\s\\S]{1,${maxLength}}`, "g")) ?? [c] : [c]));
}
