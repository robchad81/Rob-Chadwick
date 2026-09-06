import assert from "node:assert/strict";
import { test } from "node:test";

import { handleStripeEvent } from "../../src/billing/webhookEvents.js";

function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (key, fallback) => data[key] ?? fallback,
    set: (key, value) => {
      data[key] = value;
    },
    _data: data,
  };
}

function fakeNotifier() {
  return {
    granted: [],
    revoked: [],
    dms: [],
    adminAlerts: [],
    async grantSubscriberRole(discordUserId) {
      this.granted.push(discordUserId);
    },
    async revokeSubscriberRole(discordUserId) {
      this.revoked.push(discordUserId);
    },
    async dmUser(discordUserId, message) {
      this.dms.push({ discordUserId, message });
    },
    async alertAdmin(message) {
      this.adminAlerts.push(message);
    },
  };
}

test("checkout.session.completed grants the role and remembers the customer mapping", async () => {
  const store = fakeStore();
  const notifier = fakeNotifier();
  const event = {
    type: "checkout.session.completed",
    data: { object: { id: "cs_1", client_reference_id: "discord-user-1", customer: "cus_1" } },
  };

  await handleStripeEvent(event, { store, notifier });

  assert.deepEqual(notifier.granted, ["discord-user-1"]);
  assert.equal(notifier.dms.length, 1);
  assert.equal(notifier.dms[0].discordUserId, "discord-user-1");
  assert.equal(store.get("stripeCustomer:cus_1"), "discord-user-1");
  assert.equal(notifier.adminAlerts.length, 0);
});

test("checkout.session.completed without a Discord user id alerts the admin instead of crashing", async () => {
  const store = fakeStore();
  const notifier = fakeNotifier();
  const event = {
    type: "checkout.session.completed",
    data: { object: { id: "cs_2", client_reference_id: null, customer: "cus_2" } },
  };

  await handleStripeEvent(event, { store, notifier });

  assert.deepEqual(notifier.granted, []);
  assert.equal(notifier.adminAlerts.length, 1);
});

test("customer.subscription.deleted revokes the role for the mapped Discord user", async () => {
  const store = fakeStore({ "stripeCustomer:cus_1": "discord-user-1" });
  const notifier = fakeNotifier();
  const event = {
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_1", customer: "cus_1" } },
  };

  await handleStripeEvent(event, { store, notifier });

  assert.deepEqual(notifier.revoked, ["discord-user-1"]);
  assert.equal(notifier.dms.length, 1);
});

test("customer.subscription.deleted for an unknown customer logs but does not throw", async () => {
  const store = fakeStore();
  const notifier = fakeNotifier();
  const event = {
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_2", customer: "cus_unknown" } },
  };

  await handleStripeEvent(event, { store, notifier });

  assert.deepEqual(notifier.revoked, []);
});

test("unhandled event types are ignored", async () => {
  const store = fakeStore();
  const notifier = fakeNotifier();

  await handleStripeEvent({ type: "invoice.payment_failed", data: { object: {} } }, { store, notifier });

  assert.deepEqual(notifier.granted, []);
  assert.deepEqual(notifier.revoked, []);
});
