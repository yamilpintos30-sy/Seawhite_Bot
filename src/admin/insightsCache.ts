/** Último análisis de conversaciones guardado en Supabase (tabla `bot_insights`). */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insights, InsightsCache } from "./insights.js";

export class SupabaseInsightsCache implements InsightsCache {
  constructor(private readonly client: SupabaseClient) {}

  async get(clave: string): Promise<Insights | null> {
    const { data, error } = await this.client.from("bot_insights").select("payload").eq("id", clave).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.payload as Insights | undefined) ?? null;
  }

  async set(clave: string, insights: Insights): Promise<void> {
    const { error } = await this.client
      .from("bot_insights")
      .upsert({ id: clave, payload: insights, created_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}
