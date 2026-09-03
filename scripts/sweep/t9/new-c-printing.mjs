// SWEEP #8 · T9 · NEW CHECKS, block C+D — P62801–P62950.
// The printer status sheet, the waiting-to-print counter, the stuck badge, and the whole client
// end of the durable print queue. Every name in here was in the 69 that no ledger row mentioned.
import { row, APP, APPC, HTML, CSS, ROUTE, ROUTEC, has, hasRe, lacks, lacksRe, P } from "./lib.mjs";
import { readFileSync } from "node:fs";

const slice = (from, to) => { const a = APPC(); const i = a.indexOf(from); const j = a.indexOf(to); return i < 0 || j < 0 ? "" : a.slice(i, j); };
const WW = () => slice("function waitingWords()", "function printerStatusHtml()");
const PS = () => slice("function printerStatusHtml()", "function paintPrinterSheetStatus()");
const BADGE = () => slice("function paintPrinterBadge()", "let prSheetOff = null;");
const SHEET = () => slice("function openPrinterSheet()", "const NET_AFTER_MS");
const PK = () => slice("function printKot(order, itemRows, restaurant, opts)", "function logKotPrintFailure(");
// End anchors must be CODE — slice() reads the comment-stripped source, so a `// ═` banner
// is not there to find and the slice silently comes back empty.
const PPJ = () => slice("function processPrintJobs(jobs)", "let kdsDrawerOff = null;");
const NET = () => slice("function autoPrintNet(", "if (typeof document !== \"undefined\") {");
const SERIAL = () => slice("function printQueueSerial(", "function autoPrintNet(");

// ══ C1 · HOW FAR BEHIND THE PRINTER IS (owner, 2026-08-27) — P62801–P62830 ══
row("P62801", "the panel can say how many tickets are waiting to print", () => has(APPC(), "function waitingWords()"));
row("P62802", "a missing waiting figure is treated as none, never as undefined", () => hasRe(WW(), /const w = state\.waiting \|\| \{ n: 0, oldestMs: null \};/));
row("P62803", "the count is coerced to a number, so a string from the wire cannot break the arithmetic", () => hasRe(WW(), /const n = Number\(w\.n \|\| 0\);/));
row("P62804", "nothing waiting says so in plain words, not \"0\"", () => has(WW(), '"none — everything has printed"'));
row("P62805", "nothing waiting is classed ok, so it can never colour an alarm", () => hasRe(WW(), /text: "none — everything has printed", cls: "ok"/));
row("P62806", "a number ALWAYS travels with the age of the oldest one", () => hasRe(WW(), /text: `\$\{n\} ticket\$\{n === 1 \? "" : "s"\} — oldest \$\{age\}`/));
row("P62807", "only the AGE is allowed to raise the alarm, never the count on its own", () =>
  hasRe(WW(), /const stuck = ms >= \(state\.stuckAfterMs \|\| 60000\);/));
row("P62808", "the stuck threshold comes from the SERVER, so two screens cannot disagree about it", () => {
  const a = APPC();
  return (/state\.stuckAfterMs = typeof data\.stuckAfterMs === "number" \? data\.stuckAfterMs : 60000/.test(a) &&
          /stuckAfterMs: STUCK_AFTER_MS/.test(ROUTEC())) || "the panel holds its own copy of the threshold";
});
row("P62809", "one ticket is \"ticket\", two are \"tickets\"", () => hasRe(WW(), /n === 1 \? "" : "s"/));
row("P62810", "an age under a minute reads \"just now\", not \"0 min ago\"", () => hasRe(WW(), /ms < 60000 \? "just now"/));
row("P62811", "an age under an hour is given in whole minutes", () => hasRe(WW(), /ms < 3600000 \? Math\.round\(ms \/ 60000\) \+ " min ago"/));
row("P62812", "an age over an hour is given in hours, not 90-something minutes", () => hasRe(WW(), /Math\.round\(ms \/ 3600000\) \+ "h ago"/));
row("P62813", "the alarm class is only ever \"bad\" when the oldest is genuinely old", () => hasRe(WW(), /cls: stuck \? "bad" : "ok"/));
row("P62814", "the panel stores the waiting figure from the board read", () => has(APPC(), 'state.waiting = data.waiting || { n: 0, oldestMs: null }'));
row("P62815", "the waiting figure is counted by the SERVER, not from the panel's own job list", () => {
  // The point of the feature: when a computer owns the paper this screen is handed no jobs at all.
  return (hasRe(ROUTEC(), /const waiting = await waitingToPrint\(rid, "kot"\);/) === true &&
          lacksRe(APPC(), /state\.printJobs\.length/) === true) || "the panel counts its own jobs";
});
row("P62816", "the printer sheet's status rows are ONE function, so an open sheet can be repainted", () => has(APPC(), "function printerStatusHtml()"));
row("P62817", "an open sheet is repainted on every board read", () => hasRe(APPC(), /if \(document\.getElementById\("prSheet"\)\) paintPrinterSheetStatus\(\);/));
row("P62818", "repainting touches only the status block, keeping the cook's scroll and any mid-tap button", () =>
  hasRe(APPC(), /const host = document\.querySelector\("#prSheet \.prsheet-status"\);\s*\n?\s*if \(host\) host\.innerHTML = printerStatusHtml\(\);/));
