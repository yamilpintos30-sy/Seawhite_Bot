/**
 * Opción 3 — Documentación de Camión o Acoplado.
 *   CAMION_DOMINIO : pide la patente, consulta la API SeaLink y muestra los vencimientos.
 *   CAMION_QA      : responde preguntas sobre esos datos con IA; si escriben otra patente, re-consulta.
 */
import { SeaLinkError } from "../../integrations/sealink/types.js";
import { clasificarVencimiento, lineaVencimiento, resumenGeneral, vencimientosParaIA } from "../../domain/vencimientos.js";
import { findPatenteInText, looksLikePatente, normalizePatente } from "../../domain/validators.js";
import { todayInTimeZone } from "../../utils/dates.js";
import { BotState, type HandlerContext, type HandlerResult, type StateHandler } from "../types.js";
import { answerWithAi, LIMITE_DIARIO_CONSULTAS, withinLookupLimit } from "./shared.js";

const PEDIR_DOMINIO = "Escribí la *patente (dominio)* del camión o acoplado, toda junta, sin espacios ni guiones. Ejemplo: AA123BB";

export const camionDominioHandler: StateHandler = {
  state: BotState.CAMION_DOMINIO,

  enter(ctx: HandlerContext): string[] {
    ctx.session.history = [];
    ctx.session.context.camion = undefined;
    return [`*Documentación de Camión o Acoplado* 🚛\n\n${PEDIR_DOMINIO}`];
  },

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    return consultarCamion(ctx);
  },
};

export const camionQaHandler: StateHandler = {
  state: BotState.CAMION_QA,

  enter(): string[] {
    return ["¿Querés preguntarme algo sobre esta documentación? También podés escribir otra patente."];
  },

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    // Otra patente, sola o dentro de una frase: se consulta directo.
    if (looksLikePatente(ctx.message.text) || findPatenteInText(ctx.message.text)) {
      return consultarCamion(ctx);
    }
    const data = ctx.session.context.camion;
    if (!data) {
      return { messages: [PEDIR_DOMINIO], nextState: BotState.CAMION_DOMINIO, skipEnter: true };
    }
    return answerWithAi(ctx, "camion", data);
  },
};

// -----------------------------------------------------------------------------

async function consultarCamion(ctx: HandlerContext): Promise<HandlerResult> {
  const { message, services, session } = ctx;
  const patente = normalizePatente(findPatenteInText(message.text) ?? message.text);
  if (!patente.ok) {
    return { messages: [patente.error!] };
  }
  if (!withinLookupLimit(ctx)) {
    return { messages: [LIMITE_DIARIO_CONSULTAS] };
  }

  let lookup;
  try {
    lookup = await services.sealink.consultarCamion(patente.value);
  } catch (err) {
    const detail = err instanceof SeaLinkError ? err.message : String(err);
    services.logger.error({ err: detail, dominio: patente.value }, "Error consultando camión en SeaLink");
    return {
      messages: ["No pude consultar el sistema de vencimientos en este momento. Probá de nuevo en unos minutos o comunicate con SEA WHITE."],
    };
  }

  if (!lookup.found) {
    return {
      messages: [`No encontré ningún camión o acoplado con la patente *${patente.value}*. Revisá que esté bien escrita y volvé a intentarlo, o tocá el botón *Menú* acá abajo.`],
    };
  }

  const hoy = todayInTimeZone(services.config.TIMEZONE, services.now());
  const vencimientos = [
    clasificarVencimiento("Seguro", lookup.seguroVto, hoy),
    clasificarVencimiento("VTV / RTO", lookup.vtvVto, hoy),
  ];

  session.context.camion = {
    dominio: lookup.dominio,
    vencimientos: vencimientosParaIA(vencimientos),
  };
  session.history = [];

  const detalle = [`Documentación del dominio *${lookup.dominio}*:`, "", ...vencimientos.map(lineaVencimiento), "", resumenGeneral(vencimientos)].join("\n");

  return {
    messages: [detalle, "¿Querés preguntarme algo sobre esta documentación? También podés escribir otra patente."],
    nextState: BotState.CAMION_QA,
    skipEnter: true,
  };
}
