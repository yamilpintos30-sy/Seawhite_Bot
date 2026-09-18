/**
 * Análisis de las conversaciones con IA para el panel: de qué preguntan, qué
 * errores de carga aparecen más y de qué se quejan.
 *
 * Es una llamada aparte de la del bot (otro prompt, sin base de conocimiento) y
 * se cachea: analizar cientos de mensajes en cada visita al panel sería caro.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "../config.js";
import type { Logger } from "../utils/logger.js";
import type { IncomingRow } from "./statsRepository.js";

export interface InsightGroup {
  titulo: string;
  cantidad: number;
  detalle: string;
  ejemplos: string[];
}

export interface Insights {
  resumen: string;
  temas: InsightGroup[];
  errores: InsightGroup[];
  quejas: InsightGroup[];
  sugerencias: string[];
  mensajesAnalizados: number;
  generadoEl: string;
}

/** Guarda el último análisis de cada período (tabla `bot_insights`). */
export interface InsightsCache {
  get(clave: string): Promise<Insights | null>;
  set(clave: string, insights: Insights): Promise<void>;
}

const SYSTEM = `Analizás conversaciones reales de un bot de WhatsApp de SEA WHITE S.A., una empresa de transporte.
Los usuarios son choferes y administrativos que cargan documentación (ART, carnet, VTV, seguros, formulario 931, tarjeta verde) en la página web de la empresa, y consultan vencimientos.

Te paso los mensajes que ESCRIBIERON LOS USUARIOS (no las respuestas del bot). Tu tarea es resumir, para el equipo de SEA WHITE, qué está pasando.

Devolvé SOLO un JSON válido, sin texto alrededor, con esta forma exacta:
{
  "resumen": "2 o 3 frases con lo más importante del período",
  "temas": [{"titulo":"...","cantidad":0,"detalle":"...","ejemplos":["...","..."]}],
  "errores": [{"titulo":"...","cantidad":0,"detalle":"...","ejemplos":["..."]}],
  "quejas": [{"titulo":"...","cantidad":0,"detalle":"...","ejemplos":["..."]}],
  "sugerencias": ["...", "..."]
}

Reglas:
- "temas": sobre qué consultan, agrupado (máximo 8, de mayor a menor).
- "errores": problemas concretos al cargar documentación en la web (campos que no toma, archivos que no suben, rechazos), máximo 6.
- "quejas": malestar con el bot, con la web o con la empresa, máximo 5. Si no hay, devolvé lista vacía.
- "sugerencias": qué convendría agregar a la base de conocimiento o arreglar en la web, máximo 5, concretas.
- "cantidad" es cuántos mensajes de los que te pasé entran en ese grupo (número aproximado, nunca inventado).
- "ejemplos" son frases TEXTUALES y cortas de los usuarios (máximo 2 por grupo).
- Escribí en español rioplatense, claro y directo. No inventes nada que no esté en los mensajes.`;

export class InsightsService {
  private readonly client: Anthropic;
  private memoria = new Map<string, Insights>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly cache?: InsightsCache,
  ) {
    this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 180_000 });
  }

  /** Último análisis guardado de ese período, sin generar nada (respuesta instantánea). */
  async ultimo(dias: number): Promise<Insights | null> {
    const clave = `dias:${dias}`;
    const enMemoria = this.memoria.get(clave);
    if (enMemoria) return enMemoria;
    try {
      const guardado = (await this.cache?.get(clave)) ?? null;
      if (guardado) this.memoria.set(clave, guardado);
      return guardado;
    } catch (err) {
      this.logger.warn({ err }, "No se pudo leer el último análisis guardado");
      return null;
    }
  }

  async analyze(mensajes: IncomingRow[], dias: number): Promise<Insights> {
    const clave = `dias:${dias}`;

    if (mensajes.length === 0) {
      return { resumen: "Todavía no hay consultas en este período.", temas: [], errores: [], quejas: [], sugerencias: [], mensajesAnalizados: 0, generadoEl: new Date().toISOString() };
    }

    const lista = mensajes.map((m) => `[${m.fecha} · ${m.estado}] ${m.texto}`).join("\n");
    const response = await this.client.messages.create({
      model: this.config.CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Mensajes de los últimos ${dias} días (${mensajes.length}):\n\n${lista}` }],
    });

    const texto = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const insights: Insights = {
      ...this.parse(texto),
      mensajesAnalizados: mensajes.length,
      generadoEl: new Date().toISOString(),
    };
    this.logger.info({ dias, mensajes: mensajes.length, usage: response.usage }, "Análisis de conversaciones generado");
    this.memoria.set(clave, insights);
    // Guardarlo no puede hacer fallar el análisis que ya está listo.
    await this.cache?.set(clave, insights).catch((err) => this.logger.warn({ err }, "No se pudo guardar el análisis"));
    return insights;
  }

  /** El modelo devuelve JSON; si viene con texto alrededor, se recorta al objeto. */
  private parse(texto: string): Omit<Insights, "mensajesAnalizados" | "generadoEl"> {
    const inicio = texto.indexOf("{");
    const fin = texto.lastIndexOf("}");
    if (inicio === -1 || fin === -1) throw new Error("El análisis no devolvió JSON");
    const data = JSON.parse(texto.slice(inicio, fin + 1)) as Partial<Insights>;
    const grupos = (g: unknown): InsightGroup[] =>
      Array.isArray(g)
        ? g.map((x) => ({
            titulo: String((x as InsightGroup).titulo ?? ""),
            cantidad: Number((x as InsightGroup).cantidad ?? 0),
            detalle: String((x as InsightGroup).detalle ?? ""),
            ejemplos: Array.isArray((x as InsightGroup).ejemplos) ? (x as InsightGroup).ejemplos.map(String).slice(0, 2) : [],
          }))
        : [];
    return {
      resumen: String(data.resumen ?? ""),
      temas: grupos(data.temas),
      errores: grupos(data.errores),
      quejas: grupos(data.quejas),
      sugerencias: Array.isArray(data.sugerencias) ? data.sugerencias.map(String).slice(0, 5) : [],
    };
  }
}
