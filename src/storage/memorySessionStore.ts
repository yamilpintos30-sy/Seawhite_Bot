/** Almacenamiento de sesiones en memoria: para desarrollo local, tests y el simulador de consola. */
import type { Session } from "../bot/types.js";
import type { SessionStore } from "./sessionStore.js";

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();

  async get(conversationId: string): Promise<Session | null> {
    const s = this.sessions.get(conversationId);
    return s ? structuredClone(s) : null;
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.conversationId, structuredClone(session));
  }

  async delete(conversationId: string): Promise<void> {
    this.sessions.delete(conversationId);
  }
}
