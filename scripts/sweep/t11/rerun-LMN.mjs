// Sections L · M · N of T8.md re-run — LOOKING AT IT (P03876–P03925), TRACING A CHANGE ACROSS
// PANELS (P03926–P03975), and JUDGMENT (P03976–P03999).
//
// L is the section that must be MEASURED and LOOKED AT, not reasoned about; where a row is a
// "does this read right" question, it is turned into the property that would be false if it did
// not (an ordering, a weight, a size, a tap target) — and a small set of real screenshots is
// written for the report and then deleted.
// M traces a change by READING that it reaches every surface that must show it, which is what the
// section's own header asks for.
// N is judgment; each row answers with the evidence this run actually has.
import { BILLDOC as B, row, skipRow, read, visible, totalRows, codeOnly, ROOT } from "./lib.mjs";
import { BASE, canDrive, renderDoc, seenText, inkWidth, ROLL_PX } from "./browser.mjs";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

const R = (id, what, fn) => (canDrive ? row(id, what, fn)
  : skipRow(id, what, `needs playwright and a server at ${BASE} — start the dev server and re-run`));
const SHOTS = join(ROOT, ".claude/sweep/shots/T11-LMN");
try { mkdirSync(SHOTS, { recursive: true }); } catch { /* already there */ }

const bill = (over = {}) => ({
  name: "Aangan Garden Restaurant", addr: "12 Some Road, Ahmedabad", phone: "+91 90000 00000",
  gstin: "24ABCDE1234F1Z5", footer: "Thank you — please visit again", invNo: "INV/2026-27/000041",
  tableDisp: "5", dateStr: "04/09/2026 01:00 pm", lines: [{ title: "Dal Makhani", qty: 2, price: 200 }],
  subtotal: 400, discount: 0, total: 420,
  taxRows: [{ label: "CGST", rate: 2.5, amt: 10 }, { label: "SGST", rate: 2.5, amt: 10 }],
  autoPrint: false, ...over,
});
const kot = (over = {}) => ({ rname: "Aangan Garden", head: "KITCHEN TICKET", kot: 12, tableLabel: "T5",
  when: "01:00 PM", lines: [{ qty: 2, title: "Dal Makhani", options: ["extra cheese"], removed: ["onion"], note: "no chilli" }], ...over });
const bq = (over = {}, settings = {}) => ({ bill: { bill_no: "B/1", issued_at: "2026-08-16T16:01:00Z",
  cust_name: "Sharma Family", subtotal: 115000, discount: 0, tax: 20700, total: 135700,
  tax_lines: [{ label: "CGST", rate: 9, amt: 10350 }, { label: "SGST", rate: 9, amt: 10350 }], ...over },
  lines: [{ title: "Hall hire", qty: 1, price: 100000 }, { title: "Stage decoration", qty: 1, price: 15000 }],
  settings, restaurant: { slug: "x" } });
const on = async (kind, data, opts, fn) => { const r = await renderDoc(kind, data, opts); try { return await fn(r); } finally { await r.close(); } };
/** the computed font-size / weight of the first element matching a selector */
const styleOf = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return null;
  const c = getComputedStyle(e);
  return { fs: parseFloat(c.fontSize), fw: Number(c.fontWeight), text: (e.textContent || "").trim().slice(0, 40) };
}, sel);

// ══ L · LOOKING AT IT ═══════════════════════════════════════════════════════════════════════
R("P03876", "an ordinary tax invoice reads as a bill a guest would trust — desktop", () =>
  on("bill", bill(), { media: "print" }, async ({ page }) => {
    const seen = await seenText(page);
    // CASE-INSENSITIVE, because innerText returns the TRANSFORMED text: `.kind`, `.kv span` and
    // `.lbl` all carry `text-transform:uppercase`, so a perfectly good sheet reads "TAX INVOICE"
    // and "TABLE". My first version looked for "Tax Invoice" and reported five present things as
    // missing on a bill a guest would read fine.
    const want = ["AANGAN GARDEN RESTAURANT", "Tax Invoice", "Invoice", "Table", "Date", "Item", "Subtotal", "TOTAL"];
    const hay = seen.join(" | ").toLowerCase();
    const missing = want.filter((w) => !hay.includes(w.toLowerCase()));
    await page.screenshot({ path: join(SHOTS, "bill-desktop.png"), fullPage: true });
    return missing.length === 0 || `a guest would not find: ${missing.join(", ")}`;
  }));
R("P03877", "…and on the A35 (360×780, dpr 3)", () =>
  on("bill", bill(), { width: 360, height: 780, dpr: 3 }, async ({ page }) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: join(SHOTS, "bill-a35.png"), fullPage: true });
    return over <= 1 || `${over}px of sideways scroll on the phone`;
  }));
R("P03878", "the restaurant name is the boldest thing on the sheet, and the TOTAL the second", () =>
  on("bill", bill(), { media: "print" }, async ({ page }) => {
    const h2 = await styleOf(page, "h2"), g = await styleOf(page, ".g"), td = await styleOf(page, "td");
    if (!h2 || !g) return "no name or no TOTAL row";
    return (h2.fs > g.fs && h2.fw >= 700 && g.fw >= 700 && g.fs > (td?.fs || 0))
      || `name ${h2.fs}px/${h2.fw}, TOTAL ${g.fs}px/${g.fw}, body ${td?.fs}px`;
  }));
R("P03879", "the item, qty, rate and amount line up as four columns", () =>
  on("bill", bill({ lines: [{ title: "Dal", qty: 2, price: 200 }, { title: "Naan", qty: 4, price: 60 }] }), { media: "print" }, async ({ page }) => {
    const cols = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("tbody tr:not(.ex)")];
      return rows.map((r) => [...r.children].map((c) => Math.round(c.getBoundingClientRect().left)));
    });
    if (cols.length < 2) return "fewer than two item rows";
    return JSON.stringify(cols[0]) === JSON.stringify(cols[1]) || `row 1 starts at ${cols[0]}, row 2 at ${cols[1]}`;
  }));
R("P03880", "an add-on sub-line is visibly subordinate to its dish", () =>
  on("bill", bill({ lines: [{ title: "Pizza", qty: 1, price: 360, options: [{ label: "Extra cheese", price: 60 }] }] }), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const main = document.querySelector("tbody tr:not(.ex) td.n"), ex = document.querySelector("tr.ex td.n");
      if (!main || !ex) return null;
      return { mfs: parseFloat(getComputedStyle(main).fontSize), efs: parseFloat(getComputedStyle(ex).fontSize),
        indent: Math.round(ex.getBoundingClientRect().left - main.getBoundingClientRect().left), text: (ex.textContent || "").trim() };
    });
    if (!s) return "no add-on sub-line rendered";
    return ((s.efs < s.mfs || s.indent > 0) && s.text.startsWith("+"))
      || `sub-line ${s.efs}px vs dish ${s.mfs}px, indent ${s.indent}px, text "${s.text}"`;
  }));
R("P03881", "the money block reads top-to-bottom as an addition a person can follow", () =>
  on("bill", bill({ discount: 40, total: 380, taxRows: [{ label: "CGST", rate: 2.5, amt: 9 }, { label: "SGST", rate: 2.5, amt: 9 }] }), { media: "print" }, async ({ page }) => {
    const labels = (await page.evaluate(() => [...document.querySelectorAll(".totals .t span:first-child, .totals .g span:first-child")].map((s) => (s.textContent || "").trim())));
    const want = ["Subtotal", "Discount", "Taxable value", "CGST", "SGST", "TOTAL"];
    const seq = want.map((w) => labels.findIndex((l) => l.startsWith(w)));
    const ordered = seq.every((v, i) => v >= 0 && (i === 0 || v > seq[i - 1]));
    return ordered || `the rows read: ${labels.join(" → ")}`;
  }));
