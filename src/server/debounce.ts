/**
 * Buffer de mensajes ("debounce"): mucha gente escribe su consulta en varios
 * mensajes seguidos. En vez de responder cada renglón, el bot junta todo y
 * responde UNA vez, N segundos después del último mensaje.
 *
 * Excepciones que se procesan AL INSTANTE (esperar acá arruinaría la experiencia):
 *   - toques de botón y opciones de menú ("1", "2", "3", títulos de botones)
 *   - comandos globales (menu, volver, ayuda...) y "/bot"
 *   - un DNI o una patente solos (son la respuesta a una pregunta puntual)
 * Si había mensajes en buffer y llega uno instantáneo, se procesa todo junto ya.
 */
import { detectGlobalCommand } from "../bot/commands.js";
import { BALANZA_MENU, MAIN_MENU } from "../bot/menus.js";
import type { IncomingMessage } from "../bot/types.js";
import { looksLikeDni, looksLikePatente } from "../domain/validators.js";
import { normalizeText } from "../utils/text.js";

const INSTANT_EXACT = new Set<string>([
  ...MAIN_MENU.options.map((o) => o.key.toLowerCase()),
  ...BALANZA_MENU.options.map((o) => o.key.toLowerCase()),
  ...BALANZA_MENU.options.flatMap((o) => (o.buttonTitle ? [normalizeText(o.buttonTitle)] : [])),
  "/bot",
  "bot",
  // Saludos: nadie escribe más después de un "hola"; esperar 7 s ahí es puro lag.
  "hola",
  "holaa",
  "buenas",
  "buen dia",
  "buenos dias",
  "buenas tardes",
  "buenas noches",
  "hey",
]);

export function isInstantMessage(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  if (INSTANT_EXACT.has(t)) return true;
  if (detectGlobalCommand(text) !== undefined) return true;
  if (looksLikeDni(text) || looksLikePatente(text)) return true;
  return false;
}

interface Pending {
  messages: IncomingMessage[];
  timer: NodeJS.Timeout;
}

export class MessageDebouncer {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly waitMs: number,
    private readonly onFlush: (merged: IncomingMessage) => void,
  ) {}

  push(message: IncomingMessage): void {
    // Debounce apagado: todo pasa directo.
    if (this.waitMs <= 0) {
      this.onFlush(message);
      return;
    }

    const existing = this.pending.get(message.conversationId);

    // Foto/archivo sin texto: no hay nada que "juntar"; el motor responde ya
    // con el aviso de que no procesa archivos + el menú.
    const soloAdjunto = message.text.trim() === "" && message.attachments.length > 0;

    if (soloAdjunto || (isInstantMessage(message.text) && message.attachments.length === 0)) {
      // Instantáneo: si había buffer, se suma y sale todo junto ahora.
      if (existing) {
        clearTimeout(existing.timer);
        existing.messages.push(message);
        this.flush(message.conversationId);
      } else {
        this.onFlush(message);
      }
      return;
    }

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(message);
      existing.timer = setTimeout(() => this.flush(message.conversationId), this.waitMs);
    } else {
      this.pending.set(message.conversationId, {
        messages: [message],
        timer: setTimeout(() => this.flush(message.conversationId), this.waitMs),
      });
    }
  }

  /** Descarta el buffer de una conversación (por ejemplo, al resetearla). */
  clear(conversationId: string): void {
    const p = this.pending.get(conversationId);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(conversationId);
    }
  }

  private flush(conversationId: string): void {
    const p = this.pending.get(conversationId);
    if (!p) return;
    this.pending.delete(conversationId);
    const last = p.messages[p.messages.length - 1]!;
    const merged: IncomingMessage = {
      ...last,
      text: p.messages
        .map((m) => m.text.trim())
        .filter(Boolean)
        .join("\n"),
      attachments: p.messages.flatMap((m) => m.attachments),
    };
    this.onFlush(merged);
  }
}
