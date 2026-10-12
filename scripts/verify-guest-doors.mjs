#!/usr/bin/env node
// verify-guest-doors.mjs — THE THREE GUEST DOORS MUST ALL REACH THE SAME RESTAURANT,
// AND A GUEST'S TAP MUST NEVER LIE.
//
//   node scripts/verify-guest-doors.mjs
//   node scripts/verify-guest-doors.mjs --hook   # PostToolUse mode (reads the tool call on stdin)
//
// WHY THIS EXISTS (sweep 6, terminal 3, 2026-08-17)
//
//   1. THE PRINTED TABLE STICKER WAS ON THE WRONG RESTAURANT.
//      A restaurant's guest menu has three doors — `/menu`, `/r/<slug>/menu` and `/q/<code>` —
//      and CLAUDE.md says every guest rule must hold in all three. `/q/<code>` deliberately keeps
//      its own URL (the table number must not go back in the address bar), so there is no
//      `/r/<slug>` in the path. `lib/tenantStorage.ts` handles that by reading the tenant the tab
//      was PINNED to; `lib/restaurant-context.tsx` carried a SECOND, shorter copy of the same rule
//      and did not, so every global widget — the basket, the table-session gate, the feature
//      switches, the tax rate, the bell — answered "restaurant #1".
//
//      Watched on Aangan's own table-1 sticker: Aangan has the dining-session system OFF, but the
//      widgets read restaurant #1's settings where it is ON, so tapping "+" on a dish opened the
//      join-a-table gate instead of adding it and the basket stayed empty. A diner scanning the
//      sticker on their table could not order at all. It went unnoticed because restaurant #1's
//      own stickers resolve to #1 by accident — the right answer for exactly one restaurant.
//
//   2. "WE'VE LET THE STAFF KNOW" WAS SAID WHETHER OR NOT ANYONE HAD BEEN TOLD.
//      `requestAccess` never throws — a timeout comes back as `{ ok:false, reason:"timed_out" }` —
//      and the gate threw the answer away and showed the reassurance screen regardless. A diner at
//      a table nobody had opened sat watching a promise with no request anywhere near the floor.
//
//   3. THE ORDER TRACKER OVERWROTE WHATEVER HAPPENED WHILE IT WAS AWAITING.
//      Its poll read `lfh_active_orders`, made one network call per order, then wrote the copy it
//      had read. Everything else that touches that list reads and writes in one synchronous step.
//      So a strip the diner had just dragged away came back, and an order the offline queue had
//      just delivered and recorded vanished from their phone though the kitchen had it.
//
//   4. THE RETURNING-GUEST GREETING ASKED ABOUT THE PLACEHOLDER RESTAURANT.
//   5. THE ✕ ON THE TABLE BOX CLEARED THE MEMORY WITHOUT TELLING ANYONE.
//   6. "ORDER THE REST" COULD REFUSE AND SAY NOTHING.
//   7. THE TABLE-SESSION GATE CACHED ONE RESTAURANT'S SETTINGS FOR THE LIFE OF THE PAGE.
//
// Static: it reads the shipped files. No database, no login, no deployed site — so it can never
// add load or trip one of the app's own limits, and it runs in well under a second.
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = process.argv.includes("--hook");
// The files these checks are about. Editing one re-runs the guard; editing anything else costs
// nothing. Keep this in step with the files the checks actually read.
const WATCHED =
  /[/\\](lib[/\\](restaurant-context\.tsx|tenantStorage\.ts|tenant\.ts|panelGate\.ts)|components[/\\](SessionGate|OrderTracker|CustomerGreeter|ChefPopup|CartPanel|GuestOutboxChip)\.tsx|app[/\\]q[/\\]\[code\][/\\]page\.tsx|app[/\\]r[/\\]\[restaurant\][/\\].*)$/;

let ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
if (HOOK) {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { process.exit(0); }
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const file = String(payload?.tool_input?.file_path || payload?.tool_response?.filePath || "").replace(/\\/g, "/");
  if (!WATCHED.test(file)) process.exit(0);                       // not our business
  // Work out which checkout the edit was in (this may be a worktree, not the main folder).
  const m = file.match(/^(.*)\/(lib|components|app)\//);
  if (m && existsSync(join(m[1], "package.json"))) ROOT = m[1];
  // A guard must never break someone's edit: if this checkout predates the pipeline, go quiet.
  if (!existsSync(join(ROOT, "lib/restaurant-context.tsx"))) process.exit(0);
}

const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
// ── CODE-ONLY, FOR THE ROWS THAT ARE ABOUT CODE (T1, 2026-09-15) ──────────────────────────────
// `read()` returns the file as written, comments and all, and that is DELIBERATE for the rows here
// that assert a written-down reason ("…and the reason is written down where the next reader will
// see it"). But a row about what the code DOES must not be satisfiable by a line somebody commented
// out. Sabotage-proved while checking the fix below: commenting out `settingsByRid.current.set(rid,
// s);` left this guard green, because the text was still in the file.
// Line comments are stripped BEFORE block comments — a `/*` inside a `//` line has hidden real code
// from a stripper in this repo before.
const codeOnly = (src) => src.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
let fail = 0;
const out = [];
const check = (name, ok) => { out.push((ok ? "  ok   " : "  FAIL ") + name); if (!ok) fail++; };
const say = (s) => out.push(s);

const ctx = read("lib/restaurant-context.tsx");
const tstore = read("lib/tenantStorage.ts");
const qdoor = read("app/q/[code]/page.tsx");
const gate = read("components/SessionGate.tsx");
const tracker = read("components/OrderTracker.tsx");
const greeter = read("components/CustomerGreeter.tsx");
const chef = read("components/ChefPopup.tsx");
const cart = read("components/CartPanel.tsx");
const chip = read("components/GuestOutboxChip.tsx");

say("\n1) All three guest doors reach the SAME restaurant");
// The whole point: ONE rule, imported — not a second copy that can drift again.
check("the tenant rule lives in lib/tenantStorage.ts and is EXPORTED",
  /export function tenantSlug\(\)/.test(tstore));
check("…and the restaurant context IMPORTS it rather than re-deriving the slug",
  /from "\.\/tenantStorage"/.test(ctx) && /tenantSlug\(\)/.test(ctx));
check("the context no longer decides the tenant from the path alone",
  // A path match may still exist for the SSR-safe first render, but it must not be the thing the
  // resolve effect keys on: `tenantSlug()` has to appear before getRestaurantBySlug is called.
  ctx.indexOf("tenantSlug()") > -1 &&
  ctx.indexOf("tenantSlug()") < ctx.indexOf("getRestaurantBySlug("));
check("`/q/<code>` still pins the tab's tenant before hydration (the context reads that pin)",
  /lfh_tab_tenant/.test(qdoor) && /lfh_tab_tenant/.test(tstore));
check("bare /menu and /item are still restaurant #1's own URLs",
  /\/\^\\\/\(menu\|item\)\(\\\/\|\$\)\//.test(tstore.replace(/\s+/g, "")) || /\(menu\|item\)/.test(tstore));
check("only the routes that genuinely ARE restaurant #1 start out `ready`",
  /useState<boolean>\(\(\) => \/\^\\\/\(menu\|item\)/.test(ctx));
check("the pin is read inside an effect, never during render (there is no sessionStorage on the server)",
  !/const\s+\w+\s*=\s*useMemo\([^)]*tenantSlug\(\)/.test(ctx));

// ── AND A FAILED LOOKUP IS NOT ALLOWED TO ANSWER "RESTAURANT #1" EITHER (item 21, 2026-08-30) ──
//
// Section 1 above fixed the case where the context did not KNOW about the `/q/<code>` pin. This is
// the same fault by the other road: the pin is read correctly, the slug is right, and the RESOLVE
// fails. It used to end
//
//     .then((r) => { setId(r?.id || DEFAULT_RESTAURANT_ID); … setReady(true); })
//     .catch(() => { setReady(true); })                     // ← id left on #1, and declared ready
//
// so a refused read produced exactly the symptom in this file's own header. MEASURED on Aangan's
// real table-1 sticker (`/q/9AAG8YK8`) with only the client-side `lfh_guest_restaurant` call
// refused, tapping "+" on a dish:
//
//     lookup works ......................... basket = lfh_cart:aangan-garden-restaurant [Virgin Mojito]
//     lookup refused, OLD behaviour ........ basket = (none)          ← the tap did nothing
//     lookup refused, WITH the fix ......... basket = lfh_cart:aangan-garden-restaurant [Virgin Mojito]
//
// The empty id is not a hang: `/api/guest/place-order` and `/api/guest/call-waiter` already refuse
// a body with no restaurant (`unknown_restaurant`), and lib/guestOutbox.ts already words it for a
// diner. An unknown restaurant now takes the path that was built for it.
//
// lib/tenant.ts is what makes the catch reachable: since 2026-08-03 a failed READ throws instead of
// folding into `null`, so this is a cold process plus one refused read.
const resolveTail = ctx.slice(ctx.indexOf("getRestaurantBySlug("));

// ── AN UNKNOWN RESTAURANT IS REFUSED HERE, NOT BY THE DATABASE (owner, 2026-09-15) ──────────────
//
// `lib/restaurant-context.tsx` states the contract: a failed lookup leaves `id` as `""`, and
// "keys on the restaurant must treat '' the way the server already does: refuse, and say so."
// The server did refuse — with `invalid input syntax for type uuid: ""` — after a full round trip
// from a diner's phone. Measured on a production build during an ordinary menu open, and
// verify:guest was filing it as a request refused by a THIRD-PARTY service, because the host is not
// our origin. It is our own database.
//
// The trap underneath it: `restaurantId: string = DEFAULT_RESTAURANT_ID` fires for `undefined` and
// NEVER for `""`, so every read and write in lib/menu.ts was sending an empty uuid. And the default
// it would otherwise have applied is restaurant #1 — the one answer that must never be given when
// the restaurant is unknown, which is the rule the check below this one defends.
//
// DERIVED, NOT A HAND-TYPED LIST: a list is what lets the next function slip through. This finds
// every exported function in lib/menu.ts that takes a restaurant id, keeps the ones whose body
// actually reaches the database, and requires each to refuse an unknown one first.
{
  say("\n8b) An unknown restaurant is refused before the request, not by the database");
  const menuLib = codeOnly(read("lib/menu.ts"));
  const fns = [];
  const re = /export async function (\w+)\(/g;
  let m;
  while ((m = re.exec(menuLib))) {
    const name = m[1];
    const start = m.index;
    const next = menuLib.indexOf("\nexport ", start + 1);
    const body = menuLib.slice(start, next === -1 ? menuLib.length : next);
    if (!/restaurantId: string = DEFAULT_RESTAURANT_ID/.test(body)) continue;
    const touchesDb = /supabase|postGuestOrder|\.rpc\(/.test(body);
    if (!touchesDb) continue;
    fns.push({ name, guarded: /requireRestaurant\(restaurantId|knownRestaurant\(restaurantId\)/.test(body) });
  }
  const unguarded = fns.filter((f) => !f.guarded).map((f) => f.name);
  check(`every guest read and write that takes a restaurant id refuses an unknown one (${fns.length} found${unguarded.length ? ": " + unguarded.join(", ") + " do not" : ", all guarded"})`,
    fns.length >= 5 && unguarded.length === 0);
  check("…and the refusal is a real uuid test, not a truthiness check that '0' would pass",
    /const RESTAURANT_ID_RE = \/\^\[0-9a-f\]\{8\}-/.test(menuLib));
  check("…and it REFUSES rather than falling back to restaurant #1, which is the rule below",
    !/requireRestaurant[\s\S]{0,400}\|\| DEFAULT_RESTAURANT_ID/.test(menuLib)
    && /throw new Error\(`Can't \$\{what\}/.test(menuLib));
  check("…and the settings read refuses BEFORE its cache, so nothing is stored under an unknown key",
    menuLib.indexOf('requireRestaurant(restaurantId, "read this restaurant\'s settings")') < menuLib.indexOf("settingsCache.get(restaurantId)"));
  check("…and the read that answers with an empty list still answers with an empty list",
    /if \(!knownRestaurant\(restaurantId\)\) return \[\];/.test(menuLib));
}

check("a FAILED tenant resolve does not fall back to restaurant #1",
  !/\.catch\([^)]*\)\s*=>\s*\{[^}]*setReady\(true\)/.test(resolveTail) &&
  /\.catch\(/.test(resolveTail) && /setId\(""\)/.test(resolveTail));
check("…and it does not declare itself `ready` on the way past",
  /\.catch\(\(\) => \{[\s\S]{0,400}setReady\(false\)/.test(resolveTail));
check("…while a lookup that SUCCEEDS with no row still resolves to #1 (a slug nobody owns is a different answer)",
  /setId\(DEFAULT_RESTAURANT_ID\); setName\(null\); setReady\(true\)/.test(resolveTail));
check("the server half the empty id relies on is still there — a guest write with no restaurant is REFUSED",
  ["app/api/guest/place-order/route.ts", "app/api/guest/call-waiter/route.ts"].every((f) => {
    const s = read(f);
    return /isUuid\(b\.restaurantId\)/.test(s) && /unknown_restaurant/.test(s);
  }));
check("…and a diner is TOLD, in words, rather than watching a tap do nothing",
  /case "unknown_restaurant": return "We couldn't tell which restaurant/.test(read("lib/guestOutbox.ts")));

// ── THE TABLE NUMBER DOES NOT STAY IN THE ADDRESS BAR (owner, 2026-08-30) ──────────────────────
//
// His words: *"instead of numbers for table, do you use some kind of code right? Because people
// can't able to change the table number from top just by changing the URL."*
//
// The answer is the `/q/<code>` door (mig 210), and it is what every QR this app generates encodes —
// components/admin/RestaurantSettings.tsx builds `/q/<code>` and nothing builds `?table=N` any more.
// The two older doors are kept alive only so a sticker laminated before mig 210 keeps working, so
// they read the number ONCE and then wipe it out of the address: nothing left on screen to edit, and
// no `?table=` to share by accident.
//
// NOT a redirect to `/q/<code>`, which was the obvious idea and is strictly worse: the code is a
// PRIVATE random string (mig 210's own words), so a route that turned "table 7" into "table 7's
// code" would let anyone learn every table's code by walking 1…30.
//
// AND NOT A GATE. A diner can still name a table by typing it. What protects an OCCUPIED table is
// `lfh_join_session` making a second arrival a `guest` whose approval comes from
// `sessions.auto_approve` — DEFAULT FALSE since mig 018 — plus `lfh_geo_ok`. Those two are checked
// below so this section cannot quietly become the only thing standing there.
const menuView = read("components/MenuView.tsx");
check("the older doors WIPE ?table= / ?t= out of the address once it is read",
  /searchParams\.delete\("table"\)/.test(menuView) && /searchParams\.delete\("t"\)/.test(menuView));
check("…with replaceState, so the back button cannot put the number back",
  /history\.replaceState\(/.test(menuView) && !/history\.pushState\([^)]*table/.test(menuView));
check("…and the `/q/<code>` door is left alone (it never had a number to wipe)",
  /if \(!qrTable && window\.location\.search\)/.test(menuView));
check("…while the table itself still reaches the app",
  /setScannedTable\(digits\)/.test(menuView) && /lfh:table-scanned/.test(menuView));
check("every QR this app generates is the CODE door, not ?table=N",
  /\/q\/\$\{code\}/.test(read("components/admin/RestaurantSettings.tsx")));
// ── …AND NOTHING ANYWHERE ELSE HANDS A RESTAURANT A NUMBER-SHAPED TABLE LINK TO PRINT ─────────
//
// The check above asked ONE file whether it does the right thing, and never asked the rest of the
// product whether it does the wrong one. It passed for months while the manager/editor panel's
// "Guest QR links · one per table" card listed
//
//     …/r/<slug>/menu?table=1   …/r/<slug>/menu?table=2   …/r/<slug>/menu?table=3
//
// each with a Copy button and its own instruction to "paste it into any QR-code maker to print that
// table's code". Removed 2026-09-14 on the owner's word: *"if the table one, table two, table three,
// all the top link of the Chrome, there shouldn't be just a number difference. Otherwise, everyone
// will go in the top link and just change the number and go to another table."*
//
// DERIVED, NOT A HAND-TYPED LIST OF FILES — a list is what let one file sit outside the check. This
// walks every source file the product ships, strips its comments (LINE comments first: a `/*` inside
// a `//` line has hidden code from a stripper here before), and fails on any surviving construction
// of a guest MENU address carrying a table number. `/state?table=` and `/summary?table=` in the
// tablet panel are API calls, not a printed address, and do not match.
// `check(name, ok)` here takes a BOOLEAN, so the scan is done first and its count goes in the name —
// passing it a function would make the row pass whatever the answer was.
const numberedTableLinks = (() => {
  const roots = ["app", "components", "lib", "public/panels"];
  const skip = /node_modules|\/vendor\/|\.min\.|\.map$/;
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const rel = d + "/" + e.name;
      if (skip.test(rel)) continue;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) files.push(rel);
    }
  };
  roots.forEach(walk);
  const bad = [];
  for (const f of files) {
    const bare = read(f)
      .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1")   // line comments FIRST
      .replace(/\/\*[\s\S]*?\*\//g, "");           // then block comments
    if (/menu\?(table|t)=/.test(bare)) bad.push(f);
  }
  return { files: files.length, bad };
})();
check(`…and nothing anywhere else builds a per-table guest address out of the table NUMBER `
  + `(${numberedTableLinks.files} shipped source files scanned${numberedTableLinks.bad.length ? ": " + numberedTableLinks.bad.join(", ") : ", 0 build one"})`,
  numberedTableLinks.bad.length === 0);

check("an OCCUPIED table still needs the head to let a second party in (auto_approve DEFAULT false)",
  (() => {
    const migs = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /\.sql$/.test(f));
    const setsFalse = migs.some((f) => /auto_approve SET DEFAULT false/.test(read(`supabase/migrations/${f}`) || ""));
    const joinUsesIt = migs.some((f) => /v_approved := v_session\.auto_approve/.test(read(`supabase/migrations/${f}`) || ""));
    return setsFalse && joinUsesIt;
  })());
check("…and the basket refuses an unapproved member, so naming a table is not the same as joining it",
  /connected/.test(read("lib/tableConnection.ts")) && /gateAddToCart/.test(read("lib/tableConnection.ts")));

say("\n2) A request to staff is only reported as sent when it was");
check("the gate reads the answer instead of discarding it",
  /const r = await requestAccess\(/.test(gate));
check("…on BOTH request paths (the waiter call and the open-my-table one)",
  (gate.match(/requestLanded\(/g) || []).length >= 2);
check("it branches on the reason CODE, never on the server's prose",
  /r\.reason === "rate_limited"/.test(gate) && /isSessionTimeout\(r\)/.test(gate));
check("`already_sent` still counts as landed (staff have it; a second one helps nobody)",
  /already_sent/.test(gate));
check("a failure is TOASTED, so it is visible on the screens that do not render `note`",
  /const why = requestFailure\(r\);[\s\S]{0,200}toast\(why/.test(gate));
check("the reassurance screen is only reached after the request landed",
  /if \(!requestLanded\(r[^)]*\)\) return;[\s\S]{0,240}setStep\("request_sent"\)/.test(gate));

say("\n3) The order tracker cannot revert what happened while it was awaiting");
check("the poll remembers only what IT learned, keyed by order id",
  /const learned = new Map<string, \{ status: OrderStatus; finalizedAt\?: number \}>\(\)/.test(tracker));
check("…and applies it to a FRESH read of the list, not the copy it started with",
  /const fresh = read\(\)\.map\(\(o\) => \{[\s\S]{0,260}learned\.get\(o\.id\)/.test(tracker));
check("it never writes back the stale array it read before the network calls",
  !/\n\s*write\(list\);\s*\n\s*refresh\(\);\s*\n\s*broadcast\(\);/.test(tracker));
check("an order that has since left the list is not resurrected (we only map what is there now)",
  /read\(\)\.map\(/.test(tracker) && !/fresh\.push\(/.test(tracker));

say("\n4) A restaurant-keyed question waits for the restaurant to be known");
check("the returning-guest greeting waits for `ready`",
  /useRestaurantMeta\(\)/.test(greeter) && /!ready\) return/.test(greeter));
check("…and re-asks when it becomes ready",
  /\}, \[restaurantId, ready\]\)/.test(greeter));
// EXPECTATION MOVED, RULE UNCHANGED (sweep 7 T3). This asserted the literal
// `settingsByRid.current.get(rid)` — the sweep-6 shape, where the map was READ in preference to
// asking. Sweep 7 item 3 made the map a fallback instead (it froze a restaurant's table range and
// geofence for the life of the page), so that exact string is gone while the rule this row exists
// for — the gate can never answer with another restaurant's settings — is now stronger. Assert the
// RULE: every touch of the map is keyed by a restaurant id, and nothing fills a single un-keyed ref.
// THE KEY, NOT THE NAME OF THE VARIABLE HOLDING IT (T1, 2026-09-15). This named `ridRef.current`
// as the thing the map is read by. PR #1356 refactored the gate to settle the id once into
// `settledRid` and read with that — same rule, better code — and this row went red on clean main,
// where it is the fourth spelling-pinned row in this one file. A red verify:* refuses Write and
// Edit for every session in this folder through the PostToolUse hook, so it is not a small thing.
//
// What must hold: every touch of the map carries a key, and nothing fills a single un-keyed ref.
// Asked of the CODE, so a commented-out line cannot satisfy it.
{
  const code = codeOnly(gate);
  const sets = code.match(/settingsByRid\.current\.set\(([^,)]*)/g) || [];
  const gets = code.match(/settingsByRid\.current\.get\(([^)]*)\)/g) || [];
  const keyed = (calls) => calls.length > 0 && calls.every((c) => {
    const arg = c.slice(c.indexOf("(") + 1).trim();
    return arg.length > 0 && /rid|restaurant/i.test(arg);
  });
  check("the table-session gate keeps settings PER RESTAURANT, never one set for the whole page",
    /settingsByRid/.test(code) && keyed(sets) && keyed(gets)
    && !/settingsByRid\.current\.(get|set)\(\)/.test(code));
}
check("…and there is no un-keyed `settingsRef.current || await getSettings` left",
  !/settingsRef\.current \|\| \(await getSettings/.test(gate));

say("\n5) Clearing the remembered table really clears it, everywhere");
check("the ✕ in the waiter popup announces the wipe",
  /setScannedTable\(""\);\s*\n\s*window\.dispatchEvent\(new Event\("lfh:table-scanned"\)\)/.test(chef));
check("the bill lets go of a number that was only ever a prefill",
  /if \(previous\) setTableNumber\(\(cur\) => \(cur === previous \? "" : cur\)\)/.test(cart));
check("…but never touches a number the guest typed into the bill itself",
  /cur === previous/.test(cart));

say("\n6) No tap in the saved-orders list can do nothing");
check("`Order the rest` reads the result of the attempt",
  /const r = await orderRestWithout\(id\)/.test(chip));
check("…and says so when it could not work out what to leave out",
  /if \(r\.ok\) return;[\s\S]{0,320}lfh:toast/.test(chip));
check("the queue still refuses to re-send an unchanged basket",
  /keptLines\.length === allLines\.length/.test(read("lib/guestOutbox.ts")));

// ── 7 · AN OLD PRINTED QR CODE STILL FINDS THE RESTAURANT (mig 350) ────────────────────────────
// A QR code encodes the ADDRESS, not the restaurant. When a restaurant's address changes — which
// happens on exactly one path, restoring a binned one whose address was taken — every laminated
// table card it printed points at nothing. These checks hold the two halves that make an old code
// still work, and the ONE property that keeps it safe.
say("\n7) An old printed address still finds the restaurant");
const tenantLib = read("lib/tenant.ts");
check("lib/tenant exports the retired-address lookup",
  /export async function slugMovedTo\(/.test(tenantLib));
// THE SAFETY PROPERTY, and the only one worth failing a build over: the lookup must never answer
// for an address a LIVE restaurant is using. That restaurant's own guests scan it, so redirecting
// would take a diner away from the menu they meant to open. The refusal lives in the SQL.
const mig350 = read("supabase/migrations/350_an_old_web_address_still_finds_the_restaurant.sql");
check("…and the SQL refuses whenever a LIVE restaurant holds that address",
  /NOT EXISTS \([\s\S]{0,220}FROM restaurants live[\s\S]{0,120}deleted_at IS NULL/.test(mig350));
check("…and refuses for a restaurant that is itself in the recycle bin",
  /r\.deleted_at IS NULL/.test(mig350));
// The rename is the only moment the old address can be recorded, so if this write goes the feature
// silently stops working for every future rename while still looking present.
// Asserted as two separate facts rather than one window-limited match: a comment growing between
// them is not a regression, and a check that breaks on prose gets loosened until it means nothing.
const restRoute = read("app/api/admin/restaurants/route.ts");
check("a rename records the address it left behind",
  /from\("restaurant_slug_history"\)/.test(restRoute) && /replaced_by: slug/.test(restRoute));
check("…keyed on the address, so a second rename updates rather than duplicates",
  /onConflict: "slug"/.test(restRoute));
// The door a QR code actually opens, and the thing on it that costs a diner something.
const menuDoor = read("app/r/[restaurant]/menu/page.tsx");
check("the menu door redirects a retired address instead of 404ing",
  /if \(!r\) \{[\s\S]{0,400}slugMovedTo\(restaurant\)[\s\S]{0,200}redirect\(`\/r\/\$\{moved\}\/menu/.test(menuDoor));
check("…and carries the query, so ?table=N survives the hop",
  /redirect\(`\/r\/\$\{moved\}\/menu\$\{queryStringOf\(await searchParams\)\}`\)/.test(menuDoor));
check("…and a restaurant that exists but is switched off still 404s (it is closed, not moved)",
  /if \(!r \|\| !r\.active\) notFound\(\);/.test(menuDoor));
check("the three scoped panels get it from one place (lib/panelGate)",
  /slugMovedTo\(slug\)[\s\S]{0,160}redirect\(`\/r\/\$\{moved\}\$\{ROLE_HOME\[role\]\}`\)/.test(read("lib/panelGate.ts")));
// A PERMANENT redirect would be the wrong answer here and is hard to undo in a browser cache: an
// address on this platform can be re-taken by a different restaurant later (mig 319 frees it).
check("no door answers a moved address with a PERMANENT redirect",
  !/permanentRedirect\(/.test(menuDoor + read("app/r/[restaurant]/item/[slug]/page.tsx") + read("app/r/[restaurant]/login/page.tsx"))
  && !/\b308\b/.test(read("app/r/[restaurant]/owner/route.ts").replace(/\/\/[^\n]*/g, "")));


// ───────────────────────────────────────────────────────────────────────────────────────────────
// SWEEP 7 (T3) — SIX MORE PLACES A GUEST'S SCREEN COULD SAY SOMETHING THAT WASN'T TRUE.
//
// Same subject as everything above: a promise a diner (or a table's head) is given, which the code
// had no evidence for. Each block names the item number from the sweep-7 PR so a red line here
// points straight at the reasoning.
// ───────────────────────────────────────────────────────────────────────────────────────────────
const owner = read("components/SessionOwner.tsx");
const widget = read("components/SessionStatusWidget.tsx");
const tbill = read("components/SessionTableBill.tsx");

say("\n8) The queue holds TWO kinds of thing, and the list must name the right one (item 2)");
// A saved waiter call carries no items and no track summary, so anything that falls through to the
// item count renders the literal words "0 items" for a request for water.
check("the saved-work list knows a waiter call from an order",
  /const isCall = \(o: GuestOrder\)/.test(chip) && /o\.kind === "call"/.test(chip));
check("…and names what was asked for instead of counting an empty basket",
  /if \(isCall\(o\)\) return callText\(o\);/.test(chip) && /String\(o\.reason \|\| ""\)/.test(chip));
check("…and the chip does not call a request for water an 'order'",
  /list\.every\(isCall\)/.test(chip) && /request for staff/.test(chip));
// A MIXED queue drops the noun rather than picking one that is untrue about half of it, matching
// the connection badge's own voice at the top of the same screen ("Offline · 2 waiting").
// EXPECTATION MOVED (item 14, 2026-08-30): the queue gained a THIRD kind, "I've left this table",
// so the mixed test now covers calls OR leaves. The rule — never a noun that is untrue about part
// of what it is counting — is unchanged.
check("…and says nothing about 'orders' when the queue holds more than one kind",
  /if \(list\.some\(isCall\) \|\| list\.some\(isLeave\)\) return `\$\{n\}`;/.test(chip));
// The guard that keeps the ORIGINAL behaviour: an order still reads as its dishes.
check("an ORDER still names its dishes, unchanged",
  /list\.map\(\(i\) => `\$\{i\.qty\} × \$\{i\.title\}`\)\.join\(", "\)/.test(chip));

say("\n9) A restaurant can change its own rules under a guest who already has the page open (item 3)");
// The gate decides the geofence, whether a location check is needed and the table-number range.
// A private map read in preference to asking froze all three for the life of the page.
// THE RULE, NOT THE TWO LINES IT WAS ONCE WRITTEN ON (sweep #9 T3 round 2). This matched
// `const s = await getSettings(rid);` immediately followed by the map write — and the read has
// since been wrapped in a Promise.race with a deadline, which is strictly BETTER and broke the
// adjacency. The product was right and the guard went red: the same count/spelling trap this file's
// sibling (verify-guest-recovery) already carries a note about. What must hold is that the gate
// ASKS, and that what it learns is put in the map; neither has to be one statement.
// …AND ASKED OF THE CODE, NOT OF THE FILE (T1, 2026-09-15) — see codeOnly() at the top.
const gateCode = codeOnly(gate);
check("the table gate ASKS for settings rather than serving its own map",
  /await getSettings\(rid\)/.test(gateCode) && /settingsByRid\.current\.set\(rid,/.test(gateCode));
check("…so there is no 'if (cached) use it' short-circuit left",
  !/const cached = settingsByRid\.current\.get\(rid\);/.test(gate));
check("…and the map is still there as a FALLBACK, so a blip does not dead-end a diner",
  /const known = settingsByRid\.current\.get\(/.test(gate) && /if \(known\) settingsRef\.current = known;/.test(gate));
check("…and the reason is written down where the next reader will see it",
  /A FALLBACK, NOT A CACHE/.test(gate));

say("\n10) Leaving a table only CLAIMS to have been heard when it was (item 4)");
check("the leave handlers read the server's answer",
  /const leftForReal = async \(token: string\): Promise<boolean> => \{[\s\S]{0,200}return r\?\.ok === true;/.test(widget));
check("…neither one throws the answer away any more",
  !/^\s*await leaveSession\(token\);\s*$/m.test(widget));
check("'You left the table' is only said when the restaurant heard it",
  /if \(told\) \{ toast\("You left the table", "table"\); return; \}/.test(widget));
// EXPECTATION SUPERSEDED, AND BY A BETTER ANSWER (item 14, 2026-08-30). This asserted that a diner
// whose leave did not land is TOLD to go and mention it to staff. That sentence is gone because the
// job is gone: the phone now saves the leave and sends it itself. Asserting the old wording would be
// asserting a worse product. The rule this row exists for — the diner is never left with a lie and
// never left holding a job the app can do — is now met by the queue, so that is what it checks.
check("…and when it did NOT land, the phone takes the job rather than handing it to the diner",
  /const q = await enqueueGuestLeave\(\{ token, restaurantId, restaurantSlug \}\);/.test(widget)
  && /we'll tell the restaurant as soon as there's signal/.test(widget));
// EXPECTATION SUPERSEDED (item 14, 2026-08-30). "Change table" used to have to STOP when the leave
// had not landed, because the only thing left was to tell the diner — and a page load would wipe
// that sentence. Now the leave is saved and sends itself, so there is nothing to tell them and no
// reason to block the thing they asked for. What must still hold is that the leave is not simply
// dropped on the floor when they move.
check("'Change table' saves the leave when it did not land, then lets them move on",
  /if \(!told\) await enqueueGuestLeave\(\{ token, restaurantId, restaurantSlug \}\);/.test(widget));
check("…and the phone still lets go either way, so nobody is TRAPPED by a dead connection",
  /clearLocal\(\); \/\/ also drops lfh_active_orders \+ nudges the tracker to hide/.test(widget)
  && /const told = await leftForReal\(token\);\n\s*clearLocal\(\)/.test(widget));

say("\n11) The host's answer to 'someone wants to join' cannot vanish in silence (item 5)");
check("'Let them in' reads the result",
  /const r = await approveMember\(token, head\.id, head\.name\);/.test(owner));
check("…and says so when it did not work",
  /if \(r\?\.ok !== true\) say\(whyFailed\(r, "We couldn't let them in/.test(owner));
check("'Not them' reads the result too",
  /const r = await removeMember\(token, head\.id\);/.test(owner)
  && /if \(r\?\.ok !== true\) say\(whyFailed\(r, "We couldn't turn that request down/.test(owner));
check("'Let anyone join automatically' reports a PARTIAL result honestly",
  /let allIn = true;/.test(owner) && /if \(a\?\.ok !== true\) allIn = false;/.test(owner)
  && /but we couldn't let everyone already waiting in/.test(owner));
check("…and 'you are not the host any more' is not worded as 'try again in a moment'",
  /r\?\.reason === "not_owner" \? "You're not the host of this table any more\."/.test(owner));
check("no handler in that popup awaits one of the three and drops the answer",
  !/^\s*await (approveMember|removeMember|setAutoApprove)\(/m.test(owner));

say("\n12) A skeleton that never resolves is a blank screen with no honest message (item 6)");
check("the live table bill can tell 'still loading' from 'cannot be loaded'",
  /const \[stalled, setStalled\] = useState\(false\);/.test(tbill));
check("…it is only raised when NOTHING has ever loaded (a blip must not blank a live bill)",
  /else setStalled\(true\);/.test(tbill) && /setStalled\(false\);/.test(tbill));
check("…and the diner gets a sentence, not three pulsing bars",
  /\{!loaded && stalled \? \(/.test(tbill) && /can&apos;t reach the restaurant&apos;s system right now/.test(tbill));
check("…which says nothing is lost, and offers a way to ask again",
  /Nothing is lost/.test(tbill) && /pollRef\.current\?\.\(\)/.test(tbill));
check("…and the green 'live' dot stops claiming a live connection while it is up",
  /!loaded && stalled \? \{ background: "var\(--muted\)"/.test(tbill));
// The skeleton itself must survive: it is what stops the "no dishes yet" message flashing.
check("the loading skeleton is still there for the normal first load",
  /className="stb-loading"/.test(tbill) && /className="stb-skel"/.test(tbill));


// ───────────────────────────────────────────────────────────────────────────────────────────────
// THE FOUR IMPROVEMENTS THE OWNER PICKED ON 2026-08-30 (items 10, 12, 13, 14 of T3's list).
// Same subject as the rest of this guard: what a diner is told, and whether it is true.
// ───────────────────────────────────────────────────────────────────────────────────────────────
const sync = read("components/SessionCartSync.tsx");
const leaveRoute = read("app/api/guest/leave/route.ts");
const outbox = read("lib/guestOutbox.ts");

say("\n13) A dish that fails to reach the shared basket heals itself (item 10)");
check("a failed push no longer just waits for the diner's next edit",
  /reconciledToken\.current = null;/.test(sync) && /A FAILED PUSH NOW HEALS ITSELF/.test(sync));
check("…it re-runs the FIRST-JOIN reconcile, which SETS the whole array",
  /setSessionCart\(s\.token, merged,/.test(sync));
check("…carrying the timestamp it read, so a co-diner's add is refused not overwritten",
  /cart_updated_at \?\? null/.test(sync));
check("…and a refusal re-merges rather than forcing through",
  /reconciledToken\.current = null; \/\/ someone else got there first/.test(sync));
check("…and it is NOT a blind retry of the delta, which would double the food",
  !/mergeSessionCart\(token, added, removed, qty\);[\s\S]{0,400}mergeSessionCart\(token, added, removed, qty\)/.test(sync));

say("\n14) A request for staff can be taken back; an order still cannot (item 12)");
check("the queue can cancel a call that has not gone yet",
  /export async function cancelQueuedCall/.test(outbox));
check("…and refuses anything that is not a call, by KIND, not by trusting the screen",
  /if \(!isCall\(it\)\) return \{ ok: false, reason: "not_a_call" \};/.test(outbox));
check("…and refuses one that is no longer queued, with a reason rather than a bare false",
  /if \(!it\) return \{ ok: false, reason: "not_found" \};/.test(outbox));
check("the button is offered on a call and never on an order",
  /\{isCall\(o\) && !isLeave\(o\) \? \(/.test(chip));
check("…and a refusal is SAID, not swallowed",
  /That's already gone to the staff/.test(chip));
check("an order still shows a spinner and no buttons",
  /<span className="gob-spin"/.test(chip));

say("\n15) The diner is told how long staff have been asked (item 13)");
check("the moment the request LANDED is remembered",
  /const \[reqAt, setReqAt\] = useState\(0\);/.test(gate));
check("…stamped on both request paths, only after it landed",
  (gate.match(/setReqAt\(Date\.now\(\)\)/g) || []).length === 2);
check("…and the clock ticks only while that screen is up",
  /if \(!open \|\| step !== "request_sent" \|\| !reqAt\) return;/.test(gate));
check("…saying nothing at all in the first minute",
  /if \(mins < 1\) return null;/.test(gate));
check("…and it is elapsed time, never a countdown or a warning",
  /Asked \{mins === 1 \? "a minute" : `\$\{mins\} minutes`\} ago\./.test(gate));

say("\n16) The phone carries 'I've left this table' when the signal is gone (item 14)");
check("the queue has a third kind",
  /kind\?: "order" \| "call" \| "leave";/.test(outbox));
check("…with its own endpoint, so the queue's rules apply to it unchanged",
  /fetch\("\/api\/guest\/leave"/.test(outbox) && /export const POST = withIdempotency\(postImpl, "guest"\);/.test(leaveRoute));
check("…which treats a database that will not answer as BUSY, never as a refusal",
  /reason: "server_busy", retryAfter/.test(leaveRoute));
check("…and drops the floor snapshot, because a seat freed",
  /invalidateFloor\(rid\)/.test(leaveRoute));
check("only ONE leave per token can be waiting",
  /queued\.find\(\(x\) => isLeave\(x\) && String\(x\.token \|\| ""\) === String\(p\.token \|\| ""\)\)/.test(outbox));
check("A SAVED LEAVE IS DROPPED IF THEY RE-JOIN THAT VERY TABLE",
  /function leaveIsStale/.test(outbox) && /s\.token === it\.token/.test(outbox));
check("…checked at SEND time, because the rejoin can happen while the tab is shut",
  /if \(leaveIsStale\(item\)\) \{ await removeItem\(item\.id\); notify\(\); continue; \}/.test(outbox));
check("the table card saves the leave rather than handing the diner the job",
  /enqueueGuestLeave\(\{ token, restaurantId, restaurantSlug \}\)/.test(widget));
check("…on both Leave and Change table",
  (widget.match(/enqueueGuestLeave\(/g) || []).length === 2);
check("…and the phone still lets go either way, so nobody is trapped",
  /const told = await leftForReal\(token\);\n\s*clearLocal\(\)/.test(widget));
check("the saved-work list names a leave instead of counting an empty basket",
  /if \(isLeave\(o\)\) return "Leaving your table";/.test(chip));
check("…says what will happen to it",
  /The restaurant will be told/.test(chip));
check("…and the chip counts it as a MESSAGE, not an order",
  /message to the restaurant/.test(chip));

// Everything above prints here; everything BELOW this line is printed by the flush at the end.
// (Sections were appended after this call over several sweeps and pushed into `out` with
// nothing printing them again, so a failure down there exited 1 saying only "1 check failed"
// and never named it. Found sweep 8 T5, 2026-09-02.)
let printed = 0;
const flush = () => { console.log(out.slice(printed).join("\n")); printed = out.length; };
flush();

// ── THE TABLE NUMBER LEAVES THE ADDRESS BAR (T25 round 2, 2026-08-31) ─────────────────────────────
// Round 1's item 21b strips `?table=` / `?t=` from the two older doors after the page has read them,
// so the number a diner could edit is not sitting in the address. This guard covered every other
// promise made to a diner and not that one — found by SABOTAGE: commenting the strip out left
// verify:guest-doors green.
{
  // COMMENTS OUT. Sabotage caught this instantly: `// url.searchParams.delete("table");` still
  // matched a raw-text test, so the guard passed against a commented-out fix. Third recording of that
  // shape in this repo — a guard can pass against its own comment.
  const menuView = read("components/MenuView.tsx").split("\n")
    .filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*)/.test(l)).join("\n");
  check("the table number is stripped from the address after the page has read it",
    /searchParams\.delete\("table"\)/.test(menuView) && /searchParams\.delete\("t"\)/.test(menuView));
  check("…with replaceState, not a redirect (a redirect to /q/<code> would expose every table's code)",
    /history\.replaceState/.test(menuView) && !/router\.replace\(`\/q\//.test(menuView));
  check("…and only when the page did NOT come in through the private-code door",
    /!qrTable/.test(menuView));
  check("…while any other query the address carries is left alone",
    /url\.pathname \+ \(url\.searchParams\.toString\(\)/.test(menuView));
}


// ── A PARSED SESSION IS NOT A VALID ONE (T25 round 3, item 35, 2026-08-31) ─────────────────────────
// lib/session.ts's getStoredSession() wrapped JSON.parse in a try/catch, which catches a THROW and
// nothing else — and JSON.parse is happy to return a number, a string, null or an array. MEASURED with
// `42` in the slot: it handed back the number 42, so a caller read `.token` as undefined and an RPC
// went out with `p_token: undefined`. A guest sees that as a broken table, not as "join again".
{
  const sess = read("lib/session.ts").split("\n")
    .filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*)/.test(l)).join("\n");
  check("a stored session must be an OBJECT before it is trusted",
    /if \(!s \|\| typeof s !== "object" \|\| Array\.isArray\(s\)\) return null;/.test(sess));
  check("…and must actually carry a token, or it is not a session",
    /if \(typeof s\.token !== "string" \|\| !s\.token\) return null;/.test(sess));
  check("…and the table check still comes after both, so a token from table 7 is never used at table 8",
    sess.indexOf('typeof s.token !== "string"') < sess.indexOf("table && s.table !== table"));
}


// ── A VALUE THAT IS NOT A COLOUR NEVER REACHES A STYLESHEET (T25 round 3, item 36, 2026-08-31) ─────
// lib/accent.ts builds CSS custom properties from the restaurant's accent, which arrives from an admin
// field. Measured before the fix: `accentPaletteCss('#fff;} body{display:none;')` produced
// `--accent:#fff;} body{display:none;;--gold:…` — a rule of its own inside the stylesheet. The canvas
// half already refused an unparseable colour; the palette half did not.
{
  const accent = read("lib/accent.ts").split("\n")
    .filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*)/.test(l)).join("\n");
  check("the accent palette refuses a value that is not a hex colour",
    /if \(!isHexColor\(accentColor\)\) return "";/.test(accent));
  check("…and the canvas half still refuses one too",
    /if \(!hexToRgbTriplet\(accentColor\)\) return "";/.test(accent));
  check("…and the colour test comes from the ONE branding helper, not a second copy",
    /import \{ hexToRgbTriplet, isHexColor \} from ".\/brandTheme";/.test(accent));
}

// ── A RESTAURANT'S OWN LIST, NEVER RESTAURANT #1's (sweep 8 T5 round 2, 2026-09-02) ───────────
// This guard's whole reason for existing is fault #1 at the top of this file: the global widgets
// answered "restaurant #1" because the id resolves ASYNCHRONOUSLY. components/Header.tsx had the
// same shape and it destroyed a guest's own choice.
//
// MEASURED on a production build, /r/spice-route/menu — a restaurant that sells in all six
// languages. A diner reading in German, Arabic or Korean had their saved language silently
// rewritten to English on page load, at random. Traced by watching localStorage: one write of
// "en", from the effect that moves a guest off a language "this restaurant doesn't offer" — asked
// of restaurant #1's list, ["en","fr","hi"], because that is what had resolved. Whether it hit
// depended on which landed first, which is why it looked flaky: one run wiped de and ar, the next
// wiped ko.
//
// The rule those effects exist for is right and stays. They just have to wait for `ready`.
{
  const hdr = read("components/Header.tsx");
  const bare = hdr.split("\n").filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*)/.test(l)).join("\n");
  check("the guest header waits for the REAL restaurant before it reads any list",
    /const \{ id: restaurantId, ready \} = useRestaurantMeta\(\);/.test(bare));
  check("…so the settings read never fetches restaurant #1's lists on another restaurant's page",
    /if \(!ready\) return;[\s\S]{0,200}getSettings\(restaurantId\)/.test(bare));
  check("…the language/currency correction waits for it too (this is the one that wiped a choice)",
    /if \(!ready\) return;\s*\n\s*if \(menuLangs && menuLangs\.length/.test(bare));
  check("…and so does the feature-switch correction",
    /if \(!ready\) return;[^\n]*\n\s*if \(features\.currency === false/.test(bare));
  check("…and every one of those effects re-runs when it finally resolves",
    (bare.match(/\}, \[[^\]]*\bready\b[^\]]*\]\);/g) || []).length >= 3);
  // The rule itself must not be quietly deleted instead of gated — that would "fix" the wipe by
  // letting a guest keep a language the restaurant switched off.
  check("…and the rule they exist for is still there: a guest is moved off a language this restaurant does not offer",
    /!menuLangs\.includes\(getLanguage\(\)\.code\)\) setLanguage\(menuLangs\[0\]/.test(bare));
  check("…and off a currency it does not offer",
    /!menuCurrs\.includes\(getCurrency\(\)\.code\)\) setCurrency\(menuCurrs\[0\]/.test(bare));
}

// ── GUEST CHROME MOUNTS ON GUEST DOORS ONLY ───────────────────────────────────────────────────
// components/GuestChrome.tsx renders sixteen always-on guest widgets, and its whole reason for
// existing is that they must NOT run on a staff screen: the table-session machinery auto-opened
// tables over the admin floor, and the ban check plus the returning-guest greeting are a database
// round trip each, against restaurant #1, on a page that has no diner on it.
//
// The list has now been short THREE times — the flat routes, then the /r/<slug>/ shapes, then
// /pair (sweep 8 T5, 2026-09-02). A hand-maintained list of "everything that is not a guest door"
// silently rots every time a route is added, so this checks it against the routes on disk.
{
  const gc = read("components/GuestChrome.tsx");
  const m = gc.match(/const STAFF_SEGMENTS = (\[[^\]]+\])/);
  check("GuestChrome still declares a staff-segment list", !!m);
  if (m) {
    const segs = JSON.parse(m[1].replace(/'/g, '"'));
    // The diner's own doors, and only these: /menu, /item, /view, /q/<code>, /r/<slug>/…
    const GUEST_DOORS = new Set(["menu", "item", "view", "q", "r"]);
    const routes = readdirSync(join(ROOT, "app"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "api" && !e.name.startsWith("_") && !e.name.startsWith("("))
      .map((e) => e.name);
    const uncovered = routes.filter((r) => !GUEST_DOORS.has(r) && !segs.includes(r));
    check(`every non-guest top-level route is in GuestChrome's staff list${uncovered.length ? " — missing: " + uncovered.join(", ") : ""}`,
      uncovered.length === 0);
    // …and the regex really matches both shapes, not just the flat one.
    const re = new RegExp(`^(?:/r/[^/]+)?/(?:${segs.join("|")})(?:/|$)`);
    check("…and the staff test still matches /r/<slug>/<segment> as well as /<segment>",
      re.test("/manager") && re.test("/r/aangan/kitchen") && re.test("/pair"));
    check("…and it still lets every guest door through",
      !re.test("/menu") && !re.test("/q/ABC123") && !re.test("/r/aangan/menu") && !re.test("/view/soup"));
  }
}

// ── THE GATE'S OWN QR READER MUST UNDERSTAND THE STICKER THIS PRODUCT PRINTS (T4 s8, item 1) ──────
// Measured before the fix, running the reader's own two lines in the browser against each sticker
// shape: `?table=12` → "12" ✓ · a bare "14" → "14" ✓ · `/q/K7M2P9` → "" ✗. Every QR this app
// generates has been `/q/<code>` since mig 210 (components/admin/RestaurantSettings.tsx builds
// `${origin}/q/${code}`, and components/MenuView.tsx's own comment says nothing builds `?table=N`
// any more) — so "Scan QR" could not read one single sticker in the building, and said nothing while
// failing. These four checks are the ones that go red if any of that is undone.
{
  say("\n7) The gate's QR reader understands the sticker this product actually prints");
  check("the reader knows today's `/q/<code>` sticker",
    /\/\^\\\/q\\\/\(\[A-Za-z0-9\]\{6,16\}\)\\\/\?\$\//.test(gate));
  check("…and walks through that door rather than inventing a table number",
    /window\.location\.href = `\/q\/\$\{ourCode\}`/.test(gate));
  check("…and still reads the older `?table=` sticker and a bare-number QR",
    /searchParams\.get\("table"\) \|\| u\.searchParams\.get\("t"\)/.test(gate) && /catch \{ t = raw; \}/.test(gate));
  check("a scanned link is never followed off this site",
    /u\.origin === window\.location\.origin/.test(gate));
  check("a QR that is not a table sticker SAYS so instead of leaving the camera running",
    /That QR belongs to another site/.test(gate) && /That QR doesn’t say which table it is/.test(gate));
  check("…and the admin's QR builder still makes the shape the reader was taught",
    /\$\{window\.location\.origin\}\/q\/\$\{code\}/.test(read("components/admin/RestaurantSettings.tsx")));
}

flush();

// ── AN ORDER ALREADY SENT IS NOT A CANCELLED ORDER (T4 s8, item 2) ────────────────────────────────
// The ✕, the dim background and the phone's back button all call the gate's close(), which reported
// { ok:false, reason:"cancelled" }. fireDone is once-only and components/CartPanel.tsx deregisters
// its listener on the first result carrying action:"order" — so an order that then landed in the
// kitchen could never say so. The basket kept every dish and the diner placed it again.
{
  say("\n8) An order already on its way is not reported as cancelled");
  check("the gate knows when one of its two irreversible sends is outstanding",
    /const inFlight = useRef\(0\);/.test(gate) && /inFlight\.current\+\+;/.test(gate) && /inFlight\.current--;/.test(gate));
  check("…and close() stays quiet while one is",
    /if \(inFlight\.current === 0\) fireDone\(\{ ok: false, reason: "cancelled"/.test(gate));
  check("placing the order runs through that guard",
    /guarded\(\(\) => placeSessionOrderSafe\(/.test(gate));
  check("…and so does saving it to the phone, which is just as final",
    /guarded\(\(\) => enqueueGuestOrder\(/.test(gate));
  check("…and calling a waiter, both live and saved",
    /guarded\(\(\) => callWaiterSession\(/.test(gate) && /guarded\(\(\) => enqueueGuestCall\(/.test(gate));
  check("a refusal the diner must read re-opens the sheet, which may have been dismissed mid-send",
    (gate.match(/setOpen\(true\); setStep\("blocked"\)/g) || []).length === 2);
  check("the basket still deregisters on the first ORDER result, which is why the gate must not spend it",
    /if \(d\?\.action !== "order"\) return;/.test(cart) && /removeEventListener\("lfh:session-done", onDone\)/.test(cart));
}

// ── THE TABLE CARD'S OWN WORDS (T4 s8, items 5 and 6) ─────────────────────────────────────────────
// 5 · `calls` from lfh_session_state is every OPEN request at the table, from any member (mig 318
//     builds it from waiter_calls by session_id) — the card labelled it "You called for".
// 6 · every message from this card went out with no variant, so ToastHost fell back to a green tick
//     and to its shortest life. MEASURED on the rendered page: 1,283 ms for a twelve-word sentence,
//     and the same tick and length for "You've been removed from this table". After: 3,800 ms, •.
{
  say("\n9) The table card's own words say the right thing, for long enough to read");
  check("the shared list of requests is named as the TABLE's, not this diner's",
    /This table asked for/.test(widget) && !/You called for/.test(widget));
  check("the card can ask for a mark and a length, instead of always taking the flash default",
    /const toast = \(message: string, kicker = "table", variant = "success", duration\?: number\)/.test(widget));
  check("…and all four of the sentences that matter use it",
    (widget.match(/"table", (?:"error"|"info"|q\.persisted \? "info" : "error"), NEWS_MS\)/g) || []).length === 4);
  // Owner, 2026-09-02: "you can keep msg but you can show it like bad news". The three endings and
  // the not-yet-delivered leave wear the refusal mark; the leave this phone CAN keep does not.
  check("…and the three endings are shown as bad news, with the refusal mark",
    (widget.match(/"table", "error", NEWS_MS\)/g) || []).length === 3);
  check("…and a leave the phone really saved is not dressed up as a failure",
    /q\.persisted \? "info" : "error", NEWS_MS\)/.test(widget));
  check("…and the refusal mark is what withholds the thank-you sign-off, which is why it reads right",
    /t\.variant !== "error"/.test(read("components/ToastHost.tsx")));
  check("…and NEWS_MS is longer than ToastHost's own default for a refusal",
    /const NEWS_MS = 3400;/.test(widget) && /variant === "error" \? 2200 : 1100/.test(read("components/ToastHost.tsx")));
  check("the flash default is still what ToastHost gives an unmarked message, which is why this matters",
    /variant === "error" \? 2200 : 1100/.test(read("components/ToastHost.tsx")));
  check("…and `duration` is still a thing ToastHost honours",
    /typeof d\.duration === "number" && d\.duration > 0/.test(read("components/ToastHost.tsx")));
  // 12 · a comment that lies about a poll is how a fast poll gets "restored".
  check("the card's comments no longer claim a 3-second poll it has not done for a long time",
    !/every 3s/.test(widget) && /RT_BACKUP_MS \(60s\) as the backstop/.test(widget));
}

// ── EVERY NAME BOX IN THE GATE BEHAVES THE SAME (T4 s8, item 8) ───────────────────────────────────
// Four screens ask for a name. Three capped it at 40 and submitted on Enter; `guest_name` — the one
// a diner reaches when somebody else already holds the table — did neither, so the phone keyboard's
// blue Go key did nothing there and a pasted paragraph reached the head's approve list.
{
  say("\n10) Every name box in the gate behaves the same");
  const boxes = gate.match(/<input className="sg-input"[\s\S]*?\/>/g) || [];
  const named = boxes.filter((b) => /value=\{name\}/.test(b));
  // EVERY name box, not "exactly four" (sweep #9 T3 round 2). A FIFTH one was added and it follows
  // the rule perfectly — so the app became MORE compliant and this went red, which is the third
  // time this project has recorded a check pinned to a COUNT failing on code that was right. The
  // rule is "every name box in the gate behaves the same"; the number of them is not the rule.
  // A floor is kept, so DELETING them all still fails — which is the part that matters.
  check(`every name box in the gate was found (${named.length}, and there must be at least 4)`, named.length >= 4);
  check("…every one of them caps the name at 40",
    named.length >= 4 && named.every((b) => /maxLength=\{40\}/.test(b)));
  check("…and every one of them submits on Enter, so the phone's Go key is never dead",
    named.length >= 4 && named.every((b) => /e\.key === "Enter"/.test(b)));
}

// ── A REQUEST TO STAFF CARRIES THE NAME WE ALREADY HAVE (T4 s8, item 7) ───────────────────────────
// NAME-FIRST (owner, 2026-06-17) exists so the pending-requests view names who is asking. The
// escape-hatch path passed only what was typed, which is empty on the two screens a returning diner
// reaches with a session already on their phone.
{
  say("\n11) A request to staff names who is asking, wherever the name came from");
  // The chain grew a third link when item 14 landed (the ONE name), so this asserts the LINK this
  // item added rather than the whole line — section 13 owns the full chain.
  check("the escape-hatch request falls back to the name this device already gave",
    /const who = name\.trim\(\) \|\| getNickname\(sess\.current\?\.token\)/.test(gate));
  check("…and it is that value that is sent, not the raw box",
    /requestAccess\(p\.table, type, who, null, ridRef\.current\)/.test(gate));
  check("the OPEN request still requires a freshly typed name, which is the rule's own screen",
    /if \(!name\.trim\(\)\) \{ setNote\("Add your name so staff know who's asking\."\); return; \}/.test(gate));
}

// ── THREE SMALL THINGS THE OWNER PICKED (T4 s8, items 15, 16 and 17 — owner, 2026-09-02) ──────────
{
  const css = read("app/globals.css");
  say("\n12) The three small ones he picked off the list");
  check("the table box no longer shows browser spinner arrows a diner can tap",
    /\.sg-input\[type="number"\] \{ appearance: textfield; \}/.test(css)
    && /::-webkit-inner-spin-button \{ appearance: none/.test(css));
  check("…with ONE unprefixed appearance line, per the rule a hand-added -webkit- makes the build drop it",
    !/-moz-appearance/.test(css.slice(css.indexOf(".sg-input[type=\"number\"]"), css.indexOf(".sg-input[type=\"number\"]") + 400)));
  check("the scan screen says it is looking, instead of showing a picture that could be frozen",
    /Looking for your table&apos;s code… hold steady\./.test(gate) && /\.sg-scan-hint \{/.test(css));
  check("…and it is a line, not a second spinner competing with the badge",
    !/sg-scan-hint[^}]*animation/.test(css));
  check("the gate's backdrop has its OWN fade, not the favourites hint's keyframes",
    /animation: sgVeilIn \.2s ease;/.test(css) && /@keyframes sgVeilIn \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/.test(css));
  // Comments stripped first: the rule's own note NAMES favHintIn to record what it replaced, and a
  // raw-text test would read that note as the fault. (Third time this repo has recorded that shape.)
  check("…so nothing else can change it, and the dim layer no longer slides 8px on open",
    !/\.sg-overlay[^}]*favHintIn/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
  check("the add-to-cart gate's own note no longer claims a 3-second poll either",
    !/polls the live session every 3s/.test(read("lib/tableConnection.ts")));
}

// ── ONE NAME, EVERYWHERE (T4 s8, item 14 — owner, 2026-09-02) ─────────────────────────────────────
// His words: "if you add name in review it will save as there name … when name ask again in review
// what will name will be autofill there and there they add diff name the reviews name will be
// change to again added name … so like everywhere there wil be 1 name". Before this, a diner was
// asked their name on FIVE screens that knew nothing about each other, so one person could be three
// people to one restaurant in one evening. DRIVEN end to end before this guard was written: an empty
// box, then a filled one on the next dish, then a different name renaming both reviews.
{
  const gname = read("lib/guestName.ts");
  const item = read("app/item/[slug]/ItemClient.tsx");
  const mig = read("supabase/migrations/378_one_name_everywhere_for_a_guest.sql");
  const menu = read("lib/menu.ts");
  say("\n13) One name, everywhere a diner is asked for one");
  check("there is ONE module that owns the diner's name",
    /export function getGuestName\(\)/.test(gname) && /export function setGuestName\(/.test(gname));
  check("…and it is tenant-scoped, like every other guest key",
    /import \{ tget, tset \} from "\.\/tenantStorage";/.test(gname) && /const KEY = "lfh_my_name";/.test(gname));
  check("…with one definition of what a tidy name is, used on the way in and out",
    /export const tidyGuestName/.test(gname) && /GUEST_NAME_MAX = 40/.test(gname));
  check("…and it only announces a name that actually CHANGED",
    /if \(getGuestName\(\) === tidy\) return false;/.test(gname));
  // sweep #10 T4 item 10 (2026-10-13): …and that the phone KEPT — tset swallows a refused write, so
  // the answer is read back, or a private window is told "saved as your name" after every review.
  check("…and only one the phone actually KEPT (read back after the write — a private window keeps nothing)",
    /tset\(KEY, tidy\);[\s\S]{0,600}?kept = getGuestName\(\) === tidy;/.test(gname) && /return kept;\s*\}\s*$/.test(gname.trim() + "\n"));
  check("the review box fills itself in from that one name",
    /getGuestName\(\)/.test(item) && /window\.addEventListener\(GUEST_NAME_EVENT, fill\)/.test(item));
  check("…in an EFFECT, never during render, because that page is server-rendered",
    item.indexOf("useEffect(() => {\n    const fill = () => setReviewName") > -1);
  check("…and a name typed there becomes their name everywhere",
    /const nameChanged = setGuestName\(typedName, restaurantId\);/.test(item));
  check("…and the box keeps it afterwards rather than emptying, because it is their name now",
    /setReviewName\(typedName\);/.test(item));
  check("…and the diner is TOLD when their name changed, so nothing happens behind their back",
    /saved as your name/.test(item));
  check("…and that box has the same 40-character ceiling as every other name box",
    /maxLength=\{GUEST_NAME_MAX\}/.test(item));
  check("all three places the table sheet learns a name write it back as THE name",
    (gate.match(/setGuestName\((?:nick|headName|nm), ridRef\.current\)/g) || []).length === 3);
  check("…and so does the screen that asks a name before a waiter is called",
    /setGuestName\(name\.trim\(\), ridRef\.current\); \/\/ a name given here is a name given/.test(gate));
  check("…and the sheet's own boxes start filled in",
    /const fill = \(\) => setName\(\(cur\) => cur \|\| getGuestName\(\)\);/.test(gate));
  check("…and the nameless request to staff falls back to it last",
    /name\.trim\(\) \|\| getNickname\(sess\.current\?\.token\) \|\| getGuestName\(\) \|\| null/.test(gate));
  check("renaming past reviews is a server function, because the phone cannot reach them",
    /CREATE OR REPLACE FUNCTION lfh_rename_my_reviews/.test(mig) && /export async function renameMyReviews/.test(menu));
  check("…scoped to ONE restaurant, so a name given at one cafe never rewrites another's reviews",
    /AND restaurant_id = p_restaurant_id/.test(mig));
  check("…and it can only ever touch rows carrying the device id the caller already holds",
    /WHERE device_id = p_device/.test(mig));
  check("…changing the name column and nothing else",
    /SET name = v_name/.test(mig) && !/SET stars|SET comment|SET item_slug/.test(mig));
  check("…refusing a device id of the wrong shape, exactly as the review write does",
    /length\(p_device\) < 8 OR length\(p_device\) > 64/.test(mig));
  check("…writing no row at all when the name has not moved",
    /AND name IS DISTINCT FROM v_name;/.test(mig));
  check("…and its grant is written down rather than left to the default",
    /REVOKE ALL ON FUNCTION lfh_rename_my_reviews\(text, uuid, text\) FROM PUBLIC;/.test(mig)
    && /GRANT EXECUTE ON FUNCTION lfh_rename_my_reviews\(text, uuid, text\) TO anon, authenticated, service_role;/.test(mig));
  check("the rename uses the REVIEW device id, not the session one — they are different keys",
    /import \{ getDeviceId \} from "\.\/device";/.test(gname) && /renameMyReviews\(getDeviceId\(\)/.test(gname));
  check("…and it never delays or fails what the diner was actually doing",
    /void renameMyReviews\(/.test(gname));
}
// ── WHAT THE ORDERING SCREENS SAY MUST BE TRUE (sweep #10 T3, items 1–4) ──────────────────────
//
// Four places a diner was told something that was not so. Each is asserted on the CODE (comments
// stripped) and, for the two about money, on the NUMBERS the code produces. Every one was broken
// once, on purpose, and turned this guard red before it shipped.
{
  say("\n── 10. what the ordering screens say is true (sweep #10 T3) ──");
  // 1. The QR door's bell: the restaurant's own call limit answers {ok:true, reason:"rate_limited"}
  //    and creates NO call. It must never fall into "On our way! · staff notified".
  const chefCode = codeOnly(chef);
  const send = chefCode.slice(chefCode.indexOf("const res = await callWaiter("));
  const rl = send.indexOf('res.reason === "rate_limited"'), ok = send.indexOf("· staff notified`");
  check("item 1 — a QR call the restaurant's limit refused is answered as a refusal, BEFORE the 'staff notified' branch",
    rl >= 0 && ok > rl && /variant: "error"/.test(send.slice(rl, send.indexOf("} else", rl))));
  // 2. A saved order's total on the chip must be the BILL's figure, not a menu-rounded one.
  const F = await import("../lib/format.ts");
  const chipCode = codeOnly(chip);
  const usesMoney = /o\.track\?\.total \? ` · \$\{formatMoney\(o\.track\.total,/.test(chipCode) && !/formatPrice\(/.test(chipCode);
  let off = 0;
  for (const cur of F.CURRENCIES) for (let paise = 5000; paise < 400000; paise += 37) {
    const n = paise / 100;
    if (F.formatMoney(n, cur) !== F.formatAmount(F.toMinor(n * cur.rate, cur), cur)) off++;
  }
  check(`item 2 — the saved-orders chip prints an order total with the bill's rounding (formatMoney; ${off} of ${F.CURRENCIES.length * 10676} sample figures differ from the bill)`, usesMoney && off === 0);
  // 3. The tracker's "hidden" toast must name a tab the bill actually has.
  const sub = (codeOnly(tracker).match(/message: "Tracker hidden", subtitle: "([^"]+)"/) || [])[1] || "";
  const tabs = [...cart.matchAll(/onClick=\{\(\) => setShowHistory\((?:true|false)\)\}>\s*([A-Za-z ]+)/g)].map((m) => m[1].trim());
  check(`item 3 — hiding the order strip points at a tab that exists ("${sub}" · tabs: ${tabs.join(" / ")})`,
    tabs.length === 2 && tabs.some((t) => sub.toLowerCase().includes(t.toLowerCase())) && !/previous orders/i.test(sub));
  // 4. The total the basket STORES (the Live-status card's figure) is the bill's own total.
  const T = await import("../lib/tax.ts");
  const expr = (codeOnly(cart).match(/const totalUsd = ([^;]+);/) || [])[1] || "";
  let bad = 0, n4 = 0;
  try {
    const stored = new Function("subtotalUsd", "usdOnTopBase", "taxRate", "roundPaise", `return ${expr};`);
    for (const rate of [0.05, 0.12, 0.18, 0.025, 0.28]) for (let sub2 = 1; sub2 <= 4000; sub2 += 1) {
      const bill = T.splitBill([{ price: String(sub2), qty: 1, tax_mode: "excl" }], { price_tax_mode: "excl", tax_rate: rate });
      n4++; if (Math.abs(stored(sub2, bill.taxableBase, bill.rate, T.roundPaise) - bill.total) > 0.0001) bad++;
    }
  } catch { bad = -1; }
  check(`item 4 — the basket stores the bill's own total for the same basket (${bad} of ${n4} differ)`, !!expr && bad === 0);
}
// ── 11. THE BAN WALL SAYS WHICH REFUSAL IT GOT (sweep #10 T4, item 4) ──────────────────────────────
//
// A blocked guest's one action is "Request unblock". Every failure used to show "We couldn't match
// that number to this block", so a busy second or a dropped signal sent them hunting for a different
// number. Only the database's own `not_blocked` (mig 385: no block record matched) means the number;
// a timeout is the restaurant's system; anything else never reached a decision. Asserted on the code
// (comments stripped) AND by calling the component's own sentence-maker logic for each answer.
{
  say("\n── 11. the ban wall says which refusal it got (sweep #10 T4) ──");
  const ban = codeOnly(read("components/BanGate.tsx"));
  check("item 4 — the ban wall keeps the REASON, not a yes/no flag", /const \[failed, setFailed\] = useState\(""\);/.test(ban));
  check("item 4 — only the database's not_blocked answer blames the number",
    /r\.reason === "not_blocked"\s*\n?\s*\? "We couldn't match that number to this block\./.test(ban));
  check("item 4 — a timeout is worded as the restaurant's system, never as the guest's number",
    /isSessionTimeout\(r\)\s*\n?\s*\? "The restaurant's system isn't answering right now/.test(ban));
  // Re-aimed 2026-10-13 (owner: "make sure this never happens"): the fallback used to say "please check
  // your connection" to EVERY unrecognised failure. The connection is now named only when the phone is
  // really offline (isPhoneOffline); anything else is plain "not sent", blaming nobody.
  check("item 4 — a phone that is really offline is told so, and only then",
    /isPhoneOffline\(r\)\s*\n?\s*\? "Your phone seems to be offline — please check your connection and try again\."/.test(ban));
  check("item 4 — anything else is worded as 'not sent', so they try again rather than a new number",
    /: "We couldn't send that just now — please try again in a moment\."/.test(ban));
  check("item 4 — the line shows whatever was decided, not one fixed sentence", /<p className="ban-fail" role="status">\{failed\}<\/p>/.test(ban));
  check("item 4 — a success still says sent ONLY when the server says a row changed", /if \(r\.ok\) \{ setRequested\(true\); return; \}/.test(ban));
  // the function's real answers, read from the newest migration that defines it
  const migs = execSync("git ls-files supabase/migrations", { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".sql")).sort();
  const def = migs.filter((f) => /FUNCTION[^(]*lfh_request_unban/.test(read(f))).pop() || "";
  const body = def ? read(def).slice(read(def).search(/FUNCTION[^(]*lfh_request_unban/)) : "";
  check(`item 4 — the reason the wall branches on is one the function really sends (${def.split("/").pop() || "no migration found"})`,
    /'reason', 'not_blocked'/.test(body.slice(0, 3000)));
}
// ── 12. NOBODY IS TOLD TO CHECK THEIR INTERNET UNLESS THEIR DEVICE IS REALLY OFFLINE ────────────────
// (sweep #10 T4 item 1; owner 2026-10-13: *"make sure this never happens it's too bad"*.) A busy
// restaurant was blamed on diners' wifi. This scans EVERY screen in the product — guest pages, staff
// panels, login doors — for a sentence that sends a person to their own internet / connection / wifi,
// and each one must sit behind a test that PROVES the device is offline. A new screen that forgets is
// caught here the day it is written.
{
  say("\n── 12. nobody is told to check their internet unless their device really is offline (sweep #10 T4) ──");
  const files = execSync("git ls-files 'app/**/*.tsx' 'app/**/*.ts' 'components/*.tsx' 'lib/*.ts' 'lib/*.tsx' 'public/panels/**/*.js' 'public/*.html'", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const BLAME = /check (your|the) (internet|connection|wi-?fi|network|signal)|check your internet/gi;
  // The proofs a sentence may sit behind: lib/session's offline test, the sheet's verdict, the browser's
  // own offline flag, or a request that failed at the network (the login doors' `kind === "network"`).
  const PROOF = /isPhoneOffline\(|fault === "phone"|navigator\.onLine === false|!navigator\.onLine|kind === "network"|kind === "offline"|level === "offline"|isOffline\(|offline \?/;
  const unproven = [];
  let seen = 0;
  for (const f of files) {
    const code = codeOnly(read(f)); if (!code) continue;
    for (const m of code.matchAll(BLAME)) { seen++; const before = code.slice(Math.max(0, m.index - 260), m.index); if (!PROOF.test(before)) unproven.push(`${f}: "${code.slice(m.index - 30, m.index + 30).replace(/\s+/g, " ")}"`); }
  }
  check(`item 1 — every sentence telling a person to check their internet/connection sits behind proof the device is offline (${seen} found, ${unproven.length} unproven${unproven.length ? ": " + unproven.slice(0, 3).join(" | ") : ""})`, seen > 0 && unproven.length === 0);
  // …and the proof itself: lib/session.ts's offline test, run against what real browsers say.
  const sess = read("lib/session.ts");
  const reSrc = (sess.match(/const NETWORK_FAILURE = \/(.+)\/i;/) || [])[1];
  let re = null; try { re = reSrc ? new RegExp(reSrc, "i") : null; } catch { re = null; }
  const offlineSays = ["TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "The network connection was lost.", "The Internet connection appears to be offline."];
  const notOffline = ["timed_out", "empty", "permission denied for function lfh_join_session", "invalid input syntax for type uuid", "no_open_session"];
  check("item 1 — the offline test recognises what Chrome, Firefox and Safari say when a phone has no signal", !!re && offlineSays.every((t) => re.test(t)));
  check("item 1 — …and never mistakes a busy restaurant, an empty answer or a refusal for an offline phone", !!re && notOffline.every((t) => !re.test(t)));
  check("item 1 — a busy restaurant (timed_out) can never count as an offline phone, whatever the browser says", /if \(r && r\.reason === "timed_out"\) return false;/.test(codeOnly(sess)));
}
// ── ROUND 2 OF SWEEP #10 T3 — THE FIXES THE OWNER PICKED, AND THE ONES THE SECOND COMB FOUND ─────
//
// One sub-block per item, so a single item can be taken out with its guard. Asserted on the CODE
// (comments stripped). Each was broken once on purpose and turned this guard red before it shipped.
// The behaviour behind every one is also DRIVEN in scripts/sweep/t3s10 (round 2 blocks).
{
  say("\n── 11. sweep #10 T3 round 2 — what the second pass fixed ──");
  const r2 = (p) => codeOnly(read(p));
  // item 6 — the dish popup says so when "Add" hits the 99 ceiling, in the bill's own words
  { const c = r2("components/OrderConfirmModal.tsx");
    check("item 6 — the dish popup announces the 99-per-dish ceiling instead of stopping in silence",
      /const capped = !!existing && existing\.qty \+ qty > 99;/.test(c) && /if \(capped\) \{[\s\S]{0,120}message: "Maximum 99 per dish"/.test(c)); }
  // item 7 — ONE helper finds a token's restaurant, and all three writing doors use it
  { const doors = ["place-order", "call-waiter", "leave"].map((d) => r2(`app/api/guest/${d}/route.ts`));
    const anyCopy = doors.some((c) => /async function ridFromToken/.test(c));
    check("item 7 — all three writing doors find a token's restaurant through lib/guestTokenRestaurant.ts (no private copies)",
      !anyCopy && doors.every((c) => /restaurantOfToken\(b\.token\)/.test(c)) && /export async function restaurantOfToken/.test(r2("lib/guestTokenRestaurant.ts"))); }
  // item 8 — the old T3 runners switch French House's sessions on ONLY around the gate sections
  { const files = ["basket-and-doors", "order-end-to-end", "across-panels", "screens", "s7-live"].map((f) => r2(`scripts/sweep/t3/${f}.mjs`));
    const helper = r2("scripts/sweep/t3/sessionsOn.mjs");
    check("item 8 — the old runners that drive the join-a-table gate switch sessions ON for their run and put them back",
      files.every((c) => /sessionsOnForRun\(\)/.test(c) && /sessionsBack\(\)/.test(c)) && /restoreOnExit\(/.test(helper) && /sessions_enabled: false/.test(helper)); }
  // item 10 — the QR bell sends the owner's limit beacon like every other guest limit
  { const m = r2("lib/menu.ts"); const cw = m.slice(m.indexOf("export async function callWaiter"), m.indexOf("export type OrderStatus"));
    check("item 10 — a QR waiter call refused by the table's limit sends the owner's limit beacon",
      /if \(res\.reason === "rate_limited"\) \{[\s\S]{0,200}"\/api\/guest\/limit-hit"[\s\S]{0,160}fn: "lfh_call_waiter_table"/.test(cw)); }
  // item 11 — the Live-status dish reads follow a nudge + one-minute backstop, never the 5s redraw
  { const c = r2("components/CartPanel.tsx");
    check("item 11 — the bill reads each live order's dishes on a realtime nudge or the 60s backstop, not every 5 seconds",
      /const cardsShown = open && showHistory && !sessionsEnabled;/.test(c) && /window\.addEventListener\("lfh:rt-tick", bump\)/.test(c)
      && /setInterval\(bump, RT_BACKUP_MS\)/.test(c) && /\}, \[cardsShown, liveOrders, dishBeat\]\);/.test(c) && !/\}, \[open, liveOrders\]\);/.test(c)); }
  // item 13 — the bill looks dishes up in a table built once, not by walking the menu per line
  { const c = r2("components/CartPanel.tsx");
    check("item 13 — the bill builds one menu lookup per menu change instead of walking the menu for every line",
      !/menuItems\.find\(/.test(c) && /const menuById = useMemo\(/.test(c)); }
  // item 14 — a body the database cannot read is refused at the door, not retried as "busy"
  { const po = r2("app/api/guest/place-order/route.ts"), cw = r2("app/api/guest/call-waiter/route.ts");
    check("item 14 — malformed items / allergies / token / table are refused as bad_body before any database call",
      /if \(!items\.every\(goodItem\) \|\| !allergies\.every\(\(a\) => typeof a === "string"\)/.test(po) && /typeof raw\.token !== "string"/.test(cw)); }
  // item 15 — a reload's restore never puts one saved row in BOTH lists
  { const o = r2("lib/guestOutbox.ts");
    check("item 15 — restoring after a reload lets memory win across BOTH lists (one row, one list)",
      /const inMemory = new Set\(\[\.\.\.queued, \.\.\.failed\]\.map\(\(x\) => x\.id\)\);/.test(o) && (o.match(/!inMemory\.has\(x\.id\)/g) || []).length === 2); }
  // item 16 — the star animation, not the render, decides when a star lights
  { const c = r2("components/StarRating.tsx");
    check("item 16 — the stars' 'lit' class is owned by the animation, never re-set by a render",
      /<li key=\{i\} className="sr-li">/.test(c) && !/className=\{`sr-li \$\{i < value/.test(c)); }
  // item 17 — the QR bell on a busy restaurant is saved, like no signal
  { const m = r2("lib/menu.ts"), ch = r2("components/ChefPopup.tsx");
    check("item 17 — a QR call the restaurant did not ANSWER is saved and sent later (busy = offline)",
      /if \(isDbUnreachable\(error\)( \|\| isUnreachable\(error\))?\) throw busyError\(/.test(m) && /if \(isServerBusy\(err\)\) \{[\s\S]{0,160}enqueueGuestCall\(/.test(ch)); }
  // item 18 — the basket pill counts the same quantity the bill does
  { const c = r2("components/MiniCart.tsx");
    check("item 18 — the basket pill clamps a saved quantity to 1–99 exactly like the bill",
      /const qtyOf = \(q: unknown\) => Math\.min\(99, Math\.max\(1, Math\.floor\(/.test(c) && /qty: qtyOf\(it\.qty\)/.test(c)); }
  // item 19 — saved bell taps at two restaurants stay two calls
  { const o = r2("lib/guestOutbox.ts");
    check("item 19 — two saved calls for table N at two different restaurants are kept apart",
      /String\(x\.restaurantId \|\| ""\) === String\(p\.restaurantId \|\| ""\)/.test(o)); }
  // item 20 — a JSON body of `null` (or any non-object) is a clear refusal on every guest door
  { const ok3 = ["place-order", "call-waiter", "leave"].every((d) => /if \(!b \|\| typeof b !== "object" \|\| Array\.isArray\(b\)\) return NextResponse\.json\(\{ ok: false, reason: "bad_body" \}, \{ status: 400 \}\);/.test(r2(`app/api/guest/${d}/route.ts`)));
    check("item 20 — a body that parses to null / a number / a list is refused (or a no-op beacon), never a 500",
      ok3 && /if \(!b \|\| typeof b !== "object" \|\| Array\.isArray\(b\)\) b = \{\};/.test(r2("app/api/guest/limit-hit/route.ts"))); }
  // item 22 — the limit beacon reads a function NAME only when it is text
  { const c = r2("app/api/guest/limit-hit/route.ts");
    check("item 22 — the limit beacon ignores a function name that is not text (a list is not a name)",
      /const key = typeof b\.fn === "string" \? FN_TO_KEY\[b\.fn\] : undefined;/.test(c) && !/FN_TO_KEY\[String\(/.test(c)); }
  // item 23 — a dropped connection on Chrome is "couldn't ask", never "the order is gone"
  { const m = r2("lib/menu.ts"); const f = m.slice(m.indexOf("function isUnreachable("), m.indexOf("function isUnreachable(") + 400);
    check("item 23 — Chrome's 'Failed to fetch' counts as the restaurant not answering (so a cooking order is never marked cancelled by a dropped connection)",
      /failed to fetch/.test(f) && /if \(isDbUnreachable\(error\) \|\| isUnreachable\(error\)\) throw busyError\(/.test(m)); }
  // item 24 — on a narrow phone the order strip ends before the bell's corner begins
  { const css = codeOnly(read("app/globals.css"));
    const strip = (css.match(/\.order-tracker \{[^}]*?width: min\(340px, calc\(100vw - (\d+)px\)\)/) || [])[1];
    const bell = css.match(/\.chef-call \{[^}]*?right: calc\((\d+)px[^}]*?width: clamp\(\d+px, [\d.]+vw, (\d+)px\)/);
    const left = Number((css.match(/\.order-tracker \{[^}]*?left: (\d+)px/) || [])[1]);
    const need = bell ? left + Number(bell[1]) + Number(bell[2]) + 8 : Infinity;
    check(`item 24 — the order strip leaves the fixed bell its corner on a phone (strip gives up ${strip}px, the bell needs ${need}px)`, !!strip && Number(strip) >= need); }
  // item 21 — only a real duplicate reads "Already sent"
  { const c = r2("components/ChefPopup.tsx");
    check("item 21 — an unknown answer to a QR call is said honestly, never as 'Already sent'",
      /\} else if \(res\.reason === "already_sent"\) \{/.test(c) && /message: "Couldn't call staff from here"/.test(c)); }
}
// ── SHOW WHAT WAS COUNTED (sweep #9 T3 round 2) ────────────────────────────────────────────────
//
// `flush()` prints `out.slice(printed)` and there were two calls, the last at the end of section 9
// — while the file goes on running checks after it. So every result from there to the bottom was
// COUNTED and never PRINTED: this guard reported "4 check(s) failed" while naming exactly one, and
// the other three were invisible to whoever had to fix them. A count you cannot see is not a
// finding. One last flush, so the tally and the list can never disagree again.
flush();
if (fail) {
  // …AND NAME THEM (T1, 2026-09-15). The trailing flush above prints every line, but a reader still
  // had to scan 130 of them to find the failures. The tally now lists them, and says so if the
  // number counted and the number printed ever disagree again — which is what the fault above
  // looked like from the outside.
  const failed = out.filter((l) => l.startsWith("  FAIL"));
  console.log(`\n❌ ${fail} check(s) failed — a guest door, a promise to a diner, or their order list regressed.`);
  for (const l of failed) console.log("   " + l.trim());
  if (failed.length !== fail)
    console.log(`   ⚠ ${fail - failed.length} counted failure(s) printed no line — a section is pushing into \`out\` after the last flush again.`);
  process.exit(HOOK ? 2 : 1);
}
console.log("\n✅ all guest-door checks passed — three doors, one restaurant; and nothing tells a diner something that isn't true.");
