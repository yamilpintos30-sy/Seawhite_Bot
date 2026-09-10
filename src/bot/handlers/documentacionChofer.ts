/**
 * Opción 2 — Documentación de Chofer.
 *   CHOFER_DNI : pide el DNI, consulta la API SeaLink y muestra los vencimientos.
 *   CHOFER_QA  : responde preguntas sobre esos datos con IA; si escriben otro DNI, re-consulta.
 */
import { SeaLinkError } from "../../integrations/sealink/types.js";
import { clasificarVencimiento, lineaVencimiento, resumenGeneral, vencimientosParaIA } from "../../domain/vencimientos.js";
import { looksLikeDni, normalizeDni } from "../../domain/validators.js";
import { todayInTimeZone } from "../../utils/dates.js";
import { BotState, type HandlerContext, type HandlerResult, type StateHandler } from "../types.js";
import { answerWithAi, HINT_NAVEGACION } from "./shared.js";

const PEDIR_DNI = "Escribí el *DNI del chofer* (sólo números, sin puntos). Ejemplo: 30123456";

export const choferDniHandler: StateHandler = {
  state: BotState.CHOFER_DNI,

  enter(ctx: HandlerContext): string[] {
    ctx.session.history = [];
    ctx.session.context.chofer = undefined;
    return [`*Documentación de Chofer* 👤\n\n${PEDIR_DNI}\n\n${HINT_NAVEGACION}`];
  },

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    return consultarChofer(ctx);
  },
};

export const choferQaHandler: StateHandler = {
  state: BotState.CHOFER_QA,

  enter(): string[] {
    return ["¿Querés preguntarme algo sobre esta documentación? También podés escribir otro DNI para consultar a otro chofer."];
  },

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    if (looksLikeDni(ctx.message.text)) {
      return consultarChofer(ctx);
    }
    const data = ctx.session.context.chofer;
    if (!data) {
      return { messages: [PEDIR_DNI], nextState: BotState.CHOFER_DNI, skipEnter: true };
    }
    const messages = await answerWithAi(ctx, "chofer", data);
    return { messages };
  },
};

// -----------------------------------------------------------------------------

async function consultarChofer(ctx: HandlerContext): Promise<HandlerResult> {
  const { message, services, session } = ctx;
  const dni = normalizeDni(message.text);
  if (!dni.ok) {
    return { messages: [dni.error!] };
  }

  let lookup;
  try {
    lookup = await services.sealink.consultarChofer(dni.value);
  } catch (err) {
    const detail = err instanceof SeaLinkError ? err.message : String(err);
    services.logger.error({ err: detail, dni: dni.value }, "Error consultando chofer en SeaLink");
    return {
      messages: ["No pude consultar el sistema de vencimientos en este momento. Probá de nuevo en unos minutos o comunicate con SEA WHITE."],
    };
  }

  if (!lookup.found) {
    return {
      messages: [`No encontré ningún chofer con el DNI *${dni.value}*. Revisá que esté bien escrito (sin puntos) y volvé a intentarlo, o escribí *volver* para ir al menú.`],
    };
  }

  const hoy = todayInTimeZone(services.config.TIMEZONE, services.now());
  const vencimientos = [
    clasificarVencimiento("Licencia de conducir", lookup.licenciaVto, hoy),
    clasificarVencimiento("Formulario 931", lookup.f931Vto, hoy),
    clasificarVencimiento("ART", lookup.artVto, hoy),
  ];

  session.context.chofer = {
    dni: lookup.dni,
    nombre: lookup.razonSocial || null,
    vencimientos: vencimientosParaIA(vencimientos),
  };
  session.history = [];

  const nombre = lookup.razonSocial ? `*${lookup.razonSocial}*` : "el chofer";
  const detalle = [
    `Encontré a ${nombre} (DNI ${lookup.dni}):`,
    "",
    ...vencimientos.map(lineaVencimiento),
    "",
    resumenGeneral(vencimientos),
  ].join("\n");

  return {
    messages: [detalle, "¿Querés preguntarme algo sobre esta documentación? También podés escribir otro DNI.\n\n" + HINT_NAVEGACION],
    nextState: BotState.CHOFER_QA,
    skipEnter: true,
  };
}
