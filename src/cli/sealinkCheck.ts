/**
 * Verifica la conexión con la API SeaLink usando los DNI y dominios de prueba del manual.
 *
 *   npm run sealink:check
 */
import { loadConfig } from "../config.js";
import { SeaLinkClient } from "../integrations/sealink/client.js";
import { logger } from "../utils/logger.js";

const DNIS = ["35413889", "28885090", "28885099"]; // el último NO existe
const DOMINIOS = ["AA006QS", "AA119NR", "2367FUT", "3437BXL"];
const TELEFONOS = ["2392526070", "+5492392406419", "1100000000"]; // el último NO existe

async function main(): Promise<void> {
  const config = loadConfig({
    CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN ?? "x",
    CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID ?? "1",
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET ?? "check-secret",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "x",
  });
  const client = new SeaLinkClient({
    baseUrl: config.SEALINK_BASE_URL,
    email: config.SEALINK_EMAIL,
    password: config.SEALINK_PASSWORD,
    servidor: config.SEALINK_SERVIDOR,
    timeoutMs: config.SEALINK_TIMEOUT_MS,
    logger,
  });

  console.log(`Autenticando en ${config.SEALINK_BASE_URL} ...`);
  console.log(`/me -> ${(await client.ping()) ? "OK" : "FALLO"}`);

  for (const dni of DNIS) {
    console.log(`\nChofer ${dni}:`, JSON.stringify(await client.consultarChofer(dni)));
  }
  for (const dominio of DOMINIOS) {
    console.log(`\nCamión ${dominio}:`, JSON.stringify(await client.consultarCamion(dominio)));
  }
  for (const telefono of TELEFONOS) {
    console.log(`\nChofer por teléfono ${telefono}:`, JSON.stringify(await client.consultarChoferPorTelefono(telefono)));
  }
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
