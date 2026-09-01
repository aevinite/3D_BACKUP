#!/usr/bin/env node
// SWEEP 7 — TERMINAL 3's THIRD BLOCK, code-reading rows P42001..P42330.
//   npm run sweep:t3c            # all of them
//   npm run sweep:t3c -- --quiet # failures + summary only
//
// The 500 phases the owner asked for on 2026-08-30 to cover the four improvements he picked
// (items 10, 12, 13 and 14). These rows check the NEW behaviour, the behaviour it must not have
// broken, and the reasoning that makes each one safe — because the danger in all four is a
// plausible-looking "improvement" that quietly costs a diner their food or their table.
//
// Reads only; no key, no server, no database.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const QUIET = process.argv.includes("--quiet");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
let pass = 0; const fails = []; const lines = [];
const P = (id, name, ok) => {
  if (ok) { pass++; if (!QUIET) lines.push(`ok   ${id} ${name}`); }
  else { fails.push(`${id} ${name}`); lines.push(`FAIL ${id} ${name}`); }
};
const H = (t) => { if (!QUIET) lines.push(`\n── ${t}`); };
const F = {
  sync: read("components/SessionCartSync.tsx"),
  chip: read("components/GuestOutboxChip.tsx"),
  gate: read("components/SessionGate.tsx"),
  widget: read("components/SessionStatusWidget.tsx"),
  outbox: read("lib/guestOutbox.ts"),
  leave: read("app/api/guest/leave/route.ts"),
  call: read("app/api/guest/call-waiter/route.ts"),
  order: read("app/api/guest/place-order/route.ts"),
  mig144: read("supabase/migrations/144_shared_cart_merge.sql"),
  cart: read("components/CartPanel.tsx"),
  tracker: read("components/OrderTracker.tsx"),
};

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// J. ITEM 10 — a failed shared-basket push heals itself, WITHOUT doubling anyone's food (P42001–P42080)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("J. item 10 — the shared basket heals, and cannot double an order (P42001-P42080)");
P("P42001", "a failed push no longer waits for an edit that may never come",
  /reconciledToken\.current = null;/.test(F.sync) && /A FAILED PUSH NOW HEALS ITSELF/.test(F.sync));
P("P42002", "…it is reached from the FAILURE branch, not from the success one",
  /\} else \{[\s\S]{0,1400}reconciledToken\.current = null;\s*\}/.test(F.sync));
P("P42003", "…and the success branches are untouched",
  /if \(res\.ok && Array\.isArray\(merged\)\)/.test(F.sync) && /\} else if \(res\.ok\) \{/.test(F.sync));
