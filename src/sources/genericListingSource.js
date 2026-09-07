import * as cheerio from "cheerio";

function assertConfigured(source) {
  const placeholderFields = ["itemSelector", "titleSelector", "linkSelector"].filter((field) =>
    String(source[field] ?? "").startsWith("VERIFY:")
  );
  if (placeholderFields.length > 0) {
    throw new Error(
      `Source "${source.id}" still has placeholder selectors for: ${placeholderFields.join(", ")}. ` +
        "Inspect the live page and fill these in before enabling it."
    );
  }
}

/**
 * Fetches a retailer listing page and extracts items using config-defined
 * CSS selectors. Selectors are per-source config rather than per-site code,
 * so adding/adjusting a retailer never requires a code change.
 */
export async function fetchListing(source) {
  assertConfigured(source);

  const response = await fetch(source.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/128.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for "${source.id}": HTTP ${response.status}`);
  }
  const html = await response.text();
  return parseListing(html, source);
}

/**
 * Some retailers replace the price with plain text like "Sold Out" rather
 * than adding a distinct element/class we can select on - outOfStockText
 * handles that case by checking the price text itself. outOfStockSelector
 * (an element that only exists when out of stock) is checked otherwise -
 * against the item itself as well as its descendants, since e.g. WooCommerce
 * puts an "outofstock" class directly on the product wrapper rather than on
 * a separate badge element.
 */
function isInStock(node, source, price) {
  if (source.outOfStockText) {
    return !(price ?? "").toLowerCase().includes(source.outOfStockText.toLowerCase());
  }
  if (source.outOfStockSelector) {
    return !(node.is(source.outOfStockSelector) || node.find(source.outOfStockSelector).length > 0);
  }
  return true;
}

export function parseListing(html, source) {
  const $ = cheerio.load(html);
  const items = [];

  $(source.itemSelector).each((_, el) => {
    const node = $(el);
    const titleEl = node.find(source.titleSelector).first();
    // Some sites bury the clean product name in an attribute (e.g. an
    // anchor's title="...") while its visible text is cluttered with
    // price/ABV/button text - titleAttr reads that attribute instead.
    const title = (source.titleAttr ? titleEl.attr(source.titleAttr) : titleEl.text())?.trim();
    const hrefRaw = node.find(source.linkSelector).first().attr(source.linkAttr ?? "href");
    if (!title || !hrefRaw) return;

    const url = new URL(hrefRaw, source.url).toString();
    const price = source.priceSelector ? node.find(source.priceSelector).first().text().trim() : undefined;
    const inStock = isInStock(node, source, price);

    items.push({ id: url, title, url, price, inStock });
  });

  return items;
}
