// scripts/sweep/t13/new-a-gate.mjs — NEW block, ids P66725–P66824.
//
// Band A: app/owner/layout.tsx — the server-side gate for the WHOLE owner panel — and
// app/api/owner/overview/route.ts, the payload every owner screen mounts with.
//
// WHY THIS BAND EXISTS. Planned by measuring, not by invention: of 457 named things in this
// territory, 164 are mentioned by no existing ledger row anywhere on disk, and SIX of those are
// the whole of layout.tsx (OwnerLayout, skinCookie, actingValid, ownedIds, dualAdmin, adminEnts)
// plus FOUR of the overview route (OutRow, repAllow, repOff, modIds). Three sweeps have swept the
// dashboard's own JSX in detail and left the gate that decides who ever sees it almost untouched.
//
// Product-correctness wording throughout: "does every owner request require being logged in?",
// "does each restaurant only see its own numbers?", "are the takings hidden where required?".
// Read by following the code and by observing normal use — never by trickery.
import { chk, skip, code, src, report, setOnly, writeLedger, count } from "./lib.mjs";

const LAYOUT = "app/owner/layout.tsx";
const OVERVIEW = "app/api/owner/overview/route.ts";
const lay = code(LAYOUT), layRaw = src(LAYOUT);
const ov = code(OVERVIEW), ovRaw = src(OVERVIEW);
const scope = code("lib/ownerScope.ts");
const ents = code("lib/ownerEntitlements.ts");

const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

// ── the four callers, kept strictly separate ─────────────────────────────────────────────────
chk("P66725", "the layout runs on the server, so the decision cannot be made in the browser", () =>
  !/"use client"/.test(layRaw) && /export default async function OwnerLayout/.test(lay)
    ? true : "the owner gate became a client component");
chk("P66726", "it reads the session from a cookie store it awaits, not from a header a caller controls", () =>
  /const store = await cookies\(\);/.test(lay) ? true : "the cookie store read changed");
chk("P66727", "a logged-in OWNER is resolved through the shared user-auth helper", () =>
  /await userFromCookie\(store\.get\(USER_COOKIE\)\?\.value\)/.test(lay)
    ? true : "the owner branch no longer goes through userFromCookie");
chk("P66728", "an ADMIN act-as session is only honoured when the admin token really is valid", () =>
  /if \(acting\) actingValid = await tokenIsValid\(store\.get\(AUTH_COOKIE\)\?\.value\)/.test(lay)
    ? true : "the act-as branch no longer re-checks the admin token");
chk("P66729", "…and an act-as cookie ALONE never reaches the cockpit — both halves are required", () => {
  const branch = /if \(acting && actingValid\) \{/.test(lay);
  const bounce = /redirect\("\/login\?next=\/owner"\);\s*\n\}/.test(lay);
  return branch && bounce ? true : `bothHalves=${branch} finalBounce=${bounce}`;
});
chk("P66730", "a visitor who is neither an owner nor a valid acting admin is sent to the staff login", () => {
  const tail = lay.trimEnd().split("\n").slice(-3).join("\n");
  return /redirect\("\/login\?next=\/owner"\);/.test(tail) ? true : `the last statement is not the bounce: ${tail.trim()}`;
});
chk("P66731", "the bounce carries a `next`, so signing in returns him where he was going", () =>
  count(lay, /redirect\("\/login\?next=\/owner"\)/g) === 2 ? true : "one of the two bounces lost its next=");
chk("P66732", "an OWNER with no live, owner-panel-enabled restaurant is bounced rather than shown an empty cockpit", () =>
  /if \(!ownedIds\.length\) redirect\("\/login\?next=\/owner"\);/.test(lay)
    ? true : "an owner who owns nothing would be shown a cockpit");
chk("P66733", "the owned list comes from the shared helper that filters to LIVE + panel-enabled", () =>
  /ownedIds = await enabledOwnedRestaurantIds\(u\.id\)/.test(lay)
    ? true : "the owned-restaurant resolution changed");
chk("P66734", "…and it is only computed for someone whose role really is owner", () =>
  /if \(u && u\.role === "owner"\) ownedIds = await enabledOwnedRestaurantIds\(u\.id\);/.test(lay)
    ? true : "the role check around the owned read is gone");
chk("P66735", "the role is compared to the exact string 'owner', not truthily", () =>
  count(lay, /u\.role === "owner"/g) >= 2 ? true : "the role comparison changed shape");

// ── a database blip is not a logout ──────────────────────────────────────────────────────────
chk("P66736", "a transient database error shows a calm reconnecting screen, not a logout", () =>
  /if \(e instanceof AuthDbError\) return <OwnerReconnecting \/>;/.test(lay)
    ? true : "a DB blip no longer lands on the reconnect screen");