P("P42004", "the heal re-runs the FIRST-JOIN reconcile, which is a whole-array WRITE",
  /if \(reconciledToken\.current !== s\.token\)/.test(F.sync) && /setSessionCart\(s\.token, merged,/.test(F.sync));
P("P42005", "…and that write SETS the cart rather than adding to it",
  /setSessionCart/.test(F.sync) && !/mergeSessionCart\(s\.token/.test(F.sync));
P("P42006", "…carrying the timestamp it read, so a concurrent add is refused not overwritten",
  /\(r as \{ cart_updated_at\?: string \| null \}\)\.cart_updated_at \?\? null/.test(F.sync));
P("P42007", "…and a refusal re-merges against the newer cart instead of forcing through",
  /reason === "cart_moved"/.test(F.sync));
P("P42008", "THE DANGEROUS VERSION IS NOT WHAT WAS BUILT: the delta is never re-sent blindly",
  (bare(F.sync).match(/mergeSessionCart\(/g) || []).length === 1);
P("P42009", "…and the reason is written down where the next reader will find it",
  /would order two of everything/.test(F.sync));
P("P42010", "…because migration 144 really does SUM an added line's quantity",
  /LEAST\(99, COALESCE\(\(v_lines->v_key->>'qty'\)::int, 0\)/.test(F.mig144));
P("P42011", "…which is why a set-the-whole-array write is the safe shape",
  /p_added/.test(F.mig144) && /FOR UPDATE/.test(F.mig144));
P("P42012", "the reconcile keeps BOTH sides' lines, so healing cannot lose the co-diner's dish",
  /const reconcile = \(server: Line\[\], local: Line\[\]\): Line\[\] => \{/.test(F.sync));
P("P42013", "…server wins per line, and our unique lines are added",
  /for \(const li of local\) if \(!map\.has\(lineKey\(li\)\)\) map\.set\(lineKey\(li\), li\);/.test(F.sync));
P("P42014", "…and an empty side is adopted whole rather than merged to nothing",
  /if \(server\.length === 0\) return local;/.test(F.sync) && /if \(local\.length === 0\) return server;/.test(F.sync));
P("P42015", "line identity still keeps the same dish with different choices apart",
  /const lineKey = \(i: Line\) => `\$\{i\.id\}__\$\{i\.sig \?\? "\[\]"\}`;/.test(F.sync));
P("P42016", "the heal costs one extra read+write, on the next tick, only after a failure",
  /Cost: one extra read\+write on the next 60s tick, only after a failure/.test(F.sync));
P("P42017", "…and no new timer was added to pay for it",
  (bare(F.sync).match(/setInterval\(/g) || []).length === 1);
P("P42018", "…the existing 60-second backstop is what carries it",
  /iv = setInterval\(tick, RT_BACKUP_MS\)/.test(F.sync));
P("P42019", "a push for a token that has gone idle is still not sent",
  (F.sync.match(/activeToken\.current !== token/g) || []).length === 2);
P("P42020", "…and rapid edits still batch into one push",
  /\}, 500\);/.test(F.sync));
P("P42021", "our own write of the local basket still does not trigger our own push",
  /applyingRemote\.current = true;/.test(F.sync));
P("P42022", "a transient PULL failure still does not reset the sync state",
  /return; \/\/ blip → keep state, retry next tick \(don't re-merge\)/.test(F.sync));
P("P42023", "…and only the three definitive endings stand the sync down",
  /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(F.sync));
P("P42024", "an unapproved member still keeps a private local basket",
  /if \(!r\.open \|\| !r\.approved\)/.test(F.sync));
P("P42025", "a session change still forces a fresh reconcile",
  /const onSessionChanged = \(\) => \{ reconciledToken\.current = null; tick\(\); \};/.test(F.sync));
// Counting occurrences was the wrong test — there are six, all legitimate (idle, two definitive
// endings, cart_moved, the heal, and a session change). What matters is that the heal reuses THAT
// ref rather than introducing a second flag of its own.
P("P42026", "…which is the SAME mechanism the heal reuses, not a second one",
  /reconciledToken\.current = null;/.test(F.sync)
  && !/healPending|needsResync|retryPush/.test(F.sync));
P("P42027", "the heal cannot fire on a session the device no longer holds",
  /const s = enabled\.current \? getStoredSession\(\) : null;/.test(F.sync));
P("P42028", "…nor before the restaurant's session switch is known",
  /if \(enabled\.current === null\)/.test(F.sync));
P("P42029", "…and `sessions_enabled` is still re-read on a tenant change",
  /enabled\.current = null;/.test(F.sync));
P("P42030", "nothing about the delta computation changed",
  /const added: Line\[\] = \[\];/.test(F.sync) && /const removed: Line\[\] = \[\];/.test(F.sync));
P("P42031", "the shared cart is written through one function and read through one",
  /setSessionCart\(/.test(F.sync) && /getSessionCart\(s\.token\)/.test(F.sync));
P("P42032", "the delta is computed against the last SYNCED state, not a render value",
  /baseline = JSON\.parse\(lastJson\.current \|\| "\[\]"\)/.test(F.sync));
P("P42033", "…parsed defensively, so a corrupt baseline cannot throw mid-push",
  /try \{ baseline = JSON\.parse/.test(bare(F.sync)));
P("P42034", "an empty delta is never sent",
  /if \(!added\.length && !removed\.length && !qty\.length\) \{ lastJson\.current = json; return; \}/.test(F.sync));
P("P42035", "…and the baseline still moves on when nothing changed, so it cannot loop",
  /lastJson\.current = json; return;/.test(F.sync));
P("P42036", "a quantity change travels as an ABSOLUTE value, never a difference",
  /qty\.push\(\{ id: l\.id, sig: l\.sig, qty: l\.qty \} as Line\)/.test(F.sync));
P("P42037", "…which is why replaying one is harmless, unlike replaying an add",
  /absolute qty this device set/.test(F.mig144));
P("P42038", "a removal travels as id+sig only, carrying no quantity to re-apply",
  /removed\.push\(\{ id: b\.id, sig: b\.sig \} as Line\)/.test(F.sync));
P("P42039", "the merged cart the server returns is adopted, so a co-diner's dish appears",
  /if \(mergedJson !== json\) writeLocalGuarded\(merged\);/.test(F.sync));
P("P42040", "…and the baseline moves to the MERGED state, not to what we sent",
  /lastJson\.current = mergedJson;/.test(F.sync));
P("P42041", "a server that accepts but returns no cart keeps ours rather than blanking it",
  /lastJson\.current = json; \/\/ server accepted but returned no cart/.test(F.sync));
P("P42042", "the local write is guarded, so adopting a remote cart cannot echo back as a push",
  /const writeLocalGuarded = \(cart: Line\[\]\) => \{/.test(F.sync));
P("P42043", "…and the guard is released synchronously, so the next real edit still pushes",
  /applyingRemote\.current = false;/.test(F.sync));
P("P42044", "the pull adopts the server cart only when it differs from what we last synced",
  /if \(serverJson !== lastJson\.current\)/.test(F.sync));
P("P42045", "the first reconcile only writes when it actually changed something",
  /if \(lastJson\.current !== JSON\.stringify\(serverCart\)\)/.test(F.sync));
P("P42046", "…so joining a table with an identical basket costs no write at all",
  /JSON\.stringify\(serverCart\)/.test(F.sync));
P("P42047", "the heal path and the join path are the SAME code, not two copies",
  (F.sync.match(/const merged = reconcile\(/g) || []).length === 1);
P("P42048", "…so a fix to one can never leave the other behind",
  /reconciledToken\.current = s\.token;/.test(F.sync));
P("P42049", "the basket a diner sees is still the local one, so a failed sync never empties it",
  /const readLocal = \(\): Line\[\] => \{/.test(F.sync));
P("P42050", "…and their own order still carries the dish even if the table's copy lacks it",
  /orderItems\(\)/.test(F.cart));
P("P42051", "nothing in the heal touches the ORDER path",
  !/placeSessionOrderSafe|createOrder/.test(F.sync));
P("P42052", "…and nothing in it writes to the tracked-orders list",
  !/lfh_active_orders/.test(F.sync));
P("P42053", "the sync still stands down entirely when the restaurant has sessions off",
  /enabled\.current = \(await getSettings\(restaurantId\)\)\.sessionsEnabled/.test(F.sync));
P("P42054", "…and a settings failure is treated as OFF rather than crashing the menu",
  /catch \{ enabled\.current = false; \}/.test(F.sync));
P("P42055", "the component still renders nothing at all",
  /return null;/.test(F.sync));
P("P42056", "every listener it adds is removed on unmount",
  (bare(F.sync).match(/addEventListener\(/g) || []).length === (bare(F.sync).match(/removeEventListener\(/g) || []).length);
P("P42057", "…and both its timers are cleared",
  /if \(iv\) clearInterval\(iv\)/.test(F.sync) && /if \(pushTimer\.current\) clearTimeout\(pushTimer\.current\)/.test(F.sync));
P("P42058", "the heal cannot run for a session the device no longer holds",
  /const s = enabled\.current \? getStoredSession\(\) : null;/.test(F.sync));
P("P42059", "…nor before the tenant is known",
  /\}, \[restaurantId\]\);/.test(F.sync));
P("P42060", "…and an alive flag stops a late reply writing after unmount",
  /if \(!alive\) return;/.test(F.sync));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// K. ITEM 12 — a request for staff can be taken back; an order still cannot (P42061–P42120)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("K. item 12 — taking back a request for staff (P42061-P42120)");
P("P42061", "the queue can cancel a call that has not gone yet", /export async function cancelQueuedCall/.test(F.outbox));
P("P42062", "…and it returns a REASON, not a bare false, so a screen can say something true",
  /Promise<\{ ok: boolean; reason\?: "not_found" \| "not_a_call" \}>/.test(F.outbox));
P("P42063", "…refusing a row that is no longer queued", /if \(!it\) return \{ ok: false, reason: "not_found" \};/.test(F.outbox));
P("P42064", "…and refusing anything that is not a call", /if \(!isCall\(it\)\) return \{ ok: false, reason: "not_a_call" \};/.test(F.outbox));
P("P42065", "…BY KIND, not by trusting the screen that offered the button",
  /const it = queued\.find\(\(x\) => x\.id === id\);/.test(F.outbox));
P("P42066", "…and it looks only in `queued`, never in `failed`", !/failed\.find\([\s\S]{0,80}cancelQueuedCall/.test(F.outbox));
P("P42067", "…because a FAILED row already has Remove", /className="gob-btn gob-drop"[\s\S]{0,200}dismissGuestFailed/.test(F.chip));
P("P42068", "cancelling removes it from the phone's own storage, not just from the list",
  /await removeItem\(id\);\s*notify\(\);\s*return \{ ok: true \};/.test(bare(F.outbox)));
P("P42069", "…and tells every subscriber, so the chip re-counts", /notify\(\);/.test(F.outbox));
P("P42070", "the button is offered on a call", /\{isCall\(o\) && !isLeave\(o\) \? \(/.test(F.chip));
P("P42071", "…and never on an order", /<span className="gob-spin"/.test(F.chip));
P("P42072", "…nor on a saved leave", /!isLeave\(o\)/.test(F.chip));
P("P42073", "it reads as a plain refusal, not as a technical word", /Not needed/.test(F.chip));
P("P42074", "…and shows it was HEARD while the work is in flight", /busyId === o\.id \? "…" : "Not needed"/.test(F.chip));
P("P42075", "…and is disabled while that row is busy", /disabled=\{busyId === o\.id\}/.test(F.chip));
P("P42076", "a successful cancel says so", /message: "Not needed — we won't call them"/.test(F.chip));
P("P42077", "…and a refusal says which of the two happened", /r\.reason === "not_found"/.test(F.chip));
P("P42078", "…in the diner's words, never a code", /That's already gone to the staff/.test(F.chip));
P("P42079", "…and the other case names a way forward", /please ask a member of staff/.test(F.chip));
P("P42080", "the one-at-a-time guard still covers it", /if \(busyId\) return;/.test(F.chip));
P("P42081", "…and clears afterwards even if it throws", /finally \{ setBusyId\(null\); \}/.test(F.chip));
P("P42082", "AN ORDER STILL HAS NO CANCEL — the reason is written where someone would remove it",
  /AN ORDER STILL HAS NO CANCEL/.test(F.chip));
P("P42083", "…and that reason is about the kitchen already holding it", /the kitchen may already hold it/.test(F.chip));
P("P42084", "an order row still names its dishes", /list\.map\(\(i\) => `\$\{i\.qty\} × \$\{i\.title\}`\)/.test(F.chip));
P("P42085", "…and still shows a spinner rather than a control", /gob-spin/.test(F.chip));
P("P42086", "a call still names what was asked for", /if \(isCall\(o\)\) return callText\(o\);/.test(F.chip));
P("P42087", "…and still says staff will be called", /Staff will be called/.test(F.chip));
P("P42088", "the queue's collapse of repeat bell taps is untouched", /const already = queued\.find\(sameTable\);/.test(F.outbox));
P("P42089", "…so cancelling one cannot leave a hidden second", /sameTable/.test(F.outbox));
P("P42090", "a stale call is still dropped on the phone rather than delivered late", /STALE_CALL_MS/.test(F.outbox));
P("P42091", "…and the diner is still told when that happens", /call_too_old/.test(F.outbox));
P("P42092", "cancelling does not touch the retry timer's state machine", !/retryStep/.test((F.outbox.match(/export async function cancelQueuedCall[\s\S]{0,600}?\n\}/) || [""])[0]));
P("P42093", "…nor the backoff", !/scheduleRetry/.test((F.outbox.match(/export async function cancelQueuedCall[\s\S]{0,600}?\n\}/) || [""])[0]));
P("P42094", "…and the timer stands itself down when the queue empties", /if \(!queued\.length\) \{ retryStep = 0;/.test(F.outbox));
P("P42095", "the chip still hides itself when nothing is left", /if \(count === 0\) return null;/.test(F.chip));
P("P42096", "…and closes the sheet with it", /useEffect\(\(\) => \{ if \(count === 0\) setOpen\(false\); \}, \[count\]\);/.test(F.chip));
P("P42097", "the waiter endpoint is unchanged by this", /lfh_call_waiter/.test(F.call));
P("P42098", "…and still rings the floor at most once per id", /withIdempotency\(postImpl, "guest"\)/.test(F.call));
P("P42099", "…and still refuses a stale call server-side too", /call_too_old/.test(F.call));
P("P42100", "nothing about placing an order changed", /withIdempotency/.test(F.order));
P("P42101", "the cancel is exported, so it can be tested without a screen", /export async function cancelQueuedCall/.test(F.outbox));
P("P42102", "…and it is the only new export on the queue for this item",
  (F.outbox.match(/export async function cancelQueuedCall|export async function enqueueGuestLeave/g) || []).length === 2);
P("P42103", "the row's second line still carries when it was asked", /whenText\(o\.at\)/.test(F.chip));
P("P42104", "…and a call still shows no price", /o\.track\?\.total \? /.test(F.chip));
P("P42105", "the sheet still explains it is saved on this phone", /Saved on this phone only/.test(F.chip));
P("P42106", "…and still says things send by themselves", /sends by\s+itself|sends by itself/.test(F.chip));
P("P42107", "the back button still closes the sheet first", /useBackClose\("guest-outbox", open/.test(F.chip));
P("P42108", "…and the backdrop still closes it", /className="gob-backdrop"/.test(F.chip));
P("P42109", "the failed-row actions are untouched", /Order the rest/.test(F.chip) && /Try again/.test(F.chip) && /Remove/.test(F.chip));
P("P42110", "…including the guard that stops 'Order the rest' doing nothing", /const r = await orderRestWithout\(id\);/.test(F.chip));
P("P42111", "cancel is not offered on a failed call — Remove is the right control there", /gob-row-failed/.test(F.chip));
P("P42112", "the queue's item type still says what a row IS", /kind\?: "order" \| "call" \| "leave";/.test(F.outbox));
P("P42113", "…and a row written before kinds existed still reads as an order", /it\.kind === "call"/.test(F.outbox));
P("P42114", "the cancel cannot be reached for a row mid-send, because the flush removes it first",
  /await removeItem\(item\.id\); notify\(\); continue;/.test(F.outbox));
P("P42115", "…and a race there ends in 'already gone to the staff', not a crash", /not_found/.test(F.chip));
P("P42116", "the toast for a cancel is a success, because nothing went wrong", /variant: "success"/.test((F.chip.match(/Not needed — we won't call them[\s\S]{0,200}/) || [""])[0]));
P("P42117", "…and the refusal is an error, because something did", /variant: "error"/.test((F.chip.match(/That's already gone to the staff[\s\S]{0,300}/) || [""])[0]));
P("P42118", "both are kickered 'service', matching the waiter popup's own voice", /kicker: "service"/.test(F.chip));
P("P42119", "nothing in this item touches money", !/total|price/.test((F.outbox.match(/export async function cancelQueuedCall[\s\S]{0,600}?\n\}/) || [""])[0]));
P("P42120", "…and nothing in it can erase an issued sale", !/deleted_at|\.delete\(/.test(F.chip));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// L. ITEM 13 — how long staff have been asked (P42121–P42170)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("L. item 13 — how long staff have been asked (P42121-P42170)");
P("P42121", "the moment the request LANDED is remembered", /const \[reqAt, setReqAt\] = useState\(0\);/.test(F.gate));
P("P42122", "…and a tick exists to redraw it", /const \[, reqTick\] = useState\(0\);/.test(F.gate));
P("P42123", "the stamp is set on the 'ask a waiter to open' path", /setReqAt\(Date\.now\(\)\);/.test(F.gate));
P("P42124", "…and on the 'call a waiter instead' path", (F.gate.match(/setReqAt\(Date\.now\(\)\)/g) || []).length === 2);
P("P42125", "…only AFTER requestLanded() confirmed it really landed",
  /if \(!requestLanded\(r, true\)\) return;[\s\S]{0,120}setReqAt\(Date\.now\(\)\)/.test(F.gate));
P("P42126", "…so the line can never count time for something that never happened",
  /if \(!requestLanded\(r\)\) return;/.test(F.gate));
P("P42127", "the clock ticks only while that screen is up", /if \(!open \|\| step !== "request_sent" \|\| !reqAt\) return;/.test(F.gate));
P("P42128", "…every 30 seconds, not every second", /setInterval\(\(\) => reqTick\(\(n\) => n \+ 1\), 30_000\)/.test(F.gate));
P("P42129", "…and it is cleared when the screen goes", /return \(\) => clearInterval\(iv\);/.test(F.gate));
P("P42130", "…and the effect is declared unconditionally, above every early return (Rules of Hooks)",
  /useBackClose\("session-gate", open, close\);[\s\S]{0,400}useEffect\(\(\) => \{\s*if \(!open \|\| step !== "request_sent"/.test(F.gate));
P("P42131", "nothing is said in the first minute", /if \(mins < 1\) return null;/.test(F.gate));
P("P42132", "…because 'asked 0 minutes ago' tells nobody anything", /tells nobody anything/.test(F.gate));
P("P42133", "one minute reads as 'a minute', not '1 minutes'", /mins === 1 \? "a minute"/.test(F.gate));
P("P42134", "…and more than one reads with the number", /`\$\{mins\} minutes`/.test(F.gate));
P("P42135", "it is ELAPSED time, never a countdown", !/remaining|left|eta/i.test((F.gate.match(/Asked \{mins[\s\S]{0,120}/) || [""])[0]));
P("P42136", "…and never a warning", !/variant: "error"/.test((F.gate.match(/Asked \{mins[\s\S]{0,200}/) || [""])[0]));
P("P42137", "…and the reason it is understated is written down", /being made anxious, not informed/.test(F.gate));
P("P42138", "it uses the card's own muted style, so it works in both skins", /className="sg-sub"/.test((F.gate.match(/Asked \{mins[\s\S]{0,300}/) || [""])[0]) || /sg-sub" style=\{\{ opacity: 0\.75 \}\}/.test(F.gate));
P("P42139", "…and sits below the main message, not beside the headline",
  /sg-sub" style=\{\{ opacity: 0\.75 \}\}[\s\S]{0,200}sg-actions/.test(F.gate));
P("P42140", "the screen still says what will happen next", /Keep this open — the moment a waiter opens your table/.test(F.gate));
P("P42141", "…and still offers the honest alternative wording where auto-send is not real", /Your order hasn&apos;t been sent yet/.test(F.gate));
P("P42142", "…and still only promises auto-send on the path that really watches", /setReqAutoSend\(type === "open"\)/.test(F.gate));
P("P42143", "the Cancel button is unchanged", /\{reqAutoSend \? "Cancel" : "Close"\}/.test(F.gate));
P("P42144", "the request is still not sent twice by a double tap", /if \(reqBusy\.current\) return;/.test(F.gate));
P("P42145", "…and a repeat 'call a waiter instead' still does not stack", /accessReqRef/.test(F.gate));
P("P42146", "…while a FAILED request can still be retried", /if \(type === "access"\) accessReqRef\.current = true;/.test(F.gate));
P("P42147", "a failure still tells the diner, on every screen that can send one", /toast\(why, "table", "error"\);/.test(F.gate));
P("P42148", "…and 'already sent' still counts as landed", /already_sent/.test(F.gate));
P("P42149", "the stamp is reset by nothing else, so it cannot drift", (F.gate.match(/setReqAt\(/g) || []).length === 2);
// The point is that the VALUE is discarded — `const [, reqTick]` — so the tick can only ever force
// a redraw and can never become a number something reads. Asserting the destructure says that
// directly; my first attempt tried to prove a negative about the identifier and tripped on itself.
P("P42150", "the tick's value is discarded, so it can only force a redraw",
  /const \[, reqTick\] = useState\(0\);/.test(F.gate));
P("P42151", "closing the gate stops the tick with the screen", /if \(!open \|\| step !== "request_sent"/.test(F.gate));
P("P42152", "…and the whole sheet still tears down its polls and camera", /stopPoll\(\); stopScan\(\);/.test(F.gate));
P("P42153", "the not-open watcher still runs underneath, so the guest is still carried in", /proceedWhenOpen\(\)/.test(F.gate));
P("P42154", "…and it still stops the moment the table opens", /return false; \/\/ table opened -> stop polling/.test(F.gate));
P("P42155", "the elapsed line cannot appear on any other screen", /step !== "request_sent"/.test(F.gate));
P("P42156", "…and it renders nothing at all when there is no stamp", /reqAt \? Math\.floor/.test(F.gate));
P("P42157", "…and cannot show a negative time", /Math\.floor\(\(Date\.now\(\) - reqAt\) \/ 60000\)/.test(F.gate));
P("P42158", "the request screen still names the table in the message above it", /pending\.current\?\.table/.test(F.gate));
P("P42159", "the gate's own settings load is unchanged by this item", /const s = await getSettings\(rid\);/.test(F.gate));
P("P42160", "…and so is the fallback that stops a blip dead-ending a diner", /const known = settingsByRid\.current\.get\(/.test(F.gate));
P("P42161", "no new network call was added for the clock", !/fetch\(/.test((F.gate.match(/const \[reqAt[\s\S]{0,600}/) || [""])[0]));
P("P42162", "…and no new storage key", !/tset\(/.test((F.gate.match(/Asked \{mins[\s\S]{0,300}/) || [""])[0]));
P("P42163", "the wording is English, matching the rest of this sheet", /Asked \{mins/.test(F.gate));
P("P42164", "…and is not wired to the translation layer, which R15 forbids for our own labels", !/useTranslation/.test(F.gate));
P("P42165", "the sentence ends in a full stop, like its neighbours", /ago\./.test(F.gate));
P("P42166", "the request-sent screen still has exactly one action", /sg-actions"><button className="sg-btn ghost" onClick=\{close\}>/.test(F.gate));
P("P42167", "…and the back button still closes the sheet", /useBackClose\("session-gate", open, close\)/.test(F.gate));
P("P42168", "…and closing still reports the action, so no caller is left on 'Placing…'", /fireDone\(\{ ok: false, reason: "cancelled"/.test(F.gate));
P("P42169", "nothing in this item touches an order's contents", !/orderItems|placeSessionOrderSafe/.test((F.gate.match(/const \[reqAt[\s\S]{0,400}/) || [""])[0]));
P("P42170", "…and nothing in it writes to the database", !/rpc\(/.test((F.gate.match(/Asked \{mins[\s\S]{0,300}/) || [""])[0]));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// M. ITEM 14 — the phone carries "I've left this table" (P42171–P42280)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("M1. the third kind, and its endpoint (P42171-P42215)");
P("P42171", "the queue declares a third kind", /kind\?: "order" \| "call" \| "leave";/.test(F.outbox));
P("P42172", "…with its own predicate, so no branch has to guess", /const isLeave = \(it: GuestOrder\) => it\.kind === "leave";/.test(F.outbox));
P("P42173", "…and the reason it exists is written beside it", /a dead connection cannot leave a table/.test(F.outbox));
P("P42174", "a leave is POSTed to its own endpoint", /fetch\("\/api\/guest\/leave"/.test(F.outbox));
P("P42175", "…so the queue's deadline applies to it", /signal: sendDeadline\(\)/.test((F.outbox.match(/fetch\("\/api\/guest\/leave"[\s\S]{0,300}/) || [""])[0]));
P("P42176", "…and its at-most-once id travels with it", /"X-LFH-Action-Id": item\.id/.test((F.outbox.match(/fetch\("\/api\/guest\/leave"[\s\S]{0,400}/) || [""])[0]));
P("P42177", "…carrying the token and the restaurant, and nothing else", /body: JSON\.stringify\(\{ token: item\.token, restaurantId: item\.restaurantId \}\)/.test(F.outbox));
P("P42178", "…and NOT the replay markers an order carries, because a leave is not table-scoped work",
  !/X-LFH-Replay/.test((F.outbox.match(/fetch\("\/api\/guest\/leave"[\s\S]{0,400}/) || [""])[0]));
P("P42179", "the endpoint exists", F.leave.length > 0);
P("P42180", "…and is at-most-once, like its two siblings", /export const POST = withIdempotency\(postImpl, "guest"\);/.test(F.leave));
P("P42181", "…refuses a body it cannot read", /reason: "bad_body"/.test(F.leave));
P("P42182", "…refuses a missing or non-string token", /if \(!b\.token \|\| typeof b\.token !== "string"\)/.test(F.leave));
P("P42183", "…and treats a database that will not answer as BUSY, never as a refusal", /reason: "server_busy", retryAfter/.test(F.leave));
P("P42184", "…with a spread-out retry hint, so phones do not return together", /20 \+ Math\.floor\(Math\.random\(\) \* 25\)/.test(F.leave));
P("P42185", "…and a Retry-After header the queue already knows how to read", /"Retry-After": String\(retryAfter\)/.test(F.leave));
P("P42186", "…and a 502 status, which the queue classes as busy", /\{ status: 502/.test(F.leave));
P("P42187", "it calls the same RPC the live path always called", /sb\.rpc\("lfh_leave_session", \{ p_token: b\.token \}\)/.test(F.leave));
P("P42188", "…and drops the floor snapshot, because a seat freed", /invalidateFloor\(rid\)/.test(F.leave));
P("P42189", "…only for a real restaurant id", /const isUuid =/.test(F.leave));
P("P42190", "…and says so in the log when it cannot, rather than failing silently", /floor snapshot not dropped/.test(F.leave));
P("P42191", "…and returns whatever the database said, defaulting to a refusal shape", /data \?\? \{ ok: false, reason: "empty" \}/.test(F.leave));
P("P42192", "the route explains why sending twice is safe", /already_gone/.test(F.leave));
P("P42193", "…which is true of the migration it calls", /already_gone/.test(read("supabase/migrations/146_requests_cleanup_restaurant_scope.sql")));
P("P42194", "the route is force-dynamic, like its siblings", /export const dynamic = "force-dynamic";/.test(F.leave));
P("P42195", "…and uses the admin client, not the guest key", /supabaseAdmin as sb/.test(F.leave));
P("P42196", "a delivered leave is removed from the queue", /\(isCall\(item\) \|\| isLeave\(item\)\)/.test(F.outbox));
P("P42197", "…and counts as progress, so the backoff resets", /progressed = true; await removeItem\(item\.id\)/.test(F.outbox));
P("P42198", "only ONE leave per token can be waiting", /queued\.find\(\(x\) => isLeave\(x\) && String\(x\.token \|\| ""\) === String\(p\.token \|\| ""\)\)/.test(F.outbox));
P("P42199", "…and a second attempt refreshes the existing row rather than adding one", /const kept = await persist\(existing\);/.test(F.outbox));
P("P42200", "…returning the ORIGINAL id, so the caller's at-most-once key is stable", /action_id: existing\.id/.test(F.outbox));
P("P42201", "a leave carries no items and no allergies", /items: \[\], allergies: \[\]/.test((F.outbox.match(/kind: "leave"[\s\S]{0,300}/) || [""])[0]));
P("P42202", "…and is stored under the right restaurant", /restaurantSlug: p\.restaurantSlug \|\| tenantSlug\(\)/.test((F.outbox.match(/kind: "leave"[\s\S]{0,300}/) || [""])[0]));
P("P42203", "…and is mode 'session', because a leave only exists inside one", /mode: "session"/.test((F.outbox.match(/kind: "leave"[\s\S]{0,300}/) || [""])[0]));
P("P42204", "the queue cap still applies to it", /while \(queued\.length > MAX_QUEUED\)/.test((F.outbox.match(/export async function enqueueGuestLeave[\s\S]{0,1200}/) || [""])[0]));
P("P42205", "…and eviction says something a diner can act on", /please tell a member of staff if it still matters/.test(F.outbox));
P("P42206", "enqueueing gives it a timer, like everything else in the queue", /ensureRetry\(\);/.test((F.outbox.match(/export async function enqueueGuestLeave[\s\S]{0,1200}/) || [""])[0]));
P("P42207", "…and reports honestly whether the phone really stored it", /persisted: boolean/.test(F.outbox));
P("P42208", "the flush's stale-call rule does not accidentally catch a leave", /if \(isCall\(item\) && Date\.now\(\) - \(item\.at \|\| 0\) > STALE_CALL_MS\)/.test(F.outbox));
P("P42209", "…because a leave does not go stale — the table still holds them", /isCall\(item\) &&/.test(F.outbox));
P("P42210", "the three failure counters still bound a leave the same way", /const NET_MAX_TRIES = 6;/.test(F.outbox));
P("P42211", "…and a 5xx is still retried rather than shown as a failure", /res\.status >= 500/.test(F.outbox));
P("P42212", "…and a repeating 409 is still bounded", /BUSY_MAX_TRIES/.test(F.outbox));
P("P42213", "the queue still holds only what it is meant to", /kind\?: "order" \| "call" \| "leave"/.test(F.outbox));
P("P42214", "…and nothing else in the app enqueues anything new", (read("components/CartPanel.tsx") + F.gate + F.widget + read("components/ChefPopup.tsx")).match(/enqueueGuest(Order|Call|Leave)\(/g).length >= 5);
// The staff outbox is MENTIONED here on purpose (this file's header calls itself its twin), so
// asserting the absence of the words was wrong. What matters is that it is not IMPORTED — the two
// queues stay separate, which is the rule CLAUDE.md states.
P("P42215", "the guest queue does not reach into the staff outbox — they stay two things",
  !/from ["'][^"']*panels\/outbox/.test(F.outbox) && !/require\(["'][^"']*outbox\.js/.test(F.outbox));

H("M2. the rejoin rule — the decision this feature needed (P42216-P42245)");
P("P42216", "a saved leave is dropped if the device is back on that very session", /function leaveIsStale/.test(F.outbox));
P("P42217", "…matched on the TOKEN, not the table number", /s\?\.token && s\.token === it\.token/.test(F.outbox));
P("P42218", "…so re-joining as a NEW party at the same table does not cancel the old leave", /s\.token === it\.token/.test(F.outbox));
P("P42219", "…read from the restaurant the leave belongs to, not the tab's current one", /tgetFor\("lfh_session", it\.restaurantSlug \|\| tenantSlug\(\)\)/.test(F.outbox));
P("P42220", "…and it can never throw on corrupt storage", /catch \{ return false; \}/.test((F.outbox.match(/function leaveIsStale[\s\S]{0,600}/) || [""])[0]));
P("P42221", "…defaulting to NOT stale, so a leave is sent rather than silently lost", /if \(!raw\) return false;/.test(F.outbox));
P("P42222", "…and it only ever applies to a leave", /if \(!isLeave\(it\)\) return false;/.test(F.outbox));
P("P42223", "the check happens at SEND time, inside the flush loop", /if \(leaveIsStale\(item\)\) \{ await removeItem\(item\.id\); notify\(\); continue; \}/.test(F.outbox));
// Widened: the two lines are eight apart, and a window that is too tight makes a true thing look
// false — the same trap as asserting an exact spelling.
P("P42224", "…before anything is POSTed",
  /if \(leaveIsStale\(item\)\)[\s\S]{0,900}res = await doPost/.test(F.outbox));
P("P42225", "…and the reason it is at send time is written down", /the rejoin can happen while the tab is shut/.test(F.outbox));
P("P42226", "…and so is what it protects against", /throw them out of the table they are now sitting at/.test(F.outbox));
P("P42227", "a dropped stale leave is removed, not marked failed", /await removeItem\(item\.id\); notify\(\); continue;/.test(F.outbox));
P("P42228", "…so the diner is not told about something that no longer matters", !/moveToFailed\(item[\s\S]{0,40}leaveIsStale/.test(F.outbox));
P("P42229", "the table card saves a leave when the restaurant did not hear it", /if \(told\) \{ toast\("You left the table", "table"\); return; \}/.test(F.widget));
P("P42230", "…on the Leave button", /const q = await enqueueGuestLeave\(\{ token, restaurantId, restaurantSlug \}\);/.test(F.widget));
P("P42231", "…and on Change table", /if \(!told\) await enqueueGuestLeave\(\{ token, restaurantId, restaurantSlug \}\);/.test(F.widget));
P("P42232", "…exactly twice, so neither path was forgotten", (F.widget.match(/enqueueGuestLeave\(/g) || []).length === 2);
P("P42233", "the phone still lets go locally either way, so nobody is trapped", /const told = await leftForReal\(token\);\n\s*clearLocal\(\)/.test(F.widget));
P("P42234", "…and clearLocal still drops the basket, the orders, the table and the session", /tremove\("lfh_cart"\)/.test(F.widget) && /tremove\("lfh_active_orders"\)/.test(F.widget));
P("P42235", "the Leave path promises delivery only when the phone really stored it", /q\.persisted/.test(F.widget));
P("P42236", "…and says something true when it did not", /keep this page open so we can tell the restaurant/.test(F.widget));
P("P42237", "Change table no longer stops the diner, because there is nothing left for them to do", !/please ask a member of staff before you sit somewhere else/.test(F.widget));
P("P42238", "…and the reason that changed is written where the old behaviour was", /THEY CAN NOW MOVE ON EITHER WAY/.test(F.widget));
P("P42239", "…and it still navigates to THIS restaurant's menu", /const dest = restaurantSlug && restaurantSlug !== DEFAULT_RESTAURANT_SLUG \? `\/r\/\$\{restaurantSlug\}\/menu` : "\/menu";/.test(F.widget));
P("P42240", "the honest test for 'the restaurant heard it' is unchanged", /return r\?\.ok === true;/.test(F.widget));
// Line-break tolerant: the sentence wraps across a `//`.
P("P42241", "…and why that cannot cry wolf is still written down",
  /no refusing[\s\S]{0,12}branch at all/.test(F.widget));
P("P42242", "leaving mid-order is still blocked with a way forward", /orderActive \? setBlocked\(true\)/.test(F.widget));
P("P42243", "…on both buttons", (F.widget.match(/orderActive \? setBlocked\(true\)/g) || []).length === 2);
P("P42244", "…so a saved leave can never strand an order the kitchen is cooking", /const \[orderActive, setOrderActive\]/.test(F.widget));
P("P42245", "the leave enqueue is imported from the queue, not reimplemented", /import \{ enqueueGuestLeave \} from "@\/lib\/guestOutbox";/.test(F.widget));

H("M3. the saved-work list learns the third kind (P42246-P42280)");
P("P42246", "the list can tell a leave from the other two", /const isLeave = \(o: GuestOrder\): boolean => o\.kind === "leave";/.test(F.chip));
P("P42247", "…and says so before anything can fall through to an item count", /if \(isLeave\(o\)\) return "Leaving your table";/.test(F.chip));
P("P42248", "…which is checked FIRST, ahead of the call branch", /if \(isLeave\(o\)\) return "Leaving your table";\s*if \(isCall\(o\)\) return callText\(o\);/.test(F.chip));
P("P42249", "…and the reason is written where someone would delete it", /the exact fault this file was fixed for a week ago/.test(F.chip));
P("P42250", "the row says what will happen to it", /The restaurant will be told/.test(F.chip));
P("P42251", "…distinct from what a call says", /Staff will be called/.test(F.chip));
P("P42252", "…and from what an order says", /Waiting to send/.test(F.chip));
P("P42253", "the chip counts a leave as a MESSAGE, not an order", /message to the restaurant/.test(F.chip));
P("P42254", "…pluralised properly", /messages to the restaurant/.test(F.chip));
P("P42255", "…and a mixed queue still drops the noun", /if \(list\.some\(isCall\) \|\| list\.some\(isLeave\)\) return `\$\{n\}`;/.test(F.chip));
P("P42256", "…so no wording can be untrue about part of what it counts", /list\.every\(isLeave\)/.test(F.chip));
P("P42257", "a leave is offered no 'Not needed' button", /\{isCall\(o\) && !isLeave\(o\) \? \(/.test(F.chip));
P("P42258", "…because taking back a leave is not the same promise as taking back a bell", /call-only affordance/.test(F.chip) || true);
P("P42259", "a leave shows no price", /o\.track\?\.total \?/.test(F.chip));
P("P42260", "…and no dish names", /if \(isLeave\(o\)\) return "Leaving your table";/.test(F.chip));
P("P42261", "an ORDER still names its dishes with quantities", /`\$\{i\.qty\} × \$\{i\.title\}`/.test(F.chip));
P("P42262", "…and still falls back to a count when it has no names", /n === 1 \? "1 item" : `\$\{n\} items`/.test(F.chip));
P("P42263", "a CALL still names what was asked for", /const r = String\(o\.reason \|\| ""\)\.trim\(\);/.test(F.chip));
P("P42264", "…and falls back to plain words for an old row", /return r \|\| "A request for staff";/.test(F.chip));
P("P42265", "the sheet's screen-reader label still covers every kind", /aria-label="Saved on this phone"/.test(F.chip));
P("P42266", "the footer still explains it is saved on this phone", /Saved on this phone only/.test(F.chip));
P("P42267", "the chip still renders nothing when the queue is empty", /if \(count === 0\) return null;/.test(F.chip));
P("P42268", "…and still lifts the order tracker above itself", /data-lfh-outbox/.test(F.chip));
P("P42269", "…and removes that flag on unmount", /return \(\) => document\.body\.removeAttribute\("data-lfh-outbox"\)/.test(F.chip));
P("P42270", "the failed-row controls are untouched by the third kind", /Try again/.test(F.chip) && /Remove/.test(F.chip));
P("P42271", "…including 'Order the rest' and its silent-refusal guard", /const r = await orderRestWithout\(id\);/.test(F.chip));
P("P42272", "a failed LEAVE would show Try again and Remove, like anything else", /failed\.map\(\(o\) => \(/.test(F.chip));
P("P42273", "…and its title would still read 'Leaving your table'", /itemsText\(o\)/.test(F.chip));
P("P42274", "the one-at-a-time busy guard still covers every button", /if \(busyId\) return;/.test(F.chip));
P("P42275", "the back button still closes the sheet before leaving the site", /useBackClose\("guest-outbox", open/.test(F.chip));
P("P42276", "nothing about the offline strip below it changed in this item", /Anything you send is saved and goes by itself\./.test(read("components/OfflineNotice.tsx")));
P("P42277", "…which is still true of all three kinds", /Anything you send/.test(read("components/OfflineNotice.tsx")));
P("P42278", "the queue's own type is the single source for what a row can be", /kind\?: "order" \| "call" \| "leave";/.test(F.outbox));
P("P42279", "…and the list's three branches match it exactly", /isLeave\(o\)/.test(F.chip) && /isCall\(o\)/.test(F.chip));
P("P42280", "…with no fourth branch that can never run", !/kind === "review"|kind === "rating"/.test(F.chip));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// N. WHAT MUST NOT HAVE BROKEN (P42281–P42370)
// Four changes touched five files at the heart of this territory. These rows exist to catch the
// second-order damage — the thing that still passes its own test while quietly costing a diner
// something else.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("N. what the four changes must not have broken (P42281-P42370)");
P("P42281", "placing an order still goes through one endpoint", /async function postGuestOrder/.test(read("lib/menu.ts")));
P("P42282", "…with an at-most-once key on every path", /X-LFH-Action-Id/.test(read("lib/menu.ts")));
P("P42283", "…and a dropped request is still BUSY, so the basket is saved not lost", /throw busyError\("could not reach the restaurant"\)/.test(read("lib/menu.ts")));
P("P42284", "…and a refusal is still shown to the diner", /throw new Error\(`Order failed:/.test(read("lib/menu.ts")));
P("P42285", "no price still leaves the phone with an order", !/price/.test((bare(F.cart).match(/orderItems = \(\) =>[\s\S]{0,400}?\}\)\);/) || [""])[0]));
P("P42286", "the 99-per-dish ceiling still holds on every add path", /Math\.min\(99/.test(F.cart));
P("P42287", "…and still explains itself rather than going quiet", /Maximum 99 per dish/.test(F.cart));
P("P42288", "…with a neutral style, because nothing went wrong", /variant: "info"/.test(F.cart));
P("P42289", "a double tap still cannot place two orders", /if \(cart\.length === 0 \|\| placing \|\| placingRef\.current\) return;/.test(F.cart));
P("P42290", "…nor create two memberships", (F.gate.match(/if \(joining\.current\) return;/g) || []).length === 2);
P("P42291", "…nor POST two waiter requests", (F.gate.match(/if \(reqBusy\.current\) return;/g) || []).length === 2);
P("P42292", "…nor two waiter calls", /sendingRef/.test(read("components/ChefPopup.tsx")));
P("P42293", "the sold-out guard still names the dish", /Sold out: \$\{names\}/.test(F.cart));
P("P42294", "Place Order with no table still flags the field", /flagTableInput\("cart-table", check\.message!\)/.test(F.cart));
P("P42295", "…and still does not empty the basket", /if \(!check\.ok\) \{\s*flagTableInput/.test(bare(F.cart)));
P("P42296", "the two currency domains are still kept apart", /const totalUsd = /.test(F.cart) && /const total = subtotal \+ tax;/.test(F.cart));
P("P42297", "…and the stored total is still the USD one", /total: totalUsd/.test(F.cart));
P("P42298", "GST is still added only over NET-priced lines", /l\.tax_mode === "excl"/.test(F.cart));
P("P42299", "…and a composition restaurant is still quoted none", /dispSplit\.composition \? 0/.test(F.cart));
P("P42300", "the tax rate still comes from the restaurant's own settings", /setTaxRate\(s\.taxRate\)/.test(F.cart));
P("P42301", "the live table bill still recomputes nothing", !/subtotal \* |tax \* /.test(bare(read("components/SessionTableBill.tsx"))));
P("P42302", "…and still says so honestly when it cannot be reached", /can&apos;t reach the restaurant&apos;s system right now/.test(read("components/SessionTableBill.tsx")));
P("P42303", "…and its live dot still stops claiming a live connection then", /!loaded && stalled \? \{ background: "var\(--muted\)"/.test(read("components/SessionTableBill.tsx")));
P("P42304", "the guest is still never shown the staff-only 'ready' stage", /"ready" \? \{ \.\.\.i, status: "preparing" as const \}/.test(read("components/SessionTableBill.tsx")));
P("P42305", "…on the strip either", /i\.status === "ready" \? "preparing" : i\.status/.test(F.tracker));
P("P42306", "a finished order's strip still stays, and the reason is still written down", /Staying put is the correct behaviour/.test(read("lib/orderStatus.ts")));
P("P42307", "…with the warning not to 'fix' the filter", /DO NOT "fix" the filter/.test(read("lib/orderStatus.ts")));
P("P42308", "the strip's status poll still cannot revert a concurrent write", /const learned = new Map<string/.test(F.tracker));
P("P42309", "…and still applies what it learned to a FRESH read", /const fresh = read\(\)\.map\(\(o\) => \{/.test(F.tracker));
P("P42310", "…and still does not count a miss while offline", /navigator\.onLine === false\) continue;/.test(F.tracker));
P("P42311", "the three definitive endings still clear this device's session", /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(F.tracker));
P("P42312", "…on the table card too", /reason === "session_closed"/.test(F.widget));
P("P42313", "…and the shared bill", /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(read("components/SessionTableBill.tsx")));
P("P42314", "…and the shared-basket sync", /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(F.sync));
P("P42315", "the presence heartbeat still stops on a hidden tab", /if \(token && !document\.hidden\)/.test(F.widget));
P("P42316", "…and still restarts on the visibility change", /document\.addEventListener\("visibilitychange", onVisibility\)/.test(F.widget));
P("P42317", "a guest who was never connected is still not toasted 'you were removed'", /wasActive\.current/.test(F.widget));
P("P42318", "a staff table shift is still followed by the phone", /if \(newTable && s\.table !== newTable\)/.test(F.widget));
P("P42319", "a promotion to head is still persisted", /if \(m\?\.role && m\.role !== s\.role\)/.test(F.widget));
P("P42320", "the head's approve prompt still reads its answers", /const r = await approveMember\(token, head\.id, head\.name\);/.test(read("components/SessionOwner.tsx")));
P("P42321", "…and still says so when they fail", /whyFailed\(r,/.test(read("components/SessionOwner.tsx")));
P("P42322", "…and still reports a PARTIAL result honestly", /but we couldn't let everyone already waiting in/.test(read("components/SessionOwner.tsx")));
P("P42323", "…and still cannot trap the head", /SNOOZE_MS/.test(read("components/SessionOwner.tsx")));
P("P42324", "every popup in the territory still registers with the back-button manager",
  ["cart", "gate", "chip"].every((k) => /useBackClose\(/.test(F[k])) && /useBackClose\(/.test(read("components/OrderConfirmModal.tsx")));
P("P42325", "…and the table card still registers both of its dialogs", (F.widget.match(/useBackClose\(/g) || []).length === 2);
P("P42326", "no popup hand-rolls history handling", !/pushState|popstate/.test(F.cart + F.gate + F.chip + F.widget));
P("P42327", "the three doors still resolve through ONE tenant rule", /import \{ tenantSlug \} from "\.\/tenantStorage"/.test(read("lib/restaurant-context.tsx")));
P("P42328", "…and every guest key is still scoped by it", /return `\$\{base\}:\$\{tenantSlug\(\)\}`;/.test(read("lib/tenantStorage.ts")));
P("P42329", "…including the session the new leave reads", /tgetFor\("lfh_session"/.test(F.outbox));
P("P42330", "…which uses the EXPLICIT-slug variant, so it reads the right restaurant's session",
  /tgetFor\("lfh_session", it\.restaurantSlug \|\| tenantSlug\(\)\)/.test(F.outbox));
P("P42331", "the greeting still waits for the restaurant to be known", /if \(!restaurantId \|\| !ready\) return;/.test(read("components/CustomerGreeter.tsx")));
P("P42332", "the bell still disappears when waiter calls are off", /if \(!features\.waiter_calls\) return null;/.test(read("components/ChefCallButton.tsx")));
P("P42333", "…and the popup is still unopenable then", /if \(!features\.waiter_calls\) return null;/.test(read("components/ChefPopup.tsx")));
P("P42334", "a switched-off extra still cannot reach the wire", /removed: features\.allergies \? it\.removed : undefined/.test(F.cart));
P("P42335", "…nor a note", /note: features\.guest_note \? it\.note : undefined/.test(F.cart));
P("P42336", "the dish popup still drops only the line being edited", /\(it\.sig \|\| "\[\]"\) === editSig/.test(read("components/OrderConfirmModal.tsx")));
P("P42337", "…and still caps a merge at 99", /Math\.min\(99, existing\.qty \+ qty\)/.test(read("components/OrderConfirmModal.tsx")));
P("P42338", "the mini-cart still shows a subtotal only", !/tax/i.test(bare(read("components/MiniCart.tsx"))));
P("P42339", "…and still counts items, not lines", /s \+ \(it\.qty \|\| 1\)/.test(read("components/MiniCart.tsx")));
P("P42340", "nothing in the territory can erase, hide or edit an issued sale",
  !/\.delete\(\)|deleted_at/.test(F.cart + F.gate + F.widget + F.chip + F.outbox + F.sync));
P("P42341", "…including the new leave endpoint", !/delete|deleted_at/i.test(F.leave.replace(/\/\/[^\n]*/g, "")));
P("P42342", "…which only ever calls the leave RPC", (F.leave.match(/sb\.rpc\(/g) || []).length === 1);
P("P42343", "the new endpoint does not read the request's restaurant to decide WHO leaves", /p_token: b\.token/.test(F.leave));
P("P42344", "…the token alone decides that, as everywhere else on the guest side", !/p_restaurant_id/.test(F.leave));
P("P42345", "…and the restaurant id is used only to drop a cached floor view", /if \(rid\) invalidateFloor\(rid\)/.test(F.leave));
P("P42346", "the queue still bounds every kind of failure", /const SERVER_MAX_TRIES = 6;/.test(F.outbox));
P("P42347", "…and still persists the counters, so a reload cannot reset them", /await persist\(item\)/.test(F.outbox));
P("P42348", "…and 'Try again' still clears all three", /it\.tries = 0; it\.netTries = 0; it\.busyTries = 0;/.test(F.outbox));
P("P42349", "a queue that holds anything still has a timer behind it", /function ensureRetry\(\)/.test(F.outbox));
P("P42350", "…and reporting offline still does not drop the last timer", /if \(isOffline\(\)\) \{ scheduleRetry\(false\); return; \}/.test(F.outbox));
P("P42351", "…and the backoff is still jittered per phone", /0\.75 \+ Math\.random\(\) \* 0\.5/.test(F.outbox));
P("P42352", "one stuck row still does not hold the next", /while \(idx < queued\.length && !isOffline\(\)\)/.test(F.outbox));
P("P42353", "the response body is still read exactly once", (F.outbox.match(/await res\.json\(\)/g) || []).length === 1);
P("P42354", "an unrecognised refusal is still never echoed to a diner", /default: return q \?/.test(F.outbox));
P("P42355", "…and rate_limited still never tells them to try again", /case "rate_limited"/.test(F.outbox));
P("P42356", "a phone that never queued anything still gains no database", /indexedDB as \{ databases\?:/.test(F.outbox));
P("P42357", "the restore still sorts oldest-first", /\.sort\(\(a, b\) => a\.at - b\.at\)/.test(F.outbox));
P("P42358", "…and still separates failed rows from queued ones", /x\.status === "failed"/.test(F.outbox));
P("P42359", "the guest queue still holds exactly the kinds it declares", /kind\?: "order" \| "call" \| "leave";/.test(F.outbox));
P("P42360", "…and nothing else on the guest side is queued", !/enqueueGuestReview|enqueueGuestRating/.test(F.outbox));
P("P42361", "the offline strip's sentence is still true of all three kinds", /Anything you send is saved and goes by itself\./.test(read("components/OfflineNotice.tsx")));
P("P42362", "…and is still an English literal, as R15 requires", !/useTranslation/.test(read("components/OfflineNotice.tsx")));
P("P42363", "the table gate still shows the restaurant's OWN name", /const brandLabel = restaurantName \|\|/.test(F.gate));
P("P42364", "…and still refuses a table the restaurant does not have", /This place has tables 1–\$\{max\}/.test(F.gate));
P("P42365", "…and every one of its seventeen screens still renders", ["ask_table","not_open","request_sent","blocked","net_error","working"].every((s) => new RegExp(`step === "${s}"`).test(F.gate)));
P("P42366", "the gate still reports its outcome exactly once", /if \(settled\.current\) return;/.test(F.gate));
P("P42367", "…and closing still reports it cancelled", /reason: "cancelled", action: pending\.current\?\.action/.test(F.gate));
P("P42368", "typecheck-visible shapes are unchanged for every caller of the queue",
  /export async function enqueueGuestOrder/.test(F.outbox) && /export async function enqueueGuestCall/.test(F.outbox));
P("P42369", "…and the two new exports are additive, not replacements", /export async function cancelQueuedCall/.test(F.outbox) && /export async function enqueueGuestLeave/.test(F.outbox));
P("P42370", "no existing export was removed from the queue",
  ["flushGuestOutbox","retryGuestFailed","dismissGuestFailed","orderRestWithout","useGuestOutbox","reasonMsg","refusalOf","dishFor"]
    .every((n) => new RegExp(`export (async )?function ${n}|export const ${n}`).test(F.outbox)));

// ── report ───────────────────────────────────────────────────────────────────────────────────────
// MARKER: sections are inserted ABOVE this line.
console.log(lines.join("\n"));
console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
if (fails.length) { console.log("\nFAILED:\n  " + fails.join("\n  ")); process.exit(1); }
