import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Marketing — server-rendered for SEO and for AI assistants reading the page.
  index("routes/home.tsx"),
  route("nri", "routes/nri.tsx"),
  route("pricing", "routes/pricing.tsx"),
  route("guides", "routes/guides.tsx"),
  route("guides/:slug", "routes/guide.tsx"),

  // Auth
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),
  route("demo", "routes/demo.tsx"),

  // The shop's own public page
  route("s/:slug", "routes/storefront.tsx"),

  // The app
  route("app", "routes/app.tsx", [
    index("routes/app.dashboard.tsx"),
    route("intake", "routes/app.intake.tsx"),
    route("inventory", "routes/app.inventory.tsx"),
    route("register", "routes/app.register.tsx"),
    route("people", "routes/app.people.tsx"),
    route("donations", "routes/app.donations.tsx"),
    route("volunteers", "routes/app.volunteers.tsx"),
    route("impact", "routes/app.impact.tsx"),
    route("settings", "routes/app.settings.tsx"),
  ]),

  // Machine-readable surfaces
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("llms.txt", "routes/llms.ts"),
] satisfies RouteConfig;
