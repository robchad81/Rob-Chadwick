import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Stripe from "stripe";

import { JsonStore } from "./store.js";
import { Poller } from "./poller.js";
import { DiscordNotifier } from "./discordNotifier.js";
import { createCheckoutUrl } from "./billing/checkout.js";
import { createServer } from "./server.js";
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

/**
 * Monetization (Stripe + the Subscriber role) is optional config, not
 * required config - the free alerts should keep working on their own while
 * that setup is still in progress, rather than the whole app refusing to
 * start until every Stripe/Discord-role env var is filled in.
 */
function loadMonetizationConfig() {
  const keys = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_ID",
    "STRIPE_WEBHOOK_SECRET",
    "INSTANT_ALERTS_CHANNEL_ID",
    "GUILD_ID",
    "SUBSCRIBER_ROLE_ID",
  ];
  const values = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const missing = keys.filter((key) => !values[key]);

  if (missing.length === keys.length) return null;
  if (missing.length > 0) {
    logger.warn(
      `Monetization is partially configured - missing ${missing.join(", ")}. ` +
        "Treating it as not configured until all of it is set."
    );
    return null;
  }
  return values;
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

  const dataDir = process.env.DATA_DIR ?? join(__dirname, "..", "data");
  const store = new JsonStore(join(dataDir, "state.json"));

  const monetization = loadMonetizationConfig();
  const stripe = monetization ? new Stripe(monetization.STRIPE_SECRET_KEY) : undefined;
  if (!monetization) {
    logger.warn(
      "Monetization env vars aren't set - running in free-alerts-only mode. " +
        "See README's Monetization setup section to enable paid instant alerts."
    );
  }

  const notifier = new DiscordNotifier({
    token: requireEnv("DISCORD_BOT_TOKEN"),
    alertsChannelId: requireEnv("ALERTS_CHANNEL_ID"),
    adminUserId: requireEnv("ADMIN_DISCORD_ID"),
    instantAlertsChannelId: monetization?.INSTANT_ALERTS_CHANNEL_ID,
    guildId: monetization?.GUILD_ID,
    subscriberRoleId: monetization?.SUBSCRIBER_ROLE_ID,
    onDirectMessage: monetization
      ? async (discordUserId) => {
          const url = await createCheckoutUrl({
            stripe,
            priceId: monetization.STRIPE_PRICE_ID,
            discordUserId,
            successUrl: process.env.CHECKOUT_SUCCESS_URL ?? "https://discord.com",
            cancelUrl: process.env.CHECKOUT_CANCEL_URL ?? "https://discord.com",
          });
          return (
            `Get instant alerts (the moment a new release or restock is found, instead of the ` +
            `${Math.round((config.freeAlertDelayMs ?? 0) / 60000)}-minute delay in the free channel) for ` +
            `£${config.subscriptionPriceGbp ?? "10"}/month:\n${url}`
          );
        }
      : undefined,
  });
  await notifier.connect();

  const poller = new Poller({ config, store, notifier });

  const app = createServer({
    stripe,
    stripeWebhookSecret: monetization?.STRIPE_WEBHOOK_SECRET,
    store,
    notifier,
  });
  const port = process.env.PORT ?? 3000;
  app.listen(port, () => logger.info(`HTTP server (health check + Stripe webhook) listening on port ${port}`));

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
