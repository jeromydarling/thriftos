import { redirect } from "react-router";
import type { Route } from "./+types/storefront.legacy";

/**
 * The old /s/{slug} address.
 *
 * Shops put their URL on flyers, window stickers, and business cards, and paper
 * doesn't get redeployed. A permanent redirect costs one route file and means
 * a card printed last month still works — deleting the old path would have
 * turned every one of those into a 404 for no benefit at all.
 */
export function loader({ params }: Route.LoaderArgs) {
  const slug = params.slug ?? "";
  const page = params.page ? `/${params.page}` : "";
  return redirect(`/${slug}${page}`, 301);
}
