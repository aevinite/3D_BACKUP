// verify-print-queue.mjs — auto-print is a QUEUE, and must never go back to being a tab noticing.
//
// WHY THIS EXISTS (owner, 2026-08-17). The kitchen has no room for a PC, so the kitchen panel sat in
// a Chrome tab on a shared computer: "if you minimize, or open another app in the same PC, the KOT
// prints totally stop". Four things switched printing off whenever that tab was not the front
// window — three of them OUR OWN CODE deliberately refusing to print while `document.hidden`, which
// was the honest thing to do back when a missed ticket was gone forever.
//
// Migration 335 removed the reason: a ticket is now a ROW in print_jobs (mig 269's durable queue), so
// a print that does not happen is requeued rather than lost, and TRYING is always right. Every check
// below is one half of that change that would look like a bug to somebody who did not read this file:
//
//   • the refusals are gone from the print path (they read like a safety net; they were the fault),
//   • the TARGETED ?table= slice carries the queue (a new order's breadcrumb NAMES its table, so the
//     targeted read is what answers it — without jobs=1 a ticket waited for the 60s backstop),
//   • an auto job raises NO breadcrumb of its own (it rides the order's, or every ticket costs every
//     panel a whole-floor reload),
//   • both routes claim through lib/printQueue.ts (two hand-kept claims is how a ticket prints twice),
//   • the printing screen keeps its socket + backstop while hidden, and ONLY the printing screen,
//   • the manager's per-device switch and its server-enforced backup window still exist.
//
// READ-ONLY, repo files only — no database, no login, no browser.
//
//   node scripts/verify-print-queue.mjs        (npm run verify:print-queue)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const QUIET = process.argv.includes("--quiet");
let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ok   " + m); };
const fail = (m) => { console.log("  FAIL " + m); failed++; };
// JUDGE THE CODE, NOT THE NOTE ABOUT IT. Every "this is gone" check below would otherwise match
// the obituary comment explaining WHY it is gone — which is exactly how this file went red the
// minute the backup printer was removed. Same stripper verify-print-helper.mjs uses.
const codeOnly = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

const check = (cond, good, bad) => (cond ? pass(good) : fail(bad));

console.log("\nprint queue — a ticket is a row, and any screen can be the printer");

const mig = read("supabase/migrations/335_a_kitchen_ticket_queues_itself.sql");
const kroute = read("app/api/kitchen/[...path]/route.ts");
const eroute = read("app/api/editor/[...path]/route.ts");
const kpanel = codeOnly(read("public/panels/kitchen/app.js"));
// ⚠️ THE PANEL SOURCES ARE READ COMMENT-STRIPPED, AND THAT IS THE POINT (2026-08-31).
// Two checks in this file were passing on their own obituaries. They required `data-printhere-set`,
// `printStationStripHtml` and `data-kstation` — a per-device question, a band across the floor and
// a take-over button, all three deliberately retired. The code went; the comments EXPLAINING that it
// went stayed; the regexes went on matching, and the file reported three protections that no longer
// existed. A guard that reads comments is testing the story, not the program.
// So: judge these two files by their code. If a check ever genuinely needs to assert that a comment
// is present (an obituary that must not be dropped), read the raw file explicitly and say why.
const epanel = codeOnly(read("public/panels/editor/app.js"));
const rt = read("public/panels/realtime.js");
const lib = read("lib/printQueue.ts");

// ── 1. the database still queues the ticket ─────────────────────────────────────────────────────
check(/CREATE TRIGGER trg_kot_queue_autoprint\s+AFTER INSERT ON orders/i.test(mig),
  "mig 335 still queues a job on every new order (trigger on orders)",
  "mig 335 no longer creates trg_kot_queue_autoprint — nothing would queue a ticket and auto-print would go silent");
check(/auto_print_kot IS TRUE AND auto_print_kot_allowed IS TRUE/i.test(mig),
  "it queues only when BOTH mig-107 rungs are on (admin allowed + owner switched on)",
  "the trigger no longer checks both auto-print rungs — a restaurant that never asked for auto-print would print");
check(/deleted_at IS NOT NULL THEN RETURN NEW/i.test(mig),
  "a soft-deleted order queues nothing (a ticket off the books is not cooked again)",
  "the trigger lost its deleted_at guard — a removed bill could reach the printer");
check(/reprint\s*\)\s*\n?\s*VALUES[\s\S]{0,120}false/i.test(mig) || /'kot', NEW\.id, false/.test(mig),
  "an auto job is reprint=false, so a first ticket carries no DUPLICATE banner",
  "the auto job no longer sets reprint=false — every automatic ticket would print branded a duplicate");