row("P62819", "the sheet says whether automatic printing is on", () => hasRe(PS(), /<span>Automatic printing<\/span><b>\$\{state\.autoPrintKot \? "ON" : "OFF"\}<\/b>/));
row("P62820", "the sheet says where tickets print", () => hasRe(PS(), /<span>Tickets print on<\/span><b>\$\{where\}<\/b>/));
row("P62821", "the sheet says who is printing right now", () => hasRe(PS(), /<span>Printing right now<\/span><b>\$\{nowPrinting\}<\/b>/));
row("P62822", "the sheet says how many tickets are waiting", () => hasRe(PS(), /<span>Tickets waiting<\/span><b>\$\{esc\(w\.text\)\}<\/b>/));
row("P62823", "a stuck printer gets a sentence telling the cook what to DO, not just a number", () =>
  hasRe(PS(), /read the orders off this screen<\/b> and cook from it/));
row("P62824", "that sentence promises nothing is lost, because nothing is — the queue is durable", () =>
  has(PS(), "Nothing is lost: every one of them still prints, in order, the moment the printer is working."));
row("P62825", "the stuck sentence pluralises \"is/are\" correctly", () => hasRe(PS(), /\$\{w\.n === 1 \? " is" : "s are"\}/));
row("P62826", "the server's own refusal reason OUTRANKS the coarse kitchen|counter target", () => {
  const s = PS();
  return (s.indexOf("const refused = state.printRefused") < s.indexOf("refused === \"off\"")) || "the coarse target is consulted first";
});
row("P62827", "every refusal reason the server can send has words on this sheet", () => {
  // screenMayPrint's reasons, as the route maps them onto printRefused.
  const helpers = readFileSync(P("lib/printHelpers.ts"), "utf8");
  const whys = new Set([...helpers.matchAll(/why: "(\w+)"/g)].map((m) => m[1]));
  const s = PS();
  const missing = [...whys].filter((w) => w !== "computer" && !s.includes(`refused === "${w}"`));
  return missing.length === 0 || `reasons with no wording on the sheet: ${missing.join(", ")}`;
});
row("P62828", "a computer owning the paper is answered by the helper branch, not by a refusal string", () =>
  hasRe(PS(), /const hlp = state\.helper && state\.helper\.owned \? state\.helper : null;/));
row("P62829", "the helper's computer name and printer are both escaped before rendering", () =>
  hasRe(PS(), /esc\(hlp\.printer\) \+ " — from " \+ esc\(hlp\.agent\)/));
row("P62830", "a helper that has not been heard from says how long, and that tickets are waiting", () =>
  hasRe(PS(), /asleep, tickets are waiting/));

