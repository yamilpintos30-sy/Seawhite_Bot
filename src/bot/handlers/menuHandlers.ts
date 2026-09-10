/**
 * Handlers de los menús (principal y BALANZA). Son genéricos: cualquier menú definido
 * en `menus.ts` se maneja con `createMenuHandler`.
 */
import { matchOption, renderMenu, BALANZA_MENU, MAIN_MENU, type Menu } from "../menus.js";
import type { HandlerContext, HandlerResult, StateHandler } from "../types.js";

/** Saludo inicial (lo antepone el motor al primer menú): por el nombre si SeaLink identificó el teléfono. */
export function welcomeLine(botName: string, displayName?: string): string {
  return displayName
    ? `¡Hola, ${displayName}! 👋 Soy *${botName}*, el asistente virtual de *SEA WHITE S.A.*`
    : `¡Hola! 👋 Soy *${botName}*, el asistente virtual de *SEA WHITE S.A.*`;
}

export function createMenuHandler(menu: Menu): StateHandler {
  return {
    state: menu.id,

    enter(): string[] {
      return [renderMenu(menu)];
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

export const mainMenuHandler = createMenuHandler(MAIN_MENU);
export const balanzaMenuHandler = createMenuHandler(BALANZA_MENU);
