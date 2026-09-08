import { logger } from "../logger.js";

/**
 * Handles the two Stripe events this app cares about: a completed checkout
 * (grant the Discord role, remember which Discord user this Stripe customer
 * is) and a subscription actually ending (revoke the role). We deliberately
 * don't react to "payment_failed" or a subscription merely going past_due -
 * Stripe retries those automatically, and revoking access on a transient
 * card decline would be a bad experience for a paying customer.
 */
export async function handleStripeEvent(event, { store, notifier }) {
  // Stripe keeps retrying a webhook delivery on its own schedule for hours
  // after a failure (e.g. our signing secret being briefly wrong), even
  // after a manual "Resend" from the dashboard already got it through once.
  // Without this guard, a stale automatic retry can redeliver a long-since-
  // handled event and redo its action - e.g. re-granting a subscriber role
  // that a later cancellation had already correctly revoked.
  const processedKey = `processedStripeEvent:${event.id}`;
  if (store.get(processedKey, false)) {
    logger.info(`Ignoring Stripe event ${event.id} (${event.type}) - already processed once before.`);
    return;
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object, { store, notifier });
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionEnded(event.data.object, { store, notifier });
      break;
    default:
      break;
  }

  store.set(processedKey, true);
}

async function handleCheckoutCompleted(session, { store, notifier }) {
  const discordUserId = session.client_reference_id;
  const customerId = session.customer;

  if (!discordUserId || !customerId) {
    logger.error(
      `checkout.session.completed missing client_reference_id or customer (session ${session.id}) - ` +
        "cannot grant the Discord role automatically."
    );
    await notifier.alertAdmin(
      `A Stripe checkout completed (session ${session.id}) but had no Discord user id attached - ` +
        "check the payment manually and grant the Subscriber role yourself if it's genuine."
    );
    return;
  }

  store.set(`stripeCustomer:${customerId}`, discordUserId);
  await notifier.grantSubscriberRole(discordUserId);
  await notifier.dmUser(
    discordUserId,
    "You're subscribed! You now have instant access to new releases and restocks - check the members-only alerts channel."
  );
}

async function handleSubscriptionEnded(subscription, { store, notifier }) {
  const discordUserId = store.get(`stripeCustomer:${subscription.customer}`, undefined);

  if (!discordUserId) {
    logger.error(
      `customer.subscription.deleted for customer ${subscription.customer} has no known Discord user - ` +
        "role was never granted or the mapping was lost, nothing to revoke."
    );
    return;
  }

  await notifier.revokeSubscriberRole(discordUserId);
  await notifier.dmUser(
    discordUserId,
    "Your subscription has ended, so instant alerts access has been removed. You can still see free alerts " +
      "(with a delay) in the public channel, and you're welcome to resubscribe any time."
  );
}
