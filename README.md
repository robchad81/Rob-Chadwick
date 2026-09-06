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
- Every change is posted instantly to the paid channel, and again to the
  free channel after `freeAlertDelayMs` (20 minutes by default) - that delay
  is the entire value proposition of paying.
- If a source fails to fetch/parse several times in a row, you (the admin)
  get a DM instead of the public channel going quiet - see
  `consecutiveFailuresBeforeAlert` in `config.json`.

## Setup

1. `npm install`
2. Create a Discord bot at https://discord.com/developers/applications,
   invite it to your server with permission to view/send messages, and
   copy `.env.example` to `.env`, filling in the Discord variables it
   describes (bot token, the two channel IDs, your own user ID for
   health-check DMs, the server/guild ID, and the Subscriber role ID -
   see "Monetization setup" below for the role/channel/Stripe pieces).
3. `npm start`

## Sources currently enabled

Five retailers have verified selectors in `config.json` (see `test/fixtures/`
and `test/realSources.test.js` - `npm test` checks these selectors still
parse correctly any time the code or config changes), but only two are
actually enabled and alerting:

- **Abbey Whisky** and **Loch Fyne Whiskies** - enabled, confirmed working
  in production (both seed their baseline cleanly, no blocking).
- **The Whisky Exchange**, **Master of Malt**, and **Royal Mile Whiskies** -
  disabled (`"enabled": false`, with a `"disabledReason"` explaining why).
  All three outright blocked requests from Render in production (403/429)
  even with realistic browser headers, which looks like IP-range blocking
  rather than anything fixable from the request side - smaller retailers
  aren't immune to this either, just less likely to have it. Their selectors
  are verified and ready to flip back on if we ever add a scraping-API/proxy
  service in front of them - see the git history around when they were
  disabled for the full investigation.

Master of Malt's markup is a client-rendered React/Next.js app rather than
plain server-rendered HTML, which would make it more likely to break if
enabled again and their frontend changes.

To add another retailer: open its listing page, Inspect a product card to
find the repeating element and the title/link/price selectors within it. For
out-of-stock detection, use `outOfStockSelector` (a CSS selector for an
element that only exists when out of stock) if the site has one, or
`outOfStockText` (a substring to check for in the price text, e.g. `"Sold
Out"`) if it doesn't - check both against a couple of real sold-out products
before trusting either, since some sites expose stock-status data attributes
that don't actually match what's displayed (Loch Fyne Whiskies does this).
Add the new entry to `config.json` with `"enabled": true`, and ideally a
fixture + test like the ones already there. A source left on placeholder
(`"VERIFY: ..."`) selectors will throw a clear error rather than silently
doing nothing.

## Monetization setup

Subscribing works by DMing the bot - no slash command registration or extra
Discord OAuth scopes needed (both would require re-inviting the bot).
Anyone who sends the bot a DM gets a personal Stripe Checkout link back;
paying grants them the Subscriber role automatically via a Stripe webhook,
and cancelling removes it automatically too. You'll want to point people at
this (e.g. a pinned message in the free channel: "DM me to get instant
alerts for £10/month").

One-time setup, all manual (nothing here can be scripted from outside your
own accounts):

1. **Discord role**: Server Settings -> Roles -> create a role (e.g.
   "Subscriber"). Drag the bot's own role above it in the list - a bot can
   only grant/revoke roles ranked below its own, and can't manage a role
   above it even with the right permission.
2. **Bot permission**: still in Roles, open the bot's own role and enable
   **Manage Roles**. (No need to re-invite the bot or change its OAuth
   scopes - permissions granted via a role apply immediately.)
3. **Instant-alerts channel**: create a new text channel, then in its
   permissions deny **View Channel** for @everyone and allow it for the
   Subscriber role - that's your `INSTANT_ALERTS_CHANNEL_ID`.
4. **Stripe**: create a free account at https://stripe.com, then
   **Product catalog** -> add a product (e.g. "Dram Radar Instant Alerts")
   with a recurring £10/month price - that price's id (`price_...`) is
   `STRIPE_PRICE_ID`. Your secret key is under **Developers -> API keys**.
5. **Stripe webhook**: once deployed (below) and you have the Render URL,
   go to **Developers -> Webhooks** in Stripe, add an endpoint at
   `https://<your-render-url>/stripe/webhook`, and select the
   `checkout.session.completed` and `customer.subscription.deleted` events.
   The signing secret it gives you is `STRIPE_WEBHOOK_SECRET`.

## Deploying to Render

This repo includes a `render.yaml` Blueprint, so deployment is mostly
point-and-click:

1. Push this repo to GitHub (already done if you're reading this from there).
2. On https://dashboard.render.com, click **New +** -> **Blueprint**, and
   connect this GitHub repo. Render will detect `render.yaml` automatically
   and set up a web service on the $7/month Starter plan with a 1GB
   persistent disk (so `data/state.json` survives restarts/redeploys). It's
   a web service rather than a background worker specifically so it can
   receive Stripe's webhook calls.
3. Render will prompt you to fill in the environment variables listed in
   `.env.example` - paste them straight into Render's dashboard, never into
   a file that gets committed. (The Stripe webhook secret needs the Render
   URL to exist first - see step 5 above - so that one can be added or
   updated after the first deploy, from the service's **Environment** tab.)
4. Deploy. The **Logs** tab in the Render dashboard shows exactly what the
   bot is doing (each poll, any alerts sent, any subscriptions granted or
   revoked) without needing a terminal.

Any time you push a change to this repo's default branch, Render redeploys
automatically.

If this service already exists on Render as a background worker from
before monetization was added, switching `render.yaml`'s type from `worker`
to `web` may require Render to recreate the service rather than update it
in place - if so, the persistent disk (and its saved snapshot state) may
not carry over. That's not a real problem: sources silently re-seed their
baseline on the next poll rather than alerting on everything, per "How it
works" above.

## Not in this MVP (by design)

- No auto-checkout, proxies, or CAPTCHA-solving - this only reads public
  pages, which keeps it legal and far simpler to maintain than a
  sneaker-bot-style purchasing bot.
