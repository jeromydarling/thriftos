-- 0011_fulfillment — a sale line that couldn't be fulfilled must say so.
--
-- Completes the reservation fix. When two registers ring up the same
-- one-of-a-kind item, exactly one wins the reservation — but both took money
-- from a real customer, so neither sale may be silently discarded.
--
-- The losing line is recorded and marked unfulfilled. That is an operational
-- problem a person has to resolve at the counter, and the shop's books should
-- show one item sold and one line needing attention, rather than two sales of
-- a thing that only existed once.

ALTER TABLE transaction_items ADD COLUMN fulfillment_state TEXT NOT NULL DEFAULT 'fulfilled';
  -- fulfilled | unfulfilled | resolved

ALTER TABLE transaction_items ADD COLUMN fulfillment_note TEXT;

-- Unresolved lines are what the register and dashboard surface, so this is the
-- lookup that matters.
CREATE INDEX idx_txitems_unfulfilled ON transaction_items (org_id, fulfillment_state)
  WHERE fulfillment_state = 'unfulfilled';
