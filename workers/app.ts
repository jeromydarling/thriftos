/**
 * Worker entry — one Worker serves everything.
 *
 * /api/*  → Hono (JSON, webhooks, uploads)
 * else    → React Router v8 SSR (app + marketing site)
 * cron    → scheduled work (demo reset, NRI weekly signals, impact rollup)
 */
import { createRequestHandler, RouterContextProvider } from "react-router";
import { api } from "../app/api/index";
import { cloudflareContext } from "../app/lib/cf-context";
import type { AppEnv } from "../app/lib/env";
import { runDaily, runFrequent, runWeekly } from "../app/cron/scheduled";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }

    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env: env as AppEnv, ctx });

    return requestHandler(request, context);
  },

  async scheduled(controller, env, ctx) {
    // Matched explicitly rather than by elimination. A new trigger added to
    // wrangler.jsonc and forgotten here would silently run the daily pass on
    // its schedule, which is an expensive way to find out.
    if (controller.cron === "23 6 * * 1") {
      ctx.waitUntil(runWeekly(env));
    } else if (controller.cron === "*/10 * * * *") {
      ctx.waitUntil(runFrequent(env));
    } else {
      ctx.waitUntil(runDaily(env));
    }
  },
} satisfies ExportedHandler<Env>;
