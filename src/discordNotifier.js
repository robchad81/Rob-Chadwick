import { Client, GatewayIntentBits, Partials } from "discord.js";
import { logger } from "./logger.js";

export class DiscordNotifier {
  constructor({
    token,
    alertsChannelId,
    instantAlertsChannelId,
    adminUserId,
    guildId,
    subscriberRoleId,
    onDirectMessage,
  }) {
    this.token = token;
    this.alertsChannelId = alertsChannelId;
    this.instantAlertsChannelId = instantAlertsChannelId;
    this.adminUserId = adminUserId;
    this.guildId = guildId;
    this.subscriberRoleId = subscriberRoleId;
    this.onDirectMessage = onDirectMessage;

    // DirectMessages is a normal (non-privileged) intent, and Discord
    // exempts DMs from needing the privileged Message Content intent - so
    // subscribing-via-DM works without asking for extra bot permissions.
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
      partials: [Partials.Channel],
    });

    if (this.onDirectMessage) {
      this.client.on("messageCreate", (message) => this._handleDirectMessage(message));
    }
  }

  async _handleDirectMessage(message) {
    if (message.author.bot || message.guild) return;
    try {
      const reply = await this.onDirectMessage(message.author.id);
      if (reply) await message.channel.send(reply);
    } catch (error) {
      // Stripe's own error message here is a generic wrapper ("An error
      // occurred with our connection to Stripe") that hides the actual
      // underlying cause - log the wrapped detail/cause too so a real
      // network error code (ECONNRESET, ETIMEDOUT, etc.) is visible.
      logger.error(`Failed to handle DM from ${message.author.id}:`, error.message, error.detail ?? error.cause ?? "");
    }
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

  async _postToChannel(channelId, source, kind, item) {
    const channel = await this.client.channels.fetch(channelId);
    const priceText = item.price ? ` - ${item.price}` : "";
    await channel.send(`**${kind}** [${source.name}]\n${item.title}${priceText}\n${item.url}`);
  }

  async postInstantAlert(source, kind, item) {
    // No paid channel configured yet (monetization setup in progress) -
    // nothing to post instantly to, the free channel post still happens.
    if (!this.instantAlertsChannelId) return;
    await this._postToChannel(this.instantAlertsChannelId, source, kind, item);
  }

  async postFreeAlert(source, kind, item) {
    await this._postToChannel(this.alertsChannelId, source, kind, item);
  }

  async alertAdmin(message) {
    try {
      const user = await this.client.users.fetch(this.adminUserId);
      await user.send(`[dram-radar health check] ${message}`);
    } catch (error) {
      logger.error("Failed to DM admin health-check alert:", error.message);
    }
  }

  async dmUser(discordUserId, message) {
    try {
      const user = await this.client.users.fetch(discordUserId);
      await user.send(message);
    } catch (error) {
      logger.error(`Failed to DM user ${discordUserId}:`, error.message);
    }
  }

  async grantSubscriberRole(discordUserId) {
    const guild = await this.client.guilds.fetch(this.guildId);
    const member = await guild.members.fetch(discordUserId);
    await member.roles.add(this.subscriberRoleId);
  }

  async revokeSubscriberRole(discordUserId) {
    const guild = await this.client.guilds.fetch(this.guildId);
    const member = await guild.members.fetch(discordUserId);
    await member.roles.remove(this.subscriberRoleId);
  }

  async disconnect() {
    await this.client.destroy();
  }
}
