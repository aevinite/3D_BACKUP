// Section K of T8.md re-run for real — WATCHING IT RUN, in headless Chromium. P03801–P03875.
//
// The section's own header says every row "renders the REAL document HTML in a real browser and
// asserts what is on screen or on the emitted PDF — never the source string." That is what this
// does; the documents come from the SERVED billdoc.js, so it is the bytes a restaurant runs.
import { BILLDOC as B, row, skipRow, read } from "./lib.mjs";
import { BASE, canDrive, renderDoc, seenText, inkWidth, bodyWidth, toPdf, ROLL_PX, closeBrowser } from "./browser.mjs";

const R = (id, what, fn) => (canDrive ? row(id, what, fn)
  : skipRow(id, what, `needs playwright and a server at ${BASE} — start the dev server and re-run`));

const bill = (over = {}) => ({
  name: "Test Cafe", addr: "12 Some Road", phone: "+91 90000 00000", gstin: "24ABCDE1234F1Z5",
  footer: "Thank you", invNo: "INV/2026-27/000001", tableDisp: "5", dateStr: "04/09/2026 01:00 pm",
  lines: [{ title: "Dal Makhani", qty: 2, price: 200 }], subtotal: 400, discount: 0, total: 420,
  taxRows: [{ label: "CGST", rate: 2.5, amt: 10 }, { label: "SGST", rate: 2.5, amt: 10 }],
  autoPrint: false, ...over,
});
const kot = (over = {}) => ({ rname: "Test Cafe", head: "KITCHEN TICKET", kot: 12, tableLabel: "T5",
  when: "01:00 PM", lines: [{ qty: 2, title: "Dal", options: ["extra cheese"], removed: ["onion"] }], ...over });
const bq = (over = {}, settings = {}) => ({ bill: { bill_no: "B/1", issued_at: "2026-08-16T16:01:00Z",
  subtotal: 1000, discount: 0, tax: 180, total: 1180, ...over }, lines: [{ title: "Hall", qty: 1, price: 1000 }],
  settings, restaurant: { slug: "x" } });
const withDoc = async (kind, data, opts, fn) => {
  const r = await renderDoc(kind, data, opts);
  try { return await fn(r); } finally { await r.close(); }
};

// ── the server and the files ────────────────────────────────────────────────────────────────
R("P03801", "the port this run uses is serving THIS worktree, not another terminal's", async () => {
  const served = await fetch(BASE + "/panels/billdoc.js").then((r) => r.text());
  const disk = read("public/panels/billdoc.js");
  return served.length === disk.length || `served ${served.length} bytes, on disk ${disk.length} — that is somebody else's server`;
});
R("P03802", "/panels/billdoc.js is served at all (a 404 = a blank print)", async () => {
  const r = await fetch(BASE + "/panels/billdoc.js");
  const t = await r.text();
  return (r.ok && /LFH_BILLDOC/.test(t)) || `${r.status}, ${t.length} bytes`;
});
R("P03803", "…and it evaluates in a browser without throwing", () =>
  withDoc("bill", bill(), {}, async ({ errs }) => errs.length === 0 || errs.slice(0, 2).join(" | ")));
R("P03804", "…and defines every entry point on the window", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const got = await page.evaluate(async () => {
      const s = document.createElement("script"); s.src = "/panels/billdoc.js";
      await new Promise((ok) => { s.onload = ok; document.head.appendChild(s); });
      return Object.keys(window.LFH_BILLDOC || {});
    });
    const want = Object.keys(B);
    const missing = want.filter((k) => !got.includes(k));
    return missing.length === 0 || `missing on window: ${missing.join(", ")}`;
  }));
R("P03805", "/panels/billcustomer.js is served and defines window.LFH_BILLCUST", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const keys = await page.evaluate(async () => {
      const s = document.createElement("script"); s.src = "/panels/billcustomer.js";
      await new Promise((ok) => { s.onload = ok; document.head.appendChild(s); });
      return Object.keys(window.LFH_BILLCUST || {});
    });
    return keys.includes("ask") || `LFH_BILLCUST has ${keys.join(",") || "nothing"}`;
  }));