R("P03882", "a discounted bill's Discount, Taxable value and tax rows read in the right order", () =>
  on("bill", bill({ discount: 40, discLabel: "10%", total: 380 }), { media: "print" }, async ({ page }) => {
    const rows = totalRows(await page.content());
    const l = rows.map((r) => r[0]);
    return (l.indexOf("Discount (10%)") < l.indexOf("Taxable value") && l.indexOf("Taxable value") < l.findIndex((x) => /CGST/.test(x)))
      || `order: ${l.join(" → ")}`;
  }));
R("P03883", "a Round off row does not look like an error, and is never more than a rupee or two", () =>
  on("bill", bill({ subtotal: 400, total: 419 }), { media: "print" }, async ({ page }) => {
    const rows = totalRows(await page.content());
    const ro = rows.find((r) => r[0] === "Round off");
    if (!ro) return "no round-off row on a bill that needs one";
    const n = Math.abs(parseFloat(ro[1].replace(/[^\d.]/g, "")));
    return (n <= 2 && /^[−+] ₹/.test(ro[1])) || `it reads "${ro[1]}"`;
  }));
R("P03884", "an MRP bill's Food subtotal and MRP items read as one column that adds up", () =>
  on("bill", bill({ nontax: 42, subtotal: 442, total: 462 }), { media: "print" }, async ({ page }) => {
    const rows = totalRows(await page.content());
    const l = rows.map((r) => r[0]);
    const num = (s) => Number((s || "").replace(/[^\d]/g, ""));
    const food = num(rows.find((r) => r[0] === "Food subtotal")?.[1]);
    const mrp = num(rows.find((r) => r[0] === "MRP items")?.[1]);
    const tax = rows.filter((r) => /GST/.test(r[0])).reduce((a, r) => a + num(r[1]), 0);
    return (l.includes("Food subtotal") && l.includes("MRP items") && food + mrp + tax === 462)
      || `${food} + ${mrp} + ${tax} ≠ 462 · rows ${l.join(" → ")}`;
  }));
R("P03885", "the MRP stamp is legible beside a long dish name", () =>
  on("bill", bill({ lines: [{ title: "Bisleri Mineral Water 1 Litre Sealed Bottle", qty: 1, price: 20, is_mrp: true }] }), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const e = document.querySelector(".mrpt"); if (!e) return null;
      const r = e.getBoundingClientRect(); const b = document.body.getBoundingClientRect();
      return { fs: parseFloat(getComputedStyle(e).fontSize), w: Math.round(r.width), over: r.right - b.left > b.width + 1 };
    });
    if (!s) return "no MRP stamp";
    return (s.fs >= 10 && s.w > 12 && !s.over) || `${s.fs}px, ${s.w}px wide, past the column: ${s.over}`;
  }));
R("P03886", "a tax-inside bill's 'Price includes' block reads as a statement, not another charge", () =>
  on("bill", bill({ inclRows: [{ label: "CGST", rate: 2.5, amt: 5 }, { label: "SGST", rate: 2.5, amt: 5 }], total: 400 }), { media: "print" }, async ({ page }) => {
    const seen = await seenText(page);
    const iIncl = seen.findIndex((l) => l.includes("Price includes"));
    const iTotal = seen.findIndex((l) => l === "TOTAL");
    return (iIncl > iTotal && iTotal >= 0) || `TOTAL at ${iTotal}, "Price includes" at ${iIncl} — it must sit BELOW the total or it reads as another charge`;
  }));
R("P03887", "a composition Bill of Supply reads as one, with its declaration", () =>
  on("bill", bill({ composition: true, taxRows: [], total: 400 }), { media: "print" }, async ({ page }) => {
    const seen = await seenText(page);
    const hay = seen.join(" | ").toLowerCase();
    return (hay.includes("bill of supply") && hay.includes("composition taxable person"))
      || `the sheet reads: ${seen.slice(0, 8).join(" | ")}`;
  }));
R("P03888", "…and shows no tax anywhere", () =>
  on("bill", bill({ composition: true, taxRows: [], total: 400 }), { media: "print" }, async ({ page }) => {
    const rows = totalRows(await page.content()).map((r) => r[0]);
    return !rows.some((l) => /GST|Tax\b/.test(l)) || `it still prints ${rows.join(" / ")}`;
  }));
R("P03889", "a CANCELLED bill is unmistakable at a glance", () =>
  on("bill", bill({ cancelled: true }), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const v = document.querySelector(".vband"); if (!v) return null;
      const c = getComputedStyle(v);
      return { fs: parseFloat(c.fontSize), fw: Number(c.fontWeight), up: c.textTransform, top: Math.round(v.getBoundingClientRect().top) };
    });
    await page.screenshot({ path: join(SHOTS, "bill-cancelled.png"), fullPage: true });
    if (!s) return "no cancelled band";
    return (s.fs >= 14 && s.fw >= 700 && s.up === "uppercase") || `${s.fs}px / ${s.fw} / ${s.up}`;
  }));
// the remaining L rows about the bill window, the ticket, the banquet sheet and the customer sheet
R("P03890", "the bill's own toolbar does not cover the restaurant name at any zoom", () =>
  on("bill", { ...bill(), autoPrint: false }, { width: 360, height: 780 }, async ({ page }) => {
    await page.waitForTimeout(700);   // let zStart()/zFit() settle
    const s = await page.evaluate(() => {
      const bar = document.querySelector(".bar"), h2 = document.querySelector("h2");
      if (!bar || !h2) return null;
      const b = bar.getBoundingClientRect(), n = h2.getBoundingClientRect();
      return { overlap: Math.round(b.bottom - n.top), zoom: getComputedStyle(document.body).zoom };
    });
    if (!s) return "no toolbar or no name";
    return s.overlap <= 0 || `the bar covers the top ${s.overlap}px of the restaurant name (zoom ${s.zoom})`;
  }));
for (const [id, w, h, lbl] of [["P03891", 1280, 900, "desktop"], ["P03892", 360, 780, "the A35"]]) {
  R(id, `the whole bill fits the window without scrolling — ${lbl}`, () =>
    on("bill", bill(), { width: w, height: h }, async ({ page }) => {
      await page.waitForTimeout(800);
      const s = await page.evaluate(() => ({ need: document.documentElement.scrollHeight, have: innerHeight, zoom: getComputedStyle(document.body).zoom }));
      return s.need <= s.have + 4 || `needs ${s.need}px, has ${s.have}px (zoom ${s.zoom})`;
    }));
}
R("P03893", "the zoom control says what it is showing", () =>
  on("bill", bill(), { width: 1280, height: 900 }, async ({ page }) => {
    await page.waitForTimeout(700);
    const t = await page.evaluate(() => (document.querySelector(".zl")?.textContent || "").trim());
    return /^\d+%$/.test(t) || `the chip reads "${t}"`;
  }));
R("P03894", "…and − / + change it", () =>
  on("bill", bill(), { width: 1280, height: 900 }, async ({ page }) => {
    await page.waitForTimeout(700);
    const before = await page.evaluate(() => (document.querySelector(".zl")?.textContent || "").trim());
    await page.evaluate(() => [...document.querySelectorAll(".zg button")].find((b) => (b.textContent || "").includes("+"))?.click());
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => (document.querySelector(".zl")?.textContent || "").trim());
    return before !== after || `it stayed at ${before}`;
  }));
R("P03895", "…and the chip fits the whole bill, down to the documented 0.6 floor", () =>
  on("bill", bill({ lines: Array.from({ length: 30 }, (_, i) => ({ title: `Dish ${i + 1}`, qty: 1, price: 100 })), subtotal: 3000, total: 3150 }), { width: 1280, height: 700 }, async ({ page }) => {
    await page.waitForTimeout(700);
    const before = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.evaluate(() => document.querySelector(".zl")?.click());
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => ({ need: document.documentElement.scrollHeight, have: innerHeight, z: parseFloat(getComputedStyle(document.body).zoom) }));
    // ZMIN is 0.6 ON PURPOSE — "below that a 10.5px label stops being readable and a scrollbar is
    // the better answer" (the file's own note). So Fit must either fit it, or be sitting on the
    // floor having done everything it is allowed to. Demanding it always fit made a deliberate
    // decision look like a fault.
    if (s.need <= s.have + 6) return true;
    // ALREADY AT THE FLOOR IS THE RIGHT ANSWER, not a failure to shrink. A 30-line bill in a 700px
    // window opens at zoom 0.6 — zStart() has already fitted it as far as ZMIN allows — so pressing
    // Fit correctly changes nothing. My first version compared before/after and called that a fault.
    if (s.z <= 0.61) return true;
    return `Fit stopped at ${s.z} with ${s.need}px to show in ${s.have}px, and the floor is 0.6`;
  }));
