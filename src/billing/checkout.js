/**
 * Creates a Stripe Checkout URL for a subscription, tagged with the
 * Discord user id so the webhook handler knows who to grant the role to
 * once payment completes - no need to ask the user to type their username.
 */
export async function createCheckoutUrl({ stripe, priceId, discordUserId, successUrl, cancelUrl }) {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: discordUserId,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return session.url;
}