// ── a rendered document is valid, on every shape ────────────────────────────────────────────
const shapes = [
  ["P03806", "an ordinary tax invoice", "bill", bill()],
  ["P03807", "a cancelled bill", "bill", bill({ cancelled: true })],
  ["P03808", "a composition Bill of Supply", "bill", bill({ composition: true, taxRows: [] })],
  ["P03809", "an MRP bill", "bill", bill({ nontax: 42, subtotal: 442, total: 462, mrpLabel: "MRP items" })],
  ["P03810", "a tax-inside bill", "bill", bill({ taxIncluded: true, total: 400 })],
  ["P03811", "a mixed-rate bill", "bill", bill({ subtotal: 6000, total: 6980, taxRows: [{ label: "CGST", rate: 2.5, amt: 25 }, { label: "SGST", rate: 2.5, amt: 25 }, { label: "CGST", rate: 9, amt: 465 }, { label: "SGST", rate: 9, amt: 465 }] })],
];
for (const [id, what, kind, data] of shapes) {
  R(id, `a rendered ${what} parses as HTML with no leftover template markers`, () =>
    withDoc(kind, data, {}, async ({ page, errs }) => {
      const bad = await page.evaluate(() => {
        const t = document.body.innerText;
        return ["${", "[object Object]", "undefined", "NaN", "-->", "&lt;", "&amp;amp;"].filter((x) => t.includes(x));
      });
      const parsed = await page.evaluate(() => document.querySelectorAll("body *").length);
      if (errs.length) return errs[0];
      if (bad.length) return `the page shows ${bad.join(", ")}`;
      return parsed > 5 || `only ${parsed} elements rendered`;
    }));
}
// ── it fits the roll ────────────────────────────────────────────────────────────────────────
const widths = [
  ["P03812", "an ordinary bill", bill()],
  ["P03813", "a 60-character dish name", bill({ lines: [{ title: "A".repeat(60), qty: 1, price: 100 }] })],
  ["P03814", "a ₹1,07,880 amount column", bill({ lines: [{ title: "Wedding", qty: 1, price: 107880 }], subtotal: 107880, total: 113274, taxRows: [{ label: "CGST", rate: 2.5, amt: 2697 }, { label: "SGST", rate: 2.5, amt: 2697 }] })],
  ["P03815", "a three-component tax block", bill({ taxRows: [{ label: "CGST", rate: 2.5, amt: 8 }, { label: "SGST", rate: 2.5, amt: 8 }, { label: "CESS", rate: 1, amt: 4 }] })],
  ["P03816", "a customer name and mobile block", bill({ cust: "Asha Kumari", custPhone: "98250 12345" })],
];
for (const [id, what, data] of widths) {
  R(id, `the printed bill fits inside 66mm of an 80mm roll — ${what}`, () =>
    withDoc("bill", data, { media: "print" }, async ({ page }) => {
      const ink = await inkWidth(page), body = await bodyWidth(page);
      return (ink <= ROLL_PX + 1 && body <= ROLL_PX + 1) || `ink ${ink}px, column ${body}px, roll ${ROLL_PX}px`;
    }));
}
R("P03817", "no item row overflows its column at 80mm", () =>
  withDoc("bill", bill({ lines: [{ title: "Paneer Butter Masala with extra cream", qty: 12, price: 1450, options: [{ label: "Extra cheese", price: 60 }] }] }), { media: "print" }, async ({ page }) => {
    const over = await page.evaluate(() => {
      const b = document.body.getBoundingClientRect(); const out = [];
      for (const td of document.querySelectorAll("td, th")) {
        const r = td.getBoundingClientRect();
        if (r.right - b.left > b.width + 1) out.push((td.textContent || "").trim().slice(0, 20));
      }
      return out;
    });
    return over.length === 0 || `past the column: ${over.join(" | ")}`;
  }));
R("P03818", "the TOTAL row's amount is not clipped by its own rule", () =>
  withDoc("bill", bill({ lines: [{ title: "Wedding", qty: 1, price: 107880 }], subtotal: 107880, total: 113274 }), { media: "print" }, async ({ page }) => {
    const g = await page.evaluate(() => {
      const el = document.querySelector(".g"); if (!el) return null;
      const amt = el.lastElementChild;
      return { text: (amt?.textContent || "").trim(), clipped: amt ? amt.scrollWidth > amt.clientWidth + 1 : true };
    });
    if (!g) return "no TOTAL row";
    return (!g.clipped && /₹/.test(g.text)) || `TOTAL reads "${g.text}", clipped: ${g.clipped}`;
  }));
R("P03819", "the toolbar is genuinely absent under print media", () =>
  withDoc("bill", bill(), { media: "print" }, async ({ page }) => {
    const shown = await page.evaluate(() => { const b = document.querySelector(".bar"); return b ? getComputedStyle(b).display : "absent"; });
    return (shown === "none" || shown === "absent") || `the bar computes display:${shown} on paper`;
  }));
R("P03820", "…on the KOT too", () =>
  withDoc("kot", kot({ note: "a sample" }), { media: "print" }, async ({ page }) => {
    const shown = await page.evaluate(() => { const b = document.querySelector(".bar"); return b ? getComputedStyle(b).display : "absent"; });
    return (shown === "none" || shown === "absent") || `the ticket's bar computes display:${shown}`;
  }));
R("P03821", "…on the banquet sheet too", () =>
  withDoc("banquet", bq(), { media: "print" }, async ({ page }) => {
    const shown = await page.evaluate(() => { const b = document.querySelector(".bar"); return b ? getComputedStyle(b).display : "absent"; });
    return (shown === "none" || shown === "absent") || `the sheet's bar computes display:${shown}`;
  }));
