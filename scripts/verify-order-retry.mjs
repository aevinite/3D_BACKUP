// verify-order-retry.mjs — A REFUSED ORDER MUST STILL BE PLACEABLE.
//
//   node scripts/verify-order-retry.mjs
//
// WHY THIS EXISTS. A diner tapped Place order twice in quick succession, tripped the per-table
// ordering limit, waited a minute and tapped again with the same basket — and got the same
// "Order didn't go through" forever. Nothing was wrong with the basket. The at-most-once guard
// had REMEMBERED the refusal: every guest order RPC reports a refusal as HTTP 200 with
// `{ ok:false, reason }`, and lib/idempotency.ts stored anything under 400 as "done", so the
// second tap never reached the kitchen at all — it replayed the stored refusal. The only escape
// was editing the basket, which nobody would guess.
//
// The rule that fixes it is general, not one route's patch: an action that CHANGED NOTHING is
// not worth remembering. So this proves the rule at the level it lives — the decision function —
// and then proves the two places that depend on it downstream.
//
// Nothing here touches a database, a deployed site or a login: it runs the real shipped files
// against a local stub, so it can never add load or raise one of the app's own limits.
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };

console.log("\nA refused order must still be placeable\n");

// ── 1. the rule itself — the REAL function, bundled and executed ────────────────────────────
// Bundled rather than re-implemented or regex-matched: a guard that reasons about a copy of the
// code proves nothing about the code that ships. (Same approach as verify-busy-server.mjs.)
mkdirSync(join(ROOT, "node_modules/.cache"), { recursive: true });
const OUT = join(ROOT, "node_modules/.cache/verify-order-retry-idem.mjs");
// lib/idempotencyRule.ts imports NOTHING, so this bundle reaches no database, no Next runtime
// and no environment at all — which is exactly why the rule lives in its own file.
execFileSync("npx", ["esbuild", "lib/idempotencyRule.ts", "--bundle", "--platform=node", "--format=esm",
  "--alias:@=.", `--outfile=${OUT}`, "--log-level=warning"], { cwd: ROOT, stdio: "inherit" });
const { didSomething } = await import(pathToFileURL(OUT).href);

const cases = [
  ["a placed order is remembered", 200, { ok: true, order_id: "abc" }, true],
  ["a refusal inside a 200 is NOT remembered", 200, { ok: false, reason: "rate_limited" }, false],
  ["a sold-out refusal inside a 200 is NOT remembered", 200, { ok: false, reason: "sold_out" }, false],
  ["a 4xx is NOT remembered", 400, { error: "nope" }, false],
  ["a 5xx is NOT remembered", 502, { ok: false }, false],
  ["a body-less success is remembered", 200, null, true],
  ["a non-object body is remembered", 200, "fine", true],
];
for (const [name, status, body, want] of cases) {
  const got = didSomething(status, body);
  got === want ? ok(name) : bad(name, `got ${got}, expected ${want}`);
}

// ── 2. the guard heals rows written before the rule existed ─────────────────────────────────
const idem = readFileSync(join(ROOT, "lib/idempotency.ts"), "utf8");
/storedIsRefusal\(stored\)/.test(idem)
  ? ok("a refusal already stored as 'done' is dropped rather than replayed forever")
  : bad("old rows still replay their refusal — the bug survives its own fix for anyone who already hit it");

// ── 3. the guest route must not hand a diner the database's own words ───────────────────────
const route = readFileSync(join(ROOT, "app/api/guest/place-order/route.ts"), "utf8");
!/reason: error\.message/.test(route)
  ? ok("a database failure sends a code, not its raw message")
  : bad("error.message still reaches the diner's 'couldn't send' list");
/reason: "server_busy"/.test(route)
  ? ok("…and that code is one the phone has words for")
  : bad("the busy code the client words is missing");

