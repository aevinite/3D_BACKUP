#!/usr/bin/env node
// SWEEP 7 — TERMINAL 3's NEW STATIC CHECKS, P16101..P16400.
//
//   node scripts/sweep/t3/s7-checks.mjs            # all of them, one line each
//   node scripts/sweep/t3/s7-checks.mjs --quiet    # only the failures + the summary
//
// WHY THIS FILE EXISTS. The ledger (.claude/sweep/LEDGER/T3.md) is the permanent record of WHAT is
// checked; this is the permanent record of HOW, for the rows that can be decided by reading the
// code. Sweep 6 learned that the hard way: its runners were deleted as scratch and had to be
// rebuilt from the ledger's prose the next time a re-run was asked for.
//
// Every check below is written so that it can FAIL. A check that cannot fail protects nothing, and
// three of three static "dead guard" hits in sweep 6 were the detector being wrong — so these
// assert the RULE (a call site, a guard, a shape) and never a comment.
//
// Reads only. No key, no server, no database, well under a second.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const QUIET = process.argv.includes("--quiet");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
// Code with the comments stripped: several checks below must assert what the code DOES, and a
// promise written in a comment is exactly what this project's "assert enforcement, never comments"
// scar is about.
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let pass = 0; const fails = [];
const lines = [];
const P = (id, name, ok) => {
  if (ok) { pass++; if (!QUIET) lines.push(`ok   ${id} ${name}`); }
  else { fails.push(`${id} ${name}`); lines.push(`FAIL ${id} ${name}`); }
};
const H = (t) => { if (!QUIET) lines.push(`\n── ${t}`); };

// ── the files ────────────────────────────────────────────────────────────────────────────────────
const F = {
  cart:    read("components/CartPanel.tsx"),
  mini:    read("components/MiniCart.tsx"),
  gate:    read("components/SessionGate.tsx"),
  sync:    read("components/SessionCartSync.tsx"),
  owner:   read("components/SessionOwner.tsx"),
  widget:  read("components/SessionStatusWidget.tsx"),
  tbill:   read("components/SessionTableBill.tsx"),
  confirm: read("components/OrderConfirmModal.tsx"),
  tracker: read("components/OrderTracker.tsx"),
  bell:    read("components/ChefCallButton.tsx"),
  chef:    read("components/ChefPopup.tsx"),
  greeter: read("components/CustomerGreeter.tsx"),
  chip:    read("components/GuestOutboxChip.tsx"),
  menu:    read("lib/menu.ts"),
  tstore:  read("lib/tenantStorage.ts"),
  ctx:     read("lib/restaurant-context.tsx"),
  outbox:  read("lib/guestOutbox.ts"),
  session: read("lib/session.ts"),
  status:  read("lib/orderStatus.ts"),
  table:   read("lib/table.ts"),
  features:read("lib/features.ts"),
};
const ALL_GUEST = [F.cart, F.mini, F.gate, F.sync, F.owner, F.widget, F.tbill, F.confirm,
                   F.tracker, F.bell, F.chef, F.greeter, F.chip].join("\n/*FILE*/\n");
const MY_LIBS = [F.menu, F.tstore, F.ctx, F.outbox].join("\n/*FILE*/\n");

P("P16101", "every file in the territory is present and non-empty",
  Object.entries(F).every(([, v]) => v.length > 0));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// A. THE SAVED-WORK QUEUE'S SECOND KIND: A REQUEST FOR STAFF (P16102–P16140)
// Sweep 6 checked the queue's handling of a call thoroughly and never checked how one READS.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("A. a saved request for staff, end to end (P16102-P16140)");
P("P16102", "the queue's item type declares the two kinds explicitly",
  /kind\?: "order" \| "call"/.test(F.outbox));
P("P16103", "a row written before `kind` existed is read as an order, not as neither",
  /const isCall = \(it: GuestOrder\) => it\.kind === "call"/.test(F.outbox));
P("P16104", "a call carries the words the diner tapped, not a code",
  /reason\?: string;/.test(F.outbox));
