/**
 * Acceso al panel: una contraseña (`ADMIN_PASSWORD`) y una cookie firmada.
 *
 * Sin base de usuarios ni librerías: la cookie lleva su vencimiento y una firma
 * HMAC hecha con `WEBHOOK_SECRET`, así no se puede falsificar. Si no hay
 * `ADMIN_PASSWORD` configurada, el panel directamente no se publica.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export const COOKIE_NAME = "sw_panel";
const DURACION_HORAS = 12;

/** Comparación en tiempo constante (evita adivinar la clave midiendo tiempos). */
export function samePassword(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createToken(secret: string, now = Date.now()): string {
  const expira = String(now + DURACION_HORAS * 60 * 60 * 1000);
  return `${expira}.${sign(expira, secret)}`;
}

export function isValidToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [expira, firma] = token.split(".");
  if (!expira || !firma) return false;
  const esperada = sign(expira, secret);
  if (firma.length !== esperada.length || !timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return false;
  return Number(expira) > now;
}

/** Cookies del pedido (sin dependencias: el header es "a=1; b=2"). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const parte of header.split(";")) {
    const [clave, ...resto] = parte.trim().split("=");
    if (clave === name) return decodeURIComponent(resto.join("="));
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  const partes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/panel",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${DURACION_HORAS * 60 * 60}`,
  ];
  if (secure) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/panel; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * Freno a la fuerza bruta: 5 intentos fallidos por IP cada 10 minutos.
 * En memoria (un reinicio los perdona): alcanza para un panel interno.
 */
export class LoginThrottle {
  private readonly intentos = new Map<string, { fallos: number; hasta: number }>();

  constructor(
    private readonly maxFallos = 5,
    private readonly ventanaMs = 10 * 60_000,
  ) {}

  bloqueado(ip: string, now = Date.now()): boolean {
    const registro = this.intentos.get(ip);
    if (!registro) return false;
    if (registro.hasta < now) {
      this.intentos.delete(ip);
      return false;
    }
    return registro.fallos >= this.maxFallos;
  }

  fallo(ip: string, now = Date.now()): void {
    const registro = this.intentos.get(ip);
    if (!registro || registro.hasta < now) {
      this.intentos.set(ip, { fallos: 1, hasta: now + this.ventanaMs });
      return;
    }
    registro.fallos += 1;
  }

  exito(ip: string): void {
    this.intentos.delete(ip);
  }
}
