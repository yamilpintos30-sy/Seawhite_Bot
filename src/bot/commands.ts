/**
 * Comandos globales: funcionan en cualquier estado.
 *   - "menu" / "inicio"        -> vuelve al menú principal
 *   - "volver" / "atrás"       -> vuelve al menú anterior
 *   - "humano" / "persona"...  -> deriva la conversación a un agente
 *   - "ayuda"                  -> explica cómo usar el bot
 */
import { normalizeText } from "../utils/text.js";

export type GlobalCommand = "MAIN_MENU" | "BACK" | "HANDOFF" | "HELP";

const COMMANDS: Array<{ command: GlobalCommand; words: string[] }> = [
  { command: "MAIN_MENU", words: ["menu", "menu principal", "inicio", "empezar", "reiniciar", "salir"] },
  { command: "BACK", words: ["volver", "atras", "volver atras", "anterior"] },
  {
    command: "HANDOFF",
    words: ["humano", "persona", "agente", "operador", "asesor", "hablar con alguien", "hablar con una persona", "quiero hablar con alguien"],
  },
  { command: "HELP", words: ["ayuda", "help", "como funciona", "que podes hacer", "opciones"] },
];

/** "quiero hablar con una persona", "me pasás con un operador", "necesito un humano"... */
const HANDOFF_PHRASE = /\b(hablar|comunicar|contactar|pasa(r|me|s)|quiero|necesito|prefiero)\b.*\b(alguien|persona|humano|agente|operador|asesor)\b/;

export function detectGlobalCommand(input: string): GlobalCommand | undefined {
  const text = normalizeText(input);
  if (!text || text.length > 60) return undefined; // frases largas son consultas, no comandos
  for (const { command, words } of COMMANDS) {
    if (words.includes(text)) return command;
  }
  if (HANDOFF_PHRASE.test(text)) return "HANDOFF";
  return undefined;
}

export const HELP_TEXT = [
  "Podés navegar el asistente con estos atajos:",
  "• *menu* → volver al menú principal",
  "• *volver* → volver al menú anterior",
  "• *persona* → hablar con alguien de SEA WHITE",
  "",
  "En *Carga de Documentación* escribí tu consulta con tus palabras (por ejemplo: _¿qué pongo en DNI?_). También podés mandar una captura o un PDF.",
].join("\n");
