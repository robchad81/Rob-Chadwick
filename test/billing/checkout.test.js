import assert from "node:assert/strict";
import { test } from "node:test";

import { createCheckoutUrl } from "../../src/billing/checkout.js";

test("createCheckoutUrl tags the session with the Discord user id and returns its url", async () => {
  const calls = [];
  const fakeStripe = {
    checkout: {
      sessions: {
        async create(params) {
          calls.push(params);
          return { url: "https://checkout.stripe.com/pay/cs_test_123" };
        },
      },
    },
  };

  const url = await createCheckoutUrl({
    stripe: fakeStripe,
    priceId: "price_abc",
    discordUserId: "111222333",
    successUrl: "https://example.test/success",
    cancelUrl: "https://example.test/cancel",
  });

  assert.equal(url, "https://checkout.stripe.com/pay/cs_test_123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "subscription");
  assert.equal(calls[0].client_reference_id, "111222333");
  assert.deepEqual(calls[0].line_items, [{ price: "price_abc", quantity: 1 }]);
  assert.equal(calls[0].success_url, "https://example.test/success");
  assert.equal(calls[0].cancel_url, "https://example.test/cancel");
});
