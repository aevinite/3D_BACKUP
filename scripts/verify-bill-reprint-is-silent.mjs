// verify-bill-reprint-is-silent.mjs — printing a bill AGAIN is not an event.
//
//   node scripts/verify-bill-reprint-is-silent.mjs
//
// WHY THIS EXISTS. Owner, 2026-08-19, in the message that removed the feature:
//
//   "in the printing bill I don't even want the reprinted bill shown in the bill, as well as I
//    don't want reprinted bill shown anywhere like on audit also, because it's not any kind of
//    problem which needs to be audited … reprinting should also not ask any question … and make
//    the guard also in code like never change that to reprint thing and stuff … after once print
//    the button will just show reprint instead of print, works same"
//
// The band on the bill, the second "why are you doing this?" prompt on Print, and the idea that a
// duplicate copy is something to record all arrived TOGETHER (2026-08-05 → 2026-08-17) and all
// went together. They will come back together too, because each one looks individually sensible to
// whoever finds the half of it that is left — a `reprint` flag with no band, a `bill_printed_at`
// with no reader. So this file pins the whole rule at once, in four parts:
//
//   1. the BILL sheet never carries the word, even if a caller insists;
//   2. the kitchen TICKET still does — that banner is his, from 2026-08-04, and he re-confirmed it;
//   3. no print path asks a question, and nothing about a print reaches the Audit;
//   4. the bill's button always says "Print" — no "Reprint" word, no stamp (owner, 2026-10-10, R62:
//      "this was for kot not bill so remove the thing" — this REVERSES part 4 as it stood on 2026-08-19).
//
// Reopening a bill is a DIFFERENT act and stays fully recorded — the reopen reason is still
// required, `invoice_voided` is still audited, and the new invoice number is still logged. Part 3
// checks that too, so "stop auditing reprints" can never quietly become "stop auditing reopens".
//
// Static: no database, no login, no browser, no dev server.
//
//   node scripts/verify-bill-reprint-is-silent.mjs          # the full, spoken run
//   node scripts/verify-bill-reprint-is-silent.mjs --hook   # PostToolUse mode (silent unless broken)
//
// --hook reads the tool-call JSON on stdin and does nothing unless one of the four files this rule
// actually lives in was just edited, so it costs nothing on every other edit in the repo.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const HOOK = process.argv.includes("--hook");
// The files the rule lives in. Edit any of them and this runs; edit anything else and it exits.
const GUARDED = /(panels\/billdoc\.(js|d\.ts)|panels\/editor\/app\.js|panels\/tablet\/app\.js|api\/editor\/\[\.\.\.path\]\/route\.ts|verify-bill-reprint-is-silent\.mjs)$/;
if (HOOK) {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { process.exit(0); }
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const file = payload?.tool_input?.file_path || payload?.tool_response?.filePath || "";
  if (!GUARDED.test(String(file))) process.exit(0);          // not our business
}

const BILLDOC = require(join(ROOT, "public/panels/billdoc.js"));

let fails = 0;
const ok = (m) => { if (!HOOK) console.log(`  ok   ${m}`); };
const bad = (m, detail) => { fails++; console.log(`  FAIL ${m}`); if (detail) console.log(`         ${detail}`); };
const say = (m) => { if (!HOOK) console.log(m); };

const EDITOR = read("public/panels/editor/app.js");
const TABLET = read("public/panels/tablet/app.js");
const BILLDOC_SRC = read("public/panels/billdoc.js");
const ROUTE = read("app/api/editor/[...path]/route.ts");
const TROUTE = read("app/api/tablet/[...path]/route.ts");

// Code only. Several checks below look for wording that these files legitimately QUOTE in their
// REJECTED comments (that is the "write every rejection into the code" rule doing its job), so the
// guard reads what actually runs. Crude on purpose: a "//" inside a string is rare here and the
// worst case is a stricter check, never a looser one.
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

