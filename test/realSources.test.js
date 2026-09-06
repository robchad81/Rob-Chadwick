import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseListing } from "../src/sources/genericListingSource.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  return JSON.parse(readFileSync(join(__dirname, "..", "config.json"), "utf-8"));
}

function findSource(id) {
  const source = loadConfig().sources.find((s) => s.id === id);
  assert.ok(source, `config.json is missing source "${id}"`);
  return source;
}

function loadFixture(name) {
  return readFileSync(join(__dirname, "fixtures", name), "utf-8");
}

test("The Whisky Exchange config selectors match a real sample page", () => {
  const source = findSource("whisky-exchange-new-arrivals");
  const items = parseListing(loadFixture("whisky-exchange-sample.html"), source);

  assert.equal(items.length, 2, "should skip the load-more tile");
  assert.equal(items[0].title, "Elijah Craig 15 Year Old Single Barrel Bourbon");
  assert.equal(items[0].inStock, true);
  assert.equal(items[0].price, "£150");

  assert.equal(items[1].title, "Whitebox Raspberry Clover Club");
  assert.equal(items[1].inStock, false);
});

test("Master of Malt config selectors match a real sample page", () => {
  const source = findSource("master-of-malt-new-arrivals");
  const items = parseListing(loadFixture("master-of-malt-sample.html"), source);

  assert.equal(items.length, 3);

  const [inStock, onSale, soldOut] = items;
  assert.equal(inStock.title, "Tamnavulin 15 Year Old - Living Souls");
  assert.equal(inStock.price, "£66.95");
  assert.equal(inStock.inStock, true);

  assert.equal(onSale.title, "Talisker 1986 (bottled 1998) Amoroso Cask Finish - Distillers Edition");
  assert.equal(onSale.price, "£499", "should pick the sale price, not the crossed-out original");
  assert.equal(onSale.inStock, true);

  assert.equal(soldOut.title, "Kildalton 21 Year Old - Living Souls");
  assert.equal(soldOut.inStock, false);
});
