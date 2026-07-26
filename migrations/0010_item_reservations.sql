-- 0010_item_reservations — inventory is reserved by a payment, not sold by a sync.
--
-- Fixes the rule-12 violation: items were marked sold the moment a sale reached
-- the sync endpoint, regardless of whether any payment had been approved. An
-- item now stays 'held' against the transaction that reserved it, and only
-- becomes 'sold' when the payment reaches an approved terminal state.
--
-- The pointer is what makes release safe: when a payment fails we put back only
-- the items *that transaction* was holding, never one a later sale has since
-- legitimately picked up.

ALTER TABLE items ADD COLUMN held_by_transaction_id TEXT;

-- Finding a transaction's reservations is the hot path on both finalise and
-- release, and it runs inside a checkout.
CREATE INDEX idx_items_held_by ON items (org_id, held_by_transaction_id)
  WHERE held_by_transaction_id IS NOT NULL;

-- Existing rows: nothing is held, because nothing was ever reserved before now.
UPDATE items SET held_by_transaction_id = NULL;
