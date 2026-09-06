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
- The very first poll of a source (or after clearing its state) only
  records a baseline silently - it doesn't alert on everything currently
  listed, since that's not "new," just the first time we've looked.
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

## Sources currently enabled

Both The Whisky Exchange ("New Products") and Master of Malt ("New Arrivals -
Whisky") are enabled in `config.json`, with selectors verified against saved
copies of the live pages (see `test/fixtures/` and `test/realSources.test.js` -
`npm test` checks these selectors still parse correctly any time the code or
config changes).

Master of Malt's markup is a client-rendered React/Next.js app rather than
plain server-rendered HTML, which makes it more likely to break if they
change their frontend. If its logs start showing repeated failures (or an
admin DM about it), that's the first place to look - re-save the live page
and compare against `test/fixtures/master-of-malt-sample.html` to see what
changed.

To add another retailer later: open its listing page, Inspect a product
card to find the repeating element and the title/link/price/out-of-stock
selectors within it, add a new entry to `config.json` with `"enabled": true`,
and ideally a fixture + test like the two above. A source left on
placeholder (`"VERIFY: ..."`) selectors will throw a clear error rather than
silently doing nothing.

## Deploying to Render

This repo includes a `render.yaml` Blueprint, so deployment is mostly
point-and-click:

1. Push this repo to GitHub (already done if you're reading this from there).
2. On https://dashboard.render.com, click **New +** -> **Blueprint**, and
   connect this GitHub repo. Render will detect `render.yaml` automatically
   and set up a background worker on the $7/month Starter plan with a 1GB
   persistent disk (so `data/state.json` survives restarts/redeploys).
3. Render will prompt you to fill in the three secret environment variables
   (`DISCORD_BOT_TOKEN`, `ALERTS_CHANNEL_ID`, `ADMIN_DISCORD_ID`) from the
   Setup section above - paste them straight into Render's dashboard, never
   into a file that gets committed.
4. Deploy. The **Logs** tab in the Render dashboard shows exactly what the
   bot is doing (each poll, any alerts sent, any source failures) without
   needing a terminal.

Any time you push a change to this repo's default branch, Render redeploys
automatically.

## Not in this MVP (by design)

- No auto-checkout, proxies, or CAPTCHA-solving - this only reads public
  pages, which keeps it legal and far simpler to maintain than a
  sneaker-bot-style purchasing bot.
- No paid subscription tiers yet (Stripe + Discord role sync) - add this
  once the free alerts channel has proven there's real demand.
