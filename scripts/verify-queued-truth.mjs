// verify-queued-truth.mjs — a write that is only SAVED ON THE DEVICE must never be reported as done.
//
// THE BUG THIS EXISTS FOR (T5 sweep #7, 2026-08-22), found by reading the manager panel and
// proved against the shipped code:
//
//   api() in a staff panel hands every non-GET to the offline outbox, and the outbox resolves
//   `{ ok: true, queued: true }` instead of throwing. So a handler that only has a try/catch sees
//   a SUCCESS. Four sites in public/panels/editor/app.js believed it:
//
//     · generateInvoice()   toasted "Invoice generated" and returned TRUE, so printIssuingInvoice()
//                           printed a bill from the saved copy — where invoice_no is still null.
//                           Its own comment says it returns true "only when a number was actually
//                           issued", and that a printed bill with no number is the thing
//                           invoice-first exists to stop.
//     · the banquet bill    toasted "Bill undefined created — ₹0." and then PRINTED a banquet
//                           sheet numbered `undefined` with ₹0 in every column.
//     · pay-split           "Paid in 3 parts 💳 — undefined orders settled".
//     · on-the-house        "On the house 🏠 — undefined orders settled at no charge".
//     · credit note         "Credit note # issued" — a numbered document with no number.
//     · audit classify      "Recorded as a loss of ₹441 — the ingredients stay used", over a row
//                           that still read "Not answered yet".
//
// WHAT IT CHECKS. Two questions, no server, no browser, no database.
//
//   A. THE NAMED SITES. Each of the six writes above must still consult the queue before it
//      speaks. Named individually and by path, because these are the ones that announce money or
//      print a numbered document — the ones where a false success is not a wording slip.
//
//   B. NOTHING PRINTS FROM A QUEUED REPLY. In the two places that call a print builder with
//      fields taken straight off an api() reply, the queue check must come FIRST — between the
//      await and the print. Checked by position in the source, not by presence, because a check
//      written after the print protects nothing.
//
// It reads three panel files and is deliberately narrow: it does not demand a queue check at all
// ~60 write sites in the panel. Most of those are covered by the offline bar and the queue drawer,
// and a guard that fails on all of them would be turned off within a week. These six are the ones
// that print paper or state a figure.
//
// Usage: node scripts/verify-queued-truth.mjs      (no server, no browser, no database)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m, extra) => { pass++; console.log(`  ✅ ${m}${extra ? ` — ${extra}` : ""}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };

const PANEL = "public/panels/editor/app.js";
const src = existsSync(join(ROOT, PANEL)) ? readFileSync(join(ROOT, PANEL), "utf8") : null;
if (!src) { console.log(`❌ ${PANEL} is not there — nothing could be checked.`); process.exit(1); }

console.log("→ a queued write is never reported as done · " + PANEL + "\n");

// The panel's own helper. If it is renamed the checks below would silently stop matching, so the
// guard asserts the name it looks for actually exists.
console.log("A. the helper");
if (/const wasQueued = \(r\) => !!\(r && r\.queued === true\);/.test(src)) ok("wasQueued() is the one way the panel asks");
else bad("wasQueued() is gone or renamed", "every check below looks for it by name — update them together");

/**
 * Take the ~30 lines that follow a write, so "did this site ask?" is answered on the site's own
 * code rather than on the whole file. `from` is the literal text of the api() call.
 */
const after = (from, lines = 30) => {
  const i = src.indexOf(from);
  if (i < 0) return null;
  return src.slice(i).split("\n").slice(0, lines).join("\n");
};

