import assert from "node:assert/strict";
import { test } from "node:test";

import { diffListing, snapshotFromItems, Poller } from "../src/poller.js";

test("diffListing finds brand-new items", () => {
  const previous = {};
  const current = [{ id: "a", title: "A", url: "https://x/a", inStock: true }];
  const { newItems, restocked } = diffListing(previous, current);
  assert.equal(newItems.length, 1);
  assert.equal(restocked.length, 0);
});

test("diffListing finds items that came back in stock, but not ones still out of stock", () => {
  const previous = {
    a: { id: "a", inStock: false },
    b: { id: "b", inStock: false },
  };
  const current = [
    { id: "a", title: "A", url: "https://x/a", inStock: true },
    { id: "b", title: "B", url: "https://x/b", inStock: false },
  ];
  const { newItems, restocked } = diffListing(previous, current);
  assert.equal(newItems.length, 0);
  assert.deepEqual(restocked.map((i) => i.id), ["a"]);
});

test("snapshotFromItems keys items by id", () => {
  const snapshot = snapshotFromItems([{ id: "a", inStock: true }]);
  assert.deepEqual(Object.keys(snapshot), ["a"]);
});

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
    alerts: [],
    adminAlerts: [],
    async postAlert(source, kind, item) {
      this.alerts.push({ source: source.id, kind, item });
    },
    async alertAdmin(message) {
      this.adminAlerts.push(message);
    },
  };
}

test("Poller alerts admin only after N consecutive failures, then once on recovery", async () => {
  const badSource = {
    id: "bad-source",
    name: "Bad Source",
    itemSelector: "VERIFY: never configured",
  };
  const config = { sources: [badSource], consecutiveFailuresBeforeAlert: 2 };
  const notifier = fakeNotifier();
  const poller = new Poller({ config, store: fakeStore(), notifier });

  await poller.pollOnce();
  assert.equal(notifier.adminAlerts.length, 0, "should not alert after only 1 failure");

  await poller.pollOnce();
  assert.equal(notifier.adminAlerts.length, 1, "should alert once threshold is hit");

  await poller.pollOnce();
  assert.equal(notifier.adminAlerts.length, 1, "should not re-alert every subsequent failure");
});

test("Poller posts alerts for new items found on a working source", async () => {
  const source = {
    id: "good-source",
    name: "Good Source",
    url: "https://example-retailer.test/new-arrivals",
    itemSelector: ".product-card",
    titleSelector: ".product-card__title",
    linkSelector: ".product-card__link",
    priceSelector: ".product-card__price",
    outOfStockSelector: ".product-card__stock-flag",
  };
  const html = `
    <li class="product-card">
      <a class="product-card__link" href="/products/x"><span class="product-card__title">X</span></a>
      <span class="product-card__price">£10</span>
    </li>`;
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => html });

  try {
    const config = { sources: [source] };
    const notifier = fakeNotifier();
    const poller = new Poller({ config, store: fakeStore(), notifier });

    await poller.pollOnce();
    assert.equal(notifier.alerts.length, 1);
    assert.equal(notifier.alerts[0].kind, "New release");

    // Second poll with the same data should not re-alert on the same item.
    await poller.pollOnce();
    assert.equal(notifier.alerts.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
