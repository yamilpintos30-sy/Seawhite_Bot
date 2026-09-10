/** Contrato de persistencia de sesiones + fábrica según configuración. */
import type { Session } from "../bot/types.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../utils/logger.js";
import { MemorySessionStore } from "./memorySessionStore.js";
import { createSupabaseClient, SupabaseSessionStore } from "./supabaseSessionStore.js";

export interface SessionStore {
  get(conversationId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(conversationId: string): Promise<void>;
}

/** Usa Supabase si está configurado; si no, memoria (sólo para desarrollo). */
export function createSessionStore(config: AppConfig, logger: Logger): SessionStore {
  const supabase = createSupabaseClient(config);
  if (supabase) {
    logger.info("Sesiones persistidas en Supabase");
    return new SupabaseSessionStore(supabase, logger);
  }
  logger.warn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no configurados: las sesiones se guardan en memoria (se pierden al reiniciar)");
  return new MemorySessionStore();
}
