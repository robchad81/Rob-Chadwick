import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { JsonStore } from "./store.js";
import { Poller } from "./poller.js";
import { DiscordNotifier } from "./discordNotifier.js";
import { logger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  const raw = readFileSync(join(__dirname, "..", "config.json"), "utf-8");
  return JSON.parse(raw);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const config = loadConfig();
  const enabledSources = config.sources.filter((source) => source.enabled !== false);
  if (enabledSources.length === 0) {
    logger.warn(
      "No sources are enabled in config.json. Verify a source's selectors against the live page, " +
        'then set "enabled": true for it before this bot will alert on anything.'
    );
  }

  const store = new JsonStore(join(__dirname, "..", "data", "state.json"));

  const notifier = new DiscordNotifier({
    token: requireEnv("DISCORD_BOT_TOKEN"),
    alertsChannelId: requireEnv("ALERTS_CHANNEL_ID"),
    adminUserId: requireEnv("ADMIN_DISCORD_ID"),
  });
  await notifier.connect();

  const poller = new Poller({ config, store, notifier });

  logger.info(`Starting poll loop every ${config.pollIntervalMs}ms for ${enabledSources.length} source(s).`);
  await poller.pollOnce();
  setInterval(() => {
    poller.pollOnce().catch((error) => logger.error("Unexpected poll loop error:", error));
  }, config.pollIntervalMs);
}

main().catch((error) => {
  logger.error("Fatal startup error:", error);
  process.exit(1);
});
