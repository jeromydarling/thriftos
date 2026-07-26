/**
 * Service worker — keeping the register usable when the internet isn't.
 *
 * Scope is deliberately narrow. This caches the *shell*: the HTML, the CSS, the
 * JavaScript. It does not cache data, and it must never cache anything to do
 * with money.
 *
 * Three rules, in order of how badly breaking them would go:
 *
 *   1. Never touch a non-GET request. A cached POST would mean a replayed
 *      payment, and there is no version of that which is acceptable.
 *   2. Never cache /api/ responses. A stale price would undercharge, a stale
 *      payment status would tell a cashier a declined card went through, and a
 *      stale inventory read would sell an item that has already gone.
 *   3. Prefer the network for navigations, falling back to cache. A shop that
 *      is online should always see current data; the cache is a safety net, not
 *      a performance trick.
 *
 * The offline *sale queue* is not here — it lives in IndexedDB (app/lib/
 * offline.ts) because a queued sale must survive a cache eviction, and caches
 * are explicitly allowed to be cleared by the browser at any time.
 */

const VERSION = "thriftos-v1";
const SHELL = `${VERSION}-shell`;

/**
 * Pages worth having offline. The register first — it is the only screen where
 * being offline is a normal working condition rather than an inconvenience.
 */
const SHELL_URLS = ["/app/register", "/app", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Individually, and tolerant of failure: one 404 must not leave the
      // register with no cached shell at all.
      .then((cache) =>
        Promise.allSettled(SHELL_URLS.map((url) => cache.add(new Request(url, { cache: "reload" }))))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Rule 1. Anything that changes state goes straight to the network, always.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Rule 2. Data is never served from cache — a stale price or payment status
  // is worse than an error message.
  if (url.pathname.startsWith("/api/")) return;

  // Rule 3. Network first for pages, cache as the fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const register = await caches.match("/app/register");
          if (register) return register;
          return new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title>" +
              "<body style=\"font-family:system-ui;padding:2rem;max-width:32rem;margin:auto\">" +
              "<h1>You're offline</h1>" +
              "<p>This page hasn't been opened on this device yet, so there's nothing saved to show. " +
              "The register works offline once it's been opened once.</p>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        })
    );
    return;
  }

  // Build assets are content-hashed, so a cache hit is always the right file.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});
