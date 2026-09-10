/** Tipos de la API de Vencimientos SeaLink (ver Manual_Integracion_Vencimientos_SeaLink.pdf). */

export interface SeaLinkAuthResponse {
  token: string;
  valido_hasta_utc: string;
  expira_en_minutos: number;
}

export interface SeaLinkChoferResponse {
  Razon_Social?: string;
  ok: boolean;
  Licencia_Vto?: string | null;
  F931_Vto?: string | null;
  ART_Vto?: string | null;
  error?: string;
}

export interface SeaLinkCamionResponse {
  ok: boolean;
  Vto_Seguro?: string | null;
  Vto_Vtv?: string | null;
  error?: string;
}

export interface SeaLinkTelefonoResponse {
  ok: boolean;
  /** El anexo documenta "Razon_Social" pero la API real devuelve "razon_Social". Toleramos ambas. */
  Razon_Social?: string;
  razon_Social?: string;
  razon_social?: string;
  error?: string;
}

/** Resultado normalizado de una consulta de chofer. */
export type ChoferLookup =
  | { found: true; dni: string; razonSocial: string; licenciaVto: string | null; f931Vto: string | null; artVto: string | null }
  | { found: false; dni: string };

/** Resultado normalizado de una consulta de camión/acoplado. */
export type CamionLookup =
  | { found: true; dominio: string; seguroVto: string | null; vtvVto: string | null }
  | { found: false; dominio: string };

/** Resultado de buscar el nombre del chofer por su teléfono (anexo del manual). */
export type TelefonoLookup = { found: true; telefono: string; razonSocial: string } | { found: false; telefono: string };

/** Interfaz que usa el bot; permite reemplazar la implementación real por una falsa en tests. */
export interface SeaLinkService {
  consultarChofer(dni: string): Promise<ChoferLookup>;
  consultarCamion(dominio: string): Promise<CamionLookup>;
  /** Nombre del chofer a partir del teléfono (la API tolera el prefijo +549). */
  consultarChoferPorTelefono(telefono: string): Promise<TelefonoLookup>;
}

export class SeaLinkError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SeaLinkError";
  }
}
