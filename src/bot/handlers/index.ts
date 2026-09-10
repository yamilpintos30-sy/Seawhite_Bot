/**
 * Registro de handlers por estado.
 * Para agregar una funcionalidad nueva: crear el handler, agregar el estado en `types.ts`
 * y registrarlo acá. `PARENT_STATE` define a dónde lleva el comando "volver".
 */
import { BotState, type BotStateName, type StateHandler } from "../types.js";
import { cargaDocumentacionHandler } from "./cargaDocumentacion.js";
import { camionDominioHandler, camionQaHandler } from "./documentacionCamion.js";
import { choferDniHandler, choferQaHandler } from "./documentacionChofer.js";
import { balanzaMenuHandler, mainMenuHandler } from "./menuHandlers.js";

const HANDLERS: StateHandler[] = [
  mainMenuHandler,
  balanzaMenuHandler,
  cargaDocumentacionHandler,
  choferDniHandler,
  choferQaHandler,
  camionDominioHandler,
  camionQaHandler,
];

export const handlerRegistry: ReadonlyMap<BotStateName, StateHandler> = new Map(HANDLERS.map((h) => [h.state, h]));

/** Estado "padre" de cada estado, para el comando "volver". */
export const PARENT_STATE: Record<BotStateName, BotStateName> = {
  [BotState.MAIN_MENU]: BotState.MAIN_MENU,
  [BotState.BALANZA_MENU]: BotState.MAIN_MENU,
  [BotState.CARGA_DOC]: BotState.BALANZA_MENU,
  [BotState.CHOFER_DNI]: BotState.BALANZA_MENU,
  [BotState.CHOFER_QA]: BotState.CHOFER_DNI,
  [BotState.CAMION_DOMINIO]: BotState.BALANZA_MENU,
  [BotState.CAMION_QA]: BotState.CAMION_DOMINIO,
};

export function getHandler(state: BotStateName): StateHandler {
  const handler = handlerRegistry.get(state);
  if (!handler) throw new Error(`No hay handler registrado para el estado ${state}`);
  return handler;
}
