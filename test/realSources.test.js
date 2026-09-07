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

test("Abbey Whisky config selectors match a real sample page", () => {
  const source = findSource("abbey-whisky-new-arrivals");
  const items = parseListing(loadFixture("abbey-whisky-sample.html"), source);

  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Kilkerran 12 Year Old (Bottled 2026)");
  assert.equal(items[0].price, "£54.50");
  assert.equal(items[0].inStock, true);

  assert.equal(items[1].title, "Rare Old Sherry Cask");
  assert.equal(items[1].inStock, false);
});

test("Royal Mile Whiskies config selectors match a real sample page", () => {
  const source = findSource("royal-mile-whiskies-new-products");
  const items = parseListing(loadFixture("royal-mile-whiskies-sample.html"), source);

  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Glengoyne 17 Year Old Scottish Oak");
  assert.equal(items[0].inStock, true);

  assert.equal(items[1].title, "Caol Ila 2002 23 Year Old Connoiseurs Choice #8379");
  assert.equal(items[1].inStock, false);
});

test("Loch Fyne Whiskies config selectors match a real sample page", () => {
  const source = findSource("loch-fyne-whiskies-new");
  const items = parseListing(loadFixture("loch-fyne-whiskies-sample.html"), source);

  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Raer Single Malt Inaugural Release");
  assert.equal(items[0].price, "£68.00");
  assert.equal(items[0].inStock, true);

  assert.equal(
    items[1].inStock,
    false,
    "text-based 'Sold Out' detection, not the unreliable data-dimension10 attribute"
  );
});

test("Hard To Find Whisky config selectors match a real sample page", () => {
  const source = findSource("hard-to-find-whisky-new-arrivals");
  const items = parseListing(loadFixture("hard-to-find-whisky-sample.html"), source);

  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Jackton Distillery - Raer - Inaugural Lowland Single Malt Scotch Whisky");
  assert.equal(items[0].price, "£67.95");
  assert.equal(items[0].inStock, true, "no out-of-stock signal found on this page, so everything reads in stock");
});

test("The Spirits Embassy config selectors match a real sample page", () => {
  const source = findSource("spirits-embassy-latest-arrivals");
  const items = parseListing(loadFixture("spirits-embassy-sample.html"), source);

  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Lagavulin 16 Year Old");
  assert.equal(items[0].price, "£61.66");
  assert.equal(items[0].inStock, true);

  assert.equal(items[1].title, "Rare Sold Out Dram");
  assert.equal(items[1].inStock, false);
});

test("Whiskys.co.uk config selectors match a real sample page", () => {
  const source = findSource("whiskys-co-uk-new-in-stock");
  const items = parseListing(loadFixture("whiskys-co-uk-sample.html"), source);

  assert.equal(items.length, 1);
  assert.match(items[0].title, /Ardnamurchan AD\/10\.22/);
  assert.equal(items[0].price, "£150.00");
  assert.equal(items[0].inStock, true);
});

test("Whisky International Online config selectors match a real sample page", () => {
  const source = findSource("whisky-international-online-new");
  const items = parseListing(loadFixture("whisky-international-online-sample.html"), source);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Springbank 2026 Hand Filled Distillery Exclusive 56.3%");
  assert.equal(items[0].price, "£155.94 GBP");
  assert.equal(items[0].inStock, true);
});

test("House of Malt config selectors match a real sample page, including WooCommerce's item-level outofstock class", () => {
  const source = findSource("house-of-malt-new-arrivals");
  const items = parseListing(loadFixture("house-of-malt-sample.html"), source);

  assert.equal(items.length, 2);
  assert.match(items[0].title, /Booker's Bourbon/);
  assert.equal(items[0].inStock, true);

  assert.equal(items[1].title, "Rare Sold Out Dram");
  assert.equal(items[1].inStock, false);
});

test("Nickolls & Perks config selectors match a real sample page", () => {
  const source = findSource("nickolls-and-perks-new-whisky");
  const items = parseListing(loadFixture("nickolls-and-perks-sample.html"), source);

  assert.equal(items.length, 2);
  assert.match(items[0].title, /Highland Single Malt 19 Year Old 2007/);
  assert.equal(items[0].price, "£84.95", "should pick the first (inc. VAT) price, not the excl. VAT one nested inside it");
  assert.equal(items[0].inStock, true);

  assert.equal(items[1].title, "Rare Sold Out Dram");
  assert.equal(items[1].inStock, false);
});
