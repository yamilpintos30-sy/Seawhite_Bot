/**
 * Opción 1 — Carga de Documentación.
 * Preguntas libres respondidas con IA a partir de la base de conocimiento (`knowledge/`).
 */
import { type HandlerContext, type HandlerResult, type StateHandler, BotState } from "../types.js";
import { tryLookupFromText } from "./lookupRouting.js";
import { answerWithAi } from "./shared.js";

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
      ].join("\n"),
    ];
  },

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    // Un DNI/CUIT o una patente escritos acá se CONSULTAN igual que en el menú.
    return (await tryLookupFromText(ctx)) ?? answerWithAi(ctx, "carga");
  },
};
