/**
 * Opción 1 — Carga de Documentación.
 * Preguntas libres respondidas con IA a partir de la base de conocimiento (`knowledge/`).
 */
import { BotState, type HandlerContext, type HandlerResult, type StateHandler } from "../types.js";
import { answerWithAi, HINT_NAVEGACION } from "./shared.js";

export const cargaDocumentacionHandler: StateHandler = {
  state: BotState.CARGA_DOC,

  enter(ctx: HandlerContext): string[] {
    ctx.session.history = [];
    return [
      [
        "*Carga de Documentación* 📄",
        "",
        "Contame tu consulta con tus palabras. Por ejemplo:",
        "• _¿Qué pongo en el campo DNI?_",
        "• _¿Puedo subir una foto en PNG?_",
        "• _Me rechazaron la ART, ¿qué reviso?_",
        "",
        "Si querés, también podés mandarme una captura o un PDF.",
        "",
        HINT_NAVEGACION,
      ].join("\n"),
    ];
  },

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    const messages = await answerWithAi(ctx, "carga");
    return { messages };
  },
};
