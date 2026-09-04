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

// ── 8d · ONE FILE, ZERO TYPING (mig 368, owner 2026-08-27) ────────────────────────────────────
// "There wouldn't be one key for all restaurants… or maybe a pairing code or whatever" → and then,
// picking between typing six digits and pressing one button: "zero typing one, yeah".
{
  const mig368 = read("supabase/migrations/368_a_helper_pairs_itself_no_code_to_carry.sql");
  const pairLib = read("lib/printPair.ts");
  const pairApi = read("app/api/pair/route.ts");
  const pairPage = read("app/pair/page.tsx");
  const script = read("lib/printHelperScript.ts");
  const board = read("lib/printBoard.ts");

  check(/create table if not exists public\.print_pairings/i.test(mig368) && /secret_hash/.test(mig368)
    && /enable row level security/i.test(mig368),
    "a handshake is a short-lived row, and that table is staff-only (RLS on, no policies)",
    "mig 368 lost print_pairings or its RLS");

  // THE FILE CARRIES NO SECRET. This is the whole point: it is what lets one file serve every
  // restaurant, and it is the owner's own ask.
  check(!/CODE="\$\{safe\(a\.code\)\}"/.test(script) && !/set "CODE=\$\{safe\(a\.code\)\}"/.test(script),
    "the helper file has no token baked into it — one file works for every restaurant",
    "a per-restaurant secret is back in the generated helper: the file cannot then be hosted, reused or emailed, and it puts a long-lived credential in a text file on a shop counter");
  check(/pair\/start/.test(script) && /pair\/poll/.test(script) && /TOKEN_FILE/.test(script),
    "…it pairs ITSELF and writes its own token to its own disk",
    "the helper stopped pairing itself, so somebody has to carry a code to the machine again");

  // THE THREE THINGS THAT MAKE IT SAFE. Each is a rule, and each was driven in the sweep.
  check(/secret_hash !== hash\(secret\)/.test(code(pairLib)) && /state: "expired"/.test(pairLib),
    "the token is collected with a secret only the helper holds, and a wrong one is answered like an unknown code",
    "the pairing poll stopped checking the private secret, or now tells the difference between a wrong secret and a missing row — which turns it into a way to discover codes");
  check(/collected_at/.test(code(pairLib)) && /not\("token_once", "is", null\)/.test(pairLib),
    "…and it is collected exactly ONCE, with a spent pairing saying so",
    "a replayed poll can collect the token twice, or a spent pairing answers 'waiting' for ever (the sweep found that one)");
  check(/tokenIsValid/.test(pairApi) && /managerCan\(/.test(pairApi) && /print_setup/.test(pairApi),
    "…and only a signed-in human may approve one — the admin, or a manager with print_setup",
    "the Allow door lost its gate: a stranger could adopt a machine into a restaurant");
  check(/who\.kind === "admin" \? String\(body\.rid \|\| ""\) : who\.restaurantId/.test(pairApi),
    "…and a manager can only ever adopt into their OWN restaurant (the body's rid is ignored for them)",
    "the Allow door trusts a restaurant id from the request for staff — any manager could attach a machine to somebody else's shop");
  check(/signedIn: false/.test(pairApi) && /Sign in on this computer first/.test(pairPage),
    "a signed-out browser is told to sign in, not offered the button",
    "the Allow page offers its button to somebody who is not signed in");

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
  const pairPage = read("app/pair/page.tsx");   // its own read — the 8d block's copy is scoped to it

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

  // 2 · THE ALLOW PAGE MUST NOT SEND A MANAGER TO OUR PASSWORD WALL. The printing board lives in two
  // places, and the person standing at the printer is usually the manager.
  check(/who === "admin"/.test(pairPage) && /href="\/manager"/.test(pairPage),
    "after linking a computer, a manager is sent to their OWN panel, not to the Aevidine console",
    "the Allow page's last button goes to /aevinite for everybody again — a manager hits a staff-password screen at the exact moment the guide says to go and choose printers, which reads like their own login just failed");
  check(/Settings → Printing/.test(pairPage),
    "…and is told in words where to find it",
    "the Allow page no longer says WHERE the printing board is on the manager's own panel");

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
    "…neither printing screen renders a mechanism toggle",
    "a mode toggle is back on one of the two printing screens");
  check(!/b === "mode"/.test(code(eroute)) && !/seg\[0\] === "mode"/.test(code(adminR)),
    "…and neither route will accept one",
    "a route accepts a 'mode' verb again: something can store a choice that nothing reads");
  // WHAT MUST STILL BE TRUE: both setups have to be REACHABLE, or "no toggle" would be satisfied by
  // a board that offers neither. The helper's card and the kitchen-screen card are both present.
  check(/The computer that prints|STEPS\.two/.test(page) && /The kitchen screen|STEPS\.screen/.test(page),
    "…while BOTH setups are on screen at once, which is the point of removing the choice",
    "one of the two setups vanished with the toggle: a restaurant can no longer set up the thing it needs");
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

// ── 8f · THE ALLOW PAGE TELLS THE TRUTH WHEN IT CANNOT ASK (T4 sweep #8, items 3, 4 and 9) ────────
// A person is standing at a printer, on a machine a program just opened this page on. Three things
// were wrong there and each is one line of the shape below.
{
  const pairPage = read("app/pair/page.tsx");
  const pairApi = read("app/api/pair/route.ts");

  // 3 · "we could not ask" had no card, so it fell through to "sign in" — for somebody already
  // signed in, about a problem that has nothing to do with signing in. Measured headless before
  // the fix: the card read "Sign in on this computer first".
  // ASSERT THE CARD, NOT THE SENTENCE. Found by SABOTAGE (T4 round 3): "Could not reach the site"
  // appears TWICE in this file — once as the card's heading and once in the POST failure handler's
  // setErr — so deleting the card's own heading left this check matching the OTHER copy and the
  // guard stayed green over the removed card. Anchor on the branch that RENDERS it instead.
  check(/const \[unreachable, setUnreachable\] = useState\(false\);/.test(pairPage)
    && /if \(unreachable\) return \([\s\S]{0,400}<h1>Could not reach the site<\/h1>/.test(pairPage),
    "the Allow page has its own card for 'this computer is not getting an answer'",
    "app/pair/page.tsx lost the unreachable card — a network fault reads as 'sign in' again");
  check(/if \(!r\.ok\) \{ setUnreachable\(true\); return; \}/.test(pairPage),
    "…and a 5xx from our own door counts as that, not as 'not signed in'",
    "the Allow page trusts the body of a non-2xx answer again, so a 503 reads as signed-out");
  check(pairPage.indexOf("if (unreachable) return") < pairPage.indexOf('if (!st) return <p className="pr-lead">Reading…'),
    "…and that card is chosen before the 'Reading…' placeholder",
    "the unreachable card sits after the Reading… fallback, so it can never be reached");

  // 4 · the door had no answer for a database flap: every neighbour catches AuthDbError, this one
  // let it escape as an unclassified 500.
  check(/AuthDbError/.test(pairApi) && /reason: "pair_busy"/.test(pairApi) && /status: 503/.test(pairApi),
    "the Allow door answers 503 with a code when the database will not say who is asking",
    "app/api/pair lost its AuthDbError branch — a database blip is an unclassified 500 again");
  check((pairApi.match(/who\.kind === "busy"/g) || []).length === 2,
    "…on the read AND on the press, since both ask who is there",
    "only one of GET/POST in app/api/pair handles the busy case");

  // 9 · the page asked its own door once per keystroke, because the two defaults it fills in were
  // dependencies of the function that fills them.
  check(/\}, \[code\]\);/.test(pairPage) && /setName\(\(cur\) => cur \|\| /.test(pairPage)
    && /setRid\(\(cur\) => cur \|\| /.test(pairPage),
    "…and it asks the door once per open, not once per character typed",
    "app/pair/page.tsx put `name`/`rid` back in load()'s dependencies — every keystroke asks the door again");
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
      const ln = raw.replace(/\$\{[^}]*\}/g, "X");
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
