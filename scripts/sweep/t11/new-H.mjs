// ⬛ NEW — T11 of sweep #8 · BANK H · P65535–P65700 · ROUND 3
// THE KITCHEN TICKET, RENDERED, ACROSS EVERY SHAPE A REAL ORDER COMES IN.
//
// WHY THE TICKET GETS ITS OWN BANK. It is the one document in this territory that NOBODY CHECKS
// AFTER IT PRINTS. A guest reads their bill and complains; a banquet sheet is read twice before
// anyone signs it. A kitchen slip is glanced at by a cook in a rush, cooked from, and thrown away
// — so a slip that is wrong is not caught, it is COOKED. That is why the two faults an earlier
// sweep found here ("KOT #undefined" and "[object Object]×" where a quantity should be) mattered
// more than their size suggests, and it is why this bank exists.
//
// Twenty-three order shapes × seven promises, plus five about the ticket as a whole. Same design
// as bank G and for the same reason: a failure names the exact ticket AND the exact promise.
import { BILLDOC as B, row, skipRow } from "./lib.mjs";
import { BASE, canDrive, renderDoc, seenText, inkWidth, bodyWidth } from "./browser.mjs";

const KOT_PX = 280;      // the ticket's own column — narrower than the bill's 66mm ink
const L = (title, qty, extra = {}) => ({ title, qty, ...extra });
const T = (o) => ({ kot: 7, tableLabel: "Table 4", rname: "Kitchen", when: "2026-09-06 13:40", ...o });

const SHAPES = [
  ["one line", T({ lines: [L("Dal Makhani", 1)] })],
  ["ten lines", T({ lines: Array.from({ length: 10 }, (_, i) => L(`Dish ${i + 1}`, 1 + (i % 4))) })],
  ["a hundred lines — a banquet order in one go", T({ lines: Array.from({ length: 100 }, (_, i) => L(`Dish number ${i + 1}`, 2)) })],
  ["a quantity of twelve", T({ lines: [L("Roti", 12)] })],
  ["a half plate", T({ lines: [L("Paneer Tikka", 0.5)] })],
  ["a quantity that is not a number at all", T({ lines: [L("Dal", { n: 2 })] })],
  ["a line with a cook's note", T({ lines: [L("Dal", 1, { note: "no cream, jain" })] })],
  ["a line with three options", T({ lines: [L("Pizza", 1, { options: [{ label: "Extra cheese" }, { label: "Olives" }, { label: "Thin crust" }] })] })],
  // `removed` is not "the waiter deleted this line" — it is the list of ingredients taken OUT of
  // the dish, and it prints as "— no onion". Reading the field name as a boolean is what an
  // earlier version of this shape did, and it invented a fault out of its own guess.
  ["a dish with two ingredients taken out", T({ lines: [L("Dal", 1), L("Pizza", 2, { removed: ["onion", "garlic"] })] })],
  ["a note shared by the whole ticket", T({ lines: [L("Dal", 1, { note: "less spicy" }), L("Naan", 2, { note: "less spicy" })] })],
  ["an allergy warning", T({ lines: [L("Pasta", 1)], allergies: ["peanut", "shellfish"] })],
  ["a dish name in Hindi", T({ lines: [L("दाल मखनी", 2), L("तंदूरी रोटी", 4)] })],
  ["a dish name nobody shortened", T({ lines: [L("Slow-cooked black lentils finished with cream and butter, served with a side of pickled onion", 1)] })],
  ["a null in the line list", T({ lines: [L("Dal", 1), null, L("Naan", 2)] })],
  ["no lines at all", T({ lines: [] })],
  ["a reprint", T({ lines: [L("Dal", 1)], reprint: true })],
  ["no KOT number", T({ lines: [L("Dal", 1)], kot: null })],
  ["a KOT number that is not a number", T({ lines: [L("Dal", 1)], kot: {} })],
  ["a parcel — no table", T({ lines: [L("Biryani", 1)], tableLabel: "" })],
  ["a table with a name, not a number", T({ lines: [L("Dal", 1)], tableLabel: "Terrace 2" })],
  ["an unreadable time", T({ lines: [L("Dal", 1)], when: "not-a-date" })],
  ["a restaurant name in the header", T({ lines: [L("Dal", 1)], rname: "Kadai & Co.", head: "HOT KITCHEN" })],
  ["a ticket handed ready-made markup", T({ lines: [L("Dal", 1)], extraHtml: '<div class="on">&raquo; table wants it together</div>' })],
];

const cache = new Map();
async function shot(i) {
  if (cache.has(i)) return cache.get(i);
  const data = SHAPES[i][1];
  const html = B.kotDocHtml(data);
  const r = await renderDoc("kot", data, { media: "print", settle: 200 });
  const out = { data, html, text: (await seenText(r.page)).join("\n"),
    ink: await inkWidth(r.page), body: await bodyWidth(r.page), errs: r.errs };
  await r.close();
  cache.set(i, out);
  return out;
}

