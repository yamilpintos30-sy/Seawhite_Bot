/**
 * Límite diario de consultas por conversación (anti-abuso).
 *
 * Evita que un mismo chat genere gasto ilimitado en Claude o martille la API
 * SeaLink: cada conversación tiene un cupo de consultas POR DÍA (día calendario
 * en la zona horaria del bot). In-memory: un reinicio lo resetea, aceptable
 * para un límite de cortesía (no es facturación).
 */

export class DailyRateLimiter {
  /** "clave|díaKey" -> cantidad usada */
  private counters = new Map<string, number>();
  private currentDay = "";

  /**
   * Registra un uso y devuelve true si TODAVÍA está dentro del límite.
   * `limit <= 0` significa sin límite.
   */
  hit(key: string, limit: number, dayKey: string): boolean {
    if (limit <= 0) return true;
    // Cambio de día: se descartan todos los contadores viejos.
    if (dayKey !== this.currentDay) {
      this.counters.clear();
      this.currentDay = dayKey;
    }
    const k = `${key}|${dayKey}`;
    const used = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, used);
    return used <= limit;
  }

  clear(): void {
    this.counters.clear();
    this.currentDay = "";
  }
}

/** Instancia compartida por todos los handlers. */
export const dailyLimits = new DailyRateLimiter();
