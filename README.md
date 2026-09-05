# Dram Radar

Monitors UK whisky/spirits retailers for new allocated releases, ballots, and
restocks, and posts instant alerts to a Discord channel. MVP scope is
alerts-only: it reads public listing pages, it never logs in, adds to basket,
or checks out.

## How it works

- `config.json` lists the retailer pages to watch, each with CSS selectors
  for the product grid on that page (no per-retailer code needed - adding a
  source is a config change).
- Every `pollIntervalMs`, each enabled source is fetched and parsed into a
  list of items (title, url, price, in-stock).
- That list is diffed against the last-seen snapshot (`data/state.json`) to
  find brand-new items and previously-out-of-stock items that came back.
  Both get posted to the Discord alerts channel.
- If a source fails to fetch/parse several times in a row, you (the admin)
  get a DM instead of the public channel going quiet - see
  `consecutiveFailuresBeforeAlert` in `config.json`.

## Setup

1. `npm install`
2. Create a Discord bot at https://discord.com/developers/applications,
   invite it to your server with permission to view/send messages in the
   alerts channel, and copy `.env.example` to `.env` filling in:
   - `DISCORD_BOT_TOKEN` - from the bot's page in the developer portal
   - `ALERTS_CHANNEL_ID` - the channel public alerts get posted to
   - `ADMIN_DISCORD_ID` - your own Discord user ID, for health-check DMs
3. `npm start`

## Before enabling a real source

Every source in `config.json` ships with `"enabled": false` and placeholder
selectors (`"VERIFY: ..."`). This environment couldn't reach the target
retailer sites to inspect their real markup, so the selectors are not
guessed - they need to be filled in against the live page:

1. Open the retailer's listing page in a browser, right-click a product
   card -> Inspect, and find the repeating element (`itemSelector`) plus
   the title/link/price/out-of-stock elements within it.
2. Fill those into the source's config entry.
3. Flip `"enabled": true`.
4. Run `npm test` - or point a quick script at a saved copy of the page - to
   sanity-check the selectors before letting it run against the live site.

A source left on placeholder selectors will throw a clear error (visible in
the logs, and eventually an admin DM) rather than silently doing nothing.

## Running it for real

This needs to run somewhere with normal internet access and stay up
continuously - a small VPS (e.g. a $5-6/month box), Railway, Fly.io, or a
Raspberry Pi at home all work. `npm start` under a process manager (pm2,
systemd, or the platform's own restart-on-crash) is enough for the MVP.

## Not in this MVP (by design)

- No auto-checkout, proxies, or CAPTCHA-solving - this only reads public
  pages, which keeps it legal and far simpler to maintain than a
  sneaker-bot-style purchasing bot.
- No paid subscription tiers yet (Stripe + Discord role sync) - add this
  once the free alerts channel has proven there's real demand.
