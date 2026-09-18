/**
 * Panel web de SEA WHITE (`/panel`): ver y reemplazar el contexto del bot, y
 * mirar qué está pasando en las conversaciones.
 *
 * Se publica sólo si hay `ADMIN_PASSWORD`. Todo lo que hay debajo de /panel/api
 * exige la cookie de sesión; la página en sí es estática (public/panel).
 */
import path from "node:path";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import type { KnowledgeStore } from "../ai/knowledge.js";
import type { AppConfig } from "../config.js";
import type { KnowledgeRepository } from "../storage/knowledgeRepository.js";
import type { Logger } from "../utils/logger.js";
import { clearSessionCookie, COOKIE_NAME, createToken, isValidToken, LoginThrottle, readCookie, samePassword, setSessionCookie } from "./auth.js";
import { InsightsService } from "./insights.js";
import { SupabaseInsightsCache } from "./insightsCache.js";
import { StatsRepository } from "./statsRepository.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminDeps {
  config: AppConfig;
  logger: Logger;
  knowledge: KnowledgeStore;
  knowledgeRepo?: KnowledgeRepository;
  supabase?: SupabaseClient | null;
}

/** Documento único de contexto que administra el panel. */
const KNOWLEDGE_ID = "CargaDocumentacion";
const MAX_CHARS = 400_000;

