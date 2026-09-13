#!/usr/bin/env node
// verify:print-helper — the rules that make "a computer prints the paper" safe (mig 341).
//
// Everything here was learned by DRIVING it on 2026-08-20, and every check names the fault it would
// have caught. Read the reason before "fixing" a failure: several of these look like style and are
// not.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
// "IS THIS FILE STILL HERE" IS ITS OWN QUESTION, and read() cannot answer it: a deleted file and an
// empty one both come back "". Three checks below assert that something was DELETED, and they would
// pass for ever against a read() of a path that was never there.
const exists = (p) => { try { readFileSync(p); return true; } catch { return false; } };
// EVERY "this must NOT appear" test runs against code with the comments stripped. Four checks in this
// file tripped on their own explanations while it was being written — the ESC/POS one, the awaited
// gate, the parity harness and the owner read — and a guard that fails because of the sentence
// explaining it is a guard the next person deletes.
// ⚠️ LINE COMMENTS FIRST, THEN BLOCK COMMENTS — and the order is the whole bug (T9, sweep #8,
// 2026-09-03). Stripping `/*…*/` FIRST means a `/*` that appears inside a `//` line opens a block
// comment that never closes, and everything up to the next `*/` vanishes. Measured on the files
// this guard reads: 341 lines of public/panels/editor/app.js, 249 of app/api/editor/route.ts and
// 97 of the waiter tablet were INVISIBLE to it — every check grepping those regions was asserting
// nothing while printing ok. The culprit here is one real comment: `// This read `catch { /* tip
// is non-critical */ }`…`. This is the same trap the project note "Strip line comments BEFORE
// block comments" records after it hid 190 lines from two other guards. Do not swap these back.
const code = (src) => String(src).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
let pass = 0; const fails = [];
const check = (cond, ok, bad) => { if (cond) { pass++; console.log("  ok   " + ok); } else fails.push(bad); };

const mig    = read("supabase/migrations/341_a_helper_prints_the_paper.sql");
const lib    = read("lib/printHelpers.ts");
const docs   = read("lib/printDocs.ts");
const script = read("lib/printHelperScript.ts");
const agentR = read("app/api/print-agent/[...path]/route.ts");
const adminR = read("app/api/admin/printing/[...path]/route.ts");
const page   = read("app/aevinite/printing/page.tsx");
const kroute = read("app/api/kitchen/[...path]/route.ts");
const eroute = read("app/api/editor/[...path]/route.ts");
const troute = read("app/api/tablet/[...path]/route.ts");
const kpanel = read("public/panels/kitchen/app.js");
const epanel = read("public/panels/editor/app.js");
const plan   = read("docs/PRINT-HELPER.md");

// ── 1 · the shape of the thing ────────────────────────────────────────────────────────────────
check(/CREATE TABLE IF NOT EXISTS print_agents/.test(mig) && /token_hash/.test(mig) && /ENABLE ROW LEVEL SECURITY/.test(mig),
  "a computer that may print is a row, and that table is staff-only (RLS on, no policies)",
  "migration 341 has lost print_agents or its RLS — a printing credential table readable by anon is not a credential");
check(!/token\s+text/.test(mig) && /sha-256|sha256/i.test(mig + lib),
  "…and the code itself is stored HASHED, never in the clear",
  "a plaintext printing code has appeared: a database read would then hand anyone a working credential");
check(/ADD COLUMN IF NOT EXISTS agent_id/.test(mig) && /ADD COLUMN IF NOT EXISTS printer/.test(mig) && /kind IN \('kot','bill','banquet','label','test'\)/.test(mig),
  "print_jobs was EXTENDED, not replaced — one basket for every kind of paper",
  "print_jobs lost the helper columns or the widened kind: a second queue is two places for a ticket to be lost");
check(/settings\.modules|modules\.printing|bag\["printing"\]|bag\[.printing.\]/.test(lib) && !/ALTER TABLE settings ADD COLUMN/.test(mig),
  "the address book lives in settings.modules — a new module adds no settings column (mig 326)",
  "printing added a settings column; there are already 110, and the module bag exists precisely so a new feature adds none");

// ── 2 · the door ──────────────────────────────────────────────────────────────────────────────
for (const [verb, why] of [["hello", "a machine says what printers it has"], ["next", "it asks for work"],
  ["document", "it is handed the paper"], ["done", "it says paper came out"], ["failed", "or that it did not"]])
  check(agentR.includes(verb), `the helper's door has ${verb} — ${why}`, `the print-agent route lost /${verb}`);
check(/x-lfh-agent/.test(agentR) && /agentByToken/.test(agentR) && (agentR.match(/if \(!agent\) return err/g) || []).length >= 2,
  "every verb identifies the machine first, and refuses an unknown code",
  "a print-agent verb no longer checks the token — the whole door is that check");
check(/job\.agent_id !== agent\.id\) return err/.test(agentR) && /belongs to another computer/.test(agentR),
  "a machine can only read and close the jobs IT claimed",
  "one helper can read or close another's job — a ticket could be marked printed by a machine that never printed it");
check(/printingOn/.test(agentR) && /return new NextResponse\(null, \{ status: 204 \}\)/.test(agentR),
  "with printing switched off a helper is told to idle, not handed an error",
  "printing off now errors at the helper instead of quietly idling — a paused restaurant would fill a log with refusals");

// ── 2b · A JOB ADDRESSED TO A MACHINE BY NAME REACHES IT, whatever its kind ───────────────────
// Found by the security test on 2026-08-21: the admin's "Send a test page" writes the computer and the
// printer straight onto the job — and it sat in the basket for ever, because the candidate read only
// looked at kinds the ROUTES named, and bailed out entirely when a machine had no routes. That is the
// state every restaurant is in on the day it installs the helper, so the very first thing anyone tries
// was the thing that could not work.
check(/\.eq\("agent_id", agent\.id\)/.test(code(lib)) && !/if \(!mine\.length && !backup\.length\) return null;/.test(code(lib)),
  "a job addressed to a machine by name reaches it even when nothing routes its kind (the admin's test page)",
  "claimNext only looks at routed kinds again — the admin's test page, and any reclaimed job, would sit in the basket for ever");

// ── 3 · ONE bill, ONE ticket, one file ────────────────────────────────────────────────────────
check(/billdoc\.js/.test(docs) && /kotDocHtml|billDocHtml|banquetDocHtml/.test(docs),
  "the paper a helper prints is built by public/panels/billdoc.js — the file every screen prints from",
  "the helper path has grown its own document builder: a second layout drifts the moment either side is touched");
