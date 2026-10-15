// Block D — every file in the territory READ against the project's own rules (comments stripped where
// the rule is about what the code DOES). Includes the logins-and-separation questions of §1b, asked
// in product terms: who may call each door, which restaurant it acts for, what it can never reveal.
import { check, SRC, CODE, FILES, rd, strip, count, decl } from "./lib.mjs";

const HOW = "SRC — the file on disk, comments stripped";
const ROUTES = ["callWaiter", "leave", "limitHit", "placeOrder"];
const COMPONENTS = ["cart", "bell", "chef", "chip", "mini", "confirm", "tracker", "stars"];
const DETAIL = rd("docs/CLAUDE-DETAIL.md");
const SESSION_BILL = rd("components/SessionTableBill.tsx");

// ── D1. the four doors: who may knock, and for which restaurant (P172300–P172331) ────────────────
let n = 172300;
for (const k of ROUTES) {
  const f = FILES[k], c = CODE[k];
  const url = "/api/guest/" + f.split("/")[3];
  check(`P${n++}`, f, `${url} is on the deliberately-public list in docs/CLAUDE-DETAIL.md (a guest door needs no staff login)`, "SRC + docs/CLAUDE-DETAIL.md → Security gate", () => DETAIL.includes("`" + url + "`"));
  check(`P${n++}`, f, `${url} never falls back to restaurant #1 (no default restaurant id in the door)`, HOW, () => !/DEFAULT_RESTAURANT_ID|00000000-0000-0000-0000-000000000001/.test(c));
  check(`P${n++}`, f, `${url} writes nothing directly — no insert/update/delete/upsert of its own`, HOW, () => !/\.(insert|update|delete|upsert)\s*\(/.test(c));
  check(`P${n++}`, f, `${url} is force-dynamic (never cached between diners)`, HOW, () => /export const dynamic = "force-dynamic"/.test(c));
  check(`P${n++}`, f, `${url} never puts a database message into its reply`, HOW, () => !/NextResponse\.json\([^)]*error\.message/.test(c) && !/message:\s*error/.test(c));
  check(`P${n++}`, f, `${url} logs no diner's own words (no body, note, reason or allergy in a log line)`, HOW, () => {
    const logs = c.match(/console\.(log|warn|error)\([^;]*\);/g) || [];
    return { ok: logs.every((l) => !/\bb\.(reason|items|allergies|token|table)\b|\breason\b(?!\s*:)|JSON\.stringify\(b/.test(l)), note: `${logs.length} log line(s)` };
  });
  check(`P${n++}`, f, `${url} reads no secret the browser could be handed back (no env value in a reply)`, HOW, () => !/process\.env/.test(c));
}
// n = 172328
check("P172328", FILES.placeOrder, "place-order, call-waiter and leave are all at-most-once; the beacon (which writes nothing) is not", HOW, () =>
  ["placeOrder", "callWaiter", "leave"].every((k) => /export const POST = withIdempotency\(postImpl, "guest"\)/.test(CODE[k])) && !/withIdempotency/.test(CODE.limitHit));
check("P172329", FILES.placeOrder, "a QR order's restaurant is taken ONLY from a well-formed id, and a session order's from the token", HOW, () =>
  /const publicRid = isUuid\(b\.restaurantId\)/.test(CODE.placeOrder) && /p_token: b\.token/.test(CODE.placeOrder) && !/p_restaurant_id/.test(decl(SRC.placeOrder, "  if (b.mode === \"session\")").slice(0, 400)));
check("P172330", FILES.callWaiter, "a seated call's identity is the token alone — the table and restaurant in the body never reach the database", HOW, () =>
  /sb\.rpc\("lfh_call_waiter", \{ p_token: b\.token, p_reason: reason \}\)/.test(CODE.callWaiter));
check("P172331", FILES.leave, "leaving acts on the token alone", HOW, () => /sb\.rpc\("lfh_leave_session", \{ p_token: b\.token \}\)/.test(CODE.leave));
check("P172332", FILES.limitHit, "the beacon trusts nothing but WHICH limit and WHICH restaurant to look up — the alert text comes from the database row", HOW, () =>
  /pingLatestGuestLimit\(key, rid\)/.test(CODE.limitHit) && !/message|text|label/.test(decl(SRC.limitHit, "export async function POST").replace(/\/\/.*$/gm, "")));
check("P172333", FILES.limitHit, "the beacon's bucket is the device cookie or the server-derived address — never a body field", HOW, () =>
  /capKeyFor\(req\)/.test(CODE.limitHit) && !/b\.(cap|key|device|ip)/.test(CODE.limitHit));
check("P172334", FILES.placeOrder, "the size ceilings are named constants (200 lines, 40 allergies, 200 characters)", HOW, () =>
  /const MAX_ITEMS = 200;/.test(CODE.placeOrder) && /const MAX_ALLERGIES = 40;/.test(CODE.placeOrder) && /const MAX_ALLERGY_LEN = 200;/.test(CODE.placeOrder));
check("P172335", FILES.callWaiter, "the stale-call ceiling on the server is the same ten minutes the phone uses", HOW, () =>
  /const STALE_CALL_MS = 10 \* 60 \* 1000;/.test(CODE.callWaiter) && /const STALE_CALL_MS = 10 \* 60 \* 1000;/.test(CODE.outbox));
check("P172336", FILES.placeOrder, "every refusal code the four doors can answer has diner words in reasonMsg", "SRC — codes derived from the four route files", () => {
  const codes = new Set(); for (const k of ROUTES) for (const m of CODE[k].matchAll(/reason: "([a-z_]+)"/g)) codes.add(m[1]);
  const worded = new Set([...CODE.outbox.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]));
  const missing = [...codes].filter((c) => !worded.has(c) && c !== "empty");
  return { ok: missing.length === 0, note: `${codes.size} codes · missing: ${missing.join(",") || "none"}` };
});
check("P172337", FILES.placeOrder, "the three writing doors all spell `server_busy` and send a spread-out retryAfter (20–45s)", HOW, () =>
  ["placeOrder", "callWaiter", "leave"].every((k) => /reason: "server_busy", retryAfter/.test(CODE[k]) && /20 \+ Math\.floor\(Math\.random\(\) \* 25\)/.test(CODE[k])));
check("P172338", FILES.placeOrder, "no door holds a timer or a poll of its own", HOW, () => ROUTES.every((k) => !/setInterval|setTimeout/.test(CODE[k])));
// Round 2 (item 7): the lookup now lives ONCE in lib/guestTokenRestaurant.ts, used by all three doors.
check("P172339", FILES.placeOrder, "each door's narrow token lookup is column-listed and capped at one row", HOW, () =>
  count(CODE.tokenRid, /\.select\("(session_id|restaurant_id)"\)\.eq\([^)]*\)\.limit\(1\)\.maybeSingle\(\)/g) === 2
  && ["placeOrder", "callWaiter", "leave"].every((k) => /restaurantOfToken\(b\.token\)/.test(CODE[k])));

