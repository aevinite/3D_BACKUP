// scripts/sweep/t16s10/routes.mjs — my three public-list endpoints, the REAL route files bundled with
// esbuild and their handlers CALLED in memory. The database is scripts/panel-stubs/sb.mjs (records
// every read and write, opens no socket), the owner's phone alert is stubs/alerts.mjs (records,
// sends nothing), and the restaurant lookup is stubs/tenant.mjs. So a check can drive "no login",
// "a database blip", "a body too large", "a claim the address contradicts" without a single real
// request, a single row written, or a single phone buzzing.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, ROUTES } from "./lib.mjs";

const require_ = createRequire(import.meta.url);
const built = {};
let G = null, reset = null;
async function world0() {
  if (!G) { const st = await import(pathToFileURL(join(ROOT, "scripts/panel-stubs/state.mjs")).href); G = st.G; reset = st.resetWorld; }
  return G;
}
export async function route(name) {
  await world0();
  if (built[name]) return built[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";
  const out = join(ROOT, `node_modules/.cache/t16s10-${name}.cjs`);
  execFileSync("npx", ["esbuild", ROUTES[name], "--bundle", "--platform=node", "--format=cjs", "--alias:@=.",
    "--alias:@/lib/supabaseAdmin=./scripts/panel-stubs/sb.mjs",
    "--alias:@/lib/userAuth=./scripts/sweep/t16s10/stubs/userAuth.mjs",
    "--alias:@/lib/ownerScope=./scripts/sweep/t16s10/stubs/ownerScope.mjs",
    "--alias:@/lib/ownerEntitlements=./scripts/sweep/t16s10/stubs/ownerEntitlements.mjs",
    "--alias:@/lib/oplog=./scripts/panel-stubs/oplog.mjs",
    "--alias:@/lib/alerts=./scripts/sweep/t16s10/stubs/alerts.mjs",
    "--alias:@/lib/tenant=./scripts/sweep/t16s10/stubs/tenant.mjs",
    "--alias:@/lib/panelAccess=./scripts/sweep/t16s10/stubs/panelAccess.mjs",
    "--alias:next/server=./scripts/sweep/t16s10/stubs/next-server.mjs",
    "--external:next/dist/*", "--external:next/cache", "--external:next/headers",
    `--outfile=${out}`, "--log-level=error"], { cwd: ROOT });
  built[name] = require_(out);
  return built[name];
}
export const FH = "11111111-1111-4111-8111-111111111111", PP = "22222222-2222-4222-8222-222222222222";
/** A fresh world. who: manager | owner | admin | nobody | blip. */
export async function world(o = {}) {
  await world0(); reset();
  delete G.FAIL; delete G.FAIL_NTH; delete G.CALLS; G.HONOUR_LIMIT = true;
  G.ALERTS = []; G.AFTER = []; G.SLUGS = []; G.OWNED = o.owned || {}; G.OWNED_ASKED = [];
  // The owner panel's world (sweep #10 T16 round 2): the ownerScope answer, the cookie's owner, the
  // sections, and which "<rid>:<key>" sections are withheld.
  G.OSCOPE = o.oscope || null; G.COOKIE_USER = o.cookieUser || null; G.ENT = o.ent || {}; G.ENT_OFF = o.entOff || [];
  const who = o.who || "manager";
  const MANAGER = { id: "u1", role: "manager", name: "Diag Manager", username: "diagm1", restaurant_id: FH, permissions: {} };
  G.ACTOR = who === "admin" ? { ok: true, user: null }
    : who === "owner" ? { ok: true, user: { ...MANAGER, id: "o1", role: "owner", name: "Owner", username: "own1" } }
    : who === "nobody" ? { ok: false, transient: false }
    : who === "blip" ? { ok: false, transient: true }
    : { ok: true, user: MANAGER };
  G.FIX.restaurants = [
    { id: FH, slug: "french-house", name: "French House", access_config: o.access || {} },
    { id: PP, slug: "pizza-palace", name: "Pizza Palace", access_config: o.accessPP || {} },
  ];
  G.FIX.settings = o.settings || [{ id: "site", restaurant_id: FH, service_mode: false }, { id: "s2", restaurant_id: PP, service_mode: true }];
  G.FIX.staff_actions = o.actions || [];
  if (o.fail) G.FAIL = o.fail;
  return G;
}
/** Call one handler: { status, json, text, headers }. */
export async function call(name, verb, opts = {}) {
  const r = await route(name);
  const { NextRequest } = require_("next/dist/server/web/spec-extension/request");
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  const init = { method: verb, headers };
  if (opts.body !== undefined) init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const path = { health: "/api/health", clientError: "/api/log/client-error", maintenance: "/api/maintenance", ownerSettings: "/api/owner/settings" }[name];
  const res = await r[verb](new NextRequest(`http://localhost${path}${opts.query || ""}`, init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}
export const g = () => G;
