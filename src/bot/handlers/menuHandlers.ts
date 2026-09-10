/**
 * Handlers de los menús (principal y BALANZA). Son genéricos: cualquier menú definido
 * en `menus.ts` se maneja con `createMenuHandler`.
 */
import { matchOption, renderMenu, BALANZA_MENU, MAIN_MENU, type Menu } from "../menus.js";
import type { HandlerContext, HandlerResult, StateHandler } from "../types.js";

/** Saludo del menú principal: por el nombre si SeaLink identificó al chofer por su teléfono. */
function welcome(botName: string, displayName?: string): string {
  return displayName
    ? `¡Hola, ${displayName}! 👋 Soy *${botName}*, el asistente virtual de *SEA WHITE S.A.*`
    : `¡Hola! 👋 Soy *${botName}*, el asistente virtual de *SEA WHITE S.A.*`;
}

export function createMenuHandler(menu: Menu, options: { welcome?: boolean } = {}): StateHandler {
  return {
    state: menu.id,

    enter(ctx: HandlerContext): string[] {
      const text = renderMenu(menu);
      return options.welcome
        ? [`${welcome(ctx.services.config.BOT_NAME, ctx.session.contact?.displayName)}\n\n${text}`]
        : [text];
    },

    async handle(ctx: HandlerContext): Promise<HandlerResult> {
      const option = matchOption(menu, ctx.message.text);

      if (!option) {
        return {
          messages: [`No entendí la opción. ${menu.footer ?? ""}`.trim(), renderMenu(menu)],
        };
      }
      if (option.target === null) {
        return {
          messages: [`La opción *${option.key}) ${option.label}* todavía no está disponible. Por ahora podés consultar por *BALANZA*.`, renderMenu(menu)],
        };
      }
      return { messages: [], nextState: option.target };
    },
  };
}

export const mainMenuHandler = createMenuHandler(MAIN_MENU, { welcome: true });
export const balanzaMenuHandler = createMenuHandler(BALANZA_MENU);