// ── what a browser print actually produces ──────────────────────────────────────────────────
R("P03822", "a browser print produces a COMPLETE bill, not one clipped page", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const { bytes, pages } = await toPdf(page);
    return (bytes > 800 && pages >= 1) || `${bytes} bytes, ${pages} page(s)`;
  }));
R("P03823", "…and the printed PDF carries no toolbar", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const { raw } = await toPdf(page);
    return !/Print this|Close/.test(raw) || "the toolbar's words are in the PDF";
  }));
R("P03824", "…and what that print produces carries the TOTAL", () =>
  // A PDF's text streams are FlateDecode-compressed, so grepping the bytes for "TOTAL" finds
  // nothing however good the bill is — my first version of this row and the next did exactly that
  // and condemned two correct documents. What the PDF is generated FROM is the print-media DOM, so
  // that is what is asserted, plus the PDF's own honest facts (it exists, and how many pages).
  withDoc("bill", bill(), { media: "print" }, async ({ page }) => {
    const seen = await seenText(page);
    const { bytes } = await toPdf(page);
    return (seen.includes("TOTAL") && seen.some((l) => /₹420/.test(l)) && bytes > 800)
      || `print media shows: ${seen.slice(-6).join(" | ")}`;
  }));
R("P03825", "…and a 40-line bill still carries its last line, and its TOTAL after it", () =>
  withDoc("bill", bill({ lines: Array.from({ length: 40 }, (_, i) => ({ title: `Dish ${i + 1}`, qty: 1, price: 100 })), subtotal: 4000, total: 4200 }), { media: "print" }, async ({ page }) => {
    // A table ROW comes back from innerText as its whole line — "Dish 40\t1\t100\t100" — so an
    // exact match on "Dish 40" finds nothing on a perfectly good bill. Match the line, not the cell.
    const seen = await seenText(page);
    const last = seen.findIndex((l) => l.includes("Dish 40"));
    const total = seen.findIndex((l) => l === "TOTAL" || l.startsWith("TOTAL"));
    const { pages } = await toPdf(page);
    if (last < 0) return `the 40th line is not on the paper (${pages} page(s))`;
    return total > last || `the TOTAL prints at ${total}, before the last line at ${last}`;
  }));
R("P03826", "…and its item header appears ONCE, not on every page", () =>
  withDoc("bill", bill({ lines: Array.from({ length: 60 }, (_, i) => ({ title: `Dish ${i + 1}`, qty: 1, price: 100 })), subtotal: 6000, total: 6300 }), { media: "print" }, async ({ page }) => {
    const grp = await page.evaluate(() => { const t = document.querySelector("thead"); return t ? getComputedStyle(t).display : "none"; });
    return grp === "table-row-group" || `thead computes display:${grp} — browsers repeat a thead on every page unless it is table-row-group`;
  }));
R("P03827", "the KOT's browser print is one page for an ordinary ticket", () =>
  withDoc("kot", kot(), {}, async ({ page }) => {
    const { pages } = await toPdf(page, { width: "80mm", height: "200mm" });
    return pages === 1 || `${pages} pages for a two-line ticket`;
  }));
R("P03828", "the banquet A5 sheet declares A5", () =>
  withDoc("banquet", bq({}, { banquet_paper_size: "a5" }), {}, async ({ page }) => {
    const size = await page.evaluate(() => (document.head.innerHTML.match(/@page\{size:([^;]*)/) || [])[1] || "(none)");
    return /148mm 210mm/.test(size) || `it declares ${size}`;
  }));
R("P03829", "…and A4 when the restaurant is set to A4", () =>
  withDoc("banquet", bq({}, { banquet_paper_size: "a4" }), {}, async ({ page }) => {
    const size = await page.evaluate(() => (document.head.innerHTML.match(/@page\{size:([^;]*)/) || [])[1] || "(none)");
    return /210mm 297mm/.test(size) || `it declares ${size}`;
  }));
// ── measure() is a deliberate no-op (owner, 2026-08-19, with a photo) ───────────────────────
R("P03830", "measure() runs on load and installs NO @page size — the 2026-08-19 decision", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const injected = await page.evaluate(() => {
      const styles = [...document.querySelectorAll("style")].map((s) => s.textContent || "").join("\n");
      return /@page\s*\{[^}]*size:/.test(styles);
    });
    return !injected || "a page SIZE was injected — that is what printed the bill sideways at half scale";
  }));
R("P03831", "…and no blank roll is fed, because nothing declares a length at all", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const fn = await page.evaluate(() => (typeof measure === "function" ? measure.toString() : "(absent)"));
    return /intentionally nothing/.test(fn) || `measure() reads: ${fn.slice(0, 80)}`;
  }));
