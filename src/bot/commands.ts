/**
 * Comandos globales: funcionan en cualquier estado.
 *   - "menu" / "inicio"        -> vuelve al menú principal
 *   - "volver" / "atrás"       -> vuelve al menú anterior
 *   - "humano" / "persona"...  -> deriva la conversación a un agente
 *   - "ayuda"                  -> explica cómo usar el bot
 */
import { normalizeText } from "../utils/text.js";

export type GlobalCommand = "MAIN_MENU" | "BACK" | "HANDOFF" | "HELP" | "FINISH";

const COMMANDS: Array<{ command: GlobalCommand; words: string[] }> = [
  // Un saludo en una conversación ya abierta lleva al menú real (con botones);
  // sin esto caía en la IA, que improvisaba un menú escrito (visto en producción).
  {
    command: "MAIN_MENU",
    words: ["menu", "menu principal", "inicio", "empezar", "reiniciar", "hola", "holaa", "buenas", "buen dia", "buenos dias", "buenas tardes", "buenas noches", "hey"],
  },
  { command: "BACK", words: ["volver", "atras", "volver atras", "anterior"] },
  // Botón "Eso es todo, gracias" y frases INEQUÍVOCAS de cierre. OJO: "gracias"
  // o "salir" solos NO cierran (un "gracias" de cortesía en medio de una consulta
  // borraba toda la conversación).
  { command: "FINISH", words: ["fin", "eso es todo gracias", "eso es todo", "nada mas", "listo gracias", "no gracias", "chau"] },
  {
    command: "HANDOFF",
    words: ["humano", "persona", "agente", "operador", "asesor", "hablar con alguien", "hablar con una persona", "quiero hablar con alguien"],
  },
  { command: "HELP", words: ["ayuda", "help", "como funciona", "que podes hacer", "opciones"] },
];

/** "quiero hablar con una persona", "me pasás con un operador", "necesito un humano"... */
const HANDOFF_PHRASE = /\b(hablar|comunicar|contactar|pasa(r|me|s)|quiero|necesito|prefiero)\b.*\b(alguien|persona|humano|agente|operador|asesor)\b/;

/** "quiero volver al menú principal", "llevame al menú", "salir al inicio"... */
const MENU_PHRASE = /\b(volver|volveme|regresar|salir|ir|llevame|mostra(r|me)?|quiero)\b.*\b(menu|inicio)\b/;

export function detectGlobalCommand(input: string): GlobalCommand | undefined {
  const text = normalizeText(input);
  if (!text || text.length > 60) return undefined; // frases largas son consultas, no comandos
  for (const { command, words } of COMMANDS) {
    if (words.includes(text)) return command;
  }
  if (HANDOFF_PHRASE.test(text)) return "HANDOFF";
  if (MENU_PHRASE.test(text)) return "MAIN_MENU";
  return undefined;
}

export function helpText(handoffEnabled: boolean): string {
  return [
    "Podés navegar el asistente con estos atajos:",
    "• *menu* → volver al menú principal",
    "• *volver* → volver al menú anterior",
    ...(handoffEnabled ? ["• *persona* → hablar con alguien de SEA WHITE"] : []),
    "",
    "En *Carga de Documentación* escribí tu consulta con tus palabras (por ejemplo: _¿qué pongo en DNI?_). También podés mandar una captura o un PDF.",
  ].join("\n");
}