export function createAdminRouter(deps: AdminDeps): Router {
  const { config, logger, knowledge, knowledgeRepo, supabase } = deps;
  const router = Router();
  const throttle = new LoginThrottle();
  const stats = supabase ? new StatsRepository(supabase, config.TIMEZONE) : undefined;
  const insights = new InsightsService(config, logger, supabase ? new SupabaseInsightsCache(supabase) : undefined);

  router.use("/panel", express.static(path.resolve(process.cwd(), "public/panel"), { index: "index.html" }));

  router.post("/panel/api/login", (req: Request, res: Response) => {
    const ip = req.ip ?? "desconocida";
    if (throttle.bloqueado(ip)) {
      res.status(429).json({ error: "Demasiados intentos. Esperá unos minutos." });
      return;
    }
    const password = String((req.body as { password?: unknown })?.password ?? "");
    if (!samePassword(password, config.ADMIN_PASSWORD ?? "")) {
      throttle.fallo(ip);
      logger.warn({ ip }, "Intento fallido de acceso al panel");
      res.status(401).json({ error: "Contraseña incorrecta." });
      return;
    }
    throttle.exito(ip);
    setSessionCookie(res, createToken(config.WEBHOOK_SECRET), req.secure || req.headers["x-forwarded-proto"] === "https");
    res.json({ ok: true });
  });

  router.post("/panel/api/logout", (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  /** De acá para abajo, todo exige sesión. */
  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!isValidToken(readCookie(req, COOKIE_NAME), config.WEBHOOK_SECRET)) {
      res.status(401).json({ error: "Sesión vencida. Volvé a entrar." });
      return;
    }
    next();
  };

  router.get("/panel/api/session", requireAuth, (_req: Request, res: Response) => {
    res.json({ ok: true, supabase: Boolean(supabase), bot: config.BOT_NAME });
  });

  // --- Contexto del bot -------------------------------------------------------

  router.get("/panel/api/knowledge", requireAuth, async (_req: Request, res: Response) => {
    const snapshot = await knowledge.get();
    // Si las tablas del panel todavía no existen, el contexto se muestra igual
    // (sale del repositorio) y se avisa qué falta hacer.
    let guardado: Awaited<ReturnType<KnowledgeRepository["list"]>>[number] | undefined;
    let problema: string | undefined;
    if (knowledgeRepo) {
      try {
        guardado = (await knowledgeRepo.list()).find((d) => d.id === KNOWLEDGE_ID);
      } catch (err) {
        problema = descripcionDeFalla(err);
        logger.warn({ err }, "El panel no pudo leer el contexto guardado");
      }
    } else {
      problema = "Para guardar cambios hace falta configurar Supabase en el servidor.";
    }
    res.json({
      problema,
      contenido: snapshot.text,
      archivos: snapshot.files,
      caracteres: snapshot.text.length,
      cargadoEl: snapshot.loadedAt.toISOString(),
      origen: guardado ? "panel" : "repositorio",
      actualizadoEl: guardado?.updatedAt.toISOString() ?? null,
      nota: guardado?.note ?? null,
      editable: Boolean(knowledgeRepo) && !problema,
    });
  });

  router.put("/panel/api/knowledge", requireAuth, async (req: Request, res: Response) => {
    if (!knowledgeRepo) {
      res.status(503).json({ error: "Para guardar el contexto hace falta Supabase configurado." });
      return;
    }
    const body = req.body as { contenido?: unknown; nota?: unknown };
    const contenido = String(body?.contenido ?? "").trim();
    if (contenido.length < 100) {
      res.status(400).json({ error: "El contexto parece vacío o demasiado corto (mínimo 100 caracteres)." });
      return;
    }
    if (contenido.length > MAX_CHARS) {
      res.status(400).json({ error: `El contexto es demasiado grande (máximo ${MAX_CHARS.toLocaleString("es-AR")} caracteres).` });
      return;
    }
    await knowledgeRepo.save(KNOWLEDGE_ID, contenido, body?.nota ? String(body.nota).slice(0, 200) : undefined);
    knowledge.invalidate();
    const snapshot = await knowledge.get();
    res.json({ ok: true, caracteres: snapshot.text.length, cargadoEl: snapshot.loadedAt.toISOString() });
  });

  router.get("/panel/api/knowledge/versions", requireAuth, async (_req: Request, res: Response) => {
    if (!knowledgeRepo) {
      res.json({ versiones: [] });
      return;
    }
    res.json({ versiones: await knowledgeRepo.versions(KNOWLEDGE_ID) });
  });

  router.post("/panel/api/knowledge/restore", requireAuth, async (req: Request, res: Response) => {
    if (!knowledgeRepo) {
      res.status(503).json({ error: "Para restaurar hace falta Supabase configurado." });
      return;
    }
    const id = Number((req.body as { id?: unknown })?.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Falta el número de versión." });
      return;
    }
    await knowledgeRepo.restore(id);
    knowledge.invalidate();
    res.json({ ok: true });
  });

  // --- Actividad y análisis ---------------------------------------------------

  router.get("/panel/api/stats", requireAuth, async (req: Request, res: Response) => {
    if (!stats) {
      res.status(503).json({ error: "Las estadísticas necesitan Supabase configurado." });
      return;
    }
    res.json(await stats.summary(diasDe(req)));
  });

  /**
   * Devuelve el ÚLTIMO análisis guardado, al instante. Generar uno nuevo tarda
   * (hay que mandarle cientos de mensajes a la IA), así que eso se pide aparte.
   */
  router.get("/panel/api/insights", requireAuth, async (req: Request, res: Response) => {
    if (!stats) {
      res.status(503).json({ error: "El análisis necesita Supabase configurado." });
      return;
    }
    const dias = diasDe(req);
    const ultimo = await insights.ultimo(dias);
    if (ultimo) {
      res.json({ ...ultimo, cacheado: true });
      return;
    }
    // Nunca se analizó este período: se genera ahora (la primera vez tarda).
    res.json({ ...(await insights.analyze(await stats.consultas(dias), dias)), cacheado: false });
  });

  /** Genera un análisis nuevo (botón "Actualizar análisis"). */
  router.post("/panel/api/insights/refresh", requireAuth, async (req: Request, res: Response) => {
    if (!stats) {
      res.status(503).json({ error: "El análisis necesita Supabase configurado." });
      return;
    }
    const dias = diasDe(req);
    res.json({ ...(await insights.analyze(await stats.consultas(dias), dias)), cacheado: false });
  });

  // Errores: se loguean completos y al panel va un mensaje corto.
  router.use("/panel/api", (err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, path: req.path }, "Error en el panel");
    res.status(500).json({ error: err.message || "Error inesperado" });
  });

  return router;
}

/**
 * Traduce fallas técnicas de Supabase a algo accionable para quien usa el panel.
 * La más común: todavía no se ejecutó la migración que crea las tablas.
 */
function descripcionDeFalla(err: unknown): string {
  const mensaje = err instanceof Error ? err.message : String(err);
  if (/bot_knowledge|schema cache|does not exist/i.test(mensaje)) {
    return "Faltan las tablas del panel en Supabase. Ejecutá el archivo supabase/migrations/0002_panel.sql en el SQL Editor y volvé a entrar.";
  }
  return `No se pudo leer el contexto guardado: ${mensaje}`;
}

/** Período pedido (por defecto 30 días, máximo 180). */
function diasDe(req: Request): number {
  const dias = Number(req.query.dias ?? 30);
  if (!Number.isFinite(dias)) return 30;
  return Math.min(Math.max(Math.round(dias), 1), 180);
}
