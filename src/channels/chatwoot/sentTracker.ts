/**
 * Anti-eco: registro de lo que el bot acaba de enviar por conversación.
 *
 * Cuando el bot envía por la API con un token de perfil, Chatwoot dispara el
 * mismo mensaje como webhook "outgoing". Sin este registro habría dos errores
 * posibles (aprendido del BOT MIAMI):
 *   - confundir el eco del bot con un vendedor humano -> el bot se duerme solo;
 *   - confundir a un vendedor con el eco -> se pierde el handoff (el error grave).
 *
 * Guardamos EXACTAMENTE cada burbuja enviada (in-memory, con ventana de tiempo)
 * y comparamos por match exacto; se tolera substring sólo cuando el texto del
 * bot es sustancial (>=15 caracteres), nunca por palabras cortas como "dale".
 */

const WINDOW_MS = 180_000;
const MAX_PER_CONVERSATION = 30;

interface SentEntry {
  norm: string;
  at: number;
}

function normalize(text: string): string {
  return (text ?? "").trim().toLowerCase().split(/\s+/).join(" ");
}

export class SentTracker {
  private readonly sent = new Map<string, SentEntry[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Registra una burbuja que el bot acaba de enviar a una conversación. */
  record(conversationId: string, text: string): void {
    const norm = normalize(text);
    if (!conversationId || !norm) return;
    const at = this.now();
    const cutoff = at - WINDOW_MS;
    const list = (this.sent.get(conversationId) ?? []).filter((e) => e.at >= cutoff);
    list.push({ norm, at });
    this.sent.set(conversationId, list.slice(-MAX_PER_CONVERSATION));
  }

  /** ¿Este texto saliente es el eco de algo que el bot envió hace poco? */
  wasRecentlySent(conversationId: string, text: string): boolean {
    const norm = normalize(text);
    if (!conversationId || !norm) return false;
    const cutoff = this.now() - WINDOW_MS;
    for (const entry of this.sent.get(conversationId) ?? []) {
      if (entry.at < cutoff) continue;
      if (entry.norm === norm) return true;
      if (entry.norm.length >= 15 && (entry.norm.includes(norm) || norm.includes(entry.norm))) return true;
    }
    return false;
  }

  clear(): void {
    this.sent.clear();
  }
}

/** Instancia compartida entre el cliente (que registra) y el webhook (que consulta). */
export const sentTracker = new SentTracker();
