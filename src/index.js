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

  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
  const stripePriceId = requireEnv("STRIPE_PRICE_ID");
  const checkoutSuccessUrl = process.env.CHECKOUT_SUCCESS_URL ?? "https://discord.com";
  const checkoutCancelUrl = process.env.CHECKOUT_CANCEL_URL ?? "https://discord.com";

  const notifier = new DiscordNotifier({
    token: requireEnv("DISCORD_BOT_TOKEN"),
    alertsChannelId: requireEnv("ALERTS_CHANNEL_ID"),
    instantAlertsChannelId: requireEnv("INSTANT_ALERTS_CHANNEL_ID"),
    adminUserId: requireEnv("ADMIN_DISCORD_ID"),
    guildId: requireEnv("GUILD_ID"),
    subscriberRoleId: requireEnv("SUBSCRIBER_ROLE_ID"),
    onDirectMessage: async (discordUserId) => {
      const url = await createCheckoutUrl({
        stripe,
        priceId: stripePriceId,
        discordUserId,
        successUrl: checkoutSuccessUrl,
        cancelUrl: checkoutCancelUrl,
      });
      return (
        `Get instant alerts (the moment a new release or restock is found, instead of the ` +
        `${Math.round((config.freeAlertDelayMs ?? 0) / 60000)}-minute delay in the free channel) for ` +
        `£${config.subscriptionPriceGbp ?? "10"}/month:\n${url}`
      );
    },
  });
  await notifier.connect();

  const poller = new Poller({ config, store, notifier });

  const app = createServer({ stripe, stripeWebhookSecret: requireEnv("STRIPE_WEBHOOK_SECRET"), store, notifier });
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