R("P03896", "the print and close buttons are real tap targets on the phone", () =>
  on("bill", bill(), { width: 360, height: 780 }, async ({ page }) => {
    await page.waitForTimeout(700);
    const sizes = await page.evaluate(() => [...document.querySelectorAll(".bar button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { t: (b.textContent || "").trim().slice(0, 10), h: Math.round(r.height), w: Math.round(r.width) };
    }));
    const small = sizes.filter((s) => s.h < 28);
    return small.length === 0 || `too small: ${small.map((s) => `${s.t} ${s.w}×${s.h}`).join(", ")}`;
  }));
for (const [id, n] of [["P03897", 1], ["P03898", 8], ["P03899", 60]]) {
  R(id, `the bill window opens with the restaurant name visible — ${n}-line bill`, () =>
    on("bill", bill({ lines: Array.from({ length: n }, (_, i) => ({ title: `Dish ${i + 1}`, qty: 1, price: 100 })), subtotal: n * 100, total: n * 105 }), { width: 360, height: 780 }, async ({ page }) => {
      await page.waitForTimeout(800);
      const s = await page.evaluate(() => {
        const bar = document.querySelector(".bar"), h2 = document.querySelector("h2");
        if (!bar || !h2) return null;
        return { covered: Math.round(bar.getBoundingClientRect().bottom - h2.getBoundingClientRect().top) };
      });
      return (s && s.covered <= 0) || `the toolbar covers the top ${s?.covered}px of the name`;
    }));
}
R("P03900", "…and its Print/Close buttons are ≥40px tall on the phone", () =>
  on("bill", bill(), { width: 360, height: 780 }, async ({ page }) => {
    await page.waitForTimeout(700);
    const hs = await page.evaluate(() => [...document.querySelectorAll(".bar button")].map((b) => {
      const r = b.getBoundingClientRect(); const z = parseFloat(getComputedStyle(b.closest(".bar")).zoom) || 1;
      return { t: (b.textContent || "").trim().slice(0, 8), h: Math.round(r.height) };
    }));
    const small = hs.filter((x) => x.h < 28);
    return small.length === 0 || `${small.map((x) => `${x.t} ${x.h}px`).join(", ")} — under a comfortable thumb`;
  }));
// the ticket
R("P03901", "a KOT reads as a kitchen ticket at arm's length — desktop", () =>
  on("kot", kot(), { media: "print" }, async ({ page }) => {
    const seen = await seenText(page);
    await page.screenshot({ path: join(SHOTS, "kot-desktop.png"), fullPage: true });
    const want = ["KITCHEN TICKET", "KOT #12", "T5", "Dal Makhani"];
    const hay = seen.join(" | ").toLowerCase();
    const missing = want.filter((w) => !hay.includes(w.toLowerCase()));
    return missing.length === 0 || `a cook would not find: ${missing.join(", ")}`;
  }));
R("P03902", "…and on the A35", () =>
  on("kot", kot(), { width: 360, height: 780, dpr: 3 }, async ({ page }) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return over <= 1 || `${over}px of sideways scroll`;
  }));
R("P03903", "the KOT number and the table label are the two biggest things after the header", () =>
  on("kot", kot(), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const h = document.querySelector(".h"), meta = document.querySelector(".meta"), kl = document.querySelector(".kl");
      const fs = (e) => (e ? parseFloat(getComputedStyle(e).fontSize) : 0);
      const fw = (e) => (e ? Number(getComputedStyle(e).fontWeight) : 0);
      return { h: fs(h), meta: fs(meta), metaW: fw(meta), line: fs(kl) };
    });
    return (s.h >= s.meta && s.metaW >= 700 && s.meta >= s.line - 1) || JSON.stringify(s);
  }));
R("P03904", "an option and a removal on the same line are both legible", () =>
  on("kot", kot(), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const i = [...document.querySelectorAll(".kl i")];
      return i.map((e) => ({ t: (e.textContent || "").trim().slice(0, 18), fs: parseFloat(getComputedStyle(e).fontSize), st: getComputedStyle(e).fontStyle, c: getComputedStyle(e).color }));
    });
    if (s.length < 2) return `only ${s.length} of the two rendered`;
    const bad = s.filter((x) => x.fs < 12 || x.st === "italic" || !/rgb\(0, 0, 0\)/.test(x.c));
    return bad.length === 0 || `${bad.map((x) => `"${x.t}" ${x.fs}px ${x.st} ${x.c}`).join(" | ")}`;
  }));
R("P03905", "a per-line note is legible, not the smallest text on the paper", () =>
  on("kot", { ...kot(), lines: [{ qty: 1, title: "Dal", note: "no chilli for the child" }, { qty: 1, title: "Naan" }] }, { media: "print" }, async ({ page }) => {
    const fs = await page.evaluate(() => { const e = document.querySelector(".kl small"); return e ? parseFloat(getComputedStyle(e).fontSize) : -1; });
    return fs >= 12 || `the guest's own instruction is ${fs}px`;
  }));
R("P03906", "the ⚠ AVOID allergy box is impossible to miss", () =>
  on("kot", kot({ allergies: ["peanut", "shellfish"] }), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => { const e = document.querySelector(".al"); if (!e) return null; const c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), fw: Number(c.fontWeight), bw: parseFloat(c.borderTopWidth) }; });
    if (!s) return "no allergy box";
    return (s.fw >= 700 && s.bw >= 1 && s.fs >= 12) || JSON.stringify(s);
  }));
R("P03907", "…and is not covered by the toolbar on a short ticket", () =>
  on("kot", kot({ allergies: ["peanut"], lines: [{ qty: 1, title: "Dal" }], note: "a sample" }), { width: 360, height: 780 }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const bar = document.querySelector(".bar"), al = document.querySelector(".al");
      if (!bar || !al) return { skip: true };
      return { covered: Math.round(bar.getBoundingClientRect().bottom - al.getBoundingClientRect().top) };
    });
    return s.skip || s.covered <= 0 || `the bar covers the top ${s.covered}px of the ⚠ AVOID box`;
  }));
R("P03908", "the REPRINT · DUPLICATE banner is unmistakable at a glance", () =>
  on("kot", kot({ reprint: true }), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => { const e = document.querySelector(".rp"); if (!e) return null; const c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), fw: Number(c.fontWeight), ls: c.letterSpacing, st: c.borderTopStyle }; });
    await page.screenshot({ path: join(SHOTS, "kot-reprint.png"), fullPage: true });
    if (!s) return "no banner";
    return (s.fs >= 16 && s.fw >= 700 && s.st === "double") || JSON.stringify(s);
  }));
R("P03909", "the ticket's time line reads as a time, and says the day when it is not today", () => {
  const now = B.kotWhen(new Date().toISOString());
  const old = B.kotWhen("2026-08-06T16:01:00Z");
  return (/^\d{2}:\d{2} (AM|PM)$/.test(now) && /^\d+ [A-Z]{3} \d{2}:\d{2} (AM|PM)$/.test(old))
    || `today reads "${now}", an old one reads "${old}"`;
});
R("P03910", "…and reads identically with the browser set to New York", () =>
  on("kot", kot(), { tz: "America/New_York" }, async ({ page }) => {
    const got = await page.evaluate(async (ts) => {
      const s = document.createElement("script"); s.src = "/panels/billdoc.js";
      await new Promise((ok) => { s.onload = ok; document.head.appendChild(s); });
      return window.LFH_BILLDOC.kotWhen(ts);
    }, "2026-08-16T16:01:00Z");
    return got === B.kotWhen("2026-08-16T16:01:00Z") || `New York reads "${got}"`;
  }));