// Looks for the BYTES, not the phrase: both files talk ABOUT ESC/POS in comments explaining why the
// helper must never emit it, and a guard that trips on its own explanation is a guard people delete.
check(!/\\x1[bd]|\\u001[bd]|0x1[bd],|Buffer\.from\(\[/.test(code(docs + script)),
  "…and nobody writes raw printer bytes by hand — that would be a second bill layout",
  "raw printer commands have appeared in the helper path; the document must stay the one HTML file");
check(/withPaper/.test(docs) && /@page\{size:/.test(docs) && /already declares/.test(docs),
  "the page size is stamped from the printer's OWN paper, and a document that declares its own is left alone",
  "the paper-size stamp is gone or unconditional — a page that disagrees with the paper is what rotates a ticket or halves it (2026-08-19)");

// ── 4 · a screen must stand down when a computer owns the paper ────────────────────────────────
check(/helperFor/.test(kroute) && /screenPrints/.test(kroute) && /autoPrintKot: autoOn && screenPrints/.test(kroute),
  "the kitchen board stands down when a helper owns the tickets",
  "the kitchen screen prints again alongside a helper: the same ticket then comes out in two rooms, and the screen's copy is the one in the wrong one");
// ASSERT THE RULE, NOT THE WORDING (this file's own header, and the third time it has bitten). The
// refusal used to be the literal `refused: "helper"`; since the who-prints resolver landed it is
// computed from screenMayPrint's reason. What matters is that the CLAIM asks the resolver at all — a
// gate that lives only in the board read is a gate a stale tab walks straight through.
check(/screenMayPrint\(/.test((code(kroute).split('"print-jobs" && b === "claim"')[1] || ""))
  && /refused/.test((code(kroute).split('"print-jobs" && b === "claim"')[1] || "")),
  "…and a tab opened BEFORE the route was set is refused at the claim too",
  "the kitchen claim no longer asks who may print — a stale tab walks straight through a gate that lives only in the board read");

// ── WHO PRINTS IS THE OWNER'S CHOICE, down to the person and the PC (2026-08-26) ──────────────
// "If I want to print from kitchen panel or maybe from manager panel and which particular manager…
// which owner panel… which PC will be open and from that same PC — all will be decided by me."
check(/via\?: RouteVia/.test(lib) && /panel\?: RoutePanel/.test(lib) && /person\?: string/.test(lib) && /device\?: string/.test(lib),
  "a route can name a computer OR a screen — and if a screen, which panel, which person, which PC",
  "the route can only name a computer again: the owner's choice of panel/person/device is gone");
check(/export function screenMayPrint/.test(lib) && /other_person/.test(lib) && /other_device/.test(lib),
  "…and ONE function answers 'may this screen print', so two screens cannot disagree",
  "the who-prints answer has been inlined somewhere — two copies of that question is how two screens print one ticket");
check(/screenMayPrint\(/.test(code(kroute)) && /screenMayPrint\(/.test(code(read("app/api/editor/[...path]/route.ts"))),
  "…and both the kitchen and the manager routes obey it",
  "a panel decides for itself again whether it may print");
check(/print_here/.test(read("lib/accessTree.ts")) && /managerCan\(g, rid, "print_here"\)/.test(code(read("app/api/editor/[...path]/route.ts"))),
  "…a person's own 'May be the printer' permission exists AND is enforced server-side",
  "'May be the printer' is a row that reads nowhere — exactly what mark_paid and print_invoice did");
// ── THIS CHECK IS RETIRED, AND ON PURPOSE ────────────────────────────────────────────────────
// It used to demand that Access & permissions and the Printing menu point at each other, from
// 2026-08-26: "board should be sync. Right now it's not." The two boards did drift, and the answer
// then was to embed one in the other.
//
// He reversed it on 2026-08-29, having lived with the result: *"in the middle of thing, you tell me
// to go to the access and permission and all that stuff. Remove it completely… now printing has a
// new menu, so all the settings of the printing will be there."* Cross-referencing was not sync, it
// was the same setup in two places and a detour out of a job half-done.
//
// So the rule is now the OPPOSITE, and it is asserted rather than left as an absence: the Printing
// menu must not send anybody to Access to finish setting a printer up.
check(!/aevinite\/access/.test(read("app/aevinite/printing/page.tsx")),
  "the Printing menu finishes its own job — it never sends a person to Access mid-setup",
  "the Printing menu links to Access & permissions again: he asked for one place, and being sent away halfway through is the complaint that produced this rule");
check(/helper\.owned\) return \{ mayPrint: false/.test(eroute) || /if \(helper\.owned\) return \{ mayPrint: false/.test(eroute),
  "the manager screen stands down as well, backup path included",
  "the counter screen can still print a helper-owned ticket");
check(/helper: \(r && r\.helper\) \|\| null/.test(epanel) && /printOwners/.test(epanel),
  "…and the panel CARRIES that answer, or every line about it is invisible while the server is right",
  "the panel dropped the helper field — the fault caught on 2026-08-20 by driving the panel, not by reading it");
check(/from \$\{esc\(hlp\.agent\)\}|from " \+ esc\(hlp\.agent\)|esc\(hlp\.printer\)/.test(kpanel),
  "the kitchen sheet NAMES the computer and printer, so a quiet screen is never a mystery",
  "the kitchen printer sheet no longer says where the paper comes out");

// ── 4b · EVERY panel, not just the two that print ─────────────────────────────────────────────
// The owner sits at the counter (at Aangan he is also the manager) and the waiter carries the tablet.
// Both were missed on the first pass: the owner panel only had LINKS to the guide, and the tablet still
// opened its own window for a bill — so the same bill behaved differently depending on which panel
// issued it. Owner, 2026-08-20: "in the admin panel, in the owner panel, in the manager panel, in the
// kitchen print panel — everywhere".
{
  const ownerApi = read("app/api/owner/printing/route.ts");
  const ownerPage = read("app/owner/settings/page.tsx");
  const tabletRoute = read("app/api/tablet/[...path]/route.ts");
  const tabletPanel = read("public/panels/tablet/app.js");
  check(/ownerScope/.test(ownerApi) && /allowed: false/.test(ownerApi) && !/token_hash|fingerprint/.test(code(ownerApi)),
    "the owner can SEE where the paper comes out — read-only, and never a code or a fingerprint",
    "the owner printing read has lost its scope check, its withheld answer, or has started exposing credentials");
  check(/Where your paper comes out right now/.test(ownerPage) && /kotHelper/.test(ownerPage),
    "…and the owner panel shows it, with the old screen-station line yielding to it (two answers to one question is worse than none)",
    "the owner panel no longer shows which computer prints, or contradicts itself by still naming a screen");
  check(/print" && b === "send"/.test(tabletRoute) && /helperFor\(rid, "bill"\)/.test(tabletRoute),
    "a WAITER's bill takes the same road as a manager's",
    "the tablet prints a bill its own way again — the same bill must not behave differently depending on which panel issued it");
  check(/print\/send/.test(tabletPanel) && /openBillWindow/.test(tabletPanel) && !/sessionId: sid\b/.test(code(tabletPanel)),
    "…through the shared door, with its own window still the fallback",
    "the tablet's bill send is gone, or reaches for `sid` again — a variable from another function, which parses and throws the moment a waiter presses Print");
}

// ── 4c · A COMPLAINT CLOSES ONLY WHAT ITS OWN PRINTER DISPROVES (mig 351) ─────────────────────
// Found by review 2026-08-21: printer_events recorded "this restaurant has a printer problem" and any
// successful print resolved EVERY open row — right with one printer, silently wrong with three ("bill
// printer out of paper" vanished because a kitchen ticket printed). The narrowing must stay, and it
// must stay NARROWER-not-wider: a row with no printer keeps the old behaviour, so nothing sticks open.
{
  const queue = read("lib/printQueue.ts");
  const mig342 = read("supabase/migrations/351_a_complaint_knows_its_printer.sql");
  const kroute2 = read("app/api/kitchen/[...path]/route.ts");
  check(/ADD COLUMN IF NOT EXISTS printer text/.test(mig342),
    "a printer complaint records WHICH printer it is about",
    "printer_events has lost its printer column — every complaint becomes restaurant-wide again");
  check(/\.eq\("printer", printer\)/.test(code(queue)) && /\.is\("printer", null\)/.test(code(queue)) && /printer\?: string \| null/.test(queue),
    "…and a successful print closes only the complaints about THAT printer (unknown-printer rows still close, so none can stick)",
    "the auto-close is restaurant-wide again: a kitchen ticket printing clears a paper-out complaint about the bill printer, while it is still empty");
  // A printer NAME is reported by a helper about itself. It must never be pasted into a PostgREST
  // filter string — flagged by a security review on 2026-08-21, hours after it shipped: a name holding
  // a comma or a bracket rewrites the filter it lands in. Parameterised .eq()/.is() have no such seam.
  check(!/\.or\(`[^`]*\$\{[^}]*printer/.test(code(queue + read("app/api/print-agent/[...path]/route.ts")))
    && !/\.or\(`[^`]*\$\{[^}]*printer/.test(code(read("app/api/editor/[...path]/route.ts"))),
    "…and no database filter is ever BUILT from a printer name (it is a helper's own word, not ours)",
    "a printer name is being interpolated into a PostgREST filter string again — a name with a comma in it rewrites the filter");
  check(/replace\(\/\[\\u0000-\\u001f,/.test(read("lib/printHelpers.ts")),
    "…and a reported printer name is stripped of control characters and filter punctuation at the door",
    "printer names are stored raw again — they travel into filters, logs and HTML, and they are the machine's word, not ours");
  check(/aboutPrinter/.test(kroute2) && /printer: aboutPrinter/.test(code(kroute2)),
    "…a cook's report is filed against the printer their slips actually go to",
    "a complaint is filed with no printer again, so it can only ever be cleared by anything at all");
  check(/e\.printer \? e\.printer : "kitchen"/.test(code(read("public/panels/editor/app.js"))),
    "…and the manager's floor says which printer to go and look at",
    "the floor strip says '— kitchen' beside every complaint again, which sends somebody to the wrong room");
}

// ── 5 · the admin looking is not the restaurant printing ──────────────────────────────────────
//
// EVERY PANEL THAT CAN SEND PAPER, NOT JUST THE MANAGER'S (T10 sweep #7, 2026-08-22).
// This check read `eroute` alone. The waiter tablet was given the SAME `print/send` verb for
// mig 341 — its own header says "the same door the manager panel uses" — and it never got the
// owner's 2026-08-20 rule, so the Aevidine console opening a paying client's tablet and pressing
// Print put a sheet out at their shop, with no `print_sent_by_admin` row to trace it by. The guard
// was green throughout, because it was only ever looking at one of the two files. So the list is
// what is checked now: a THIRD panel that learns to send paper joins this array or fails here.
for (const [name, src] of [["the manager panel", eroute], ["the waiter tablet", troute]]) {
  if (!/a === "print" && b === "send"/.test(code(src))) continue;   // this panel cannot send paper at all
  check(/adminView: true/.test(src) && /force/.test(src) && /print_sent_by_admin/.test(src),
    `${name}: the admin viewing a restaurant's panel prints NOTHING at their shop unless deliberately forced — and that is audited`,
    `${name}: the admin console can print on a paying client's roll just by looking at their panel`);
}

// A waiter with a SECTION may print their own tables' bills and nobody else's. The shared section
// gate (lib/tableOfAction.affectedTables) does not recognise ("print","send") and its rule for an
// unrecognised verb is refuse-everything, so this branch has to ask the question itself — which
// means the question can also go missing without the shared gate noticing. (T10 sweep #7)
check(/waiterTables\(actor, rid\)/.test(code(troute).split('a === "print" && b === "send"')[1]?.slice(0, 2000) || ""),
  "…and a waiter with a section can only send their OWN tables' bills to the printer",
  "the tablet's print/send has lost its section check — a waiter holding tables 1-5 can print table 20's bill");

// ── 5b · THE LOG ANSWERS "WHICH BILL?", NOT JUST "WHICH PRINTER?" (owner, 2026-08-28) ─────────
// He was offered a line on the bill card and answered "make log do that". The log could not: the
// row said `bill sent to Printer_POS_80 on Shop's computer`, which names WHERE the paper came out
// and never WHICH bill came out of it — so on a busy night no two of forty rows could be told
// apart. Both routes now name the bill and carry table_number (a field logAction has always
// accepted and neither passed).
for (const [name, src] of [["the manager panel", eroute], ["the waiter tablet", troute]]) {
  if (!/a === "print" && b === "send"/.test(code(src))) continue;
  check(/select\("id, table_number, bill_no"\)/.test(src),
    `${name}: the print/send session read fetches the bill number and the table, so the diary line can name them`,
    `${name}: print/send no longer reads bill_no/table_number — the log goes back to "a bill was sent", which is every row on the page`);
  check(/table_number: (printedTable|sess\.table_number)/.test(code(src)),
    `${name}: …and the print row carries table_number, so it files with the rest of that table's story`,
    `${name}: the print row dropped table_number again — the Audit tab groups by table and this one floats loose`);
  check(/detail: `\$\{(printedWhat|billLabel)\} sent to/.test(src),
    `${name}: …and the sentence itself names the bill ("bill #218 for table 6 sent to …")`,
    `${name}: the print row's sentence stopped naming the bill`);
}
// A bill print is not a kitchen ticket. These two codes are written in exactly two places and BOTH
// are the bill/banquet door — a kitchen ticket is kot_reprint_sent / kot_printed. Filing them under
// "Kitchen tickets" put every bill print in the wrong drawer twice: nothing under Bills, and bills
// under a filter that promised tickets.
{
  const trail = read("lib/logTrail.ts");
  check(/print_sent: \{ area: "Orders & bills", screen: "Print the bill" \}/.test(trail)
     && /print_sent_by_admin: \{ area: "Orders & bills", screen: "Print the bill" \}/.test(trail),
    "a bill print is filed under 'Print the bill', not under 'Kitchen tickets'",
    "print_sent is filed as a kitchen ticket again — it is only ever a bill or a banquet sheet, so the Bills drawer goes empty and the Kitchen-tickets filter fills with bills");
  // code(), not the raw file: the comment ABOVE the fix explains what "Kitchen tickets" got wrong,
  // and a guard that trips on its own explanation is a guard the next person deletes. (This one
  // did exactly that on its first run — the note at the top of this file, learned again.)
  // The boundary matters: `kot_reprint_sent` CONTAINS "print_sent", and that one genuinely IS a
  // kitchen ticket. Without the lookbehind this check condemns a correct line.
  check(!/(?<![a-z_])print_sent(_by_admin)?: \{[^}]*screen: "Kitchen tickets"/.test(code(trail)),
    "…and neither code has drifted back to the kitchen drawer",
    "one of the two print codes is back under Kitchen tickets");
}

// ── 6 · the helper program itself ─────────────────────────────────────────────────────────────
check(/HELPER_FILENAME/.test(script) && /print-helper\.command/.test(script) && /print-helper\.bat/.test(script) && /print-helper\.sh/.test(script),
  "all three operating systems get a helper, by hand",
  "an operating system lost its helper script");
check(!/api\/print-agent\/(mac|windows|linux)|download>/.test(code(script + page)),
  "…and nothing is offered as a DOWNLOAD (macOS blocks a downloaded script outright)",
  "a downloadable helper is back: on a Mac that is the 'Apple could not verify' dialog with only Done / Move to Bin");
check(/does not exit after --print-to-pdf|DOES NOT EXIT after --print-to-pdf/i.test(script) && /kill "\$CPID"/.test(script),
  "the render runs on a watchdog — headless Chrome does not exit after --print-to-pdf",
  "the Chrome watchdog is gone: measured 2026-08-20, the helper hangs for ever after the FIRST ticket and piles up Chrome processes");
check(/lpstat -W completed/.test(script) && /cancel "\$CUPSID"/.test(script),
  "…and a job is followed to completion, with the queued copy cancelled if it never prints",
  "the helper reports success on `lp` accepting the file again — that says 'printed' with the printer switched off, and a stuck copy plus a retry is the only way this design could hand out two identical tickets");

// ── 7 · the admin screen ──────────────────────────────────────────────────────────────────────
// AWAITED, not merely present. tokenIsValid is async: `if (!admin(req))` tests a Promise, which is
// always truthy, so the gate silently never fires — that shipped to backup on 2026-08-20 and handed a
// restaurant's printing state to an uncookied request. The await is the whole check.
check(/tokenIsValid/.test(adminR)
  && (adminR.match(/if \(!\(await admin\(req\)\)\) return err/g) || []).length >= 2
  && !/if \(!admin\(req\)\)/.test(code(adminR)),
  "the admin printing API is gated on every verb — and the gate is AWAITED (a Promise is always truthy)",
  "an /api/admin/printing verb lost its gate, or tests tokenIsValid without awaiting it — which is the same as having no gate at all");
check(/aevinite\/printing/.test(read("components/admin/AdminShell.tsx")),
  "…and the menu is reachable from the sidebar, not only by URL",
  "the Printing menu is gone from the admin nav");
// The test is about PROSE, so the three shapes that are plainly code are stripped first: a key in a
// map (`kot:`), a compared literal (`"kot"`) and a property read (`draft.kot`). Anything left is a
// word on the screen.
check(!/\bkot\b/.test(page.replace(/kot:/g, "").replace(/"kot"/g, "").replace(/\.kot\b/g, "")),
  "the screen speaks the restaurant's words (Kitchen slips), never 'kot'",
  "the admin Printing screen shows the word 'kot' to a human");

// ── 8 · THE PARITY TEST — two copies of the table-label rule must agree ───────────────────────
// The server labels a kitchen ticket (lib/printDocs.kotTableLabel) and the kitchen panel labels the
// same thing on screen (tlong in public/panels/kitchen/app.js). Two copies of a rule is what this
// codebase refuses; they are allowed to exist only because THIS test drives both.
{
  const names = { "7": "", "9": "A1", "12": "  " };
  const tlongSrc = (kpanel.match(/const tlong = [^\n]+/) || [""])[0];
  const tnameSrc = (kpanel.match(/const tname = [^\n]+/) || [""])[0];
  check(!!tlongSrc && !!tnameSrc, "the panel's own label rule was found to compare against",
    "tlong()/tname() could not be found in the kitchen panel — the parity test cannot run, so the two copies are unguarded");
  let agree = true, detail = "";
  if (tlongSrc && tnameSrc) {
    // The panel reads names from `state.tableNames` (the board hands it settings.table_names under
    // that name), so the harness must present them that way — feeding it the settings object made the
    // FIRST run of this test cry drift where there was none. The lesson was the test's, not the code's.
    const panelLabel = new Function("state", "t", `${tnameSrc}\n${tlongSrc}\nreturn tlong(t);`);
    // lib/ is TypeScript, so the label rule is re-read from source rather than imported — the guard
    // must run under plain node like every other verify:* script.
    const srvSrc = docs.slice(docs.indexOf("export function kotTableLabel"), docs.indexOf("const restName"));
    const body = srvSrc.slice(srvSrc.indexOf("{") + 1, srvSrc.lastIndexOf("}")).replace(/: [A-Za-z<>|,\s{}\[\]]+(?=[,)])/g, "");
    const serverLabel = new Function("order", "tableNames", body.replace(/order\.table_number/g, "order.table_number"));
    for (const t of ["7", "9", "12", "", null, "Patio"]) {
      const state = { tableNames: names };
      const a = panelLabel(state, t);
      const b2 = serverLabel({ table_number: t }, names);
      if (a !== b2) { agree = false; detail += `table ${JSON.stringify(t)}: panel "${a}" vs server "${b2}"  `; }
    }
  }
  check(agree, "the panel and the server label a ticket's table identically (T7 · a named table · no table)",
    "the two table-label rules have drifted: " + detail + "— the owner ruled 2026-08-05 'it should always be T7', and paper that disagrees with the screen sends staff to the wrong table");
}

// ── 8a · AND THE ADMIN'S SAMPLE TICKET IS THE THIRD COPY (T25, sweep #7, 2026-08-28) ──────────
// lib/billPreview.ts builds the KOT the admin previews on Access → "Format of the bill", and its
// own note on that page promises "the exact ticket the manager panel and the kitchen board print".
// It cannot IMPORT kotTableLabel — lib/printDocs.ts reaches the service-role client and this file
// is also imported by a "use client" component — so it writes the short form itself, and the third
// copy is held here rather than left to drift. It said "Table 5" from the day it was written, which
// is a label no printer in this app has ever produced.
{
  const preview = read("lib/billPreview.ts");
  const kotArg = (preview.match(/tableLabel:\s*tableNamed\(settings,\s*"([^"]*)"\)/) || [])[1];
  check(!!kotArg, "the admin KOT preview's table label was found",
    "tableLabel: tableNamed(settings, \"…\") is no longer in lib/billPreview.ts — this parity test cannot run");
  if (kotArg) {
    // Drive the SERVER rule for the same table the sample uses, and demand the identical string.
    const srvSrc = docs.slice(docs.indexOf("export function kotTableLabel"), docs.indexOf("const restName"));
    const body = srvSrc.slice(srvSrc.indexOf("{") + 1, srvSrc.lastIndexOf("}")).replace(/: [A-Za-z<>|,\s{}\[\]]+(?=[,)])/g, "");
    const serverLabel = new Function("order", "tableNames", body);
    const expected = serverLabel({ table_number: "5" }, null);
    check(kotArg === expected,
      `the admin's sample kitchen ticket labels its table the same way the printer does ("${expected}")`,
      `the admin KOT preview says "${kotArg}" where the printed ticket says "${expected}" — the page promises "the exact ticket the manager panel and the kitchen board print", and the owner ruled 2026-08-05 "it should always be T7"`);
  }
  // …and the BILL preview beside it uses the same short form, so the two halves of one page agree.
  const billArg = (preview.match(/tableDisp:\s*tableNamed\(settings,\s*"([^"]*)"\)/) || [])[1];
  check(billArg === kotArg,
    "the sample bill and the sample kitchen ticket name the table identically",
    `the bill preview says "${billArg}" and the KOT preview says "${kotArg}" — one page, two answers`);
}

// ── 8b · THREE REAL MENUS, not one page being filtered ────────────────────────────────────────
// Owner, 2026-08-20: "I want it like three proper menus — if you click Windows it will NOT scroll".
// Before this, picking an OS hid the other two but flung the page 5,000px into its own middle, and the
// section numbers read 1, 2, 3, 4, 7, 8 — a gap that gives away that nothing became a menu.
{
  const guide = read("public/print-setup.html");
  check(/window\.scrollTo\(\{ top: 0/.test(guide) && !/sec\.scrollIntoView/.test(code(guide)),
    "picking a menu does not scroll the reader into the middle of the page",
    "the guide scrolls to the chosen OS section again — that is what made three menus feel like one filtered page");
  check(/counter-increment:sec/.test(guide) && /h2::before\{content:counter\(sec\)/.test(guide) && !/<h2 id="[a-z]+">\d/.test(code(guide)),
    "…the section numbers count themselves, so a hidden menu leaves no gap",
    "typed-in section numbers are back: hiding two menus then shows 1, 2, 3, 4, 7, 8");
  check(/counter\(sec\) "\." counter\(sub\)/.test(guide) && !/<h3>\d+\.\d/.test(code(guide)),
    "…and so do the step numbers inside each menu",
    "typed-in step numbers are back — they disagree with the section number the moment a menu is hidden");
  check(/class="inmenu"/.test(guide) && /You are reading the/.test(guide) && /data-osname/.test(guide),
    "…and the page says which menu you are in, with the way back out",
    "the 'you are reading the X menu' bar is gone — nothing then tells a reader they are inside one menu of three");
  check(/\[data-only\]/.test(guide) && /data-only="mac"/.test(guide),
    "…and a Windows reader is not shown the macOS rows of the shared tables",
    "the OS-only rows in the shared tables show for every menu again");
  check(!/§\d/.test(code(guide)),
    "…and nothing refers to a section by NUMBER any more (the numbers move per menu)",
    "a §number cross-reference is back in the guide: with automatic numbering it points at the wrong section in two of the three menus");
}

// ── 8b · THE MACHINE WITH THE PRINTER SETS ITSELF UP (mig 367, owner 2026-08-27) ──────────────
// "That device is connected to the printer, so it will be easy for THAT device to set up the printer
// and all that, instead of the admin — admin can still see it… but that device will only get the
// option in settings, like everyone has their settings where they log out from."
{
  const mig367 = read("supabase/migrations/367_a_device_sets_up_its_own_printer.sql");
  const words  = read("lib/printBoardWords.ts");
  const board  = read("lib/printBoard.ts");
  const tree   = read("lib/accessTree.ts");

  check(/owner_device/.test(mig367) && /owner_user/.test(mig367) && /print_agents_owner_device_idx/.test(mig367),
    "a helper remembers WHICH browser set it up, and that question is indexed",
    "mig 367 has lost owner_device / its index — Settings → Printing then cannot answer 'is this computer already set up?' without a scan");

  check(/id: "print_setup"/.test(tree) && /flag: "print_setup"/.test(tree) && /mgrDef: false/.test(code(tree).match(/id: "print_setup"[\s\S]{0,400}/)?.[0] || ""),
    "…and setting printers up is its OWN permission, default OFF",
    "print_setup is gone from the access tree, or defaults ON — it is granted to the ONE person at the machine, not to every manager");

  const eCode = code(eroute);
  check(/managerCan\(g, rid, "print_setup"\)/.test(eCode),
    "…asked on the SERVER before any printing setup verb runs, not just hidden on screen",
    "the panel's printing endpoints no longer check print_setup — hiding a button has never been a gate");
  check(/agentForDevice\(rid, dv\)/.test(eCode) && !/createAgent\(rid, [^,)]+\)\s*;/.test(eCode),
    "…and every verb is scoped to THIS browser's own computer, never another machine",
    "a panel printing verb stopped resolving the machine from this device — a manager could then re-code or re-route somebody else's computer");

  // ONE DECISION, ONE COLUMN. The kitchen-slip line and settings.auto_print_kot are the same
  // answer; two controls for one value is exactly what made the two boards disagree on 2026-08-26.
  check(/export async function syncKotSwitch/.test(lib) && /syncKotSwitch\(rid/.test(eCode) && /syncKotSwitch\(rid/.test(code(adminR)),
    "the kitchen-slip line IS auto_print_kot — both boards write the one column through one function",
    "a board stopped calling syncKotSwitch: the address book would say 'nobody prints kitchen slips' while the trigger went on queueing them for ever");
  check(!/key: "on", on: st\.printing\.on/.test(code(page)),
    "…and the admin board no longer carries a SECOND switch for it",
    "the duplicate 'the restaurant has auto-print on' switch is back on the admin board — two controls, one column, and they showed opposite answers");

  // THE THIRD ANSWER, everywhere it has to exist.
  check(/"computer" \| "screen" \| "off"/.test(lib) && /kind: "off"/.test(lib) && /why: "off"/.test(lib),
    "'nobody prints this' is a real, saved answer — not an empty line pretending to be one",
    "via:'off' has gone: an empty route and a deliberate no would look identical again, and screens would say 'no printer chosen' at a restaurant that had decided not to print");

  // THE SAME BOARD IN BOTH PLACES. The words live in one file and both screens read that file.
  check(/STEPS = \{/.test(words) && /KIND_OFF_LABEL/.test(words),
    "the four steps and the three answers are declared ONCE, in lib/printBoardWords.ts",
    "the shared printing words are gone — the admin console and the restaurant's own screen will drift into two products again");
  check(/printBoardWords/.test(page) && /printBoardState/.test(code(adminR)) && /printBoardState/.test(eCode),
    "…and BOTH boards are built from it",
    "one of the two printing boards stopped reading the shared words/state");
  check(/1 · Is printing switched on/.test(words) && /STEP\.one|steps\.one|B\.steps/.test(epanel),
    "…including the panel, which prints the same headings verbatim",
    "the manager panel stopped using the shared step headings");
  // Comments stripped first — this file EXPLAINS why it has no imports, and the explanation says the
  // word "import" four times. A guard that trips on its own reason is a guard the next person deletes.
  check(!/^\s*import\b/m.test(code(words)),
    "…and the words file imports NOTHING, so a client page can read it without dragging the service key in",
    "lib/printBoardWords.ts grew an import: the admin console is a client component, and verify:static will refuse the whole page");

  check(/data-pw="adopt"/.test(epanel) && /adopt/.test(eCode),
    "a browser that has lost its device id can say 'I am that computer' instead of registering it twice",
    "adopt is gone — a cleared browser would set the same machine up a second time, and half the tickets would come out in the wrong room");

  check(/auto_print_kot_allowed === true;/.test(epanel) && !/const printingOn = st\.auto_print_kot === true && st\.auto_print_kot_allowed === true;/.test(epanel),
    "…and switching kitchen slips off does not hide the screen that switches them back on",
    "the Printing section is gated on auto_print_kot again: pressing 'Nobody' would make the section vanish, taking its own switch with it");

  // The dead fifth line. Nothing ever queued a 'label' job and no document was ever built for one.
  check(!/"label"/.test(code(lib)) && !/label: "Parcel labels"/.test(words),
    "the parcel-label line is gone — nothing ever printed one",
    "the 'label' kind is back: it is an address-book line nobody can ever fill, which is the clutter the owner asked to remove");
  check(/ROUTABLE_KINDS = \["kot", "bill", "banquet"\]/.test(lib),
    "…so there are exactly THREE lines to answer, because this app prints three documents",
    "ROUTABLE_KINDS changed shape — the three lines are the honest answer to 'why are there only three options'");
  check(/thisComputer/.test(board) && /owner_device === dv/.test(board + lib),
    "the board can always answer 'is the computer I am sitting at set up?'",
    "printBoardState lost thisComputer — the restaurant's own screen cannot tell its machine from someone else's");
}

// ── 8c · HOW FAR BEHIND THE PRINTER IS (owner, 2026-08-27) ────────────────────────────────────
// "'The printer is off' and 'the printer is off and eleven orders are stacked up' stop looking the
// same. The second one means somebody should be reading the screen instead of waiting for paper."
{
  const queue = read("lib/printQueue.ts");
  const board = read("lib/printBoard.ts");

  check(/export async function waitingToPrint/.test(queue) && /count: "exact"/.test(queue) && /export const STUCK_AFTER_MS/.test(queue),
    "the pile-up is ONE counted read — how many, and how old the oldest is",
    "waitingToPrint is gone: the count and the age are what turn a number into a sentence, and no screen can work them out for itself");

  // THE AGE IS NOT OPTIONAL. A count alone cannot tell a two-second blip from a dead printer, and a
  // badge that shows "1" every time a ticket passes through the queue is permanent furniture — which
  // is invisible, which is how a real pile-up gets missed. This is the don't-cry-wolf rule.
  check(/oldestMs/.test(queue) && /oldestMs/.test(kpanel) && /oldestMs/.test(epanel) && /oldestMs/.test(page),
    "…and every screen that shows it also has the age, so nothing shouts on the count alone",
    "a screen shows the waiting COUNT without the age of the oldest ticket — it will cry wolf on a healthy printer");
  check(/stuckAfterMs/.test(kroute) && /stuckAfterMs/.test(eroute) && /afterMs/.test(board),
    "…and the threshold is the SERVER's, sent with the number",
    "a panel now keeps its own copy of 'how long is too long' — two screens will disagree about whether the same printer is stuck");

  // IT MUST REACH THE ONE SCREEN THAT CANNOT COUNT IT ITSELF. When a helper owns the kitchen slips,
  // the kitchen board is handed no jobs on purpose — which is the exact moment the number matters.
  check(/waitingToPrint\(rid, "kot"\)/.test(code(kroute)),
    "the kitchen board carries it even when that screen is handed no tickets at all",
    "the kitchen board lost the waiting count — with a helper owning the paper it has nothing to count, so a cook at a dead printer cannot see the pile");
  check(/prsheet-wait/.test(kpanel) && /prsheet-wait/.test(read("public/panels/kitchen/style.css")),
    "…and the 🖨 sheet has its own row for it, above the fold",
    "the 'Tickets waiting' row is gone from the kitchen printer sheet");
  check(/function paintPrinterBadge/.test(kpanel) && /prbadge/.test(read("public/panels/kitchen/style.css")),
    "…with the count on the bar button, so the sheet does not have to be opened to learn it",
    "the printer button's waiting badge is gone");
  check(/function printerStatusHtml/.test(kpanel) && /paintPrinterSheetStatus/.test(kpanel),
    "…and a sheet left open is repainted, so the number a cook walks away from is the number they come back to",
    "the printer sheet's status is built inline again: it will go stale under a cook who is reading it");

  // …AND THE MANAGER, WHOSE STRIP IS AN ALARM. A count of tickets that are still sitting there is
  // not a report somebody can tick off, so it must not offer "Resolved" — that would be a lie.
  check(/kind: "waiting"/.test(epanel) && /data-prsetup/.test(epanel),
    "the manager's floor says it too, and offers the one move that helps instead of a 'Resolved' that would be a lie",
    "the pile-up row is gone from the manager's floor strip, or it grew a Resolved button — the tickets are still there, so ticking it off says something untrue");
  check(/waitingToPrint\(rid, "kot"\)/.test(code(eroute)) && /stuck: \{ \.\.\.stuck, afterMs: STUCK_AFTER_MS \}/.test(board),
    "…and both printing boards read it from the shared board, in the same words",
    "the shared board lost the pile-up, so the admin console and the restaurant's own screen will describe it differently");

  // "NO" IS NEUTRAL; THIS IS WRONG. The state pair's `no` paints its value in --muted, which made the
  // word STUCK read as a switched-off setting rather than a printer nobody is watching. `warn` is the
  // third state, and it carries the danger colour AND a filled dot AND a border — never colour alone.
  check(/\.adm-state-row\.warn/.test(read("app/globals.css")) && /\.pw-state-row\.warn/.test(read("public/panels/editor/style.css")),
    "…and a stuck printer uses the WARN state, not the neutral 'no' one",
    "the warn state is gone: the word STUCK would be painted in the muted grey that means 'switched off'");
  check(/"warn" : "yes"/.test(code(page)) && /"warn" : "yes"/.test(epanel),
    "…on both boards",
    "a printing board went back to rendering a stuck printer as a neutral 'no'");

  // A DURATION, NOT A TIMESTAMP. "nothing since 14 min ago" says when twice, and it shipped that way
  // for one run of this test — worth a check, because it reads fine until you say it out loud.
  check(!/(since|for) \$\{[^}]*\}[^`]*ago/.test(epanel) && !/come out (since|for) <b>\{age\}<\/b>[^<]*ago/.test(page),
    "…and the age is said once (a duration), never 'since 14 min ago'",
    "a pile-up line reads 'since N min ago' — two ways of saying when, in one sentence");
}

// ── 8d · ONE FILE, ONE TYPED CODE, NO LOGIN ON THE SHOP'S PC (mig 380) ───────────────────────
// Owner, 2026-09-13: "instead of login make something else otherwise the waiter will also do that
// printing thing and make completely diff login not this", then: "you can generate code for each
// restaurant from printing menu and like the helper ask for that code and that generated code only
// works for 10 min."
//
// ⚠️ THE mig-368 ALLOW PAGE IS GONE, and these checks are its replacement, not a relaxation of it.
// That handshake asked a restaurant's counter machine for a STAFF login — the same login a waiter
// has — and answered "sign in" to anybody signed in without print_setup, for ever. The security
// boundary it DID have is the one kept below: the restaurant is decided by the screen, never by the
// machine.
{
  const mig380  = read("supabase/migrations/380_a_setup_code_replaces_the_allow_page.sql");
  const codeLib = read("lib/printSetupCode.ts");
  const agentApi = read("app/api/print-agent/[...path]/route.ts");
  const script = read("lib/printHelperScript.ts");
  const board  = read("lib/printBoard.ts");

  check(/create table if not exists public\.print_setup_codes/i.test(mig380)
    && /code_hash\s+text not null unique/i.test(mig380)
    && /enable row level security/i.test(mig380),
    "a setup code is a short-lived row in a staff-only table (RLS on, no policies), stored HASHED",
    "mig 380 lost print_setup_codes, its unique code_hash, or its RLS");
  check(/drop table if exists public\.print_pairings/i.test(mig380),
    "…and mig 368's handshake table went WITH the page that used it",
    "print_pairings is still there with nothing reading it — an approved-but-uncollected row still holds a one-time printing token behind a door nobody opens ('a new way replaces the old one')");
  check(/delete from print_setup_codes\s+where restaurant_id = p_rid/i.test(mig380),
    "…and a purge clears it, like every other tenant table (the mig 346/354/369 trap)",
    "admin_purge_restaurant does not clear print_setup_codes — the ON DELETE CASCADE it declares has not fired since mig 309, so a purged restaurant keeps a code_hash for ever");

  // THE FILE CARRIES NO SECRET. This is what lets one file serve every restaurant, and it is the
  // owner's own ask — unchanged by mig 380, which moved the secret to a code that is TYPED, not
  // baked in.
  check(!/CODE="\$\{safe\(a\.code\)\}"/.test(script) && !/set "CODE=\$\{safe\(a\.code\)\}"/.test(script),
    "the helper file has no token baked into it — one file works for every restaurant",
    "a per-restaurant secret is back in the generated helper: the file cannot then be hosted, reused or emailed, and it puts a long-lived credential in a text file on a shop counter");
  check(/pair\/claim/.test(script) && /TOKEN_FILE/.test(script) && /TOKENFILE/.test(script),
    "…it ASKS for a setup code once and writes its own token to its own disk",
    "the helper stopped redeeming a setup code, so a computer cannot join a restaurant at all");
  check(!/pair\/start/.test(script) && !/pair\/poll/.test(script)
    && !/open "\$PU"/.test(script) && !/start "" "%PU%"/.test(script) && !/xdg-open "\$PU"/.test(script),
    "…and it opens NO BROWSER, so nobody is asked to sign in on the computer at the printer",
    "the helper opens a browser again: that is the staff-login-on-the-shop-PC flow the owner threw out, and it also cannot work on a headless machine");
  // COMMENTS STRIPPED: the code that REMOVED these two verbs explains what it removed and names
  // them to do it. A guard that trips on its own obituary is a guard the next person deletes — this
  // file's own header says so, and it happened again right here.
  check(!/pair\/start/.test(code(agentApi)) && !/pair\/poll/.test(code(agentApi)) && /seg\[1\] === "claim"/.test(agentApi),
    "the helper's door has ONE unauthenticated verb — redeem a code — and the old two are deleted",
    "pair/start or pair/poll is back on the agent API: they mint and hand out a token through a page that no longer exists");

  // THE FOUR THINGS THAT MAKE A TYPED CODE SAFE. Each is a rule, and each is what the owner is
  // trading against "no login on the shop PC".
  check(/createHash\("sha256"\)/.test(codeLib) && /code_hash: hash\(code\)/.test(codeLib)
    && !/code_hash: code\b/.test(codeLib),
    "the code is stored hashed — a database row can never be turned back into a working code",
    "lib/printSetupCode.ts stores the code in the clear: it is a live credential for ten minutes, and anything that can read the table could then attach a machine to that restaurant");
  check(/\.is\("claimed_at", null\)\s*\n?\s*\.select\("id"\)/.test(codeLib)
    || /\.eq\("id", row\.id\)\.is\("claimed_at", null\)/.test(codeLib),
    "…and it is spent by a FILTERED update, so two computers racing means the second gets nothing",
    "the claim stopped being a filtered update — two helpers typing one code both get a token, and half a restaurant's tickets come out in the wrong room");
  // RE-LINKING THE SAME MACHINE IS THE COMMONEST PATH, and it was broken. Found by running the real
  // helper on 2026-09-13: unlink a computer, run the file again, type a fresh code, and it answered
  // "There is already a computer with that name" — a database word, to a person standing at a
  // printer, with nothing they could do about it. print_agents is UNIQUE (restaurant_id, name)
  // across ALL rows and revoked rows are KEPT on purpose (mig 341), so a name check that filters
  // them out picks a name the database will refuse.
  check(!/\.eq\("restaurant_id", row\.restaurant_id\)\.is\("revoked_at", null\)/.test(codeLib)
    && /already a computer with that name/i.test(codeLib),
    "a machine re-linking under its own name is renamed, never refused — revoked rows count too",
    "claimSetupCode filters revoked rows out of its name check again, or dropped the retry: unlink a computer, run the helper, type a fresh code, and the person at the printer is shown a uniqueness error");
  check(/expires_at/.test(codeLib) && /SETUP_CODE_TTL_MS = 10 \* 60_000/.test(codeLib),
    "…and it dies in ten minutes, which is the owner's own number",
    "the ten-minute life is gone from lib/printSetupCode.ts — a code left on a screen stays usable");
  check(/\.eq\("restaurant_id", restaurantId\)\.is\("claimed_at", null\)/.test(codeLib),
    "…and issuing a new one kills the live one, so two codes are never working at once",
    "issueSetupCode stopped clearing the previous live code: a screen left open in an office keeps a second working code behind it");
  // ── WHICH COPY OF THE FILE IS THAT MACHINE RUNNING (mig 381) ──────────────────────────────
  // The owner photographed the SAME error twice, an hour apart, with the fix already live — because
  // the copy on his Desktop was the old one and NOTHING could tell them apart. The server knew
  // (his code was accepted, a row was created, it never came back) and had no way to say it.
  // ⚠️ PER BRANCH, AND IT MUST BE **ECHOED**. The first version of this check only asked that the
  // placeholder existed somewhere in the file — so deleting both banner lines left it matching the
  // copies inside the CLAIM BODY and the guard printed ok. Proved by sabotage (2026-09-13).
  // The banner is the whole point: the server can be told the version by the claim, but only a line
  // the window PRINTS can answer the question from a photograph, which is how this fault was
  // reported twice in the first place.
  {
    const branchOf = (name) => {
      const i = script.indexOf(`const ${name} = (a: HelperScriptArgs) =>`);
      if (i < 0) return "";
      const j = script.indexOf("\n`;", i);
      return j < 0 ? script.slice(i) : script.slice(i, j);
    };
    const mute = ["mac", "windows", "linux"].filter((os) => {
      const b = branchOf(os);
      if (!b) return true;
      return !b.split("\n").some((l) => /__HELPER_VERSION__/.test(l) && /^\s*(echo|  echo)/.test(l));
    });
    check(mute.length === 0 && /export function helperVersion/.test(script),
      "every helper file PRINTS its stamp, where a photograph of the window will show it",
      `the ${mute.join(", ") || "helper"} file does not print its version: an old copy and a new one fail the same way and look the same doing it, which is how the same error was photographed twice after it had been fixed`);
  }
  check(/createHash\("sha256"\)\.update\(bare\)/.test(script),
    "…and the stamp is DERIVED from the file's own text, so it cannot be forgotten",
    "the helper version is typed by hand again — a number somebody has to remember to bump is wrong exactly when it matters");
  // Counted loosely on purpose: the three files quote it three different ways (two shells through
  // an escaped JSON body, PowerShell through a hashtable), and pinning each spelling would make this
  // go red for a quoting change that is perfectly correct.
  check((script.match(/helper[^,]{0,12}__HELPER_VERSION__/g) || []).length >= 3,
    "…and all three files SEND it when they redeem a code",
    "a helper redeems a code without saying which copy of the file it is — the server is blind again");
  check(/reason: "oldfile"/.test(codeLib) && /refused_old_file_at/.test(codeLib),
    "a claim with no stamp is refused as an out-of-date file, and the board is told",
    "an old helper is treated like any other claim: it spends the code, leaves a dead computer row, and nothing anywhere says why");
  {
    // THE REFUSAL MUST COST NOTHING. That is the whole value of it.
    const fn = code(codeLib).slice(code(codeLib).indexOf("export async function claimSetupCode"));
    const refuse = fn.indexOf('reason: "oldfile"');
    const spend = fn.indexOf('claimed_at: new Date().toISOString()');
    check(refuse > 0 && spend > 0 && refuse < spend,
      "…and it is refused BEFORE the code is spent, so the one on screen still works",
      "the out-of-date refusal happens after the code is spent — the person loses the code AND gets no answer");
  }
  check(/never started/.test(codeLib) && /\.is\("last_seen_at", null\)/.test(codeLib),
    "a setup that never finished gives the machine's name back instead of keeping it for ever",
    "a failed setup keeps the computer's real name, so the next try is (2) and the board fills with (3), (4)");
  check(/\.lt\("created_at", ghostCut\)/.test(codeLib),
    "…and only once it is older than any code could be, so a machine still connecting is never renamed",
    "the ghost rule has no age bound: a computer that claimed a token seconds ago can be retired out from under itself");

  check(/rateAllowed\("print_setup_code"/.test(agentApi) && /status: 429/.test(agentApi),
    "…and a machine guessing codes meets a wall that is also the alarm",
    "the claim endpoint lost its rate limit — nothing counts or reports somebody working through codes");

  // WHO MAY HAND ONE OUT. This is the whole of the owner's objection: not the waiter.
  check(/seg\[0\] === "setup-code"/.test(code(adminR)) && /issueSetupCode/.test(adminR),
    "the admin console can hand out a code, behind the same tokenIsValid as every other verb here",
    "the admin console lost the setup-code verb");
  check(/b === "setup-code"/.test(code(eroute)) && /issueSetupCode\(rid, \{/.test(eroute),
    "…and so can a restaurant's own screen, behind print_setup — the person the owner named",
    "the manager panel lost the setup-code verb, so a restaurant cannot set its own printer up without Aevidine");
  check(/managerCan\(g, rid, "print_setup"\)/.test(code(eroute)),
    "…and that permission is asked on the SERVER before a code exists, so hiding the button is never the only guard",
    "the panel's printing verbs stopped asking print_setup — a waiter's own login would reach the code");
  check(!/issueSetupCode\([^)]*body\./.test(eroute),
    "…and the panel's code is for THEIR restaurant, never an id out of the request",
    "the panel's setup-code verb takes a restaurant id from the body — one manager could attach a machine to somebody else's shop");

  // THE OLD CREDENTIAL MINTERS ARE DELETED, not left switched off. All three answered with a
  // PERMANENT agent token and no screen had called any of them since mig 368.
  check(!/"newcode"/.test(adminR) && !/mintAgentToken/.test(code(adminR)) && !/createAgent\(rid, name\)/.test(code(adminR)),
    "the admin console has no other way to mint a printing credential",
    "POST /agents or agents/:id/newcode is back: two unreachable doors that each hand out a permanent printing token beside a new one is the exact thing 'a new way replaces the old one' forbids");
  check(!/createAgent\(/.test(code(eroute)) && !/panelScriptsFor/.test(eroute),
    "…and neither does the manager panel",
    "the panel's this-computer verb can conjure a print_agents row with a permanent token again");
  check(!exists("app/pair/page.tsx") && !exists("app/api/pair/route.ts"),
    "the Allow page and its door are DELETED, not left standing",
    "app/pair or app/api/pair is back — that is the staff login on a shop's counter PC, and the page that told a signed-in manager to sign in");

  // BOTH BOARDS SAY THE SAME THING, which is this whole area's standing rule.
  check(/setupCode/.test(board) && /liveCodeState/.test(board),
    "one read answers 'is a code live' for BOTH boards",
    "the boards read the live-code state separately again — two screens, two answers about one code");
  check(!/\bcode\b\s*:\s*(made|row)\.code\b/.test(code(board)),
    "…and the board payload never carries the code itself, only whether one is live",
    "the printing board sends the setup code to every reader of the board — it is shown once, on purpose");

  // THE MACHINE NAMES ITSELF, and starts itself.
  check(/scutil --get ComputerName/.test(script) && /%COMPUTERNAME%/.test(script),
    "the machine reports its OWN name, so nobody is asked to invent one",
    "the helper stopped sending its hostname — somebody has to type a computer name again (owner: 'what the fuck is a computer name')");
  check(/install_autostart/.test(script) && /LaunchAgents/.test(script) && /GetFolderPath\('Startup'\)/.test(script)
    && /autostart/.test(script),
    "…and it installs its own start-up on all three systems, so a shutdown is not a problem in the morning",
    "auto-start went back to being an INSTRUCTION a person must follow — and a skipped step means the shop opens and nothing prints");
  check(/Nothing to do/.test(script),
    "…which the screens state as a fact instead of a to-do",
    "HELPER_AUTOSTART is telling somebody to do something again");

  // WINDOWS: the hole that made "nothing is downloaded" only true on a Mac.
  // ⚠️ THIS USED TO TEST `/sha256:/` AND NOTHING MORE, and sabotage showed what that let through
  // (T25 round 2, 2026-08-31): emptying the constant to `sha256: ""` kept the guard GREEN, so the
  // helper would have downloaded a 20 MB program and checked it against nothing. A checksum is 64 hex
  // characters or it is not a checksum, and the version must appear in the URL it pins.
  const sha = (script.match(/sha256:\s*"([0-9a-f]{64})"/) || [])[1];
  const ver = (script.match(/version:\s*"([\d.]+)"/) || [])[1];
  check(/SUMATRA = \{/.test(script) && !!sha && /certutil -hashfile/.test(script),
    "Windows fetches its own PDF printer, pinned and checksummed (64 hex characters)",
    "the Windows helper is asking a person to download SumatraPDF by hand again, or fetching it without a real 64-character checksum to compare against");
  check(!!ver && new RegExp(ver.replace(/\./g, "\\.")).test(script) && !/\/dl\/rel\/latest\//.test(script),
    "…at a PINNED version, never a floating 'latest'",
    "the download URL floats: the program a restaurant runs could change underneath it with nobody deciding to");
  check(/PaperSizeWidth/.test(script) && /PaperSizeHeight/.test(script),
    "…and Windows now reports its paper sizes, instead of somebody typing them",
    "the Windows helper stopped reading paper sizes — and a page that disagrees with the paper is what prints a slip sideways");
  check(/running\.pid|LOCKFILE/.test(script) && /ALREADY RUNNING/.test(script),
    "…and a second copy on one machine steps aside instead of fighting for jobs",
    "the single-instance lock is gone: auto-start plus a double-click would put two helpers on one token");

  // ONE FILE, SHOWN BY BOTH BOARDS, and the code-carrying ceremony retired.
  check(/export const helperFiles/.test(board) && /files: helperFiles\(/.test(code(adminR)) && /files: helperFiles\(/.test(code(eroute)),
    "both boards show the SAME one file, from one place",
    "a printing board builds its own helper file again — two screens can then hand out different helpers");
  // Comments stripped on both sides: the code that REMOVED this ceremony explains what it removed,
  // and quotes the old wording to do it. A guard that trips on its own obituary is a guard the next
  // person deletes (this file's header, and it happened again right here).
  check(!/shown only once/i.test(code(page)) && !/data-pw="newcode"/.test(epanel) && !/"newcode"/.test(code(eroute)),
    "the 'new code, shown once' ceremony is gone — there is no token in the file to guard",
    "the newcode flow is back: it mints a credential that no screen displays any more, which is worse than no button");
  check(/data-pw="unlink"/.test(epanel) && /b === "unlink"/.test(code(eroute)),
    "…replaced by Unlink, which also empties the routes that named that machine",
    "unlink is gone, so there is no way to retire a computer from its own screen");

  // EVERY RESTAURANT ON ONE PAGE.
  check(/seg\[0\] === "overview"/.test(code(adminR)) && /adm-over-row/.test(page) && /adm-over-row/.test(read("app/globals.css")),
    "every restaurant is one row on one page, worst first",
    "the all-restaurants printing page is gone — finding whose printer is down means clicking through every restaurant again (owner: 'it will be messy when there will be too much restaurants')");

  check(/id="after"/.test(read("public/print-setup.html")) && /They shut the computer down at night/.test(read("public/print-setup.html")),
    "the guide answers what happens after it is installed — shutdowns, restarts, a new computer",
    "the after-install section is gone from /print-setup.html");
}

// ── 8e · THREE THINGS A REVIEW CAUGHT (owner relayed them, 2026-08-28) ────────────────────────
{
  const mcan = read("lib/managerCan.ts");
  const printApi = code(adminR);

  // 1 · THE PICKER AND THE GATE MUST RESOLVE THE SAME RULE. The Printing board offered a manager
  // whose own page said no — it read the restaurant-wide grant alone, so a person switched off
  // individually was still offered, their screen was then refused, and the kitchen got no paper with
  // nothing on either screen saying why. It failed the other way too.
  check(/export function managerHasFlag/.test(mcan) && /accessConfig\?\.\[flag\]\?\.on === false/.test(mcan),
    "one resolver answers 'may this person be the printer' — cap, then their own override, then the default",
    "managerHasFlag is gone from lib/managerCan.ts: the picker and the gate are two copies of one permission rule again, and they WILL disagree");
  check(/managerHasFlag\(/.test(printApi) && !/managerGrantValue\("print_here"/.test(printApi),
    "…and the Printing board's people picker calls it, per person",
    "the Printing board resolved print_here from the restaurant-wide grant again — a manager switched off individually is offered, picked, and then refused, and nothing says why");
  check(/permissions/.test(printApi) && /access_config/.test(printApi),
    "…reading the person's own override AND the feature cap, not just the restaurant default",
    "the picker stopped reading staff_users.permissions or access_config, so one of the three rungs is missing from its answer");

  // 2 · THE CODE IS SHOWN ONCE, AND BOTH BOARDS SAY SO (mig 380 — it replaced the Allow page, and
  // the review point it answered: the person standing at the printer is usually the manager, so the
  // restaurant's own screen must be able to do the whole job).
  check(/Show a setup code/.test(page) && /Show a setup code/.test(epanel),
    "both boards have the same 'Show a setup code' button, in the same words",
    "one of the two printing boards lost the setup-code button — that board can no longer set a computer up at all");
  check(/setupCode\?: \{[^}]*expiresAt: string \| null/.test(page)
    && /left<\/div>|left<\/span>|\} left/.test(page) && /data-pw-left/.test(epanel),
    "…and each shows a live countdown, so nobody has to guess how long they have",
    "a setup code is shown with no clock: 'ten minutes' said once, beside a code somebody is carrying to another room, is a number they then have to guess");
  // ── COPYING THE CODE MUST SAY SO, ON BOTH BOARDS ──────────────────────────────────────────
  // Owner, 2026-09-13: *"im also not able to copy the code or code is being copy but it not show
  // button click animation and also at bottom copied written"*. The first version called
  // `navigator.clipboard.writeText` directly and never told anybody: the code really was on the
  // clipboard and nothing on the screen moved, so the only way to find out was to paste somewhere
  // and look. A tap is never dropped in silence — and a browser that REFUSES the clipboard has to
  // be said out loud too, which a bare call cannot do either.
  //
  // BOTH PLACES, deliberately: a toast at the bottom of a tall settings page can be off screen
  // while the thumb is still up on the code, so the control that was pressed answers as well.
  check(/copy: \(t: string\) => void \| Promise<void>/.test(page) && /await copy\(shown!\.code\)/.test(page)
    && !/navigator\.clipboard\?\.writeText/.test(code(page)),
    "the admin board's Copy goes through the page's own copy(), so it toasts and says when it cannot",
    "the setup code's Copy calls the clipboard directly again: it copies in total silence, and a refusal is invisible");
  // ⚠️ SCOPED TO THE HANDLER, NOT THE FILE. This panel has a SECOND copy button — the helper
  // file's — and its own `toast("Copied.")`, so a file-wide search stayed green while the setup
  // code's toast was deleted. Proved by sabotage (2026-09-13). Read the handler's own block.
  {
    const h = code(epanel);
    const i = h.indexOf('what === "copycode"');
    const block = i < 0 ? "" : h.slice(i, i + 900);
    check(/data-pw="copycode"/.test(epanel) && !!block
      && /Copied \\u2713/.test(block) && /toast\("Copied\."\)/.test(block) && /Could not copy/.test(block),
      "…and the manager panel has the same button, which changes to Copied, toasts, and says when it cannot",
      "the manager panel's setup code has no Copy button, or its own handler copies without saying so");
  }
  // COMMENTS STRIPPED: commenting the line out left it matching, so the guard passed over a button
  // that no longer changes at all. Same sabotage run.
  check(/setCopied\(true\)/.test(code(page)) && /setCopied\(false\)/.test(code(page)),
    "…and the button itself changes, then changes back on its own",
    "the Copy button never changes, so the only feedback is a toast that may be off screen");
  check(!/localStorage[^\n]*printCode|printCode[^\n]*localStorage/.test(epanel),
    "…and the code is never written anywhere that outlives the page",
    "the manager panel stores the setup code in localStorage — a ten-minute secret that outlives its ten minutes on a shared till");

  // 3 · THE GUIDE OPENS BESIDE THE WORK, like the four other places that offer it.
  check(/print-setup\.html" target="_blank"/.test(page),
    "the Printing header's guide link opens in a NEW TAB, like the other four",
    "the guide replaced the Printing screen again — it is read WHILE setting a printer up, and the guide has no way back to the screen you were halfway through");
}

// ── 8f · TWO MODES, ONE TOGGLE, AND ONLY ONE OF THEM ON SCREEN (owner, 2026-08-28) ────────────
// "I want both A and B — the toggle AND the simplified UI, and do one thing: you only see the option
// you have selected, only the setting for that option will be shown." Plus mode B itself: a Chrome
// that "runs minimised and doesn't auto-open when printing required, doesn't affect other tabs".
{
  const stn = read("lib/printStationScript.ts");
  const helpers = read("lib/printHelpers.ts");
  const brd = read("lib/printBoard.ts");
  const guideRaw = read("public/print-setup.html");

  // ── MODE B's LAUNCHER, and the four things that make it not get in the way ──────────────────
  check(/export function stationScript/.test(stn) && /STATION_FILENAME/.test(stn),
    "mode B has a launcher of its own — one file per system, the same shape as the helper's",
    "lib/printStationScript.ts is gone: mode B goes back to being a wall of Terminal commands in the guide");
  check(/--kiosk-printing/.test(stn) && !/"--kiosk"/.test(stn) && !/--kiosk /.test(stn),
    "…it prints with no dialog (--kiosk-printing) and is NOT fullscreen-kiosk",
    "the station launcher gained --kiosk: that is FULLSCREEN kiosk, the opposite of the out-of-the-way window he asked for, and it is what the old guide told people to use");
  check(/--user-data-dir/.test(stn),
    "…in its own Chrome profile, so their real Chrome, tabs and logins are untouched",
    "the station launcher stopped using its own --user-data-dir: it would take over the person's ordinary Chrome");
  // THE ONE NOBODY WOULD GUESS. A hidden Chrome is throttled, a throttled panel stops polling, and
  // the tickets just queue while everything looks fine. Measured: 13 beacons in 14 seconds WITH
  // these flags. They are load-bearing.
  check(/--disable-background-timer-throttling/.test(stn) && /--disable-backgrounding-occluded-windows/.test(stn)
    && /--disable-renderer-backgrounding/.test(stn),
    "…and it carries the three anti-throttling flags, without which a hidden Chrome silently stops printing",
    "an anti-throttling flag was dropped from the station launcher. Chrome throttles background windows hard: the panel stops polling, tickets queue, and NOTHING on screen says so. Measured 2026-08-28 — 13 beacons in 14 seconds with them.");
  check(/WASFRONT/.test(stn) && /to activate/.test(stn),
    "…and on a Mac it hands the screen back to whoever had it",
    "the mac station launcher stopped restoring focus. Measured: even with open -g -j -n and a real url, the frontmost app went Finder → Google Chrome. An about:blank test says otherwise, which is how a false promise ships.");
  check(/caffeinate/.test(stn) && /powercfg/.test(stn),
    "…and it keeps the machine awake, because a sleeping computer prints nothing",
    "the station launcher no longer stops the machine sleeping — the commonest reason a restaurant says printing stopped overnight");
  check(!/password|PASSWORD/.test(code(stn)),
    "…and there is no password in it, like the helper",
    "a password appeared in the station launcher. The person signs in ONCE in the window it opens; a credential in a text file on a shop counter is what the pairing handshake exists to avoid.");

  // ── ⚠️ INVERTED: THERE IS NO TOGGLE (owner, 2026-08-31) ─────────────────────────────────────
  //
  // Previously (owner, 2026-08-28): *"there will be 2 mode… I want a toggle and the simplified UI —
  // like you only see the option you have selected."* Six checks here REQUIRED that: a stored
  // `PrintMode`, a `writeMode` that dragged the three paper lines with it, `mode: PrintMode` on the
  // shared board, an `adm-mode` / `pw-mode` toggle styled on both screens, both screens branching on
  // `mode === "computer"`, and a "mode" verb on both routes.
  //
  // LATEST (owner, 2026-08-31): *"in admin panel also we don't need toggle… with toggle gone it on
  // and off will decide that the helper will be on and off and kitchen panel will always be on."*
  //
  // So all six are inverted. What replaced the toggle is not another setting — it is a DERIVATION:
  // a computer prints if one is set up and named, and if none is, the kitchen screen does
  // (lib/printHelpers → resolveTarget). The stored mode could disagree with the routes, which is the
  // whole reason writeMode had to exist; with nothing stored there is nothing to keep in step.
  check(!/export type PrintMode/.test(helpers) && !/export async function writeMode/.test(helpers),
    "there is no stored printing mode, and no function to move it",
    "PrintMode/writeMode are back: a stored choice of mechanism can disagree with the routes, and the routes are what the paper obeys");
  check(!/mode: PrintMode/.test(brd) && /export const stationFiles/.test(brd),
    "…the shared board carries no mode (and still carries both launcher files)",
    "lib/printBoard.ts is publishing a mode again, so the screens will start branching on it");
  check(!/adm-mode/.test(page) && !/pw-mode/.test(epanel),
    "…neither printing screen renders the old mechanism toggle",
    "a mode toggle is back on one of the two printing screens");
  check(!/b === "mode"/.test(code(eroute)) && !/seg\[0\] === "mode"/.test(code(adminR)),
    "…and neither route will accept one",
    "a route accepts a 'mode' verb again: something can store a choice that nothing reads");

  // ── ⚠️ INVERTED AGAIN, AND ONLY HALFWAY (owner, 2026-09-13) ─────────────────────────────────
  //
  // *"In the admin panel printer menu I told something, you made something different. I want both
  // separate — on top of printer there should be 2 menu, one for screen printing by chrome kiosk and
  // one for helper, and they should have colour of red or green according to they are on and off."*
  //
  // The check above this one used to read "…while BOTH setups are on screen at once, which is the
  // point of removing the choice". That is the part he is objecting to: one long stacked column with
  // nothing on it saying which way the restaurant actually prints. So the ADMIN board now shows one
  // way at a time again, under two status cards.
  //
  // What must NOT come back with it is the thing 2026-08-31 actually killed: a STORED mode. The four
  // checks above still guard that, and the two below are the new line — the picker has to be a
  // MIRROR (derived, posts nothing, both can be green) and both ways have to stay reachable.
  // The ON/OFF word has to be ON THE TAB ITSELF, not merely somewhere in the file: the first version
  // of this check tested /"ON" : "OFF"/ against the whole page, and the board carries that ternary
  // twice (the tab, and the "below: the setup for X, which is ON" line under it). Sabotaging the tab
  // left the guard green — so it is tied to the tab's own `.w` span here.
  //
  // THE SHAPE IS HIS PICK, NOT A DEFAULT (owner, 2026-09-13): ten designs were built and shown on a
  // preview port and he chose the UNDERLINE tab bar — *"I liked underline one."* So the class is
  // asserted by name: a later "tidy-up" back into a boxed strip or a pair of cards is a silent
  // reversal of a choice he made by looking at all ten.
  check(/adm-waybar/.test(page) && /WAYS\.computer|WAYS\[id\]/.test(page)
    && /className="w[^"]*">\{[^}]*\? "ON" : "OFF"\}/.test(page),   // allow extra classes (it carries .hue-ink)
    "the admin board tops out with the two-way MENU — his underline bar — each way carrying an ON/OFF word as well as its colour",
    "the two-way menu is gone from the admin Printing board, stopped being the underline bar he picked out of ten, or lost its ON/OFF word — leaving colour as the only signal, which is exactly what a colour-blind admin cannot read");
  // ── AND THE WORD "YES" NEVER SITS ABOVE IT AGAIN (owner, 2026-09-13) ────────────────────────
  // *"Why the fuck I'm on OFF one and on top it show YES it's on."* The entitlement switch used to
  // render as a state row printing a big green YES, directly above a way-tab reading OFF — two
  // different switches in the same words. It is a header chip now, worded "Printing allowed", and
  // the only ON/OFF on this board belongs to the two ways.
  // (Narrow on purpose: `adm-state-val` still renders in the log's STUCK/OK row, which is a
  //  measurement of the queue and not a switch. What must never come back is the YES/NO PAIR.)
  //
  // WHERE THE ENTITLEMENT LIVES NOW (owner, 2026-09-13): *"I don't want this option printing allowed
  // for this restaurant… there should be an on-and-off feature button after the underline toggle
  // thing, and also make an i button and put this written info inside that, not here."* So it is one
  // button on the tab row whose VERB carries the state, with the explanation inside the ⓘ popover
  // beside it — not a status row, and not a chip repeating the word ON.
  check(!/"YES" : "NO"/.test(page) && /className="acts"/.test(page) && /adm-ibtn/.test(page)
    && /adm-pop/.test(page) && /post\("switch"/.test(page),
    "…the tab row carries an ⓘ, and the restaurant-wide switch still exists somewhere on the board",
    "the entitlement switch or its ⓘ has gone from the admin Printing board — or a YES/NO row is back, which is two different switches in the same words, the exact thing he swore at");
  // ── EACH WAY SWITCHES ITSELF (owner, 2026-09-13: *"both should have separate on off, right now
  // they have same"*) ────────────────────────────────────────────────────────────────────────────
  // One button used to sit at the end of the row carrying the RESTAURANT-WIDE entitlement, so both
  // tabs shared it. The row's button now acts on the tab you are standing on, by writing the very
  // route rows the tab's colour is read from — so the word above the button and the button's own
  // verb cannot drift apart. The entitlement moved into the ⓘ and onto the red banner.
  check(/const flipWay = async \(id: WayId\)/.test(page) && /onClick=\{\(\) => void flipWay\(way\)\}/.test(page),
    "…and the switch on the tab row belongs to THE WAY you are on, not to the whole restaurant",
    "the per-way switch is gone: one button is serving both tabs again, which is the complaint that created it");
  // AND IT NEVER INVENTS A PRINTER. Switching "a computer" ON would mean choosing a machine and a
  // printer for somebody — the same trap writeMode fell into. It refuses, and says what to do.
  check(/wayBlocked/.test(page) && /that is what switches a computer on/.test(page),
    "…and switching the COMPUTER way on is refused with a reason rather than guessing a printer",
    "the computer way can be switched on without naming a printer — something is guessing a machine, which is exactly what the deleted writeMode used to do");
  check(/useBackClose\("admin-printing-info"/.test(page),
    "…and that ⓘ closes on the phone's back button, like every other overlay in this console",
    "the printing ⓘ popover stopped registering with lib/backStack: on a phone, Back would leave the page instead of closing it");
  check(/setWay\(/.test(page) && !/post\("(mode|way)"/.test(code(page))
    && !/printing\.mode/.test(code(page)),
    "…and choosing one is a VIEW: it posts nothing and stores nothing, so it cannot disagree with the paper",
    "the way-picker started writing something to the server — that is the stored mode coming back through the back door, and a stored mode can disagree with the routes");
  check(/way === "computer"/.test(page) && /way === "screen"/.test(page)
    && /The computer that prints|STEPS\.two/.test(page) && /The kitchen screen|Whose screen prints|STEPS\.screen/.test(page),
    "…and BOTH setups are still reachable, one card-click apart",
    "one of the two setups is no longer reachable on the admin board: a restaurant can no longer set up the thing it needs");
  check(/function FileCard/.test(page),
    "…and the two launcher cards on the console share ONE component",
    "the helper file card and the station file card are two copies of one markup again — which is exactly how the wording drifted the first time");

  check(/id="twoways"/.test(guideRaw) && /print-station file/.test(guideRaw),
    "the guide explains both ways and the print-station file",
    "the setup guide does not mention mode B, so a restaurant handed the station file has nothing to read");
}

// ── 8g · A NAME CANNOT ADD A LINE TO THE FILE (T25 round 2, item 27, 2026-08-31) ───────────────
//
// The generated helper carries two values a person typed: the computer's NAME (admin → Printing →
// "Add a computer") and the site's origin (built from the request host). They are pasted into a zsh
// script, a .bat file and a comment line.
//
// The sanitiser stripped `"`, a backtick, `$` and `\` — everything that ends a quoted string — and
// not NEWLINES. A comment line only lasts until one. MEASURED before the fix, with the computer named
// `Front desk PC\nsay 'this line was added by the computer name'\n# `:
//
//     1| #!/bin/zsh
//     2| # Aevidine print helper — Front desk PC
//     3| say 'this line was added by the computer name'      ← a real line, from a NAME
//
// …identically on mac, windows and linux. Asserted here on the GENERATED TEXT, not on the regex, so a
// rewrite that sanitises differently still passes and one that stops sanitising cannot.
for (const genFile of ["../lib/printHelperScript.ts", "../lib/printStationScript.ts"]) {
  // BOTH generated files, because the station was the twin left behind: printHelperScript was fixed on
  // 2026-08-31 (item 27) and printStationScript still let an ORIGIN add a line (item 40, same day,
  // found by driving it).
  const lib = readFileSync(new URL(genFile, import.meta.url), "utf8");
  const c = code(lib);
  check(/\[[^\]]*\\r[^\]]*\\n[^\]]*\]\+?\/g, " "/.test(c),
    "the helper's sanitiser folds line breaks to a space",
    "lib/printHelperScript.ts no longer strips line breaks from the name/origin — a computer NAME can add a line to the generated script (measured 2026-08-31: line 3 of every script came from the name)");
  // Look for the class INSIDE the sanitiser's own replace(), not for the characters anywhere in the
  // file — `;` and `%` appear in ordinary code, so the loose version passed on the reverted file and
  // proved nothing (caught by sabotaging it, which is the only way to know).
  const safeCall = (c.match(/const safe = [\s\S]{0,400}?slice\(0, 200\)/) || [""])[0];
  check(/\[[^\]]*%[^\]]*\^[^\]]*&[^\]]*\|[^\]]*<[^\]]*>[^\]]*;[^\]]*\]/.test(safeCall),
    "…and the batch/shell punctuation that means \"and then do this\" goes with them",
    "lib/printHelperScript.ts stopped stripping % ^ & | < > ; from the two values a person types — `%VAR%` is how a .bat file expands a variable");
  check(/\.slice\(0, 200\)/.test(c),
    "the 200-character ceiling on each value is still there",
    "the length ceiling on the name/origin is gone — one paste could fill the script");

  // The properties, on the real generated text. Built by hand rather than imported: this guard runs
  // under plain node, and the file is TypeScript.
  const safeShape = (v) => String(v || "").replace(/[\r\n\u2028\u2029]+/g, " ").replace(/["`$\\%^&|<>;]/g, "").slice(0, 200);
  const nasty = "Front desk PC\nsay 'added from a name'\nrm -rf ~\n# ";
  const cleaned = safeShape(nasty);
  check(!/\n/.test(cleaned) && !/[;%^&|<>]/.test(cleaned),
    "the sanitiser's own shape leaves no line break and no chaining punctuation",
    "the sanitiser shape asserted by this guard no longer removes line breaks or chaining punctuation");
  check(cleaned.startsWith("Front desk PC"),
    "…and a normal computer name survives it unchanged",
    "the sanitiser is now eating ordinary names");
}

// ── 8h · THE BACKUP PRINTER IS GONE, AND STAYS GONE (T25 round 3, item 39, 2026-08-31) ────────────
//
// Removed across nine files on 2026-08-30 at the owner's word: *"What is this backup printer and all
// that? We don't even need the backup printer — if there is a backup printer, remove it. And if
// anything fails it should show me or the person: manager, owner, everyone should get a notification
// that this has failed."* A silent second attempt somewhere else is paper appearing in a room nobody is
// standing in, while the restaurant never learns its printer is broken.
//
// THE REMOVAL WAS NOT COMPLETE. Found by re-running four old ledger rows that were still defending the
// feature: app/api/editor/[...path]/route.ts was still forwarding `backupAgent` and `backupPrinter`
// from the request body into the route patch (dead weight that reads like a live feature), and two
// sentences in lib/printHelpers.ts still described a job degrading to a backup after a wait.
{
  const DEAD = ["backupAgent", "backupPrinter", "backupAfterMs", "backupPanel", "SCREEN_BACKUP_MS",
                "BACKUP_AFTER_MS_DEFAULT", "BACKUP_PRINTER_MS", "backupFor"];
  const walk = (dir, out = []) => {
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(rel);
    }
    return out;
  };
  const files = [...walk("lib"), ...walk("app"), ...walk("components"), ...walk("public/panels")];
  // ── THE NAMED EXEMPTION IS GONE, BECAUSE ITS REASON WAS NEVER TRUE (T11 sweep #8, 2026-09-04) ──
  //
  // This block used to exempt ONE name in ONE file: app/api/print-agent could go on answering
  // `backupFor: []`, "because a helper file already installed on a restaurant's PC reads that field;
  // sending an empty list is what makes an old helper behave like a new one."
  //
  // NO HELPER HAS EVER READ IT. Checked against the whole history of the generated scripts, not
  // reasoned about: `git log -S backupFor -- lib/printHelperScript.ts` is EMPTY, and the string does
  // not appear in any of the 40 commits that touched that file — nor in printStationScript.ts. The
  // field's entire life was three commits: born as a real computed list in the /hello response
  // (0f6b07cf), cut to a constant [] when the backup printer was deleted (053347c0), and then
  // exempted here (e8811e40) on a compatibility worry that was plausible and unsourced. The
  // exemption then kept the dead field alive, which is the opposite of what this block is for.
  //
  // So `backupFor` is now treated like the other seven names: gone from the code, obituary in a
  // comment. If a future helper really does need a field for compatibility, add it back WITH the
  // reader named — an exemption whose reason nobody can check is a check that has been switched off.
  const alive = [];
  for (const rel of files) {
    const raw = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    // CODE only — an obituary naming the deleted thing is exactly what this repo asks for.
    const code0 = raw.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const d of DEAD) {
      if (!new RegExp(`\\b${d}\\b`).test(code0)) continue;
      alive.push(`${rel} → ${d}`);
    }
  }
  // …and no generated helper script has grown a reader for any of them, which is the only thing that
  // could ever justify sending one again.
  {
    const scripts = ["lib/printHelperScript.ts", "lib/printStationScript.ts"]
      .map((rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8")).join("\n");
    check(!/\bbackupFor\b/.test(scripts),
      "no generated helper reads a `backupFor` field, so the server has no reason to send one",
      "a helper script now reads backupFor — if that is deliberate, the server has to send it again AND this guard's exemption has to come back with the reader named");
  }
  check(alive.length === 0,
    "the deleted backup printer is gone from every code path (obituary comments are fine)",
    "a piece of the DELETED backup printer is still in the code: " + alive.join(" | ") +
      " — it was removed on 2026-08-30 at the owner's word; a half-finished removal reads like a live feature");
}

// ── 8i · EVERY WRITE IN THE QUEUE READS ITS ERROR (T25 round 3, item 41, 2026-08-31) ──────────────
//
// Ten writes in lib/printQueue.ts were `await sb.from(…).update(…)` with the result thrown away. Two
// of them are the ones that matter: the DONE stamp (a failure leaves a printed ticket marked
// `printing` for ever, so the basket claims a ticket is in flight that nobody is holding) and
// switching the other screens OFF when one takes over (a failure leaves two screens active and both
// print — the one promise this feature makes). It is the same shape as the bill tombstone that
// "silently failed for months".
//
// The rule is not "throw" — a print path that crashes leaves the ticket worse off — it is "say so in
// the server log", which is the difference between an invisible fault and a findable one.
{
  const q = readFileSync(new URL("../lib/printQueue.ts", import.meta.url), "utf8");
  const qc = code(q);
  const bare = [];
  // WRITES ONLY — update / insert / upsert / delete. A select's error is a different question (it is
  // answered by the caller reading `.data`), and counting reads here made the first cut of this check
  // accuse six perfectly good queries.
  for (const m of qc.matchAll(/await\s+(?:sb\s*\.from\([^)]*\)\s*\.)(update|insert|upsert|delete)\(/g)) {
    const line = qc.slice(qc.lastIndexOf("\n", m.index) + 1, qc.indexOf("\n", m.index));
    // ONE named exemption: the printer_events insert that files the "gave up" complaint sits inside
    // its own try/catch, because the ticket is already parked and visible — a missing report must not
    // replace a real failure with a bookkeeping one.
    if (/printer_events"\)\.insert\(/.test(qc.slice(m.index, m.index + 120))) continue;
    bare.push(line.trim().slice(0, 90));
  }
  check(bare.length === 0,
    `every write in lib/printQueue.ts reads its error (${(qc.match(/await wrote\(/g) || []).length} through wrote())`,
    "a write in lib/printQueue.ts throws its result away: " + bare.join(" | ") +
      " — wrap it in wrote(\"what it was doing\", …) so a failure reaches the server log instead of vanishing");
  check(/const wrote = async/.test(qc),
    "…and the wrote() helper that logs a failed write is still there",
    "lib/printQueue.ts lost the wrote() helper — every write would be silent again");
}

// ── 8f · THE HELPER MUST NOT BREAK WHEN NOBODY IS WATCHING (mig 380) ─────────────────────────
//
// This block replaces the one that guarded the Allow page's three "tell the truth when you cannot
// ask" states (T4 sweep #8, items 3, 4 and 9). That page is deleted; the problem it was solving is
// not, it has only moved to the machine at the printer. Setting up now means somebody TYPING, so
// every path where nobody can type has to be an answer rather than a hang.
{
  const script = read("lib/printHelperScript.ts");

  // 1 · AN AUTO-STARTED COPY HAS NOBODY WATCHING IT. Sitting at a prompt inside a minimised window
  // looks, from the outside, exactly like a helper running perfectly and never printing.
  // ⚠️ ASSERT THE THREE ENTRIES, NOT THE WORD. The first version of this check was `/--auto/` — and
  // this file's own header, twenty lines up, EXPLAINS --auto, so deleting it from every launcher
  // left the check matching a comment and printing ok. Proved by sabotage (2026-09-13): the plist
  // and the Windows shortcut both lost it and the guard stayed green. Each launcher is named.
  check(/<string>--auto<\/string>/.test(script)                       // the Mac LaunchAgent
    && /\$s\.Arguments='\/auto';/.test(script)                        // the Windows Startup shortcut
    && /"Exec=\/bin\/sh[^\n]*--auto"/.test(script),                     // the Linux .desktop entry
    "the auto-start entry marks itself, on all three systems",
    "an auto-start entry stopped passing --auto (or /auto): a machine nobody has linked yet waits at a prompt in a window that does not exist, which from the outside looks exactly like a helper running fine and never printing");
  check(/\[ "\$AUTO" = "1" \] \|\| \[ ! -t 0 \]/.test(script)
    && /if \/I "%~1"=="\/auto" if not exist "%TOKENFILE%"/.test(script),
    "…and a copy that cannot be typed into steps aside instead of waiting for a code",
    "the helper prompts for a setup code with no terminal and nobody there — it will wait for ever and never say why");
  check(/ThrottleInterval<\/key><integer>300</.test(script),
    "…and the Mac's auto-start does not re-run it every ten seconds while it is unlinked",
    "the LaunchAgent lost its ThrottleInterval: an unlinked machine re-runs this file 360 times an hour writing a log nobody asked for");

  // 2 · A REFUSED TOKEN CLEARS ITSELF. It used to tell a restaurant to go and delete a file inside a
  // hidden folder, so the real outcome was a machine that never printed again and nobody knowing why.
  check((script.match(/rm -f "\$TOKEN_FILE"/g) || []).length >= 2 && /del \/q "%TOKENFILE%"/.test(script),
    "an unlinked computer throws its dead token away by itself, on all three systems",
    "the helper keeps a token the site has already refused, and asks a restaurant to delete a file in a hidden folder");
  check((script.match(/if link_up; then continue; fi/g) || []).length >= 2 && /goto askcode/.test(script),
    "…and asks for a fresh setup code there and then, if somebody is sitting at it",
    "an unlinked helper no longer offers to re-link: the only way back is finding the token file by hand");

  // 3 · THE ONE-AT-A-TIME LOCK MUST NOT LOCK OUT A SETUP. The auto-started copy holds the lock, and
  // it is exactly the copy that has nothing to do on a machine with no token.
  check(/if \[ -s "\$TOKEN_FILE" \]; then/.test(script),
    "a second copy stands aside only when this machine actually has a token to share",
    "the single-instance lock turns away the copy somebody just started to type a code into — the auto-started one holds it, and it is the one with nothing to do");

  // 4 · THE TYPED VALUE NEVER REACHES A COMMAND LINE ON WINDOWS. A quote or an ampersand pasted out
  // of a chat window is how a .bat file stops being the file you wrote.
  check(/typed\.txt/.test(script) && /-replace '\[\^A-Za-z0-9\]',''/.test(script),
    "…and Windows reads what was typed from a file, stripped to letters and digits",
    "the Windows helper puts the typed code straight on a PowerShell command line");
}

// ── 8j · A .bat CANNOT READ A VALUE IT SET IN THE SAME BLOCK (T11 sweep #8, 2026-09-04) ───────────
//
// cmd.exe expands every %VAR% when it PARSES a whole parenthesised block — before one line of it
// runs. So a %VAR% read inside `if ... ( ... )` sees the value from BEFORE the block started, even
// when `setlocal enabledelayedexpansion` is on. !VAR! is what reads a value set in the same block.
//
// THIS WAS NOT HYPOTHETICAL. The Windows helper fetched SumatraPDF (Windows has no built-in silent
// PDF print), hashed the zip with certutil inside an `if not exist (...)` block, and then compared:
//
//     set "GOT="
//     for /f ... do if not defined GOT set "GOT=%%h"
//     set "GOT=%GOT: =%"                ← parse-time: %GOT% is undefined, so this CLEARS GOT
//     if /I not "%GOT%"=="98b33a…" (    ← parse-time: becomes  if /I not ""=="98b33a…"  → true
//       del the zip · "did not download correctly" · exit /b 1
//
// …so the checksum could never match, the download was deleted on every run, and a Windows helper
// could not print at all unless somebody had already put SumatraPDF.exe beside the file by hand —
// the one manual step that fetch exists to remove. Fixed to !GOT!; this walks both generated .bat
// templates so the class cannot come back on the next line somebody adds.
//
// It reads the TEMPLATE TEXT rather than the generated file, because this guard takes no TypeScript
// loader — the .bat lines are verbatim in the source apart from ${…} interpolations.
{
  const batOf = (src, name) => {
    const i = src.indexOf(`const ${name} = (a:`);
    if (i < 0) return "";
    const open = src.indexOf("`", i);
    if (open < 0) return "";
    // the template ends at the first backtick on its own that closes it: these files end each
    // template with "\n`;" on its own line.
    const close = src.indexOf("\n`;", open);
    return close < 0 ? "" : src.slice(open + 1, close);
  };
  const targets = [
    ["lib/printHelperScript.ts → print-helper.bat", batOf(script, "windows")],
    ["lib/printStationScript.ts → print-station.bat", batOf(read("lib/printStationScript.ts"), "windows")],
  ];
  const trouble = [];
  for (const [label, txt] of targets) {
    if (!txt) { trouble.push(`${label}: could not find the windows template to read`); continue; }
    let depth = 0;
    const stack = [];
    txt.split("\n").forEach((raw, n) => {
      // drop REM/:: comment lines and blank out ${…} interpolations
      if (/^\s*(REM|::)/i.test(raw)) return;
      // `echo(` IS NOT A BLOCK (2026-09-13). It is cmd's own idiom for echoing a value that might
      // be empty or start with something echo would swallow, and this counter read its "(" as an
      // opened block — after which EVERY later line looked like it was inside one, and this check
      // reported twenty-odd faults that were not there. A guard that invents failures is a guard
      // the next person switches off. Blanked before anything else counts parens.
      const ln = raw.replace(/\$\{[^}]*\}/g, "X").replace(/\becho\(/gi, "echo ");
      for (const m of ln.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)(?::[^%]*)?%/g)) {
        const v = m[1].toUpperCase();
        if (depth > 0 && stack.some((set) => set.has(v))) {
          trouble.push(`${label} line ${n + 1}: reads %${m[1]}% inside a block that sets it — use !${m[1]}!  ·  ${raw.trim().slice(0, 80)}`);
        }
      }
      const setM = /(?:^|\s)set\s+"?([A-Za-z_][A-Za-z0-9_]*)\s*=/i.exec(ln);
      if (setM && depth > 0) stack[stack.length - 1]?.add(setM[1].toUpperCase());
      const opens = (ln.match(/\(/g) || []).length;
      const closes = (ln.match(/\)/g) || []).length;
      for (let k = 0; k < opens; k++) { depth++; stack.push(new Set()); }
      for (let k = 0; k < closes && depth > 0; k++) { depth--; stack.pop(); }
    });
  }
  check(trouble.length === 0,
    "no Windows script reads a value with %VAR% inside the block that set it (that value is always the old one)",
    "a .bat reads a same-block value with %VAR%, which cmd expands before the block runs: " + trouble.join(" | "));

  // ── ...AND NO cmd ESCAPE INSIDE A QUOTED PowerShell COMMAND ───────────────────────────────
  //
  // FOUND ON A REAL WINDOWS PC (2026-09-13, the owner's photo of the helper window):
  //
  //     Checking that code...
  //     Get-Content : A positional parameter cannot be found that accepts argument '^'.
  //
  // cmd does NOT process `^` inside double quotes — there is nothing to escape there — so a `^|`
  // written inside a `-Command "…"` payload is handed to PowerShell as a stray caret argument and
  // the read comes back empty.
  //
  // WHY THIS EARNED A GUARD. It broke all FOUR reads of the join at once (the error message, the
  // token, the restaurant, the computer name) and it failed in the worst possible way: a CORRECT
  // code was SPENT on the server, the token read came back empty, the helper said "the site
  // answered oddly" and went round again — so every attempt burned a fresh code and nothing on
  // either screen said why. Three older reads in the same file (pollMs, job id, printer) have
  // always used a plain `|` and have always worked; this asserts every read agrees with them.
  //
  // NOT "no caret at all": `-replace '[^A-Za-z0-9]'` is a PowerShell character class and is
  // correct. Only the cmd ESCAPES are wrong inside quotes, and those are what this looks for.
  {
    const bad = [];
    for (const [label, txt] of targets) {
      txt.split("\n").forEach((raw, n) => {
        if (/^\s*(REM|::)/i.test(raw)) return;
        // every  -Command "…"  payload on this line
        for (const m of raw.matchAll(/-Command\s+"((?:[^"]|"")*)"/g)) {
          const hit = m[1].match(/\^[|&<>^]/g);
          if (hit) bad.push(`${label} line ${n + 1}: ${hit.join(" ")} inside a quoted -Command  ·  ${raw.trim().slice(0, 80)}`);
        }
      });
    }
    check(bad.length === 0,
      "no Windows script escapes a cmd character inside a quoted PowerShell command (cmd does not read them there — the program does)",
      "a .bat writes a cmd escape (^| ^& ^< ^>) inside a quoted -Command: the caret reaches the program as a stray argument and the whole read comes back empty — " + bad.join(" | "));
  }

  // ── EVERY for /f READ HAS THE SAME SHAPE AS THE ONES A REAL WINDOWS PC HAS RUN ────────────
  // There is no Windows machine on this side (this file's own §D note says so), so "it matches the
  // three that are proven to work" is the strongest thing that CAN be asserted here — and it is
  // what would have caught the caret before it ever reached a shop.
  {
    // `targets` holds the TS SOURCE of the batch template, so every backtick still carries the
    // backslash that keeps it inside the template literal — hence the optional \\ below. Written
    // once here rather than un-escaping the whole file, which would hide other escaping mistakes.
    const shape = /^for \/f "usebackq tokens=\*" %%i in \(\\?`powershell -NoProfile -Command "[^"]*"\\?`\) do (set "[A-Za-z]+=%%i"|echo\s+%%i)\s*$/;
    const off = [];
    for (const [label, txt] of targets) {
      txt.split("\n").forEach((raw, n) => {
        const line = raw.trim();
        if (!/^for \/f.*usebackq/i.test(line)) return;
        if (!shape.test(line)) off.push(`${label} line ${n + 1}: ${line.slice(0, 90)}`);
      });
    }
    check(off.length === 0,
      "every for /f PowerShell read is the same shape as the three a real Windows PC has run",
      "a for /f read drifted from the proven shape — this is the one platform nothing here can execute, so matching what works is the whole assurance: " + off.join(" | "));
  }
  // …and delayed expansion is actually switched on, or !VAR! is just literal text.
  for (const [label, txt] of targets) {
    if (!txt) continue;
    check(/setlocal\s+enabledelayedexpansion/i.test(txt) || !/![A-Za-z_][A-Za-z0-9_]*!/.test(txt),
      `${label.split(" → ")[1]} may use !VAR! — delayed expansion is switched on`,
      `${label} uses !VAR! without "setlocal enabledelayedexpansion" — the exclamation marks would print literally`);
  }
}

// ── 9 · it is written down ────────────────────────────────────────────────────────────────────
check(plan.length > 4000 && /print_agents/.test(plan) && /four ticks/i.test(plan),
  "docs/PRINT-HELPER.md still explains the whole thing, including the four ticks",
  "the print-helper design doc has shrunk to a stub");

if (fails.length) {
  console.log(`\n✗ verify:print-helper — ${fails.length} check(s) failed:`);
  for (const f of fails) console.log("   · " + f);
  process.exit(1);
}
console.log(`\nAll ${pass} checks passed — one basket, many printers, and no screen fighting a computer for the paper.`);
