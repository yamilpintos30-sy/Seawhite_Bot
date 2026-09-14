/**
 * Tipos centrales del bot: estados, sesión, mensaje entrante y respuesta.
 *
 * El bot es una máquina de estados simple. Cada estado tiene un "handler"
 * (ver `handlers/`) que decide qué responder y a qué estado pasar.
 */
import type { AiService, ChatTurn } from "../ai/types.js";
import type { SeaLinkService } from "../integrations/sealink/types.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../utils/logger.js";

/** Adjunto que llega por el webhook. Se registra pero NUNCA se procesa (política: sin fotos). */
export interface IncomingAttachment {
  url: string;
  /** Tipo según Chatwoot: "image", "file", "audio", "video"... */
  fileType?: string;
  contentType?: string;
}

export const BotState = {
  MAIN_MENU: "MAIN_MENU",
  BALANZA_MENU: "BALANZA_MENU",
  CARGA_DOC: "CARGA_DOC",
  CHOFER_DNI: "CHOFER_DNI",
  CHOFER_QA: "CHOFER_QA",
  CAMION_DOMINIO: "CAMION_DOMINIO",
  CAMION_QA: "CAMION_QA",
} as const;

export type BotStateName = (typeof BotState)[keyof typeof BotState];

/** Datos que cada estado necesita recordar entre mensajes. */
export interface SessionContext {
  /** Último chofer consultado (modo chofer). */
  chofer?: Record<string, unknown>;
  /** Último camión/acoplado consultado (modo camión). */
  camion?: Record<string, unknown>;
}

export interface Session {
  conversationId: string;
  accountId: string;
  state: BotStateName;
  context: SessionContext;
  /** Historial corto para darle memoria a la IA dentro del modo actual. */
  history: ChatTurn[];
  /** Si está seteado y es futuro, el bot no responde (una persona tomó la conversación). */
  handedOffUntil: string | null;
  /** Datos del contacto. `displayName` es el nombre según SeaLink (por teléfono), para saludar. */
  contact?: { name?: string; phone?: string; displayName?: string };
  createdAt: string;
  updatedAt: string;
}

export interface IncomingMessage {
  id: string;
  conversationId: string;
  accountId: string;
  text: string;
  attachments: IncomingAttachment[];
  sender?: { name?: string; phone?: string };
  /** Estado de la conversación en Chatwoot en el momento del mensaje. */
  conversationStatus?: string;
}

/** Botón interactivo de WhatsApp (máximo 3 por mensaje, títulos de hasta 20 caracteres). */
export interface ButtonSpec {
  title: string;
  /** Valor que puede volver como respuesta al tocarlo (además del título). */
  payload: string;
}

/**
 * Mensaje "enriquecido" para canales que soportan imágenes y botones (WhatsApp
 * vía Chatwoot). Si `rich` está presente, el canal lo usa; si no (o si el canal
 * no soporta botones, como la CLI), se usan los `messages` de texto plano.
 */
export type RichOutbound =
  | { kind: "text"; text: string }
  | { kind: "image"; caption: string }
  | { kind: "buttons"; text: string; buttons: ButtonSpec[] };

/** Lo que el motor devuelve a la capa de canal (Chatwoot, CLI, tests). */
export interface BotReply {
  messages: string[];
  /** Versión enriquecida (foto de Enri, botones). Los `messages` quedan como respaldo. */
  rich?: RichOutbound[];
  /** Si es true, la capa de canal debe pasar la conversación a una persona. */
  handoff?: boolean;
  /** Si es true, la conversación terminó (despedida): sin botones de pie ni seguimientos. */
  reset?: boolean;
}

/** Servicios que reciben los handlers (inyectados para poder testear con dobles). */
export interface BotServices {
  ai: AiService;
  sealink: SeaLinkService;
  config: AppConfig;
  logger: Logger;
  now: () => Date;
}

export interface HandlerContext {
  session: Session;
  message: IncomingMessage;
  services: BotServices;
}

export interface HandlerResult {
  messages: string[];
  /** Estado al que pasar. Si se omite, se mantiene el actual. */
  nextState?: BotStateName;
  /** Si es true, el handler se encarga de mostrar la entrada del nuevo estado; si no, el motor llama a `enter()`. */
  skipEnter?: boolean;
  handoff?: boolean;
}

export interface StateHandler {
  state: BotStateName;
  /** Mensajes que se muestran al ENTRAR en el estado (por ejemplo, un menú o una instrucción). */
  enter(ctx: HandlerContext): Promise<string[]> | string[];
  /** Procesa un mensaje del usuario estando en este estado. */
  handle(ctx: HandlerContext): Promise<HandlerResult>;
}
