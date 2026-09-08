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
    instantAlerts: [],
    freeAlerts: [],
    adminAlerts: [],
    async postInstantAlert(source, kind, item) {
      this.instantAlerts.push({ source: source.id, kind, item });
    },
    async postFreeAlert(source, kind, item) {
      this.freeAlerts.push({ source: source.id, kind, item });
    },
    async alertAdmin(message) {
      this.adminAlerts.push(message);
    },
  };
}

/** Runs the scheduled callback immediately, synchronously, instead of waiting - keeps tests fast. */
function runImmediately(fn) {
  fn();
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

function cardHtml(...items) {
  return items
    .map(
      ({ href, title, price }) => `
    <li class="product-card">
      <a class="product-card__link" href="${href}"><span class="product-card__title">${title}</span></a>
      <span class="product-card__price">${price}</span>
    </li>`
    )
    .join("");
}

test("Poller seeds the first-ever poll of a source silently, then alerts on later changes", async () => {
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
  const originalFetch = global.fetch;
  const existing = { href: "/products/x", title: "X", price: "£10" };
  let html = cardHtml(existing);
  global.fetch = async () => ({ ok: true, text: async () => html });

  try {
    const config = { sources: [source], freeAlertDelayMs: 1200000 };
    const notifier = fakeNotifier();
    const poller = new Poller({ config, store: fakeStore(), notifier, schedule: runImmediately });

    // First poll ever: nothing to compare against, so no alerts even though
    // "X" wasn't seen before - it's the baseline, not a new release.
    await poller.pollOnce();
    assert.equal(notifier.instantAlerts.length, 0);
    assert.equal(notifier.freeAlerts.length, 0);

    // A genuinely new item appears on a later poll: this should alert -
    // instantly for paid subscribers, and (per the fake scheduler) also
    // immediately for this test, though in production that post is delayed.
    html = cardHtml(existing, { href: "/products/y", title: "Y", price: "£20" });
    await poller.pollOnce();
    assert.equal(notifier.instantAlerts.length, 1);
    assert.equal(notifier.instantAlerts[0].kind, "New release");
    assert.equal(notifier.instantAlerts[0].item.title, "Y");
    assert.equal(notifier.freeAlerts.length, 1);
    assert.equal(notifier.freeAlerts[0].item.title, "Y");

    // Polling again with the same data should not re-alert on the same item.
    await poller.pollOnce();
    assert.equal(notifier.instantAlerts.length, 1);
    assert.equal(notifier.freeAlerts.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Poller respects freeAlertDelayMs when scheduling the free-channel post", async () => {
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
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => cardHtml({ href: "/x", title: "X", price: "£10" }) });

  try {
    const scheduledDelays = [];
    const config = { sources: [source], freeAlertDelayMs: 1200000 };
    const notifier = fakeNotifier();
    const store = fakeStore({ "snapshot:good-source": {} }); // pretend we've already seeded once
    const poller = new Poller({
      config,
      store,
      notifier,
      schedule: (fn, delayMs) => scheduledDelays.push(delayMs),
    });

    await poller.pollOnce();
    assert.equal(notifier.instantAlerts.length, 1, "paid channel posts immediately, not scheduled");
    assert.deepEqual(scheduledDelays, [1200000]);
    assert.equal(notifier.freeAlerts.length, 0, "free post hasn't fired yet since we didn't run the scheduled fn");
  } finally {
    global.fetch = originalFetch;
  }
});

test("a free alert scheduled but not yet fired survives a process restart", async () => {
  const source = {
    id: "good-source",
    name: "Good Source",
    url: "https://example-retailer.test/new-arrivals",
    itemSelector: ".product-card",
    titleSelector: ".product-card__title",
    linkSelector: ".product-card__link",
    priceSelector: ".product-card__price",
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => cardHtml({ href: "/x", title: "X", price: "£10" }) });

  try {
    const config = { sources: [source], freeAlertDelayMs: 1200000 };
    const store = fakeStore({ "snapshot:good-source": {} }); // pretend we've already seeded once
    const notifier1 = fakeNotifier();

    // Simulates the real setTimeout scheduler: the callback is captured but
    // never actually invoked, standing in for a redeploy killing the process
    // before the real timer would have fired.
    const poller1 = new Poller({ config, store, notifier: notifier1, schedule: () => {} });
    await poller1.pollOnce();
    assert.equal(notifier1.freeAlerts.length, 0);
    assert.equal(Object.keys(store.get("pendingFreeAlerts", {})).length, 1);

    // A fresh Poller over the same (persisted) store, as if the process had
    // just restarted, should pick up and fire the pending alert rather than
    // losing it.
    const notifier2 = fakeNotifier();
    new Poller({ config, store, notifier: notifier2, schedule: runImmediately });
    assert.equal(notifier2.freeAlerts.length, 1);
    assert.equal(notifier2.freeAlerts[0].item.title, "X");
    assert.deepEqual(store.get("pendingFreeAlerts", {}), {}, "the fired entry should be cleared from the store");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Poller treats 0 parsed items as a failure rather than a valid empty snapshot", async () => {
  const source = {
    id: "good-source",
    name: "Good Source",
    url: "https://example-retailer.test/new-arrivals",
    itemSelector: ".product-card",
    titleSelector: ".product-card__title",
    linkSelector: ".product-card__link",
    priceSelector: ".product-card__price",
  };
  const originalFetch = global.fetch;
  // A page with no matching product cards at all - e.g. a glitch, an
  // unexpected redirect, or a layout change - but still HTTP 200.
  global.fetch = async () => ({ ok: true, text: async () => "<html><body>nothing here</body></html>" });

  try {
    const existingSnapshot = { x: { id: "x", title: "X", url: "https://x", inStock: true } };
    const config = { sources: [source], consecutiveFailuresBeforeAlert: 1 };
    const notifier = fakeNotifier();
    const store = fakeStore({ "snapshot:good-source": existingSnapshot });
    const poller = new Poller({ config, store, notifier });

    await poller.pollOnce();

    assert.equal(notifier.instantAlerts.length, 0, "should not treat every previously-seen item as newly missing/new");
    assert.equal(notifier.adminAlerts.length, 1, "0 items should be reported like any other failure");
    assert.deepEqual(
      store.get("snapshot:good-source"),
      existingSnapshot,
      "the real snapshot must survive a glitchy empty poll, or everything would look new again next time"
    );
  } finally {
    global.fetch = originalFetch;
  }
});
