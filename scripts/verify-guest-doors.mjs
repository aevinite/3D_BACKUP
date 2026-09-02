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
check("the table-session gate keeps settings PER RESTAURANT, never one set for the whole page",
  /settingsByRid/.test(gate)
  && /settingsByRid\.current\.set\(rid, s\)/.test(gate)
  && /settingsByRid\.current\.get\(ridRef\.current/.test(gate)
  && !/settingsByRid\.current\.(get|set)\(\)/.test(gate));
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
check("the table gate ASKS for settings rather than serving its own map",
  /const s = await getSettings\(rid\);\n\s*settingsByRid\.current\.set\(rid, s\);/.test(gate));
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
  check("all four name boxes were found", named.length === 4);
  check("…every one of them caps the name at 40",
    named.length === 4 && named.every((b) => /maxLength=\{40\}/.test(b)));
  check("…and every one of them submits on Enter, so the phone's Go key is never dead",
    named.length === 4 && named.every((b) => /e\.key === "Enter"/.test(b)));
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
    /if \(before === tidy\) return false;/.test(gname));
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
if (fail) {
  console.log(`\n❌ ${fail} check(s) failed — a guest door, a promise to a diner, or their order list regressed.`);
  process.exit(HOOK ? 2 : 1);
}
console.log("\n✅ all guest-door checks passed — three doors, one restaurant; and nothing tells a diner something that isn't true.");
