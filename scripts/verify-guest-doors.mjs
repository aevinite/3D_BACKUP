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
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = process.argv.includes("--hook");
// The files these checks are about. Editing one re-runs the guard; editing anything else costs
// nothing. Keep this in step with the files the checks actually read.
const WATCHED =
  /[/\\](lib[/\\](restaurant-context\.tsx|tenantStorage\.ts)|components[/\\](SessionGate|OrderTracker|CustomerGreeter|ChefPopup|CartPanel|GuestOutboxChip)\.tsx|app[/\\]q[/\\]\[code\][/\\]page\.tsx)$/;

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
check("the table-session gate caches settings PER RESTAURANT, not once for the page",
  /settingsByRid/.test(gate) && /settingsByRid\.current\.get\(rid\)/.test(gate));
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

console.log(out.join("\n"));
if (fail) {
  console.log(`\n❌ ${fail} check(s) failed — a guest door, a promise to a diner, or their order list regressed.`);
  process.exit(HOOK ? 2 : 1);
}
console.log("\n✅ all guest-door checks passed — three doors, one restaurant; and nothing tells a diner something that isn't true.");
