/**
 * Reconocimiento de DNI/CUIT y patentes en CUALQUIER pantalla donde el usuario
 * pueda escribirlos (menú y Carga de Documentación).
 *
 * Existe porque la IA NO puede consultar el sistema: si un DNI o una patente le
 * llegan a ella, responde promesas que nunca se cumplen ("ya te consulto los
 * vencimientos, un segundo") o deriva al menú por algo que se podía resolver
 * en el acto. Todo dato consultable se atiende acá, con la API real.
 */
import { findDniInText, findPatenteInText, looksLikeDni, looksLikePatente } from "../../domain/validators.js";
import { normalizeText } from "../../utils/text.js";
import { BotState, type HandlerContext, type HandlerResult } from "../types.js";
import { camionDominioHandler } from "./documentacionCamion.js";
import { choferDniHandler } from "./documentacionChofer.js";

/** El mensaje habla de un chofer / de un vehículo (para no confundir una póliza con un DNI). */
const HABLA_DE_CHOFER = /\b(dni|cuit|cuil|chofer|choferes|conductor|documento)\b/;
const HABLA_DE_VEHICULO = /\b(patente|dominio|camion|camiones|acoplado|acoplados|semi|chasis|vehiculo|tractor)\b/;

/**
 * Si el mensaje trae un DNI/CUIT o una patente, consulta y devuelve la respuesta.
 * Devuelve undefined si no hay nada consultable (entonces contesta la IA).
 * Dentro de una frase sólo se toma el dato si la frase habla del chofer o del
 * vehículo: "mi póliza 12345678 fue rechazada" es una consulta, no un DNI.
 */
export async function tryLookupFromText(ctx: HandlerContext): Promise<HandlerResult | undefined> {
  const text = normalizeText(ctx.message.text);

  if (looksLikeDni(ctx.message.text) || (HABLA_DE_CHOFER.test(text) && findDniInText(ctx.message.text))) {
    ctx.session.state = BotState.CHOFER_DNI;
    return choferDniHandler.handle(ctx);
  }
  if (looksLikePatente(ctx.message.text) || (HABLA_DE_VEHICULO.test(text) && findPatenteInText(ctx.message.text))) {
    ctx.session.state = BotState.CAMION_DOMINIO;
    return camionDominioHandler.handle(ctx);
  }
  return undefined;
}