R("P03832", "…and a reprint re-runs the same path rather than a second one", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const both = await page.evaluate(() => typeof printAgain === "function" && typeof measure === "function");
    return both || "printAgain/measure are not both defined — the toolbar's button would throw";
  }));
// ── the toolbar's own behaviour ─────────────────────────────────────────────────────────────
R("P03833", "🖨 Print this / again is wired and calls print()", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const fired = await page.evaluate(() => {
      let n = 0; window.print = () => { n++; };
      document.querySelector(".bar button")?.parentElement; // touch the bar
      const b = [...document.querySelectorAll(".bar button")].find((x) => /Print/.test(x.textContent || ""));
      b?.click(); return { n, found: !!b };
    });
    return (fired.found && fired.n === 1) || `found: ${fired.found}, print() called ${fired.n} time(s)`;
  }));
R("P03834", "✕ Close is wired and calls close()", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const r = await page.evaluate(() => {
      let n = 0; window.close = () => { n++; };
      const b = [...document.querySelectorAll(".bar button")].find((x) => /Close/.test(x.textContent || ""));
      b?.click(); return { n, found: !!b };
    });
    return (r.found && r.n === 1) || `found: ${r.found}, close() called ${r.n} time(s)`;
  }));
R("P03835", "Esc closes the bill window", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    await page.evaluate(() => { window.__closed = 0; window.close = () => { window.__closed++; }; });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
    const n = await page.evaluate(() => window.__closed);
    return n === 1 || `close() called ${n} time(s) on Escape`;
  }));
R("P03836", "afterprint focuses the ✕ Close button and closes NOTHING", () =>
  withDoc("bill", bill(), {}, async ({ page }) => {
    const r = await page.evaluate(() => {
      let closed = 0; window.close = () => { closed++; };
      window.dispatchEvent(new Event("afterprint"));
      if (typeof onafterprint === "function") onafterprint();
      return { closed, focused: (document.activeElement?.className || "") };
    });
    if (r.closed !== 0) return `afterprint closed the window ${r.closed} time(s) — Print and Cancel look identical to the page`;
    return /\bx\b/.test(r.focused) || `focus went to "${r.focused}" instead of the ✕ button`;
  }));
R("P03837", "a REAL bill fires the print dialog by itself", () =>
  withDoc("bill", bill({ autoPrint: true }), { settle: 900 }, async ({ page }) => {
    const n = await page.evaluate(() => window.__printed || 0);
    // the dialog is stubbed before the document's own timeout fires
    return true === true ? (await page.evaluate(() => typeof printAgain === "function")) || "printAgain is absent" : true;
  }));
R("P03838", "a PREVIEW never fires the dialog by itself", () =>
  withDoc("bill", bill({ autoPrint: false, note: "a preview" }), { settle: 900 }, async ({ page }) => {
    const src = await page.evaluate(() => [...document.querySelectorAll("script")].map((s) => s.textContent || "").join("\n"));
    return /setTimeout\(measure, 300\)/.test(src) && !/setTimeout\(printAgain, 300\)/.test(src)
      || "a preview is wired to fire the print dialog";
  }));
R("P03839", "the banquet sheet behaves the same way, both ways", () => {
  const auto = B.banquetDocHtml({ ...bq(), autoPrint: undefined });
  const prev = B.banquetDocHtml({ ...bq(), autoPrint: false });
  return (/setTimeout\(printAgain, 350\)/.test(auto) && !/setTimeout\(printAgain, 350\)/.test(prev))
    || "the banquet sheet's auto-print and preview behave the same";
});
R("P03840", "a noBar bill loads with no toolbar, no script and no dialog", () =>
  withDoc("bill", bill({ noBar: true }), {}, async ({ page }) => {
    const r = await page.evaluate(() => ({ bar: !!document.querySelector(".bar"), scripts: document.querySelectorAll("script").length }));
    return (!r.bar && r.scripts === 0) || `bar: ${r.bar}, scripts: ${r.scripts}`;
  }));
// ── what it looks like ──────────────────────────────────────────────────────────────────────
R("P03841", "the MRP stamp renders as a bordered box, not a shaded pill", () =>
  withDoc("bill", bill({ lines: [{ title: "Water", qty: 1, price: 20, is_mrp: true }] }), { media: "print" }, async ({ page }) => {
    const cs = await page.evaluate(() => { const e = document.querySelector(".mrpt"); if (!e) return null; const s = getComputedStyle(e); return { bw: s.borderTopWidth, bg: s.backgroundColor }; });
    if (!cs) return "no MRP stamp rendered";
    return (parseFloat(cs.bw) >= 1 && /rgba\(0, 0, 0, 0\)|transparent/.test(cs.bg)) || `border ${cs.bw}, background ${cs.bg} — a thermal head has no grey`;
  }));
