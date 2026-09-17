/**
 * Armado de dependencias ("composition root").
 * Todo lo que necesita configuración real se instancia acá, una sola vez.
 */
import path from "node:path";
import { ClaudeService } from "./ai/claudeService.js";
import { KnowledgeStore } from "./ai/knowledge.js";
import { BotEngine } from "./bot/engine.js";
import type { BotServices } from "./bot/types.js";
import { ChatwootClient } from "./channels/chatwoot/client.js";
import { loadConfig, type AppConfig } from "./config.js";
import { SeaLinkClient } from "./integrations/sealink/client.js";
import { NoopMessageLog, SupabaseMessageLog, type MessageLog } from "./storage/messageLog.js";
import { KnowledgeRepository } from "./storage/knowledgeRepository.js";
import { createSessionStore, type SessionStore } from "./storage/sessionStore.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "./storage/supabaseSessionStore.js";
import { logger, type Logger } from "./utils/logger.js";

export interface Container {
  config: AppConfig;
  logger: Logger;
  services: BotServices;
  sessions: SessionStore;
  messageLog: MessageLog;
  engine: BotEngine;
  chatwoot: ChatwootClient;
  sealink: SeaLinkClient;
  knowledge: KnowledgeStore;
  /** Contexto guardado en Supabase (sólo si Supabase está configurado). */
  knowledgeRepo?: KnowledgeRepository;
  /** Cliente de Supabase (null si no está configurado): lo usa el panel para las estadísticas. */
  supabase: SupabaseClient | null;
}

export function buildContainer(config: AppConfig = loadConfig()): Container {
  const supabase = createSupabaseClient(config);
  // Contexto subido desde el panel web (Supabase). Si no hay Supabase, el bot
  // usa los archivos de knowledge/ del repositorio.
  const knowledgeRepo = supabase ? new KnowledgeRepository(supabase, logger) : undefined;

  const knowledge = new KnowledgeStore({
    dir: path.resolve(process.cwd(), config.KNOWLEDGE_DIR),
    reloadSeconds: config.KNOWLEDGE_RELOAD_SECONDS,
    logger,
    source: knowledgeRepo,
  });

  const ai = new ClaudeService(config, knowledge, logger);

  const sealink = new SeaLinkClient({
    baseUrl: config.SEALINK_BASE_URL,
    email: config.SEALINK_EMAIL,
    password: config.SEALINK_PASSWORD,
    servidor: config.SEALINK_SERVIDOR,
    timeoutMs: config.SEALINK_TIMEOUT_MS,
    logger,
  });

  const services: BotServices = { ai, sealink, config, logger, now: () => new Date() };

  const sessions = createSessionStore(config, logger);
  const messageLog: MessageLog = supabase ? new SupabaseMessageLog(supabase, logger) : new NoopMessageLog();

  const engine = new BotEngine({ services, sessions, messageLog });

  const chatwoot = new ChatwootClient({
    baseUrl: config.CHATWOOT_BASE_URL,
    apiToken: config.CHATWOOT_API_TOKEN,
    accountId: config.CHATWOOT_ACCOUNT_ID,
    logger,
    welcomeImagePath: config.WELCOME_IMAGE ? path.resolve(process.cwd(), config.WELCOME_IMAGE) : undefined,
  });

  return { config, logger, services, sessions, messageLog, engine, chatwoot, sealink, knowledge, knowledgeRepo, supabase };
}