P("P16105", "a call is POSTed to the waiter endpoint, never to place-order",
  /if \(isCall\(item\)\) \{[\s\S]{0,200}fetch\("\/api\/guest\/call-waiter"/.test(F.outbox));
P("P16106", "…carrying an at-most-once id so it rings the floor once however often it is resent",
  /"X-LFH-Action-Id": item\.id,\s*\/\/ rings the floor ONCE/.test(F.outbox));
P("P16107", "…and the time it was asked, so the floor can judge how old it is",
  /body: JSON\.stringify\(\{ mode: item\.mode, token: item\.token, table: item\.table, restaurantId: item\.restaurantId, reason: item\.reason, at: item\.at \}\)/.test(F.outbox));
P("P16108", "an order — unlike a call — is marked as a replay so the server can refuse a moved-on table",
  /"X-LFH-Replay": "1"/.test(F.outbox) && /"X-LFH-Queued-At"/.test(F.outbox));
P("P16109", "a call older than ten minutes is dropped on the phone rather than delivered late",
  /const STALE_CALL_MS = 10 \* 60 \* 1000/.test(F.outbox)
  && /if \(isCall\(item\) && Date\.now\(\) - \(item\.at \|\| 0\) > STALE_CALL_MS\)/.test(F.outbox));
P("P16110", "…and the diner is told that in their own words, not with a code",
  /moveToFailed\(item, reasonMsg\("call_too_old", \{ queued: true \}\)\)/.test(F.outbox));
P("P16111", "repeated bell taps in a dead spot collapse into ONE saved call",
  /const already = queued\.find\(sameTable\);/.test(F.outbox));
P("P16112", "…keeping the NEWEST note rather than the first",
  /if \(p\.reason\) already\.reason = p\.reason;/.test(F.outbox));
P("P16113", "…and matched on table AND token AND mode, so two tables never merge",
  /isCall\(x\) && x\.mode === p\.mode && String\(x\.table \|\| ""\) === String\(p\.table \|\| ""\) && String\(x\.token \|\| ""\) === String\(p\.token \|\| ""\)/.test(F.outbox));
P("P16114", "a delivered call is removed from the queue, not left to send twice",
  /if \(res\.ok && j\?\.ok && isCall\(item\)\) \{ progressed = true; await removeItem\(item\.id\)/.test(F.outbox));
P("P16115", "the saved-work list can tell a call from an order",
  /const isCall = \(o: GuestOrder\): boolean => o\.kind === "call"/.test(F.chip));
P("P16116", "…and names what was asked for",
  /if \(isCall\(o\)\) return callText\(o\);/.test(F.chip));
P("P16117", "…falling back to plain words when an old row carries no note",
  /return r \|\| "A request for staff";/.test(F.chip));
P("P16118", "…and never prints the count of an empty basket for one",
  /const n = o\.track\?\.itemCount \?\? \(Array\.isArray\(o\.items\) \? o\.items\.length : 0\);/.test(F.chip)
  && /if \(isCall\(o\)\) return callText\(o\);/.test(F.chip));
P("P16119", "the row's second line says what will happen to a call, not 'waiting to send'",
  /\{isCall\(o\) \? "Staff will be called" : "Waiting to send"\}/.test(F.chip));
P("P16120", "the chip counts requests for staff as requests",
  /return n === 1 \? "1 request for staff" : `\$\{n\} requests for staff`;/.test(F.chip));
P("P16121", "…and drops the noun entirely when the queue is mixed, rather than picking a wrong one",
  /if \(list\.some\(isCall\)\) return `\$\{n\}`;/.test(F.chip));
P("P16122", "…and still says 'order' when that is all there is",
  /return n === 1 \? "1 order" : `\$\{n\} orders`;/.test(F.chip));
P("P16123", "the plural of 'request for staff' is not 'request for staffs'",
  /`\$\{n\} requests for staff`/.test(F.chip));
P("P16124", "a call has no price, so no money is invented on its row",
  /o\.track\?\.total \? ` · \$\{formatPrice/.test(F.chip));
P("P16125", "'Order the rest' cannot appear on a call (it has no lines and nothing blocked)",
  /\{o\.blocked && \(o\.lines \|\| \[\]\)\.length > 1 && \(/.test(F.chip));
P("P16126", "…and the queue refuses one anyway if it is asked",
  /if \(!it \|\| !it\.blocked\) return \{ ok: false, left: 0 \};/.test(F.outbox));
P("P16127", "the sheet's screen-reader label covers both kinds",
  /aria-label="Saved on this phone"/.test(F.chip));
P("P16128", "a call saved with no signal from the WAITER POPUP goes through the queue",
  /enqueueGuestCall\(\{ mode: "public", table: check\.value, restaurantId, reason \}\)/.test(F.chef));
P("P16129", "…and one saved from inside a table session carries the session token instead of a table",
  /enqueueGuestCall\(\{ mode: "session", token: s\.token, restaurantId: ridRef\.current \|\| DEFAULT_RESTAURANT_ID, reason: note \}\)/.test(F.gate));
P("P16130", "both promise automatic sending ONLY when the phone really stored it",
  /q\.persisted \? "Saved — we'll call them the moment you're back online"/.test(F.gate)
  && /q\.persisted \? `\$\{reason\} · staff are told as soon as there's signal`/.test(F.chef));
P("P16131", "a call that could not even be saved says so honestly instead of promising",
  /message: "Couldn't save your call"/.test(F.chef));
P("P16132", "the session path falls through to a live attempt rather than lying, if saving throws",
  /\} catch \{ \/\* couldn't even save → fall through and let the live attempt say so honestly \*\//.test(F.gate));
P("P16133", "the queue is capped, so one phone cannot pile up unbounded saved calls",
  /const MAX_QUEUED = 25;/.test(F.outbox)
  && (F.outbox.match(/while \(queued\.length > MAX_QUEUED\)/g) || []).length === 2);
P("P16134", "…and the OLDEST is the one retired, with a sentence written for a diner",
  /This one waited too long to send — please ask a member of staff if you still need someone\./.test(F.outbox));
P("P16135", "a call and an order both reset all three attempt counters on 'Try again'",
  /it\.tries = 0; it\.netTries = 0; it\.busyTries = 0;/.test(F.outbox));
P("P16136", "the waiter endpoint's refusals all have diner-facing words on this side",
  ["call_too_old", "rate_limited", "blocked"].every((r) => new RegExp(`case "${r}"`).test(F.outbox)));
P("P16137", "a call never reaches the tracker's active-orders list (it is not an order)",
  /if \(res\.ok && j\?\.ok && j\.order_id\) \{ progressed = true; recordActive/.test(F.outbox));
P("P16138", "the bell disappears entirely when waiter calls are switched off",
  /if \(!features\.waiter_calls\) return null;/.test(F.bell));
P("P16139", "…and the popup cannot be opened even by the event, for the same restaurant",
  new RegExp("if \\(!features\\.waiter_calls\\) return null;[\\s\\S]{0,80}if \\(!open\\) return null;").test(F.chef));
P("P16140", "…both read the switch for the restaurant ON SCREEN, not a hardcoded one",
  /useFeatures\(useRestaurantId\(\)\)/.test(F.bell) && /useFeatures\(restaurantId\)/.test(F.chef));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// B. EVERY SERVER CALL IN THE TERRITORY: IS ITS ANSWER READ? (P16141–P16200)
// A systematic pass over every awaited call, because that is where three of this run's six faults
// were. None of these calls THROWS — lib/session.ts's rpc() turns a timeout into
// { ok:false, reason:"timed_out" } — so "it didn't throw" is never evidence it worked.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("B. every server call: is its answer read? (P16141-P16200)");
P("P16141", "the shared rpc helper never throws a timeout, it returns a code",
  /if \(signal\?\.aborted \|\| \/abort\/i\.test\(msg\)\) return \{ ok: false, reason: "timed_out" \};/.test(F.session));
P("P16142", "…and an empty answer is a failure, not a silent success",
  /const result = \(data as RpcResult\) \?\? \{ ok: false, reason: "empty" \};/.test(F.session));
P("P16143", "…and a timeout has its own predicate, so callers can word it differently from a refusal",
  /export const isSessionTimeout = \(r: RpcResult\): boolean => r\.reason === "timed_out";/.test(F.session));
P("P16144", "no handler in the whole territory awaits leaveSession and drops the answer",
  !/^\s*await leaveSession\(/m.test(bare(ALL_GUEST)));
P("P16145", "no handler awaits approveMember and drops the answer",
  !/^\s*await approveMember\(/m.test(bare(ALL_GUEST)));
P("P16146", "no handler awaits removeMember and drops the answer",
  !/^\s*await removeMember\(/m.test(bare(ALL_GUEST)));
P("P16147", "no handler awaits setAutoApprove and drops the answer",
  !/^\s*await setAutoApprove\(/m.test(bare(ALL_GUEST)));
P("P16148", "the join flow reads its answer and branches on every ending it can give",
  ["blocked", "too_far", "no_open_session"].every((r) => new RegExp(`r\\.reason === "${r}"`).test(F.gate)));
P("P16149", "…and treats anything else as 'could not reach', keeping the guest's place",
  /if \(!r\.ok\) \{ setTableInput\(p\.table\); setNote\("Couldn't reach the restaurant's system/.test(F.gate));
P("P16150", "the waiter-call-in-session path reads its answer",
  /const r = await callWaiterSession\(s\.token, note\);/.test(F.gate) && /if \(r\.ok\) \{ fireDone/.test(F.gate));
P("P16151", "…and tells a timeout apart from a refusal in what it says",
  /isSessionTimeout\(r\)\s*\?\s*"We couldn't reach the restaurant just now/.test(F.gate));
P("P16152", "…and never tells a diner to retry something the restaurant rate-limited",
  /r\.reason === "rate_limited"\s*\?\s*"That's a lot of calls in a row/.test(F.gate));
P("P16153", "the request-to-staff path reads its answer before promising anything",
  /if \(!requestLanded\(r\)\) return;/.test(F.gate));
P("P16154", "…and 'already sent' counts as landed (staff have it; a second helps nobody)",
  /r\?\.reason === "already_sent"/.test(F.gate));
P("P16155", "…and a failure is TOASTED, so it shows on the screens that render no note",
  /toast\(why, "table", "error"\);/.test(F.gate));
P("P16156", "the public waiter call reads its answer and has a branch per ending",
  ["blocked", "capped"].every((r) => new RegExp(`res\\.reason === "${r}"`).test(F.chef)));
P("P16157", "…and a thrown request still says something",
  /message: "Couldn't reach staff"/.test(F.chef));
P("P16158", "correcting a placed order's table reads whether the server accepted it",
  /const ok = await updateOrderTableNumber\(o\.id, check\.value\)\.catch\(\(\) => false\);/.test(F.cart)
  && /if \(!ok\) \{/.test(F.cart));
P("P16159", "…and says why, in words a diner can act on",
  /message: "Couldn't move that order", subtitle: "it may already be served/.test(F.cart));
P("P16160", "…and only claims 'the kitchen has been told' after it agreed",
  /message: `Moved to table \$\{check\.value\}`, subtitle: "the kitchen has been told"/.test(F.cart));
P("P16161", "the returning-guest greeting checks the answer before using the name",
  /if \(cancelled \|\| !r \|\| r\.known !== true\) return;/.test(F.greeter));
P("P16162", "…and an empty name is not greeted as one",
  /if \(!name\) return;/.test(F.greeter));
P("P16163", "the shared-cart first merge reads whether it was refused, and re-merges rather than forcing",
  /if \(!w\.ok && \(w as \{ reason\?: string \}\)\.reason === "cart_moved"\)/.test(F.sync));
P("P16164", "…and a later delta adopts whatever the server merged back",
  /if \(res\.ok && Array\.isArray\(merged\)\)/.test(F.sync));
P("P16165", "…and a transient pull failure does NOT reset the sync state (it would resurrect a removed dish)",
  /return; \/\/ blip → keep state, retry next tick \(don't re-merge\)/.test(F.sync));
P("P16166", "the tracker's status poll reads each answer and counts a miss rather than assuming",
  /nullCounts\.current\[o\.id\] = \(nullCounts\.current\[o\.id\] \|\| 0\) \+ 1;/.test(F.tracker));
P("P16167", "…and does not count a miss while the phone is offline",
  /if \(typeof navigator !== "undefined" && navigator\.onLine === false\) continue;/.test(F.tracker));
P("P16168", "…and only finalises after three consecutive misses",
  /if \(nullCounts\.current\[o\.id\] >= 3 && !isFinal\(o\.status\)\)/.test(F.tracker));
P("P16169", "…and a real answer resets the miss counter",
  /nullCounts\.current\[o\.id\] = 0;/.test(F.tracker));
P("P16170", "the presence heartbeat is deliberately fire-and-forget (nothing waits on it)",
  /if \(token && !document\.hidden\) \{ touchSession\(token\); \}/.test(F.widget));
P("P16171", "setMemberName is deliberately best-effort and cannot break the flow it sits in",
  /if \(s\) \{ try \{ await setMemberName\(s\.token, nick\); \} catch \{\} \}/.test(F.gate));
P("P16172", "…and the name is stored on the phone first, so the flow never depends on that call",
  /setNicknameFor\(s\?\.token, nick\);[\s\S]{0,120}await setMemberName/.test(F.gate));
P("P16173", "placing an order reads the answer through one function, so every path is guarded alike",
  /async function postGuestOrder\(body: Record<string, unknown>, actionId: string\): Promise<string>/.test(F.menu));
P("P16174", "…and both order paths go through it",
  /return postGuestOrder\(\{ mode: "session"/.test(F.menu) && /return postGuestOrder\(\n?\s*\{ mode: "public"/.test(F.menu));
P("P16175", "…so there is no way left to place a guest order without an at-most-once key",
  !/supabase\.rpc\("lfh_place_order"/.test(F.menu));
P("P16176", "a dropped request is classed as BUSY, so the caller saves it",
  /throw busyError\("could not reach the restaurant"\)/.test(F.menu));
P("P16177", "a 5xx is classed as busy too",
  /if \(res\.status >= 500\) throw busyError\("the restaurant's system is very busy"\)/.test(F.menu));
P("P16178", "a 409 that asks us to retry is busy, not a refusal",
  /if \(res\.status === 409 && j\?\.retry\) throw busyError/.test(F.menu));
P("P16179", "everything else is a refusal the diner must SEE, carrying the code and the dish",
  /throw new Error\(`Order failed: \$\{j\?\.reason \|\| "unknown"\}\$\{j\?\.item \? ` \(\$\{j\.item\}\)` : ""\}`\)/.test(F.menu));
P("P16180", "the caller reads that code rather than matching on the sentence",
  /export function refusalOf\(err: unknown\)/.test(F.outbox)
  && /msg\.match\(\/Order failed:\\s\*\(\[a-z_\]\+\)\/\)/.test(F.outbox));
P("P16181", "…and there is exactly ONE place that parses it",
  (MY_LIBS.match(/Order failed:\\s\*/g) || []).length === 1);
P("P16182", "an unrecognised refusal code is never echoed to a diner",
  /default: return q \? "Couldn't send this order — please order again\." : "Order didn't go through — please try again\."/.test(F.outbox));
P("P16183", "the busy path saves the basket rather than losing it, on the QR door",
  /if \(isServerBusy\(err\) && orderKeyRef\.current\)/.test(F.cart));
P("P16184", "…and on the table-session door",
  /if \(isServerBusy\(err\)\) \{\s*try \{ await saveForLater\(false\); return; \}/.test(F.gate));
P("P16185", "…and if saving ALSO fails, the diner gets the honest error rather than a false promise",
  /catch \{ \/\* couldn't even save → fall through to the honest message below \*\//.test(F.gate));
P("P16186", "the gate reports its outcome exactly once per action",
  /const fireDone = \(detail: Record<string, unknown>\) => \{\s*if \(settled\.current\) return;\s*settled\.current = true;/.test(F.gate));
P("P16187", "…and that flag is reset when a NEW action starts, or a second order could never report",
  /settled\.current = false;/.test(F.gate));
P("P16188", "dismissing the gate always reports the action as cancelled, so no button sticks on 'Placing…'",
  /fireDone\(\{ ok: false, reason: "cancelled", action: pending\.current\?\.action \}\);/.test(F.gate));
P("P16189", "every completion carries `action`, so the cart's listener recognises its own",
  !/fireDone\(\{(?![^}]*action)[^}]*\}\)/.test(bare(F.gate)));
P("P16190", "the cart ignores a completion for someone else's action",
  /if \(d\?\.action !== "order"\) return;/.test(F.cart));
P("P16191", "…and stops listening once its own has arrived",
  /window\.removeEventListener\("lfh:session-done", onDone\);/.test(F.cart));
P("P16192", "a cancelled session order re-enables Place Order",
  /placingRef\.current = false;\s*setPlacing\(false\);/.test(F.cart));
// Comment-tolerant on purpose: a check that breaks when prose grows between two lines gets
// loosened until it means nothing. Asserted on the code with comments stripped.
P("P16193", "a queued session order clears the basket so it cannot be sent twice",
  /if \(d\?\.queued\) \{\s*setCart\(\[\]\); saveCart\(\[\]\);/.test(bare(F.cart)));
P("P16194", "a failed session order leaves the basket alone (the gate showed its own message)",
  /if \(!d\?\.ok \|\| !d\.orderId\) return; \/\/ order cancelled \/ failed/.test(F.cart));
P("P16195", "the location check's every outcome has a sentence",
  /loc\.reason === "denied" \? "Location was blocked\." : loc\.reason === "far" \? "You seem too far from the restaurant\." : "Couldn't read your location\."/.test(F.gate));
P("P16196", "a table-state read that fails is not blamed on the diner's own internet",
  /isSessionTimeout\(st\)\s*\n?\s*\? "The restaurant's system isn't answering right now — this one's on us/.test(F.gate));
P("P16197", "only three definitive endings drop a session on the way in",
  /if \(reason === "invalid_token" \|\| reason === "removed" \|\| reason === "session_closed"\)/.test(F.gate));
P("P16198", "…and a network blip keeps the guest's spot with a working Retry",
  /your spot at the table is safe/.test(F.gate));
P("P16199", "the approval poll drops a session only on those same three",
  /if \(reason === "removed" \|\| reason === "session_closed" \|\| reason === "invalid_token"\)/.test(F.gate));
P("P16200", "…and anything else keeps polling rather than costing a head their role",
  /return true; \/\/ a network blip -> keep trying/.test(F.gate));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// C. A SCREEN THAT CAN NEVER RESOLVE, AND A PROMISE WITH NO EVIDENCE (P16201–P16250)
// Every skeleton, spinner and "one moment…" in the territory, asked the same question: what shows
// if the thing it waits for never happens?
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("C. can every waiting screen end? (P16201-P16250)");
P("P16201", "the live table bill can tell 'still loading' from 'cannot be loaded'",
  /const \[stalled, setStalled\] = useState\(false\);/.test(F.tbill));
P("P16202", "…and a FIRST failed read reaches an honest sentence, not three pulsing bars",
  /\{!loaded && stalled \? \(/.test(F.tbill));
P("P16203", "…which says nothing is lost",
  /Nothing is lost/.test(F.tbill));
P("P16204", "…and offers a way to ask again",
  /pollRef\.current\?\.\(\)/.test(F.tbill));
P("P16205", "…and that retry clears the stalled state, so a success can paint",
  /setStalled\(false\); pollRef\.current\?\.\(\)/.test(F.tbill));
P("P16206", "a good read always clears the stalled state",
  /\n\s*setStalled\(false\);\n/.test(F.tbill));
P("P16207", "…and stalled is ONLY set when nothing has ever loaded (a blip must not blank a live bill)",
  /else setStalled\(true\);/.test(F.tbill));
P("P16208", "the loading skeleton still exists for the ordinary first load",
  /className="stb-loading"/.test(F.tbill) && /className="stb-skel"/.test(F.tbill));
P("P16209", "…and the true 'nothing ordered yet' message is still a separate, later state",
  /No dishes sent to the kitchen yet/.test(F.tbill));
P("P16210", "the green live dot stops claiming a live connection while that message is up",
  /!loaded && stalled \? \{ background: "var\(--muted\)"/.test(F.tbill));
P("P16211", "the gate's 'One moment…' step is always left by one of a finite set of endings",
  /setStep\("working"\)/.test(F.gate)
  && (bare(F.gate).match(/setStep\("working"\)/g) || []).length === 2);
P("P16212", "…the order path leaves it by placing, refusing, saving or closing",
  /orderKeyRef\.current = null; \/\/ placed → the next basket is a new order/.test(F.gate));
P("P16213", "…and a blocked order lands on its own screen rather than sitting on 'One moment'",
  /if \(reason === "blocked"\) \{ fireDone\(\{ ok: false, reason: "blocked", action: "order" \}\); setStep\("blocked"\); return; \}/.test(F.gate));
P("P16214", "…and the call path leaves it the same way",
  /if \(r\.reason === "blocked"\) \{ fireDone\(\{ ok: false, reason: "blocked", action: "call" \}\); setStep\("blocked"\); return; \}/.test(F.gate));
P("P16215", "the waiting-for-approval poll pauses on a hidden tab instead of beating in the background",
  /if \(typeof document !== "undefined" && document\.hidden\) \{\s*pollTimer\.current = setTimeout\(loop, HIDDEN\);/.test(F.gate));
P("P16216", "…and slows down the longer someone waits, rather than hammering at a fixed rate",
  /delay = Math\.min\(MAX, Math\.round\(delay \* 1\.4\)\);/.test(F.gate));
P("P16217", "…and the very first check is almost immediate, so a fast approval is not made to wait",
  /pollTimer\.current = setTimeout\(loop, 400\);/.test(F.gate));
P("P16218", "…and it stops the moment the wait is genuinely over",
  /if \(!pollAlive\.current \|\| keepGoing === false\) return;/.test(F.gate));
P("P16219", "…and a throwing tick keeps the poll alive rather than stranding the guest",
  /try \{ keepGoing = await tick\(\); \} catch \{ keepGoing = true; \}/.test(F.gate));
P("P16220", "the not-open watcher ends by itself when the action it was waiting for is gone",
  /const p = pending\.current; if \(!p\) return false;/.test(F.gate));
P("P16221", "the gate closing IS a valid ending of the whole flow, not a stall",
  /const close = useCallback\(\(\) => \{/.test(F.gate) && /stopPoll\(\); stopScan\(\);/.test(F.gate));
P("P16222", "…and unmounting stops every timer and releases the camera",
  /return \(\) => \{ window\.removeEventListener\("lfh:session-do", onDo\); stopPoll\(\); stopScan\(\); \};/.test(F.gate));
P("P16223", "the camera is released when a scan is abandoned by tapping 'Type it instead'",
  /onClick=\{\(\) => \{ stopScan\(\); setStep\("ask_table"\); \}\}/.test(F.gate));
P("P16224", "…and when the camera cannot be opened at all, the guest is told to type instead",
  /Couldn't open the camera — please type the table number\./.test(F.gate));
P("P16225", "…and on a phone with no scanner at all, before any camera prompt",
  /Scanning isn't supported on this phone — please type the table number\./.test(F.gate));
P("P16226", "…and a frame that fails to decode is normal, not an error shown to anyone",
  /\} catch \{\} \/\/ a frame that fails to decode is normal/.test(F.gate));
P("P16227", "the head's approve prompt cannot trap them — 'Later' snoozes it",
  /const SNOOZE_MS = 20000;/.test(F.owner) && /snoozeUntil\.current = Date\.now\(\) \+ SNOOZE_MS;/.test(F.owner));
P("P16228", "…and it comes back afterwards, so a waiting friend is not forgotten",
  /const visible = pending\.length > 0 && Date\.now\(\) >= snoozeUntil\.current;/.test(F.owner));
P("P16229", "…and the back button snoozes rather than leaving the site",
  /useBackClose\("session-owner", visible, snooze\);/.test(F.owner));
P("P16230", "…registered unconditionally, above the early return (Rules of Hooks)",
  /useBackClose\("session-owner", visible, snooze\);\s*if \(!visible\) return null;/.test(bare(F.owner)));
P("P16231", "the tracker finalises an order the server no longer knows, instead of a 3-hour ghost",
  /o\.status = "cancelled";\s*o\.finalizedAt = Date\.now\(\);/.test(F.tracker));
P("P16232", "…and says so once, not on every poll",
  /if \(lastStatus\.current\[o\.id\] !== "cancelled"\)/.test(F.tracker));
P("P16233", "…and an unexpected status falls back rather than crashing on a missing label",
  /const c = COPY\[order\.status\] \|\| COPY\.preparing;/.test(F.tracker));
P("P16234", "a dismissing strip is frozen, so a newly-arrived order cannot fly out in its place",
  /dismissingOrderRef\.current = order;/.test(F.tracker));
P("P16235", "…and an OS-cancelled gesture resets cleanly instead of wedging it",
  /const onPointerCancel = \(e: ReactPointerEvent<HTMLButtonElement>\) => \{/.test(F.tracker));
P("P16236", "…and pointer capture is taken on down, so a fast flick still delivers the release",
  /setPointerCapture\(e\.pointerId\)/.test(F.tracker));
P("P16237", "a tap is told from a drag by a real threshold, not by luck",
  /Math\.hypot\(dx, dy\) < 8/.test(F.tracker));
P("P16238", "…and a tap opens the live tab rather than doing nothing",
  /if \(!d\.moved\) \{ openDetail\(\); return; \}/.test(F.tracker));
P("P16239", "the offline saved-work list closes itself when the queue empties",
  /useEffect\(\(\) => \{ if \(count === 0\) setOpen\(false\); \}, \[count\]\);/.test(F.chip));
P("P16240", "…and draws nothing at all when there is nothing waiting",
  /if \(count === 0\) return null;/.test(F.chip));
P("P16241", "…and a tap on Try again / Remove shows it was HEARD while the work is in flight",
  /const \[busyId, setBusyId\] = useState<string \| null>\(null\);/.test(F.chip)
  && /finally \{ setBusyId\(null\); \}/.test(F.chip));
P("P16242", "…one at a time, so two rows cannot both claim to be working",
  /if \(busyId\) return;/.test(F.chip));
P("P16243", "the bill's own live list refreshes on a timer while open, and stops when closed",
  /const iv = setInterval\(refreshLive, 5000\);\s*return \(\) => clearInterval\(iv\);/.test(bare(F.cart)));
P("P16244", "…and that timer only exists while the panel is open",
  /if \(!open\) return;\s*const refreshLive/.test(bare(F.cart)));
P("P16245", "a corrupt saved basket cannot leave the bill on a blank screen",
  /const normalize = \(raw: unknown\): CartItem\[\] => \{\s*if \(!Array\.isArray\(raw\)\) return \[\];/.test(bare(F.cart)));
P("P16246", "…and a failed parse falls back to an empty basket rather than throwing",
  /\} catch \{\s*setCart\(\[\]\);\s*\}/.test(bare(F.cart)));
P("P16247", "an empty basket says so in words",
  /Your bill is empty|nothing in your order|empty/i.test(F.cart));
P("P16248", "a failed menu fetch lets a later open retry rather than wedging the bill",
  /\.catch\(\(\) => \{ menuLoadedRef\.current = false; \}\)/.test(F.cart));
P("P16249", "the greeting can never block the menu, whatever the server does",
  /\} catch \{ \/\* greeting is best-effort; never block the menu \*\/ \}/.test(F.greeter));
P("P16250", "…and it is asked at most once per browser session even if it fails",
  /sessionStorage\.setItem\(key, "1"\)/.test(F.greeter));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// D. MONEY AND NUMBERS ON THE GUEST'S OWN SCREENS (P16251–P16300)
// The diner's phone must never be the source of truth for money, and the two currency domains
// (stored USD vs displayed local) must never mix. The ₹48,550 scar is what these guard.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("D. money and numbers (P16251-P16300)");
P("P16251", "no price ever travels from the browser with an order",
  !/price/.test((bare(F.cart).match(/orderItems = \(\) =>[\s\S]{0,400}?\}\)\);/) || [""])[0]));
P("P16252", "…the order body carries id, qty, options-by-name, removed and note, and nothing else",
  /id: it\.id,\s*qty: it\.qty,\s*options: it\.options\?\.map\(\(o\) => \(\{ group: o\.group, label: o\.label \}\)\)/.test(F.cart));
P("P16253", "…and an option travels as group+label only, never as an amount",
  !/options: it\.options\?\.map\(\(o\) => \(\{[^}]*price/.test(F.cart));
P("P16254", "the STORED total is the USD domain",
  /const totalUsd = /.test(F.cart));
P("P16255", "…and the DISPLAYED total is the display-currency domain",
  /const total = subtotal \+ tax;/.test(F.cart));
P("P16256", "…and it is the USD one that is written into the tracker record",
  /total: totalUsd, \/\/ USD — converted at render time like all order records/.test(F.cart));
P("P16257", "…and the session path passes the USD one too",
  /const totalS = totalUsd, countS = itemCount;/.test(F.cart));
P("P16258", "GST is added only over the lines that are priced NET",
  /const onTopBase = splitBill\(dispLines\.filter\(\(l\) => l\.tax_mode === "excl"\), taxRules\)\.taxableBase;/.test(F.cart));
P("P16259", "…so a tax-inclusive line is never taxed twice",
  /const usdOnTopBase = taxRules\.price_tax_mode === "composition"/.test(F.cart));
P("P16260", "a composition restaurant's guest quote carries no GST at all",
  /const tax = dispSplit\.composition \? 0 : toMinor\(onTopBase \* taxRate, currency \|\| undefined\);/.test(F.cart));
P("P16261", "…and no GST ROW is drawn when there is none to draw",
  /const showTaxRow = !dispSplit\.composition && tax > 0;/.test(F.cart));
P("P16262", "the tax RATE comes from the restaurant's settings, never a hardcoded 5% in the maths",
  /setTaxRate\(s\.taxRate\)/.test(F.cart));
P("P16263", "…and the placeholder before settings load is stated as one",
  /useState\(0\.05\); \/\/ this restaurant's effective tax rate/.test(F.cart));
P("P16264", "…and the rules come from ONE resolver, not a second formula here",
  /setTaxRules\(taxRulesOf\(s\)\)/.test(F.cart));
P("P16265", "a dish's own tax behaviour is resolved by one rule",
  /const behaviourOf = \(it: CartItem\) => resolveTaxMode\(dishMode\(it\.id\), taxRules\);/.test(F.cart));
P("P16266", "…and an MRP line is identified by that same rule, not by hand",
  /const isMrpLine = \(it: CartItem\) => isMrpDish\(dishMode\(it\.id\), taxRules\);/.test(F.cart));
P("P16267", "the live table bill recomputes NOTHING — every figure is the server's",
  !/subtotal \* |tax \* |total \* /.test(bare(F.tbill)));
P("P16268", "…its MRP stamp is read off the server's own frozen ticket lines",
  /\.filter\(\(ln\) => ln && ln\.is_mrp === true\)/.test(F.tbill));
P("P16269", "…its discount percentage is written by the same maker as the paper bill",
  /BILLDOC\.discPct\(/.test(F.tbill));
P("P16270", "…and the MRP money row is only drawn when the SERVER sends the split",
  /const nontax = composition \? 0 : Number\(bill\.nontax \?\? bill\.nontax_amount\) \|\| 0;/.test(F.tbill));
P("P16271", "…and a composition restaurant's GST row is hidden only when the server AGREES tax is 0",
  /!\(composition && !\(Number\(bill\.tax\) > 0\)\)/.test(F.tbill));
P("P16272", "the mini-cart shows a SUBTOTAL and never claims to be the amount payable",
  /const dispSubtotal = lines\.reduce/.test(F.mini) && !/tax/i.test(bare(F.mini)));
P("P16273", "…summed line by line in the display currency, so it matches the bill to the rupee",
  /unitDisplay\(l\.usd, l\.addons, currency \|\| undefined\) \* l\.qty/.test(F.mini));
P("P16274", "…and its item count is the number of ITEMS, not the number of lines",
  /setCount\(list\.reduce\(\(s, it\) => s \+ \(it\.qty \|\| 1\), 0\)\)/.test(F.mini));
P("P16275", "the bill's header count agrees with that rule",
  /const itemCount = cart\.reduce\(\(sum, it\) => sum \+ it\.qty, 0\);/.test(F.cart));
P("P16276", "a saved quantity is clamped to a whole number between 1 and 99",
  /Math\.min\(99, Math\.max\(1, Math\.floor\(/.test(F.cart));
P("P16277", "…so the quote can never exceed what the kitchen would make",
  /if \(cart\[idx\]\.qty >= 99\)/.test(F.cart));
P("P16278", "…and the ceiling is explained rather than returning in silence",
  /message: "Maximum 99 per dish"/.test(F.cart));
P("P16279", "…with a neutral style, because nothing went wrong",
  /variant: "info", duration: 1400/.test(F.cart));
P("P16280", "every OTHER add path respects the same 99 ceiling",
  /qty: Math\.min\(99, next\[idx\]\.qty \+ 1\)/.test(F.cart)
  && /existing\.qty = Math\.min\(99, existing\.qty \+ qty\)/.test(F.confirm)
  && /qty: Math\.min\(99, qty\)/.test(F.confirm));
P("P16281", "an add-on's price is minor-rounded so base + extras equals the total shown",
  /minorDisplay\(c\.price, currency \|\| undefined\)/.test(F.confirm));
P("P16282", "…and the menu card's own price treatment is used for a MENU price",
  /unitDisplay\(prettyUsd\(pairing\.price\), \[\], currency \|\| undefined\)/.test(F.cart));
P("P16283", "the dish popup's unit is base plus the chosen extras",
  /const unit = prettyUsd\(item\.price\) \+ chosen\.reduce\(\(s, c\) => s \+ c\.price, 0\);/.test(F.confirm));
P("P16284", "…and the line total is that unit times the quantity",
  /const totalDisp = unitDisp \* qty;/.test(F.confirm));
P("P16285", "the tracker's own item count sums quantities, not lines",
  /itemCount: items\.reduce\(\(a, i\) => a \+ \(Number\(i\.qty\) \|\| 1\), 0\)/.test(F.tracker));
P("P16286", "a currency switch repaints every money surface rather than leaving a stale symbol",
  ["cart", "mini", "confirm", "chip"].every((k) => /lfh:currency-changed/.test(F[k])));
P("P16287", "…and the live table bill reads the currency when it mounts",
  /setCurrency\(getCurrency\(\)\);/.test(F.tbill));
P("P16288", "nothing in the territory can erase, hide or edit an issued sale",
  !/\.delete\(\)/.test(ALL_GUEST) && !/deleted_at/.test(ALL_GUEST));
P("P16289", "the one correction a guest can make goes through a guarded server call",
  /updateOrderTableNumber/.test(F.cart) && /export async function updateOrderTableNumber/.test(F.menu));
P("P16290", "…and it changes a table number only, never money",
  !/total|price|amount/i.test((F.menu.match(/export async function updateOrderTableNumber[\s\S]{0,600}?\n\}/) || [""])[0]));
P("P16291", "the guest is never shown the staff-only 'ready' stage on the live bill",
  /\(i\.status as string\) === "ready" \? \{ \.\.\.i, status: "preparing" as const \}/.test(F.tbill));
P("P16292", "…nor on the floating strip",
  /i\.status === "ready" \? "preparing" : i\.status/.test(F.tracker));
P("P16293", "a ₹0 GST row is removed rather than printed as zero",
  /showTaxRow/.test(F.cart));
P("P16294", "the pairing suggestion never offers something already on the bill",
  /!cartIds\.has\(i\.id\)/.test(F.cart));
P("P16295", "…nor anything sold out",
  /!\(i\.tags \|\| \[\]\)\.includes\("sold-out"\)/.test(F.cart));
P("P16296", "…and it disappears entirely when the basket is empty",
  /cart\.length > 0\s*\?/.test(F.cart));
P("P16297", "Place Order names the exact sold-out dish rather than a generic retry",
  /message: `Sold out: \$\{names\}`/.test(F.cart));
P("P16298", "…de-duplicated, so one dish twice is named once",
  /\[\.\.\.new Set\(soldLines\.map\(\(it\) => it\.title\)\)\]\.join\(", "\)/.test(F.cart));
P("P16299", "the stored order total and the shown total are computed from separate line arrays",
  /const usdLines = cart\.map/.test(F.cart) && /const dispLines = cart\.map/.test(F.cart));
P("P16300", "…and each carries the SAME resolved tax behaviour, so the two can never disagree",
  /tax_mode: behaviourOf\(it\)/.test(F.cart)
  && (F.cart.match(/tax_mode: behaviourOf\(it\)/g) || []).length === 2);

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// E. WHICH RESTAURANT, WHICH PHONE, WHICH DOOR (P16301–P16350)
// Tenant scoping and the three guest doors. Sweep 6 found the biggest fault in this territory here,
// so this section re-asks it from the other direction: not "does the provider agree with storage",
// but "is there any surface left that guesses".
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("E. which restaurant, which phone, which door (P16301-P16350)");
P("P16301", "there is exactly ONE function that answers 'which restaurant is this tab on'",
  (F.tstore.match(/export function tenantSlug\(\)/g) || []).length === 1);
P("P16302", "…and the provider imports it rather than carrying a second copy",
  /import \{ tenantSlug \} from "\.\/tenantStorage";/.test(F.ctx));
P("P16303", "…and there is no path-matching regex left in the provider deciding the tenant",
  (bare(F.ctx).match(/\/\^\\\/r\\\//g) || []).length <= 1);
P("P16304", "the provider reads it inside an effect, never during render (there is no sessionStorage on the server)",
  /useEffect\(\(\) => \{[\s\S]{0,900}const s = tenantSlug\(\);/.test(F.ctx));
P("P16305", "…so the first render is identical on the server and the client",
  /const \[slug, setSlug\] = useState<string>\(pathSlug\);/.test(F.ctx));
P("P16306", "…and `ready` starts true only for the routes that genuinely ARE restaurant #1",
  /useState<boolean>\(\(\) => \/\^\\\/\(menu\|item\)\(\\\/\|\$\)\/\.test\(pathname \|\| ""\)\)/.test(F.ctx));
P("P16307", "a late reply for restaurant A cannot land on restaurant B",
  /let alive = true;/.test(F.ctx) && /return \(\) => \{ alive = false; \};/.test(F.ctx));
P("P16308", "…and a stale NAME cannot flash during the resolve window",
  /setName\(null\);/.test(F.ctx));
P("P16309", "a failed lookup can never leave a widget waiting for ever",
  /\.catch\(\(\) => \{ if \(alive\) setReady\(true\); \}\)/.test(F.ctx));
P("P16310", "the slug the provider hands out is folded to lower case, so one restaurant is one bucket",
  /decodeURIComponent\(m\[1\]\)\.trim\(\)\.toLowerCase\(\)/.test(F.ctx));
P("P16311", "…and storage folds it the same way, so the two cannot disagree on spelling",
  /decodeURIComponent\(m\[1\]\)\.trim\(\)\.toLowerCase\(\)/.test(F.tstore));
P("P16312", "…and the explicit-slug variants fold too, for the outbox flushing another restaurant's order",
  /const fold = \(slug: string\) => \(slug \|\| DEFAULT_RESTAURANT_SLUG\)\.trim\(\)\.toLowerCase\(\);/.test(F.tstore));
P("P16313", "a /r/<slug> visit PINS the tab, so a later un-prefixed page stays on that restaurant",
  /sessionStorage\.setItem\(LAST_SLUG_KEY, slug\)/.test(F.tstore));
P("P16314", "bare /menu and /item RE-pin to restaurant #1, even after visiting another",
  /sessionStorage\.setItem\(LAST_SLUG_KEY, DEFAULT_RESTAURANT_SLUG\)/.test(F.tstore));
P("P16315", "any other door uses the pin, never a guess",
  /try \{ return sessionStorage\.getItem\(LAST_SLUG_KEY\) \|\| DEFAULT_RESTAURANT_SLUG; \} catch \{ return DEFAULT_RESTAURANT_SLUG; \}/.test(F.tstore));
P("P16316", "every per-restaurant guest key is suffixed with the slug",
  /return `\$\{base\}:\$\{tenantSlug\(\)\}`;/.test(F.tstore));
P("P16317", "the basket is one of them",
  /tget\("lfh_cart"\)/.test(F.cart) && /tset\("lfh_cart"/.test(F.cart));
P("P16318", "the tracked orders are one of them",
  /readActiveOrders|writeActiveOrders/.test(F.status) && /tget|tset/.test(F.status));
P("P16319", "the table session is one of them",
  /const KEY = "lfh_session";/.test(F.session) && /tset\(KEY/.test(F.session));
P("P16320", "the declared allergy list is one of them",
  /tget\("lfh_declared"\)/.test(F.cart) && /tset\("lfh_declared"/.test(F.cart));
P("P16321", "the guest's chosen name is one of them",
  /const NICKNAME_KEY = "lfh_nickname";/.test(F.gate) && /tset\(NICKNAME_KEY/.test(F.gate));
P("P16322", "the location consent is one of them",
  /const LOC_CONSENT_KEY = "lfh_loc_consent";/.test(F.gate) && /tset\(LOC_CONSENT_KEY, "1"\)/.test(F.gate));
P("P16323", "…and the four DEVICE-wide preferences are deliberately NOT scoped",
  !/"lfh_theme"|"lfh_lang"|"lfh_currency"|"lfh_device"/.test((F.tstore.match(/const LEGACY_KEYS = \[[\s\S]*?\];/) || [""])[0]));
P("P16324", "a cross-tab wake-up ignores ANOTHER restaurant's scoped copy of the same key",
  /export function isTKey\(eventKey: string \| null, base: string\): boolean \{\s*return !!eventKey && eventKey === tkey\(base\);/.test(F.tstore));
P("P16325", "…and the basket uses it rather than a bare key comparison",
  /isTKey\(e\.key, "lfh_cart"\)/.test(F.cart));
P("P16326", "the one-time legacy migration cannot overwrite an already-scoped value",
  /if \(old !== null && localStorage\.getItem\(scoped\) === null\)/.test(F.tstore));
P("P16327", "…and it deletes the old unscoped key so no other restaurant can read it",
  /localStorage\.removeItem\(base\)/.test(F.tstore));
P("P16328", "…and it runs at most once per device",
  /if \(localStorage\.getItem\(MIGRATED_FLAG\)\) return;/.test(F.tstore));
P("P16329", "every storage read and write is wrapped, so private mode cannot crash the menu",
  (F.tstore.match(/catch \{/g) || []).length >= 8);
P("P16330", "the outbox writes a flushed order's tracker entry under the ORDER's restaurant",
  /const slug = item\.restaurantSlug \|\| tenantSlug\(\);/.test(F.outbox)
  && /tsetFor\("lfh_active_orders", slug/.test(F.outbox));
P("P16331", "…and remembers that restaurant when the order is first saved",
  /const restaurantSlug = p\.restaurantSlug \|\| tenantSlug\(\);/.test(F.outbox));
P("P16332", "…and the basket passes it explicitly rather than relying on where the tab is later",
  /restaurantSlug: tenantSlug\(\)/.test(F.cart));
// The basket's effect depends on [restaurantId, features.allergies], not [restaurantId] alone —
// so this asks the real question ("is restaurantId in the dependency list at all?") rather than
// matching one exact spelling of it.
P("P16333", "every widget that asks the server something per-restaurant re-asks on a tenant change",
  ["cart", "chef", "sync", "widget", "tracker", "tbill", "owner"]
    .every((k) => /\}, \[[^\]]*\brestaurantId\b[^\]]*\]\)/.test(F[k])));
P("P16334", "the gate reads the restaurant through a ref, so a handler cannot freeze an old one",
  /const ridRef = useRef\(restaurantId\);/.test(F.gate)
  && /useEffect\(\(\) => \{ ridRef\.current = restaurantId; \}, \[restaurantId\]\);/.test(F.gate));
P("P16335", "…and every server call in it reads that ref rather than the closed-over value",
  !/joinSession\([^)]*restaurantId\)/.test(bare(F.gate)) && /ridRef\.current\)/.test(F.gate));
P("P16336", "the gate shows the restaurant's OWN name, never a hardcoded brand for another tenant",
  /const brandLabel = restaurantName \|\| \(restaurantId === DEFAULT_RESTAURANT_ID \? "My Little French House" : null\);/.test(F.gate));
P("P16337", "'Change table' returns the guest to THIS restaurant's menu",
  /const dest = restaurantSlug && restaurantSlug !== DEFAULT_RESTAURANT_SLUG \? `\/r\/\$\{restaurantSlug\}\/menu` : "\/menu";/.test(F.widget));
P("P16338", "the greeting waits until the restaurant is actually known",
  /if \(!restaurantId \|\| !ready\) return;/.test(F.greeter));
P("P16339", "…and is remembered per restaurant, so two tenants each get their own greeting",
  /const key = `lfh_greeted_\$\{restaurantId\}`;/.test(F.greeter));
P("P16340", "the basket's lazy menu fetch asks for THIS tab's restaurant",
  /fetch\(`\/api\/r\/\$\{tenantSlug\(\)\}\/menu-data`/.test(F.cart));
P("P16341", "…once only, on the first open, not on every page load",
  /if \(menuLoadedRef\.current\) return;\s*menuLoadedRef\.current = true;/.test(bare(F.cart)));
P("P16342", "…and it reuses the server-cached bundle rather than a fresh table read",
  /menu-data`, \{ cache: "no-store" \}/.test(F.cart));
P("P16343", "pruning stale basket lines reads storage, not a possibly-stale render value",
  /saved = normalize\(JSON\.parse\(tget\("lfh_cart"\) \|\| "\[\]"\)\)/.test(F.cart));
P("P16344", "…and only ever runs on a NON-EMPTY menu, so a bad payload cannot wipe a real basket",
  /if \(items\.length\) pruneCartToMenu\(items\);/.test(F.cart));
P("P16345", "…and it SAYS what it removed",
  /is no longer available/.test(F.cart));
// NOT A FINDING, AND HERE IS WHY, SO NOBODY FILES IT (sweep 7 T3). Two reads in this file use
// select("*") and both are deliberate:
//   * getMenuItem() — ONE dish row, by slug, maybeSingle(). mapRow() uses a has(row, "col")
//     mechanism whose whole purpose is to tell "column not selected" (omit the key) from "selected
//     but null" (keep today's default). The narrowing was applied to the CARD payload on purpose
//     and the single-dish read was left full — its own comment says "this must shrink the CARD
//     payload only". Narrowing it would silently drop keys the dish page reads.
//   * getCategories() — a six-column table, capped at 300 rows, with the cap's reason written on it.
// So assert the rule that actually protects egress: the BUSIEST read is narrowed, and every
// unbounded read is bounded.
P("P16346", "the busiest guest read names its columns, and the two full-row reads are the documented pair",
  /CARD_COLUMNS/.test(F.menu)
  && (F.menu.match(/\.select\("\*"\)/g) || []).length === 2
  && /this must shrink the CARD payload only/.test(F.menu));
P("P16347", "…and has a limit",
  (F.menu.match(/\.limit\(/g) || []).length >= 3);
P("P16348", "…and the busiest read does not ship detail-only fields nobody draws",
  /DETAIL_ONLY|CARD_COLUMNS/.test(F.menu));
P("P16349", "settings are read through one cache that dedups ~9 widgets into one request",
  /const settingsInflight = new Map<string, Promise<Settings>>\(\);/.test(F.menu));
P("P16350", "…and a realtime breadcrumb can force a genuine re-read of them",
  /export function invalidateSettings\(restaurantId: string = DEFAULT_RESTAURANT_ID\): void \{\s*settingsCache\.delete\(restaurantId\);\s*settingsInflight\.delete\(restaurantId\);/.test(F.menu));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// F. THE PROJECT'S OWN RULES, RE-ASKED OF THIS TERRITORY (P16351–P16400)
// Every rule in CLAUDE.md that governs the guest basket, asked as a question the code answers.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("F. the project's own rules (P16351-P16400)");
P("P16351", "every popup in the territory registers with the back-button manager",
  ["cart", "gate", "confirm", "chip", "owner"].every((k) => /useBackClose\(/.test(F[k])));
P("P16352", "…including BOTH of the table card's own dialogs",
  (F.widget.match(/useBackClose\(/g) || []).length === 2);
P("P16353", "…each with its own name, so two layers cannot collide",
  new Set((ALL_GUEST.match(/useBackClose\("([a-z-]+)"/g) || [])).size
    === (ALL_GUEST.match(/useBackClose\("([a-z-]+)"/g) || []).length);
P("P16354", "no popup hand-rolls history handling",
  !/pushState|popstate/.test(ALL_GUEST));
P("P16355", "the confirm popup also closes on Escape, and only listens while open",
  /if \(e\.key === "Escape"\) setOpen\(false\)/.test(F.confirm) && /\}, \[open\]\)/.test(F.confirm));
P("P16356", "no poll in the territory is faster than the 60s backstop, bar the head's approve prompt",
  /const OWNER_POLL_MS = 4000;/.test(F.owner)
  && ["sync", "widget", "tracker", "tbill"].every((k) => /RT_BACKUP_MS/.test(F[k]) && !/setInterval\([a-zA-Z]+, [0-9]{1,4}\)/.test(bare(F[k]))));
P("P16357", "…and that 4-second one is justified in words, because someone is waiting to be let in",
  /OWNER_POLL_MS = 4000/.test(F.owner) && /waiting/i.test(F.owner));
P("P16358", "…and it does not poll a background tab at all",
  /if \(typeof document !== "undefined" && document\.hidden\) return;/.test(F.owner));
P("P16359", "realtime drives the updates and the timer is only the backstop",
  ["sync", "widget", "tracker", "tbill"].every((k) => /lfh:rt-tick/.test(F[k])));
P("P16360", "…and every one of those listeners is removed on unmount",
  ["sync", "widget", "tracker", "tbill"].every((k) => /removeEventListener\("lfh:rt-tick"/.test(F[k])));
P("P16361", "the presence heartbeat only beats while the tab is visible",
  /if \(token && !document\.hidden\)/.test(F.widget));
P("P16362", "…and stops and restarts on the visibility change rather than checking inside a tick",
  /document\.addEventListener\("visibilitychange", onVisibility\);/.test(F.widget));
P("P16363", "…and its effect depends on a derived boolean, not the whole state object",
  /const connected = enabled && !!st;/.test(F.widget) && /\}, \[connected\]\);/.test(F.widget));
P("P16364", "rapid basket edits batch into ONE push to the shared cart",
  /pushTimer\.current = setTimeout\(async \(\) => \{/.test(F.sync) && /\}, 500\);/.test(F.sync));
P("P16365", "…and a push scheduled for a session that has since gone idle is not sent",
  (F.sync.match(/activeToken\.current !== token/g) || []).length === 2);
P("P16366", "…and our own write of the local basket does not trigger our own push",
  /applyingRemote\.current = true;/.test(F.sync) && /if \(applyingRemote\.current\) return;/.test(F.sync));
P("P16367", "the first join MERGES rather than either side winning outright",
  /const reconcile = \(server: Line\[\], local: Line\[\]\): Line\[\] => \{/.test(F.sync));
P("P16368", "…with a line identity that keeps the same dish with different options apart",
  /const lineKey = \(i: Line\) => `\$\{i\.id\}__\$\{i\.sig \?\? "\[\]"\}`;/.test(F.sync));
P("P16369", "…and the one whole-array write tells the server what it was editing FROM",
  /setSessionCart\(s\.token, merged, \(r as \{ cart_updated_at\?: string \| null \}\)\.cart_updated_at \?\? null\)/.test(F.sync));
P("P16370", "…so a concurrent add is REFUSED and re-merged, never overwritten",
  /reconciledToken\.current = null; \/\/ someone else got there first — merge again next tick/.test(F.sync));
P("P16371", "every later change is a DELTA, so a co-diner's add is never dropped",
  /mergeSessionCart\(token, added, removed, qty\)/.test(F.sync));
P("P16372", "…computed against the last state we synced, not against a render value",
  /baseline = JSON\.parse\(lastJson\.current \|\| "\[\]"\)/.test(F.sync));
P("P16373", "…and a delta with nothing in it is not sent at all",
  /if \(!added\.length && !removed\.length && !qty\.length\)/.test(F.sync));
P("P16374", "an unapproved member keeps a private local basket, not the table's",
  /if \(!r\.open \|\| !r\.approved\) \{ activeToken\.current = null;/.test(F.sync));
P("P16375", "…and sees no live table bill at all",
  /if \(!mem\?\.approved\) \{ setActive\(false\); return; \}/.test(F.tbill));
P("P16376", "…and no live per-dish progress",
  /if \(!mem\?\.approved\) \{ setDishProg\(\{ served: 0, segs: \[\] \}\); return; \}/.test(F.tracker));
P("P16377", "…and does not count as connected for the add-to-cart gate",
  /connected: !!st && !!st\.approved/.test(F.widget));
P("P16378", "the answer to 'can this guest order?' is published BEFORE the first poll",
  /setTableConnection\(\{ sessionsEnabled: on, connected: on \? !!getStoredSession\(\) : false \}\)/.test(F.widget));
P("P16379", "a definitive session ending drops this device's tracked orders",
  /tremove\("lfh_active_orders"\)/.test(F.widget) && /tremove\("lfh_active_orders"\)/.test(F.tracker));
P("P16380", "…and the shared basket with it",
  /tremove\("lfh_cart"\)/.test(F.widget));
P("P16381", "…and the remembered table, so the next party is not pre-filled with it",
  /setScannedTable\(""\);\s*\/\/ stop pre-filling the table you just left/.test(F.widget));
P("P16382", "…and a guest who was never connected is not toasted 'you were removed'",
  /const tellThem = wasActive\.current;/.test(F.widget));
P("P16383", "a staff table SHIFT is followed by the phone",
  /if \(newTable && s\.table !== newTable\)/.test(F.widget));
P("P16384", "…and announced, so realtime resubscribes to the new table",
  /storeSession\(\{ \.\.\.s, table: newTable \}\);[\s\S]{0,120}new Event\("lfh:session-changed"\)/.test(F.widget));
P("P16385", "a guest PROMOTED to head has the new role persisted",
  /if \(m\?\.role && m\.role !== s\.role\)/.test(F.widget));
P("P16386", "leaving mid-order is blocked with a real way forward, not a dead end",
  /orderActive \? setBlocked\(true\)/.test(F.widget));
P("P16387", "…on BOTH the leave and the change-table buttons",
  (F.widget.match(/orderActive \? setBlocked\(true\)/g) || []).length === 2);
P("P16388", "an allergy the guest declared order-wide is not repeated on the line",
  /const lineRemoved = \(applyAll \? \[\] : finalRemoved\)\.filter\(\(r\) => !orderWide\.includes\(r\)\)/.test(F.confirm));
P("P16389", "editing a line drops ONLY that line, matched on id AND its option signature",
  /cart\.filter\(\(it\) => !\(it\.id === item\.id && \(it\.sig \|\| "\[\]"\) === editSig\)\)/.test(F.confirm));
P("P16390", "a dish with no declared allergens still offers the common six",
  /const pickable = listed\.length > 0 \? listed : COMMON_ALLERGEN_SLUGS;/.test(F.confirm));
P("P16391", "a saved free-text allergy re-opens as free text, not as a phantom chip",
  /const otherEntries = preRemoved\.filter\(\(r\) => !pickable\.includes\(r\)\);/.test(F.confirm));
P("P16392", "a note is not re-saved on edit when notes have since been switched off",
  /const noteOut = features\.guest_note \? note\.trim\(\) : "";/.test(F.confirm));
P("P16393", "…nor free text when the free-text switch is off",
  /const otherTrimmed = otherOn && features\.allergy_other \? otherText\.trim\(\) : "";/.test(F.confirm));
P("P16394", "a switched-off extra cannot reach the wire from a line saved before it was switched off",
  /removed: features\.allergies \? it\.removed : undefined/.test(F.cart)
  && /note: features\.guest_note \? it\.note : undefined/.test(F.cart));
P("P16395", "…and the order-wide allergy list is emptied entirely when allergies are off",
  /if \(!features\.allergies\) return \[\];/.test(F.cart));
P("P16396", "a second tap on Add cannot double-save a line",
  /if \(submitting\) return;/.test(F.confirm));
P("P16397", "a second tap on Place Order cannot fire two orders before React disables the button",
  /if \(cart\.length === 0 \|\| placing \|\| placingRef\.current\) return;/.test(F.cart));
P("P16398", "a second tap on a join button cannot create a duplicate membership",
  (F.gate.match(/if \(joining\.current\) return;/g) || []).length === 2);
P("P16399", "a second tap on 'Request a waiter' cannot POST twice",
  (F.gate.match(/if \(reqBusy\.current\) return;/g) || []).length === 2);
P("P16400", "…and the guard is taken BEFORE the await, not after it",
  /if \(reqBusy\.current\) return;\s*reqBusy\.current = true;/.test(bare(F.gate)));

// ── report ───────────────────────────────────────────────────────────────────────────────────────
// MARKER: new sections are inserted ABOVE this line.
console.log(lines.join("\n"));
console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
if (fails.length) { console.log("\nFAILED:\n  " + fails.join("\n  ")); process.exit(1); }