console.log("\nB. the six writes that announce money or print a numbered document");
const SITES = [
  ["the tax invoice", 'await api("POST", `/sessions/${sid}/invoice`, body)',
    "manager panel → Tables → a table → Print bill"],
  ["the banquet bill", 'await api("POST", "/banquet/bill", { table: t, lines: payload, meta })',
    "manager panel → Banquet → Issue bill"],
  ["the split payment", 'await api("POST", `/tables/${t}/pay-split`, { splits })',
    "manager panel → Tables → Mark paid → Split payment"],
  ["on the house", 'await api("POST", `/tables/${t}/on-the-house`, {})',
    "manager panel → Tables → KOT ▾ → On the house"],
  ["the credit note", 'await api("POST", `/sessions/${sid}/credit-note`, { amount, reason })',
    "manager panel → Bills → a settled bill → Credit note"],
  ["the food-made answer", 'await api("POST", "/audit/classify", { order_id: orderId, made })',
    "manager panel → Audit & logs → Removals → Yes, cooked / No, never started"],
];
for (const [name, call, where] of SITES) {
  const win = after(call);
  if (win == null) bad(`${name}: its write is no longer written this way`, `looked for ${call.slice(0, 60)}… · if it moved, re-point this line`);
  else if (/wasQueued\(/.test(win)) ok(`${name} asks the queue before it speaks`, where);
  else bad(`${name} reports success without asking the queue`, `${where} — with no signal it will say a thing that has not happened`);
}

console.log("\nC. nothing is printed from a reply that is still on this device");
// The check has to be FIRST. A queue check written below the print protects nothing, so this
// compares positions rather than merely looking for the word.
// ⚠️ POSITIONS ARE COMPARED ON CODE, NOT ON PROSE. The first cut of this check read the raw file
// and found the word "printIssuingInvoice" inside the very comment that explains the fix — before
// the check it was looking for — so it reported the shipped, correct code as broken. This file is
// full of long comments naming the functions it talks about; blanking them out first is what makes
// a position mean something. (Strings are left alone: the printer is called, never quoted.)
const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
                    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const PRINTS = [
  ["the tax invoice", 'await api("POST", `/sessions/${sid}/invoice`, body)', "printBill("],
  ["the banquet sheet", 'await api("POST", "/banquet/bill", { table: t, lines: payload, meta })', "printBanquetBill("],
];
for (const [name, call, printer] of PRINTS) {
  const i = codeOnly.indexOf(call);
  if (i < 0) { bad(`${name}: its write is no longer written this way`, "re-point this line"); continue; }
  const win = codeOnly.slice(i, i + 4000);
  const q = win.indexOf("wasQueued(");
  const p = win.indexOf(printer);
  if (q < 0) bad(`${name}: no queue check between the write and the print`);
  else if (p >= 0 && p < q) bad(`${name}: the print happens BEFORE the queue is asked`, "a check written after the print protects nothing");
  else ok(`${name}: the queue is asked before anything is printed`);
}
// generateInvoice must not hand back "issued" for a queued write — printIssuingInvoice trusts it.
{
  const win = after('await api("POST", `/sessions/${sid}/invoice`, body)', 22);
  if (win && /if \(wasQueued\(r\)\)[\s\S]{0,400}?return false;/.test(win)) ok("generateInvoice() returns false for a queued write", "so printIssuingInvoice() cannot print after it");
  else bad("generateInvoice() can still return true for a queued write", "printIssuingInvoice() prints on a true, and the bill would carry no invoice number");
}

console.log("\nD. no success message states a server figure it cannot have");
// The narrow version of the rule: a toast that interpolates a field off the reply, inside a window
// that never asks the queue. Only the six sites above are in scope; this is the net that catches a
// SEVENTH being added the same way.
{
  const lines = src.split("\n");
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    // A PROPERTY OFF THE REPLY, not a bare name. `toast(`Restored ${r}`)` a few hundred lines up
    // counts a local loop variable, not a server field, and flagging it taught nothing.
    const m = lines[i].match(/toast\(\s*`[^`]*\$\{[^}]*\b(r|r2|cn|res|j)\.[a-z_]/i);
    if (!m) continue;
    const win = lines.slice(Math.max(0, i - 14), i + 2).join("\n");
    if (!/wasQueued\(|\.queued\b/.test(win)) offenders.push(`${PANEL}:${i + 1}`);
  }
  if (!offenders.length) ok("every ok-toast that quotes the server's reply sits behind a queue check");
  else bad(`${offenders.length} ok-toast(s) quote the server's reply with no queue check`, offenders.join(", ") + " — offline these print the word `undefined`");
}

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
