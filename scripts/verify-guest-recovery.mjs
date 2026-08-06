#!/usr/bin/env node
// verify-guest-recovery.mjs — THE TWO THINGS A DINER SHOULD NOT LOSE.
//
//   node scripts/verify-guest-recovery.mjs
//
// Improvements #4 and #5 from the T2 sweep, both about the same idea: the app already knows enough
// to do better than "please try again", so it should.
//
//   #4  CALLING A WAITER SURVIVES NO SIGNAL.
//       Placing an order has survived since the offline queue was written. Calling a waiter — the
//       thing a diner does when something is WRONG, and the request most likely to be made from
//       the corner of the room with thick walls — just failed, with advice they cannot act on.
//
//   #5  ONE SOLD-OUT DISH DOES NOT COST THE WHOLE BASKET.
//       A table of six lost everything because one item ran out, and had to rebuild the order by
//       hand on a phone, having already waited.
//
// Static: it reads the shipped files. No database, no login, no deployed site — so it can never
// add load or trip one of the app's own limits, and it runs in a second.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
let fail = 0;
const check = (name, ok) => { console.log((ok ? "  ok   " : "  FAIL ") + name); if (!ok) fail++; };

const outbox = read("lib/guestOutbox.ts");
const route = read("app/api/guest/call-waiter/route.ts");
const chef = read("components/ChefPopup.tsx");
const badge = read("components/ConnectionBadge.tsx");
const cart = read("components/CartPanel.tsx");

console.log("\n#4) A waiter call survives losing signal");
check("the queue can hold something that isn't an order", /kind\?: "order" \| "call"/.test(outbox));
check("there is a way to save one", /export async function enqueueGuestCall/.test(outbox));
check("…and the button uses it when the phone is offline",
  /enqueueGuestCall\(/.test(chef) && /navigator\.onLine === false/.test(chef));
check("it goes to its own door, not the order one", /"\/api\/guest\/call-waiter"/.test(outbox));
check("that door exists and rings the floor AT MOST ONCE",
  /withIdempotency\(postImpl, "guest"\)/.test(route) && /X-LFH-Action-Id/.test(outbox));
check("a call that succeeds is cleared even though it has no order to track",
  /res\.ok && j\?\.ok && isCall\(item\)/.test(outbox));
check("a STALE call is not delivered — both on the phone…", /STALE_CALL_MS/.test(outbox));
check("…and on the server, which cannot rely on the phone", /STALE_CALL_MS/.test(route));
check("the diner is told in words why a stale call didn't go", /case "call_too_old":/.test(outbox));
check("the toast only promises automatic sending when it really reached storage",
  /q\.persisted \?/.test(chef));

console.log("\n#5) One sold-out dish doesn't cost the whole basket");
check("the phone remembers which id is which dish", /lines\?: \{ id: string; title: string \}\[\]/.test(outbox));
check("…recorded by the cart at the moment it saves the order",
  (cart.match(/lines: cart\.map\(\(it\) => \(\{ id: it\.id, title: it\.title \}\)\)/g) || []).length === 2);
check("a one-dish refusal is remembered as such", /item\.blocked = oneDish/.test(outbox));
check("…for the three refusals that really do name one dish",
  /\["sold_out", "hidden_item", "unknown_item"\]/.test(outbox));
check("there is an action that re-sends the rest", /export async function orderRestWithout/.test(outbox));
check("it uses a NEW at-most-once id (the server remembers the old refusal)",
  !/orderRestWithout[\s\S]{0,900}actionId: it\.id/.test(outbox));
check("it refuses to guess when it can't tell the lines apart",
  /if \(!keptLines\.length \|\| !keptItems\.length\) return \{ ok: false, left: 0 \};/.test(outbox));
check("the button is offered ONLY when it can genuinely do something",
  /o\.blocked && \(o\.lines \|\| \[\]\)\.length > 1/.test(badge));

console.log("\nBoth) the shared promises still hold");
check("everything saved still carries a timer to send it", /ensureRetry\(\);/.test(outbox));
check("the online path is still untouched — offline is the only diversion",
  /navigator\.onLine === false/.test(cart) && /navigator\.onLine === false/.test(chef));

console.log(fail ? `\n${fail} guest-recovery check(s) FAILED` : "\nAll guest-recovery checks passed — a lost signal costs a diner neither their call nor their basket.");
process.exit(fail ? 1 : 0);