say("\n1. THE BILL SHEET NEVER SAYS IT IS A SECOND COPY");
{
  const S = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] };
  const os = [{ status: "served", subtotal: 620, taxable_base: 620, nontax_amount: 0, discount: 0, tax_rate: 0.05,
    items: [{ title: "Paneer Tikka", qty: 2, price: 310, tax_mode: "excl" }] }];
  const sheet = (a) => BILLDOC.billDocHtml(BILLDOC.billData({
    settings: S, restaurant: {}, orders: os, session: { bill_no: 41, invoice_no: 7 }, autoPrint: false, ...a,
  }));
  // A plain bill, and a bill printed by a caller that still passes the retired flag. Both must be
  // clean, and — the real assertion — IDENTICAL: the tenth copy is the same document as the first.
  const first = sheet({});
  const tenth = sheet({ reprint: true });
  !/reprint|duplicate/i.test(first)
    ? ok("a bill carries no reprint / duplicate wording")
    : bad("a bill says it is a reprint", 'owner 2026-08-19 removed this — see the REJECTED note in public/panels/billdoc.js');
  first === tenth
    ? ok("a reprinted bill is byte-for-byte the ORIGINAL bill")
    : bad("passing reprint:true still changes the bill sheet", "billdoc.js must ignore the flag completely, not merely stop drawing a band");
  // The band markup itself must be gone from the source, not just unreached — a commented-out
  // band is the thing someone uncomments.
  !/vband[^\n]*Reprint|Reprint[^\n]*vband/i.test(BILLDOC_SRC)
    ? ok("billdoc.js has no Reprint band markup left to switch back on")
    : bad("the Reprint band markup is still in billdoc.js", "delete it — a dormant band is re-enabled by the next person who reads it");
  // And it must not have moved into a panel instead (the exact dodge verify-print-format guards
  // for the KOT banner). Comments are stripped first — these files EXPLAIN the removed band at
  // length, on purpose, and a guard that trips on its own explanation teaches people to delete it.
  [["public/panels/editor/app.js", EDITOR], ["public/panels/tablet/app.js", TABLET]].forEach(([name, src]) => {
    /Reprint\s*·\s*Duplicate/i.test(noComments(src))
      ? bad(`${name} draws its own duplicate wording`, "the document decides what a bill looks like, and it decided no")
      : ok(`${name} draws no duplicate wording of its own`);
  });
}

say("\n2. THE KITCHEN TICKET STILL DOES — that banner is the owner's, and he kept it");
{
  const dup = BILLDOC.kotDocHtml({ rname: "R", kot: 12, tableLabel: "T4", lines: [], reprint: true });
  const fresh = BILLDOC.kotDocHtml({ rname: "R", kot: 12, tableLabel: "T4", lines: [] });
  /<div class="rp">[^<]*Reprint[^<]*Duplicate[^<]*<\/div>/i.test(dup)
    ? ok("a reprinted kitchen ticket still carries the *** Reprint · Duplicate *** banner")
    : bad("the kitchen ticket's duplicate banner is gone", 'owner 2026-08-19: "bill only, keep kot banner" — a cook cooking a duplicate order twice is a real fault');
  !/class="rp"/.test(fresh)
    ? ok("a fresh kitchen ticket is clean")
    : bad("a FIRST kitchen ticket prints the DUPLICATE banner", "a fresh ticket marked duplicate is a lie the kitchen acts on");
}

