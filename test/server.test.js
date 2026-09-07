import assert from "node:assert/strict";
import { test } from "node:test";

import { createServer } from "../src/server.js";

function fakeStore() {
  const data = {};
  return {
    get: (key, fallback) => data[key] ?? fallback,
    set: (key, value) => {
      data[key] = value;
    },
  };
}

function fakeNotifier() {
  return {
    granted: [],
    async grantSubscriberRole(discordUserId) {
      this.granted.push(discordUserId);
    },
    async revokeSubscriberRole() {},
    async dmUser() {},
    async alertAdmin() {},
  };
}

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test("GET / responds 200 for Render's health check", async () => {
  const app = createServer({
    stripe: { webhooks: { constructEvent: () => ({}) } },
    stripeWebhookSecret: "whsec_test",
    store: fakeStore(),
    notifier: fakeNotifier(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
  });
});

test("POST /stripe/webhook processes a verified event and grants the role", async () => {
  const store = fakeStore();
  const notifier = fakeNotifier();
  const fakeStripe = {
    webhooks: {
      constructEvent: (rawBody, signature, secret) => {
        assert.equal(signature, "t=1,v1=deadbeef");
        assert.equal(secret, "whsec_test");
        return {
          type: "checkout.session.completed",
          data: { object: { id: "cs_1", client_reference_id: "discord-user-1", customer: "cus_1" } },
        };
      },
    },
  };
  const app = createServer({ stripe: fakeStripe, stripeWebhookSecret: "whsec_test", store, notifier });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/stripe/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      body: JSON.stringify({ anything: "the raw body, since our fake stripe doesn't really verify it" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(notifier.granted, ["discord-user-1"]);
  });
});

test("health check still works and the webhook route isn't registered when Stripe isn't configured", async () => {
  const app = createServer({ stripe: undefined, stripeWebhookSecret: undefined, store: fakeStore(), notifier: fakeNotifier() });

  await withServer(app, async (baseUrl) => {
    const health = await fetch(baseUrl);
    assert.equal(health.status, 200);

    const webhook = await fetch(`${baseUrl}/stripe/webhook`, { method: "POST", body: "{}" });
    assert.equal(webhook.status, 404);
  });
});

test("POST /stripe/webhook rejects a request with a bad signature", async () => {
  const fakeStripe = {
    webhooks: {
      constructEvent: () => {
        throw new Error("signature mismatch");
      },
    },
  };
  const app = createServer({
    stripe: fakeStripe,
    stripeWebhookSecret: "whsec_test",
    store: fakeStore(),
    notifier: fakeNotifier(),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/stripe/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "bogus" },
      body: JSON.stringify({ anything: "here" }),
    });
    assert.equal(response.status, 400);
  });
});
