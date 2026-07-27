/**
 * A demo shop must never take real money.
 *
 * This exists because the platform runs on **live** Stripe keys. Everywhere
 * else in this codebase the demo is harmless — it seeds fake donors, fake
 * stock and fake sales, and resets every Monday. The one thing it must never
 * do is put a real card charge through, because a shopper who pays £22 for a
 * navy peacoat that does not exist has been taken money from, and a weekly
 * reset does not give it back.
 *
 * Today the demo can't reach a charge anyway: it has no connected Stripe
 * account, and both the buy button and the register's card path require one
 * with `charges_enabled`. That is a *circumstance*, not a rule. Somebody
 * connecting an account to the demo org — by accident, by testing, by
 * onboarding it to see the flow — would quietly turn the safety off, and
 * nothing anywhere would object.
 *
 * So the rule is written down and asserted at the two places money is created,
 * rather than left as a fact about the current state of a database row.
 *
 * Cash is deliberately untouched. Nothing leaves anybody's pocket when a
 * volunteer rings up a cash sale in the demo, and the demo's whole point is to
 * let people use the register.
 */
import { first } from "./db";

/** Thrown rather than returned: no caller has a sensible way to continue. */
export class DemoChargeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoChargeRefused";
  }
}

/**
 * Refuse to create a card charge for a demo org.
 *
 * Called immediately before a PaymentIntent or Checkout Session is created —
 * not at the start of a flow — so there is no path that reaches Stripe by
 * skipping a step or by a later branch that forgot to check.
 */
export async function assertRealShop(db: D1Database, orgId: string): Promise<void> {
  const org = await first<{ is_demo: number }>(
    db,
    `SELECT is_demo FROM orgs WHERE id = ?`,
    orgId
  );

  // An org we can't find is refused too. A missing row is not a licence to
  // charge somebody's card.
  if (!org) {
    throw new DemoChargeRefused("We can't find that shop, so nothing has been charged.");
  }

  if (org.is_demo === 1) {
    throw new DemoChargeRefused(
      "This is the demo shop, so it can't take a real payment — nothing has been charged. " +
        "Everything else works: ring the sale up as cash and watch it flow through the till, " +
        "the ledger and your figures exactly as a card sale would."
    );
  }
}
