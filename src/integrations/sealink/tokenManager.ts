/**
 * Manejo del token JWT de SeaLink.
 *
 * Flujo recomendado por el manual:
 *   ¿Tengo token guardado?
 *     NO -> Autenticar -> Guardar token
 *     SI -> GET /api/autenticacion/me  (200 usar / 401 autenticar de nuevo)
 *
 * Para no pegarle a /me antes de cada consulta, confiamos en `valido_hasta_utc`
 * (con un margen de seguridad) y sólo re-autenticamos si la API responde 401.
 */
import type { Logger } from "../../utils/logger.js";
import { assertReadOnlyEndpoint } from "./readOnly.js";
import { SeaLinkError, type SeaLinkAuthResponse } from "./types.js";

export interface TokenManagerOptions {
  baseUrl: string;
  email: string;
  password: string;
  servidor: string;
  timeoutMs: number;
  logger: Logger;
  /** Margen (ms) antes del vencimiento real para renovar el token de forma proactiva. */
  safetyMarginMs?: number;
}

export class SeaLinkTokenManager {
  private token: string | null = null;
  private validUntil = 0;
  private inFlight: Promise<string> | null = null;
  private readonly safetyMarginMs: number;

  constructor(private readonly opts: TokenManagerOptions) {
    this.safetyMarginMs = opts.safetyMarginMs ?? 5 * 60 * 1000;
  }

  /** Devuelve un token válido, autenticando si hace falta. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.validUntil - this.safetyMarginMs) {
      return this.token;
    }
    return this.refresh();
  }

  /** Fuerza una nueva autenticación (por ejemplo, tras un 401). Evita logins concurrentes. */
  async refresh(): Promise<string> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.authenticate().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  invalidate(): void {
    this.token = null;
    this.validUntil = 0;
  }

  private async authenticate(): Promise<string> {
    const { baseUrl, email, password, servidor, timeoutMs, logger } = this.opts;
    // REGLA Nº 1: sólo lectura. Este endpoint sólo valida credenciales y devuelve un token.
    const LOGIN_PATH = "/api/autenticacion/validar";
    assertReadOnlyEndpoint(LOGIN_PATH);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${LOGIN_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Servidor: servidor, correo: email, clave: password }),
        signal: controller.signal,
      });
      if (res.status === 401) {
        throw new SeaLinkError("Credenciales de SeaLink inválidas (401). Revisá SEALINK_EMAIL / SEALINK_PASSWORD.", 401);
      }
      if (!res.ok) {
        throw new SeaLinkError(`Error autenticando en SeaLink: HTTP ${res.status}`, res.status);
      }
      const data = (await res.json()) as SeaLinkAuthResponse;
      if (!data.token) throw new SeaLinkError("SeaLink no devolvió token en la autenticación.");

      this.token = data.token;
      const parsed = Date.parse(data.valido_hasta_utc);
      this.validUntil = Number.isFinite(parsed) ? parsed : Date.now() + (data.expira_en_minutos ?? 480) * 60 * 1000;
      logger.info({ validUntil: new Date(this.validUntil).toISOString() }, "Token SeaLink obtenido");
      return this.token;
    } catch (err) {
      if (err instanceof SeaLinkError) throw err;
      throw new SeaLinkError(`No se pudo conectar con SeaLink para autenticar: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
