// verify-owner-delivery-apps.mjs — the owner sees delivery-app sales ONLY for the channels that are on.
//
// WHY (owner, 2026-10-11: "we can do that in owner about the platform only when the features is on only
// then"). Zomato, Swiggy and own-website orders live in aggregator_orders, which no owner screen read:
// the manager's Dashboard split them out, the owner's showed nothing. Mig 420 adds
// lfh_owner_channel_sales and the owner Dashboard draws a "Delivery apps" card from it. What must stay
// true, and what this proves:
//   1. a channel that is OFF is never returned — the card cannot show an app the restaurant hasn't got,
//      and a restaurant on no delivery app gets no card at all;
//   2. cancelled, rejected and DEMO orders are not sales (the demo tool's own guard: "fake orders must
//      never reach live revenue") — on the owner card AND on the manager's channel split, so the two
//      panels agree;
//   3. it is not added to Revenue (that stays the dine-in figure, as on the manager's Dashboard);
//   4. only the server may call the function, and it never answers for the whole platform by accident;
//   5. the dashboard snapshot re-reads when a delivery order or a channel switch changes (the cache
//      key moved, and the change-detector is the card's own answer).
//
//   node scripts/verify-owner-delivery-apps.mjs        static: repo files only (part of verify:static)
//   node scripts/verify-owner-delivery-apps.mjs --db   + the same rules against the DEV database, read-only:
//                                                        the function's answer vs an independent sum, for
//                                                        every restaurant that has a channel on
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/^\s*--.*$/gm, "");
let passed = 0, failed = 0;
const check = (ok, good, bad) => { if (ok) { passed++; console.log(`  ✓ ${good}`); } else { failed++; console.log(`  ✗ ${bad}`); } };
console.log("\nOWNER · DELIVERY APPS · only the channels that are on, never demo or cancelled, never in Revenue\n");

// ── the migration ──────────────────────────────────────────────────────────────────────────────
const migName = readdirSync(join(root, "supabase/migrations")).find((f) => /^420_.*delivery_app/.test(f));
check(!!migName, `migration 420 is in the one migrations folder (${migName})`, "migration 420 (lfh_owner_channel_sales) is missing");
const M = migName ? code(read(`supabase/migrations/${migName}`)) : "";
check(/\(s\.platform_channels -> c\.channel ->> 'on'\) = 'true'/.test(M), "a channel is returned only when platform_channels.<channel>.on is true", "the function no longer requires the channel to be ON");
check(/FROM on_channels oc\s+LEFT JOIN aggregator_orders a/.test(M), "every row starts from an ON channel (orders are joined to it, never the other way round)", "rows no longer start from the switched-on channels");
check(/a\.status NOT IN \('cancelled', 'rejected'\)/.test(M), "cancelled and rejected orders are not counted", "cancelled/rejected orders are counted");
check(/COALESCE\(a\.payload ->> 'demo', ''\) <> 'true'/.test(M), "demo orders are not counted", "demo orders are counted");
check(/\(p_restaurant_id IS NOT NULL OR p_ids IS NOT NULL\)/.test(M), "a call naming no restaurant answers nothing (never the whole platform)", "an unscoped call is no longer refused");
check(/\('website', 'takeaway'/.test(M) && !/'parcel'/.test(M), "website maps to source 'takeaway', and counter parcels are not a channel", "the channel → source map changed (website/takeaway, or parcels added)");
check(/REVOKE ALL ON FUNCTION public\.lfh_owner_channel_sales\([^)]*\) FROM PUBLIC, anon, authenticated;/.test(M) && /GRANT EXECUTE ON FUNCTION public\.lfh_owner_channel_sales\([^)]*\) TO service_role;/.test(M),
  "only the server (service_role) may call it", "the REVOKE/GRANT pair is missing");
check(/CREATE INDEX IF NOT EXISTS idx_aggregator_orders_restaurant_created\s+ON public\.aggregator_orders \(restaurant_id, created_at\)/.test(M), "the (restaurant_id, created_at) index exists for the window read", "the restaurant+time index is missing");