say("\n3. NOTHING ASKS, NOTHING IS RECORDED — but a REOPEN still is");
{
  // 3a. The re-issue "why are you re-issuing it?" prompt is gone from the print path. It asked the
  // same question the reopen picker had already REQUIRED one step earlier, which is what made
  // pressing Print feel like reopening the bill.
  !/why are you re-?issuing/i.test(EDITOR)
    ? ok("Print never asks why the invoice is being issued again")
    : bad("the re-issue reason prompt is back on the print path", 'owner 2026-08-19: "reprinting should also not ask any question"');
  // 3b. No print path may open a confirm/prompt of any kind. Checked on the two functions that put
  // paper out, by reading their bodies rather than the whole file.
  const fnBody = (src, start) => {
    const i = src.indexOf(start);
    if (i < 0) return null;
    let depth = 0, j = src.indexOf("{", i);
    for (let k = j; k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}" && --depth === 0) return src.slice(i, k + 1);
    }
    return null;
  };
  [["manager panel printBill()", fnBody(EDITOR, "function printBill(")],
   ["waiter tablet printTableBill()", fnBody(TABLET, "function printTableBill(")]].forEach(([what, body]) => {
    if (!body) { bad(`${what} could not be found`, "the guard is reading the wrong function name — fix the guard, don't delete it"); return; }
    /confirmDialog|promptDialog|askReopenReason|window\.confirm|reasonPrompt/.test(body)
      ? bad(`${what} asks a question before printing`, "printing paper is not a decision — it must go straight to the printer")
      : ok(`${what} prints without asking anything`);
  });
  // 3c. There is no "this bill was printed" stamp at all any more (R62, 2026-10-10) — so there is
  // nothing that could start filling the Audit on a reprint. Both routes are checked.
  [["manager route", ROUTE], ["waiter route", TROUTE]].forEach(([what, src]) => {
    !/c === "bill-printed"/.test(src) && !/update\(\{ bill_printed_at/.test(src)
      ? ok(`${what}: no door stamps a bill as printed`)
      : bad(`${what}: a bill-printed stamp is back`, "R62 — the guest bill keeps no reprint marking, and nothing records a reprint");
  });
  // 3d. …and no audit vocabulary was invented for it anywhere in the product.
  const AUDIT_WORDS = /"?bill_reprint|bill_printed"|"?invoice_reprint|reprinted the bill/i;
  [["lib/logTrail.ts", read("lib/logTrail.ts")],
   ["public/panels/auditsort.js", read("public/panels/auditsort.js")],
   ["components/admin/shared.tsx", read("components/admin/shared.tsx")]].forEach(([name, src]) => {
    !AUDIT_WORDS.test(src)
      ? ok(`${name} has no audit wording for a reprinted bill`)
      : bad(`${name} names a bill-reprint event`, "a reprint has no audit row, so it needs no label");
  });
  // 3e. THE OTHER HALF OF THE RULE. A reopen is a money event and stays fully recorded — reason
  // required, audited, and the new number logged. "Stop auditing reprints" must never drift into
  // "stop auditing reopens".
  /A reason is required to void \/ reopen an invoice/.test(ROUTE)
    ? ok("reopening a bill still REQUIRES a reason, server-side")
    : bad("the reopen reason is no longer required", "reopening a bill is a money event — it is the one that must be recorded");
  /kind: "invoice_voided"/.test(ROUTE)
    ? ok("reopening a bill is still written to the Audit")
    : bad("reopening a bill no longer reaches the Audit", 'owner 2026-08-19: "reopen will be noted in the audit also"');
  /"invoice_generate"/.test(ROUTE)
    ? ok("issuing / re-issuing an invoice number is still logged")
    : bad("the invoice number is no longer logged", "a new tax-invoice number is always an event, reprint or not");
  /kind: "bill_changed_after_reopen"/.test(ROUTE)
    ? ok("what the bill BECAME after a reopen is still recorded")
    : bad("the before → after record after a reopen is gone", "owner 2026-08-05 asked for both sides of a reopen");
}

say("\n4. THE BILL'S BUTTON ALWAYS SAYS \"PRINT\" — no reprint marking on a guest bill (owner, 2026-10-10, R62)");
{
  [["manager panel", EDITOR], ["waiter tablet", TABLET]].forEach(([what, src]) => {
    const i = src.indexOf("function billPrintLabel(");
    const body = i < 0 ? "" : src.slice(i, src.indexOf("\n}", i) + 2);
    body && !/Reprint/.test(body)
      ? ok(`${what}: billPrintLabel always says Print`)
      : bad(`${what}: the bill's label can say Reprint again`, "R62 — the guest bill keeps no reprint marking");
    !/billPrintedBefore|_billPrintedHere|markBillPrintedLocally|\/bill-printed|bill_printed_at/.test(src.replace(/\/\/[^\n]*/g, ""))
      ? ok(`${what}: nothing remembers, stamps or reads whether a bill was printed`)
      : bad(`${what}: a "was this bill printed?" reader is back`, "R62 — remove it; the word it fed is gone");
  });
  // The Bills record card's own label.
  /const printLbl = "\\u\{1F5A8\} Print";/.test(EDITOR)
    ? ok("the Bills record's print button says Print whatever the bill's history")
    : bad("the Bills record's print button can say Reprint", "R62");
  // The kitchen ticket is the ONE place the reprint word lives (part 2 checks the banner itself).
}

if (fails) console.log(`\n${fails} FAILED — a reprint of a BILL is not an event (owner, 2026-08-19).`);
else say("\nAll checks passed — a bill reprints silently and its button always says Print, the kitchen ticket still says DUPLICATE, and a reopen is still recorded.");
// A hook refusal is exit 2 (the harness shows it to whoever made the edit); a normal run is 1.
process.exit(fails ? (HOOK ? 2 : 1) : 0);
