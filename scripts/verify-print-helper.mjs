#!/usr/bin/env node
// verify:print-helper — the rules that make "a computer prints the paper" safe (mig 341).
//
// Everything here was learned by DRIVING it on 2026-08-20, and every check names the fault it would
// have caught. Read the reason before "fixing" a failure: several of these look like style and are
// not.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
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

// ── 3 · ONE bill, ONE ticket, one file ────────────────────────────────────────────────────────
check(/billdoc\.js/.test(docs) && /kotDocHtml|billDocHtml|banquetDocHtml/.test(docs),
  "the paper a helper prints is built by public/panels/billdoc.js — the file every screen prints from",
  "the helper path has grown its own document builder: a second layout drifts the moment either side is touched");
// Looks for the BYTES, not the phrase: both files talk ABOUT ESC/POS in comments explaining why the
// helper must never emit it, and a guard that trips on its own explanation is a guard people delete.
check(!/\\x1[bd]|\\u001[bd]|0x1[bd],|Buffer\.from\(\[/.test(docs + script),
  "…and nobody writes raw printer bytes by hand — that would be a second bill layout",
  "raw printer commands have appeared in the helper path; the document must stay the one HTML file");
check(/withPaper/.test(docs) && /@page\{size:/.test(docs) && /already declares/.test(docs),
  "the page size is stamped from the printer's OWN paper, and a document that declares its own is left alone",
  "the paper-size stamp is gone or unconditional — a page that disagrees with the paper is what rotates a ticket or halves it (2026-08-19)");

// ── 4 · a screen must stand down when a computer owns the paper ────────────────────────────────
check(/helperFor/.test(kroute) && /screenPrints/.test(kroute) && /autoPrintKot: autoOn && screenPrints/.test(kroute),
  "the kitchen board stands down when a helper owns the tickets",
  "the kitchen screen prints again alongside a helper: the same ticket then comes out in two rooms, and the screen's copy is the one in the wrong one");
check(/refused: "helper"/.test(kroute),
  "…and a tab opened BEFORE the route was set is refused at the claim too",
  "the claim no longer refuses a helper-owned ticket — a stale tab walks straight through a gate that lives only in the board read");
check(/helper\.owned\) return \{ mayPrint: false/.test(eroute) || /if \(helper\.owned\) return \{ mayPrint: false/.test(eroute),
  "the manager screen stands down as well, backup path included",
  "the counter screen can still print a helper-owned ticket");
check(/helper: \(r && r\.helper\) \|\| null/.test(epanel) && /printOwners/.test(epanel),
  "…and the panel CARRIES that answer, or every line about it is invisible while the server is right",
  "the panel dropped the helper field — the fault caught on 2026-08-20 by driving the panel, not by reading it");
check(/from \$\{esc\(hlp\.agent\)\}|from " \+ esc\(hlp\.agent\)|esc\(hlp\.printer\)/.test(kpanel),
  "the kitchen sheet NAMES the computer and printer, so a quiet screen is never a mystery",
  "the kitchen printer sheet no longer says where the paper comes out");

// ── 5 · the admin looking is not the restaurant printing ──────────────────────────────────────
check(/adminView: true/.test(eroute) && /force/.test(eroute) && /print_sent_by_admin/.test(eroute),
  "the admin viewing a restaurant's panel prints NOTHING at their shop unless deliberately forced — and that is audited",
  "the admin console can print on a paying client's roll just by looking at their panel");

// ── 6 · the helper program itself ─────────────────────────────────────────────────────────────
check(/HELPER_FILENAME/.test(script) && /print-helper\.command/.test(script) && /print-helper\.bat/.test(script) && /print-helper\.sh/.test(script),
  "all three operating systems get a helper, by hand",
  "an operating system lost its helper script");
check(!/api\/print-agent\/(mac|windows|linux)|download>/.test(script + page),
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
  && !/if \(!admin\(req\)\)/.test(adminR.replace(/^\s*\/\/[^\n]*$/gm, "")),
  "the admin printing API is gated on every verb — and the gate is AWAITED (a Promise is always truthy)",
  "an /api/admin/printing verb lost its gate, or tests tokenIsValid without awaiting it — which is the same as having no gate at all");
check(/aevinite\/printing/.test(read("components/admin/AdminShell.tsx")),
  "…and the menu is reachable from the sidebar, not only by URL",
  "the Printing menu is gone from the admin nav");
check(!/\bkot\b/.test(page.replace(/kot:/g, "").replace(/"kot"/g, "")),
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