// ── D2. the components: the rules every guest screen must keep (P172340–P172399) ─────────────────
check("P172340", FILES.cart, "the bill registers with the back-button manager", HOW, () => /useBackClose\("cart", open,/.test(CODE.cart));
check("P172341", FILES.chef, "the waiter popup registers with the back-button manager", HOW, () => /useBackClose\("chef-popup", open,/.test(CODE.chef));
check("P172342", FILES.confirm, "the dish popup registers with the back-button manager", HOW, () => /useBackClose\("order-confirm", open,/.test(CODE.confirm));
check("P172343", FILES.chip, "the saved-orders list registers with the back-button manager", HOW, () => /useBackClose\("guest-outbox", open,/.test(CODE.chip));
check("P172344", FILES.chef, "Escape closes the waiter popup, and the key listener exists only while it is open", HOW, () => /if \(!open\) return;\s*const onKey = \(e: KeyboardEvent\) => \{ if \(e\.key === "Escape"\) setOpen\(false\); \};/.test(CODE.chef));
check("P172345", FILES.confirm, "Escape closes the dish popup, listener only while open", HOW, () => /if \(!open\) return;\s*const onKey = \(e: KeyboardEvent\) => \{ if \(e\.key === "Escape"\) setOpen\(false\); \};/.test(CODE.confirm));
check("P172346", FILES.cart, "the bill reads nothing until it knows which restaurant it is on", HOW, () => /if \(!restaurantId\) return;\s*loadCart\(\);/.test(CODE.cart));
check("P172347", FILES.chef, "the waiter popup reads nothing until it knows which restaurant it is on", HOW, () => /if \(!restaurantId\) return;/.test(CODE.chef));
check("P172348", FILES.tracker, "the table pull reads nothing until it knows which restaurant it is on", HOW, () => /if \(!restaurantId\) return;\s*let alive = true;/.test(CODE.tracker));
check("P172349", FILES.cart, "every saved-basket read and write is restaurant-scoped (tget/tset, never bare localStorage)", HOW, () => !/localStorage\./.test(CODE.cart) && /tget\("lfh_cart"\)/.test(CODE.cart));
check("P172350", FILES.mini, "the basket pill reads the restaurant-scoped basket", HOW, () => !/localStorage\./.test(CODE.mini) && /tget\("lfh_cart"\)/.test(CODE.mini));
check("P172351", FILES.confirm, "the dish popup writes the restaurant-scoped basket", HOW, () => !/localStorage\./.test(CODE.confirm) && /tset\("lfh_cart"/.test(CODE.confirm));
check("P172352", FILES.status, "the tracked orders are restaurant-scoped", HOW, () => !/localStorage\./.test(CODE.status) && /tget\(ACTIVE_ORDERS_KEY\)/.test(CODE.status));
// re-pointed (sweep #10 T3 round 3, item 35): through trackActiveOrder(…, slug), the one way an order joins the strip
check("P172353", FILES.outbox, "the queue writes a tracked order under the ORDER'S restaurant, not the page's", HOW, () => /trackActiveOrder\(\{[\s\S]{0,300}\}, slug\);/.test(CODE.outbox) && /const slug = item\.restaurantSlug \|\| tenantSlug\(\)/.test(CODE.outbox));
check("P172354", FILES.cart, "the basket sent to the kitchen carries NO price and NO name — the server prices everything", HOW, () => {
  const i = SRC.cart.indexOf("  const orderItems = () =>"), j = SRC.cart.indexOf("  const allergyPayload");
  const b = SRC.cart.slice(i, j).replace(/\/\/.*$/gm, ""); return { ok: i > 0 && j > i && !/price|title/.test(b), note: b.replace(/\s+/g, " ").trim().slice(0, 120) };
});
check("P172355", FILES.cart, "a note or a removed allergen cannot ride along once its switch is off (the last gate before the wire)", HOW, () =>
  /removed: features\.allergies \? it\.removed : undefined/.test(CODE.cart) && /note: features\.guest_note \? it\.note : undefined/.test(CODE.cart));
check("P172356", FILES.cart, "the order-wide allergy list travels only while allergies are on, and free text only while its own switch is", HOW, () =>
  /if \(!features\.allergies\) return \[\];/.test(CODE.cart) && /features\.allergy_other \? otherAllergy\.trim\(\) : ""/.test(CODE.cart));
check("P172357", FILES.cart, "the at-most-once key changes when the table, the lines OR the allergies change", HOW, () => /const sig = JSON\.stringify\(\{ t: tableTrim, i: itemsS, a: allergies \}\)/.test(CODE.cart));
check("P172358", FILES.cart, "a busy restaurant (5xx/timeout) saves the order under the SAME key — busy is treated like offline", HOW, () =>
  /if \(isServerBusy\(err\) && orderKeyRef\.current\)/.test(CODE.cart) && /actionId: orderKeyRef\.current\.id/.test(decl(SRC.cart, "  const placeOrder = async").slice(SRC.cart.indexOf("isServerBusy(err)") - SRC.cart.indexOf("  const placeOrder = async"))));
check("P172359", FILES.cart, "a refusal is worded by the ONE vocabulary (reasonMsg), never pattern-matched prose", HOW, () =>
  /message: reasonMsg\(reason, \{ dish: dishFor\(reason, dish, cart\) \}\)/.test(CODE.cart) && !/\/sold_out\/i\.test/.test(CODE.cart));
check("P172360", FILES.cart, "the waiting-on-the-gate button has a way back (a 60s failsafe that releases it and SAYS so)", HOW, () =>
  /const GATE_FAILSAFE_MS = 60_000;/.test(CODE.cart) && /We didn't hear back about that order/.test(CODE.cart));
check("P172361", FILES.cart, "a double tap cannot send two orders — a synchronous lock beside the state", HOW, () =>
  /if \(cart\.length === 0 \|\| placing \|\| placingRef\.current\) return;/.test(CODE.cart) && count(CODE.cart, /placingRef\.current = false;/g) >= 3);
check("P172362", FILES.cart, "the Place Order button is disabled while sending and says so", HOW, () => /disabled=\{placing\}/.test(CODE.cart) && /placing \? "Placing…" : "Place Order"/.test(CODE.cart));
check("P172363", FILES.cart, "the table box takes digits only, at most four", HOW, () => /id="cart-table"[\s\S]{0,400}maxLength=\{4\}/.test(SRC.cart) && /setTableNumber\(e\.target\.value\.replace\(\/\\D\/g, ""\)\)/.test(CODE.cart));
check("P172364", FILES.cart, "a seated diner's table box is locked read-only to their own table", HOW, () => /value=\{lockedTable \|\| tableNumber\}/.test(CODE.cart) && /disabled=\{!!lockedTable\} readOnly=\{!!lockedTable\}/.test(CODE.cart));
check("P172365", FILES.cart, "R55 still stands in the code: no remembered table count on the phone (and its REJECTED note is in place)", "SRC + docs/REJECTED-IDEAS.md R55", () =>
  /REJECTED \(owner, 2026-09-14\) — docs\/REJECTED-IDEAS\.md R55/.test(SRC.cart) && !/tset\("lfh_table_count|tableCount.*tset/.test(CODE.cart));
check("P172366", FILES.cart, "R58 still stands: no per-line '⚠ contains' warning on the bill (and its REJECTED note is in place)", "SRC + docs/REJECTED-IDEAS.md R58", () =>
  /REJECTED \(owner, 2026-09-20\), docs\/REJECTED-IDEAS\.md R58/.test(SRC.cart) && !/⚠ contains|Contains: /.test(CODE.cart));
check("P172367", FILES.cart, "the bill is a TICKET with its 'Your order' heading and the totals on the same sheet (owner, 2026-09-21)", HOW, () =>
  /className="cart-ticket"/.test(CODE.cart) && /cart-ticket-head">Your order</.test(CODE.cart) && SRC.cart.indexOf('className="bill-rows"') < SRC.cart.indexOf("/cart-ticket"));
check("P172368", FILES.cart, "− / qty / + / Edit / bin are on EVERY dish line (owner: 'EDIT AND QUANTY BUTTON FOR EVERY DISH')", HOW, () =>
  /aria-label=\{`Decrease \$\{item\.title\}`\}/.test(CODE.cart) && /aria-label=\{`Increase \$\{item\.title\}`\}/.test(CODE.cart) && /aria-label=\{`Remove \$\{item\.title\}`\}/.test(CODE.cart));
check("P172369", FILES.cart, "the per-dish live words are EXACTLY the shared table bill's (one vocabulary for one state)", "SRC — components/CartPanel.tsx vs components/SessionTableBill.tsx", () => {
  const a = (SRC.cart.match(/const DISH_STATUS_LABEL: Record<string, string> = (\{[^}]+\})/) || [])[1];
  const b = (SESSION_BILL.match(/const STATUS_LABEL: Record<string, string> = (\{[^}]+\})/) || [])[1];
  return { ok: !!a && a === b, note: a };
});
check("P172370", FILES.cart, "'Wrong table? Fix it' appears only while the order is still early (received / preparing)", HOW, () => /\(o\.status === "received" \|\| o\.status === "preparing"\) && \(/.test(CODE.cart));
check("P172371", FILES.cart, "the 99 ceiling on '+' is said as information, not as a green success tick", HOW, () => /message: "Maximum 99 per dish"[\s\S]{0,140}variant: "info"/.test(CODE.cart));
check("P172372", FILES.cart, "every error toast in the bill is marked as an error (no ✓ on a failure)", HOW, () => {
  const toasts = SRC.cart.match(/new CustomEvent\("lfh:toast", \{ detail: \{[\s\S]{0,400}?\} \}\)/g) || [];
  const fails = toasts.filter((t) => /Couldn't|didn't|isn't|Sold out|no longer|refus/i.test(t) && !/variant: "error"/.test(t));
  return { ok: fails.length === 0, note: `${toasts.length} toasts, ${fails.length} unmarked` };
});
check("P172373", FILES.cart, "the full menu is fetched lazily from the cached bundle, once, on first open", HOW, () =>
  /fetch\(`\/api\/r\/\$\{tenantSlug\(\)\}\/menu-data`/.test(CODE.cart) && /if \(menuLoadedRef\.current\) return;/.test(CODE.cart));
// Round 2 (item 11): narrowed further — only while the Live-status cards themselves are on screen.
check("P172374", FILES.cart, "the live-card dish reads happen only while the bill is open", HOW, () => /const cardsShown = open && showHistory && !sessionsEnabled;/.test(CODE.cart) && /if \(!cardsShown\) return;/.test(CODE.cart));
check("P172375", FILES.cart, "the 5-second re-check runs only while the bill is open, and is cleared on close", HOW, () => /if \(!open\) return;\s*const refreshLive[\s\S]{0,120}setInterval\(refreshLive, 5000\);\s*return \(\) => clearInterval\(iv\);/.test(CODE.cart));
check("P172376", FILES.cart, "money is quoted through lib/tax.ts (splitBill / resolveTaxMode) — no second tax formula", HOW, () =>
  /splitBill\(dispLines, taxRules\)/.test(CODE.cart) && /resolveTaxMode\(dishMode\(it\.id\), taxRules\)/.test(CODE.cart) && !/\* 0\.05|\* 1\.05/.test(CODE.cart));
check("P172377", FILES.cart, "a ₹0 GST row is never printed", HOW, () => /const showTaxRow = !dispSplit\.composition && tax > 0;/.test(CODE.cart));
// re-pointed (sweep #10 T3 round 3, item 31): the record keeps recordTotal — the USD total, or 0 when the tax
// was never read; the display-domain `total` still never reaches a record
check("P172378", FILES.cart, "the stored order total is USD-domain and the shown total display-domain — never mixed", HOW, () =>
  /const recordTotal = taxKnown \? totalUsd : 0;/.test(CODE.cart) && /total: recordTotal/.test(CODE.cart) && !/total: total[,\s}]/.test(CODE.cart));
check("P172379", FILES.chef, "a double tap cannot ring twice — a synchronous lock beside the state", HOW, () => /if \(sendingRef\.current \|\| sending\) return;/.test(CODE.chef));
check("P172380", FILES.chef, "every reason button is disabled while a call is sending", HOW, () => /className="chef-reason"\s*disabled=\{sending\}/.test(CODE.chef));
check("P172381", FILES.chef, "no signal → the call is SAVED and sent later, never just 'please try again'", HOW, () => /navigator\.onLine === false[\s\S]{0,200}enqueueGuestCall\(\{ mode: "public", table: check\.value, restaurantId, reason \}\)/.test(CODE.chef));
check("P172382", FILES.chef, "the popup cannot open at all when waiter calls are switched off", HOW, () => CODE.chef.indexOf("if (!features.waiter_calls) return null;") < CODE.chef.indexOf("if (!open) return null;"));
check("P172383", FILES.chef, "the six things a diner can ask for are the owner's six, in order", HOW, () => {
  const labels = [...SRC.chef.matchAll(/label: "([^"]+)" \}/g)].map((m) => m[1]).join("|");
  return { ok: labels === "Call waiter|Water|Cutlery|Napkins|Clean table|Bring the bill", note: labels };
});
check("P172384", FILES.chef, "the restaurant's own limit refusing a QR call is NEVER reported as 'staff notified'", "SRC — handleSend, the branch order", () => {
  const b = SRC.chef.slice(SRC.chef.indexOf("const res = await callWaiter("), SRC.chef.indexOf("} catch {", SRC.chef.indexOf("const res = await callWaiter(")));
  const rl = b.indexOf('res.reason === "rate_limited"'), succ = b.indexOf("· staff notified`");
  const rlBlock = rl >= 0 ? b.slice(rl, b.indexOf("} else", rl)) : "";
  const succTest = (b.match(/if \(res\.ok && ([^)]+)\)/) || [])[1] || "";
  const guarded = (rl >= 0 && rl < succ && /variant: "error"/.test(rlBlock) && !/notified/.test(rlBlock)) || /rate_limited/.test(succTest);
  return { ok: guarded, note: rl >= 0 ? "rate_limited is answered as a refusal before the success branch" : `success test: ${succTest}` };
});
check("P172385", FILES.bell, "the bell is a real <button> with a name a screen reader says", HOW, () => /<button\s+type="button"\s+className="chef-call"\s+aria-label="Call a waiter"/.test(CODE.bell));
check("P172386", FILES.bell, "the bell is not drawn when waiter calls are off", HOW, () => /if \(!features\.waiter_calls\) return null;/.test(CODE.bell));
check("P172387", FILES.bell, "the bell asks the switch for the restaurant ON SCREEN", HOW, () => /useFeatures\(useRestaurantId\(\)\)/.test(CODE.bell));
check("P172388", FILES.bell, "R29 stands: nothing in the bell moves it out of the way of anything", "SRC + docs/REJECTED-IDEAS.md R29", () => !/bell-lift|settleBell|menu-scrolling/.test(CODE.bell));
check("P172389", FILES.chip, "the saved-orders chip draws nothing when nothing is saved", HOW, () => /if \(count === 0\) return null;/.test(CODE.chip));
check("P172390", FILES.chip, "a waiting ORDER offers no cancel; only a waiting CALL offers 'Not needed'", HOW, () => /\{isCall\(o\) && !isLeave\(o\) \? \(/.test(CODE.chip) && /Not needed/.test(CODE.chip));
check("P172391", FILES.chip, "every action button shows it was heard (busy row) and only one runs at a time", HOW, () => /if \(busyId\) return;/.test(CODE.chip) && count(CODE.chip, /disabled=\{busyId === o\.id\}/g) === 4);
check("P172392", FILES.chip, "a saved call reads as the thing asked for, never '0 items'", HOW, () => /if \(isCall\(o\)\) return callText\(o\);/.test(CODE.chip) && /if \(isLeave\(o\)\) return "Leaving your table";/.test(CODE.chip));
check("P172393", FILES.chip, "the chip's word for a mixed queue is neutral ('2 waiting to send'), never '2 orders'", HOW, () => /if \(list\.some\(isCall\) \|\| list\.some\(isLeave\)\) return `\$\{n\}`;/.test(CODE.chip));
check("P172394", FILES.chip, "a saved order's total is printed with the BILL's rounding, not the menu's (so it matches the bill)", "SRC — the formatter on the saved row's total", () => {
  const line = (SRC.chip.match(/o\.track\?\.total \? `[^`]*\$\{([a-zA-Z]+)\(/) || [])[1];
  return { ok: !!line && line !== "formatPrice", note: `formatter: ${line}` };
});
check("P172395", FILES.chip, "the body flag that lifts the tracker is removed when the chip goes", HOW, () => /return \(\) => document\.body\.removeAttribute\("data-lfh-outbox"\);/.test(CODE.chip));
check("P172396", FILES.mini, "the pill shows a SUBTOTAL only — never a tax-inclusive total", HOW, () => !/tax|splitBill|\* 1\./.test(CODE.mini.replace(/aria-label/g, "")));
check("P172397", FILES.mini, "the pill is not drawn on the 3D viewer", HOW, () => /!\(pathname && pathname\.startsWith\("\/view"\)\)/.test(CODE.mini));
check("P172398", FILES.mini, "the pill re-counts on a same-tab move between restaurants", HOW, () => /useEffect\(\(\) => \{ sync\(\); \}, \[pathname\]\);/.test(CODE.mini));
check("P172399", FILES.mini, "the pill's body flag is removed on unmount", HOW, () => /return \(\) => document\.body\.removeAttribute\("data-lfh-minicart"\);/.test(CODE.mini));
check("P172400", FILES.confirm, "adding the same dish twice is capped at 99 on the line", HOW, () => /existing\.qty = Math\.min\(99, existing\.qty \+ qty\)/.test(CODE.confirm) && /qty: Math\.min\(99, qty\)/.test(CODE.confirm));
check("P172401", FILES.confirm, "editing drops ONLY the line being edited (dish id AND its spec)", HOW, () => /cart\.filter\(\(it\) => !\(it\.id === item\.id && \(it\.sig \|\| "\[\]"\) === editSig\)\)/.test(CODE.confirm));
check("P172402", FILES.confirm, "the dish popup is a real dialog to a screen reader", HOW, () => /role="dialog" aria-modal="true"/.test(CODE.confirm));
check("P172403", FILES.confirm, "a second tap on Add cannot double-save", HOW, () => /if \(submitting\) return;/.test(CODE.confirm));
check("P172404", FILES.confirm, "the allergy section hides when the restaurant has allergies off", HOW, () => /\{features\.allergies && pickable\.length > 0 && \(/.test(CODE.confirm));
check("P172405", FILES.confirm, "the kitchen note hides when notes are off, and is not re-saved on edit", HOW, () => /\{features\.guest_note && \(/.test(CODE.confirm) && /const noteOut = features\.guest_note \? note\.trim\(\) : "";/.test(CODE.confirm));
check("P172406", FILES.tracker, "the strip re-asks the kitchen on a realtime breadcrumb, with a one-minute backstop", HOW, () =>
  /window\.addEventListener\("lfh:rt-tick", onTick\);/.test(CODE.tracker) && /setInterval\(poll, RT_BACKUP_MS\)/.test(CODE.tracker) && !/setInterval\([^,]+, \d{1,4}\)/.test(CODE.tracker));
check("P172407", FILES.tracker, "one round at a time — a breadcrumb arriving mid-round is dropped, not stacked", HOW, () => /if \(inFlight\) return;/.test(CODE.tracker));
check("P172408", FILES.tracker, "a round that could not ask is NOT counted as 'order gone'", HOW, () => /try \{ res = await getOrderStatus\(o\.id\); \}[^\n]*\n\s*catch \{ continue; \}/.test(SRC.tracker));
check("P172409", FILES.tracker, "an order the server no longer has is finalised after three ONLINE misses, never one", HOW, () => /nullCounts\.current\[o\.id\] >= 3/.test(CODE.tracker) && /navigator\.onLine === false\) continue;/.test(CODE.tracker));
check("P172410", FILES.tracker, "the round writes onto a FRESH read, touching only what it learned", HOW, () => /const fresh = read\(\)\.map\(\(o\) => \{\s*const seen = learned\.get\(o\.id\);/.test(CODE.tracker));
check("P172411", FILES.tracker, "a pending (not-yet-approved) table member sees no live progress", HOW, () => /if \(!mem\?\.approved\) \{ setDishProg\(\{ served: 0, segs: \[\] \}\); return; \}/.test(CODE.tracker));
check("P172412", FILES.tracker, "the guest never sees the staff-only 'ready' stage — it reads as preparing", HOW, () => /i\.status === "ready" \? "preparing" : i\.status/.test(CODE.tracker));
check("P172413", FILES.tracker, "only the three DEFINITIVE session endings wipe the local orders", HOW, () => /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(CODE.tracker));
check("P172414", FILES.tracker, "the strip is keyboard-usable (Enter / Space opens the Live-status tab)", HOW, () => /if \(e\.key === "Enter" \|\| e\.key === " "\) \{ e\.preventDefault\(\); openDetail\(\); \}/.test(CODE.tracker));
check("P172415", FILES.tracker, "hiding the strip tells the diner WHERE the order still is, by the name the tab actually has", "SRC — the 'Tracker hidden' toast vs the tab labels in components/CartPanel.tsx", () => {
  const sub = (SRC.tracker.match(/message: "Tracker hidden", subtitle: "([^"]+)"/) || [])[1] || "";
  const tabs = [...SRC.cart.matchAll(/onClick=\{\(\) => setShowHistory\((?:true|false)\)\}>\s*([A-Za-z ]+)/g)].map((m) => m[1].trim());
  return { ok: tabs.some((t) => sub.toLowerCase().includes(t.toLowerCase())), note: `toast: "${sub}" · tabs: ${tabs.join(" / ")}` };
});
check("P172416", FILES.tracker, "the finished-order redraw is scheduled only for a moment still AHEAD (no 10-reads-a-second loop)", HOW, () => /\(o\.finalizedAt as number\) \+ SERVED_LINGER_MS > now/.test(CODE.tracker));
check("P172417", FILES.stars, "five stars, each a keyboard-reachable control with a name that says which rating it sets", HOW, () =>
  /const STAR_COUNT = 5;/.test(CODE.stars) && /tabIndex=\{0\}/.test(CODE.stars) && /aria-label=\{`Rate \$\{i \+ 1\} \$\{i === 0 \? "star" : "stars"\}`\}/.test(CODE.stars));
check("P172418", FILES.stars, "Enter and Space pick a star, and Space does not scroll the page", HOW, () => /if \(e\.key === "Enter" \|\| e\.key === " "\) \{\s*e\.preventDefault\(\);\s*handleClick\(i \+ 1\);/.test(CODE.stars));
check("P172419", FILES.stars, "every hover listener it adds is removed on unmount", HOW, () => /enterHandlers\.forEach\(\(fn\) => fn\(\)\);\s*list\.removeEventListener\("mouseleave", onLeave\);/.test(CODE.stars));
check("P172420", FILES.stars, "the widget sends nothing — the dish page owns saving the rating", HOW, () => !/fetch\(|rpc\(|supabase/.test(CODE.stars));
check("P172421", FILES.outbox, "the queue holds no fixed-beat interval — a timer exists only while something waits", HOW, () => !/setInterval/.test(CODE.outbox));
check("P172422", FILES.outbox, "the four ceilings are named constants (6 / 6 / 6 / 25)", HOW, () =>
  /const SERVER_MAX_TRIES = 6;/.test(CODE.outbox) && /const NET_MAX_TRIES = 6;/.test(CODE.outbox) && /const BUSY_MAX_TRIES = 6;/.test(CODE.outbox) && /const MAX_QUEUED = 25;/.test(CODE.outbox));
check("P172423", FILES.outbox, "the send deadline is 15s and is feature-guarded for an older phone", HOW, () => /const SEND_TIMEOUT_MS = 15_000;/.test(CODE.outbox) && /typeof AbortSignal\.timeout === "function"/.test(CODE.outbox));
check("P172424", FILES.outbox, "the queue sends nothing the server must not trust — no price, no title in any body", HOW, () => {
  const bodies = CODE.outbox.match(/body: JSON\.stringify\(\{[^}]+\}\)/g) || [];
  return { ok: bodies.length === 3 && bodies.every((b) => !/price|title|total/.test(b)), note: `${bodies.length} bodies` };
});
check("P172425", FILES.status, "the shared status words carry no staff-only stage name", HOW, () => !/ready|on the pass|bumped/i.test(JSON.stringify(SRC.status.match(/STATUS_COPY[^;]+;/)?.[0] || "")));
check("P172426", FILES.cart, "no file in the territory imports the staff panels' outbox (two queues, two owners)", "SRC — every territory file", () =>
  Object.values(SRC).every((t) => !/panels\/outbox/.test(strip(t))));
check("P172427", FILES.cart, "no guest component in the territory reads a server-only key or the service role", "SRC — the eight components", () =>
  COMPONENTS.every((k) => !/SUPABASE_SERVICE_ROLE|supabaseAdmin|process\.env\.(?!NEXT_PUBLIC)/.test(CODE[k])));
check("P172428", FILES.cart, "no guest component writes to the database directly — every write goes through a guarded RPC or a door", "SRC — the eight components", () =>
  COMPONENTS.every((k) => !/\.from\("[a-z_]+"\)\s*\.(insert|update|delete|upsert)/.test(CODE[k])));
check("P172429", FILES.cart, "a guest can only ADD to a sale — nothing in the territory deletes, hides or edits an issued one", "SRC — every territory file + docs/COMPLIANCE-GUARDRAILS.md §3.0", () =>
  Object.values(CODE).every((t) => !/delete_bill|void_bill|lfh_delete_order|soft_delete|deleted_at\s*:/.test(t)));
