import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseListing } from "../src/sources/genericListingSource.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const testSource = {
  id: "test-source",
  url: "https://example-retailer.test/new-arrivals",
  itemSelector: ".product-card",
  titleSelector: ".product-card__title",
  linkSelector: ".product-card__link",
  linkAttr: "href",
  priceSelector: ".product-card__price",
  outOfStockSelector: ".product-card__stock-flag",
};

function loadFixture() {
  return readFileSync(join(__dirname, "fixtures", "example-listing.html"), "utf-8");
}

test("parseListing extracts title, absolute url, price and stock state", () => {
  const items = parseListing(loadFixture(), testSource);

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    id: "https://example-retailer.test/products/glen-example-12yo",
    title: "Glen Example 12 Year Old",
    url: "https://example-retailer.test/products/glen-example-12yo",
    price: "£65.00",
    inStock: true,
  });
  assert.equal(items[1].inStock, false);
});

test("parseListing throws a clear error when selectors are still placeholders", async () => {
  const { fetchListing } = await import("../src/sources/genericListingSource.js");
  await assert.rejects(
    () => fetchListing({ id: "unconfigured", itemSelector: "VERIFY: fill me in" }),
    /still has placeholder selectors/
  );
});
