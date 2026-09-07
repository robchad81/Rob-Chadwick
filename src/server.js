import express from "express";

import { handleStripeEvent } from "./billing/webhookEvents.js";
import { logger } from "./logger.js";

/**
 * The webhook route needs the raw request body (not JSON-parsed) to verify
 * Stripe's signature, so it's registered with express.raw() rather than the
 * usual express.json() - keep any future routes that need parsed JSON
 * bodies declared after this one, with their own body parser.
 */
export function createServer({ stripe, stripeWebhookSecret, store, notifier }) {
  const app = express();

  app.get("/", (_req, res) => {
    res.status(200).send("dram-radar is running");
  });

  // Monetization (and so Stripe) is optional config - if it's not set up
  // yet, there's no webhook to receive, so the route isn't registered at
  // all rather than erroring on every request.
  if (stripe && stripeWebhookSecret) {
    app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], stripeWebhookSecret);
      } catch (error) {
        logger.error("Stripe webhook signature verification failed:", error.message);
        res.status(400).send(`Webhook Error: ${error.message}`);
        return;
      }

      try {
        await handleStripeEvent(event, { store, notifier });
        res.status(200).send("ok");
      } catch (error) {
        logger.error(`Error handling Stripe event "${event.type}":`, error.message);
        res.status(500).send("internal error");
      }
    });
  }

  return app;
}
