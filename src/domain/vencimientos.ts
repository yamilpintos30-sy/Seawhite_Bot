/**
 * Lógica de negocio de vencimientos.
 *
 * Reglas del manual SeaLink:
 *   Fecha de vencimiento <  hoy  => VENCIDO
 *   Fecha de vencimiento >= hoy  => VIGENTE
 *   Fecha de vencimiento = null  => SIN FECHA INFORMADA
 *
 * Además replicamos el aviso de la plataforma: "15 días por vencer".
 */
import { type CalendarDate, diffDays, formatShort, parseCalendarDate } from "../utils/dates.js";

export type EstadoVencimiento = "VIGENTE" | "POR_VENCER" | "VENCIDO" | "SIN_FECHA";

export const DIAS_AVISO_POR_VENCER = 15;

export interface Vencimiento {
  /** Nombre legible del documento: "Licencia de conducir", "ART", etc. */
  documento: string;
  /** Fecha original devuelta por la API (o null). */
  fechaRaw: string | null;
  fecha: CalendarDate | null;
  estado: EstadoVencimiento;
  /** Días que faltan (negativo si ya venció). undefined si no hay fecha. */
  diasRestantes?: number;
}

export function clasificarVencimiento(documento: string, fechaRaw: string | null | undefined, hoy: CalendarDate): Vencimiento {
  const fecha = parseCalendarDate(fechaRaw ?? null);
  if (!fecha) {
    return { documento, fechaRaw: fechaRaw ?? null, fecha: null, estado: "SIN_FECHA" };
  }
  const dias = diffDays(hoy, fecha);
  let estado: EstadoVencimiento;
  if (dias < 0) estado = "VENCIDO";
  else if (dias <= DIAS_AVISO_POR_VENCER) estado = "POR_VENCER";
  else estado = "VIGENTE";
  return { documento, fechaRaw: fechaRaw ?? null, fecha, estado, diasRestantes: dias };
}

const ICONO: Record<EstadoVencimiento, string> = {
  VIGENTE: "✅",
  POR_VENCER: "⚠️",
  VENCIDO: "❌",
  SIN_FECHA: "➖",
};

export function describirEstado(v: Vencimiento): string {
  switch (v.estado) {
    case "VIGENTE":
      return `vigente (vence el ${formatShort(v.fecha!)})`;
    case "POR_VENCER":
      return v.diasRestantes === 0
        ? `vence HOY (${formatShort(v.fecha!)})`
        : `vigente, pero vence en ${v.diasRestantes} día${v.diasRestantes === 1 ? "" : "s"} (${formatShort(v.fecha!)})`;
    case "VENCIDO":
      return `VENCIDO desde el ${formatShort(v.fecha!)}`;
    case "SIN_FECHA":
      return "sin fecha informada";
  }
}

/** Una línea de WhatsApp por documento: "✅ *ART:* vigente (vence el 15/09/2026)". */
export function lineaVencimiento(v: Vencimiento): string {
  return `${ICONO[v.estado]} *${v.documento}:* ${describirEstado(v)}`;
}

/** Resumen general: "Toda la documentación está vigente." / "Hay documentación vencida: ART." */
export function resumenGeneral(vencimientos: Vencimiento[]): string {
  const vencidos = vencimientos.filter((v) => v.estado === "VENCIDO");
  const porVencer = vencimientos.filter((v) => v.estado === "POR_VENCER");
  const sinFecha = vencimientos.filter((v) => v.estado === "SIN_FECHA");

  const partes: string[] = [];
  if (vencidos.length) partes.push(`❌ Documentación vencida: ${vencidos.map((v) => v.documento).join(", ")}.`);
  if (porVencer.length) partes.push(`⚠️ Próximo a vencer: ${porVencer.map((v) => v.documento).join(", ")}. Conviene renovar antes del vencimiento.`);
  if (sinFecha.length) partes.push(`➖ Sin fecha informada: ${sinFecha.map((v) => v.documento).join(", ")}.`);
  if (partes.length === 0) partes.push("✅ Toda la documentación consultada está vigente.");
  return partes.join("\n");
}

/** Representación compacta para pasarle a la IA como contexto (sin ambigüedad de formato). */
export function vencimientosParaIA(vencimientos: Vencimiento[]): Record<string, unknown>[] {
  return vencimientos.map((v) => ({
    documento: v.documento,
    fecha_vencimiento: v.fecha ? `${v.fecha.year}-${String(v.fecha.month).padStart(2, "0")}-${String(v.fecha.day).padStart(2, "0")}` : null,
    estado: v.estado,
    dias_restantes: v.diasRestantes ?? null,
  }));
}
