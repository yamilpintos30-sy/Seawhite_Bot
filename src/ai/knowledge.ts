/**
 * Base de conocimiento editable.
 *
 * Requisito del esquema: "el archivo debe poder ser editado fácilmente por nosotros,
 * sin modificar el programa". Por eso:
 *   - Se leen TODOS los archivos .md / .txt de la carpeta `knowledge/`, en orden alfabético.
 *   - Se recargan solos cuando cambian (se revisa la fecha de modificación cada N segundos).
 *   - No hace falta reiniciar el bot para que tome los cambios.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../utils/logger.js";

export interface KnowledgeSnapshot {
  /** Texto completo, concatenado, que se envía al modelo. */
  text: string;
  /** Archivos incluidos (para logs). */
  files: string[];
  /** Firma usada para detectar cambios. */
  signature: string;
  loadedAt: Date;
}

export interface KnowledgeStoreOptions {
  dir: string;
  reloadSeconds: number;
  logger: Logger;
}

export class KnowledgeStore {
  private snapshot: KnowledgeSnapshot | null = null;
  private lastCheck = 0;
  private loading: Promise<KnowledgeSnapshot> | null = null;

  constructor(private readonly opts: KnowledgeStoreOptions) {}

  /** Devuelve la base de conocimiento vigente (recargando si cambió en disco). */
  async get(): Promise<KnowledgeSnapshot> {
    const now = Date.now();
    const shouldCheck = !this.snapshot || now - this.lastCheck > this.opts.reloadSeconds * 1000;
    if (!shouldCheck) return this.snapshot!;

    if (this.loading) return this.loading;
    this.loading = this.reloadIfChanged().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async reloadIfChanged(): Promise<KnowledgeSnapshot> {
    this.lastCheck = Date.now();
    const files = await this.listFiles();
    const stats = await Promise.all(files.map((f) => stat(f)));
    const signature = files.map((f, i) => `${path.basename(f)}:${stats[i]!.mtimeMs}:${stats[i]!.size}`).join("|");

    if (this.snapshot && this.snapshot.signature === signature) return this.snapshot;

    const parts = await Promise.all(
      files.map(async (f) => {
        const content = (await readFile(f, "utf8")).trim();
        return `<!-- archivo: ${path.basename(f)} -->\n${content}`;
      }),
    );

    this.snapshot = {
      text: parts.join("\n\n---\n\n"),
      files: files.map((f) => path.basename(f)),
      signature,
      loadedAt: new Date(),
    };
    this.opts.logger.info({ files: this.snapshot.files, chars: this.snapshot.text.length }, "Base de conocimiento cargada");
    return this.snapshot;
  }

  private async listFiles(): Promise<string[]> {
    const entries = await readdir(this.opts.dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.(md|txt)$/i.test(e.name) && !e.name.startsWith("."))
      .map((e) => path.join(this.opts.dir, e.name))
      .sort((a, b) => a.localeCompare(b, "es"));
  }
}
