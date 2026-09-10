/**
 * Definición de menús. Para agregar una opción al menú principal (por ejemplo "B) LOGÍSTICA"),
 * alcanza con completar `target` con un estado nuevo y registrar su handler en `handlers/index.ts`.
 */
import { normalizeText } from "../utils/text.js";
import { BotState, type BotStateName } from "./types.js";

export interface MenuOption {
  /** Tecla que se muestra: "A", "1", "0"... */
  key: string;
  label: string;
  /** Línea aclaratoria que se muestra debajo de la opción (qué hace y dónde). */
  hint?: string;
  /** Palabras alternativas que también seleccionan la opción (se comparan normalizadas). */
  aliases: string[];
  /** Estado destino. `null` = opción aún no disponible. */
  target: BotStateName | null;
}

export interface Menu {
  id: BotStateName;
  title: string;
  options: MenuOption[];
  footer?: string;
}

export const MAIN_MENU: Menu = {
  id: BotState.MAIN_MENU,
  title: "¿Usted desea consultar por?",
  options: [
    { key: "A", label: "BALANZA", aliases: ["balanza", "1"], target: BotState.BALANZA_MENU },
    { key: "B", label: "A definir", aliases: ["2"], target: null },
    { key: "C", label: "A definir", aliases: ["3"], target: null },
  ],
  footer: "Respondé con la letra de la opción.",
};

export const BALANZA_MENU: Menu = {
  id: BotState.BALANZA_MENU,
  title: "*BALANZA* — ¿Qué necesitás?",
  options: [
    {
      key: "1",
      label: "Carga de Documentación",
      hint: "Dudas para cargar en la página web: qué poner en cada campo, formatos, rechazos",
      aliases: ["carga", "carga de documentacion", "documentacion", "cargar"],
      target: BotState.CARGA_DOC,
    },
    {
      key: "2",
      label: "Documentación de Chofer",
      hint: "Consultá acá mismo los vencimientos de un chofer con su DNI",
      aliases: ["chofer", "choferes", "documentacion de chofer", "dni"],
      target: BotState.CHOFER_DNI,
    },
    {
      key: "3",
      label: "Documentación de Camión o Acoplado",
      hint: "Consultá acá mismo los vencimientos de un vehículo con su patente",
      aliases: ["camion", "camiones", "acoplado", "acoplados", "patente", "dominio", "vehiculo"],
      target: BotState.CAMION_DOMINIO,
    },
    { key: "0", label: "Volver al menú principal", aliases: ["volver", "menu", "atras"], target: BotState.MAIN_MENU },
  ],
  footer: "Respondé con el número de la opción.",
};

/**
 * Estado inicial de una conversación. Mientras el menú principal tenga UNA sola
 * opción real (BALANZA), se saltea y se arranca directo en ella — mostrar un
 * menú de una opción con "a definir" es hacer elegir al pedo. Cuando B o C
 * tengan destino, el menú principal vuelve a aparecer automáticamente.
 */
export function startState(): BotStateName {
  const disponibles = MAIN_MENU.options.filter((o) => o.target !== null);
  return disponibles.length === 1 ? disponibles[0]!.target! : BotState.MAIN_MENU;
}

/** Texto del menú listo para WhatsApp. */
export function renderMenu(menu: Menu): string {
  const lines = [menu.title, ""];
  for (const opt of menu.options) {
    const suffix = opt.target === null ? " _(próximamente)_" : "";
    lines.push(`*${opt.key})* ${opt.label}${suffix}`);
    if (opt.hint) lines.push(`   _${opt.hint}_`);
  }
  if (menu.footer) lines.push("", menu.footer);
  return lines.join("\n");
}

/** Busca la opción elegida por el usuario. Devuelve undefined si no coincide con nada. */
export function matchOption(menu: Menu, input: string): MenuOption | undefined {
  const text = normalizeText(input);
  if (!text) return undefined;
  // Coincidencia exacta con la tecla ("a", "1", "a)", "opcion a")
  const keyOnly = text.replace(/^(opcion|la|el)\s+/, "").replace(/[)\-.]+$/, "").trim();
  const byKey = menu.options.find((o) => o.key.toLowerCase() === keyOnly);
  if (byKey) return byKey;
  // Coincidencia exacta con un alias o con la etiqueta completa
  const exact = menu.options.find((o) => normalizeText(o.label) === text || o.aliases.includes(text));
  if (exact) return exact;
  // Coincidencia parcial: gana la opción cuyo alias (o etiqueta) más largo aparece en el texto
  let best: { option: MenuOption; length: number } | undefined;
  for (const option of menu.options) {
    for (const candidate of [normalizeText(option.label), ...option.aliases]) {
      if (candidate.length >= 4 && text.includes(candidate) && (!best || candidate.length > best.length)) {
        best = { option, length: candidate.length };
      }
    }
  }
  return best?.option;
}
