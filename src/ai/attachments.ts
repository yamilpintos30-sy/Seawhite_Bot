/**
 * Descarga adjuntos de Chatwoot (fotos/PDF que manda el usuario por WhatsApp)
 * y los convierte al formato que acepta Claude (imagen o documento en base64).
 *
 * Formatos que Claude acepta como imagen: JPEG, PNG, GIF, WEBP. Un HEIC del iPhone,
 * por ejemplo, no se puede analizar: se avisa y se le recuerda al usuario que la
 * plataforma sólo admite JPG o PDF.
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
  /** Mensajes para el usuario sobre adjuntos que no se pudieron procesar. */
  warnings: string[];
}

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function downloadAttachments(
  incoming: IncomingAttachment[],
  logger: Logger,
  timeoutMs = 15000,
): Promise<AttachmentDownloadResult> {
  const result: AttachmentDownloadResult = { attachments: [], warnings: [] };

  for (const item of incoming) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(item.url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = (res.headers.get("content-type") ?? item.contentType ?? "").split(";")[0]!.trim().toLowerCase();
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_BYTES) {
        result.warnings.push("El archivo que mandaste es muy pesado para analizarlo por acá. Mejor contame por escrito qué dice (por ejemplo, copiá el texto del rechazo) y te ayudo.");
        continue;
      }

      if (IMAGE_TYPES.has(contentType)) {
        result.attachments.push({ kind: "image", mediaType: contentType as never, base64: buffer.toString("base64") });
      } else if (contentType === "application/pdf") {
        result.attachments.push({ kind: "pdf", base64: buffer.toString("base64") });
      } else if (item.fileType === "audio" || contentType.startsWith("audio/")) {
        result.warnings.push("Por ahora no puedo escuchar audios. ¿Me lo escribís en un mensaje de texto?");
      } else {
        result.warnings.push(
          "No pude abrir ese archivo por acá. Mejor contame por escrito lo que necesitás (por ejemplo, copiá el texto del motivo de rechazo) y te ayudo. Recordá que la página de SEA WHITE admite únicamente JPG o PDF.",
        );
      }
    } catch (err) {
      logger.warn({ err, url: item.url }, "No se pudo descargar un adjunto");
      result.warnings.push("No pude abrir el archivo que mandaste. Contame por escrito qué dice y te ayudo igual.");
    }
  }

  return result;
}
