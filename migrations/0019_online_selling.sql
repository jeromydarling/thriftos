-- 0019_online_selling — the shop sells the same stock on the internet.
--
-- The whole design follows from one fact: every item is one of one, and it is
-- simultaneously hanging on a rail where somebody can carry it to the till. So
-- an online sale is not a new kind of thing that needs its own tables — it is a
-- transaction with a different channel, and it reserves stock through exactly
-- the machinery the register already uses.
--
-- That reuse is the point rather than a shortcut. `held_by_transaction_id`
-- (0010) and `fulfillment_state` (0011) were written because two registers can
-- ring the same item; the web is a third register with a slower cashier. The
-- ledger, refunds, fees, receipts and reporting then work on an online order
-- with no changes at all, because it is a transaction like any other.

/* ─── Where a sale came from, and where it's going ───────────────────────── */

-- register | online. Defaulted so every existing row is what it actually was.
ALTER TABLE transactions ADD COLUMN channel TEXT NOT NULL DEFAULT 'register';

-- ship | pickup. Null on a counter sale, where the goods leave in a bag.
ALTER TABLE transactions ADD COLUMN fulfilment_method TEXT;

-- awaiting | picking | ready | dispatched | collected | unfindable | refunded
--
-- Deliberately not merged with payment state. The money and the parcel are
-- different journeys: a paid order can still fail to be fulfilled because the
-- item is not on the rail, and that is an operational problem a person solves,
-- not a payment problem.
ALTER TABLE transactions ADD COLUMN fulfilment_status TEXT;

-- Computed server-side from the order's weight and the shop's bands. Never
-- accepted from the browser, like every other money field here.
ALTER TABLE transactions ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE transactions ADD COLUMN buyer_name TEXT;
ALTER TABLE transactions ADD COLUMN buyer_email TEXT;
ALTER TABLE transactions ADD COLUMN buyer_phone TEXT;

ALTER TABLE transactions ADD COLUMN ship_line1 TEXT;
ALTER TABLE transactions ADD COLUMN ship_line2 TEXT;
ALTER TABLE transactions ADD COLUMN ship_city TEXT;
ALTER TABLE transactions ADD COLUMN ship_state TEXT;
ALTER TABLE transactions ADD COLUMN ship_postal_code TEXT;
ALTER TABLE transactions ADD COLUMN ship_country TEXT;

-- Short, human, said out loud across a counter. Not the order id, which is
-- long and full of characters nobody wants to read from a phone screen.
ALTER TABLE transactions ADD COLUMN pickup_code TEXT;

ALTER TABLE transactions ADD COLUMN dispatched_at TEXT;
ALTER TABLE transactions ADD COLUMN collected_at TEXT;
ALTER TABLE transactions ADD COLUMN tracking_reference TEXT;

-- The shop's queue: everything paid for and not yet in a customer's hands.
CREATE INDEX idx_tx_fulfilment ON transactions (org_id, fulfilment_status, created_at)
  WHERE fulfilment_status IS NOT NULL;

CREATE INDEX idx_tx_channel ON transactions (org_id, channel, created_at DESC);

/* ─── Postage, by weight ─────────────────────────────────────────────────── */

-- Bands rather than live carrier rates, on purpose. A shop can explain a band
-- to a customer and to itself; a live rate that came back wrong is a mystery
-- nobody in the building can debug on a Saturday.
--
-- Weight is in grams because that's what scales read and it avoids fractions.
-- Items store pounds for the diversion reporting, and the converter lives in
-- one place rather than being re-derived per caller.
CREATE TABLE shipping_bands (
  id            TEXT PRIMARY KEY,                    -- sb_...
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,                       -- "Large letter", "Parcel"
  -- Inclusive upper bound. The heaviest band should be generous; an order over
  -- every band cannot be checked out, which is correct but must be visible.
  max_grams     INTEGER NOT NULL,
  price_cents   INTEGER NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_bands_org ON shipping_bands (org_id, is_active, max_grams);

/* ─── Carts ──────────────────────────────────────────────────────────────── */

-- A cart holds nothing.
--
-- Reserving stock when somebody clicks "add" would let one idle browser lock a
-- coat out of a shop for an afternoon. The hold is taken at checkout, for
-- minutes, by the same reserveItems() the register calls — so the worst case is
-- a shopper told at checkout that something has gone, which is the truth about
-- one-of-a-kind stock rather than a failure of the software.
CREATE TABLE carts (
  id          TEXT PRIMARY KEY,                      -- ct_...
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- Opaque, in an HttpOnly cookie. Not guessable, because a cart is a small
  -- window onto what somebody is about to buy.
  token       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_carts_token ON carts (token);
CREATE INDEX idx_carts_org ON carts (org_id, updated_at);

CREATE TABLE cart_items (
  cart_id    TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cart_id, item_id)
);

/* ─── Photographs ────────────────────────────────────────────────────────── */

-- The cleaned-up product shot. The original in `photo_key` is never replaced.
--
-- Two reasons, and the second is the important one. A cut-out can go wrong and
-- the shop needs its photograph back. And these are used goods: a listing must
-- be able to show what was actually photographed, so every enhanced image links
-- to its original. We straighten and light and drop the background out; we do
-- not mend the item.
ALTER TABLE items ADD COLUMN photo_enhanced_key TEXT;

-- Set when a shop has looked at the enhanced version and kept it. Until then
-- the listing shows the original, because an unreviewed cut-out is a guess.
ALTER TABLE items ADD COLUMN photo_enhanced_at TEXT;
