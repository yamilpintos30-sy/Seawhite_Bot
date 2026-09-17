/** Contratos de la capa de IA. Mantenerlos chicos permite testear el bot sin llamar a Claude. */

export type AiMode = "carga" | "chofer" | "camion";

/** Turno de conversación guardado en la sesión (sólo texto, para poder persistirlo). */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Adjunto ya descargado y listo para mandarle a Claude (foto o PDF del usuario). */
export type AiAttachment =
  | { kind: "image"; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; base64: string }
  | { kind: "pdf"; base64: string };

export interface AiAnswerInput {
  mode: AiMode;
  history: ChatTurn[];
  userText: string;
  /** Fotos/PDF que mandó el usuario en ESTE mensaje (no se guardan en el historial). */
  attachments?: AiAttachment[];
  /** Datos de la API para modos chofer/camión. */
  data?: Record<string, unknown>;
}

export interface AiAnswerResult {
  text: string;
  /** Información de uso para logs/costos. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    model: string;
  };
}

export interface AiService {
  answer(input: AiAnswerInput): Promise<AiAnswerResult>;
}
