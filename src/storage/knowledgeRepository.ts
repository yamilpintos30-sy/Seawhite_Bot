/**
 * Contexto del bot guardado en Supabase (tabla `bot_knowledge`).
 *
 * Existe porque el panel web permite reemplazar el contexto y en Render el disco
 * es efímero: lo que se sube tiene que sobrevivir a los reinicios y deploys.
 * Si no hay Supabase configurado, el bot sigue usando los archivos de `knowledge/`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "../utils/logger.js";

/** Un documento de contexto tal como está guardado. */
export interface KnowledgeDocument {
  id: string;
  content: string;
  note?: string;
  updatedAt: Date;
}

export interface KnowledgeVersion {
  id: number;
  note?: string;
  chars: number;
  createdAt: Date;
}

export class KnowledgeRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  /** Documentos vigentes (vacío = el bot usa los archivos del repo). */
  async list(): Promise<KnowledgeDocument[]> {
    const { data, error } = await this.client.from("bot_knowledge").select("*").order("id");
    if (error) throw new Error(`No se pudo leer el contexto: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: String(row.id),
      content: String(row.content ?? ""),
      note: row.note ? String(row.note) : undefined,
      updatedAt: new Date(String(row.updated_at)),
    }));
  }

  /** Reemplaza el contexto y guarda la versión anterior en el historial. */
  async save(id: string, content: string, note?: string): Promise<void> {
    const previous = (await this.list()).find((d) => d.id === id);
    if (previous) {
      const { error } = await this.client
        .from("bot_knowledge_versions")
        .insert({ knowledge_id: id, content: previous.content, note: previous.note ?? null });
      if (error) this.logger.warn({ error }, "No se pudo archivar la versión anterior del contexto");
    }

    const { error } = await this.client
      .from("bot_knowledge")
      .upsert({ id, content, note: note ?? null, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw new Error(`No se pudo guardar el contexto: ${error.message}`);
    this.logger.info({ id, chars: content.length, note }, "Contexto del bot actualizado desde el panel");
  }

  /** Versiones anteriores (sin el texto completo, que puede ser enorme). */
  async versions(id: string, limit = 20): Promise<KnowledgeVersion[]> {
    const { data, error } = await this.client
      .from("bot_knowledge_versions")
      .select("id, note, content, created_at")
      .eq("knowledge_id", id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: Number(row.id),
      note: row.note ? String(row.note) : undefined,
      chars: String(row.content ?? "").length,
      createdAt: new Date(String(row.created_at)),
    }));
  }

  /** Restaura una versión anterior (la actual queda archivada como una más). */
  async restore(versionId: number): Promise<string> {
    const { data, error } = await this.client.from("bot_knowledge_versions").select("*").eq("id", versionId).maybeSingle();
    if (error || !data) throw new Error("No encontré esa versión del contexto");
    const id = String(data.knowledge_id);
    await this.save(id, String(data.content ?? ""), `restaurada del ${new Date(String(data.created_at)).toLocaleString("es-AR")}`);
    return id;
  }
}
