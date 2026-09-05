import { Client, GatewayIntentBits } from "discord.js";
import { logger } from "./logger.js";

export class DiscordNotifier {
  constructor({ token, alertsChannelId, adminUserId }) {
    this.token = token;
    this.alertsChannelId = alertsChannelId;
    this.adminUserId = adminUserId;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.client.once("ready", () => {
        logger.info(`Discord bot logged in as ${this.client.user.tag}`);
        resolve();
      });
      this.client.once("error", reject);
      this.client.login(this.token).catch(reject);
    });
  }

  async postAlert(source, kind, item) {
    const channel = await this.client.channels.fetch(this.alertsChannelId);
    const priceText = item.price ? ` - ${item.price}` : "";
    await channel.send(`**${kind}** [${source.name}]\n${item.title}${priceText}\n${item.url}`);
  }

  async alertAdmin(message) {
    try {
      const user = await this.client.users.fetch(this.adminUserId);
      await user.send(`[dram-radar health check] ${message}`);
    } catch (error) {
      logger.error("Failed to DM admin health-check alert:", error.message);
    }
  }

  async disconnect() {
    await this.client.destroy();
  }
}
