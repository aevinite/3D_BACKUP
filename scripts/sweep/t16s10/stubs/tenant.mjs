// Stand-in for lib/tenant's ONE resolver, backed by the shared fixture world.
import { G } from "../../../panel-stubs/state.mjs";
export async function getRestaurantBySlug(slug) { (G.SLUGS ||= []).push(slug); return (G.FIX.restaurants || []).find((r) => r.slug === String(slug).toLowerCase()) || null; }
export const DEFAULT_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";
