import { createContext, type RouterContext } from "react-router";
import type { AppEnv } from "./env";

export interface CloudflareContext {
  env: AppEnv;
  ctx: ExecutionContext;
}

/**
 * The Cloudflare bindings, handed to loaders and actions through React Router
 * v8's typed context. The Worker entry sets this once per request.
 *
 * The key is pinned to a global singleton on purpose. The Worker entry and the
 * route modules are built into two separate bundles, so a plain module-level
 * `createContext()` can end up evaluated twice — once per graph — producing two
 * distinct keys. The entry then sets one and the loaders read the other, and
 * every request dies with "No value found for context". Vite's dev-time module
 * reloads make this happen mid-session. `Symbol.for` gives both copies the same
 * identity, whichever graph gets there first.
 */
const KEY = Symbol.for("thriftos.cloudflare.context");

type Registry = typeof globalThis & {
  [KEY]?: RouterContext<CloudflareContext>;
};

const registry = globalThis as Registry;

export const cloudflareContext: RouterContext<CloudflareContext> =
  registry[KEY] ?? (registry[KEY] = createContext<CloudflareContext>());