// ── the dashboard route ────────────────────────────────────────────────────────────────────────
const R = code(read("app/api/owner/analytics/route.ts"));
const rest = R.slice(R.indexOf("const restBase = await cachedOwnerPayload({"));
check(/sb\.rpc\("lfh_owner_channel_sales", \{ p_restaurant_id: rid, p_from: from, p_to: to \}\)/.test(rest), "the restaurant dashboard reads it for THIS restaurant and THIS window", "the restaurant dashboard no longer reads lfh_owner_channel_sales scoped to rid");
check(/key: `analytics:v7:rest:/.test(rest) && /fingerprint: \(\) => fpWithChannels\(\[rid\], from, to\)/.test(rest), "the snapshot key moved to v7 and its change-detector sees delivery orders and channel switches", "the cache key or the channel-aware fingerprint is gone");
check(/async function fpWithChannels[\s\S]{0,400}lfh_owner_channel_sales[\s\S]{0,400}ch:unread:\$\{Date\.now\(\)\}/.test(R), "a detector that cannot read answers a fresh value (recompute), never a constant", "the delivery-app detector can go numb on a failed read");
const kpis = (rest.match(/kpis: \{[^}]*\}/) || [""])[0];
check(kpis && !/chSales|deliveryApps/.test(kpis), "delivery-app sales are NOT added to Revenue (kpis)", `kpis now mixes in delivery sales: ${kpis.slice(0, 120)}`);
check(/deliveryApps: chSales\.error \? null :/.test(rest) && /chSales\.error \? \["deliveryApps"\]/.test(rest), "a failed read is null + partial 'deliveryApps' (said on the card), never a confident empty list", "a failed delivery-app read is no longer told apart from 'no channel on'");
check(/for \(const e of \[ts, dishes, cats, hourly, pm\]\) if \(e\.error\) throw e\.error;/.test(rest), "its failure cannot blank the dashboard (not in the throw loop)", "the throw loop changed — check delivery apps cannot blank the dashboard");
const group = R.slice(R.indexOf("if (!rid) {"), R.indexOf("const restBase = await cachedOwnerPayload({"));
check(/const chP = pIds \? sb\.rpc\("lfh_owner_channel_sales", \{ p_restaurant_id: null, p_from: from, p_to: to, p_ids: pIds \}\)/.test(group), "the group view reads it for THIS owner's restaurants only (pIds), and not at all for the admin's every-restaurant view", "the group view's delivery-app read is not scoped to the owner's restaurants");
check(/key: `analytics:v7:group:/.test(group) && /fingerprint: \(\) => fpWithChannels\(scope\.all \? null : gIds, from, to\)/.test(group), "the group snapshot key moved to v7 and its detector sees delivery orders", "the group cache key or its channel-aware fingerprint is gone");
check(/const deliveryApps = ch\.error \? null :/.test(group) && /partial\.push\("deliveryApps"\)/.test(group), "a failed group read is null + partial, never a confident empty list", "the group view no longer tells a failed read from 'no channel on'");
check(/staffPay, foodLoss, deliveryApps,/.test(group) && !/restaurantRevenue[^\n]*deliveryApps|revenue: num\([^\n]*ch\.data/.test(group), "the group view carries it beside the figures, never inside revenue", "the group view mixes delivery sales into revenue");

// ── the screen ─────────────────────────────────────────────────────────────────────────────────
const P = code(read("app/owner/page.tsx"));
check(/const deliveryAppsCard = [\s\S]{0,400}if \(!payload \|\| \(!rows\.length && !unread\)\) return null;/.test(P), "no channel on → no card at all", "the card can render for a restaurant with no channel on");
check(/\{deliveryAppsCard\(pl\(globalRange\) as GroupA \| undefined\)\}/.test(P) && /\{deliveryAppsCard\(pl\(globalRange\) as RestA \| undefined\)\}/.test(P),
  "the same card is on BOTH views — one restaurant's, and the group view an owner of several (or the admin) opens on", "the Delivery apps card is missing from one of the two dashboard views");
// styled-jsx scopes to the component that holds the <style jsx>: the card must be written INSIDE
// OwnerDashboard, or its heading row renders unstyled (the first version did exactly that).
{ const D = P.slice(P.indexOf("export default function OwnerDashboard()")); const end = D.search(/\n(export )?function [A-Z]/);
  const body = end > 0 ? D.slice(0, end) : D;
  check(/className="adm-card ow2-dapps"/.test(body) && ["ow2-ct", "ow2-ct .mut", "ow2-note", "ow2-tag"].every((c) => body.includes(`:global(.ow2-dapps .${c})`)),
    "the card's heading, tag and note are styled (its ow2-dapps class is listed on each shared rule)", "the card lost its ow2-dapps styling hook — its heading would render unstyled"); }
check(/Not included in Revenue above/.test(read("app/owner/page.tsx")), "the card says it is not part of Revenue", "the card no longer says it is separate from Revenue");
const PR = read("lib/partialRead.ts");
check(/\| "deliveryApps"/.test(PR) && /deliveryApps: "delivery-app sales"/.test(PR), "the unread note has words ('delivery-app sales'), not a code name", "partialRead lost the deliveryApps key or its label");

// ── the manager's channel split agrees ─────────────────────────────────────────────────────────
const E = code(read("app/api/editor/[...path]/route.ts"));
check(/demo:payload->>demo/.test(E) && /if \(pr\.demo === "true"\) continue;/.test(E), "the manager Dashboard's channel split leaves demo orders out too", "the manager's channel split counts demo orders again");

// ── --db: the same rules, against the dev database (read-only) ─────────────────────────────────
if (process.argv.includes("--db")) {
  const { refuseUnlessDevTestDb } = await import("./sweep/devStacks.mjs");
  const env = Object.fromEntries(read(".env.local").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
  refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "this guard reads the database");
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const sql = async (q) => { const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 200)); return JSON.parse(t); };
  const from = "now() - interval '400 days'", to = "now()";
  const got = await sql(`select r.id, c.channel, c.revenue::text rev, c.orders::int n from restaurants r, lateral lfh_owner_channel_sales(r.id, ${from}, ${to}) c`);
  const want = await sql(`
    with ch as (select s.restaurant_id, c.channel, c.source from settings s
                  cross join (values ('zomato','zomato'),('swiggy','swiggy'),('website','takeaway')) c(channel, source)
                 where s.platform_channels -> c.channel ->> 'on' = 'true')
    select ch.restaurant_id id, ch.channel,
           coalesce((select sum(a.total) from aggregator_orders a where a.restaurant_id = ch.restaurant_id and a.source = ch.source
                      and a.created_at >= ${from} and a.created_at < ${to} and a.status not in ('cancelled','rejected')
                      and coalesce(a.payload->>'demo','') <> 'true'), 0)::numeric(14,2)::text rev,
           (select count(*) from aggregator_orders a where a.restaurant_id = ch.restaurant_id and a.source = ch.source
              and a.created_at >= ${from} and a.created_at < ${to} and a.status not in ('cancelled','rejected')
              and coalesce(a.payload->>'demo','') <> 'true')::int n
      from ch`);
  const k = (x) => `${x.id}|${x.channel}`, G = new Map(got.map((x) => [k(x), x])), W = new Map(want.map((x) => [k(x), x]));
  const extra = [...G.keys()].filter((x) => !W.has(x)), missing = [...W.keys()].filter((x) => !G.has(x));
  const wrong = [...W.values()].filter((w) => G.has(k(w)) && (G.get(k(w)).rev !== w.rev || G.get(k(w)).n !== w.n));
  check(!extra.length && !missing.length, `exactly the ON channels come back — ${W.size} channel rows across ${new Set(want.map((x) => x.id)).size} restaurants, none extra, none missing`, `extra: ${extra.slice(0, 4).join(", ")} · missing: ${missing.slice(0, 4).join(", ")}`);
  check(!wrong.length && W.size > 0, `every channel's order value and count equal an independent sum (${W.size} rows)`, `differs: ${JSON.stringify(wrong.slice(0, 3))}`);
  const withSales = want.filter((x) => x.n > 0).length;
  check(withSales > 0, `…and the comparison is not empty: ${withSales} channel rows have real orders`, "no channel row has an order — the comparison proves nothing");
  const demoN = Number((await sql(`select count(*) n from aggregator_orders a join settings s using (restaurant_id) where a.payload->>'demo' = 'true' and a.status not in ('cancelled','rejected') and s.platform_channels -> (case a.source when 'takeaway' then 'website' else a.source end) ->> 'on' = 'true'`))[0].n);
  console.log(`  · note: ${demoN} demo order(s) on a switched-on channel exist on dev — each is left out of the sums above`);
  const off = await sql(`select r.id from restaurants r join settings s on s.restaurant_id = r.id where coalesce(s.platform_channels->'zomato'->>'on','') <> 'true' and coalesce(s.platform_channels->'swiggy'->>'on','') <> 'true' and coalesce(s.platform_channels->'website'->>'on','') <> 'true' limit 1`);
  if (off[0]) { const n = (await sql(`select count(*) n from lfh_owner_channel_sales('${off[0].id}', ${from}, ${to})`))[0].n; check(Number(n) === 0, "a restaurant with every channel off gets no rows (so no card)", `a restaurant with no channel on got ${n} rows`); }
  check(Number((await sql(`select count(*) n from lfh_owner_channel_sales(null, ${from}, ${to}, null)`))[0].n) === 0, "a call naming no restaurant answers nothing", "an unscoped call answered rows");
  const priv = await sql(`select r.rolname, has_function_privilege(r.rolname, 'public.lfh_owner_channel_sales(uuid,timestamptz,timestamptz,uuid[])', 'execute') can from pg_roles r where r.rolname in ('anon','authenticated','service_role')`);
  const P2 = Object.fromEntries(priv.map((x) => [x.rolname, x.can]));
  check(P2.anon === false && P2.authenticated === false && P2.service_role === true, "in the live catalog only service_role may call it", `privileges: ${JSON.stringify(P2)}`);
  const plan = (await sql(`explain (format json) select 1 from aggregator_orders a where a.restaurant_id = '00000000-0000-0000-0000-000000000001' and a.created_at >= now() - interval '30 days' and a.created_at < now()`))[0]["QUERY PLAN"][0].Plan;
  check(plan["Index Name"] === "idx_aggregator_orders_restaurant_created" && !!plan["Index Cond"], "the window read narrows through the new index (an Index Cond, not a walk)", `plan: ${plan["Node Type"]} ${plan["Index Name"] || ""}`);
}

console.log(`\n${failed ? "✗ FAIL" : "✓ PASS"} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
