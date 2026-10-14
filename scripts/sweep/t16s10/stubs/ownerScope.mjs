// Stand-in for lib/ownerScope: the REAL file (so ownerLogPanel, ownerActorName, dbFail and the rest are
// the shipped code), with only the scope itself taken from the world — G.OSCOPE, or a 401 when absent.
import { G } from "../../../panel-stubs/state.mjs";
export * from "../../../../lib/ownerScope.ts";
export async function ownerScopeOr503() {
  return G.OSCOPE ? { scope: G.OSCOPE } : { resp: Response.json({ error: "unauthorized" }, { status: 401 }) };
}
