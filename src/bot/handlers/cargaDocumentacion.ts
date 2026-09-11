/**
 * Opción 1 — Carga de Documentación.
 * Preguntas libres respondidas con IA a partir de la base de conocimiento (`knowledge/`).
 */
import { BotState, type HandlerContext, type HandlerResult, type StateHandler } from "../types.js";
import { answerWithAi, MENU_HINT } from "./shared.js";

export const cargaDocumentacionHandler: StateHandler = {
  state: BotState.CARGA_DOC,

  enter(ctx: HandlerContext): string[] {
    ctx.session.history = [];
    return [
      [
        "*Carga de Documentación* 📄",
        "",
        "Atención: la carga se hace en la *página web de SEA WHITE*, no por acá. Yo te ayudo con las dudas para que no te la rechacen. Por ejemplo:",
        "• _¿Qué pongo en el campo DNI?_",
        "• _¿Puedo subir una foto en PNG?_",
        "• _Me rechazaron la ART, ¿qué reviso?_",
        "",
        MENU_HINT,
      ].join("\n"),
    ];
  },

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    const messages = await answerWithAi(ctx, "carga");
    return { messages };
  },
};