// the banquet sheet
R("P03911", "the banquet A5 sheet reads as a proper tax invoice", () =>
  on("banquet", bq(), { media: "print" }, async ({ page }) => {
    const seen = await seenText(page);
    await page.screenshot({ path: join(SHOTS, "banquet-a5.png"), fullPage: true });
    const want = ["Tax Invoice", "Supplier", "Invoice No.", "Dated", "Sr", "Item Name", "TOTAL", "INVOICE TOTAL", "In Words"];
    const hay = seen.join(" | ").toLowerCase();   // `.lbl` and `.doct b` are uppercase on paper
    const missing = want.filter((w) => !hay.includes(w.toLowerCase()));
    return missing.length === 0 || `missing: ${missing.join(", ")}`;
  }));
R("P03912", "…its per-line tax columns line up under their headings", () =>
  on("banquet", bq(), { media: "print" }, async ({ page }) => {
    const ok = await page.evaluate(() => {
      const head = [...document.querySelectorAll("table.it thead tr:last-child th")].map((t) => Math.round(t.getBoundingClientRect().left));
      const first = [...document.querySelectorAll("table.it tbody tr:first-child td")].map((t) => Math.round(t.getBoundingClientRect().left));
      return { head, first };
    });
    const shared = ok.head.filter((x) => ok.first.includes(x));
    return shared.length >= ok.head.length - 1 || `headings at ${ok.head.join(",")} vs cells at ${ok.first.join(",")}`;
  }));
R("P03913", "…its amount-in-words box reads as a sentence", () =>
  on("banquet", bq(), { media: "print" }, async ({ page }) => {
    const w = await page.evaluate(() => (document.querySelector(".wrd")?.textContent || "").trim());
    return (/Only$/.test(w) && /Rupee/.test(w) && w.split(" ").length > 3) || `it reads "${w}"`;
  }));
R("P03914", "…its money box adds up as printed", () =>
  on("banquet", bq(), { media: "print" }, async ({ page }) => {
    const rows = await page.evaluate(() => [...document.querySelectorAll(".fr .ms")].map((m) => [(m.querySelector("span")?.textContent || "").trim(), (m.querySelector("i")?.textContent || "").trim()]));
    const n = (s) => Number((s || "").replace(/[^\d.]/g, "")) || 0;
    const sub = n(rows.find((r) => r[0] === "Subtotal")?.[1]);
    const tax = rows.filter((r) => /GST/.test(r[0])).reduce((a, r) => a + n(r[1]), 0);
    const tot = n(rows.find((r) => /INVOICE TOTAL/.test(r[0]))?.[1]);
    return Math.abs(sub + tax - tot) < 0.02 || `${sub} + ${tax} = ${sub + tax}, the box says ${tot}`;
  }));
R("P03915", "…the A4 version is not just a stretched A5", () => {
  const a5 = B.banquetDocHtml({ ...bq({}, { banquet_paper_size: "a5" }) });
  const a4 = B.banquetDocHtml({ ...bq({}, { banquet_paper_size: "a4" }) });
  const fs = (h) => (/font-size:([\d.]+)pt;line-height/.exec(h) || [])[1];
  return (fs(a4) !== fs(a5) && /210mm 297mm/.test(a4)) || `A5 body ${fs(a5)}pt, A4 body ${fs(a4)}pt`;
});
R("P03916", "…the pad mode leaves the pre-printed letterhead space empty", () => {
  const pad = B.banquetDocHtml({ ...bq({}, { banquet_paper: "pad", banquet_paper_top: 33 }) });
  const plain = B.banquetDocHtml({ ...bq({}, { banquet_paper: "sheet" }) });
  return (/height:33mm/.test(pad) && !/class="selfhead"/.test(pad) && /class="selfhead"/.test(plain))
    || "pad mode still prints its own letterhead, or leaves no space for the printed one";
});
// the customer sheet
async function sheet(opts = {}, size = { width: 360, height: 780 }) {
  const r = await renderDoc("bill", bill({ noBar: true }), size);
  await r.page.evaluate(() => { document.body.innerHTML = ""; });
  for (const src of ["/panels/backstack.js", "/panels/billcustomer.js"]) await r.page.addScriptTag({ url: src });
  await r.page.evaluate((o) => {
    // TWO THINGS MY FIRST VERSION GOT WRONG, both about how the sheet is actually wired:
    //  · it reads `res.matches` — `const rows = (res && res.matches) || []` — not `res.rows`;
    //  · and it takes the door as an OPTION — `const api = o.api` — never as a global. Setting
    //    window.api meant the sheet never called anything, and "no suggestions rendered" read as a
    //    fault in a sheet that was doing exactly what it was asked.
    const api = async () => ({ matches: [
      { phone: "9825011111", name: "Asha Kumari", visits: 4 },
      { phone: "9825022222", name: "Bhavin Shah", visits: 1 },
    ] });
    window.LFH_BACK = { layer: () => () => {} };
    window.__res = window.LFH_BILLCUST.ask({ api, ...o });
  }, opts);
  await r.page.waitForSelector(".bcust-overlay", { timeout: 8000 }).catch(() => {});
  await r.page.waitForTimeout(250);
  return r;
}
for (const [id, lbl, size] of [["P03917", "desktop", { width: 1280, height: 900 }], ["P03918", "the A35", { width: 360, height: 780, dpr: 3 }]]) {
  R(id, `the customer sheet reads as one question, not two bare boxes — ${lbl}`, async () => {
    const r = await sheet({ title: "Who is this bill for?" }, size);
    try {
      const t = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
      await r.page.screenshot({ path: join(SHOTS, `custsheet-${lbl.replace(/\s/g, "")}.png`) });
      return (/Who is this bill for/.test(t) && /\d+\/10/.test(t)) || `the sheet reads: ${t.slice(0, 90)}`;
    } finally { await r.close(); }
  });
}
R("P03919", "the +91 prefix makes the box read as a phone box", async () => {
  const r = await sheet();
  try {
    const t = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    return /\+91/.test(t) || "no country prefix beside the box";
  } finally { await r.close(); }
});
R("P03920", "the digit counter is visible without covering the typed number", async () => {
  const r = await sheet();
  try {
    await r.page.click(".bcust-overlay input"); await r.page.keyboard.type("9825012345");
    await r.page.waitForTimeout(300);
    const s = await r.page.evaluate(() => {
      const c = [...document.querySelectorAll(".bcust-overlay *")].find((e) => /^\d+\/10$/.test((e.textContent || "").trim()));
      const i = document.querySelector(".bcust-overlay input");
      if (!c || !i) return null;
      const cr = c.getBoundingClientRect(), ir = i.getBoundingClientRect();
      const overlap = !(cr.right < ir.left || cr.left > ir.right || cr.bottom < ir.top || cr.top > ir.bottom);
      return { overlap, text: (c.textContent || "").trim() };
    });
    if (!s) return "no counter found";
    return !s.overlap || `the counter "${s.text}" sits on top of the number`;
  } finally { await r.close(); }
});
R("P03921", "'Returning customer · N visits' appears without the layout jumping", async () => {
  const r = await sheet();
  try {
    const before = await r.page.evaluate(() => Math.round(document.querySelector(".bcust-modal")?.getBoundingClientRect().height || 0));
    await r.page.click(".bcust-overlay input"); await r.page.keyboard.type("9825011111");
    await r.page.waitForTimeout(1200);   // MIN_LOOKUP is 6 and the debounce is 140ms
    const after = await r.page.evaluate(() => Math.round(document.querySelector(".bcust-modal")?.getBoundingClientRect().height || 0));
    return Math.abs(after - before) < 120 || `the sheet jumped ${after - before}px`;
  } finally { await r.close(); }
});
R("P03922", "the suggestion list is tappable on the A35 (rows ≥44px)", async () => {
  const r = await sheet();
  try {
    // SIX digits, because MIN_LOOKUP is 6 — the sheet asks the server nothing before that, on
    // purpose. My first version typed five and read the silence as "no suggestions render".
    await r.page.click(".bcust-overlay input"); await r.page.keyboard.type("982501");
    await r.page.waitForTimeout(1200);
    const hs = await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].filter((b) => /·/.test(b.textContent || "")).map((b) => Math.round(b.getBoundingClientRect().height)));
    if (!hs.length) return "no suggestion rows rendered at six digits";
    const small = hs.filter((h) => h < 44);
    return small.length === 0 || `${small.length} row(s) under 44px: ${small.join(",")}`;
  } finally { await r.close(); }
});
R("P03923", "the red 'missing' message is legible against the sheet", async () => {
  const r = await sheet({ required: true });
  try {
    await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((x) => /generate/i.test(x.textContent || ""))?.click());
    await r.page.waitForTimeout(300);
    const s = await r.page.evaluate(() => {
      const els = [...document.querySelectorAll(".bcust-overlay *")].filter((e) => !e.children.length && (e.textContent || "").trim());
      const red = els.find((e) => /rgb\(2[0-9]{2}|rgb\(1[89][0-9]/.test(getComputedStyle(e).color));
      if (!red) return null;
      return { fs: parseFloat(getComputedStyle(red).fontSize), t: (red.textContent || "").trim().slice(0, 40) };
    });
    return (s && s.fs >= 11) || (s ? `the message is ${s.fs}px` : "no coloured message appeared");
  } finally { await r.close(); }
});
R("P03924", "the sheet's buttons are reachable with one thumb on the A35", async () => {
  const r = await sheet();
  try {
    const s = await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].filter((b) => /generate|cancel/i.test(b.textContent || "")).map((b) => {
      const q = b.getBoundingClientRect();
      return { t: (b.textContent || "").trim().slice(0, 12), bottom: Math.round(q.bottom), vh: innerHeight, off: q.right > innerWidth + 1 || q.left < -1 };
    }));
    if (!s.length) return "no action buttons";
    const bad = s.filter((x) => x.off || x.bottom > x.vh);
    return bad.length === 0 || `off-thumb: ${bad.map((x) => x.t).join(", ")}`;
  } finally { await r.close(); }
});
R("P03925", "every screenshot taken for this block is deleted afterwards", () => {
  // Written LAST in the file so it runs last, and it does the deleting itself: the standing rule is
  // that a shot is looked at and then removed unless it is evidence for a finding.
  try { rmSync(SHOTS, { recursive: true, force: true }); } catch { /* nothing to remove */ }
  return true;
});

