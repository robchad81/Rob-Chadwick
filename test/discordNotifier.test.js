import assert from "node:assert/strict";
import { test } from "node:test";

import { DiscordNotifier } from "../src/discordNotifier.js";

function fakeMessage({ isBot = false, isGuildMessage = false } = {}) {
  const sent = [];
  return {
    author: { bot: isBot, id: "discord-user-1" },
    guild: isGuildMessage ? { id: "some-guild" } : null,
    channel: {
      async send(text) {
        sent.push(text);
      },
    },
    _sent: sent,
  };
}

test("_handleDirectMessage replies with whatever onDirectMessage returns, for a real DM", async () => {
  const notifier = new DiscordNotifier({
    token: "fake",
    onDirectMessage: async (discordUserId) => `hello ${discordUserId}`,
  });
  const message = fakeMessage();

  await notifier._handleDirectMessage(message);

  assert.deepEqual(message._sent, ["hello discord-user-1"]);
});

test("_handleDirectMessage ignores messages from bots", async () => {
  let called = false;
  const notifier = new DiscordNotifier({
    token: "fake",
    onDirectMessage: async () => {
      called = true;
      return "reply";
    },
  });

  await notifier._handleDirectMessage(fakeMessage({ isBot: true }));

  assert.equal(called, false);
});

test("_handleDirectMessage ignores messages sent in a server, not a DM", async () => {
  let called = false;
  const notifier = new DiscordNotifier({
    token: "fake",
    onDirectMessage: async () => {
      called = true;
      return "reply";
    },
  });

  await notifier._handleDirectMessage(fakeMessage({ isGuildMessage: true }));

  assert.equal(called, false);
});

test("postInstantAlert does nothing when no paid channel is configured (monetization not set up yet)", async () => {
  const notifier = new DiscordNotifier({ token: "fake" }); // no instantAlertsChannelId
  notifier.client.channels.fetch = async () => {
    throw new Error("should not attempt to fetch a channel when none is configured");
  };

  await notifier.postInstantAlert({ name: "Test Source" }, "New release", { title: "X", url: "https://x" });
  // No assertion needed beyond "didn't throw" - the stubbed fetch would have
  // thrown if postInstantAlert tried to post anywhere.
});

test("_handleDirectMessage does not send anything if onDirectMessage throws", async () => {
  const notifier = new DiscordNotifier({
    token: "fake",
    onDirectMessage: async () => {
      throw new Error("stripe is down");
    },
  });
  const message = fakeMessage();

  await notifier._handleDirectMessage(message);

  assert.deepEqual(message._sent, []);
});
