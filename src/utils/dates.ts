/**
 * Utilidades de fechas.
 *
 * La API de SeaLink devuelve fechas como "2027-03-10T00:00:00" (sin zona horaria).
 * Para no tener problemas de desfase, trabajamos siempre con fechas "de calendario"
 * (año, mes, día) y comparamos contra el día de hoy en la zona horaria configurada.
 */

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Parsea "YYYY-MM-DD..." o "DD/MM/YYYY". Devuelve null si no se puede interpretar. */
export function parseCalendarDate(value: string | null | undefined): CalendarDate | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }
  const latam = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (latam) {
    return { year: Number(latam[3]), month: Number(latam[2]), day: Number(latam[1]) };
  }
  return null;
}

/** Día de hoy (fecha de calendario) en la zona horaria indicada. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Número de días de a en el calendario proléptico (para diferencias exactas entre fechas). */
function toDayNumber(d: CalendarDate): number {
  return Math.round(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000);
}

/** b - a en días (positivo si b es posterior a a). */
export function diffDays(a: CalendarDate, b: CalendarDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** "10/03/2027" */
export function formatShort(d: CalendarDate): string {
  const dd = String(d.day).padStart(2, "0");
  const mm = String(d.month).padStart(2, "0");
  return `${dd}/${mm}/${d.year}`;
}

/** "10 de marzo de 2027" */
export function formatLong(d: CalendarDate): string {
  return `${d.day} de ${MESES[d.month - 1]} de ${d.year}`;
}

/** "2027-03-10" (útil para pasarle la fecha a la IA sin ambigüedad). */
export function formatIso(d: CalendarDate): string {
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}
