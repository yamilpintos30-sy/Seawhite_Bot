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

/**
 * Red de seguridad del tono: borra "che" y un "Dale," inicial si la IA los usa
 * pese a la prohibición del prompt (visto en producción: "Entiendo, che.").
 */
export function removeColloquialisms(text: string): string {
  return text
    .replace(/,\s*che\b(?=\s*[.,!?:;]|\s*$)/gim, "")
    .replace(/(^|[.!?]\s+|\n)che,?\s+(\p{L})/gimu, (_m, pre: string, letter: string) => `${pre}${letter.toUpperCase()}`)
    .replace(/(^|\n)dale[,!.]\s+(\p{L})/gimu, (_m, pre: string, letter: string) => `${pre}${letter.toUpperCase()}`);
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

/**
 * WhatsApp rechaza botones si el texto que los acompaña supera 1024 caracteres.
 * Parte un texto largo en [cabeza, cola] donde la cola entra con los botones.
 * Corta preferentemente entre párrafos, después entre líneas y por último entre
 * palabras, dejando en la cola la mayor parte posible del final.
 */
export function splitForButtons(text: string, maxLength = 1000): string[] {
  if (text.length <= maxLength) return [text];
  const minTailStart = text.length - maxLength;
  for (const sep of ["\n\n", "\n", " "]) {
    let idx = text.indexOf(sep, Math.max(1, minTailStart - sep.length));
    while (idx !== -1) {
      const head = text.slice(0, idx).trimEnd();
      const tail = text.slice(idx + sep.length).trimStart();
      if (head && tail && tail.length <= maxLength) return [head, tail];
      idx = text.indexOf(sep, idx + 1);
    }
  }
  return [text.slice(0, minTailStart), text.slice(minTailStart)];
}
