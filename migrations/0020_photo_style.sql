-- How each item's photograph was tidied.
--
-- Stored per item rather than per shop because it is a decision about the
-- object: cream mugs need a dark ground and a navy coat needs a light one, and
-- a single shop-wide setting would get one of them wrong every time.
--
-- Null means it predates the choice, which is the same as the old behaviour —
-- a plain cut-out on a light ground.
ALTER TABLE items ADD COLUMN photo_style TEXT;   -- plain | shadow | blur
ALTER TABLE items ADD COLUMN photo_ground TEXT;  -- light | dark
