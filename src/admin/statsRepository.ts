/**
 * Estadísticas del panel, calculadas sobre la tabla `bot_messages`
 * (todo lo que entra y sale del bot queda registrado ahí).
 *
 * Todo se agrega en memoria: el volumen es chico (cientos de mensajes por día)
 * y así no hace falta crear vistas ni funciones en Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DailyPoint {
  /** Fecha YYYY-MM-DD en la zona horaria del bot. */
  fecha: string;
  personas: number;
  conversaciones: number;
  mensajes: number;
}

export interface StatsSummary {
  desde: string;
  hasta: string;
  totalPersonas: number;
  totalConversaciones: number;
  totalMensajes: number;
  promedioMensajesPorConversacion: number;
  porDia: DailyPoint[];
  porHora: Array<{ hora: number; mensajes: number }>;
  /** Cuánto se usó cada parte del bot (estado en el que estaba el usuario). */
  porSeccion: Array<{ seccion: string; mensajes: number }>;
}

/** Mensaje entrante ya normalizado (lo usa el análisis con IA). */
export interface IncomingRow {
  conversationId: string;
  fecha: string;
  estado: string;
  texto: string;
}

const SECCIONES: Record<string, string> = {
  MAIN_MENU: "Menú principal",
  BALANZA_MENU: "Menú",
  CARGA_DOC: "Carga de documentos",
  CHOFER_DNI: "Chofer por DNI",
  CHOFER_QA: "Chofer (preguntas)",
  CAMION_DOMINIO: "Camión por patente",
  CAMION_QA: "Camión (preguntas)",
  CERRADA: "Conversación cerrada",
};

interface MessageRow {
  conversation_id: string;
  direction: string;
  content: string | null;
  state: string | null;
  meta: { sender?: { phone?: string | null } | null } | null;
  created_at: string;
}

export class StatsRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly timeZone: string,
  ) {}

  /** Trae los mensajes de los últimos `dias` días (tope defensivo de filas). */
  private async rows(dias: number, limit = 20000): Promise<MessageRow[]> {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from("bot_messages")
      .select("conversation_id, direction, content, state, meta, created_at")
      .gte("created_at", desde)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`No se pudieron leer los mensajes: ${error.message}`);
    return (data ?? []) as MessageRow[];
  }

  /** Fecha (YYYY-MM-DD) y hora local del bot para un timestamp. */
  private local(iso: string): { fecha: string; hora: number } {
    const d = new Date(iso);
    const partes = new Intl.DateTimeFormat("sv-SE", {
      timeZone: this.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
    return { fecha: `${get("year")}-${get("month")}-${get("day")}`, hora: Number(get("hour")) };
  }

  async summary(dias: number): Promise<StatsSummary> {
    const rows = await this.rows(dias);
    const entrantes = rows.filter((r) => r.direction === "in");

    const porDia = new Map<string, { personas: Set<string>; conversaciones: Set<string>; mensajes: number }>();
    const porHora = new Map<number, number>();
    const porSeccion = new Map<string, number>();
    const personas = new Set<string>();
    const conversaciones = new Set<string>();

    for (const row of entrantes) {
      const { fecha, hora } = this.local(row.created_at);
      const persona = row.meta?.sender?.phone ?? row.conversation_id;

      const dia = porDia.get(fecha) ?? { personas: new Set<string>(), conversaciones: new Set<string>(), mensajes: 0 };
      dia.personas.add(persona);
      dia.conversaciones.add(row.conversation_id);
      dia.mensajes += 1;
      porDia.set(fecha, dia);

      porHora.set(hora, (porHora.get(hora) ?? 0) + 1);
      const seccion = SECCIONES[row.state ?? ""] ?? "Otros";
      porSeccion.set(seccion, (porSeccion.get(seccion) ?? 0) + 1);

      personas.add(persona);
      conversaciones.add(row.conversation_id);
    }

    const dias_ordenados = [...porDia.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, d]) => ({ fecha, personas: d.personas.size, conversaciones: d.conversaciones.size, mensajes: d.mensajes }));

    return {
      desde: dias_ordenados[0]?.fecha ?? "",
      hasta: dias_ordenados[dias_ordenados.length - 1]?.fecha ?? "",
      totalPersonas: personas.size,
      totalConversaciones: conversaciones.size,
      totalMensajes: entrantes.length,
      promedioMensajesPorConversacion: conversaciones.size === 0 ? 0 : Number((entrantes.length / conversaciones.size).toFixed(1)),
      porDia: dias_ordenados,
      porHora: Array.from({ length: 24 }, (_, hora) => ({ hora, mensajes: porHora.get(hora) ?? 0 })),
      porSeccion: [...porSeccion.entries()].sort((a, b) => b[1] - a[1]).map(([seccion, mensajes]) => ({ seccion, mensajes })),
    };
  }

  /** Mensajes de los usuarios, para que la IA los analice (temas, errores, quejas). */
  async consultas(dias: number, maxMensajes = 500): Promise<IncomingRow[]> {
    const rows = await this.rows(dias);
    return rows
      .filter((r) => r.direction === "in" && (r.content ?? "").trim().length > 2)
      .slice(-maxMensajes)
      .map((r) => ({
        conversationId: r.conversation_id,
        fecha: this.local(r.created_at).fecha,
        estado: SECCIONES[r.state ?? ""] ?? "Otros",
        texto: (r.content ?? "").trim().slice(0, 500),
      }));
  }
}