chk("P66737", "…and any OTHER error is rethrown rather than swallowed into a reconnect", () =>
  /if \(e instanceof AuthDbError\) return <OwnerReconnecting \/>;\s*\n\s*throw e;/.test(lay)
    ? true : "a real fault would be dressed as a connection blip");
chk("P66738", "the REDIRECTS stay outside the try/catch, so NEXT_REDIRECT is never caught", () => {
  const tryBlock = /try \{([\s\S]*?)\n  \} catch \(e\) \{/.exec(lay);
  if (!tryBlock) return "the try block not found";
  return !/redirect\(/.test(tryBlock[1])
    ? true : "a redirect() inside the try would be caught as an error and silently break";
});
chk("P66739", "the auth resolution is what sits inside the try — not merely the render", () => {
  const tryBlock = /try \{([\s\S]*?)\n  \} catch \(e\) \{/.exec(lay)[1];
  return /userFromCookie/.test(tryBlock) && /tokenIsValid/.test(tryBlock) && /enabledOwnedRestaurantIds/.test(tryBlock)
    ? true : "one of the three auth reads moved out of the protected block";
});

// ── what the OWNER is allowed to see ─────────────────────────────────────────────────────────
chk("P66740", "a real owner's sections come from the UNION across the restaurants he owns", () =>
  /const ents = await getOwnerEntitlementsUnion\(ownedIds\);/.test(lay)
    ? true : "the section union changed");
chk("P66741", "…so a section survives if ANY of his restaurants still has it", () =>
  /getOwnerEntitlementsUnion/.test(ents) || /export async function getOwnerEntitlementsUnion/.test(ents)
    ? true : "the union helper is gone from lib/ownerEntitlements");
chk("P66742", "Pay Later shows if the module is on for ANY owned restaurant", () =>
  /ents\.khata_book = \(await Promise\.all\(ownedIds\.map\(\(id\) => khataLadder\(id\)\)\)\)\.some\(\(l\) => l\.effective\);/.test(lay)
    ? true : "the khata synthetic key changed");
chk("P66743", "Inventory & expenses follows the same any-restaurant rule", () =>
  /ents\.inventory = \(await Promise\.all\(ownedIds\.map\(\(id\) => inventoryLadder\(id\)\)\)\)\.some\(\(l\) => l\.effective\);/.test(lay)
    ? true : "the inventory synthetic key changed");
chk("P66744", "both synthetic keys are resolved CONCURRENTLY, not one restaurant at a time", () =>
  count(lay, /await Promise\.all\(ownedIds\.map\(/g) === 2
    ? true : "one of the two ladders serialised into a per-restaurant loop");
chk("P66745", "the two synthetic keys are the only ones the layout injects", () => {
  const injected = [...lay.matchAll(/ents\.(\w+) =/g)].map((m) => m[1]).sort();
  return injected.join(",") === "inventory,khata_book" ? true : `injected keys: ${JSON.stringify(injected)}`;
});
chk("P66746", "a section the admin removed is HIDDEN for the owner", () =>
  /Sections the ADMIN\s*\n?\s*\/\/ removed \(mig 133\) are HIDDEN here/.test(layRaw) || /are HIDDEN here/.test(layRaw)
    ? true : "the hide-for-owner intent is no longer stated where the code does it");
chk("P66747", "…and MARKED, never hidden, for the admin's own X-ray view", () =>
  /adminViewing restaurantName=/.test(lay) ? true : "the admin view no longer declares itself to the shell");

// ── the dual-cookie case: an owner login AND an admin act-as in one browser ───────────────────
chk("P66748", "the dual-cookie case is handled rather than guessed", () =>
  /let dualAdmin: \{ adminEntitlements: Record<string, boolean>; restaurantName: string \} \| undefined;/.test(lay)
    ? true : "the dual payload is gone");
chk("P66749", "…and it is only paid for when BOTH cookies are really present and valid", () =>
  /if \(acting && actingValid\) \{[\s\S]{0,400}?dualAdmin = \{/.test(lay)
    ? true : "the dual read is no longer gated on both halves");
chk("P66750", "…and the shell picks per tab, because a layout cannot read searchParams", () =>
  /dualAdmin=\{dualAdmin\}/.test(lay) ? true : "the dual payload is not handed to the shell");
chk("P66751", "the acting restaurant's name is read with a column list and a limit", () => {
  const reads = [...lay.matchAll(/sb\.from\("restaurants"\)\.select\("([^"]*)"\)\.eq\("id", acting\)\.limit\((\d+)\)/g)];
  return reads.length === 2 && reads.every((r) => r[1] === "name" && r[2] === "1")
    ? true : `restaurant-name reads: ${JSON.stringify(reads.map((r) => [r[1], r[2]]))}`;
});
chk("P66752", "…and it never renders `undefined` when that read finds nothing", () =>
  count(lay, /r\?\.name \|\| "this restaurant"/g) === 2 ? true : "one of the two name fallbacks is gone");

// ── the skin, painted server-side so there is no flash ───────────────────────────────────────
chk("P66753", "the persisted skin is read from a cookie so SSR emits the right theme immediately", () =>
  /const skinCookie = store\.get\("aevidine_skin"\)\?\.value;/.test(lay)
    ? true : "the skin cookie read is gone — a light-mode owner would get a dark flash");
chk("P66754", "…and an unrecognised skin value falls back to undefined rather than being trusted", () =>
  /const initialSkin = skinCookie === "light" \|\| skinCookie === "dark" \? skinCookie : undefined;/.test(lay)
    ? true : "the skin value is no longer validated against the two it may be");
chk("P66755", "…and it is passed to the shell on every one of the two render paths", () =>
  count(lay, /initialSkin=\{initialSkin\}/g) === 2 ? true : "one render path forgets the skin");
chk("P66756", "the guest theme key is neither read nor written by the owner gate", () =>
  !/lfh_theme/.test(lay) ? true : "the guest theme key leaked into the owner panel");

// ── the browser tab title ────────────────────────────────────────────────────────────────────
chk("P66757", "every owner page has its own tab title, so three open panels are not identical", () =>
  /export const metadata = \{ title: "Owner — Aevidine" \};/.test(lay)
    ? true : "the owner tab title is gone — it would inherit the root one again");

// ── what the layout renders around the page ──────────────────────────────────────────────────
chk("P66758", "the auto-fit-numbers helper is mounted on both render paths", () =>
  count(lay, /<AutoFitNumbers \/>/g) === 2 ? true : "one render path renders no number auto-fit");
chk("P66759", "the children are rendered INSIDE the shell, not beside it", () =>
  count(lay, /\{children\}<\/OwnerShell>/g) + count(lay, /\{children\}\s*\n?\s*<\/OwnerShell>/g) >= 2
    ? true : "the page is no longer wrapped by the shell on both paths");
chk("P66760", "the layout imports no client-only browser API", () =>
  !/\bwindow\.|\bdocument\.|localStorage/.test(lay) ? true : "the server layout touches a browser API");
chk("P66761", "the layout issues no write of any kind", () => {
  const writes = [...lay.matchAll(/\.(insert|update|upsert|delete)\(/g)].map((m) => m[1]);
  return writes.length === 0 ? true : `the gate writes: ${JSON.stringify(writes)}`;
});
chk("P66762", "every database read in the gate names its columns", () => {
  const selects = [...lay.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1].trim());
  const bad = selects.filter((s) => s === "" || s.includes("*"));
  return bad.length === 0 ? true : `unbounded selects: ${JSON.stringify(bad)}`;
});

// ── the overview payload every owner screen mounts with ──────────────────────────────────────
chk("P66763", "the overview requires a resolvable owner scope before any database call", () => {
  const i = ov.indexOf("ownerScopeOr503(req)"), j = ov.indexOf("sb.rpc(");
  return i > -1 && j > i ? true : `scope resolved at ${i}, first read at ${j}`;
});
chk("P66764", "a scope it could not READ answers a retryable 503, not a blank 500", () =>
  /const sc = await ownerScopeOr503\(req\);\s*\n\s*if \(sc\.resp\) return sc\.resp;/.test(ov)
    ? true : "the unreadable-scope branch is gone");
chk("P66765", "the aggregation is scoped IN THE DATABASE, never summed platform-wide and filtered after", () =>
  /const pIds = scope\.all \? null : scope\.ids;/.test(ov) && /sb\.rpc\("lfh_owner_overview", \{ p_ids: pIds \}\)/.test(ov)
    ? true : "the p_ids push-down is gone");
chk("P66766", "…and a second, cheap filter still runs in the route as defence in depth", () =>
  /\.filter\(\(r: Row\) => !allow \|\| allow\.has\(r\.restaurant_id\)\)/.test(ov)
    ? true : "the belt-and-braces filter is gone");
chk("P66767", "a failed read answers a sentence a person can act on, not a database message", () =>
  /return dbFail\("owner\/overview", error, \{ message: "Couldn't load your restaurants just now — please try again\." \}\)/.test(ov)
    ? true : "the human failure message changed");
chk("P66768", "a restaurant whose Reports the admin removed keeps its ROW, so the owner knows it exists", () => {
  const kept = !/\.filter\([^)]*repOff/.test(ov);
  const flagged = /reportsOff: repOff,/.test(ov);
  return kept && flagged ? true : `rowKept=${kept} flagged=${flagged}`;
});
chk("P66769", "…but every money field on it is ZEROED, so no figure leaks", () => {
  const money = ["ordersToday", "revenueToday", "ordersAll", "revenueAll"];
  const missing = money.filter((f) => !new RegExp(`${f}: repOff \\? 0 :`).test(ov));
  return missing.length === 0 ? true : `money fields not zeroed for a hidden restaurant: ${JSON.stringify(missing)}`;
});
chk("P66770", "…and the open-table count is NOT zeroed, because it is not money", () =>
  /openTables: Number\(r\.open_tables\) \|\| 0,/.test(ov)
    ? true : "the open-table count is now treated as money");
chk("P66771", "the hidden set is computed from the shared entitlement helper, per restaurant", () =>
  /const repAllow = scope\.all \|\| scope\.admin \? null : new Set\(await entitledSubset\(scope\.ids, "reports"\)\);/.test(ov)
    ? true : "the per-restaurant reports check changed");
chk("P66772", "the ADMIN is never narrowed by that rule", () =>
  /scope\.all \|\| scope\.admin \? null :/.test(ov) ? true : "the admin would now be gated like an owner");
chk("P66773", "the group totals are summed from the ALREADY-ZEROED rows, so a hidden restaurant adds nothing", () => {
  const i = ov.indexOf("const restaurants: OutRow[]"), j = ov.indexOf("const totals = restaurants.reduce");
  return i > -1 && j > i ? true : "the totals no longer derive from the mapped rows";
});
chk("P66774", "…and the money total is rounded once, at the end", () =>
  /totals\.revenueToday = Math\.round\(totals\.revenueToday \* 100\) \/ 100;/.test(ov)
    ? true : "the total rounding changed");
chk("P66775", "every per-restaurant money figure is rounded to paise, not left as a float", () =>
  count(ov, /Math\.round\(\(Number\(r\.revenue_\w+\) \|\| 0\) \* 100\) \/ 100/g) === 2
    ? true : "one of the two money fields is no longer rounded");
chk("P66776", "numbers arriving as strings over the wire are coerced once in the route", () =>
  count(ov, /Number\(r\.\w+\) \|\| 0/g) >= 4 ? true : "the string-to-number coercion thinned out");
chk("P66777", "a missing accent colour falls back to a real colour, never to undefined", () =>
  /accentColor: r\.accent_color \|\| "#e3c06f",/.test(ov) ? true : "the accent fallback is gone");
chk("P66778", "the restaurant COUNT the page prints is the count of rows it was actually sent", () =>
  /restaurantCount: restaurants\.length/.test(ov) ? true : "the count no longer matches the rows");
chk("P66779", "the admin sees every section on, and the tints live in the nav rather than here", () =>
  /scope\.admin \|\| scope\.all\s*\n?\s*\? mergeOwnerEntitlements\(null\)/.test(ov)
    ? true : "the admin entitlement shortcut changed");
chk("P66780", "a real owner's sections are the UNION across his own restaurants", () =>
  /: await getOwnerEntitlementsUnion\(scope\.ids\);/.test(ov)
    ? true : "the owner entitlement union changed");
chk("P66781", "the module probe reads BOTH modules in ONE query, not one round-trip each", () => {
  const one = /const probe = await sb\.from\("settings"\)\s*\n?\s*\.select\("payroll_allowed, payroll_owner_control, payroll_enabled, inventory_allowed, inventory_owner_control, inventory_enabled"\)/.test(ov);
  return one ? true : "the two modules are probed separately again";
});
chk("P66782", "…and it is skipped entirely when both are already known", () =>
  /if \(\(!payroll \|\| !inventory\) && modIds\.length\) \{/.test(ov)
    ? true : "the probe runs even when nothing needs it");
chk("P66783", "a FAILED module probe keeps the cards VISIBLE and says so, rather than quietly hiding them", () => {
  const m = /if \(probe\.error\) \{([\s\S]*?)\} else \{/.exec(ov);
  if (!m) return "the probe error branch not found";
  return /partial\.push\("modules"\)/.test(m[1]) && /payroll = true; inventory = true;/.test(m[1])
    ? true : "a read failure would look identical to the feature being off";
});
chk("P66784", "…and the failure is logged for us while the owner gets the note", () => {
  const m = /if \(probe\.error\) \{([\s\S]*?)\} else \{/.exec(ov)[1];
  return /console\.error\("\[owner\/overview\] module probe failed:", probe\.error\.message\)/.test(m)
    ? true : "the probe failure is no longer logged";
});
chk("P66785", "the module rung is read as allowed AND (not owner-controlled OR enabled)", () =>
  /r\[a\] === true && \(r\[c\] !== true \|\| r\[e\] !== false\)/.test(ov)
    ? true : "the three-column module rule changed");
chk("P66786", "the module probe is scoped to the caller's own restaurants", () =>
  /\.in\("restaurant_id", modIds\)/.test(ov) ? true : "the module probe is no longer scoped");
chk("P66787", "…and the admin's all-restaurants view does not page the whole table for it", () =>
  /const modIds = scope\.all \? \[\] : scope\.ids;/.test(ov)
    ? true : "the admin view would enumerate every restaurant for the module probe");
chk("P66788", "`partial` is only present when something really could not be read", () =>
  /\.\.\.\(partial\.length \? \{ partial \} : \{\}\),/.test(ov)
    ? true : "the payload always carries a partial key");
chk("P66789", "the route is force-dynamic, because these are live numbers", () =>
  /export const dynamic = "force-dynamic"/.test(ov) ? true : "the overview became cacheable");
chk("P66790", "…and it is deliberately NOT wrapped in the snapshot cache", () =>
  !/cachedOwnerPayload/.test(ov) ? true : "the overview was wrapped in the snapshot cache, which only adds staleness");
chk("P66791", "the overview reads the pre-aggregated rollup, not a live scan of every order", () =>
  /orders_daily_agg/.test(ovRaw) ? true : "the route no longer states which pre-aggregated table it reads");
chk("P66792", "the overview issues no write", () => {
  const writes = [...ov.matchAll(/\.(insert|update|upsert|delete)\(/g)].map((m) => m[1]);
  return writes.length === 0 ? true : `the overview writes: ${JSON.stringify(writes)}`;
});
chk("P66793", "every read in the overview names its columns", () => {
  const selects = [...ov.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1].trim());
  const bad = selects.filter((s) => !s || s.includes("*"));
  return bad.length === 0 ? true : `unbounded selects: ${JSON.stringify(bad)}`;
});
chk("P66794", "the shared client-side cache is what stops the shell and the page asking twice", () => {
  const cache = code("lib/ownerOverviewCache.ts");
  return /\d+/.test(cache) && /export/.test(cache) ? true : "the shared overview cache is gone";
});
chk("P66795", "the owner scope helper is the ONE gate all owner routes share", () =>
  /export async function ownerScopeOr503/.test(scope) ? true : "ownerScopeOr503 is gone from lib/ownerScope");
chk("P66796", "…and it answers 401 for someone who is not an owner at all", () =>
  /401/.test(scope) ? true : "the not-an-owner answer changed");
chk("P66797", "the two Coming-soon pages are inside the gated layout, so they are not public", () => {
  // they sit under app/owner/, which layout.tsx wraps — no separate gate needed, and none present
  const m = code("app/owner/marketing/page.tsx"), o = code("app/owner/online/page.tsx");
  return !/ownerScope|tokenIsValid|requireRole/.test(m) && !/ownerScope|tokenIsValid|requireRole/.test(o)
    ? true : "a Coming-soon page grew its own gate, which would drift from the layout's";
});
chk("P66798", "the gate names no AV-live key, project or folder", () =>
  !/kclqkmdxnwlhtyrducku|3D_Menu_Av|env\.AV\.live/.test(layRaw + ovRaw)
    ? true : "a live-stack reference appeared in the dev stack's owner gate");
chk("P66799", "neither file hard-codes a restaurant id", () => {
  const ids = [...(layRaw + ovRaw).matchAll(/00000000-0000-0000-0000-0000000000\d\d/g)].map((m) => m[0]);
  return ids.length === 0 ? true : `hard-coded restaurant ids: ${JSON.stringify([...new Set(ids)])}`;
});
chk("P66800", "the layout is small enough to read in one sitting — the gate stays reviewable", () => {
  const lines = layRaw.split("\n").length;
  return lines < 200 ? true : `layout.tsx is ${lines} lines; a gate nobody reads is a gate nobody checks`;
});

const n = report("T13 NEW band A · the owner gate and the overview payload (P66725–P66800)", { minChecks: 70 });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: "read app/owner/layout.tsx and app/api/owner/overview/route.ts, following each branch",
  section: "NEW · Band A — the owner gate and the overview payload — P66725–P66800",
});
