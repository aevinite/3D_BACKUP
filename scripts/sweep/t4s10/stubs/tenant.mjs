// Stand-in for lib/tenant.ts, for the routes that resolve a slug. W.misc.restaurant is the answer
// (an object, null for "nobody owns it", or "throw" for a failed read).
import { W } from "./world.mjs";
export const DEFAULT_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_RESTAURANT_SLUG = "french-house";
export async function getRestaurantBySlug(slug) {
  (W.misc.slugs ||= []).push(slug);
  const r = W.misc.restaurant;
  if (r === "throw") throw new Error("restaurants read failed");
  return typeof r === "function" ? r(slug) : r === undefined ? null : r;
}
export const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
