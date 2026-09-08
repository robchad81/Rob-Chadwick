import { randomUUID } from "node:crypto";

import { fetchListing } from "./sources/genericListingSource.js";
import { logger } from "./logger.js";

/**
 * Compares a freshly fetched listing against the last-seen snapshot for a
 * source and returns what changed: brand-new items, and previously
 * out-of-stock items that have come back.
 */
export function diffListing(previousItems, currentItems) {
  const previousById = new Map(Object.entries(previousItems ?? {}));
  const newItems = [];
  const restocked = [];

  for (const item of currentItems) {
    const previous = previousById.get(item.id);
    if (!previous) {
      newItems.push(item);
    } else if (!previous.inStock && item.inStock) {
      restocked.push(item);
    }
  }

  return { newItems, restocked };
}

export function snapshotFromItems(currentItems) {
  const snapshot = {};
  for (const item of currentItems) snapshot[item.id] = item;
  return snapshot;
}

export class Poller {
  constructor({ config, store, notifier, schedule = setTimeout }) {
    this.config = config;
    this.store = store;
    this.notifier = notifier;
    this.schedule = schedule;
    this.failureCounts = new Map();
    this.alerted = new Set();

    // A free alert's delay is scheduled with an in-memory timer, which a
    // process restart (e.g. a redeploy) wipes out - without this, a change
    // found right before a restart would post instantly to the paid channel
    // but never reach the free one, since the item's also already marked
    // "seen" by then and won't be caught as new again on a later poll.
    // Rescheduling from what's persisted on disk closes that gap.
    this._reschedulePendingFreeAlerts();
  }

  _reschedulePendingFreeAlerts() {
    const pending = this.store.get("pendingFreeAlerts", {});
    for (const id of Object.keys(pending)) {
      const delayMs = Math.max(0, pending[id].postAt - Date.now());
      this.schedule(() => this._firePendingFreeAlert(id), delayMs);
    }
  }

  async pollOnce() {
    for (const source of this.config.sources) {
      if (source.enabled === false) continue;
      await this._pollSource(source);
    }
  }

  async _pollSource(source) {
    try {
      const currentItems = await fetchListing(source);
      if (currentItems.length === 0) {
        // A real "new arrivals" style page having genuinely zero items is
        // rare enough that this is far more likely a transient glitch (an
        // odd response, a layout hiccup) than reality. Treating it as a
        // failure - not saving it as the new baseline - matters a lot:
        // saving an empty snapshot here would make every item look "new"
        // again on the next successful poll and flood the alert channel.
        throw new Error("Parsed 0 items - selectors may be broken, or the page returned unexpected content");
      }

      const previousItems = this.store.get(`snapshot:${source.id}`, undefined);

      if (previousItems === undefined) {
        logger.info(
          `Seeding initial snapshot for "${source.id}" with ${currentItems.length} item(s) - ` +
            "no alerts sent for this baseline, only for changes after it."
        );
      } else {
        const { newItems, restocked } = diffListing(previousItems, currentItems);
        for (const item of newItems) {
          await this._postChange(source, "New release", item);
        }
        for (const item of restocked) {
          await this._postChange(source, "Back in stock", item);
        }
      }

      this.store.set(`snapshot:${source.id}`, snapshotFromItems(currentItems));
      this._recordSuccess(source);
    } catch (error) {
      await this._recordFailure(source, error);
    }
  }

  /**
   * Paid subscribers get alerted the instant a change is found. Everyone
   * else sees the same alert in the free channel, but only after
   * freeAlertDelayMs - that gap is the entire reason someone would pay.
   */
  async _postChange(source, kind, item) {
    await this.notifier.postInstantAlert(source, kind, item);

    const delayMs = this.config.freeAlertDelayMs ?? 0;
    const id = randomUUID();
    const pending = this.store.get("pendingFreeAlerts", {});
    pending[id] = { source: { id: source.id, name: source.name }, kind, item, postAt: Date.now() + delayMs };
    this.store.set("pendingFreeAlerts", pending);

    this.schedule(() => this._firePendingFreeAlert(id), delayMs);
  }

  async _firePendingFreeAlert(id) {
    const pending = this.store.get("pendingFreeAlerts", {});
    const entry = pending[id];
    if (!entry) return; // already fired - e.g. this process both scheduled and rescheduled it

    delete pending[id];
    this.store.set("pendingFreeAlerts", pending);

    try {
      await this.notifier.postFreeAlert(entry.source, entry.kind, entry.item);
    } catch (error) {
      logger.error(`Failed to post delayed free alert for "${entry.source.id}":`, error.message);
    }
  }

  _recordSuccess(source) {
    this.failureCounts.set(source.id, 0);
    if (this.alerted.has(source.id)) {
      this.alerted.delete(source.id);
      this.notifier.alertAdmin(`"${source.name}" is back to normal after previous failures.`);
    }
  }

  async _recordFailure(source, error) {
    const count = (this.failureCounts.get(source.id) ?? 0) + 1;
    this.failureCounts.set(source.id, count);
    logger.error(`Source "${source.id}" failed (${count} in a row):`, error.message);

    const threshold = this.config.consecutiveFailuresBeforeAlert ?? 3;
    if (count >= threshold && !this.alerted.has(source.id)) {
      this.alerted.add(source.id);
      await this.notifier.alertAdmin(
        `"${source.name}" has failed ${count} checks in a row. Last error: ${error.message}`
      );
    }
  }
}