// ══ C2 · THE STUCK BADGE ON THE BAR — P62831–P62850 ══
row("P62831", "the bar carries a badge so nobody has to open the sheet to learn of a pile-up", () => has(APPC(), "function paintPrinterBadge()"));
row("P62832", "the badge appears ONLY when the oldest ticket is genuinely old", () => hasRe(BADGE(), /if \(!w\.stuck\) \{/));
row("P62833", "a not-stuck printer has the badge REMOVED, not merely hidden", () => hasRe(BADGE(), /if \(tag\) tag\.remove\(\);/));
row("P62834", "the stuck marker attribute is cleared with the badge", () => hasRe(BADGE(), /btn\.removeAttribute\("data-stuck"\);/));
row("P62835", "the badge is created once and then reused", () => hasRe(BADGE(), /if \(!tag\) \{ tag = document\.createElement\("span"\); tag\.className = "prbadge"; btn\.appendChild\(tag\); \}/));
row("P62836", "a big pile-up reads \"99+\" rather than overflowing the pill", () => hasRe(BADGE(), /tag\.textContent = w\.n > 99 \? "99\+" : String\(w\.n\)/));
row("P62837", "the badge bails harmlessly when the bar button is not on the page", () => hasRe(BADGE(), /if \(!btn\) return;/));
row("P62838", "the button's tooltip becomes the whole instruction, because a number is not an instruction", () =>
  hasRe(BADGE(), /btn\.title = `\$\{w\.n\} kitchen ticket\$\{w\.n === 1 \? "" : "s"\} waiting to print, oldest \$\{w\.age\}\. Tap to see what to do\.`/));
row("P62839", "a screen reader gets the same sentence, not a bare number", () => hasRe(BADGE(), /btn\.setAttribute\("aria-label", btn\.title\)/));
row("P62840", "the ordinary (not stuck) tooltip is restored when the pile-up clears", () =>
  hasRe(BADGE(), /btn\.title = "Report a printer problem — the manager is told right away";/));
row("P62841", "the badge is repainted on every board read", () => hasRe(APPC(), /paintPrinterBadge\(\);/));
row("P62842", "the badge class is styled", () => has(CSS(), ".prbadge"));
row("P62843", "the badge is positioned relative to its button, so it cannot land elsewhere on the bar", () => {
  const c = CSS();
  const btnRule = (c.match(/#printerBtn\s*\{[^}]*\}/) || [""])[0];
  return /position:\s*relative/.test(btnRule) || "the printer button is not a positioning context for its badge";
});
row("P62844", "the stuck state also marks the button itself, so CSS can change the button and not only add a dot", () =>
  hasRe(BADGE(), /btn\.dataset\.stuck = "1";/));
row("P62845", "the sheet and the badge read the SAME waitingWords(), so they can never disagree", () => {
  return ((PS().includes("waitingWords()") && BADGE().includes("waitingWords()"))) || "one of the two computes its own answer";
});
row("P62846", "the printer sheet cannot be opened twice", () => hasRe(SHEET(), /if \(document\.getElementById\("prSheet"\)\) return;/));
row("P62847", "the sheet's four problem kinds each carry an icon and a plain sentence", () => {
  const kinds = [...SHEET().matchAll(/\["(\w+)", "([^"]+)", "([^"]+)"\]/g)];
  return (kinds.length === 4 && kinds.every((k) => k[2].length > 0 && k[3].length > 8)) || `${kinds.length} kinds parsed`;
});
row("P62848", "reporting a problem disables ALL four buttons while it sends, so a double-tap cannot double-report", () =>
  hasRe(SHEET(), /ov\.querySelectorAll\("\[data-prkind\]"\)\.forEach\(\(x\) => \(x\.disabled = true\)\)/));
row("P62849", "a failed report re-enables the buttons and says so, rather than leaving them dead", () =>
  hasRe(SHEET(), /\} catch \(e2\) \{\s*\n?\s*ov\.querySelectorAll\("\[data-prkind\]"\)\.forEach\(\(x\) => \(x\.disabled = false\)\);\s*\n?\s*toast\("Couldn't send that/));
row("P62850", "a report saved with no signal says the manager is told when the signal is back", () =>
  hasRe(SHEET(), /r && r\.queued \? "Saved ✓ — the manager is told the moment you're back online\." : "The manager has been told ✓"/));

// ══ D1 · printKot — THE ONE PLACE PAPER COMES OUT — P62851–P62890 ══
row("P62851", "printKot never lets the restaurant name be blank on paper", () => hasRe(PK(), /restDisplayName\(restaurant\)\.replace\(\/\\\*\/g, ""\) \|\| "Kitchen"/));
// EXPECTATION CHANGED by item 9 (the owner's pick): printKot now takes an explicit label when the
// caller has one, because a DELIVERY has no table at all. A dine-in order passes none and still
// reads the table exactly as before — asserted at P63283/P63284.
row("P62852", "printKot prints the table as the FLOOR knows it, unless the caller names its own label", () =>
  hasRe(PK(), /const tlab = \(opts && opts\.tableLabel\) \|\| whereFor\(order, true\);/));
row("P62853", "printKot prints an em-dash for a missing KOT number, never \"undefined\"", () => hasRe(PK(), /const kot = order\.kot_no != null \? order\.kot_no : "—";/));
row("P62854", "printKot's date line goes through the shared kotWhen(), which prints the DAY for an old ticket", () => has(PK(), "LFH_BILLDOC.kotWhen(order.created_at)"));
row("P62855", "printKot falls back to the order's own items JSON when no rows were handed to it", () =>
  hasRe(PK(), /const rows = \(itemRows && itemRows\.length\)\s*\n?\s*\? itemRows\s*\n?\s*: \(Array\.isArray\(order\.items\) \? order\.items : \[\]\);/));
row("P62856", "printKot passes the order's allergies through to the paper", () => hasRe(PK(), /allergies: Array\.isArray\(order\.allergies\) \? order\.allergies : \[\]/));
row("P62857", "printKot prints through a HIDDEN IFRAME, not a popup a blocker would stop", () => hasRe(PK(), /const ifr = document\.createElement\("iframe"\);/));
row("P62858", "that iframe is zero-sized and off-screen, so it can never cover the board", () => hasRe(PK(), /position:fixed;right:0;bottom:0;width:0;height:0;border:0;/));
row("P62859", "the frame is removed only once the browser says printing finished", () => hasRe(PK(), /w\.onafterprint = cleanup;/));
row("P62860", "cleanup can run only once, however many times it is called", () => hasRe(PK(), /const cleanup = \(\) => \{ if \(done\) return; done = true;/));
row("P62861", "a preview somebody walks away from is cleaned up by a long fallback, not left for ever", () => hasRe(PK(), /setTimeout\(cleanup, 60000\);/));
row("P62862", "printing does NOT steal focus — a ticket never pulls the screen from the person using it", () => {
  const p = PK();
  const i = p.indexOf("try { w.print(); }");
  return (i > 0 && p.slice(0, i).indexOf("w.focus()") === -1) || "focus() is called before the print";
});
row("P62863", "focus() survives only as the fallback for a print() that actually threw", () =>
  hasRe(PK(), /catch \(e1\) \{\s*\n?\s*try \{ w\.focus\(\); w\.print\(\); \}/));
row("P62864", "a print that fails AFTER the setup un-records the ticket, so the next pass retries it", () =>
  hasRe(PK(), /printedIds\.delete\(order\.id\); savePrintedIds\(\);/));
row("P62865", "that failure is written to the Everything Log", () => hasRe(PK(), /logKotPrintFailure\(e\);/));
row("P62866", "that failure also tells the cook and the manager, through the throttled path", () => hasRe(PK(), /notePrintTrouble\(\);/));
row("P62867", "each of those three recovery steps is individually wrapped, so one cannot stop the others", () => {
  const p = PK();
  const tail = p.slice(p.indexOf("catch (e1) {"));
  return ((tail.match(/try \{[^}]*\} catch \(_e\) \{\}/g) || []).length >= 3) || "the recovery steps are not independently wrapped";
});
row("P62868", "a synchronous failure returns FALSE, so the caller can tell the cook honestly", () => {
  const p = PK();
  return (/\} catch \(e\) \{[\s\S]{0,600}return false;\s*\n?\s*\}/.test(p) && /return true;/.test(p)) || "printKot cannot report a failure";
});
row("P62869", "a synchronous failure is logged, never swallowed", () => {
  const p = PK();
  const c = p.slice(p.lastIndexOf("} catch (e) {"));
  return hasRe(c, /logKotPrintFailure\(e\)/);
});
row("P62870", "logKotPrintFailure writes to the shared error hook when it exists", () =>
  hasRe(APPC(), /if \(window\.LFH_ERRLOG && typeof window\.LFH_ERRLOG\.report === "function"\) window\.LFH_ERRLOG\.report\(msg, "printKot"\)/));
row("P62871", "logKotPrintFailure ALWAYS leaves a console trace as well", () => hasRe(APPC(), /console\.error\("\[kitchen\]", msg, e\)/));
row("P62872", "printedIds survives a reload, so a manual 🖨 after a reload is honestly a duplicate", () =>
  hasRe(APPC(), /const PRINTED_KEY = "kds_printed_ids";/));
row("P62873", "a corrupt or absent stored value simply starts empty", () => hasRe(APPC(), /\} catch \{ return \[\]; \}/));
row("P62874", "only strings are accepted back out of storage", () => hasRe(APPC(), /Array\.isArray\(raw\) \? raw\.filter\(\(x\) => typeof x === "string"\) : \[\]/));
row("P62875", "writing the set back is wrapped, so a device with storage disabled still prints", () =>
  hasRe(APPC(), /const savePrintedIds = \(\) => \{\s*\n?\s*try \{ localStorage\.setItem\(PRINTED_KEY, JSON\.stringify\(\[\.\.\.printedIds\]\)\); \} catch \{/));
row("P62876", "the seeding pass writes storage ONCE, not once per order", () => {
  const a = APPC();
  const seed = a.slice(a.indexOf("if (data.autoPrintKot) {"), a.indexOf("state.autoPrintKot = !!data.autoPrintKot"));
  return ((seed.match(/savePrintedIds\(\)/g) || []).length === 1) || "storage is written inside the loop";
});
row("P62877", "printedIds is pruned only of ids that have LEFT the board, so a prune cannot cause a reprint", () =>
  hasRe(APPC(), /for \(const id of printedIds\) if \(!ids\.has\(id\)\) printedIds\.delete\(id\);/));
row("P62878", "the prune only runs past a ceiling, so it is not work on every read", () => hasRe(APPC(), /if \(printedIds\.size > 500\)/));
row("P62879", "BOOT_TS is captured once at module load", () => hasRe(APPC(), /const BOOT_TS = Date\.now\(\);/));
row("P62880", "an order with an unreadable timestamp is treated as pre-existing, never retro-printed", () =>
  hasRe(APPC(), /if \(!Number\.isFinite\(t\) \|\| t < BOOT_TS\) printedIds\.add\(o\.id\);/));
row("P62881", "the trouble toast is throttled to once a minute", () => hasRe(APPC(), /if \(Date\.now\(\) - lastPrintTroubleAt < 60000\) return;/));
row("P62882", "the throttle stamp is set before the toast, so a re-entrant call cannot double it", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("function notePrintTrouble()"), a.indexOf("const jobsInFlight"));
  return (fn.indexOf("lastPrintTroubleAt = Date.now();") < fn.indexOf("toast(")) || "the toast fires before the stamp is taken";
});
row("P62883", "the trouble toast says the orders are still on the board, so a cook knows nothing is lost", () =>
  has(APPC(), "Kitchen tickets aren't printing — check the printer. Orders are still on the board."));
row("P62884", "the trouble report reaches the MANAGER too, not only whoever is standing here", () =>
  hasRe(APPC(), /api\("POST", "\/printer-events", \{ kind: "auto_fail", note: "Automatic KOT print failed on the kitchen screen" \}\)/));
row("P62885", "that report cannot itself throw into the print path", () => hasRe(APPC(), /"\/printer-events", \{ kind: "auto_fail"[\s\S]{0,120}\.catch\(\(\) => \{\}\)/));
row("P62886", "the route MERGES repeat auto_fail reports instead of flooding the manager's floor", () =>
  hasRe(ROUTEC(), /update\(\{ count: \(open\[0\]\.count \|\| 1\) \+ 1, last_at: nowIso\(\)/));
row("P62887", "the merge is per KIND and per PRINTER, so two printers are two problems", () =>
  hasRe(ROUTEC(), /openQ = aboutPrinter \? openQ\.eq\("printer", aboutPrinter\) : openQ\.is\("printer", null\)/));
row("P62888", "the note a person types is trimmed and capped before it is stored", () =>
  hasRe(ROUTEC(), /typeof body\?\.note === "string" \? body\.note\.trim\(\)\.slice\(0, 300\) : null/));
row("P62889", "an unknown problem kind is refused", () => hasRe(ROUTEC(), /if \(!kinds\.includes\(kind\)\) return err\("invalid problem kind"\)/));
row("P62890", "a printer name that arrives from a screen is capped too", () =>
  hasRe(ROUTEC(), /typeof body\?\.printer === "string" && body\.printer\.trim\(\)\.slice\(0, 120\)/));

// ══ D2 · THE QUEUE CLIENT — P62891–P62950 ══
row("P62891", "the claim is a plain fetch with same-origin credentials", () => hasRe(APPC(), /credentials: "same-origin"/));
row("P62892", "the claim throws on a non-OK reply, so the caller can put the jobs back", () => hasRe(APPC(), /if \(!r\.ok\) throw new Error\("claim HTTP " \+ r\.status\)/));
row("P62893", "a claim reply with no body is read as winning nothing, not as a crash", () => hasRe(APPC(), /\(await r\.json\(\)\.catch\(\(\) => \(\{\}\)\)\)\.won \|\| \[\]/));
row("P62894", "the claim carries this tab's restaurant pin", () => hasRe(APPC(), /fetch\("\/api\/kitchen" \+ ridQ\("\/print-jobs\/claim"\)/));
row("P62895", "processPrintJobs ignores an empty or non-array job list", () => hasRe(PPJ(), /if \(!Array\.isArray\(jobs\) \|\| !jobs\.length\) return;/));
row("P62896", "a job with no order attached is skipped rather than printed blank", () => hasRe(PPJ(), /jobs\.filter\(\(j\) => j && j\.order/));
row("P62897", "a job already being printed by this tab is never picked up twice", () => hasRe(PPJ(), /&& !jobsInFlight\.has\(j\.id\)/));
row("P62898", "jobs are marked in-flight BEFORE the claim goes out", () => {
  const p = PPJ();
  return (p.indexOf("fresh.forEach((j) => jobsInFlight.add(j.id));") < p.indexOf("claimPrintJobs(")) || "the claim races the in-flight guard";
});
row("P62899", "jobs another screen won are released from this tab's in-flight set", () =>
  hasRe(PPJ(), /fresh\.filter\(\(j\) => !wonSet\.has\(j\.id\)\)\.forEach\(\(j\) => jobsInFlight\.delete\(j\.id\)\)/));
row("P62900", "only the jobs this screen WON are printed", () => hasRe(PPJ(), /const mine = fresh\.filter\(\(j\) => wonSet\.has\(j\.id\)\);/));
row("P62901", "prints are serialized 400ms apart, so a burst cannot stack blocking dialogs", () => hasRe(PPJ(), /if \(i < mine\.length\) setTimeout\(step, 400\);/));
row("P62902", "a retried job is branded on the paper, because the first attempt may have printed after all", () =>
  hasRe(PPJ(), /reprint: j\.reprint !== false \|\| \(j\.attempts \|\| 0\) > 0/));
row("P62903", "an AUTO job is not branded a duplicate on its first attempt", () => {
  // mig 335 inserts reprint=false explicitly, so `j.reprint !== false` is false for an auto job.
  const mig = readFileSync(P("supabase/migrations/335_a_kitchen_ticket_queues_itself.sql"), "utf8");
  return hasRe(mig, /INSERT INTO print_jobs \(restaurant_id, kind, order_id, reprint, requested_by\)\s*\n\s*VALUES \(NEW\.restaurant_id, 'kot', NEW\.id, false, 'Auto-print'\)/);
});
row("P62904", "a queue-printed ticket is recorded against its ORDER, so the net and the 🖨 both know", () =>
  hasRe(PPJ(), /if \(okPrint && j\.order && j\.order\.id\) \{ printedIds\.add\(j\.order\.id\); savePrintedIds\(\); \}/));
row("P62905", "a queue print that failed tells the cook", () => hasRe(PPJ(), /if \(!okPrint\) notePrintTrouble\(\);/));
row("P62906", "the done report is sent whichever way the print went", () => hasRe(PPJ(), /\{ ok: okPrint, error: okPrint \? undefined : "print call failed on the kitchen screen" \}/));
row("P62907", "the job leaves the in-flight set once the report settles, either way", () => hasRe(PPJ(), /\.finally\(\(\) => jobsInFlight\.delete\(j\.id\)\)/));
row("P62908", "a failed claim releases every job, so the next board pass can retry", () =>
  hasRe(PPJ(), /\.catch\(\(\) => fresh\.forEach\(\(j\) => jobsInFlight\.delete\(j\.id\)\)\)/));
row("P62909", "processPrintJobs no longer refuses while the window is hidden", () => lacksRe(PPJ(), /document\.hidden/));
row("P62910", "the self-healing net does nothing when auto-print is off", () => hasRe(NET(), /if \(!autoOn\) return;/));
row("P62911", "the net does nothing when the server did not say what is queued", () => hasRe(NET(), /if \(!Array\.isArray\(queuedFor\)\) return;/));
row("P62912", "the net only considers orders that are still received or preparing", () =>
  hasRe(NET(), /if \(o\.status !== "received" && o\.status !== "preparing"\) return false;/));
row("P62913", "the net skips an order this screen has printed, or that the queue has in hand", () =>
  hasRe(NET(), /if \(printedIds\.has\(o\.id\) \|\| queued\.has\(String\(o\.id\)\)\) return false;/));
row("P62914", "the net waits 20 seconds, so in normal service it never fires at all", () => hasRe(APPC(), /const NET_AFTER_MS = 20000;/));
row("P62915", "an order with an unreadable timestamp is never retro-printed by the net", () =>
  hasRe(NET(), /return Number\.isFinite\(t\) && t < cutoff;/));
row("P62916", "the queued list is compared as strings, so a numeric id cannot slip past it", () => hasRe(NET(), /const queued = new Set\(queuedFor\.map\(String\)\);/));
row("P62917", "the serial printer marks a ticket printed ONLY if it actually printed", () =>
  hasRe(SERIAL(), /if \(printKot\(o, \(allItems \|\| \[\]\)\.filter\(\(it\) => it\.order_id === o\.id\), restaurant\)\) \{ printedIds\.add\(o\.id\); savePrintedIds\(\); \}/));
row("P62918", "a failure in the serial printer tells the cook rather than consuming the ticket", () => hasRe(SERIAL(), /else notePrintTrouble\(\);/));
row("P62919", "the serial printer spaces its prints 400ms apart", () => hasRe(SERIAL(), /setTimeout\(step, 400\)/));
row("P62920", "the serial printer ignores an empty queue", () => hasRe(SERIAL(), /if \(!queue \|\| !queue\.length\) return;/));
row("P62921", "coming back from hidden is just a board read — the queue comes with it", () =>
  hasRe(APPC(), /document\.addEventListener\("visibilitychange", \(\) => \{\s*\n?\s*if \(document\.hidden \|\| !state\.autoPrintKot\) return;[\s\S]{0,600}load\(\)\.catch\(\(\) => \{\}\);/));
row("P62922", "the live socket is kept alive while THIS screen is the printer", () => hasRe(APPC(), /keepAlive: \(\) => !!state\.autoPrintKot/));
row("P62923", "the 60s backstop still runs for a printing screen even when the window is covered", () =>
  hasRe(APPC(), /if \(!document\.hidden \|\| state\.autoPrintKot\) load\(\)/));
row("P62924", "the panel asks for the auto rows only by opting in, so an old panel cannot double-print", () =>
  hasRe(APPC(), /api\("GET", "\/board\?autojobs=1"\)/));
row("P62925", "the route hands the auto rows ONLY to a panel that asked", () => hasRe(ROUTEC(), /const autoJobs = new URL\(req\.url\)\.searchParams\.get\("autojobs"\) === "1";/));
row("P62926", "the route also refuses to hand them over when this room is not the printer", () =>
  hasRe(ROUTEC(), /const printJobs = await pendingKotJobs\(rid, \{ includeAuto: autoJobs && screenPrints \}\);/));
row("P62927", "the targeted slice carries the queue only while this screen is printing", () => hasRe(APPC(), /const jobsQ = state\.autoPrintKot \? "&jobs=1" : "";/));
row("P62928", "the route honours that jobs=1 on the targeted path", () => hasRe(ROUTEC(), /const wantJobs = new URL\(req\.url\)\.searchParams\.get\("jobs"\) === "1";/));
row("P62929", "the targeted slice's job read is only issued when asked", () => hasRe(ROUTEC(), /wantJobs \? pendingKotJobs\(rid, \{ includeAuto: true \}\) : Promise\.resolve\(\[\]\)/));
row("P62930", "the panel prints whatever rode along on the targeted slice", () =>
  hasRe(APPC(), /const jl = slices\.map\(\(s\) => s && s\.printJobs\)\.filter\(\(j\) => Array\.isArray\(j\) && j\.length\)\.pop\(\); if \(jl\) processPrintJobs\(jl\);/));
row("P62931", "the net is deliberately stood down on the targeted path (it has no queuedFor to trust)", () =>
  hasRe(APPC(), /autoPrintNet\(state\.autoPrintKot, freshOrders, freshItems, state\.restaurant, null\)/));
row("P62932", "who may print is decided in ONE place on the server", () => hasRe(ROUTEC(), /const mayI = screenMayPrint\(target, \{ panel: "kitchen", personId: g\.user\?\.id \|\| null, deviceId: deviceIdFrom\(req\) \}\)/));
row("P62933", "the claim re-asks that same question, because a stale tab still believes it may print", () =>
  hasRe(ROUTEC(), /const may = screenMayPrint\(tgt, \{ panel: "kitchen", personId: g\.user\?\.id \|\| null, deviceId: dev \}\)/));
row("P62934", "the claim takes the person and device from the REQUEST, never from the panel's word for itself", () => {
  const r = ROUTEC();
  const claim = r.slice(r.indexOf('if (a === "print-jobs" && b === "claim")'), r.indexOf('if (a === "print-station" && b === "take")'));
  return lacksRe(claim, /body\?\.panel|body\.personId|body\.deviceId/);
});
row("P62935", "a refused claim answers WHY, and where printing happens instead", () =>
  hasRe(ROUTEC(), /return ok\(\{ won: \[\], refused: may\.why === "computer" \? "helper" : may\.why, printTarget: tgt,/));
row("P62936", "a refused claim wins nothing — it never returns ids the panel would print", () => hasRe(ROUTEC(), /return ok\(\{ won: \[\], refused/));
row("P62937", "the ROUTE decides which room prints, and the retired coarse column does not get a vote", () => {
  const r = ROUTEC();
  return (/if \(target\.kind === "screen"\) kitchenMayAuto = target\.panel === "kitchen";/.test(r) &&
          !/kot_print_target/.test(r.slice(r.indexOf("let kitchenMayAuto")))) || "the retired setting still votes";
});
row("P62938", "a computer owning the paper stops this screen being offered tickets", () =>
  hasRe(ROUTEC(), /else if \(target\.kind === "off" \|\| target\.kind === "computer"\) kitchenMayAuto = false;/));
row("P62939", "print-station/take refuses without a device id, rather than taking the station for nobody", () =>
  hasRe(ROUTEC(), /if \(!dev\) return err\("This browser has no device id yet — reload the panel and try again\.", 409\)/));
row("P62940", "print-station/take refuses when automatic printing is off for the restaurant", () =>
  hasRe(ROUTEC(), /return err\("Automatic printing is switched off for this restaurant\.", 409\)/));
row("P62941", "print-station/take refuses when a computer owns the paper, in words a person can act on", () =>
  has(ROUTEC(), '"A computer prints this restaurant\'s kitchen slips — no screen needs to."'));
row("P62942", "print-station/take refuses when another screen is the named one", () =>
  has(ROUTEC(), '"Kitchen slips are set to print on another screen."'));
row("P62943", "taking the station is written to the Activity log in plain words", () =>
  has(ROUTEC(), 'detail: "this kitchen screen is now the printer"'));
row("P62944", "releasing the station is logged too", () => has(ROUTEC(), 'detail: "this kitchen screen stopped printing"'));
row("P62945", "releasing without a device id still answers, rather than throwing", () => hasRe(ROUTEC(), /if \(dev\) await releaseStation\(rid, dev\);/));
row("P62946", "the done report refuses an unknown job id with a plain sentence", () => hasRe(ROUTEC(), /if \(!r\.found\) return err\("That print job is gone\.", 404\)/));
row("P62947", "a successful print is logged as INFO, so normal service never colours the log", () => {
  const r = ROUTEC();
  const ok = r.slice(r.indexOf('logAction("kitchen", "kot_printed"'), r.indexOf('return ok({ ok: true });'));
  return lacksRe(ok, /level: "warn"|level: "error"/);
});
row("P62948", "giving up after five tries IS logged as a warning — a ticket never reached the pass", () =>
  hasRe(ROUTEC(), /level: r\.parked \? "warn" : "info"/));
row("P62949", "a still-retrying failure says which try it was", () => hasRe(ROUTEC(), /try \$\{r\.attempts\} failed/));
row("P62950", "the error text from the screen is capped before it is stored", () => {
  const r = ROUTEC();
  return ((r.match(/String\(body\?\.error \|\| "print failed"\)\.slice\(0, 120\)/g) || []).length >= 2) || "an uncapped error string reaches the log";
});