check(/WHEN \(NEW\.reprint IS TRUE\)/.test(mig),
  "an auto job raises NO realtime breadcrumb (it rides the order's own event)",
  "rt_emit_print_jobs fires for auto jobs again — every ticket now forces a whole-floor reload on every panel (mig 335 removed exactly this cost)");
check(/REVOKE ALL ON FUNCTION lfh_kot_queue_autoprint\(\) FROM PUBLIC, anon, authenticated/i.test(mig),
  "the trigger function is revoked from PUBLIC, anon AND authenticated (verify:grants' rule)",
  "the trigger function's REVOKE no longer names anon+authenticated — on Supabase those are granted in their own right");

// ── 2. ONE implementation of the claim ──────────────────────────────────────────────────────────
for (const [name, src] of [["kitchen", kroute], ["editor", eroute]]) {
  check(/from "@\/lib\/printQueue"/.test(src),
    `${name} route claims through lib/printQueue.ts`,
    `${name} route no longer imports lib/printQueue — two hand-kept claims is how the same ticket prints twice`);
  check(!/from\("print_jobs"\)[\s\S]{0,200}\.update\(\{ status: "printing"/.test(src),
    `${name} route has no second, hand-rolled claim`,
    `${name} route flips a job to 'printing' itself instead of using claimKotJobs — the lock must live in one place`);
}
check(/\.or\(liveFilter\(\)\)[\s\S]*\.or\(liveFilter\(\)\)/s.test(lib),
  "what is OFFERED and what can be WON use the same live filter, so they cannot drift",
  "lib/printQueue no longer shares one filter between the read and the claim");
// The backup-printer WINDOW is retired with the backup printer. `minAgeMs` survives in the queue as
// a parameter nothing passes a value to any more; what matters is that no caller can hand a screen
// somebody else's ticket after a wait, because there is no "somebody else's ticket" to wait for.
check(!/t\.backup \? BACKUP_PRINTER_MS/.test(codeOnly(eroute)),
  "no screen waits for a window and then takes another room's ticket",
  "the backup-printer window is back: a ticket appearing in a second room is what he asked to be removed");

// ── 2b. a ticket nobody can cook LEAVES the queue (both found on 2026-08-18) ────────────────────
check(/the order was deleted before this ticket printed/.test(lib),
  "a job whose ORDER IS GONE is retired, not silently skipped",
  "orphaned jobs are skipped again — the read takes the OLDEST rows, so a handful of dead ones sit at the head of the queue and NOTHING PRINTS AGAIN (measured: 14 dead jobs, a fresh order printed by nobody, no error anywhere)");
check(/the order was cancelled before this ticket printed/.test(lib) && /=== "cancelled"/.test(lib),
  "a job whose order was CANCELLED is retired too — the kitchen never cooks a cancelled ticket",
  "a cancelled order's ticket can reach the printer again; an order cancelled seconds after it queued would be cooked");
// The rule is unchanged; where the answer comes from is not. Since mig 369 the kitchen room is
// decided by the Kitchen slips ROUTE through screenMayPrint — not by mig 336's coarse column, which
// could contradict it (the sweep caught the older one winning). So the check asserts the ROUTE is
// consulted, and that the retired column is NOT.
check(/kitchenMayAuto/.test(kroute) && /screenMayPrint\(/.test(kroute)
  && !/kot_print_target/.test(kroute.replace(/^\s*\/\/[^\n]*$/gm, "")),
  "the KITCHEN room is decided by the Kitchen slips route, so 'the counter prints' does not print in both rooms",
  "the kitchen route ignores the route, or reads the retired kot_print_target again — with the counter chosen, a kitchen screen left open prints the same ticket in the other room (measured)");
check(/reprint/.test(kroute) && /A MANUAL REPRINT IS DIFFERENT/.test(kroute),
  "…while a MANUAL reprint still always reaches the kitchen printer",
  "the kitchen's manual reprint is now routed by the automatic setting — the manager pressing 'Reprint in kitchen' is naming that printer on purpose");

// ── 3. the panels no longer refuse to print while hidden ────────────────────────────────────────
// CODE ONLY. The first version of this check read the function WITH its comments and failed on the
// comment that EXPLAINS why the refusal was removed ("this used to return early on document.hidden")
// — a guard that fails on its own explanation is a guard that teaches people to delete explanations.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
const procJobs = stripComments(kpanel.slice(kpanel.indexOf("function processPrintJobs"), kpanel.indexOf("function processPrintJobs") + 2200));
check(!/document\.hidden/.test(procJobs),
  "the kitchen's print path does NOT refuse to print while the window is hidden/covered",
  "processPrintJobs checks document.hidden again — that IS the owner's bug (a covered window printed nothing). A print that fails is requeued; refusing is what loses tickets");
check(!/function autoPrintNew\b/.test(kpanel) && /function autoPrintNet\b/.test(kpanel),
  "the old board-diff auto-print is gone; only the 20s NET remains",
  "autoPrintNew is back — the board diff and the queue would both print, twice per ticket");
check(/queuedFor/.test(kpanel) && /queuedFor/.test(kroute),
  "the net only prints an order the queue has NO row for (server-supplied queuedFor)",
  "the net no longer consults queuedFor — it can race the queue into a second sheet");
check(/\(j\.attempts \|\| 0\) > 0/.test(kpanel) && /\(j\.attempts \|\| 0\) > 0/.test(epanel),
  "a RETRY stamps the DUPLICATE banner on both panels (the first sheet may have printed)",
  "a retried ticket no longer says Duplicate — two identical tickets on the rail is the exact confusion the banner exists for");

// ── 4. a new order reaches the printer NOW, not on the 60s backstop ─────────────────────────────
check(/board\?table=" \+ encodeURIComponent\(t\) \+ jobsQ/.test(kpanel) && /state\.autoPrintKot \? "&jobs=1"/.test(kpanel),
  "the kitchen's TARGETED refetch asks for the queue while this screen is printing (&jobs=1)",
  "the targeted ?table= read no longer carries the queue — a new order's breadcrumb names its table, so its ticket would wait for the 60s backstop");
check(/searchParams\.get\("jobs"\) === "1"/.test(kroute),
  "the kitchen route answers ?jobs=1 on the targeted slice",
  "the kitchen route ignores ?jobs=1 — the panel would ask for the queue and be handed nothing");
check(/autojobs=1/.test(kpanel) && /searchParams\.get\("autojobs"\) === "1"/.test(kroute),
  "the panel-version handshake is intact (?autojobs=1): an OLD panel is never handed auto jobs",
  "the autojobs handshake is gone — a device still running last month's app.js would print every ticket twice");
check(/if (\(|!)?document\.hidden \|\| state\.autoPrintKot\)|!document\.hidden \|\| state\.autoPrintKot/.test(kpanel),
  "the 60s backstop keeps running on a hidden screen that is the printer",
  "the kitchen's 60s backstop skips a hidden tab again — the printing screen would have no heartbeat while covered");

// ── 5. the live socket survives a covered window, on the printing screen only ───────────────────
check(/keepAlive/.test(rt) && /holdOpen\(\)/.test(rt),
  "realtime.js honours keepAlive() — a screen that is printing keeps its channels while hidden",
  "realtime.js dropped keepAlive — a covered printing screen stops hearing about orders after 120s");
check(/keepAlive: \(\) => !!state\.autoPrintKot/.test(kpanel),
  "only a screen with auto-print ON holds the socket open (the egress rule still applies to displays)",
  "the kitchen holds its socket open unconditionally — that is the connection budget the owner asked us to protect");

// ── 6. WHO may print: the admin's choice + the device's own answer (mig 336) ─────────────────────
const mig336 = read("supabase/migrations/336_which_screen_prints_the_ticket.sql");
const admin = read("components/admin/RestaurantSettings.tsx");
const adminRoute = read("app/api/admin/restaurants/settings/route.ts");
// ── kot_print_target IS RETIRED (mig 369) ─────────────────────────────────────────────────────
// It asked the same question as the Kitchen slips line, in older and vaguer words, and the two could
// contradict each other. Its three answers live in the route now:
//   kitchen → a screen route on the kitchen panel
//   counter → a screen route on the manager panel
//   both    → a screen route on the kitchen panel WITH backupPanel = manager
// The column stays (schema changes here are additive, one folder feeds two databases) but nothing
// may read or write it. These three checks are what stop it creeping back.
const mig369 = read("supabase/migrations/376_the_old_coarse_print_target_becomes_a_route.sql");
check(/kot_print_target/.test(mig336) && /'kitchen', 'counter', 'both'/.test(mig336),
  "mig 336 is untouched — the column and its CHECK constraint stay where they were",
  "mig 336 was edited. A migration that has run everywhere is history: retire a column in a NEW file, never by rewriting the old one");
check(/backupPanel/.test(mig369) && /lfh_already_applied/.test(mig369),
  "mig 369 carried every restaurant's old value into the Kitchen slips line, once",
  "mig 369 lost the carry-across or its idempotency marker. Two of the dev restaurants were on 'both' with no route — deleting the setting without moving its meaning silently changes how they print");
{
  const readers = [
    ["the kitchen route", kroute],
    ["the manager route", read("app/api/editor/[...path]/route.ts")],
    ["the admin printing API", read("app/api/admin/printing/[...path]/route.ts")],
    ["the admin settings form", admin],
    ["the admin settings write route", adminRoute],
    ["the owner settings route", read("app/api/owner/settings/route.ts")],
    ["the Printing board", read("app/aevinite/printing/page.tsx")],
  ];
  const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const guilty = readers.filter(([, t]) => /kot_print_target/.test(strip(t))).map(([n]) => n);
  check(guilty.length === 0,
    "…and no code reads or writes it any more — the route is the only answer",
    `${guilty.join(", ")} still touches kot_print_target. Two settings for one question is what made the manager screen refuse the owner's own choice in August; derive it from the Kitchen slips route instead.`);
}
// ── THERE IS NO BACKUP SCREEN, AND THAT IS THE RULE NOW (owner, 2026-08-30) ─────────────────
// This used to REQUIRE backupPanel: "the kitchen prints, the counter picks up what it leaves" was
// where the retired kot_print_target='both' went (mig 369), and losing it was described here as two
// restaurants losing their safety net.
//
// He removed the idea outright: *"what is this backup printer and all that — we don't even need the
// backup printer. If there is a backup printer, remove it. If anything fails it should show me or
// the person: manager, owner, everyone should get a notification that this has failed, and if you
// want to reprint it."*
//
// It was never much of a safety net. Two waits for one idea (60s for a backup PRINTER, 30s for a
// backup SCREEN, neither screen mentioning the other), and what it bought was paper appearing in a
// room nobody is standing in while the restaurant never learns its printer is broken. The
// replacement is not a shorter wait: it is TELLING SOMEBODY.
const pq = read("lib/printQueue.ts");
// ⚠️ IT ASKED ONE FILE, AND THE DELETION SPANNED SEVEN (2026-08-31). This named lib/printHelpers.ts
// only — where the fields were DEFINED — so it went green while app/api/editor still accepted
// `backupAgent`/`backupPrinter` off a request body and stamped them onto every route it saved, and
// app/api/owner/settings still had a `k.backupPanel ? "both"` branch that could never be true.
// A field that can still be WRITTEN is not a deleted field. The whole tree is asked now, so the
// next deletion cannot hide in the file nobody named.
const BACKUP_SRC = [
  "lib/printHelpers.ts", "lib/printQueue.ts", "lib/printDocs.ts",
  "app/api/editor/[...path]/route.ts", "app/api/kitchen/[...path]/route.ts",
  "app/api/admin/printing/[...path]/route.ts", "app/api/print-agent/[...path]/route.ts",
  "app/api/owner/settings/route.ts", "app/aevinite/printing/page.tsx",
  "app/owner/settings/page.tsx", "public/panels/editor/app.js", "public/panels/kitchen/app.js",
];
const backupHits = BACKUP_SRC.filter((f) => /backupPanel|backupPrinter|backupAgent|backupAfterMs/.test(codeOnly(read(f))));
check(backupHits.length === 0,
  `no backup screen or printer survives anywhere in the printing path (${BACKUP_SRC.length} files asked)`,
  "backupPanel is back in the route model: a second room quietly taking the ticket is what he asked to be rid of");
check(/parked/.test(pq) && /printer_events/.test(pq) && /auto_fail/.test(pq) && /sendOwnerAlert/.test(pq),
  "…and a ticket that gives up FILES a printer problem and pings the owner, so the failure is seen",
  "a parked ticket tells nobody: without the backup printer, a silent failure is a kitchen that never gets its slip and never finds out");
// The old check here asserted that the admin settings route SANITISED kot_print_target to one of
// three values. There is nothing left to sanitise: the key is off the write allow-list (mig 369), so
// the rule to assert is that it cannot be written at all. The screen-route validator does the
// equivalent job now — writeRoutes refuses a panel that is not one of the four, and refuses a backup
// screen that is the same screen.
check(/isRoutePanel\(panel\)/.test(read("lib/printHelpers.ts")),
  "…and the route validator still accepts only real panels",
  "writeRoutes stopped checking the panel names — a route naming a panel that does not exist would print nowhere while looking set");
check(/async function counterPrintTarget/.test(eroute) && (eroute.match(/counterPrintTarget\(rid\)/g) || []).length >= 2,
  "the editor route re-asks WHO may print at the claim as well as at the read (never trusts the panel)",
  "the counter-print gate is asked once or not at all — a screen left open from before the setting changed would keep claiming tickets");
// The 30-second constant is retired with the thing it timed. It was one of the TWO numbers for one
// idea the owner objected to (30 for a backup screen, 60 for a backup printer, neither screen
// mentioning the other) — and the answer to "should they be the same number?" turned out to be
// "there should be no number, because there is no backup".
check(!/BACKUP_PRINTER_MS/.test(codeOnly(eroute)),
  "…and no backup window is timed anywhere, because nothing is waiting its turn",
  "a backup window is back in the editor route");
// ⚠️ THIS CHECK WAS PASSING ON ITS OWN OBITUARY (2026-08-31). It required the literal strings
// `data-printhere-set` and `printStationStripHtml` — the per-device "should this screen print?"
// question and the band that carried it. Both were retired: the question was a second answer to
// something the admin had already decided, and the band came off the floor. But it read `epanel`
// RAW, so once the code was gone it went on matching the COMMENTS describing their removal, and
// reported a protection that no longer existed. Comment-stripped now, and pointed at the rule.
//
// THE RULE, which never changed: a phone must never claim the printing job. The mechanism did —
// the admin names a PERSON, and that person may well open their phone — so what is asserted is the
// live gate: no auto-claim unless the pointer is fine (a real computer), and no per-device question.
check(!/data-printhere-set/.test(epanel),
  "…and the retired per-device question has not come back as a second way to answer it",
  "the per-device print question is back — the admin's choice and the browser's now disagree");
// ASSERT THE RULE, NOT THE WORDING (this file's own header). This used to require the literal
// `if (ans === "off") return;` as the FIRST thing managerPrintPass did. That line legitimately
// changed shape in mig 341: a device that has said "never print here" must still be able to SAY
// where the paper comes out when a helper program owns it, so it now asks the server ONCE for the
// display and still prints nothing. The rule that matters is unchanged and is what is checked:
// nothing is printed unless this device answered YES.
// ── THE RULE SURVIVED ITS MECHANISM (2026-08-29) ─────────────────────────────────────────────
// This used to require the literal `ans !== "on") return;` — the per-device question every screen
// asked itself. The owner abolished that question: the admin names ONE person on the Printing board
// and no screen re-opens the decision ("remove old logic, keep only one logic").
//
// But the DANGER it guarded is untouched, and it is his own words on the "May be the printer" row:
// a phone that takes a ticket puts it in a dialog nobody looks at, and the kitchen never gets the
// paper. So the rule is asserted against the new mechanism instead of the old spelling: a coarse
// pointer — a touch screen with no mouse — never claims the printer.
check(/pointer: coarse/.test(epanel) && /looksLikeAComputer/.test(epanel),
  "a phone never claims the printer (a coarse pointer does not auto-claim)",
  "the manager panel will auto-claim printing on a touch device — a phone that takes a ticket drops it into a dialog nobody looks at while the kitchen waits");
check(/helper: \(r && r\.helper\) \|\| null/.test(epanel) && /helperKey/.test(epanel),
  "…and it carries the helper's answer, so a screen can say which computer prints instead",
  "the panel dropped the helper field again — every line about it goes invisible while the server is right (mig 341)");
// ── THE FLOOR IS FOR TABLES (owner, 2026-08-30) ──────────────────────────────────────────────
// This used to REQUIRE both printing strips across the top of the floor, and its failure message
// still argued from a model retired two changes earlier ("the question would never be asked") —
// there is no question any more: the admin names one person on the Printing board.
//
// He then looked at what was left and said: *"I don't want it there — it should be in the
// notification thing that we have built… why is it taking the space of the table boxes."* So the
// rule is inverted: nothing about printing is painted across the table grid, and printing reaches
// people through the bell, which is where a notification belongs.
check(!/\$\{printStationStripHtml\(\)\}|\$\{printerStripHtml\(\)\}/.test(codeOnly(epanel)),
  "no printing band is painted across the floor — the table grid keeps its space",
  "a printing strip is back above the tables: that is the space he asked for back, twice");
check(/kind: "printer"/.test(codeOnly(epanel)) && /printer-problem:/.test(codeOnly(epanel)),
  "…and printing speaks through the notification bell instead, problems first",
  "printing was taken off the floor and not put anywhere — a printer problem would now be invisible");

// ── 7. the setup guide is IN the app, and reachable from a screen that is not hidden ────────────
const guide = read("public/print-setup.html");
// The three-OS structure is asserted by SECTION ID below (the headings are numbered and worded for a
// reader, and re-asserting their prose is how a guard goes red over an edit that improved the page).
check(guide.length > 30000,
  `the in-app setup guide is a real guide (${Math.round(guide.length / 1024)} KB)`,
  "public/print-setup.html has shrunk to a stub");
check(/window\.print\(\)/.test(guide),
  "…with the save-as-PDF button he asked for",
  "the guide lost the save-as-PDF button");
// NOTHING IS OFFERED AS A DOWNLOAD any more, anywhere. On a Mac a downloaded script is the
// "Apple could not verify… / Move to Bin" dialog with no way past it on Sequoia; on Windows it is
// SmartScreen. A file the person pastes into Notepad/TextEdit/nano themselves has neither.
check(!/api\/print-station\/(mac|windows|linux)/.test(guide) && !/download>/.test(guide),
  "the guide offers NO file to download — every OS menu is taught by hand instead",
  "a starter download is back on the guide: on a Mac that is the 'Apple could not verify' dialog with only Done / Move to Bin, which is exactly what the owner hit");
check([["win", "windows"], ["mac", "mac"], ["linux", "linux"]].every(([id, anchor]) =>
    new RegExp(`<section class="os" data-osid="${id}">\\s*<h2 id="${anchor}"`).test(guide)) &&
  ["win", "mac", "linux"].every((id) => guide.includes(`data-pick="${id}"`)) &&
  /body\[data-os="win"\] section\.os:not\(\[data-osid="win"\]\)/.test(guide),
  "…and the three menus are pickable: one section per OS plus the chooser that hides the other two",
  "the per-OS menu chooser is gone — he asked for '3 diff menu for all 3 diff os' so a restaurant reads only its own steps");
// The chooser HIDES two thirds of the page, so both ways out of a hidden menu are guarded as well.
check(/body\[data-os\] section\.os\{display:block !important\}/.test(guide) &&
  /document\.body\.dataset\.os !== os\) show\(os, false\)/.test(guide),
  "…a saved PDF still holds all three, and a link into a hidden menu opens it first",
  "picking one OS can hide a menu that a contents-list link or the printed PDF still needs — a link that appears to do nothing");
const ownerSettings = read("app/owner/settings/page.tsx");
// The manager panel reaches it through a NAMED CONSTANT, so assert the constant's value and its use
// rather than the literal — asserting the spelling of code that legitimately changed shape is how
// this repo's guards have gone red twice (see verify-static's header).
// ── THE FOUR DOORS ARE DOWN TO ONE, AND THAT IS THE POINT NOW ────────────────────────────────
// This used to demand the guide be reachable from all four — admin console, kitchen 🖨 sheet,
// manager Settings, owner Settings — from 2026-08-18: "it should be shown in kitchen panel… manager
// also and owner."
//
// He reversed it on 2026-08-29, having watched a restaurant use it: *"inside the kitchen panel there
// is how to print, and in the manager and the owner inside the setting how to print a whole setup
// guide, which was from previous — so remove that completely."* Setting a printer up is the ADMIN's
// job on the Printing screen; three more copies of "how to print" sat in panels that can no longer
// perform that setup, saying it in different words from the board that can. That is the same
// two-things-for-one-job fault as the retired print-here banner, and the standing rule now in
// CLAUDE.md ("a new way replaces the old one") says the old copies go.
//
// So the rule is INVERTED, not deleted: the guide lives where the setup lives, and nowhere else.
check(/print-setup\.html/.test(admin),
  "the guide is reachable from the admin console, where the printer is actually set up",
  "the setup guide has no door at all — the admin console is the one place that must always reach it");
// ⚠️ INVERTED AGAIN, AND THE REASON THE OLD RULE EXISTED HAS GENUINELY EXPIRED.
// Previously (owner, 2026-08-29): *"inside the kitchen screen also kitchen panel also there is how to
// print… remove that completely"* — correct then. A cook's screen could not BE the printer (the admin
// named one person on the Printing board), so a link telling a cook how to set a printer up was an
// instruction to do something the screen would refuse.
// LATEST (owner, 2026-08-31): *"kitchen panel will always be on and there will be guide for it."*
// The kitchen screen is now the DEFAULT printer for kitchen slips — nobody named, nothing switched on
// (lib/printHelpers → resolveTarget). The guide is no longer impossible advice; it is the
// instructions for the machine the sheet is standing on.
check(/print-setup\.html/.test(kpanel),
  "the kitchen panel reaches the setup guide, because that screen is now the default printer",
  "the kitchen sheet has no way to reach the print-station file, on the one screen that prints by default");
check(/id: "printing"/.test(epanel) && /function formPrinting/.test(epanel),
  "the manager panel has its own VISIBLE Printing section (the admin-only Kitchen one stays hidden)",
  "the manager panel's Printing section is gone — the printing status and the device answer would be unreachable there again");
check(/prsheet-status/.test(kpanel) && /kotPrintTarget/.test(kpanel),
  "the kitchen screen's 🖨 sheet SHOWS where printing stands (on/off, and which screen prints)",
  "the kitchen sheet no longer says whether this screen is even meant to be printing — a cook at a silent printer has to ask someone");
// The guide is the ONLY source of the launcher now: lib/printStation.ts and its download route were
// DELETED on 2026-08-19 along with the download itself (owner, with the screenshot: "print-station-mac
// .command Not Opened — Apple could not verify… / Move to Bin", then "make 3 diff menu for all 3 diff
// os setup and tell me in each every step… bcz dwl it and clicking it shows this error"). A file the
// person types themselves carries no quarantine flag, so no security layer can object to it. So the two
// flags that make automatic printing work at all are asserted in each of the three PASTEABLE blocks.
const osMenu = (id) => {
  const m = guide.match(new RegExp(`<section class="os" data-osid="${id}">[\\s\\S]*?</section>`));
  return m ? m[0] : "";
};
check(["win", "mac", "linux"].every((id) => {
    const sec = osMenu(id);
    return /--kiosk-printing/.test(sec) && /--disable-backgrounding-occluded-windows/.test(sec);
  }),
  "the two flags that make this work at all are in all three pasteable blocks",
  "an OS menu lost --kiosk-printing or --disable-backgrounding-occluded-windows — the first means every ticket waits for a click, the second is the whole covered-window bug");
// The site address has to be INSIDE a Copy block, not merely somewhere on the page: what the person
// pastes is the block, and Windows has exactly one block, so a count of two would have been wrong.
check(["win", "mac", "linux"].every((id) =>
  /<pre data-copy>(?:(?!<\/pre>)[\s\S])*data-site-url(?:(?!<\/pre>)[\s\S])*<\/pre>/.test(osMenu(id))),
  "…every menu carries THIS site's address inside a Copy-button block",
  "an OS menu has lost its site address or its Copy buttons — a hand-retyped Chrome command line is how a flag goes missing, and a guessed stack is why a launcher silently did nothing");
check(/Gatekeeper|could not verify/i.test(guide) && /bash ~\/Downloads/.test(guide),
  "the guide still names the macOS block by its real dialog, and rescues a file already sitting in Downloads",
  "the guide no longer explains 'Apple could not verify' — the owner hit exactly that dialog, and the instructions told him to right-click → Open, which macOS Sequoia removed");
check(["windows", "mac", "linux", "devices", "switches", "which", "test", "wrong"].every((id) => guide.includes(`<h2 id="${id}"`)),
  "the guide is the three-OS structure he asked for (Windows · Mac · Linux/Pi) with who-prints, the test and the fault table",
  "the guide has lost one of its main sections — he asked for THREE OS sections plus which-screen-prints, the test and the fault table");
check(/Save as type/.test(guide) && /Make Plain Text/.test(guide) && /nano ~\/print-station\.sh/.test(guide),
  "each OS menu teaches making the file BY HAND (Notepad · TextEdit plain text · nano)",
  "the by-hand instructions are gone. The owner asked for them precisely because a download can be blocked (macOS) or saved wrong (.bat.txt) — 'tell me all step by step everything, how I have to make that file'");
check(/data-site-url/.test(guide) && /location\.origin/.test(guide),
  "…and every command carries THIS site's address, written in by the page itself",
  "the guide no longer fills in the site address — 'where I have to put URL and which URL' was the question, and a guessed stack is why a launcher silently did nothing");
check(/one screen prints at a time|One printer at a time/i.test(guide) && /Print here instead/.test(guide),
  "the guide explains that ONE screen prints and how to move it",
  "the guide does not explain the one-printer-at-a-time rule, which is the thing a restaurant with two screens will hit first");

// ── 8. ONE SCREEN IS THE PRINTER (mig 338) ──────────────────────────────────────────────────────
const mig338 = read("supabase/migrations/338_one_screen_is_the_printer.sql");
check(/CREATE UNIQUE INDEX IF NOT EXISTS print_stations_one_active[\s\S]{0,120}WHERE active/.test(mig338),
  "the database itself allows only ONE active print station per restaurant",
  "the one-active-station index is gone — two screens could hold printing at once and which one printed would be a coin flip again");
check(/STATION_STALE_MS/.test(lib) && /stale/.test(lib),
  "a station that has gone quiet can be taken over without asking",
  "the staleness rule is gone: a kitchen screen that is switched off would hold the restaurant's printing for ever");
check(/export async function mayClaim/.test(lib) && (kroute.match(/mayClaim\(/g) || []).length >= 1 && (eroute.match(/mayClaim\(/g) || []).length >= 1,
  "BOTH routes ask one gate (mayClaim) before handing a ticket to a screen",
  "a route claims without asking who the station is — that is how two screens start fighting over every ticket");
check(/print-station" && b === "take"/.test(kroute) && /print-station" && b === "take"/.test(eroute),
  "both the kitchen and the counter screen can TAKE printing in one tap",
  "a panel lost its take-over endpoint, so a person standing at the right printer cannot move printing to it");
// INVERTED, NOT SATISFIED (2026-08-31). This required a take-over button on BOTH panels
// (`data-station-set`, `data-kstation`). Both were removed on purpose: a button that says "print
// here instead" is a second answer to a question the admin has already answered on the Printing
// board, and when the two disagreed the paper came out wherever the last tap was. Moving printing
// is now ONE act — naming a person — and the panels obey it. The check had been passing on the
// comments that recorded the removal, which is why nobody noticed the rule had been reversed.
check(!/data-station-set/.test(epanel) && !/data-kstation/.test(kpanel),
  "neither panel offers a competing take-over tap — printing moves in ONE place",
  "a take-over button is back on a panel: the admin's choice and a tap on the floor can now disagree");
check(/pickPerson/.test(read("app/aevinite/printing/page.tsx")),
  "…and that one place is the Printing board, where a person is named",
  "the Printing board lost its person picker — there is now no way at all to move printing");
check(/onlyWhen: "printing"/.test(epanel) && /x\.onlyWhen !== "printing" \|\| printingOn/.test(epanel),
  "the manager's Printing row is ABSENT when automatic printing is off (not greyed)",
  "the Printing row shows when printing is off — the owner's rule is that no option appears at all");
check(/data\?\.printing && data\.printing\.length/.test(ownerSettings),
  "the owner's printing card renders only for a restaurant that HAS printing on",
  "the owner card shows even when printing is off everywhere");

// ── 9. THE KITCHEN SCREEN'S OWN MENU (owner, 2026-08-19) ────────────────────────────────────────
const khtml = read("public/panels/kitchen/index.html");
check(/id="hamburger"/.test(khtml) && /function openKitchenMenu/.test(kpanel),
  "the kitchen screen has a ☰ menu",
  "the kitchen's ☰ menu is gone — it was the screen's only way to reach Settings");
check(/function openKitchenSettings/.test(kpanel) && /action="\/api\/panel-logout"/.test(kpanel),
  "…with a Settings sheet that can SIGN OUT (this screen had no way to, before 2026-08-19)",
  "the kitchen can no longer sign out, or its Settings sheet is gone");
check(/method="post"/.test(kpanel) && /panel-logout/.test(kpanel),
  "sign-out is a POST form, so nothing that merely points at the URL can end a cook's session mid-service",
  "the kitchen sign-out is a link again — a GET that ends a session fires from anything that touches the URL");
check(!/PROFILE_ROLES|My profile/.test(kpanel.slice(kpanel.indexOf("function openKitchenMenu"), kpanel.indexOf("function openKitchenMenu") + 2500)),
  "…and the menu offers NO profile — the kitchen has none, and that has been ruled three times",
  "a profile appeared in the kitchen menu: ruled out 2026-07-29, re-confirmed 2026-08-05 and again in lib/staffProfileShared.ts. Do not add it");

console.log(failed
  ? `\n✗ ${failed} check(s) failed — read this file's header before 'fixing' the code\n`
  : "\n✓ a ticket is a row: it prints on a covered window, on either screen, exactly once\n");
process.exit(failed ? 1 : 0);