// ── 4. every code the server can send has diner-facing wording ──────────────────────────────
const outbox = readFileSync(join(ROOT, "lib/guestOutbox.ts"), "utf8");
const worded = new Set([...outbox.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]));
// The refusal codes the order RPCs return (supabase/migrations 029 + 240) plus this route's own.
const SERVER_CODES = [
  "empty_order", "unknown_item", "sold_out", "invalid_token", "session_closed",
  "not_approved", "blocked", "otp_required", "rate_limited", "staff_priced_item",
  "server_busy", "unknown_restaurant", "off_plan_table", "bad_body",
];
const missing = SERVER_CODES.filter((c) => !worded.has(c));
missing.length === 0
  ? ok(`all ${SERVER_CODES.length} refusal codes have words a diner can read`)
  : bad("a refusal would show as a machine word", missing.join(", "));
// And an UNKNOWN code must never be echoed verbatim.
/default: return "Couldn't send this order/.test(outbox)
  ? ok("an unrecognised code falls back to plain words, never the code itself")
  : bad("reasonMsg() still echoes whatever the server sent");

// ── 5. the saved-orders queue must never drop an order in silence ───────────────────────────
/if \(j\.ok === false\) \{ await moveToFailed\(item, reasonMsg\(j\.reason\)\)/.test(outbox)
  ? ok("a duplicate that carries a refusal is shown to the diner, not deleted")
  : bad("a saved order the server refuses still vanishes with no message");
/tries = \(item\.tries \|\| 0\) \+ 1/.test(outbox) && /SERVER_MAX_TRIES/.test(outbox)
  ? ok("an order the system keeps refusing eventually becomes the diner's decision")
  : bad("the saved-order queue can still retry forever in silence");
/export async function retryGuestFailed/.test(outbox)
  ? ok("…and they have a Try again to make it with")
  : bad("the only control on a failed order is still Dismiss");

// ── 6. the queue always has something to send it, and doesn't pulse ─────────────────────────
/ensureRetry\(\);/.test(outbox) && /function ensureRetry\(\)/.test(outbox)
  ? ok("saved work always has a timer behind it")
  : bad("an order can be saved with nothing scheduled to send it");
/0\.75 \+ Math\.random\(\) \* 0\.5/.test(outbox) && /RETRY_MAX_MS/.test(outbox)
  ? ok("re-sends back off and are jittered (no synchronised retry storm)")
  : bad("the diner's queue is still a fixed metronome");
// Test the CODE, not the prose. The comment explaining why the old `setInterval` was wrong
// contains the word, and a guard that fails on its own documentation is a guard people delete.
const outboxCode = outbox.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
!/setInterval\(/.test(outboxCode)
  ? ok("…and nothing ticks forever on an empty queue")
  : bad("a setInterval still runs for the life of the tab");
// The subtle one: a retry that fires during a blip must not be the LAST timer. If flush() returns
// bare while the phone reports itself offline, nothing reschedules — and a phone that never
// admitted it was down never fires "online" either, so the queue is stranded for good.
/if \(isOffline\(\)\) \{ scheduleRetry\(false\); return; \}/.test(outboxCode)
  ? ok("a retry landing during a blip leaves another timer behind")
  : bad("flushing while offline throws away the queue's last timer");

// ── 7. both guest order paths carry the same protection ─────────────────────────────────────
const menu = readFileSync(join(ROOT, "lib/menu.ts"), "utf8");
/export async function placeSessionOrderSafe/.test(menu)
  ? ok("a table-session order goes through the guarded path, not a bare RPC")
  : bad("the session path can still place an order twice and lose it when busy");
/function orderDeadline\(\)/.test(menu) && /typeof AbortSignal\.timeout === "function"/.test(menu)
  ? ok("the deadline is there AND guarded for phones that lack it")
  : bad("AbortSignal.timeout is used unguarded — an old phone reads as 'the restaurant is busy'");
const gate = readFileSync(join(ROOT, "components/SessionGate.tsx"), "utf8");
/placeSessionOrderSafe\(/.test(gate) && /orderKeyRef/.test(gate)
  ? ok("the session basket carries one at-most-once key, shared with anything saved for later")
  : bad("a session order still has no at-most-once key");
/isServerBusy\(err\)/.test(gate)
  ? ok("a swamped system saves the session order instead of losing it")
  : bad("a busy system still loses a table-session order outright");
/orderFailMsg\(/.test(gate)
  ? ok("a session refusal says which dish or which reason")
  : bad("every session refusal still reads 'Couldn't place order'");

// ── 8. parcel honours the 86 board and never drops a line ───────────────────────────────────
for (const [name, rel] of [["waiter", "app/api/tablet/[...path]/route.ts"], ["manager", "app/api/editor/[...path]/route.ts"]]) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const parcel = src.slice(src.indexOf('a === "parcel"'), src.indexOf('a === "parcel"') + 3000);
  /select\("id,title,price,open_price,tags"\)/.test(parcel)
    ? ok(`${name} parcel reads the sold-out board`)
    : bad(`${name} parcel can still take an order for a sold-out dish`);
  /if \(!d\) return err\(editErrMsg\("unknown_item"\), 400\)/.test(parcel)
    ? ok(`${name} parcel refuses a dish it can't resolve instead of dropping the line`)
    : bad(`${name} parcel still silently drops a line the customer paid for`);
}

// ── 9. round 2: the rest of the session calls, the claims table, the queue ceiling ──────────
const sess = readFileSync(join(ROOT, "lib/session.ts"), "utf8");
/SESSION_TIMEOUT_MS/.test(sess) && /abortSignal\(signal\)/.test(sess)
  ? ok("every table-session call carries a deadline, not just ordering")
  : bad("join / approve / leave / cart / waiter-call can still hang forever on a swamped system");
/typeof AbortSignal\.timeout === "function"/.test(sess)
  ? ok("…and that deadline is guarded for phones without AbortSignal.timeout")
  : bad("AbortSignal.timeout is used unguarded in lib/session.ts");
/reason: "timed_out"/.test(sess)
  ? ok("a timeout is reported as its own reason, not as a refusal")
  : bad("a timeout still comes back looking like the restaurant said no");
/isSessionTimeout\(st\)/.test(gate)
  ? ok("and the guest is told the restaurant didn't answer, not to check their own internet")
  : bad("a timeout still blames the guest's connection");

/lfh_prune_action_idempotency/.test(idem)
  ? ok("the at-most-once claims table is pruned (it grew forever; 87% was dead on 2026-08-04)")
  : bad("action_idempotency still grows without limit");
!/setInterval|cron/i.test(idem.split("maybePrune")[1] || "")
  ? ok("…opportunistically, with no timer doing work on idle data")
  : bad("pruning was wired to a blind timer");

/MAX_QUEUED/.test(outbox) && /moveToFailed\(oldest/.test(outbox)
  ? ok("one phone can't queue orders without limit, and the dropped one is shown not deleted")
  : bad("the diner's queue is still unbounded");

const kitchen = readFileSync(join(ROOT, "public/panels/kitchen/app.js"), "utf8");
(kitchen.match(/r && r\.queued/g) || []).length >= 3
  ? ok("the kitchen finally says when a tap was saved rather than sent")
  : bad("a cook can still tap ✓ with no signal and be told nothing");
/expect: opts && opts\.expect/.test(kitchen)
  ? ok("…and its api() can carry an expectation, so a future value edit is protectable")
  : bad("the kitchen api() still cannot pass `expect`");

const cov = readFileSync(join(ROOT, "scripts/verify-clash-coverage.mjs"), "utf8");
/Not covered by this check/.test(cov)
  ? ok("the clash guard states what it does NOT see (it was read as covering everything)")
  : bad("the clash guard still implies it covers the whole app");
/buildEditExpect/.test(readFileSync(join(ROOT, "public/panels/editor/app.js"), "utf8"))
  ? ok("two managers editing one dish no longer overwrite each other silently")
  : bad("the menu editor still has no expectation — last save wins on a price");

console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