const PROMISES = [
  ["it draws at all — a cook gets paper, not a blank window", (s) => s.text.replace(/\s+/g, "").length > 8 || `only ${s.text.replace(/\s+/g, "").length} characters of ink`],
  ["it throws nothing while drawing", (s) => s.errs.length === 0 || s.errs[0]],
  ["it never prints a value that failed to resolve", (s) => {
    const bad = ["undefined", "NaN", "[object Object]", "Invalid Date"].filter((w) => s.text.includes(w));
    return bad.length === 0 || `a cook would read: ${bad.join(", ")}`;
  }],
  // inkWidth is the WIDEST INK measured from the paper's own left edge; bodyWidth is the COLUMN.
  // The first version of these two had them the other way round and read a perfectly correct
  // 261px-of-ink-in-a-280px-column as "the column is 261px".
  ["its column is the ticket's own 280px", (s) => Math.abs(s.body - KOT_PX) <= 2 || `${s.body}px, not ${KOT_PX}px`],
  ["nothing on it runs wider than that column", (s) => s.ink <= KOT_PX + 2 || `the widest ink on it reaches ${s.ink}px`],
  ["it declares no paper size, so CUPS cannot rotate it", (s) => !/@page[^}]*\bsize\s*:/.test(s.html) || "it declares an @page size"],
  ["every quantity on it is a figure a cook can act on", (s) => {
    // The × is INSIDE the quantity span ("2×"), so it has to come off before the figure is judged.
    const qtys = [...s.html.matchAll(/class="q"[^>]*>([^<]*)</g)]
      .map((m) => m[1].trim().replace(/×$/, "").trim());
    const bad = qtys.filter((q) => q && !/^\d+(?:\.\d+)?$/.test(q));
    return bad.length === 0 || `a quantity reads "${bad[0]}"`;
  }],
];

let id = 65535;
for (let i = 0; i < SHAPES.length; i++)
  for (const [promise, judge] of PROMISES) {
    const tag = `P${id++}`, what = `KOT · ${SHAPES[i][0]} — ${promise}`;
    if (!canDrive) skipRow(tag, what, `needs playwright and a server at ${BASE}`);
    else row(tag, what, async () => judge(await shot(i)));
  }

// ── AND FIVE ABOUT THE TICKET AS A WHOLE ─────────────────────────────────────────────────────
const whole = [
  ["a reprint is branded as one, and a fresh ticket is not", async () => {
    const dup = (await shot(15)).text, fresh = (await shot(0)).text;
    return (/Reprint|Duplicate/i.test(dup) && !/Reprint|Duplicate/i.test(fresh))
      || `banner on the reprint: ${/Reprint/i.test(dup)}; on a fresh ticket: ${/Reprint/i.test(fresh)}`;
  }],
  ["an empty order says so rather than printing a blank slip", async () =>
    /\(no items\)/i.test((await shot(14)).text) || "a slip with nothing on it and nothing said"],
  ["a note every line shares is printed ONCE, not on every line", async () => {
    const t = (await shot(9)).text;
    return ((t.match(/less spicy/gi) || []).length === 1) || `"less spicy" appears ${(t.match(/less spicy/gi) || []).length} times`;
  }],
  ["an ingredient taken out is named on the paper, beside its own dish", async () => {
    const s = await shot(8);
    const m = /Pizza[\s\S]{0,120}?no onion, garlic/.test(s.html.replace(/<[^>]+>/g, " "));
    return m || "the kitchen is not told which dish the onion comes out of";
  }],
  ["an allergy warning reaches the paper, and says AVOID in words", async () => {
    // WHAT THIS DOES *NOT* ASSERT, deliberately. The warning prints BELOW the food, not above it
    // — on a hundred-line banquet ticket a cook reads it last. That is a layout judgement on the
    // kitchen ticket, and R26 in docs/REJECTED-IDEAS.md is the owner telling this territory not to
    // re-report the KOT's layout as a bug on its own initiative. So it is carried to him as a
    // decision instead, and this row asserts only what is not in doubt: the warning is there.
    const s = await shot(10);
    return (/AVOID/i.test(s.text) && /peanut/i.test(s.text) && /shellfish/i.test(s.text))
      || "an allergy the guest declared does not reach the cook";
  }],
];
for (const [what, judge] of whole) {
  const tag = `P${id++}`;
  if (!canDrive) skipRow(tag, `KOT · ${what}`, `needs playwright and a server at ${BASE}`);
  else row(tag, `KOT · ${what}`, judge);
}
if (id - 1 !== 65700) throw new Error(`bank H ended at P${id - 1}, not P65700`);
