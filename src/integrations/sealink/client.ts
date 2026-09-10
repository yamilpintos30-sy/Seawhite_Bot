/**
 * Cliente HTTP de la API de Vencimientos SeaLink.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  REGLA Nº 1 DEL PROYECTO: EL SERVIDOR DE SEA WHITE ES SOLO LECTURA.       ║
 * ║  Este cliente ÚNICAMENTE CONSULTA. Jamás se agregan endpoints que creen,  ║
 * ║  modifiquen o borren datos. La lista blanca de abajo lo garantiza:        ║
 * ║  cualquier otro path lanza error antes de salir a la red.                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Códigos que contempla (según manual):
 *   200 -> procesar JSON
 *   400 -> parámetros incorrectos
 *   401 -> token vencido: renovar una vez y reintentar
 *   404 -> chofer/camión inexistente: caso de negocio normal (found: false)
 *   500 -> error interno: se informa y registra
 */
import type { Logger } from "../../utils/logger.js";
import { assertReadOnlyEndpoint } from "./readOnly.js";
import { SeaLinkTokenManager } from "./tokenManager.js";
import {
  SeaLinkError,
  type CamionLookup,
  type ChoferLookup,
  type SeaLinkCamionResponse,
  type SeaLinkChoferResponse,
  type SeaLinkService,
  type SeaLinkTelefonoResponse,
  type TelefonoLookup,
} from "./types.js";

export { assertReadOnlyEndpoint, SEALINK_READ_ONLY_ENDPOINTS } from "./readOnly.js";

export interface SeaLinkClientOptions {
  baseUrl: string;
  email: string;
  password: string;
  servidor: string;
  timeoutMs: number;
  logger: Logger;
}

export class SeaLinkClient implements SeaLinkService {
  private readonly tokens: SeaLinkTokenManager;

  constructor(private readonly opts: SeaLinkClientOptions) {
    this.tokens = new SeaLinkTokenManager(opts);
  }

  async consultarChofer(dni: string): Promise<ChoferLookup> {
    const result = await this.post<SeaLinkChoferResponse>("/api/vencimientos/chofer", { Nro_Documento: dni });
    if (result.status === 404 || !result.body.ok) {
      return { found: false, dni };
    }
    return {
      found: true,
      dni,
      razonSocial: (result.body.Razon_Social ?? "").trim(),
      licenciaVto: result.body.Licencia_Vto ?? null,
      f931Vto: result.body.F931_Vto ?? null,
      artVto: result.body.ART_Vto ?? null,
    };
  }

  async consultarCamion(dominio: string): Promise<CamionLookup> {
    const result = await this.post<SeaLinkCamionResponse>("/api/vencimientos/camion", { Dominio: dominio });
    if (result.status === 404 || !result.body.ok) {
      return { found: false, dominio };
    }
    return {
      found: true,
      dominio,
      seguroVto: result.body.Vto_Seguro ?? null,
      vtvVto: result.body.Vto_Vtv ?? null,
    };
  }

  /**
   * Nombre del chofer por teléfono (anexo del manual). La API elimina sola el
   * prefijo +549 y busca de forma parcial, así que mandamos el número tal cual
   * llega de WhatsApp/Chatwoot.
   */
  async consultarChoferPorTelefono(telefono: string): Promise<TelefonoLookup> {
    const result = await this.post<SeaLinkTelefonoResponse>("/api/vencimientos/chofer/telefono", { Telefono: telefono });
    if (result.status === 404 || !result.body.ok) {
      return { found: false, telefono };
    }
    // El anexo documenta "Razon_Social" pero la API real responde "razon_Social".
    const razonSocial = (result.body.Razon_Social ?? result.body.razon_Social ?? result.body.razon_social ?? "").trim();
    return { found: true, telefono, razonSocial };
  }

  /** Verifica conectividad y credenciales (usado por `npm run sealink:check`). */
  async ping(): Promise<boolean> {
    const token = await this.tokens.getToken();
    const res = await this.fetchWithTimeout(`${this.opts.baseUrl}/api/autenticacion/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  }

  // ---------------------------------------------------------------------------

  private async post<T>(path: string, payload: Record<string, string>, retryOn401 = true): Promise<{ status: number; body: T }> {
    assertReadOnlyEndpoint(path);
    const token = await this.tokens.getToken();
    const url = `${this.opts.baseUrl}${path}`;
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ Servidor: this.opts.servidor, ...payload }),
    });

    if (res.status === 401 && retryOn401) {
      this.opts.logger.warn({ path }, "SeaLink respondió 401; renovando token y reintentando");
      this.tokens.invalidate();
      await this.tokens.refresh();
      return this.post<T>(path, payload, false);
    }

    const body = (await this.safeJson(res)) as T;

    if (res.status === 200 || res.status === 404) {
      return { status: res.status, body };
    }
    if (res.status === 400) {
      throw new SeaLinkError(`SeaLink rechazó la solicitud (400) en ${path}: ${JSON.stringify(body)}`, 400);
    }
    throw new SeaLinkError(`SeaLink respondió HTTP ${res.status} en ${path}`, res.status);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    assertReadOnlyEndpoint(new URL(url).pathname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      throw new SeaLinkError(`No se pudo conectar con SeaLink (${url}): ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async safeJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
}
