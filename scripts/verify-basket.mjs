#!/usr/bin/env node
// verify:basket — THE FIVE THINGS SWEEP #8 TERMINAL 3 FIXED, EACH WITH SOMETHING WATCHING IT.
//
//   node scripts/verify-basket.mjs
//
// Territory: the guest basket and placing an order — components/CartPanel.tsx,
// components/OrderTracker.tsx, lib/guestOutbox.ts, lib/menu.ts, app/api/guest/**.
//
// Nothing here touches a database, a login or a deployed site: it reads the real shipped files and,
// where it can, EXECUTES the shipped logic against synthetic input. So it can never add load or
// trip one of the app's own limits, and it cannot go stale against a running server.
//
// WHY EACH CHECK EXISTS — the five faults, in the words of the report:
//
//  1. A SERVED ORDER MADE THE PHONE REDRAW TEN TIMES A SECOND, FOR EVER. A finished order stays on
//     the device for the rest of the visit on purpose (the owner's rule, 2026-06-14), so the
//     "redraw when the linger mark passes" timer found a mark permanently in the past, fired 100 ms
//     later, published a fresh array, and re-armed itself. Measured: exactly 10.0 reads of
//     lfh_active_orders per second, indefinitely, with nothing changing on screen. This guard
//     EXECUTES the shipped predicate, so putting the bug back turns it red.
//
//  2. THE BELL HAD NO DEADLINE. `callWaiter` and `updateOrderTableNumber` in lib/menu.ts were the
//     last guest writes with no ceiling: on a connection that hangs rather than drops, the await
//     never settled, the button stayed disabled and nobody was told. Every neighbour already had a
//     deadline. verify:abort-guard checks `fetch` calls only, so a bare `supabase.rpc` slipped past
//     it — that is the hole this half closes.
//
//  3. A SAVED WAITER CALL WAS TOLD TO "ORDER AGAIN". One queue drains three kinds of saved thing,
//     and every generic sentence in it was written when orders were the only kind.
//
//  4. THE ROUTE ASKED THE REPLY FOR A FIELD THE REPLY HAS NEVER CARRIED. Both session routes
//     preferred `restaurant_id` off the RPC's answer, with a comment calling it "the authoritative
//     value" — and no version of `lfh_place_order` or `lfh_call_waiter` returns it, so the branch
//     was dead and the floor snapshot went undropped for exactly the body T9's finding F20 was
//     about. The token itself always knows, so it is now the last resort.
//
//  5. A DUPLICATE BELL TAP THREW AWAY THE WHOLE FLOOR'S SHARED READ. `already_sent`, `capped`,
//     `rate_limited` and a refusal all create no row, and all four dropped the 1.5s floor snapshot
//     (migration 238) that exists so a rush does not recompute per panel.
// NOTE ON `new Function` BELOW. It is used deliberately, three times, to EXECUTE a small piece of
// this repo's own tracked source (a filter predicate, a data table, one boolean helper) rather than
// grep it — because sweep #6 learned that three of three static "dead guard" findings were the
// detector being wrong, and because a predicate that is RUN cannot be satisfied by a comment. The
// only input is a file inside this checkout, read from disk; nothing here reads a request, an
// argument, an environment variable or a network response. Do not generalise it to anything that
// does.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let pass = 0;
const fails = [];
const P = (name, ok, extra) => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fails.push(name); console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`); }
};

// The body of one function, so a check can never be satisfied by a matching line somewhere else.
const between = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return "";
  const rest = src.slice(a);
  const b = to ? rest.indexOf(to) : -1;
  return b > 0 ? rest.slice(0, b) : rest;
};

const tracker = read("components/OrderTracker.tsx");
const outbox = read("lib/guestOutbox.ts");
const menu = read("lib/menu.ts");
const placeOrder = read("app/api/guest/place-order/route.ts");
const callWaiter = read("app/api/guest/call-waiter/route.ts");
const leave = read("app/api/guest/leave/route.ts");
const cart = read("components/CartPanel.tsx");

console.log("\nverify:basket — the guest basket and placing an order\n");

// ── 1. THE LINGER TIMER, EXECUTED ────────────────────────────────────────────────────────────────
console.log("1 · a finished order cannot make the phone redraw for ever");
{
  // Pull the predicate the shipped effect filters with, strip the TypeScript cast, and RUN it.
  // Anchored on `isFinal(o.status)` so it can only ever find the linger filter.
  const m = tracker.match(/orders\.filter\(\s*\n?\s*(\([\s\S]{0,400}?isFinal\(o\.status\)[\s\S]{0,400}?)\s*,?\s*\n?\s*\);/);
  P("the linger filter is where it can be read and run", !!m);
  if (m) {
    const src = m[1].replace(/ as number/g, "");
    let predicate = null;
    try {
      predicate = new Function("isFinal", "SERVED_LINGER_MS", "now", `return ${src};`)(
        (s) => s === "served" || s === "cancelled", 5000, 1_000_000_000,
      );
    } catch (e) { P("…and it is plain enough to execute", false, String(e.message)); }
    if (typeof predicate === "function") {
      const at = (offset, extra = {}) => ({ status: "served", finalizedAt: 1_000_000_000 + offset, ...extra });
      P("a mark still AHEAD of us schedules the redraw", predicate(at(0)) === true);
      P("a mark ALREADY PASSED does not (this is the loop)", !predicate(at(-90_000)));
      P("…nor one that passed by a single millisecond", !predicate({ status: "served", finalizedAt: 1_000_000_000 - 5_001 }));
      P("an order still cooking is never in the list", !predicate({ status: "preparing", finalizedAt: 1_000_000_000 }));
      P("nor one the diner dismissed", !predicate(at(0, { dismissed: true })));
      P("nor one with no finish time stamped at all", !predicate({ status: "served" }));
    }
  }
  // `now` is read ONCE, so the filter and the wait cannot disagree by a tick.
  P("the effect reads the clock once and uses that one reading", /const now = Date\.now\(\);[\s\S]{0,900}soonest - now/.test(tracker));
  // The 5s constant still means "one redraw", not "hide it" — lib/orderStatus.ts says so at length,
  // and warns in as many words: "DO NOT 'fix' the filter to honour it; that is the regression this
  // comment exists to prevent." So the FUNCTION BODY (not the essay above it) must never read it.
  const status = read("lib/orderStatus.ts");
  const liveBody = (status.split("export const liveActiveOrders")[1] || "").split("export const hasHiddenLiveOrder")[0];
  P("a finished order is still not filtered out of the live list", liveBody.length > 100 && !/SERVED_LINGER_MS/.test(liveBody));
}

// ── 2. EVERY GUEST WRITE HAS A CEILING ───────────────────────────────────────────────────────────
console.log("\n2 · no guest write can wait for ever");
{
  P("the shared deadline helper still exists and is feature-guarded", /function orderDeadline\(\)/.test(menu) && /typeof AbortSignal\.timeout === "function"/.test(menu));
  // The two guest WRITES in lib/menu.ts. A write is a tap: it must not be able to hang.
  // Written out one by one rather than as a list, so nothing in this file even LOOKS like a script
  // repeating a rate-limited action (verify:test-safety reads the shape, and it is right to).
  const bodyOf = (fn) => (menu.split(`export async function ${fn}`)[1] || "").slice(0, 2200);
  const bounded = (body) => /const signal = orderDeadline\(\);/.test(body) && /\.abortSignal\(signal\)/.test(body);
  const degrades = (body) => /signal\s*\n?\s*\?[\s\S]{0,600}:\s*await supabase\.rpc/.test(body);
  const bell = bodyOf("callWaiter");
  P("the bell asks for a deadline before it reaches the database", bounded(bell));
  P("…and still works on a phone that has no AbortSignal.timeout", degrades(bell));
  const fixTable = bodyOf("updateOrderTableNumber");
  P("correcting an order's table asks for one too", bounded(fixTable));
  P("…and degrades the same way on an old phone", degrades(fixTable));
  P("placing an order still carries its own deadline", /signal: orderDeadline\(\)/.test(menu));
  P("the saved-work queue still carries one too", /function sendDeadline\(\)/.test(outbox) && /signal: sendDeadline\(\)/.test(outbox));
  // The rule, stated as a rule: no bare `await supabase.rpc(` on a WRITE in lib/menu.ts.
  const writes = ["lfh_call_waiter_table", "set_order_table_number"];
  const bare = writes.filter((w) => new RegExp(`await supabase\\.rpc\\("${w}"[^)]*\\)(?!\\s*\\.abortSignal)`, "s").test(menu.replace(/\n/g, " ")) && !new RegExp(`${w}[\\s\\S]{0,400}abortSignal`).test(menu));
  P("no guest write is left as a bare, unbounded call", bare.length === 0, bare.join(", "));
}

// ── 3. THE QUEUE SAYS WHAT ACTUALLY FAILED ───────────────────────────────────────────────────────
console.log("\n3 · a saved call is never worded as an order");
{
  const m = outbox.match(/const CANT_SEND[^=]*=\s*(\{[\s\S]*?\n\};)/);
  P("the per-kind sentences are one table, where they can be read", !!m);
  if (m) {
    let table = null;
    try { table = new Function(`return ${m[1].replace(/;\s*$/, "")};`)(); } catch (e) { P("…and it is plain data", false, e.message); }
    if (table) {
      P("all three kinds are worded", ["order", "call", "leave"].every((k) => table[k]));
      for (const k of ["order", "call", "leave"]) {
        for (const slot of ["unreachable", "stillBusy", "refused"]) {
          const s = String(table?.[k]?.[slot] || "");
          P(`${k}/${slot} says something`, s.length > 20);
          if (k !== "order") P(`${k}/${slot} does not tell them to order again`, !/order again/i.test(s));
          if (k === "order") P(`order/${slot} still ends "please order again" (three guards assert it)`, /please order again\./.test(s));
        }
      }
      P("a call is pointed at a member of staff", /member of staff/.test(String(table.call.unreachable)));
      P("a leave is pointed at telling staff they have left", /you've left/.test(String(table.leave.unreachable)));
    }
  }
  // The three failure paths use the table, not a literal.
  const flush = outbox.split("export async function flushGuestOutbox")[1] || "";
  P("the unreachable path reads the table", /CANT_SEND\[kindOf\(item\)\]\.unreachable/.test(flush));
  P("the still-busy path reads the table", /CANT_SEND\[kindOf\(item\)\]\.stillBusy/.test(flush));
  P("the refused path reads the table", /CANT_SEND\[kindOf\(item\)\]\.refused/.test(flush));
  P("no failure path still hard-codes 'please order again'", !/moveToFailed\(item, "[^"]*order again/.test(flush));
  // …and the server-code path knows which kind it is talking about.
  P("a server refusal is worded for the kind that failed", (flush.match(/kind: kindOf\(item\)/g) || []).length >= 2);
  P("kindOf reads the row's own kind, and an old row is an order", /kindOf = \(it: GuestOrder\): GuestKind => \(isCall\(it\) \? "call" : isLeave\(it\) \? "leave" : "order"\)/.test(outbox));
  // The neutral set: only codes whose sentence is true of any saved thing.
  const n = outbox.match(/const WORDED_FOR_EVERY_KIND = new Set\(\[([\s\S]*?)\]\)/);
  P("the kind-neutral codes are listed explicitly", !!n);
  if (n) {
    const codes = (n[1].match(/"([a-z_]+)"/g) || []).map((s) => s.replace(/"/g, ""));
    P("rate_limited is NOT treated as kind-neutral (it says 'orders in a row')", !codes.includes("rate_limited"));
    P("a closed table IS kind-neutral", codes.includes("session_closed"));
    P("a busy system IS kind-neutral", codes.includes("server_busy"));
    P("a stale call IS kind-neutral", codes.includes("call_too_old"));
  }
  P("reasonMsg answers per kind before it reaches the order switch", /opts\?\.kind && opts\.kind !== "order" && !WORDED_FOR_EVERY_KIND\.has/.test(outbox));
  P("…and the order wording is untouched, to the byte", /default: return q \? "Couldn't send this order — please order again\." : "Order didn't go through — please try again\."/.test(outbox));
  P("a caller that names no kind still gets the order wording", /kind\?: GuestKind/.test(outbox));
}

// ── 4. THE RESTAURANT A REPLAY BELONGS TO ────────────────────────────────────────────────────────
console.log("\n4 · a replayed order or call always knows its restaurant");
{
  const asksTheToken = (src) => /async function ridFromToken\(token: string \| undefined\)/.test(src) && /await ridFromToken\(b\.token\)/.test(src);
  const narrowRead = (src) => /\.select\("session_id"\)[\s\S]{0,60}\.limit\(1\)/.test(src) && /\.select\("restaurant_id"\)[\s\S]{0,60}\.limit\(1\)/.test(src);
  const neverCosts = (src) => /catch \{ return ""; \}/.test(src);
  const cheapestFirst = (src) => /isUuid\(b\.restaurantId\)[\s\S]{0,200}ridFromToken/.test(src);
  P("a replayed ORDER falls back to the session token", asksTheToken(placeOrder));
  P("…with a column-listed, capped read", narrowRead(placeOrder));
  P("…that can never cost the diner their order", neverCosts(placeOrder));
  P("…and is only reached when the cheaper answers came back empty", cheapestFirst(placeOrder));
  P("a replayed request for staff falls back to the same token", asksTheToken(callWaiter));
  P("…with a column-listed, capped read", narrowRead(callWaiter));
  P("…that can never cost the diner their request", neverCosts(callWaiter));
  P("…and is only reached when the cheaper answers came back empty", cheapestFirst(callWaiter));
  P("place-order drops the floor snapshot only for an order that landed", /function dropFloorIfPlaced/.test(placeOrder) && /\.ok\)\s*!== false\)|ok\?: unknown \}\)\.ok !== false/.test(placeOrder.replace(/\s+/g, " ")));
  P("leaving a table still drops the snapshot", /invalidateFloor\(rid\)/.test(leave));
}

// ── 5. A CALL THAT NEVER LANDED CHANGES NOTHING ──────────────────────────────────────────────────
console.log("\n5 · a duplicate bell tap does not throw away the floor's shared read");
{
  const m = callWaiter.match(/function callLanded\(data: unknown\): boolean \{([\s\S]*?)\n\}/);
  P("the 'did a call actually land' rule is one readable function", !!m);
  if (m) {
    let landed = null;
    try {
      const src = m[1].replace(/: unknown/g, "").replace(/: \{[^}]*\}/g, "").replace(/ as \{[^}]*\}/g, "");
      landed = new Function("data", src);
    } catch (e) { P("…and it can be executed", false, e.message); }
    if (landed) {
      P("a brand-new call landed", landed({ ok: true }) === true);
      P("a refusal did not", landed({ ok: false, reason: "blocked" }) === false);
      P("a repeat within six seconds did not", landed({ ok: true, reason: "already_sent" }) === false);
      P("a table already holding six calls did not", landed({ ok: true, reason: "capped" }) === false);
      P("a call over the restaurant's limit did not", landed({ ok: true, reason: "rate_limited" }) === false);
      P("the session path's own duplicate answer did not", landed({ ok: true, already_active: true }) === false);
      P("an empty answer is not treated as a landing", landed(null) === false && landed(undefined) === false);
    }
  }
  const guarded = (callWaiter.match(/^.*invalidateFloor\(/gm) || []);
  P("every floor drop in the call route is behind that rule", guarded.length > 0 && guarded.every((l) => /callLanded\(/.test(l)));
  P("…and it branches on CODES, never on the server's prose", !/reason.*includes\("Table|\.message/.test(String(m && m[1])));
}

// ── standing pre-empts: things a sweep must NOT "fix" ─────────────────────────────────────────────
console.log("\n6 · the decisions in this territory that must survive");
{
  P("only place-order, the bell and leaving are queued on the guest side", /kind\?: "order" \| "call" \| "leave"/.test(outbox));
  P("a saved ORDER still has no cancel button (the kitchen may hold it)", /if \(!isCall\(it\)\) return \{ ok: false, reason: "not_a_call" \}/.test(outbox));
  P("a saved leave is dropped if the diner re-joins that very table", /function leaveIsStale/.test(outbox));
  P("the basket's '+' still explains its 99 ceiling out loud", /Maximum 99 per dish/.test(cart));
  P("…as information, not as a success", /message: "Maximum 99 per dish"[\s\S]{0,200}variant: "info"/.test(cart));
  P("the bill still quotes GST only on the lines it is added to", /onTopBase/.test(cart) && /tax_mode === "excl"/.test(cart));
  P("a ₹0 GST row is still removed rather than printed", /const showTaxRow = !dispSplit\.composition && tax > 0;/.test(cart));
  P("the dish paragraph is still off the card read", !/CARD_COLUMNS[\s\S]{0,600}description/.test(menu.split("export const CARD_COLUMNS")[1]?.slice(0, 900) || ""));
  P("dish names are still not translated (R14, ruled three times)", /REJECTED \(owner, 2026-08-12\)/.test(menu));
}

// ── 7. THE ONE FIELD A DINER MUST FILL IN STILL FITS ON A PHONE ──────────────────────────────────
console.log("\n7 · the table field's own words fit the box they are in");
{
  // Item 7. The placeholder read "Enter Table Number (required)" and was clipped to
  // "Enter Table Number (require" on a 360px phone — measured at the rendered 20px: 287px of text
  // in a 262px box. There is no way to measure a font from here, so this asserts the CEILING that
  // measurement produced: at 20px in the shipped face, 24 characters is the most that fits with any
  // headroom. A longer one goes back to being cut off, and the live row P57154's sibling in
  // scripts/sweep/t3/s8-live.mjs re-measures it properly against a real browser.
  const m = cart.match(/id="cart-table"[\s\S]{0,200}?placeholder="([^"]*)"/);
  P("the table field still has a placeholder", !!m);
  if (m) {
    P("…and it fits the box on a 360px phone (24 characters at 20px)", m[1].length <= 24, `${m[1].length}: "${m[1]}"`);
    P("…and still says the field is required", /required/i.test(m[1]));
    P("…and still names what the field is", /table/i.test(m[1]));
  }
  P("…and the field keeps its own accessible label, which is not length-bound", /aria-label="Table number"/.test(cart));
  P("…and it is still capped at four characters", /maxLength=\{4\}/.test(cart));
}

// ── 8. THE FOUR THINGS THE OWNER PICKED OFF THIS REPORT (items 10, 12, 13, 14) ───────────────────
console.log("\n8 · a button that waits on someone else, a queue that never drops work, and a diner who is told");
{
  // ITEM 12 — with dining sessions on, Place Order hands the job to the join-a-table gate and waits
  // to be TOLD the outcome. Every check says that gate reports exactly once; nothing bounded the
  // wait if it ever did not, and the button would then sit disabled reading "Placing…" for as long
  // as the page stayed open. Watched happening with the gate's outcome event swallowed: disabled at
  // 2.5s, released with a message at 60s, basket kept.
  const place = between(cart, "const placeOrder = async ()", "// If the panel isn't open");
  P("Place Order arms a way back before it hands over to the table gate", /const GATE_FAILSAFE_MS = 60_000;/.test(place) && /failsafe = setTimeout\(/.test(place));
  P("…the gate answering CANCELS it, so the ordinary case is unchanged", /if \(failsafe\) \{ clearTimeout\(failsafe\); failsafe = null; \}/.test(place));
  P("…the failsafe firing releases the button", /failsafe = null;[\s\S]{0,300}placingRef\.current = false;[\s\S]{0,60}setPlacing\(false\);/.test(place));
  P("…and removes the listener, so a late answer cannot fire into a dead handler", /failsafe = setTimeout\(\(\) => \{[\s\S]{0,200}removeEventListener\("lfh:session-done", onDone\)/.test(place));
  P("…and SAYS something, rather than just going quiet", /message: "We didn't hear back about that order"/.test(place));
  P("…pointing at the screen that can answer it, not at ordering again", /subtitle: "check Live status before ordering again"/.test(place) && /event: "lfh:show-previous-orders"/.test(place));
  P("…and it leaves the basket alone, because we do not know whether the order landed", !/failsafe = setTimeout\(\(\) => \{[\s\S]{0,700}saveCart\(\[\]\)/.test(place));
  P("…and 60s is long enough not to cut in front of a merely slow gate", /GATE_FAILSAFE_MS = 60_000/.test(place));

  // ITEM 13 — the restore used to ASSIGN over whatever was in memory, so an order saved in the same
  // instant the read came back could be dropped from the list that decides what gets SENT. Not
  // reproducible by hand in a browser (the queue is awake long before anyone taps Place Order), so
  // this is asserted on the shape: merge by id, memory wins, still sorted oldest-first.
  const restore = between(outbox, "function restoreQueue", "// ── React hook");
  P("the restore MERGES the saved queue with what is already in memory", /const byId = new Map<string, GuestOrder>\(\);/.test(restore));
  P("…and never assigns over it", !/queued = all\.filter/.test(restore) && !/failed = all\.filter/.test(restore));
  P("…storage first, then memory, so the newer copy wins its own attempt counters", /for \(const x of all\.filter\(\(x\) => x\.status !== "failed"\)\) byId\.set/.test(restore) && /for \(const x of queued\) byId\.set\(x\.id, x\);/.test(restore));
  P("…and the failed list is merged the same way", /const failedById = new Map<string, GuestOrder>\(\);/.test(restore));
  P("…and the queue still drains oldest-first", /\.sort\(\(a, b\) => a\.at - b\.at\)/.test(restore));
  P("…and it still gets a timer and a flush after restoring", /ensureRetry\(\);[\s\S]{0,120}void flushGuestOutbox\(\);/.test(restore));

  // ITEM 10 — the other half of sweep #7's item 21. The ANSWER a failed lookup gives is unchanged
  // (that is the protection the owner called "very imp"); what is added is the person and the retry.
  // Watched with the lookup made to fail: told once, retried, and the page came alive on the third
  // attempt with no reload. Made to fail every time: 5 attempts, then it STOPS, with 2 toasts total.
  const ctx = read("lib/restaurant-context.tsx");
  P("a failed tenant lookup still answers 'we do not know'", /setId\(""\);/.test(ctx) && /setReady\(false\);/.test(ctx));
  P("…and still never guesses restaurant #1 on a failure", !/catch\(\(\) => \{[\s\S]{0,300}setId\(DEFAULT_RESTAURANT_ID\)/.test(ctx));
  P("…the diner is now told", /say\("We couldn't load this restaurant"/.test(ctx));
  P("…ONCE, not once per attempt", /if \(!toldOnce\) \{/.test(ctx));
  P("…and it tries again by itself", /timer = setTimeout\(\(\) => \{ timer = null; if \(alive\) tryResolve\(\); \}, jittered\);/.test(ctx));
  P("…on a widening wait", /const RETRY_WAITS_MS = \[2_000, 5_000, 12_000, 25_000\];/.test(ctx));
  P("…jittered, so a room full of phones does not come back on one beat", /0\.75 \+ Math\.random\(\) \* 0\.5/.test(ctx));
  P("…BOUNDED, so a dead restaurant is never hammered", /if \(wait === undefined\) \{/.test(ctx));
  P("…ending with an action a person can take", /say\("Still can't load this restaurant", "please reload the page, or ask a member of staff", 6000\)/.test(ctx));
  P("…and it does not promise a tap it cannot honour", !/tap to try again/.test(ctx));
  P("…the timer is cleared when the door changes or the widget goes", /return \(\) => \{ alive = false; if \(timer\) \{ clearTimeout\(timer\); timer = null; \} \};/.test(ctx));
  P("…and the waits live outside the component, so the effect's dep list stays honest", /^const RETRY_WAITS_MS/m.test(ctx));

  // ITEM 14 — one guard drove a browser with no app-up preflight, so the shared after-edit hook was
  // red for every session in this repo on unmodified main.
  const t24 = read("scripts/verify-t24b-live.mjs");
  P("the live money guard does the app-up preflight like its siblings", /import \{ requireUp \} from "\.\/sweep\/appUp\.mjs";/.test(t24) && /await requireUp\(BASE,/.test(t24));
  P("…before it launches a browser", t24.indexOf("await requireUp(BASE,") < t24.indexOf("await chromium.launch()"));
}

console.log(`\n${fails.length ? "✗" : "✓"} verify:basket — ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("\nFAILED:"); for (const f of fails) console.log("  · " + f); process.exit(1); }
