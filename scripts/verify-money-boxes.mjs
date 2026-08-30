// verify-money-boxes.mjs — A MONEY BOX MUST ACCEPT THE NUMBER THE SCREEN PUT IN IT.
//
//   node scripts/verify-money-boxes.mjs
//
// THE RULE (owner, 2026-08-29, on the manager panel's split-amount box):
//
//   "Every split amount is money with paise, and THIS SCREEN FILLS THEM IN ITSELF — an even split
//    of ₹459.90 three ways writes 153.29 / 153.29 / 153.32 into these boxes. The box was refusing
//    the numbers the app had just put in it, and a waiter correcting one by hand was forced to
//    round to whole rupees."
//
// `<input type="number" step="1">` declares that a box holds whole numbers only. Three things then
// happen to a value with paise in it: a hardware ↑/↓ snaps 12.5 to 13, the browser marks the field
// invalid, and a person correcting a figure by hand is pushed to whole rupees on a bill that does
// not have whole rupees. None of that is visible on a screenshot, which is why it survived in six
// boxes for months after the rule was written.
//
// WHERE IT BIT, TWICE:
//   · the waiter tablet's discount sheet — three boxes, found 2026-08-30 (T7 item 18). paint()
//     writes a percent to one decimal (₹300 off ₹2,400 is 12.5) and an amount with round2().
//   · the manager panel's discount sheet AND its tip row — three more each, the same day. Its
//     paintTip() writes a percentage to one decimal and an amount with r2().
//
// This guard is deliberately CROSS-PANEL: the rule is about money, not about one panel, and the
// tablet's copy of it was fixed a day before the manager's identical copy was even looked at.
// Adding a money box that the screen fills in? Add it to BOXES below.
//
// Reads repo files only — no database, no server, no login, safe in parallel.
import fs from "node:fs";
import path from "node:path";
import { repoRootFrom } from "./sweep/repoRoot.mjs";

const ROOT = repoRootFrom(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// panel → the boxes on it that the panel itself writes a fractional figure into.
// `why` is what the code does, so a failure explains itself without opening the file.
const BOXES = [
  ["public/panels/tablet/app.js", [
    ["disc-pct-input", "the discount sheet's percent box — paint() writes pctVal, one decimal"],
    ["disc-amt-input", "the discount sheet's amount box — paint() writes round2(discAmount)"],
    ["disc-pay-input", "the discount sheet's “They pay” box — a bill with paise is paid to the paise"],
    ["sb-amt", "the split screen's per-part amount — an even split writes 153.29 / 153.32"],
    ["pay-tip-pct", "the payment sheet's tip percent — paintTip() writes one decimal"],
    ["pay-tip-amt", "the payment sheet's tip amount — paintTip() writes r2t(tip)"],
    ["pay-tip-paid", "the payment sheet's “they paid” total — handed over to the paise"],
  ]],
  ["public/panels/editor/app.js", [
    ["discPctInput", "the discount modal's percent box — paint() writes one decimal"],
    ["discAmtInput", "the discount modal's amount box — paint() writes r2()"],
    ["discPayInput", "the discount modal's “They pay” box"],
    ["payTipPct", "the payment sheet's tip percent — paintTip() writes one decimal"],
    ["payTipInput", "the payment sheet's tip amount — paintTip() writes r2(tip)"],
    ["payPaidInput", "the payment sheet's “they paid” total — a bill with paise is handed over to the paise"],
    ["psr-amt", "the split screen's per-part amount (the box the owner ruled on, 2026-08-29)"],
    ["bqNewPrice", "a new banquet package's price per plate — ₹249.50 is an ordinary per-plate price"],
  ]],
];

const checks = [];
const fails = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); if (!ok) fails.push(`${name}\n    ${detail}`); };

for (const [file, boxes] of BOXES) {
  let src = "";
  try { src = read(file); } catch { check(`${file} is present`, false, `${file} could not be read.`); continue; }
  for (const [id, why] of boxes) {
    // EVERY tag carrying this name, not the first one found. A CLASS can be on two screens at
    // once: the split screen grew its own tip row on 2026-08-30, with the same three class names
    // as the payment sheet's, and at step="1" — hours after the payment sheet's copy was fixed.
    // Checking only the first match would have passed that file with the fault in it.
    const tags = [...src.matchAll(new RegExp(`<input[^>]*\\b(?:id|class)="[^"]*\\b${id}\\b[^"]*"[^>]*>`, "g"))].map((m) => m[0]);
    const panel = path.basename(path.dirname(file));
    check(
      `${panel}: ${id} exists`,
      tags.length > 0,
      `${file}: no <input> carries ${id}. If the box was renamed, rename it here too; if the\n    ` +
      `screen was deleted, delete its line from BOXES with the reason.`,
    );
    if (!tags.length) continue;
    const steps = tags.map((t) => (t.match(/step="([^"]*)"/) || [])[1]);
    const bad = steps.filter((v) => v !== "0.01").length;
    check(
      `${panel}: ${id} steps in paise${tags.length > 1 ? ` (all ${tags.length} of them)` : ""}`,
      bad === 0,
      `${file}: ${bad} of ${tags.length} box(es) named ${id} declare step="${steps.find((v) => v !== "0.01") ?? "(none)"}" — ${why}.\n    ` +
      `A step of 1 makes the box refuse its own contents: ↑/↓ snaps 12.5 to 13 and a hand-typed\n    ` +
      `153.29 is marked invalid. Use step="0.01" on EVERY one. (owner, 2026-08-29.)`,
    );
    check(
      `${panel}: ${id} still asks for the number keypad`,
      tags.every((t) => /inputmode="decimal"/.test(t) && /type="number"/.test(t)),
      `${file}: ${id} lost type="number" / inputmode="decimal" — a person on a tablet gets the\n    ` +
      `letter keyboard for a money field.`,
    );
  }
}

// And nothing NEW may quietly arrive at step="1" on a box whose class says it is money.
for (const [file] of BOXES) {
  let src = "";
  try { src = read(file); } catch { continue; }
  const moneyish = [...src.matchAll(/<input[^>]*>/g)].map((m) => m[0])
    .filter((t) => /type="number"/.test(t))
    .filter((t) => /amt|amount|price|pay|tip|disc|money|₹/i.test(t))
    .filter((t) => /step="1"/.test(t));
  check(
    `${path.basename(path.dirname(file))}: no money-shaped box has quietly arrived at step="1"`,
    moneyish.length === 0,
    `${file}: ${moneyish.length} number box(es) that look like money still declare step="1":\n    ` +
    moneyish.slice(0, 3).map((t) => t.slice(0, 120)).join("\n    ") + `\n    ` +
    `Either give it step="0.01" and a line in BOXES, or — if it genuinely cannot hold paise —\n    ` +
    `say so in a comment on the tag itself, so the next reader does not have to guess.`,
  );
}

for (const c of checks) console.log(`${c.ok ? "  ok  " : " FAIL "} ${c.name}`);
if (fails.length) {
  console.error(`\n${fails.length} of ${checks.length} money-box checks FAILED:\n\n  - ${fails.join("\n\n  - ")}\n`);
  console.error("Background: the header of scripts/verify-money-boxes.mjs.");
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed — every money box on both panels accepts the number its own screen writes into it.`);