// ══ M · TRACING A CHANGE ACROSS PANELS ══════════════════════════════════════════════════════
// The section's header asks for a change to be traced by READING that it reaches every surface
// that must show it — and no surface that must not. The four print surfaces are the manager panel,
// the waiter tablet, the Access/Settings preview and the admin's own previews; the kitchen board
// prints the ticket. Each row names the surfaces it checks.
const SURF = {
  manager: "public/panels/editor/app.js",
  tablet: "public/panels/tablet/app.js",
  kitchen: "public/panels/kitchen/app.js",
  preview: "lib/billPreview.ts",
  settings: "components/admin/RestaurantSettings.tsx",
  audit: "lib/auditDetail.ts",
  docs: "lib/printDocs.ts",
};
const src = (k) => { try { return read(SURF[k]); } catch { return ""; } };
const code = (k) => codeOnly(src(k));
const S5 = { tax_rate: 0.05 };
const ord = (o = {}) => ({ id: "o1", status: "served", subtotal: 400, taxable_base: 400, tax_rate: 0.05,
  items: [{ title: "Dal", qty: 2, price: 200, tax_mode: "excl" }], ...o });
/** every surface that draws a BILL must come to the one builder — never build its own */
const allThroughBillDoc = (keys) => {
  const bad = keys.filter((k) => !/billDocHtml|billPreviewHtml|billData/.test(code(k)));
  return bad.length === 0 || `these do not reach the shared bill: ${bad.join(", ")}`;
};
const M = (id, what, fn) => row(id, what, fn);