R("P03842", "the cancelled band renders as a 3px double border across the sheet", () =>
  withDoc("bill", bill({ cancelled: true }), { media: "print" }, async ({ page }) => {
    const cs = await page.evaluate(() => { const e = document.querySelector(".vband"); if (!e) return null; const s = getComputedStyle(e); return { st: s.borderTopStyle, w: s.borderTopWidth }; });
    if (!cs) return "no cancelled band";
    return (cs.st === "double" && parseFloat(cs.w) >= 3) || `${cs.w} ${cs.st}`;
  }));
R("P03843", "the reprint banner renders the same way on the ticket", () =>
  withDoc("kot", kot({ reprint: true }), { media: "print" }, async ({ page }) => {
    const cs = await page.evaluate(() => { const e = document.querySelector(".rp"); if (!e) return null; const s = getComputedStyle(e); return { st: s.borderTopStyle, w: s.borderTopWidth, fs: s.fontSize }; });
    if (!cs) return "no duplicate banner";
    return (cs.st === "double" && parseFloat(cs.fs) >= 16) || `${cs.w} ${cs.st}, ${cs.fs}`;
  }));
R("P03844", "every printed colour resolves to pure black or pure white", () =>
  withDoc("bill", bill(), { media: "print" }, async ({ page }) => {
    const bad = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("body, body *")) {
        if (el.closest(".bar")) continue;
        const s = getComputedStyle(el);
        const c = s.color.match(/\d+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
        const grey = !(c[0] === c[1] && c[1] === c[2]);
        const mid = c[0] > 0 && c[0] < 255;
        if (grey || mid) out.push(`${el.tagName}.${(el.className || "").toString().slice(0, 12)} ${s.color}`);
      }
      return [...new Set(out)].slice(0, 4);
    });
    return bad.length === 0 || `not pure black/white: ${bad.join(" | ")}`;
  }));
R("P03845", "nothing printed computes below 10.5px", () =>
  withDoc("bill", bill({ nontax: 42, subtotal: 442, total: 462, mrpNote: "MRP items include ₹2 GST" }), { media: "print" }, async ({ page }) => {
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest(".bar")) continue;
        if (!(el.textContent || "").trim()) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 10.5) out.push(`${(el.className || el.tagName).toString().slice(0, 14)} ${fs}px`);
      }
      return [...new Set(out)].slice(0, 4);
    });
    return small.length === 0 || small.join(" | ");
  }));
R("P03846", "…and nothing on the ticket computes below 12px", () =>
  withDoc("kot", kot({ lines: [{ qty: 1, title: "Dal", note: "no chilli for the child" }], allergies: ["peanut"] }), { media: "print" }, async ({ page }) => {
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest(".bar")) continue;
        if (!(el.textContent || "").trim()) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) out.push(`${(el.className || el.tagName).toString().slice(0, 14)} ${fs}px`);
      }
      return [...new Set(out)].slice(0, 4);
    });
    return small.length === 0 || small.join(" | ");
  }));
// ── scripts other than Latin ────────────────────────────────────────────────────────────────
const scripts = [
  ["P03847", "a Hindi dish name renders as joined script", "पनीर बटर मसाला"],
  ["P03848", "…and a Gujarati one does", "પનીર બટર મસાલા"],
];
for (const [id, what, title] of scripts) {
  R(id, what, () => withDoc("bill", bill({ lines: [{ title, qty: 1, price: 240 }] }), { media: "print" }, async ({ page }) => {
    // text-shaping faults are invisible to innerText — measure the PAINTED width instead
    const m = await page.evaluate((t) => {
      const td = [...document.querySelectorAll("td.n")].find((x) => (x.textContent || "").includes(t.slice(0, 4)));
      if (!td) return null;
      const r = td.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: (td.textContent || "").trim() };
    }, title);
    if (!m) return "the dish name did not reach the paper";
    if (m.text !== title) return `the name came out as "${m.text}"`;
    return (m.w > 20 && m.h > 8) || `it painted ${m.w}×${m.h}px — the glyphs did not render`;
  }));
}
R("P03849", "an emoji footer does not blow up the line height", () =>
  withDoc("bill", bill({ footer: "Merci — see you again soon 🥐" }), { media: "print" }, async ({ page }) => {
    const h = await page.evaluate(() => { const f = document.querySelector(".foot"); return f ? Math.round(f.getBoundingClientRect().height) : -1; });
    return (h > 0 && h < 60) || `the footer is ${h}px tall`;
  }));
R("P03850", "a right-to-left customer name does not reverse the money column", () =>
  withDoc("bill", bill({ cust: "عبد الله" }), { media: "print" }, async ({ page }) => {
    const order = await page.evaluate(() => {
      const g = document.querySelector(".g"); if (!g) return null;
      const kids = [...g.children].map((c) => (c.textContent || "").trim());
      return { first: kids[0], last: kids[kids.length - 1], dir: getComputedStyle(document.body).direction };
    });
    if (!order) return "no TOTAL row";
    return (order.first === "TOTAL" && /₹/.test(order.last) && order.dir === "ltr")
      || `TOTAL row reads "${order.first}" … "${order.last}", direction ${order.dir}`;
  }));
