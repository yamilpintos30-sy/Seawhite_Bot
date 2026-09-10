/**
 * Configuración central del bot.
 *
 * Todas las variables de entorno se validan acá con Zod al arrancar.
 * Si falta algo obligatorio el proceso falla rápido con un mensaje claro,
 * en lugar de romperse en medio de una conversación.
 */
import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : ["1", "true", "yes", "si", "sí"].includes(v.toLowerCase())));

const schema = z.object({
  // --- Servidor HTTP ---
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  TIMEZONE: z.string().default("America/Argentina/Buenos_Aires"),

  // --- Chatwoot ---
  CHATWOOT_BASE_URL: z.string().url().default("https://app.chatwoot.com"),
  CHATWOOT_API_TOKEN: z.string().min(1, "CHATWOOT_API_TOKEN es obligatorio"),
  CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive(),
  /**
   * Filtro de inbox. Los webhooks de Chatwoot son A NIVEL CUENTA: si la cuenta
   * tiene varios inboxes (u otros bots), poné acá el inbox_id de ESTE bot para
   * ignorar el resto. Vacío = sin filtro.
   */
  CHATWOOT_INBOX_ID: z.string().optional(),
  /** Token compartido para validar que el webhook realmente viene de Chatwoot. */
  WEBHOOK_SECRET: z.string().min(8, "WEBHOOK_SECRET debe tener al menos 8 caracteres"),
  /** Estados de conversación en los que el bot responde (separados por coma). */
  BOT_ACTIVE_STATUSES: z.string().default("pending,open"),
  /** Estado al que pasa la conversación al derivar. "none" = no tocar el estado. */
  HANDOFF_STATUS: z.enum(["open", "pending", "none"]).default("none"),
  /** Minutos que el bot se mantiene en silencio después de derivar a una persona. */
  HANDOFF_SILENCE_MINUTES: z.coerce.number().int().positive().default(120),

  // --- Claude ---
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY es obligatorio"),
  CLAUDE_MODEL: z.string().default("claude-opus-5"),
  CLAUDE_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  CLAUDE_MAX_TOKENS: z.coerce.number().int().positive().default(1500),
  /** TTL del prompt caching de la base de conocimiento: "5m" o "1h". */
  CLAUDE_CACHE_TTL: z.enum(["5m", "1h"]).default("1h"),
  /** Habilita el fallback automático del lado del servidor ante un "refusal". */
  CLAUDE_FALLBACKS: booleanFromEnv.default(true),

  // --- Base de conocimiento ---
  KNOWLEDGE_DIR: z.string().default("knowledge"),
  /** Cada cuántos segundos se revisa si los archivos de conocimiento cambiaron. */
  KNOWLEDGE_RELOAD_SECONDS: z.coerce.number().int().positive().default(30),

  // --- SeaLink (API de vencimientos) ---
  SEALINK_BASE_URL: z.string().url().default("https://api.seawhite.com.ar:9443"),
  SEALINK_EMAIL: z.string().min(1, "SEALINK_EMAIL es obligatorio"),
  SEALINK_PASSWORD: z.string().min(1, "SEALINK_PASSWORD es obligatorio"),
  SEALINK_SERVIDOR: z.string().default("1"),
  SEALINK_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

  // --- Supabase (opcional: si falta, se usa memoria) ---
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // --- Sesiones ---
  /** Minutos de inactividad tras los cuales la conversación vuelve al menú principal. */
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  /** Cantidad máxima de turnos (usuario+bot) que se conservan como contexto para la IA. */
  HISTORY_MAX_TURNS: z.coerce.number().int().positive().default(10),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

/**
 * Devuelve la configuración validada. Lanza un error legible si falta algo.
 * Se puede pasar `overrides` en tests para no depender del entorno real.
 */
export function loadConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  if (cached && Object.keys(overrides).length === 0) return cached;

  // Las variables vacías ("SUPABASE_URL=") se tratan como no definidas.
  const source = Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(([, v]) => v !== undefined && String(v).trim() !== ""),
  );
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida. Revisá el archivo .env:\n${issues}`);
  }
  if (Object.keys(overrides).length === 0) cached = parsed.data;
  return parsed.data;
}

export function activeStatuses(config: AppConfig): Set<string> {
  return new Set(
    config.BOT_ACTIVE_STATUSES.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
