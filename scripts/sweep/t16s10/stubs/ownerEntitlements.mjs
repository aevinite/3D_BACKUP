// Stand-in for lib/ownerEntitlements: the REAL constants, with the two per-restaurant answers taken from
// the world — G.ENT (the union of sections, {} = everything on) and G.ENT_OFF ("<rid>:<key>" withheld).
import { G } from "../../../panel-stubs/state.mjs";
export * from "../../../../lib/ownerEntitlements.ts";
export async function getOwnerEntitlementsUnion() { return G.ENT || {}; }
export async function entitledSubset(ids, key) { return ids.filter((id) => !(G.ENT_OFF || []).includes(id + ":" + key)); }