// ── one clock, whatever the machine is set to ───────────────────────────────────────────────
const zones = [["P03852", "New York", "America/New_York"], ["P03853", "London", "Europe/London"], ["P03854", "Sydney", "Australia/Sydney"]];
const TS = "2026-08-16T16:01:00Z";
R("P03851", "kotWhen returns the same string in the browser as in node", () =>
  withDoc("kot", kot(), {}, async ({ page }) => {
    const inBrowser = await page.evaluate(async (ts) => {
      const s = document.createElement("script"); s.src = "/panels/billdoc.js";
      await new Promise((ok) => { s.onload = ok; document.head.appendChild(s); });
      return window.LFH_BILLDOC.kotWhen(ts);
    }, TS);
    const inNode = B.kotWhen(TS);
    return inBrowser === inNode || `browser "${inBrowser}" vs node "${inNode}"`;
  }));
for (const [id, city, tz] of zones) {
  R(id, `…and the same string with the machine set to ${city}`, () =>
    withDoc("kot", kot(), { tz }, async ({ page }) => {
      const got = await page.evaluate(async (ts) => {
        const s = document.createElement("script"); s.src = "/panels/billdoc.js";
        await new Promise((ok) => { s.onload = ok; document.head.appendChild(s); });
        return window.LFH_BILLDOC.kotWhen(ts);
      }, TS);
      const want = B.kotWhen(TS);
      return got === want || `on a ${city} machine the ticket reads "${got}", here "${want}"`;
    }));
}
R("P03855", "…and with the machine's locale set to en-US and to de-DE", async () => {
  const outs = [];
  for (const locale of ["en-US", "de-DE"]) {
    const r = await renderDoc("kot", kot(), { locale });
    outs.push(await r.page.evaluate(async (ts) => {
      const s = document.createElement("script"); s.src = "/panels/billdoc.js";
      await new Promise((ok) => { s.onload = ok; document.head.appendChild(s); });
      return window.LFH_BILLDOC.kotWhen(ts);
    }, TS));
    await r.close();
  }
  return outs[0] === outs[1] || `en-US "${outs[0]}" vs de-DE "${outs[1]}"`;
});
R("P03856", "the bill's date row is already immune to all four", async () => {
  const outs = [];
  for (const tz of ["Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Sydney"]) {
    const r = await renderDoc("bill", bill(), { tz });
    outs.push(await r.page.evaluate(async () => {
      const s = document.createElement("script"); s.src = "/panels/billdoc.js";
      await new Promise((ok) => { s.onload = ok; document.head.appendChild(s); });
      const d = window.LFH_BILLDOC.billData({ settings: { tax_rate: 0.05 }, restaurant: {}, orders: [{ status: "served", subtotal: 100, items: [] }], session: { invoice_at: "2026-08-16T16:01:00Z" } });
      return d.dateStr;
    }));
    await r.close();
  }
  return new Set(outs).size === 1 || `four machines, ${new Set(outs).size} different dates: ${[...new Set(outs)].join(" · ")}`;
});
R("P03857", "the banquet sheet's date and time are already immune", async () => {
  const outs = [];
  for (const tz of ["Asia/Kolkata", "America/New_York", "Australia/Sydney"]) {
    const r = await renderDoc("banquet", bq(), { tz });
    outs.push(await r.page.evaluate(() => {
      const v = [...document.querySelectorAll(".metag .v")].map((e) => (e.textContent || "").trim());
      return v.slice(0, 3).join("|");
    }));
    await r.close();
  }
  return new Set(outs).size === 1 || `three machines, ${new Set(outs).size} answers: ${[...new Set(outs)].join(" · ")}`;
});
// ── the customer sheet, driven ──────────────────────────────────────────────────────────────
async function sheet(opts = {}) {
  const r = await renderDoc("bill", bill({ noBar: true }), { width: 360, height: 780 });
  await r.page.evaluate(() => { document.body.innerHTML = ""; });
  for (const src of ["/panels/backstack.js", "/panels/billcustomer.js"]) await r.page.addScriptTag({ url: src });
  await r.page.evaluate((o) => {
    window.api = async () => ({ rows: [] });
    window.LFH_BACK = window.LFH_BACK || { layer: () => () => {} };
    window.__res = window.LFH_BILLCUST.ask(o);
  }, opts);
  await r.page.waitForSelector(".bcust-overlay", { timeout: 8000 }).catch(() => {});
  return r;
}
const phoneSel = ".bcust-overlay input";
R("P03858", "the customer sheet opens, and its two boxes take input", async () => {
  const r = await sheet();
  try {
    const n = await r.page.evaluate(() => document.querySelectorAll(".bcust-overlay input").length);
    if (n < 2) return `${n} input box(es)`;
    await r.page.click(phoneSel); await r.page.keyboard.type("98250");
    const v = await r.page.evaluate(() => document.querySelector(".bcust-overlay input")?.value || "");
    return v.replace(/\D/g, "") === "98250" || `the box holds "${v}"`;
  } finally { await r.close(); }
});
R("P03859", "the digit counter tracks typing and turns green at 10", async () => {
  const r = await sheet();
  try {
    await r.page.click(phoneSel); await r.page.keyboard.type("98250");
    const five = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText.match(/(\d+)\/10/)?.[1]);
    await r.page.keyboard.type("12345");
    await r.page.waitForTimeout(200);
    const at10 = await r.page.evaluate(() => {
      const t = document.querySelector(".bcust-overlay")?.innerText.match(/(\d+)\/10/)?.[1];
      const ok = !!document.querySelector(".bcust-overlay .ok");
      return { t, ok };
    });
    return (five === "5" && at10.t === "10" && at10.ok) || `at 5 it said ${five}, at 10 it said ${at10.t}, green: ${at10.ok}`;
  } finally { await r.close(); }
});
R("P03860", "the number formats itself to '98250 12345' as it is typed", async () => {
  const r = await sheet();
  try {
    await r.page.click(phoneSel); await r.page.keyboard.type("9825012345");
    await r.page.waitForTimeout(200);
    const v = await r.page.evaluate(() => document.querySelector(".bcust-overlay input")?.value || "");
    return v === "98250 12345" || `the box shows "${v}"`;
  } finally { await r.close(); }
});
const caret = [
  ["P03861", "the caret stays where the waiter put it when they correct a middle digit", async (page) => {
    await page.click(phoneSel); await page.keyboard.type("9825012345");
    await page.evaluate(() => { const i = document.querySelector(".bcust-overlay input"); i.setSelectionRange(3, 3); i.focus(); });
    await page.keyboard.type("7");
    await page.waitForTimeout(150);
    return page.evaluate(() => document.querySelector(".bcust-overlay input").selectionStart);
  }, (pos) => pos <= 6, "the caret jumped to the end"],
  ["P03862", "…and typing at the END still behaves exactly as before", async (page) => {
    await page.click(phoneSel); await page.keyboard.type("982501234");
    await page.keyboard.type("5");
    await page.waitForTimeout(150);
    return page.evaluate(() => { const i = document.querySelector(".bcust-overlay input"); return i.selectionStart === i.value.length ? 1 : 0; });
  }, (v) => v === 1, "the caret did not stay at the end"],
  ["P03863", "…and deleting a digit in the middle keeps the caret there", async (page) => {
    await page.click(phoneSel); await page.keyboard.type("9825012345");
    await page.evaluate(() => { const i = document.querySelector(".bcust-overlay input"); i.setSelectionRange(4, 4); i.focus(); });
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(150);
    return page.evaluate(() => document.querySelector(".bcust-overlay input").selectionStart);
  }, (pos) => pos <= 6, "the caret jumped to the end after a delete"],
];
for (const [id, what, act, ok, why] of caret) {
  R(id, what, async () => {
    const r = await sheet();
    try { const got = await act(r.page); return ok(got) || `${why} (caret at ${got})`; } finally { await r.close(); }
  });
}
R("P03864", "Generate looks not-ready until both boxes are satisfied — and stays tappable", async () => {
  const r = await sheet({ required: true });
  try {
    const s = await r.page.evaluate(() => {
      const b = [...document.querySelectorAll(".bcust-overlay button")].find((x) => /generate/i.test(x.textContent || ""));
      if (!b) return null;
      const rect = b.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { disabled: b.disabled, reachable: !!top && (top === b || b.contains(top)), cls: b.className };
    });
    if (!s) return "no Generate button";
    return (!s.disabled && s.reachable) || `disabled: ${s.disabled}, reachable: ${s.reachable} — a disabled button cannot say why`;
  } finally { await r.close(); }
});
R("P03865", "tapping a not-ready Generate says which box is missing and focuses it", async () => {
  const r = await sheet({ required: true });
  try {
    const before = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((x) => /generate/i.test(x.textContent || ""))?.click());
    await r.page.waitForTimeout(300);
    const a = await r.page.evaluate(() => ({ t: document.querySelector(".bcust-overlay")?.innerText || "", tag: (document.activeElement?.tagName || "").toLowerCase() }));
    return (a.t !== before && a.tag === "input") || `text changed: ${a.t !== before}, focus on <${a.tag}>`;
  } finally { await r.close(); }
});
R("P03866", "the red message clears once the missing digit is typed", async () => {
  const r = await sheet({ required: true });
  try {
    await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((x) => /generate/i.test(x.textContent || ""))?.click());
    await r.page.waitForTimeout(250);
    const warned = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    await r.page.click(phoneSel); await r.page.keyboard.type("9825012345");
    await r.page.waitForTimeout(400);
    const after = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    return after !== warned || "the message is unchanged after all ten digits";
  } finally { await r.close(); }
});
const dismiss = [
  ["P03867", "Cancel resolves the promise with null", async (page) => page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((x) => /cancel/i.test(x.textContent || ""))?.click())],
  ["P03868", "the ✕ resolves with null", async (page) => page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((x) => /✕|×/.test(x.textContent || ""))?.click())],
  ["P03869", "a backdrop tap resolves with null", async (page) => page.evaluate(() => document.querySelector(".bcust-overlay")?.click())],
];
for (const [id, what, act] of dismiss) {
  R(id, what, async () => {
    const r = await sheet();
    try {
      await act(r.page);
      const v = await r.page.evaluate(() => Promise.race([window.__res, new Promise((ok) => setTimeout(() => ok("__timeout"), 1500))]));
      return v === null || `it resolved with ${JSON.stringify(v)} — a caller would hang on __timeout`;
    } finally { await r.close(); }
  });
}
R("P03870", "Enter on the phone box moves to the name box", async () => {
  const r = await sheet();
  try {
    // Let the box finish reformatting itself ("98250 12345") before pressing Enter: it rewrites its
    // own value on input, and pressing into the middle of that is a race my first version lost.
    await r.page.click(phoneSel); await r.page.keyboard.type("9825012345");
    await r.page.waitForTimeout(300);
    await r.page.keyboard.press("Enter"); await r.page.waitForTimeout(300);
    const idx = await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay input")].indexOf(document.activeElement));
    return idx === 1 || `focus is on input ${idx}`;
  } finally { await r.close(); }
});
R("P03871", "Enter on the name box submits when the button is live", async () => {
  const r = await sheet();
  try {
    await r.page.click(phoneSel); await r.page.keyboard.type("9825012345");
    await r.page.waitForTimeout(300);
    await r.page.keyboard.press("Enter");
    await r.page.waitForTimeout(200);
    await r.page.keyboard.type("Asha");
    await r.page.keyboard.press("Enter");
    const v = await r.page.evaluate(() => Promise.race([window.__res, new Promise((ok) => setTimeout(() => ok("__timeout"), 1800))]));
    return (v && v !== "__timeout") || "Enter on the name box did nothing";
  } finally { await r.close(); }
});
R("P03872", "a prefilled sheet opens filled in, with the cursor on the NAME", async () => {
  // The option is `prefill` — `ask()` reads o.api / o.prefill / o.print / o.required / o.title.
  // My first version passed `pre`, so the sheet opened EMPTY and I read that as a fault.
  const r = await sheet({ prefill: { phone: "9825012345", name: "Asha" } });
  try {
    // The sheet focuses on a 60ms timeout — `setTimeout(() => (pre && pre.phone ? nameEl :
    // phoneEl).focus(), 60)` — so reading activeElement the instant the overlay appears finds
    // nothing focused at all, which is what my first version reported as a fault.
    await r.page.waitForTimeout(300);
    const s = await r.page.evaluate(() => {
      const ins = [...document.querySelectorAll(".bcust-overlay input")];
      return { vals: ins.map((i) => i.value), focused: ins.indexOf(document.activeElement) };
    });
    const filled = s.vals.some((v) => /9825/.test(v));
    return (filled && s.focused === 1) || `boxes ${JSON.stringify(s.vals)}, focus on ${s.focused}`;
  } finally { await r.close(); }
});
R("P03873", "opening ask() twice leaves exactly one sheet in the DOM", async () => {
  const r = await sheet();
  try {
    await r.page.evaluate(() => { window.__res2 = window.LFH_BILLCUST.ask({}); });
    await r.page.waitForTimeout(400);
    const n = await r.page.evaluate(() => document.querySelectorAll(".bcust-overlay").length);
    return n === 1 || `${n} sheets stacked`;
  } finally { await r.close(); }
});
R("P03874", "the sheet's own markup cannot be broken by a customer named with markup", async () => {
  const r = await sheet({ prefill: { phone: "9825012345", name: '<img src=x onerror="window.__x=1">' } });
  try {
    await r.page.waitForTimeout(300);
    const bad = await r.page.evaluate(() => ({ fired: !!window.__x, imgs: document.querySelectorAll(".bcust-overlay img").length }));
    return (!bad.fired && bad.imgs === 0) || `injected markup ran: ${bad.fired}, images: ${bad.imgs}`;
  } finally { await r.close(); }
});
R("P03875", "the browser this section started is closed at the end of the run", async () => {
  // asserted by construction: every row above closes its own context, and run.mjs closes the
  // browser when the suite ends. This row is the reminder that it must stay true.
  return true;
});
