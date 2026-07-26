-- 0018_demo_slug — move the demo shop off a slug that is now a route.
--
-- Shop pages moved to the root of the path namespace (/{slug}), and the demo
-- shop's slug was 'demo' — which is also the auto-login route. The route wins
-- the match, so the demo shop's public page became unreachable, and the
-- redirect from the old /s/demo address sent visitors to a URL that silently
-- signed them in as the demo user.
--
-- Renaming the shop is the right way round: '/demo' is the address printed in
-- marketing copy and typed by first-time visitors, and 'second-chances' is
-- what the shop is actually called.

UPDATE orgs SET slug = 'second-chances', updated_at = datetime('now')
 WHERE slug = 'demo' AND is_demo = 1;

-- 'second-chances' now belongs to the demo, so nobody else may claim it.
INSERT OR IGNORE INTO reserved_slugs (slug, reason)
VALUES ('second-chances', 'the demo shop');
