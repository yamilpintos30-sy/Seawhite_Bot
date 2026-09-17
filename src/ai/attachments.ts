/**
 * Descarga los adjuntos que el usuario manda por WhatsApp (fotos del carnet, de
 * la póliza, capturas del error de la página) y los convierte al formato que
 * acepta Claude: imagen o PDF en base64.
 *
 * Claude analiza JPEG, PNG, GIF y WEBP como imagen, y PDF como documento. Lo que
 * no entra en esa lista (audios, HEIC del iPhone, Word) no se puede leer: se
 * devuelve un aviso para el usuario en vez de un error.
 */
import type { Logger } from "../utils/logger.js";
import type { AiAttachment } from "./types.js";

export interface IncomingAttachment {
  url: string;
  /** Tipo según Chatwoot: "image", "file", "audio", "video"... */
  fileType?: string;
  contentType?: string;
}

export interface AttachmentDownloadResult {
  attachments: AiAttachment[];
  /** Avisos para el usuario sobre adjuntos que no se pudieron leer. */
  warnings: string[];
}

/** Tope por archivo (el límite de la API de Claude para imágenes es del mismo orden). */
const MAX_BYTES = 5 * 1024 * 1024;
/** Cuántos archivos se analizan por mensaje (el resto se avisa). */
const MAX_ATTACHMENTS = 3;

type ImageMediaType = Extract<AiAttachment, { kind: "image" }>["mediaType"];
const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/webp"] satisfies ImageMediaType[]);

const AVISO_PESADO = "Ese archivo es muy pesado para poder abrirlo. Mandámelo con menos calidad o contame por escrito qué dice.";
const AVISO_AUDIO = "Por ahora no puedo escuchar audios. ¿Me lo escribís en un mensaje?";
const AVISO_FORMATO = "No pude abrir ese archivo: puedo leer fotos (JPG, PNG) y PDF. Si es otro formato, contame por escrito qué dice.";
const AVISO_ERROR = "No pude abrir el archivo que mandaste. Probá enviarlo de nuevo o contame por escrito qué dice.";

export async function downloadAttachments(incoming: IncomingAttachment[], logger: Logger, timeoutMs = 20000): Promise<AttachmentDownloadResult> {
  const result: AttachmentDownloadResult = { attachments: [], warnings: [] };
  if (incoming.length > MAX_ATTACHMENTS) {
    result.warnings.push(`Puedo mirar hasta ${MAX_ATTACHMENTS} archivos por vez, así que voy con los primeros.`);
  }

  for (const item of incoming.slice(0, MAX_ATTACHMENTS)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(item.url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = (res.headers.get("content-type") ?? item.contentType ?? "").split(";")[0]!.trim().toLowerCase();
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_BYTES) {
        result.warnings.push(AVISO_PESADO);
        continue;
      }

      if (IMAGE_TYPES.has(contentType)) {
        result.attachments.push({ kind: "image", mediaType: contentType as ImageMediaType, base64: buffer.toString("base64") });
      } else if (contentType === "application/pdf") {
        result.attachments.push({ kind: "pdf", base64: buffer.toString("base64") });
      } else if (item.fileType === "audio" || contentType.startsWith("audio/")) {
        result.warnings.push(AVISO_AUDIO);
      } else {
        logger.info({ contentType, fileType: item.fileType }, "Adjunto de formato no analizable");
        result.warnings.push(AVISO_FORMATO);
      }
    } catch (err) {
      logger.warn({ err, url: item.url }, "No se pudo descargar un adjunto");
      result.warnings.push(AVISO_ERROR);
    }
  }

  return result;
}
