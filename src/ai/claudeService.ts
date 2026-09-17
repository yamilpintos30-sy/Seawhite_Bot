/**
 * Servicio de IA sobre la API de Claude (SDK oficial @anthropic-ai/sdk).
 *
 * Estructura de cada request (ordenada para maximizar el prompt caching):
 *   system  = [ BASE_SYSTEM + base de conocimiento ]  <- estable, con cache_control
 *   messages= [ ...historial, usuario actual, {role:"system", contexto dinámico} ]
 *
 * El contexto dinámico (modo, fecha, datos de la API) va como mensaje de sistema
 * al FINAL de la conversación: así no invalida el prefijo cacheado y además es el
 * canal seguro para instrucciones del operador (no puede ser falsificado por el usuario).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "../config.js";
import { formatIso, formatLong, todayInTimeZone } from "../utils/dates.js";
import type { Logger } from "../utils/logger.js";
import type { KnowledgeStore } from "./knowledge.js";
import { buildBaseSystem, buildDynamicContext } from "./prompts.js";
import type { AiAnswerInput, AiAnswerResult, AiService } from "./types.js";

export class AiUnavailableError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export class ClaudeService implements AiService {
  private readonly client: Anthropic;
  private supportsSystemRole = true;
  /** El fallback del lado del servidor es una BETA: si la API la rechaza, se desactiva sola. */
  private fallbacksAvailable = true;

  constructor(
    private readonly config: AppConfig,
    private readonly knowledge: KnowledgeStore,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000 });
  }

  async answer(input: AiAnswerInput): Promise<AiAnswerResult> {
    const knowledge = await this.knowledge.get();
    const today = todayInTimeZone(this.config.TIMEZONE, this.now());
    const dynamicContext = buildDynamicContext({
      mode: input.mode,
      todayIso: formatIso(today),
      todayLong: formatLong(today),
      data: input.data,
    });

    const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [
      { type: "text", text: buildBaseSystem(this.config.BOT_NAME) },
      {
        type: "text",
        text: knowledge.text,
        cache_control: { type: "ephemeral", ttl: this.config.CLAUDE_CACHE_TTL },
      },
    ];

    const messages = this.buildMessages(input, dynamicContext, this.supportsSystemRole);

    try {
      return await this.call(system, messages);
    } catch (err) {
      // Algunos modelos no aceptan {role:"system"} dentro de messages: reintentamos
      // inyectando el contexto como texto en el turno del usuario.
      if (err instanceof Anthropic.BadRequestError && this.supportsSystemRole && /role 'system'/i.test(err.message)) {
        this.logger.warn("El modelo no soporta mensajes de sistema intermedios; usando fallback en el turno del usuario");
        this.supportsSystemRole = false;
        return this.call(system, this.buildMessages(input, dynamicContext, false));
      }
      // Si Anthropic retira o cambia la beta de fallbacks, NO puede caerse el bot:
      // se desactiva sola y se reintenta el mismo pedido sin ese parámetro.
      if (err instanceof Anthropic.BadRequestError && this.fallbacksAvailable && this.config.CLAUDE_FALLBACKS && /fallback|beta/i.test(err.message)) {
        this.logger.warn({ err: err.message }, "La API rechazó el parámetro de fallbacks (beta); se desactiva y se reintenta sin él");
        this.fallbacksAvailable = false;
        return this.call(system, messages);
      }
      throw this.translateError(err);
    }
  }

  // ---------------------------------------------------------------------------

  private async call(
    system: Anthropic.Beta.Messages.BetaTextBlockParam[],
    messages: Anthropic.Beta.Messages.BetaMessageParam[],
  ): Promise<AiAnswerResult> {
    const params: BetaParams = {
      model: this.config.CLAUDE_MODEL,
      max_tokens: this.config.CLAUDE_MAX_TOKENS,
      system,
      messages,
      thinking: { type: "adaptive" },
      output_config: { effort: this.config.CLAUDE_EFFORT },
    };
    if (this.config.CLAUDE_FALLBACKS && this.fallbacksAvailable) {
      // Fallback del lado del servidor: si el modelo principal rechaza por política,
      // la API reintenta con otro modelo dentro de la misma llamada.
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    const response = await this.client.beta.messages.create(params);

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      model: response.model,
    };
    this.logger.debug({ usage, stop: response.stop_reason }, "Respuesta de Claude");

    if (response.stop_reason === "refusal") {
      return {
        text: "No puedo ayudarte con eso por acá. Si tu consulta es sobre documentación de SEA WHITE, contame un poco más; si no, escribí *menu* para volver al inicio.",
        usage,
      };
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new AiUnavailableError("Claude devolvió una respuesta vacía", "No pude generar una respuesta. ¿Podés repetir la consulta?");
    }
    return { text, usage };
  }

  private buildMessages(input: AiAnswerInput, dynamicContext: string, useSystemRole: boolean): Anthropic.Beta.Messages.BetaMessageParam[] {
    const history: Anthropic.Beta.Messages.BetaMessageParam[] = input.history.map((t) => ({ role: t.role, content: t.content }));
    const userText = input.userText.trim();
    const texto = useSystemRole ? userText : `<contexto_operador>\n${dynamicContext}\n</contexto_operador>\n\n${userText}`;

    history.push({ role: "user", content: this.userContent(texto, input.attachments) });
    if (useSystemRole) history.push({ role: "system", content: dynamicContext });
    return history;
  }

  /** Turno del usuario: las fotos/PDF van como bloques propios, antes del texto. */
  private userContent(text: string, attachments?: AiAnswerInput["attachments"]): string | Anthropic.Beta.Messages.BetaContentBlockParam[] {
    if (!attachments || attachments.length === 0) return text;
    const blocks: Anthropic.Beta.Messages.BetaContentBlockParam[] = attachments.map((a) =>
      a.kind === "image"
        ? { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.base64 } }
        : { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 } },
    );
    blocks.push({ type: "text", text: text || "(El usuario mandó esto sin escribir nada más.)" });
    return blocks;
  }

  private translateError(err: unknown): Error {
    if (err instanceof AiUnavailableError) return err;
    if (err instanceof Anthropic.RateLimitError) {
      return new AiUnavailableError(`Rate limit: ${err.message}`, "Estamos recibiendo muchas consultas en este momento. Probá de nuevo en unos segundos.");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return new AiUnavailableError(`API key inválida: ${err.message}`, "El asistente no está disponible en este momento. Por favor, comunicate con SEA WHITE.");
    }
    if (err instanceof Anthropic.APIError) {
      return new AiUnavailableError(`Claude API ${err.status}: ${err.message}`, "Tuve un problema para procesar tu consulta. ¿Podés intentar de nuevo en un momento?");
    }
    return new AiUnavailableError(`Error inesperado: ${(err as Error)?.message}`, "Tuve un problema para procesar tu consulta. ¿Podés intentar de nuevo en un momento?");
  }
}
