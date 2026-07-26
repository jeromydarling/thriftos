/**
 * The cart cookie.
 *
 * One place, because a cookie written with different attributes in two routes
 * is two cookies, and the second one silently doesn't work.
 *
 * HttpOnly: a cart token identifies a basket and, briefly, an order. There is
 * no reason for a script to read it, and every reason a cross-site script
 * shouldn't. SameSite=Lax rather than Strict because a shopper returning from
 * Stripe's hosted checkout arrives via a cross-site redirect, and Strict would
 * drop the cookie on exactly that hop.
 */
export const CART_COOKIE = "tos_cart";

/** Long enough to come back tomorrow, short enough not to be a tracking cookie. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export function cartCookie(token: string, secure: boolean): string {
  return [
    `${CART_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Read the token out of a request, or null. */
export function cartTokenFrom(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${CART_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}
