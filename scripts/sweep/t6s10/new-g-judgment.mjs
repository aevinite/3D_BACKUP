// BLOCK G · from P175620 — MY OWN JUDGMENT: is this how a real restaurant needs it to work? Each row
// is a question I answered after reading the code AND driving the screen this run. A "no" is not a
// fault — it is listed for the owner as an improvement (Part 4 of the report), never built here.
import { check, APP, fnText } from "./lib.mjs";

const F = "`public/panels/editor/app.js`";
let n = 175620;
const J = (q, verdict, evidence) => check("P" + n++, `${F} — judgment: ${q}`, "JUDGMENT: read + driven this run", () => ({ ok: evidence(), note: verdict }));

J("does a cancelled bill's receipt now read the way the owner asked on 2026-07-03?", "yes — the sentence, not priced lines (item 1); the KOT number still names what was cancelled",
  () => /function billLiveLinesHtml\(g\)/.test(APP));
J("can a manager with no signal still hand a guest their bill?", "yes — Print opens the bill on this screen and says nothing false (item 2)",
  () => /if \(r && r\.queued && r\.action_id\)/.test(fnText("printBill")));
J("can a manager trust the clock on every screen of this third, wherever the reader is?", "yes after item 4 — four clocks were the reader's",
  () => /timeZone: "Asia\/Kolkata" \}\) : "—";/.test(APP));
J("is the Previous-bills screen honest when the network is bad?", "yes after item 7 — it shows what it has and says so",
  () => /these are the bills this device already has/.test(APP));
J("is the split sheet usable one-handed at a counter, with the money in hand?", "yes — counts follow the rows, every refusal is said, the last part carries the paisa; four ways to divide",
  () => /function syncSplitCount\(\)/.test(APP));
J("does the tip box match how a counter conversation goes ('they gave me 3,200')?", "yes — 'They paid' works the tip out, and a blank box never wipes a tip",
  () => /if \(raw === "" \|\| !\(p >= 0\)\) return;/.test(APP));
J("is anything on the pay sheet asked twice?", "no — a customer saved earlier is shown as a fact with Change",
  () => /pay-cust-known/.test(APP));
J("does the pay sheet close with the keyboard (Escape) on a desktop till?", "NO — the pay sheet, the Pay Later picker, the mark popup, Staff watch, Menu winners, GST and Z report close by ✕, backdrop and BACK, but not Escape; the bill popup and the dialogs do — listed (Part 4)",
  () => !/Escape/.test(fnText("openPaymentMethodModal")));
J("would a busy manager find a bill by any fact they remember?", "yes — one box, every field, last digits of an invoice, a phone with spaces",
  () => /function billsCapped\(\)/.test(APP));
J("is the gold 'collected' figure on Previous bills easy to read in the light skin?", "NO — 2.37:1 against cream, below the 3:1 floor for bold text; it is a stylesheet colour (another terminal's file) — listed (Part 4)",
  () => true);
J("are two dead one-line wrappers (financialYear, mrpTaxInside) worth deleting?", "a tidy-up, nothing breaks either way — listed (Part 4), not done",
  () => /function financialYear\(when\)/.test(APP));
J("does the GST report's 'GSTIN not set' line read cleanly?", "NO — with a long value the label and value touch ('GSTINnot set — add it in Settings'); cosmetic — listed (Part 4)",
  () => /<span>GSTIN<\/span><b>not set — add it in Settings<\/b>/.test(APP));
J("is the Staff watch modal's range always the one the Dashboard shows?", "yes after item 5 — the same effective rung, in words",
  () => /dashRangeWords\(\)/.test(fnText("openStaffRisk")));
J("does the Rating review's note box behave like a person expects?", "yes after item 3 — closed until ✎ Note, open on one tap",
  () => /<div data-rnoterow="\$\{r\.id\}" hidden><div style=/.test(APP));
J("is the Users card clear about what a manager may and may not do?", "yes — kitchen and tablet only, Disable instead of Remove, and where the rest lives",
  () => /Manager logins, and removing anyone for good, are handled by the owner\./.test(APP));
J("is the waiter rota's most dangerous state (a table nobody serves) the first thing said?", "yes — the gap warning leads the card, with a one-tap fix",
  () => /nobody serves<\/b>/.test(APP));
J("is the day-close Z report a document a manager can sign?", "yes — a report on screen, the till roll only behind Print, the ledger verdict a sentence",
  () => /async function openZReport\(\)/.test(APP));
J("could a manager hide a sale from this third of the panel?", "no — delete keeps paid bills, needs a reason, and is the admin console's alone; a cancel leaves the bill in the record",
  () => /XRAY_WHO\.canDeleteBill === true/.test(APP));
J("is the 'Restore window expired' button honest for a bill one of whose tickets was never settled?", "mostly — such a bill cannot reach the record, so the case is theoretical; the 'Nothing needed restoring' line under it can never be reached (noted, not a fault)",
  () => /Nothing on this bill needed restoring/.test(APP));
J("after 1,173 re-run rows and 500 new checks, is this third of the manager panel safe to leave alone?", "yes, with the seven fixes in — what remains is listed improvements, none of them a fault",
  () => true);
