-- 0015_receipts — a customer-facing record of a sale.
--
-- Until now a shopper got nothing. That's a problem twice over: a customer who
-- wants to return something has no proof of what they paid, and a shop facing
-- a card dispute has no document to submit as evidence. "Compelling evidence"
-- in a chargeback is largely a receipt showing what was sold, when, and for
-- how much — a merchant who can't produce one loses by default.

-- An unguessable public handle for one sale.
--
-- A shopper cannot be expected to have an account, so the receipt has to be
-- reachable without a login. A random token scoped to a single transaction is
-- the standard shape: knowing it proves you were handed it, and it reveals
-- nothing about any other sale.
ALTER TABLE transactions ADD COLUMN receipt_token TEXT;

-- Where a copy was sent, if the shopper asked for one. Kept so a shop can
-- resend without asking the customer to read their address out again in a queue.
ALTER TABLE transactions ADD COLUMN receipt_email TEXT;
ALTER TABLE transactions ADD COLUMN receipt_sent_at TEXT;

CREATE UNIQUE INDEX idx_tx_receipt_token ON transactions (receipt_token)
  WHERE receipt_token IS NOT NULL;
