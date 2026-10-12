// Stand-in for lib/panelAccess: which restaurants an owner owns, from the shared fixture world.
import { G } from "../../../panel-stubs/state.mjs";
export async function enabledOwnedRestaurantIds(userId) { (G.OWNED_ASKED ||= []).push(userId); return (G.OWNED && G.OWNED[userId]) || []; }
