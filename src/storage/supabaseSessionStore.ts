/**
 * Persistencia de sesiones en Supabase (tabla `bot_sessions`, ver supabase/migrations).
 * Se usa la service-role key desde el servidor; nunca exponerla al cliente.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "../bot/types.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../utils/logger.js";
import type { SessionStore } from "./sessionStore.js";

export function createSupabaseClient(config: AppConfig): SupabaseClient | null {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface SessionRow {
  conversation_id: string;
  account_id: string;
  state: Session["state"];
  context: Session["context"];
  history: Session["history"];
  handed_off_until: string | null;
  contact: Session["contact"] | null;
  created_at: string;
  updated_at: string;
}

export class SupabaseSessionStore implements SessionStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  async get(conversationId: string): Promise<Session | null> {
    const { data, error } = await this.client.from("bot_sessions").select("*").eq("conversation_id", conversationId).maybeSingle<SessionRow>();
    if (error) {
      this.logger.error({ error, conversationId }, "Error leyendo sesión de Supabase");
      throw new Error(`Supabase get session: ${error.message}`);
    }
    if (!data) return null;
    return {
      conversationId: data.conversation_id,
      accountId: data.account_id,
      state: data.state,
      context: data.context ?? {},
      history: data.history ?? [],
      handedOffUntil: data.handed_off_until,
      contact: data.contact ?? undefined,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async save(session: Session): Promise<void> {
    const row: SessionRow = {
      conversation_id: session.conversationId,
      account_id: session.accountId,
      state: session.state,
      context: session.context,
      history: session.history,
      handed_off_until: session.handedOffUntil,
      contact: session.contact ?? null,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    };
    const { error } = await this.client.from("bot_sessions").upsert(row, { onConflict: "conversation_id" });
    if (error) {
      this.logger.error({ error, conversationId: session.conversationId }, "Error guardando sesión en Supabase");
      throw new Error(`Supabase save session: ${error.message}`);
    }
  }

  async delete(conversationId: string): Promise<void> {
    const { error } = await this.client.from("bot_sessions").delete().eq("conversation_id", conversationId);
    if (error) this.logger.error({ error, conversationId }, "Error borrando sesión en Supabase");
  }
}
