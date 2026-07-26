import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Marketing — server-rendered for SEO and for AI assistants reading the page.
  index("routes/home.tsx"),
  route("nri", "routes/nri.tsx"),
  route("pricing", "routes/pricing.tsx"),
  route("compare", "routes/compare.tsx"),
  route("help", "routes/help.tsx"),
  route("help/:slug", "routes/help.article.tsx"),
  route("guides", "routes/guides.tsx"),
  route("guides/:slug", "routes/guide.tsx"),

  // Auth
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),
  route("demo", "routes/demo.tsx"),

  // The old storefront address, kept as a permanent redirect: shops put their
  // URL on printed flyers and paper doesn't get redeployed.
  route("s/:slug", "routes/storefront.legacy.tsx"),
  route("s/:slug/:page", "routes/storefront.legacy.tsx", { id: "legacy-page" }),

  // A customer's receipt. Public by design — a shopper has no login.
  route("r/:token", "routes/receipt.tsx"),

  // The app
  route("app", "routes/app.tsx", [
    index("routes/app.dashboard.tsx"),
    route("welcome", "routes/app.welcome.tsx"),
    route("import", "routes/app.import.tsx"),
    route("intake", "routes/app.intake.tsx"),
    route("drawer", "routes/app.drawer.tsx"),
    route("money", "routes/app.money.tsx"),
    route("sales/:id", "routes/app.sale.tsx"),
    route("export", "routes/app.export.tsx"),
    route("studio", "routes/app.studio.tsx"),
    route("site", "routes/app.site.tsx"),
    route("domains", "routes/app.domains.tsx"),
    route("inventory", "routes/app.inventory.tsx"),
    route("register", "routes/app.register.tsx"),
    route("people", "routes/app.people.tsx"),
    route("donations", "routes/app.donations.tsx"),
    route("volunteers", "routes/app.volunteers.tsx"),
    route("impact", "routes/app.impact.tsx"),
    route("settings", "routes/app.settings.tsx"),
    route("help", "routes/app.help.tsx"),
  ]),

  // Stripe Connect onboarding round-trip
  route("stripe/connect/return", "routes/stripe.return.tsx"),
  route("stripe/connect/refresh", "routes/stripe.refresh.tsx"),

  // Machine-readable surfaces
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("llms.txt", "routes/llms.ts"),

  // A shop's own page, at the root of the path namespace: thriftos.app/{shop}.
  //
  // Declared last on purpose. Every system route above wins the match first,
  // and `reserved_slugs` stops a shop ever claiming one of them — belt and
  // braces, because a shop losing its website to a marketing page we shipped
  // would be entirely our fault.
  route(":slug", "routes/shop.tsx"),
  route(":slug/:page", "routes/shop.tsx", { id: "shop-page" }),
] satisfies RouteConfig;