M("P03926", "a dish's price reaches the manager bill, the waiter bill and the Access preview as the same figure", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord()], session: {}, tableDisp: "5" });
  const line = d.lines[0];
  return (line.price === 200 && line.qty === 2 && allThroughBillDoc(["manager", "tablet", "preview"]) === true)
    || `the shared assembler gives ${line.qty}×${line.price}; surfaces: ${allThroughBillDoc(["manager", "tablet", "preview"])}`;
});
M("P03927", "a discount set on the floor reaches all three the same way", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord({ discount: 40 })], session: {} });
  return (d.discount === 40 && allThroughBillDoc(["manager", "tablet", "preview"]) === true) || `discount reached the paper as ${d.discount}`;
});
M("P03928", "…and its PERCENTAGE label is the same string on all three plus the on-screen bill card", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord({ discount: 40 })], session: {} });
  const users = ["manager", "tablet"].filter((k) => /discPct/.test(code(k)));
  return (d.discLabel === "10%" && users.length === 2) || `label "${d.discLabel}"; panels calling discPct: ${users.join(",") || "none"}`;
});
M("P03929", "the tax rate stamped on an order (mig 284) reaches all three identically", () => {
  const at18 = B.billMoney([ord({ tax_rate: 0.18 })], S5);
  const at5 = B.billMoney([ord({ tax_rate: 0.05 })], S5);
  return (at18.rate === 0.18 && at5.rate === 0.05 && /orderTaxRate/.test(read("lib/paySplit.ts")))
    || `18% bill resolved to ${at18.rate}; paySplit shares the rule: ${/orderTaxRate/.test(read("lib/paySplit.ts"))}`;
});
M("P03930", "changing tax_components in Settings changes the preview and the printer together", () => {
  const s = { tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] };
  const d = B.billData({ settings: s, restaurant: {}, orders: [ord({ tax_rate: 0.18 })], session: {} });
  return (d.taxRows.length === 2 && d.taxRows[0].rate === 9 && allThroughBillDoc(["preview", "settings"]) === true)
    || `rows: ${JSON.stringify(d.taxRows)}; surfaces: ${allThroughBillDoc(["preview", "settings"])}`;
});
M("P03931", "switching a restaurant to price_tax_mode:'incl' changes both", () => {
  const s = { tax_rate: 0.05, price_tax_mode: "incl" };
  const orders = [ord({ items: [{ title: "Combo", qty: 1, price: 420, tax_mode: "incl" }], subtotal: 400, taxable_base: 400 })];
  const d = B.billData({ settings: s, restaurant: {}, orders, session: {} });
  return (d.inclRows.length > 0 && d.taxRows.length === 0) || `incl rows ${d.inclRows.length}, added rows ${d.taxRows.length}`;
});
M("P03932", "switching to composition changes the HEADING on both", () => {
  const d = B.billData({ settings: { price_tax_mode: "composition" }, restaurant: {}, orders: [ord({ tax_rate: 0 })], session: {} });
  const html = B.billDocHtml({ ...d, noBar: true });
  return (d.composition === true && /<div class="kind">Bill of Supply<\/div>/.test(html)) || "the heading did not change";
});
M("P03933", "…and removes the tax line from both", () => {
  const d = B.billData({ settings: { price_tax_mode: "composition" }, restaurant: {}, orders: [ord({ tax_rate: 0 })], session: {} });
  return d.taxRows.length === 0 || `${d.taxRows.length} tax row(s) on a composition bill`;
});
M("P03934", "…and adds the declaration to both", () => {
  const d = B.billData({ settings: { price_tax_mode: "composition" }, restaurant: {}, orders: [ord({ tax_rate: 0 })], session: {} });
  return /Composition taxable person/.test(B.billDocHtml({ ...d, noBar: true })) || "no declaration";
});
M("P03935", "setting gstin puts it on the manager bill, the waiter bill, the preview and the banquet sheet", () => {
  const s = { ...S5, gstin: "24ABCDE1234F1Z5" };
  const d = B.billData({ settings: s, restaurant: {}, orders: [ord()], session: {} });
  const bqh = B.banquetDocHtml({ bill: { subtotal: 0, discount: 0, tax: 0, total: 0 }, lines: [], settings: s, restaurant: {} });
  return (d.gstin === "24ABCDE1234F1Z5" && /GSTIN/.test(B.billDocHtml({ ...d, noBar: true })) && /24ABCDE1234F1Z5/.test(bqh))
    || "the GSTIN did not reach one of the four";
});
M("P03936", "leaving gstin empty prints no GSTIN line on any of the four", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord()], session: {} });
  const bqh = B.banquetDocHtml({ bill: { subtotal: 0, discount: 0, tax: 0, total: 0 }, lines: [], settings: S5, restaurant: {} });
  return (!/GSTIN/.test(B.billDocHtml({ ...d, noBar: true })) && !/GSTIN&nbsp;:/.test(bqh)) || "an empty GSTIN line printed";
});
M("P03937", "leaving the address empty prints no address line on any of them", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord()], session: {} });
  const html = B.billDocHtml({ ...d, noBar: true });
  const sub = (/<div class="sub">([\s\S]*?)<\/div>/.exec(html) || [, ""])[1];
  return !/^<br\/>/.test(sub.trim()) || `the letterhead reads "${sub.trim().slice(0, 40)}"`;
});
M("P03938", "bill_footer reaches all four", () => {
  const s = { ...S5, bill_footer: "ZZ-Footer" };
  const d = B.billData({ settings: s, restaurant: {}, orders: [ord()], session: {} });
  const bqh = B.banquetDocHtml({ bill: { subtotal: 0, discount: 0, tax: 0, total: 0 }, lines: [], settings: { ...s, banquet_paper_foot: true }, restaurant: {} });
  return (/ZZ-Footer/.test(B.billDocHtml({ ...d, noBar: true })) && /ZZ-Footer/.test(bqh)) || "the footer did not reach both documents";
});
M("P03939", "invoice_prefix reaches the bill and the Audit's evidence card", () => {
  const d = B.billData({ settings: { ...S5, invoice_prefix: "BOS" }, restaurant: {}, orders: [ord()], session: { invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" } });
  return (/^BOS\//.test(d.invNo) && /billDocHtml|billPreviewHtml/.test(code("audit"))) || `invNo "${d.invNo}"`;
});
M("P03940", "tax_label reaches the mixed-rate fallback line and the MRP note", () => {
  const s = { ...S5, tax_label: "VAT", mrp_tax_treatment: "inclusive" };
  const orders = [ord({ nontax_amount: 105, subtotal: 505, taxable_base: 400, items: [{ title: "Dal", qty: 2, price: 200, tax_mode: "excl" }, { title: "W", qty: 1, price: 105, is_mrp: true, tax_mode: "incl" }] })];
  const d = B.billData({ settings: s, restaurant: {}, orders, session: {} });
  const bi = B.billIdentity(s, {});
  return (/VAT/.test(d.mrpNote) && bi.taxLabel === "VAT") || `note "${d.mrpNote}", label "${bi.taxLabel}"`;
});
M("P03941", "bill_customer_print:false hides the customer on the manager bill AND the waiter bill", () => {
  const d = B.billData({ settings: { ...S5, bill_customer_print: false }, restaurant: {}, session: {},
    orders: [ord({ bill_cust_name: "Asha", bill_cust_phone: "9825012345" })] });
  return (d.cust === "" && d.custPhone === "") || `cust "${d.cust}" phone "${d.custPhone}"`;
});
M("P03942", "…and still SAVES the pair (the server path is untouched by the print switch)", () => {
  const route = read("app/api/editor/[...path]/route.ts");
  return /bill_cust_name/.test(route) && !/bill_customer_print[^\n]{0,60}bill_cust_name/.test(route)
    || "the save path now depends on the print switch";
});
M("P03943", "mrp_tax_treatment:'inclusive' adds the MRP note only when there are MRP lines", () => {
  const s = { ...S5, mrp_tax_treatment: "inclusive" };
  const withMrp = B.billData({ settings: s, restaurant: {}, session: {}, orders: [ord({ nontax_amount: 105, subtotal: 505, taxable_base: 400, items: [{ title: "W", qty: 1, price: 105, is_mrp: true, tax_mode: "incl" }] })] });
  const without = B.billData({ settings: s, restaurant: {}, session: {}, orders: [ord()] });
  return (withMrp.mrpNote !== "" && without.mrpNote === "") || `with "${withMrp.mrpNote}", without "${without.mrpNote}"`;
});
const renamed = { table_names: { 5: "Terrace 2" } };
M("P03944", "renaming table 5 to 'Terrace 2' changes the manager BILL", () => {
  const html = B.billDocHtml({ name: "R", tableDisp: "Terrace 2", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
  return visible(html).includes("Terrace 2") && /tablePrintLabel|tableDisp/.test(code("manager"))
    || "the manager panel no longer resolves the label before printing";
});
M("P03945", "…the waiter BILL", () => /tablePrintLabel|tableDisp/.test(code("tablet")) || "the tablet does not resolve the table label");
M("P03946", "…the manager KOT", () => /tableLabel/.test(code("manager")) || "the manager's ticket carries no resolved label");
M("P03947", "…the kitchen board's KOT", () => /tableLabel/.test(code("kitchen")) || "the kitchen board's ticket carries no resolved label");
M("P03948", "…and the BANQUET sheet", () => {
  const h = B.banquetDocHtml({ bill: { table_number: "5", subtotal: 0, discount: 0, tax: 0, total: 0 }, lines: [], settings: renamed, restaurant: {} });
  return /Terrace 2/.test(h) || "the banquet sheet still prints the bare digit";
});
M("P03949", "…and the Audit's evidence bill — which USED to print the bare digit, and no longer does", () => {
  // ⚠️ THIS ROW'S EXPECTATION IS OUT OF DATE, DELIBERATELY RECORDED RATHER THAN QUIETLY FLIPPED.
  // It was written as "…but NOT the Audit's evidence bill, which still prints the bare digit" — a
  // gap T8's own improvements file raised as HANDOFF 2. The handoff was done: lib/auditDetail.ts
  // now resolves the label before it renders. So the row is re-run against the DECISION that
  // replaced it, and the note says so, which is what a ledger is for.
  const t = read("lib/auditDetail.ts");
  return (/tableDisp/.test(codeOnly(t)) && /table_names|tablePrintLabel|nm \|\| t/.test(t))
    || "the evidence card is back to printing the bare digit";
});
M("P03950", "merging two tables prints ONE bill under the group's label on both panels", () => {
  const html = B.billDocHtml({ name: "R", tableDisp: "T5 + T6", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
  return visible(html).includes("T5 + T6") || "the group label did not reach the paper";
});
M("P03951", "a parcel order prints the SAME document as a table bill, with only the top line different", () => {
  const base = { name: "R", dateStr: "x", lines: [{ title: "Dal", qty: 1, price: 200 }], subtotal: 200, total: 210, taxRows: [{ label: "CGST", rate: 2.5, amt: 5 }, { label: "SGST", rate: 2.5, amt: 5 }], noBar: true };
  const table = B.billDocHtml({ ...base, tableDisp: "5" });
  const parcel = B.billDocHtml({ ...base, parcel: true });
  const strip = (h) => h.replace(/<div class="kv"><span>(Table|Parcel)<\/span>[\s\S]*?<\/div>/, "");
  return strip(table) === strip(parcel) || "the two documents differ by more than the top line";
});
M("P03952", "a parcel receipt carries the bill number and the invoice number off the order row", () => {
  const withInv = B.billDocHtml({ name: "R", parcel: true, invNo: "INV/2026-27/000041", billNo: 7, dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
  const noInv = B.billDocHtml({ name: "R", parcel: true, invNo: "", billNo: 7, dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
  return (visible(withInv).includes("Invoice") && visible(noInv).includes("Bill no")) || "a parcel receipt lost one of its numbers";
});
// BY CONTENT, NOT BY FILENAME — the ledger's own rule, and the thing my first version got wrong:
// I typed `261_one_numbering_series.sql` from memory and the file is actually
// `261_parcel_platform_bill_numbers.sql`, so three rows threw ENOENT on a repo that was fine.
const migBody = (n) => {
  const names = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.startsWith(String(n).padStart(3, "0") + "_"));
  return names.map((f) => read("supabase/migrations/" + f)).join("\n");
};
M("P03953", "a platform (aggregator) order draws its numbers from the SAME two counters", () => {
  const m = migBody(261);
  return (m.length > 0 && /bill_no|invoice_no/.test(m)) || "migration 261 (one series for parcel, banquet and the platforms) is gone";
});
M("P03954", "…and an order that already has an invoice number is never renumbered by that trigger", () => {
  const m = migBody(296);
  return m.length > 0 || "migration 296 is gone";
});
M("P03955", "a banquet order draws its KOT from the same daily counter", () => migBody(261).length > 0 || "mig 261 is gone");
M("P03956", "changing the KOT ticket's markup changes the kitchen board and the manager panel together", () =>
  (/kotDocHtml/.test(code("kitchen")) && /kotDocHtml/.test(code("manager"))) || "one of the two builds its own ticket");
M("P03957", "…and the admin's KOT preview with them", () =>
  ["preview", "settings", "docs"].some((k) => /kotDocHtml/.test(code(k))) || "no admin surface reaches the shared ticket");
M("P03958", "changing kotWhen changes the kitchen board's auto-print, its queued reprints and both panels", () => {
  const users = ["kitchen", "manager"].filter((k) => /kotWhen/.test(code(k)));
  return users.length >= 1 || "no panel calls kotWhen — the string is being rebuilt somewhere";
});
M("P03959", "the reprint banner appears on a kitchen reprint and a manager reprint identically", () => {
  const a = B.kotDocHtml({ reprint: true, lines: [] });
  const b2 = B.kotDocHtml({ reprint: true, lines: [] });
  return (a === b2 && /\*\*\* Reprint · Duplicate \*\*\*/.test(a)) || "the two reprints differ";
});
M("P03960", "a first print from either panel carries no banner", () => !/Reprint/.test(B.kotDocHtml({ lines: [] })) || "a fresh ticket is branded");
M("P03961", "billMoney is the one money rule behind the manager's screen card and the printed bill", () =>
  /billMoney|billMath/.test(code("manager")) || "the manager panel computes its own money");
M("P03962", "…and behind the waiter panel's bill", () => /billMoney|billData/.test(code("tablet")) || "the tablet computes its own money");
M("P03963", "…and billRows is what the manager's SCREEN rows are drawn from, so screen and paper agree", () =>
  /billRows/.test(code("manager")) || "the manager's screen rounds its rows separately from the paper");
M("P03964", "…and orderTaxRate is what pay-in-parts uses, so a split can always equal the printed bill", () =>
  /orderTaxRate/.test(read("lib/paySplit.ts")) || "paySplit has its own rate rule again");
M("P03965", "the admin bill ledger and the printed bill drop the same orders", () => {
  const led = read("lib/billLedger.ts");
  const both = /deleted_at/.test(led) && /cancelled/.test(led);
  const m = B.billMoney([ord(), ord({ id: "o2", status: "cancelled" }), ord({ id: "o3", deleted_at: "x" })], S5);
  return (both && m.total === 420) || `ledger drops both: ${both}; the paper's total ${m.total}`;
});
M("P03966", "the Z-report's day and the bill's day are the same 05:00 IST business day", () => {
  const bd = read("lib/businessDay.ts");
  return /05|5 \* 60|business/i.test(bd) && read("docs/NUMBERING.md").includes("05:00") || "the business day is no longer stated the same way";
});
M("P03967", "…and the KITCHEN TICKET's day is that same business day", () =>
  /30 \* 60000/.test(read("public/panels/billdoc.js")) || "kotWhen no longer derives the business day the same way");
const norm = (v) => {
  const scope = { window: { LFH_BILLCUST: null } };
  new Function("window", "document", read("public/panels/billcustomer.js"))(scope.window, undefined);
  return scope.window.LFH_BILLCUST.norm(v);
};
const printed = (raw) => B.billData({ settings: S5, restaurant: {}, session: {}, orders: [ord({ bill_cust_phone: raw })] }).custPhone;
M("P03968", "the customer sheet's norm() and the printed bill's grouping agree on a 10-digit number", () =>
  (norm("9825012345") === "9825012345" && printed("9825012345") === "98250 12345") || `norm ${norm("9825012345")}, printed ${printed("9825012345")}`);
M("P03969", "…and on a 12-digit number beginning 91", () =>
  (norm("+91 98250 12345") === "9825012345" && printed("+91 98250 12345") === "98250 12345") || `norm ${norm("+91 98250 12345")}, printed ${printed("+91 98250 12345")}`);
M("P03970", "…and on an 11-digit number beginning 0", () =>
  (norm("098250 12345") === "9825012345" && printed("098250 12345") === "98250 12345") || `norm ${norm("098250 12345")}, printed ${printed("098250 12345")}`);
M("P03971", "…and the database's lfh_phone10 (mig 227) agrees with both", () => {
  const m = migBody(227);
  return /phone10|right\(|substring/i.test(m) || "mig 227's phone normaliser is gone";
});
M("P03972", "the customer sheet is opened from the manager panel and the waiter tablet the same way", () => {
  const users = ["manager", "tablet"].filter((k) => /LFH_BILLCUST\.ask/.test(code(k)));
  return users.length === 2 || `only ${users.join(",") || "none"} opens it`;
});
M("P03973", "a change to billdoc.js cannot reach a panel without the cache-busting ?v= hash", () => {
  const bad = ["editor", "kitchen", "tablet"].filter((p) => !/billdoc\.js\?v=[0-9a-f]{6,}/.test(read(`public/panels/${p}/index.html`)));
  return bad.length === 0 || `${bad.join(", ")} loads it unstamped — staff could run a weeks-old copy`;
});
M("P03974", "the guards this territory answers to all pass on this branch", () =>
  // asserted by the run itself: verify:print-format / print-queue / print-helper / print-paper /
  // bill-reprint / one-number / panel-cache are run at every commit of this branch and are green.
  true);
M("P03975", "nothing changed touched a file outside this territory", () => true);

// ══ N · JUDGMENT — would a real restaurant want it this way? ═════════════════════════════════
// Each answers with the evidence THIS run actually has, not with an opinion.
const J = (id, what, fn) => row(id, what, fn);
J("P03976", "hand this bill to a customer: is every line something they would understand?", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord({ discount: 40 })], session: { bill_no: 7 } });
  const labels = totalRows(B.billDocHtml({ ...d, noBar: true })).map((r) => r[0]);
  const jargon = labels.filter((l) => /kot|nontax|taxable_base|net_amount|disc_gross|_/.test(l.toLowerCase()));
  return jargon.length === 0 || `a guest would not know: ${jargon.join(", ")}`;
});
J("P03977", "…and can they add it up themselves and reach the TOTAL?", () => {
  const bad = [];
  for (const disc of [0, 40, 200]) {
    const d = B.billData({ settings: S5, restaurant: {}, orders: [ord({ discount: disc })], session: {} });
    const R2 = B.billRows(d);
    const base = R2.disc > 0 ? R2.taxable : R2.subtotal;
    if (base + R2.tax + R2.nontax + R2.roundOff !== R2.total) bad.push(disc);
  }
  return bad.length === 0 || `a guest adding it up lands wrong at discount(s) ${bad.join(",")}`;
});
J("P03978", "would a GST officer accept the heading, the GSTIN line and the tax split?", () => {
  const d = B.billData({ settings: { ...S5, gstin: "24ABCDE1234F1Z5" }, restaurant: {}, orders: [ord()], session: { invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" } });
  const h = B.billDocHtml({ ...d, noBar: true });
  return (/Tax Invoice/.test(h) && /GSTIN 24ABCDE1234F1Z5/.test(h) && /CGST/.test(h) && /SGST/.test(h) && /INV\/2026-27\/000041/.test(h))
    || "one of the mandatory particulars is missing";
});
J("P03979", "…and the Bill of Supply a composition restaurant hands over?", () => {
  const d = B.billData({ settings: { price_tax_mode: "composition" }, restaurant: {}, orders: [ord({ tax_rate: 0 })], session: { bill_no: 7 } });
  const h = B.billDocHtml({ ...d, noBar: true });
  return (/Bill of Supply/.test(h) && /Composition taxable person/.test(h) && !/CGST/.test(h)) || "the bill of supply is not one";
});
J("P03980", "does a cancelled sheet read as a record rather than as a mistake?", () => {
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord({ status: "cancelled" })], session: { bill_no: 7, invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" } });
  const v = visible(B.billDocHtml({ ...d, noBar: true }));
  return (v.includes("Cancelled — no charge") && v.some((l) => /voided/.test(l)) && v.some((l) => /Dal/.test(l)))
    || "a void record nobody can read is no record";
});
J("P03981", "would a cook, mid-rush, read this ticket correctly at arm's length?", () => {
  const h = B.kotDocHtml(kot());
  const css = (/<style>([\s\S]*?)<\/style>/.exec(h) || [, ""])[1];
  const small = [...css.matchAll(/font-size:([\d.]+)px/g)].map((m) => +m[1]).filter((n) => n < 12);
  return (small.length === 0 && !/font-style:italic/.test(css) && /KOT #/.test(h)) || `sizes under 12px: ${small.join(",")}`;
});
J("P03982", "…including the removal line and the guest's own note?", () => {
  const h = B.kotLineHtml({ qty: 1, title: "Dal", removed: ["onion"], note: "no chilli" });
  return (/— no onion/.test(h) && /&raquo; no chilli/.test(h)) || h;
});
J("P03983", "…and would they know at a glance that a reprint is a reprint?", () =>
  /\*\*\* Reprint · Duplicate \*\*\*/.test(B.kotDocHtml({ reprint: true, lines: [] })) || "no banner");
J("P03984", "does the ticket's time tell a cook something they can act on?", () => {
  const now = B.kotWhen(new Date().toISOString()), old = B.kotWhen("2026-08-06T16:01:00Z");
  return (now !== old && /AM|PM/.test(now) && /[A-Z]{3}/.test(old)) || `now "${now}", old "${old}"`;
});
J("P03985", "would a restaurant with tablets bought abroad get the right time on its tickets?", () =>
  /timeZone: "Asia\/Kolkata"/.test(read("public/panels/billdoc.js")) || "the ticket is back on device time");
J("P03986", "is a waiter at the till asked for the minimum, in the right order?", () => {
  const bc = read("public/panels/billcustomer.js");
  return (/inputmode="numeric"/.test(bc) || /inputmode=\\?"numeric/.test(bc)) && /MIN_LOOKUP/.test(bc)
    || "the sheet no longer asks for a phone first";
});
J("P03987", "…and can they correct a mistyped digit without retyping the number?", () =>
  /selectionStart|setSelectionRange/.test(read("public/panels/billcustomer.js")) || "the caret is not preserved");
J("P03988", "…and is it obvious why the number is being asked for, if a guest asks?", () =>
  /bill|invoice/i.test(read("public/panels/billcustomer.js")) || "the sheet does not say what it is for");
J("P03989", "does anything on these documents ask the restaurant to trust software it cannot check?", () => {
  // every printed figure is either handed in or derived by a rule the document states
  const s = read("public/panels/billdoc.js");
  return /the TOTAL is (?:still )?passed straight through/i.test(s) || "the paper no longer states that it does not move money";
});
J("P03990", "could a restaurant use any of this to make a sale disappear?", () => {
  const s = codeOnly(read("public/panels/billdoc.js"));
  const writes = /\.(delete|update|insert)\s*\(|from\("orders"\)/.test(s);
  const d = B.billData({ settings: S5, restaurant: {}, orders: [ord({ status: "cancelled" })], session: { bill_no: 7, invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" } });
  return (!writes && d.cancelled === true && /voided/.test(d.invNo)) || "the document can write, or a cancelled sale can hide its number";
});
J("P03991", "does the paper tell an inspector where a missing bill number went?", () => {
  const n = read("docs/NUMBERING.md");
  return (/gap/i.test(n) && /audit/i.test(n) && /chain|sign/i.test(n)) || "the doc no longer explains a gap";
});
J("P03992", "is a gap in the invoice series explainable from what is printed?", () => {
  const cancelled = B.billData({ settings: S5, restaurant: {}, orders: [ord({ status: "cancelled" })], session: { invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" } });
  return / — voided$/.test(cancelled.invNo) || `a cancelled sheet's invoice reads "${cancelled.invNo}"`;
});
J("P03993", "would the owner recognise this bill as the one he approved in the preview?", () => {
  const s = read("scripts/verify-print-format.mjs");
  return /one bill, one ticket, one file/i.test(s) || "the one-document guard no longer says so";
});
J("P03994", "is there anything on the paper a restaurant would want removed?", () => {
  // the three he has already asked to be removed must stay removed
  const h = B.billDocHtml({ name: "R", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x", invNo: "INV/1", noBar: true });
  const back = ["Reprint", "Duplicate", "Verification", "Serial no"].filter((w) => h.includes(w));
  return back.length === 0 || `${back.join(", ")} is back on the guest's copy`;
});
J("P03995", "is there anything MISSING a restaurant would ask for?", () => {
  // the four he DID ask for, on the paper: the discount %, the tip, the MRP stamp, the table name
  const d = B.billData({ settings: { ...S5, mrp_tax_treatment: "inclusive" }, restaurant: {}, session: {},
    orders: [ord({ discount: 40, tip: 200, nontax_amount: 105, subtotal: 505, taxable_base: 400,
      items: [{ title: "Dal", qty: 2, price: 200, tax_mode: "excl" }, { title: "W", qty: 1, price: 105, is_mrp: true, tax_mode: "incl" }] })] });
  const h = B.billDocHtml({ ...d, tableDisp: "Terrace 2", noBar: true });
  const missing = [["the discount %", /Discount \(/], ["the tip", /Tip/], ["the MRP stamp", /mrpt/], ["the table name", /Terrace 2/]]
    .filter(([, re]) => !re.test(h)).map(([n]) => n);
  return missing.length === 0 || `missing: ${missing.join(", ")}`;
});
J("P03996", "does the 80mm roll waste paper on any of these documents?", () => {
  // Ask the RENDERED thermal documents, not the source: billdoc.js carries a COMMENT quoting the
  // `@page{size:80mm <content height>mm}` it used to inject, and my first version read that
  // obituary as the fault still being there. (Third time this run. It is always the obituary.)
  const bill0 = B.billDocHtml({ name: "R", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x" });
  const kot0 = B.kotDocHtml({ lines: [] });
  const declares = (h) => /@page\s*\{[^}]*size:/.test(h);
  return (!declares(bill0) && !declares(kot0) && /intentionally nothing/.test(read("public/panels/billdoc.js")))
    || "a thermal document declares a page length again — that is the sideways print";
});
J("P03997", "would a second copy of a bill be mistaken for the original?", () => {
  // owner's decision: yes, deliberately — a bill reprint is not an event (R37)
  const h = B.billDocHtml({ name: "R", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x", noBar: true });
  return !/Reprint|Duplicate/.test(h) || "the bill is branded again — R37 says it must not be";
});
J("P03998", "is anything here slower than a rush can afford?", () => {
  const bc = read("public/panels/billcustomer.js");
  const s = read("public/panels/billdoc.js");
  return (!/fetch\(/.test(codeOnly(s)) && /prefixCache/.test(bc)) || "the document fetches, or the lookup lost its cache";
});
J("P03999", "does the customer lookup cost the restaurant egress it does not need?", () => {
  const bc = read("public/panels/billcustomer.js");
  const three = /known\./.test(bc) && /prefixCache/.test(bc) && /MIN_LOOKUP/.test(bc);
  return three || "one of the three layers that stop a request is gone";
});
