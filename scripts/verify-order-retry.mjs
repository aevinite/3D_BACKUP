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
//   node scripts/verify-order-retry.mjs --hook   # PostToolUse mode (reads the tool call on stdin)
//
// --hook is what makes these fixes STICK. Without it this file is 48 checks nobody runs: a future
// session can undo any of them and nothing goes red until a person happens to type the command.
// In hook mode it stays silent unless a file in this pipeline was just edited, then exits 2 with
// the failures so the editing session is told immediately. It derives the checkout root from the
// edited file's path, so it is correct inside a git worktree.
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK = process.argv.includes("--hook");
// The files these 48 checks are about. Editing one of them re-runs the guard; editing anything
// else costs nothing. Keep this in step with the files the checks actually read.
const WATCHED = /[/\\](lib[/\\](menu|session|guestOutbox|idempotency|idempotencyRule|clash|clashCompare)\.ts|components[/\\](CartPanel|SessionGate|ConnectionBadge)\.tsx|app[/\\]api[/\\]guest[/\\]place-order[/\\]route\.ts|public[/\\]panels[/\\](outbox\.js|editor[/\\]app\.js|kitchen[/\\]app\.js|tablet[/\\]app\.js))$/;

let ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
if (HOOK) {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { process.exit(0); }
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const file = String(payload?.tool_input?.file_path || payload?.tool_response?.filePath || "").replace(/\\/g, "/");
  if (!WATCHED.test(file)) process.exit(0);                       // not our business
  // Work out which checkout the edit was in (this may be a worktree, not the main folder).
  const m = file.match(/^(.*)\/(lib|components|app|public)\//);
  if (m && existsSync(join(m[1], "package.json"))) ROOT = m[1];
  // A guard must never break someone's edit: if this checkout predates the pipeline, go quiet.
  if (!existsSync(join(ROOT, "lib/idempotencyRule.ts"))) process.exit(0);
}

let pass = 0, fail = 0;
const ok = (m) => { pass++; if (!HOOK) console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };

if (!HOOK) console.log("\nA refused order must still be placeable\n");

// ── 1. the rule itself — the REAL function, bundled and executed ────────────────────────────
// Bundled rather than re-implemented or regex-matched: a guard that reasons about a copy of the
// code proves nothing about the code that ships. (Same approach as verify-busy-server.mjs.)
mkdirSync(join(ROOT, "node_modules/.cache"), { recursive: true });
const OUT = join(ROOT, "node_modules/.cache/verify-order-retry-idem.mjs");
// lib/idempotencyRule.ts imports NOTHING, so this bundle reaches no database, no Next runtime
// and no environment at all — which is exactly why the rule lives in its own file.
// A GUARD MUST NEVER BREAK SOMEONE'S EDIT. If esbuild can't run here (no node_modules yet, a
// half-installed checkout, no network), a thrown exception would fail the hook and block the edit
// with a stack trace — punishing a person for an unrelated problem. Go quiet instead; a normal
// `npm run verify:order-retry` still reports it loudly.
let didSomething;
try {
  execFileSync("npx", ["esbuild", "lib/idempotencyRule.ts", "--bundle", "--platform=node", "--format=esm",
    "--alias:@=.", `--outfile=${OUT}`, "--log-level=warning"], { cwd: ROOT, stdio: HOOK ? "ignore" : "inherit" });
  ({ didSomething } = await import(pathToFileURL(OUT).href));
} catch (e) {
  if (HOOK) process.exit(0);
  throw e;
}

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
// And an UNKNOWN code must never be echoed verbatim. Checked as a PROPERTY of the default arm
// rather than by matching one exact sentence: the old test looked for the literal
// `default: return "Couldn't send this order`, so it went red the moment that arm legitimately
// grew a second wording (a live refusal reads differently from one refused hours later, off the
// saved queue) even though nothing about the rule had changed. What actually matters is that the
// arm returns WORDS and cannot interpolate the code it was given.
const defaultArm = (outbox.match(/default: return ([^\n]+)/) || [])[1] || "";
const echoesCode = /\$\{\s*reason|\breason\b(?!\s*\?)/.test(defaultArm) || !/"[^"]{12,}"/.test(defaultArm);
!echoesCode
  ? ok("an unrecognised code falls back to plain words, never the code itself")
  : bad("reasonMsg() still echoes whatever the server sent", defaultArm.slice(0, 80));

// The refusal a diner must NEVER be told to retry: doing so trips the same per-table limit again
// and fires another alert at the owner about a guest who did what the app said. This is the one
// wording in the file with a consequence outside the phone, so it gets its own check.
/case "rate_limited": return "[^"]*wait/.test(outbox)
  ? ok("an over-the-limit order says WAIT, not 'try again'")
  : bad("the over-the-limit wording invites a retry, which raises another limit alert");

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
// A session refusal must turn the CODE into specific words. Originally this asserted the name of
// a private helper (`orderFailMsg`) that lived in the gate — but that helper was one of THREE
// copies of the same switch, and the copy on the busiest path (the QR cart) knew only two codes
// and told everyone else to "try again". They are one shared mapper now (reasonMsg in
// lib/guestOutbox.ts), so check the PROPERTY — the gate reads a refusal code and words it —
// rather than the name of whichever function happens to do it.
/reasonMsg\(\s*reason|orderFailMsg\(/.test(gate) && /refusalOf\(|Order failed:/.test(gate)
  ? ok("a session refusal says which dish or which reason")
  : bad("every session refusal still reads 'Couldn't place order'");

// …and so must the QR cart, which is the path that used to answer "please try again" for every
// reason it did not know — including over-the-limit, where retrying raises another owner alert.
const cart = readFileSync(join(ROOT, "components/CartPanel.tsx"), "utf8");
/reasonMsg\(/.test(cart) && !/\/sold_out\/i\.test/.test(cart)
  ? ok("the QR cart words every refusal from the shared list, not two hand-matched strings")
  : bad("the QR cart still pattern-matches the error text and lumps the rest into 'try again'");

// ── 8. parcel honours the 86 board and never drops a line ───────────────────────────────────
for (const [name, rel] of [["waiter", "app/api/tablet/[...path]/route.ts"], ["manager", "app/api/editor/[...path]/route.ts"]]) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const parcel = src.slice(src.indexOf('a === "parcel"'), src.indexOf('a === "parcel"') + 3000);
  // Test the PROPERTY, not an exact column list: this asserted the literal
  // select("id,title,price,open_price,tags") and went red the moment another change legitimately
  // added `tax_mode` to it. A guard that fails on a correct edit is one people delete.
  /\.select\("[^"]*\btags\b[^"]*"\)/.test(parcel) && /includes\("sold-out"\)/.test(parcel)
    ? ok(`${name} parcel reads the sold-out board and refuses`)
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

// ── 10. two people editing the same thing (the comparator that makes it possible) ───────────
// The REAL comparator, bundled and executed — lib/clashCompare.ts imports nothing, which is why
// it can be. A guard that re-implements the rule it checks proves nothing about what ships.
const CMP = join(ROOT, "node_modules/.cache/verify-order-retry-cmp.mjs");
let sameValue;
try {
  execFileSync("npx", ["esbuild", "lib/clashCompare.ts", "--bundle", "--platform=node", "--format=esm",
    `--outfile=${CMP}`, "--log-level=warning"], { cwd: ROOT, stdio: HOOK ? "ignore" : "inherit" });
  ({ sameValue } = await import(pathToFileURL(CMP).href));  // see the note above: never break an edit
} catch (e) {
  if (HOOK) process.exit(0);
  throw e;
}
const cmpCases = [
  ["two different rename maps are told apart", { "3": "A1" }, { "5": "Patio" }, false],
  ["the same map in another key order is equal", { "3": "A1", "5": "P" }, { "5": "P", "3": "A1" }, true],
  ["one edited rename is a change", { "3": "A1" }, { "3": "A2" }, false],
  ["null vs empty object invents no clash", null, {}, true],
  ["allergen lists still compare as sets", ["nuts", "egg"], ["egg", "nuts"], true],
];
for (const [name, a, b, want] of cmpCases) {
  sameValue(a, b) === want ? ok(name) : bad(name, `got ${sameValue(a, b)}, expected ${want}`);
}
const clashSrc = readFileSync(join(ROOT, "lib/clash.ts"), "utf8");
/from "@\/lib\/clashCompare"/.test(clashSrc)
  ? ok("the clash gate uses that comparator (not a private copy)")
  : bad("lib/clash.ts has drifted back to its own value comparison");
/isPlainObject\(v\)\) return "something different now"/.test(clashSrc)
  ? ok("an object's clash message never prints [object Object]")
  : bad("a manager could be shown the words [object Object]");
const ed = readFileSync(join(ROOT, "public/panels/editor/app.js"), "utf8");
// Assert the map is keyed by the value the save ACTUALLY passes. `kind` is "settings" for the
// general tab, so a `general:` key here matches nothing and the expectation is never sent — which
// is exactly what happened first, and this check went green on the string while nothing was
// protected. Only an end-to-end save caught it. So: key present AND kind derived the same way.
/EXPECT_TABLE = \{[^}]*\bsettings: "settings"/.test(ed) && /state\.tab === "general" \? "settings"/.test(ed)
  ? ok("table renames are protected — two managers can no longer overwrite each other")
  : bad("the settings expectation is keyed on a value `kind` never takes — nothing is protected");
/EXPECT_ID_FIELD/.test(ed)
  ? ok("…and the settings row is identified by restaurant_id, as the server expects")
  : bad("the settings expectation would name the wrong id column");

if (!HOOK || fail) console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed`);
if (HOOK && fail) console.log("\nThe ordering & offline pipeline just lost a protection. Re-run: npm run verify:order-retry");
// Hook mode exits 2 so the editing session is told; a normal run exits 1 for CI/scripts.
process.exit(fail ? (HOOK ? 2 : 1) : 0);
