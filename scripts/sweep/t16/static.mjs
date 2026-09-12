// SWEEP #8 · T16 — blocks A and B: the routes and the screens, read.
//
// Static assertions over the seven files this terminal owns. No key, no server, no login, so it
// re-runs in under a second and can be replayed by id for ever. Every row here is a claim about
// what EXECUTES: `code()` strips comments first, because every fix in this codebase quotes the
// wrong code it replaced verbatim a few lines above the right code (the lesson
// verify-owner-money-screens.mjs states in its own header).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rows = [];
export const results = rows;
const read = (f) => { try { return readFileSync(resolve(f), "utf8"); } catch { return ""; } };
// Line comments FIRST, then block comments — the order matters, because a `/*` that only ever
// existed inside a `//` line would otherwise open a comment the stripper closes hundreds of lines
// later (scripts/verify-panel-api-guards.mjs learned this and says so).
const code = (src) => src
  .split("\n").map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, "$1")).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

export const INV_ROUTE = "app/api/inventory/[...path]/route.ts";
export const MEDIA_ROUTE = "app/api/issue-media/route.ts";
export const CUSTOMERS = "app/owner/customers/page.tsx";
export const KHATA = "app/owner/khata/page.tsx";
export const ISSUES = "app/owner/issues/page.tsx";
export const INV_PAGE = "app/owner/inventory/page.tsx";
export const INV_UI = "components/owner/OwnerInventory.tsx";
export const SRC = {};
export const CODE = {};
for (const f of [INV_ROUTE, MEDIA_ROUTE, CUSTOMERS, KHATA, ISSUES, INV_PAGE, INV_UI]) {
  SRC[f] = read(f);
  CODE[f] = code(SRC[f]);
  if (!SRC[f]) throw new Error(`${f} not found — if it moved, update this suite`);
}

let n = 0;
export function check(id, what, fn, note = "") {
  n++;
  let res;
  try { res = fn() ? "✅" : "❌"; } catch (e) { res = `❌ threw: ${String(e.message).slice(0, 60)}`; }
  rows.push({ id, what, res, note });
  return res;
}
export const count = () => n;
export const has = (f, re) => re.test(CODE[f]);
export const hasRaw = (f, re) => re.test(SRC[f]);
export const countOf = (f, re) => (CODE[f].match(re) || []).length;
