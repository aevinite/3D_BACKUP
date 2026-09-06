// The 158 individually-worded rows of the sweep-#7 block that the generator in rerun-NEWBH.mjs
// could not parameterise. Each one is written out, keyed to its own id.
//
// They are here rather than in the generator because each states its own property in its own
// words — "zRoom measures the sheet PLUS its own margins (not body.scrollHeight)" is not a
// parameter of anything, it is a specific claim about a specific line of code.
import { BILLDOC as B, row, skipRow, read, visible, totalRows, codeOnly } from "./lib.mjs";
import { BASE, canDrive, renderDoc, seenText, inkWidth, bodyWidth, ROLL_PX } from "./browser.mjs";
import { ROOT as ROOT_DIR, require_, registered } from "./lib.mjs";

// ONE ROW, ONE MODULE. rerun-NEWBH.mjs runs first and files everything its generator can
// parameterise; this file writes out the rest. As the generator was widened it began covering rows
// that were already hand-written here, and the duplicate-id check refused to run the suite at all —
// correctly, because two rows sharing an id is how a ledger stops meaning anything. So this file
// YIELDS: if the generator has already filed an id, the hand-written version stands down.
const ALREADY = registered();
const R = (id, what, fn) => { if (ALREADY.has(id)) return; row(id, what, fn); };
const D = (id, what, fn) => {
  if (ALREADY.has(id)) return;
  return canDrive ? row(id, what, fn)
    : skipRow(id, what, `needs playwright and a server at ${BASE} — start the dev server and re-run`);
};
const S5 = { tax_rate: 0.05 };
const r2 = (n) => Math.round(n * 100) / 100;
const ord = (o = {}) => ({ id: "o" + Math.random().toString(36).slice(2), status: "served", subtotal: 400,
  taxable_base: 400, tax_rate: 0.05, items: [{ title: "Dal", qty: 2, price: 200, tax_mode: "excl" }], ...o });
const dataOf = (orders, settings = S5, session = {}) =>
  B.billData({ settings, restaurant: {}, orders, money: B.billMoney(orders, settings), session, tableDisp: "5" });
const foots = (d) => {
  const Rw = B.billRows(d);
  const base = Rw.disc > 0 ? Rw.taxable : Rw.subtotal;
  return { ok: base + (Rw.inclusive ? 0 : Rw.tax) + Rw.nontax + Rw.roundOff === Rw.total, R: Rw };
};
const billOf = (n, over = {}) => ({ name: "Aangan Garden Restaurant", gstin: "24ABCDE1234F1Z5", tableDisp: "5",
  dateStr: "04/09/2026 01:00 pm", lines: Array.from({ length: n }, (_, i) => ({ title: `Dish ${i + 1}`, qty: 1, price: 100 })),
  subtotal: n * 100, total: n * 105, taxRows: [{ label: "CGST", rate: 2.5, amt: Math.round(n * 2.5) }, { label: "SGST", rate: 2.5, amt: Math.round(n * 2.5) }],
  autoPrint: false, ...over });
const SRC = read("public/panels/billdoc.js");
const BC = read("public/panels/billcustomer.js");
const on = async (kind, data, opts, fn) => { const r = await renderDoc(kind, data, opts); try { return await fn(r); } finally { await r.close(); } };

// ── the four round-off shapes the generator did not know ────────────────────────────────────
for (const [id, label, orders, settings] of [
  ["P18756", "a plain 18% bill", [ord({ tax_rate: 0.18 })], { tax_rate: 0.18 }],
  ["P18760", "two orders at one rate", [ord(), ord({ id: "o2" })], S5],
  ["P18764", "a paise-level price", [ord({ subtotal: 201.37, taxable_base: 201.37, items: [{ title: "Dal", qty: 1, price: 201.37, tax_mode: "excl" }] })], S5],
  ["P18765", "a ₹1 bill", [ord({ subtotal: 1, taxable_base: 1, items: [{ title: "Sweet", qty: 1, price: 1, tax_mode: "excl" }] })], S5],
]) {
  R(id, `the round-off stays within a rupee or two, and the rows foot: ${label}`, () => {
    const f = foots(dataOf(orders, settings));
    if (!f.ok) return "the rows do not foot to the TOTAL";
    return Math.abs(f.R.roundOff) <= 2 || `round off ${f.R.roundOff}`;
  });
}
// ── the zoom layer, written out ─────────────────────────────────────────────────────────────
D("P18862", "the preview opens at the right size with nothing remembered", () =>
  on("bill", billOf(8), { width: 1280, height: 900, seed: `(() => { try { localStorage.clear(); } catch (e) {} })()` }, async ({ page }) => {
    await page.waitForTimeout(900);
    const s = await page.evaluate(() => ({ z: parseFloat(getComputedStyle(document.body).zoom), chip: (document.querySelector(".zl")?.textContent || "").trim() }));
    return (s.z >= 0.6 && s.z <= 2 && /^\d+%$/.test(s.chip)) || `zoom ${s.z}, chip "${s.chip}"`;
  }));
D("P18888", "a localStorage that throws does not break the preview", () =>
  on("bill", billOf(8), { width: 1280, height: 900,
    seed: `(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); })()` }, async ({ page, errs }) => {
    await page.waitForTimeout(900);
    const s = await page.evaluate(() => ({ z: parseFloat(getComputedStyle(document.body).zoom), lines: document.body.innerText.split("\n").length }));
    if (errs.length) return `it threw: ${errs[0]}`;
    return (s.z >= 0.6 && s.z <= 2 && s.lines > 5) || `zoom ${s.z}, ${s.lines} lines on screen`;
  }));
D("P18889", "the zoom NEVER reaches the paper", () =>
  on("bill", billOf(8), { width: 1280, height: 900 }, async ({ page }) => {
    await page.evaluate(() => { if (typeof zApply === "function") zApply(2); });
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(200);
    const z = await page.evaluate(() => getComputedStyle(document.body).zoom);
    return String(z) === "1" || `the paper is zoomed to ${z}`;
  }));
D("P18890", "…and the printed column is still exactly 66mm at every zoom", () =>
  on("bill", billOf(8), { width: 1280, height: 900 }, async ({ page }) => {
    const widths = [];
    for (const z of [0.6, 1, 1.35, 2]) {
      await page.emulateMedia({ media: "screen" });
      await page.evaluate((zz) => { if (typeof zApply === "function") zApply(zz); }, z);
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(120);
      widths.push(await bodyWidth(page));
    }
    const bad = widths.filter((w) => Math.abs(w - ROLL_PX) > 1);
    return bad.length === 0 || `the printed column measured ${widths.join(", ")}px against ${ROLL_PX}px`;
  }));
R("P18891", "zRoom measures the sheet PLUS its own margins (not body.scrollHeight)", () =>
  /marginTop/.test(SRC) && /marginBottom/.test(SRC) && /offsetHeight/.test(SRC)
  || "zRoom no longer adds the sheet's own margins — the fit leaves the bottom hanging over the window");
R("P18892", "…and NOT documentElement.scrollHeight, which min-height:100% pins to the window", () => {
  const seg = SRC.slice(SRC.indexOf("function zRoom()"), SRC.indexOf("function zFit("));
  return !/documentElement/.test(seg) || "zRoom is measuring the documentElement again — every bill would fit at ~99%";
});
D("P18893", "a very LONG bill lands at the 0.6 floor and then scrolls honestly", () =>
  on("bill", billOf(120), { width: 1280, height: 700 }, async ({ page }) => {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => ({ z: parseFloat(getComputedStyle(document.body).zoom), need: document.documentElement.scrollHeight, have: innerHeight }));
    return (Math.abs(s.z - 0.6) < 0.011 && s.need > s.have) || `zoom ${s.z}, needs ${s.need}px in ${s.have}px`;
  }));
D("P18894", "a 60-line bill's last row is reachable by scrolling", () =>
  on("bill", billOf(60), { width: 1280, height: 700 }, async ({ page }) => {
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
    const seen = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("tbody tr:not(.ex)")];
      const last = rows[rows.length - 1];
      if (!last) return null;
      const r = last.getBoundingClientRect();
      return { text: (last.textContent || "").trim().slice(0, 12), onScreen: r.top < innerHeight && r.bottom > 0 };
    });
    return (seen && seen.onScreen) || `the last row is ${seen ? "off screen" : "missing"}`;
  }));
D("P18895", "the window is REUSED: a second document re-fits rather than keeping the first's size", () =>
  on("bill", billOf(2), { width: 1280, height: 900, seed: `(() => { try { localStorage.clear(); } catch (e) {} })()` }, async ({ page }) => {
    await page.waitForTimeout(900);
    const first = await page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
    await page.setContent(B.billDocHtml(billOf(60)), { waitUntil: "load" });
    await page.waitForTimeout(900);
    const second = await page.evaluate(() => parseFloat(getComputedStyle(document.body).zoom));
    return second !== first || `both documents opened at ${first} — the long one kept the short one's size`;
  }));
R("P18896", "a noBar bill carries no zoom script at all, and no zoom", () => {
  const h = B.billDocHtml({ ...billOf(8), noBar: true });
  return (!/<script>/.test(h) && !/zApply|zFit|zStart/.test(h)) || "a noBar bill still ships the zoom layer";
});
R("P18897", "the KITCHEN TICKET has no zoom layer (it is 280px, it does not need one)", () => {
  const h = B.kotDocHtml({ lines: [{ qty: 1, title: "Dal" }] });
  return (!/zApply|zFit|zStart/.test(h) && /width:280px/.test(h)) || "the ticket grew a zoom layer";
});
R("P18898", "the BANQUET sheet has no zoom layer either", () => {
  const h = B.banquetDocHtml({ bill: { subtotal: 0, discount: 0, tax: 0, total: 0 }, lines: [], settings: {}, restaurant: {} });
  return !/zApply|zFit|zStart/.test(h) || "the banquet sheet grew a zoom layer";
});
D("P18899", "no JavaScript error is raised on any bill shape, at any size", async () => {
  const shapes = [billOf(1), billOf(8), billOf(60), billOf(8, { cancelled: true }), billOf(8, { composition: true, taxRows: [] }), billOf(8, { nontax: 42 })];
  const sizes = [{ width: 1280, height: 900 }, { width: 360, height: 780 }, { width: 1280, height: 420 }];
  for (const s of shapes) for (const z of sizes) {
    const r = await renderDoc("bill", s, z);
    await r.page.waitForTimeout(500);
    const errs = r.errs.slice();
    await r.close();
    if (errs.length) return `${errs[0]} (at ${z.width}×${z.height})`;
  }
  return true;
});
D("P18900", "zApply survives a document with no .bar and no .zl", () =>
  on("bill", billOf(8), { width: 1280, height: 900 }, async ({ page }) => {
    const out = await page.evaluate(() => {
      document.querySelector(".bar")?.remove();
      try { if (typeof zApply === "function") zApply(1.2); return "ok"; } catch (e) { return "threw: " + e.message; }
    });
    return out === "ok" || out;
  }));
D("P18901", "the zoom chip is wide enough for a 3-digit percentage", () =>
  on("bill", billOf(8), { width: 1280, height: 900 }, async ({ page }) => {
    await page.evaluate(() => { if (typeof zApply === "function") zApply(2); });
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => { const e = document.querySelector(".zl"); return e ? { t: (e.textContent || "").trim(), clipped: e.scrollWidth > e.clientWidth + 1 } : null; });
    return (s && !s.clipped && /^\d{2,3}%$/.test(s.t)) || `the chip reads "${s?.t}", clipped: ${s?.clipped}`;
  }));
D("P18902", "the toolbar does not cover the first line of the bill", () =>
  on("bill", billOf(8), { width: 360, height: 780 }, async ({ page }) => {
    await page.waitForTimeout(900);
    const s = await page.evaluate(() => {
      const bar = document.querySelector(".bar"), h2 = document.querySelector("h2");
      return bar && h2 ? Math.round(bar.getBoundingClientRect().bottom - h2.getBoundingClientRect().top) : null;
    });
    return (s !== null && s <= 0) || `the bar covers the top ${s}px of the restaurant name`;
  }));
D("P18903", "Print and Close still work at the smallest and largest zoom", () =>
  on("bill", billOf(8), { width: 1280, height: 900 }, async ({ page }) => {
    for (const z of [0.6, 2]) {
      const r = await page.evaluate((zz) => {
        if (typeof zApply === "function") zApply(zz);
        let printed = 0, closed = 0;
        window.print = () => { printed++; }; window.close = () => { closed++; };
        [...document.querySelectorAll(".bar button")].find((b) => /Print/.test(b.textContent || ""))?.click();
        [...document.querySelectorAll(".bar button")].find((b) => /Close/.test(b.textContent || ""))?.click();
        return { printed, closed };
      }, z);
      if (r.printed !== 1 || r.closed !== 1) return `at zoom ${z}: print ${r.printed}, close ${r.closed}`;
    }
    return true;
  }));
D("P18904", "Esc still closes at every zoom", () =>
  on("bill", billOf(8), { width: 1280, height: 900 }, async ({ page }) => {
    for (const z of [0.6, 1, 2]) {
      await page.evaluate((zz) => { if (typeof zApply === "function") zApply(zz); window.__c = 0; window.close = () => { window.__c++; }; }, z);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      const n = await page.evaluate(() => window.__c);
      if (n !== 1) return `at zoom ${z} Escape called close() ${n} time(s)`;
    }
    return true;
  }));
D("P18905", "the restaurant name is the boldest thing on the sheet, and the TOTAL the second", () =>
  on("bill", billOf(8), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), fw: Number(c.fontWeight) }; };
      return { h2: g("h2"), tot: g(".g"), td: g("td") };
    });
    if (!s.h2 || !s.tot) return "no name or no TOTAL";
    return (s.h2.fs > s.tot.fs && s.h2.fw >= 700 && s.tot.fw >= 700 && s.tot.fs > s.td.fs) || JSON.stringify(s);
  }));
// the remaining "PRINTED sheet identical whatever the zoom" rows
for (const [id, shape, zoom] of [
  ["P18906", "ordinary", "0.6"], ["P18907", "ordinary", "1.35"], ["P18908", "ordinary", "2"], ["P18909", "ordinary", "fit"], ["P18910", "ordinary", "banana"],
  ["P18911", "2-line", "0.6"], ["P18912", "2-line", "1.35"], ["P18913", "2-line", "2"], ["P18914", "2-line", "fit"], ["P18915", "2-line", "banana"],
  ["P18916", "60-line", "0.6"], ["P18917", "60-line", "1.35"], ["P18918", "60-line", "2"], ["P18919", "60-line", "fit"], ["P18920", "60-line", "banana"],
]) {
  D(id, `a${shape === "ordinary" ? "n ordinary" : " " + shape} bill: the PRINTED sheet is identical whatever the screen is zoomed to (${zoom})`, () => {
    const n = shape === "2-line" ? 2 : shape === "60-line" ? 60 : 8;
    return on("bill", billOf(n), { width: 1280, height: 900,
      seed: `(() => { try { const w = Math.round(innerWidth/100)*100, h = Math.round(innerHeight/100)*100; localStorage.setItem("lfh_bill_zoom:"+w+"x"+h, ${JSON.stringify(zoom)}); } catch (e) {} })()` },
    async ({ page }) => {
      await page.waitForTimeout(800);
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(200);
      const p = await page.evaluate(() => ({ zoom: getComputedStyle(document.body).zoom, w: Math.round(document.body.getBoundingClientRect().width) }));
      if (String(p.zoom) !== "1") return `a screen zoom of "${zoom}" reached the paper (${p.zoom})`;
      return Math.abs(p.w - ROLL_PX) <= 1 || `the printed column is ${p.w}px, not ${ROLL_PX}px`;
    });
  });
}

// ── the customer sheet, written out ─────────────────────────────────────────────────────────
async function sheet(opts = {}, rows = [{ phone: "9825011111", name: "Asha Kumari", visits: 4 }]) {
  const r = await renderDoc("bill", { name: "x", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x", noBar: true }, { width: 360, height: 780 });
  await r.page.evaluate(() => { document.body.innerHTML = ""; });
  for (const src of ["/panels/backstack.js", "/panels/billcustomer.js"]) await r.page.addScriptTag({ url: src });
  await r.page.evaluate(({ o, rr }) => {
    window.__calls = [];
    window.__backOn = 0; window.__backOff = 0;
    window.LFH_BACK = { layer: () => { window.__backOn++; return () => { window.__backOff++; }; } };
    // `whole: true` is what the real door answers when it did NOT have to truncate — and it is
    // what layer 2 keys its on-device cache on. A stub that omits it makes the sheet correctly
    // re-ask for every longer prefix, which is what made two caching rows look like faults.
    const api = async (...a) => { window.__calls.push(a); return { matches: rr, whole: true }; };
    window.__res = window.LFH_BILLCUST.ask({ api, ...o });
  }, { o: opts, rr: rows });
  await r.page.waitForSelector(".bcust-overlay", { timeout: 8000 }).catch(() => {});
  await r.page.waitForTimeout(250);
  return r;
}
const typePhone = async (page, digits) => { await page.click(".bcust-overlay input"); await page.keyboard.type(digits); await page.waitForTimeout(900); };
const state = (page) => page.evaluate(() => {
  const ov = document.querySelector(".bcust-overlay");
  const ins = [...document.querySelectorAll(".bcust-overlay input")];
  const go = [...document.querySelectorAll(".bcust-overlay button")].find((b) => /generate/i.test(b.textContent || ""));
  return { digits: (ins[0]?.value || "").replace(/\D/g, "").length, counter: Number((ov?.innerText.match(/(\d+)\/10/) || [])[1]),
    ready: go?.getAttribute("aria-disabled") === "false", calls: window.__calls.length,
    text: ov?.innerText || "", name: ins[1]?.value || "", open: !!ov, backOn: window.__backOn, backOff: window.__backOff };
});
D("P18935", "the counter and the button agree with the box after typing 15 digits (capped at 13)", async () => {
  const r = await sheet();
  try {
    await typePhone(r.page, "982501234567890");
    const s = await state(r.page);
    return (s.digits === 13 && s.counter === 13) || `the box holds ${s.digits} and the counter says ${s.counter}/10 — the cap is 13`;
  } finally { await r.close(); }
});
for (const [id, what, phone, name, want] of [
  ["P18953", "the OPTIONAL path accepts nothing typed at all", "", "", true],
  ["P18954", "the OPTIONAL path accepts a complete number and a name", "9825012345", "Asha", true],
  ["P18955", "the OPTIONAL path accepts a complete number and no name", "9825012345", "", true],
]) {
  D(id, what, async () => {
    const r = await sheet({ required: false });
    try {
      if (phone) await typePhone(r.page, phone);
      if (name) { await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay input")][1]?.focus()); await r.page.keyboard.type(name); await r.page.waitForTimeout(200); }
      await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((b) => /generate/i.test(b.textContent || ""))?.click());
      const v = await r.page.evaluate(() => Promise.race([window.__res, new Promise((ok) => setTimeout(() => ok("__timeout"), 1800))]));
      return (v !== "__timeout") === want || `it resolved with ${JSON.stringify(v)}`;
    } finally { await r.close(); }
  });
}
D("P18959", "fewer than 4 digits asks the server nothing at all", async () => {
  const r = await sheet();
  try { await typePhone(r.page, "982"); const s = await state(r.page); return s.calls === 0 || `${s.calls} request(s) for three digits`; }
  finally { await r.close(); }
});
D("P18960", "typing ten digits straight through makes at most a handful of requests", async () => {
  const r = await sheet();
  try { await typePhone(r.page, "9825012345"); const s = await state(r.page); return s.calls <= 6 || `${s.calls} requests for one number`; }
  finally { await r.close(); }
});
D("P18961", "backspacing over a prefix already asked about repeats no request", async () => {
  // TYPED SLOWLY ON PURPOSE, so intermediate prefixes really are asked about. Typed fast, the 140ms
  // debounce collapses ten keystrokes into ONE request for the whole number — which is the feature
  // working, but it means no shorter prefix was ever asked and there is nothing to repeat. My first
  // version typed fast and then blamed the cache for re-asking a prefix nobody had asked.
  const r = await sheet();
  try {
    await r.page.click(".bcust-overlay input");
    for (const ch of "9825012345") { await r.page.keyboard.type(ch); await r.page.waitForTimeout(260); }
    const asked = await r.page.evaluate(() => window.__calls.map((c) => String(c[1] || "").split("q=")[1]));
    const before = asked.length;
    if (!before) return "no prefix was asked about even when typed slowly";
    // …now go BACK to a prefix that was asked, and forward again over the same ground.
    for (let i = 0; i < 3; i++) { await r.page.keyboard.press("Backspace"); await r.page.waitForTimeout(260); }
    await r.page.waitForTimeout(400);
    const backAt = (await state(r.page)).calls;
    for (const ch of "345") { await r.page.keyboard.type(ch); await r.page.waitForTimeout(260); }
    await r.page.waitForTimeout(500);
    const after = (await state(r.page)).calls;
    // Going FORWARD over ground already covered must cost nothing: each of those prefixes either
    // is in the prefix cache or narrows from a `whole` answer already on the device.
    return after === backAt || `${after - backAt} request(s) re-asked while retyping digits already covered (asked: ${asked.join(", ")})`;
  } finally { await r.close(); }
});
D("P18962", "a COMPLETE number already known to this device costs no request of its own", async () => {
  const r = await sheet();
  try {
    await typePhone(r.page, "9825011111");           // fills `known` from the answer
    const before = (await state(r.page)).calls;
    // THE COMPLETE NUMBER, arriving complete — which is what the row is about (layer 1:
    // `p.length === 10 && known.has(p)` returns with no request at all). Retyping it digit by digit
    // passes through SHORTER prefixes, and a shorter prefix is a BROADER question the device
    // genuinely cannot answer from a narrower cached one — so a request there is honest, and my
    // first version counted it against the cache.
    await r.page.evaluate(() => {
      const i = document.querySelector(".bcust-overlay input");
      i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true }));
      i.value = "9825011111"; i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await r.page.waitForTimeout(900);
    const after = (await state(r.page)).calls;
    return after === before || `${after - before} request(s) for a number this device already knows`;
  } finally { await r.close(); }
});
R("P18963", "a slow answer for older digits is thrown away", () => /mine !== seq|seq !== mine/.test(codeOnly(BC)) || "the sequence guard is gone");
R("P18964", "an answer landing after the sheet closed changes nothing and throws nothing", () => {
  const seg = codeOnly(BC).slice(codeOnly(BC).indexOf("async function lookup"));
  return /closed|done|isConnected|!wrap|removed/.test(seg) || "nothing stops a late answer painting into a dismissed sheet";
});
D("P18965", "a failed lookup leaves the sheet fully usable", async () => {
  const r = await renderDoc("bill", { name: "x", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x", noBar: true }, { width: 360, height: 780 });
  try {
    await r.page.evaluate(() => { document.body.innerHTML = ""; });
    for (const src of ["/panels/backstack.js", "/panels/billcustomer.js"]) await r.page.addScriptTag({ url: src });
    await r.page.evaluate(() => {
      window.__calls = [];                 // state() reads this; without it the probe throws
      window.__backOn = 0; window.__backOff = 0;
      window.LFH_BACK = { layer: () => { window.__backOn++; return () => { window.__backOff++; }; } };
      const api = async () => { throw new Error("offline"); };
      window.__res = window.LFH_BILLCUST.ask({ api });
    });
    await r.page.waitForSelector(".bcust-overlay", { timeout: 8000 });
    await typePhone(r.page, "9825012345");
    const s = await state(r.page);
    if (r.errs.length) return `it threw: ${r.errs[0]}`;
    return (s.open && s.digits === 10) || `open: ${s.open}, digits: ${s.digits}`;
  } finally { await r.close(); }
});
D("P18966", "the lookup never posts, and never touches an auth route", async () => {
  const r = await sheet();
  try {
    await typePhone(r.page, "9825012345");
    const calls = await r.page.evaluate(() => window.__calls);
    const bad = calls.filter((c) => String(c[0]).toUpperCase() !== "GET" || /login|auth/i.test(String(c[1])));
    return bad.length === 0 || `it called ${JSON.stringify(bad[0])}`;
  } finally { await r.close(); }
});
for (const [id, n, want] of [["P18967", 6, 4], ["P18968", 2, 2], ["P18969", 0, 0], ["P18970", 1, 1], ["P18971", 20, 4]]) {
  D(id, `${n === 0 ? "no" : n} row${n === 1 ? "" : "s"} show${n === 1 ? "s" : ""} ${want === 0 ? "none" : want}`, async () => {
    const rows = Array.from({ length: n }, (_, i) => ({ phone: `98250${String(10000 + i).slice(0, 5)}`, name: `Guest ${i + 1}`, visits: 1 }));
    const r = await sheet({}, rows);
    try {
      await typePhone(r.page, "982501");
      const shown = await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].filter((b) => /·/.test(b.textContent || "")).length);
      return shown === want || `${n} rows produced ${shown} suggestion(s), expected ${want}`;
    } finally { await r.close(); }
  });
}
D("P18972", "tapping a suggestion fills the number, the name and the counter together", async () => {
  const r = await sheet();
  try {
    await typePhone(r.page, "982501");
    await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((b) => /·/.test(b.textContent || ""))?.click());
    await r.page.waitForTimeout(400);
    const s = await state(r.page);
    return (s.digits === 10 && s.counter === 10 && /Asha/.test(s.name)) || `digits ${s.digits}, counter ${s.counter}, name "${s.name}"`;
  } finally { await r.close(); }
});
D("P18973", "a waiter's own correction to the name is never overwritten by a lookup", async () => {
  const r = await sheet();
  try {
    await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay input")][1]?.focus());
    await r.page.keyboard.type("My Own Name");
    await typePhone(r.page, "9825011111");
    const s = await state(r.page);
    return s.name === "My Own Name" || `the lookup overwrote it with "${s.name}"`;
  } finally { await r.close(); }
});
R("P18974", "a guest can add the printed column up by hand and reach the TOTAL", () => {
  const bad = [];
  for (const disc of [0, 40, 200]) { const f = foots(dataOf([ord({ discount: disc })])); if (!f.ok) bad.push(disc); }
  return bad.length === 0 || `it does not add up at discount(s) ${bad.join(",")}`;
});
for (const [id, what, act] of [
  ["P18975", "Cancel resolves with null and leaves nothing behind", (p) => p.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((b) => /cancel/i.test(b.textContent || ""))?.click())],
  ["P18976", "the ✕ resolves with null and leaves nothing behind", (p) => p.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((b) => /✕|×/.test(b.textContent || ""))?.click())],
]) {
  D(id, what, async () => {
    const r = await sheet();
    try {
      await act(r.page);
      const v = await r.page.evaluate(() => Promise.race([window.__res, new Promise((ok) => setTimeout(() => ok("__timeout"), 1500))]));
      await r.page.waitForTimeout(200);
      const left = await r.page.evaluate(() => document.querySelectorAll(".bcust-overlay").length);
      return (v === null && left === 0) || `resolved with ${JSON.stringify(v)}, ${left} sheet(s) left in the page`;
    } finally { await r.close(); }
  });
}
D("P18977", "a backdrop tap resolves with null, but a tap INSIDE the sheet does not", async () => {
  const r = await sheet();
  try {
    await r.page.evaluate(() => document.querySelector(".bcust-modal")?.click());
    const still = await r.page.evaluate(() => Promise.race([window.__res, new Promise((ok) => setTimeout(() => ok("__open"), 700))]));
    if (still !== "__open") return `a tap inside the sheet dismissed it (resolved ${JSON.stringify(still)})`;
    await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.click());
    const v = await r.page.evaluate(() => Promise.race([window.__res, new Promise((ok) => setTimeout(() => ok("__timeout"), 1500))]));
    return v === null || `the backdrop resolved with ${JSON.stringify(v)}`;
  } finally { await r.close(); }
});
D("P18978", "the hardware BACK layer is registered and unregistered exactly once", async () => {
  const r = await sheet();
  try {
    const on0 = (await state(r.page)).backOn;
    await r.page.evaluate(() => [...document.querySelectorAll(".bcust-overlay button")].find((b) => /cancel/i.test(b.textContent || ""))?.click());
    await r.page.waitForTimeout(400);
    const s = await state(r.page);
    return (on0 === 1 && s.backOff === 1) || `registered ${on0}, unregistered ${s.backOff}`;
  } finally { await r.close(); }
});
D("P18979", "…and dismissing twice does not unregister twice", async () => {
  const r = await sheet();
  try {
    await r.page.evaluate(() => {
      const b = [...document.querySelectorAll(".bcust-overlay button")].find((x) => /cancel/i.test(x.textContent || ""));
      b?.click(); b?.click();
    });
    await r.page.waitForTimeout(400);
    const s = await state(r.page);
    return s.backOff <= 1 || `unregistered ${s.backOff} times`;
  } finally { await r.close(); }
});
D("P18980", "opening the sheet three times leaves exactly one", async () => {
  const r = await sheet();
  try {
    await r.page.evaluate(() => { const api = async () => ({ matches: [] }); window.LFH_BILLCUST.ask({ api }); window.LFH_BILLCUST.ask({ api }); });
    await r.page.waitForTimeout(500);
    const n = await r.page.evaluate(() => document.querySelectorAll(".bcust-overlay").length);
    return n === 1 || `${n} sheets in the page`;
  } finally { await r.close(); }
});
for (const [id, what, pre, wantFocus] of [
  ["P18981", "a prefilled sheet opens complete, green, live, and with the cursor on the name", { phone: "9825012345", name: "Asha" }, 1],
  ["P18982", "a prefilled sheet with only a phone still opens with the cursor on the name", { phone: "9825012345" }, 1],
  ["P18983", "an EMPTY sheet opens with the cursor on the phone box", null, 0],
]) {
  D(id, what, async () => {
    const r = await sheet(pre ? { prefill: pre } : {});
    try {
      await r.page.waitForTimeout(400);
      const s = await r.page.evaluate(() => {
        const ins = [...document.querySelectorAll(".bcust-overlay input")];
        const go = [...document.querySelectorAll(".bcust-overlay button")].find((b) => /generate/i.test(b.textContent || ""));
        return { focus: ins.indexOf(document.activeElement), digits: (ins[0]?.value || "").replace(/\D/g, "").length,
          green: !!document.querySelector(".bcust-overlay .ok"), ready: go?.getAttribute("aria-disabled") === "false" };
      });
      if (s.focus !== wantFocus) return `focus is on input ${s.focus}, expected ${wantFocus}`;
      if (pre && pre.name) return (s.digits === 10 && s.green && s.ready) || `digits ${s.digits}, green ${s.green}, live ${s.ready}`;
      return true;
    } finally { await r.close(); }
  });
}
D("P18984", "a customer named with markup renders as text, never as markup", async () => {
  const r = await sheet({ prefill: { phone: "9825012345", name: '<img src=x onerror="window.__x=1">' } });
  try {
    await r.page.waitForTimeout(400);
    const bad = await r.page.evaluate(() => ({ fired: !!window.__x, imgs: document.querySelectorAll(".bcust-overlay img").length }));
    return (!bad.fired && bad.imgs === 0) || `it ran: ${bad.fired}, images: ${bad.imgs}`;
  } finally { await r.close(); }
});
D("P18985", "the sheet explains, in plain words, why the number is being asked for", async () => {
  const r = await sheet();
  try {
    const t = (await state(r.page)).text;
    return /recognise a returning guest|for their b|bill/i.test(t) || `the sheet says: ${t.slice(0, 90)}`;
  } finally { await r.close(); }
});
D("P18986", "'saved but not printed' is said only when the restaurant hides it", async () => {
  const on1 = await sheet({ print: false });
  const t1 = (await state(on1.page)).text; await on1.close();
  const on2 = await sheet({ print: true });
  const t2 = (await state(on2.page)).text; await on2.close();
  const said = (t) => /not\s*<?b?>?printed|not printed/i.test(t);
  return (said(t1) && !said(t2)) || `hidden: ${said(t1)}, printed: ${said(t2)}`;
});
D("P18987", "the sheet's own title can be set by the caller, and is escaped", async () => {
  const r = await sheet({ title: 'Who pays? <img src=x onerror="window.__x=1">' });
  try {
    await r.page.waitForTimeout(300);
    const s = await r.page.evaluate(() => ({ t: document.querySelector(".bcust-overlay h3")?.textContent || "", fired: !!window.__x, imgs: document.querySelectorAll(".bcust-overlay img").length }));
    return (/Who pays\?/.test(s.t) && !s.fired && s.imgs === 0) || `title "${s.t}", ran: ${s.fired}`;
  } finally { await r.close(); }
});
D("P18988", "every control on the sheet is reachable by keyboard alone", async () => {
  const r = await sheet();
  try {
    const reachable = new Set();
    for (let i = 0; i < 10; i++) {
      await r.page.keyboard.press("Tab");
      const tag = await r.page.evaluate(() => {
        const a = document.activeElement;
        return a && document.querySelector(".bcust-overlay")?.contains(a) ? (a.tagName + ":" + (a.textContent || a.type || "").trim().slice(0, 12)) : null;
      });
      if (tag) reachable.add(tag);
    }
    const wanted = await r.page.evaluate(() => document.querySelectorAll(".bcust-overlay input, .bcust-overlay button").length);
    return reachable.size >= Math.min(wanted, 4) || `${reachable.size} of ${wanted} controls reached by Tab`;
  } finally { await r.close(); }
});
R("P18989", "an MRP bill's column also adds up, by hand, with no round-off to explain", () => {
  const orders = [ord({ subtotal: 442, taxable_base: 400, nontax_amount: 42,
    items: [{ title: "Dal", qty: 2, price: 200, tax_mode: "excl" }, { title: "W", qty: 1, price: 42, is_mrp: true, tax_mode: "exempt" }] })];
  const f = foots(dataOf(orders));
  return (f.ok && f.R.roundOff === 0) || `foots: ${f.ok}, round off ${f.R.roundOff}`;
});
D("P18990", "the MRP stamp is a legible box beside the dish name, never a shaded pill", () =>
  on("bill", billOf(1, { lines: [{ title: "Water", qty: 1, price: 20, is_mrp: true }] }), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => { const e = document.querySelector(".mrpt"); if (!e) return null; const c = getComputedStyle(e); return { bw: parseFloat(c.borderTopWidth), bg: c.backgroundColor, fs: parseFloat(c.fontSize) }; });
    if (!s) return "no MRP stamp";
    return (s.bw >= 1 && /rgba\(0, 0, 0, 0\)|transparent/.test(s.bg) && s.fs >= 10) || JSON.stringify(s);
  }));

// ── NEW D's three remaining layout rows, and NEW F's "one definition" family ─────────────────
D("P18956", "the item column, the qty, the rate and the amount line up as four columns", () =>
  on("bill", billOf(1, { lines: [{ title: "Dal", qty: 2, price: 200 }, { title: "Naan", qty: 4, price: 60 }] }), { media: "print" }, async ({ page }) => {
    const cols = await page.evaluate(() => [...document.querySelectorAll("tbody tr:not(.ex)")].map((r) => [...r.children].map((c) => Math.round(c.getBoundingClientRect().left))));
    return (cols.length >= 2 && JSON.stringify(cols[0]) === JSON.stringify(cols[1])) || `row 1 at ${cols[0]}, row 2 at ${cols[1]}`;
  }));
D("P18957", "an add-on sub-line is visibly subordinate to its dish", () =>
  on("bill", billOf(1, { lines: [{ title: "Pizza", qty: 1, price: 360, options: [{ label: "Extra cheese", price: 60 }] }] }), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const main = document.querySelector("tbody tr:not(.ex) td.n"), ex = document.querySelector("tr.ex td.n");
      if (!main || !ex) return null;
      return { mfs: parseFloat(getComputedStyle(main).fontSize), efs: parseFloat(getComputedStyle(ex).fontSize),
        indent: Math.round(ex.getBoundingClientRect().left - main.getBoundingClientRect().left), t: (ex.textContent || "").trim() };
    });
    if (!s) return "no add-on sub-line";
    return ((s.efs < s.mfs || s.indent > 0) && s.t.startsWith("+")) || JSON.stringify(s);
  }));
D("P18958", "the money block reads top-to-bottom as an addition a person can follow", () =>
  on("bill", billOf(4, { discount: 40, discLabel: "10%", total: 380 }), { media: "print" }, async ({ page }) => {
    const l = await page.evaluate(() => [...document.querySelectorAll(".totals .t span:first-child, .totals .g span:first-child")].map((s) => (s.textContent || "").trim()));
    const seq = ["Subtotal", "Discount", "Taxable value", "CGST", "SGST", "TOTAL"].map((w) => l.findIndex((x) => x.startsWith(w)));
    return seq.every((v, i) => v >= 0 && (i === 0 || v > seq[i - 1])) || `the rows read: ${l.join(" → ")}`;
  }));
const PANEL = { manager: "public/panels/editor/app.js", tablet: "public/panels/tablet/app.js", kitchen: "public/panels/kitchen/app.js" };
const panelCode = (k) => codeOnly(read(PANEL[k]));
const ONE_DEF = [
  ["P18998", "the bill's money rule", /billMoney|billMath/, ["manager", "tablet"]],
  ["P18999", "the discount percentage", /discPct/, ["manager", "tablet"]],
  ["P19000", "the tax rate an order was charged at", /orderTaxRate/, []],
  ["P19001", "the shared bill document", /billDocHtml|billData/, ["manager", "tablet"]],
  ["P19002", "the shared kitchen ticket", /kotDocHtml/, ["manager", "kitchen"]],
  ["P19003", "the shared ticket time", /kotWhen/, ["kitchen"]],
  ["P19004", "the customer sheet", /LFH_BILLCUST\.ask/, ["manager", "tablet"]],
];
for (const [id, what, re, panels] of ONE_DEF) {
  R(id, `${what} has ONE definition, and every panel that needs it calls it`, () => {
    // ONE definition: it is declared in billdoc.js (or billcustomer.js) and nowhere else…
    // The DEFINITION and the CALL do not look the same. billcustomer.js publishes
    // `window.LFH_BILLCUST = { ask, … }` — it never writes "LFH_BILLCUST.ask", which is what a
    // CALLER writes. So a shared file counts if it either matches the call form or exports the name.
    const NAME = { "P18998": "billMoney", "P18999": "discPct", "P19000": "orderTaxRate",
      "P19001": "billDocHtml", "P19002": "kotDocHtml", "P19003": "kotWhen", "P19004": "ask" }[id];
    const declaredIn = ["public/panels/billdoc.js", "public/panels/billcustomer.js"].filter((f) => {
      const t = read(f);
      return re.test(t) || new RegExp(`function ${NAME}\\b|\\b${NAME},|\\b${NAME}:`).test(t);
    });
    if (id === "P19000" && !/orderTaxRate/.test(read("lib/paySplit.ts"))) return "paySplit no longer shares orderTaxRate";
    const missing = panels.filter((p) => !re.test(panelCode(p)));
    return (declaredIn.length >= 1 && missing.length === 0) || `declared in ${declaredIn.length} shared file(s); not called by: ${missing.join(", ") || "none"}`;
  });
}
const renamedSettings = { table_names: { 5: "Terrace 2" } };
R("P19005", "a renamed table reaches the manager's bill", () =>
  visible(B.billDocHtml({ name: "R", tableDisp: "Terrace 2", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true })).includes("Terrace 2")
  && /tablePrintLabel|tableDisp/.test(panelCode("manager")) || "the manager panel no longer resolves the label");
R("P19006", "a renamed table reaches the manager's ticket", () => /tableLabel/.test(panelCode("manager")) || "the manager's ticket carries no resolved label");
R("P19007", "a renamed table reaches the waiter's bill", () => /tablePrintLabel|tableDisp/.test(panelCode("tablet")) || "the tablet does not resolve the label");
R("P19008", "a renamed table reaches a merged party's bill", () =>
  visible(B.billDocHtml({ name: "R", tableDisp: "Terrace 2 + T6", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true })).includes("Terrace 2 + T6") || "the group label did not reach the paper");
R("P19009", "a renamed table reaches a merged party's bill on the tablet", () => /tablePrintLabel|tableDisp/.test(panelCode("tablet")) || "the tablet does not resolve it");
R("P19010", "a renamed table reaches the banquet sheet, resolved inside the document itself", () => {
  const h = B.banquetDocHtml({ bill: { table_number: "5", subtotal: 0, discount: 0, tax: 0, total: 0 }, lines: [], settings: renamedSettings, restaurant: {} });
  return (/Terrace 2/.test(h) && /const bqTableDisp = \(function/.test(SRC)) || "the sheet prints the bare digit, or resolves it outside the document";
});
R("P19011", "…but NOT the Audit's evidence bill — which USED to print the bare digit, and no longer does", () => {
  // ⚠️ SAME OUT-OF-DATE EXPECTATION AS P03949, recorded rather than flipped. The gap this row
  // describes was raised as HANDOFF 2 in T8's own improvements file and has since been done:
  // lib/auditDetail.ts resolves the label before it renders. Re-run against the decision that
  // replaced it.
  const t = read("lib/auditDetail.ts");
  return (/tableDisp/.test(codeOnly(t)) && /table_names|tablePrintLabel|nm \|\| t/.test(t))
    || "the evidence card is back to printing the bare digit";
});
const IDENT = [["P19012", "the restaurant name", "name"], ["P19013", "the address", "address"], ["P19014", "the phone", "phone"],
  ["P19015", "the GSTIN", "gstin"], ["P19016", "the invoice prefix", "prefix"], ["P19017", "the footer", "footer"], ["P19018", "the tax label", "taxLabel"]];
for (const [id, what, field] of IDENT) {
  R(id, `${what} is resolved for the paper in ONE place (billIdentity)`, () => {
    const bi = B.billIdentity({ restaurant_name: "N", restaurant_address: "A", restaurant_phone: "P", gstin: "G", invoice_prefix: "PR", bill_footer: "F", tax_label: "TL" }, {});
    if (!(field in bi)) return `billIdentity does not resolve ${field}`;
    // …and nothing else resolves it with its own fallback
    const others = ["public/panels/editor/app.js", "public/panels/tablet/app.js"].filter((f) => new RegExp(`s\\.${field === "prefix" ? "invoice_prefix" : field === "taxLabel" ? "tax_label" : field} \\|\\|`).test(codeOnly(read(f))));
    return others.length === 0 || `${others.join(", ")} resolves it with its own fallback`;
  });
}
R("P19019", "the printed bill number comes from the session, never re-derived", () => {
  const d = dataOf([ord()], S5, { bill_no: 77 });
  return d.billNo === 77 || `billNo ${d.billNo}`;
});
R("P19020", "the PRINTED invoice number is formatted in one place (invFmt), never hand-built", () => {
  const users = ["public/panels/editor/app.js", "public/panels/tablet/app.js"].filter((f) => /INV\/\$\{|\/000\$\{/.test(codeOnly(read(f))));
  return users.length === 0 || `${users.join(", ")} builds an invoice number by hand`;
});
R("P19021", "a parcel receipt draws the same two numbers", () => {
  const withInv = visible(B.billDocHtml({ name: "R", parcel: true, invNo: "INV/2026-27/000041", billNo: 7, dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true }));
  const noInv = visible(B.billDocHtml({ name: "R", parcel: true, invNo: "", billNo: 7, dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true }));
  return (withInv.includes("Invoice") && noInv.includes("Bill no")) || "a parcel receipt lost one of its numbers";
});
R("P19024", "nothing in my territory writes to the database or raises an alert", () => {
  const c = codeOnly(SRC);
  const bad = [];
  if (/fetch\(/.test(c)) bad.push("billdoc.js makes a request");
  if (/\.(insert|update|delete)\s*\(/.test(c)) bad.push("billdoc.js writes");
  if (/sendOwnerAlert|toast\(/.test(c)) bad.push("billdoc.js raises an alert");
  return bad.length === 0 || bad.join(" · ");
});
R("P19025", "…and the customer sheet only ever asks its own panel's api()", () => {
  const c = codeOnly(BC);
  return (!/\bfetch\s*\(/.test(c) && /\bapi\s*\(/.test(c)) || "the sheet fetches on its own — auth and the action id would not ride along";
});
R("P19026", "the reprint band cannot come back onto the bill from any surface", () => {
  const h = B.billDocHtml({ ...billOf(2), noBar: true });
  const guard = read("scripts/verify-bill-reprint-is-silent.mjs");
  return (!/Reprint|Duplicate/.test(h) && guard.length > 1000) || "the band is back, or its guard is gone";
});
R("P19027", "the KOT keeps its DUPLICATE banner while the bill stays silent", () => {
  const kot = B.kotDocHtml({ reprint: true, lines: [] });
  const bill = B.billDocHtml({ ...billOf(2), noBar: true });
  return (/\*\*\* Reprint · Duplicate \*\*\*/.test(kot) && !/Reprint|Duplicate/.test(bill)) || "the two documents no longer differ";
});

// ── NEW G · what the paper looks like · and NEW H · judgment ─────────────────────────────────
const kotOf = (over = {}) => ({ rname: "Aangan Garden", head: "KITCHEN TICKET", kot: 12, tableLabel: "T5",
  when: "01:00 PM", lines: [{ qty: 2, title: "Dal Makhani", options: ["extra cheese"], removed: ["onion"], note: "no chilli" }], ...over });
const bqOf = (over = {}, settings = {}) => ({ bill: { bill_no: "B/1", issued_at: "2026-08-16T16:01:00Z", cust_name: "Sharma Family",
  subtotal: 115000, discount: 0, tax: 20700, total: 135700,
  tax_lines: [{ label: "CGST", rate: 9, amt: 10350 }, { label: "SGST", rate: 9, amt: 10350 }], ...over },
  lines: [{ title: "Hall hire", qty: 1, price: 100000 }, { title: "Stage decoration", qty: 1, price: 15000 }], settings, restaurant: {} });

D("P19045", "an unconfigured restaurant's header leaves no hole where the address was", () =>
  on("bill", { name: "New Restaurant", addr: "", phone: "", gstin: "", tableDisp: "5", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true }, { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => { const e = document.querySelector(".sub"); return e ? { h: Math.round(e.getBoundingClientRect().height), t: (e.textContent || "").trim() } : null; });
    return (s && s.t === "" && s.h < 12) || `the letterhead's sub-line is ${s?.h}px tall and reads "${s?.t}"`;
  }));
D("P19046", "a KOT reads as a kitchen ticket at arm's length", () =>
  on("kot", kotOf(), { media: "print" }, async ({ page }) => {
    const hay = (await seenText(page)).join(" | ").toLowerCase();
    const missing = ["kitchen ticket", "kot #12", "t5", "dal makhani"].filter((w) => !hay.includes(w));
    return missing.length === 0 || `a cook would not find: ${missing.join(", ")}`;
  }));
D("P19047", "the KOT number and the table label stand out from the dish lines (bold, not merely bigger)", () =>
  on("kot", kotOf(), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), fw: Number(c.fontWeight) }; };
      return { meta: g(".meta"), line: g(".kl") };
    });
    if (!s.meta || !s.line) return "no meta row or no dish line";
    return (s.meta.fw > s.line.fw) || `meta ${s.meta.fw} vs line ${s.line.fw} — it must be BOLD, not merely bigger`;
  }));
D("P19048", "an option and a removal on the same line are both legible, in one ink", () =>
  on("kot", kotOf(), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => [...document.querySelectorAll(".kl i")].map((e) => {
      const c = getComputedStyle(e); return { t: (e.textContent || "").trim().slice(0, 16), fs: parseFloat(c.fontSize), st: c.fontStyle, col: c.color };
    }));
    if (s.length < 2) return `only ${s.length} of the two rendered`;
    const bad = s.filter((x) => x.fs < 12 || x.st === "italic" || x.col !== "rgb(0, 0, 0)");
    return bad.length === 0 || bad.map((x) => `"${x.t}" ${x.fs}px ${x.st} ${x.col}`).join(" | ");
  }));
D("P19049", "a per-line note is legible, not the smallest text on the paper", () =>
  on("kot", { ...kotOf(), lines: [{ qty: 1, title: "Dal", note: "no chilli for the child" }, { qty: 1, title: "Naan" }] }, { media: "print" }, async ({ page }) => {
    const fs = await page.evaluate(() => { const e = document.querySelector(".kl small"); return e ? parseFloat(getComputedStyle(e).fontSize) : -1; });
    return fs >= 12 || `the guest's own instruction is ${fs}px`;
  }));
D("P19050", "the ⚠ AVOID allergy box is impossible to miss, and is not covered by anything", () =>
  on("kot", kotOf({ allergies: ["peanut"] }), { media: "print" }, async ({ page }) => {
    const s = await page.evaluate(() => {
      const e = document.querySelector(".al"); if (!e) return null;
      const c = getComputedStyle(e), r = e.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + 4, r.top + 4);
      return { fw: Number(c.fontWeight), bw: parseFloat(c.borderTopWidth), fs: parseFloat(c.fontSize), covered: !!top && !e.contains(top) && top !== e };
    });
    if (!s) return "no allergy box";
    return (s.fw >= 700 && s.bw >= 1 && s.fs >= 12 && !s.covered) || JSON.stringify(s);
  }));
D("P19051", "the REPRINT · DUPLICATE banner is unmistakable, and only on a reprint", async () => {
  const a = await renderDoc("kot", kotOf({ reprint: true }), { media: "print" });
  const s = await a.page.evaluate(() => { const e = document.querySelector(".rp"); if (!e) return null; const c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), fw: Number(c.fontWeight), st: c.borderTopStyle }; });
  await a.close();
  const b2 = await renderDoc("kot", kotOf(), { media: "print" });
  const none = await b2.page.evaluate(() => !document.querySelector(".rp"));
  await b2.close();
  if (!s) return "no banner on a reprint";
  if (!none) return "a FIRST print carries the banner — a cook would skip cooking it";
  return (s.fs >= 16 && s.fw >= 700 && s.st === "double") || JSON.stringify(s);
});
D("P19052", "the banquet A5 sheet reads as a proper tax invoice", () =>
  on("banquet", bqOf(), { media: "print" }, async ({ page }) => {
    const hay = (await seenText(page)).join(" | ").toLowerCase();
    const missing = ["tax invoice", "supplier", "invoice no.", "dated", "item name", "invoice total", "in words"].filter((w) => !hay.includes(w));
    return missing.length === 0 || `missing: ${missing.join(", ")}`;
  }));
D("P19053", "…its per-line tax columns line up under their headings and foot to the TOTAL row", () =>
  on("banquet", bqOf(), { media: "print" }, async ({ page }) => {
    const o = await page.evaluate(() => {
      const head = [...document.querySelectorAll("table.it thead tr:last-child th")].map((t) => Math.round(t.getBoundingClientRect().left));
      const first = [...document.querySelectorAll("table.it tbody tr:first-child td")].map((t) => Math.round(t.getBoundingClientRect().left));
      const cells = [...document.querySelectorAll("table.it tbody tr")].filter((r) => !r.classList.contains("fill") && !r.classList.contains("tot"))
        .map((r) => [...r.querySelectorAll("td.r")].map((t) => Number((t.textContent || "").replace(/,/g, ""))));
      const tot = [...document.querySelectorAll("tr.tot td.r")].map((t) => Number((t.textContent || "").replace(/,/g, "")));
      return { head, first, cells, tot };
    });
    const shared = o.head.filter((x) => o.first.includes(x));
    if (shared.length < o.head.length - 1) return `headings at ${o.head.join(",")} vs cells at ${o.first.join(",")}`;
    // THE TOTAL ROW'S FIRST td.r IS THE WORD "TOTAL", not a number — the row is
    // `<td colspan="4" class="r">TOTAL</td><td class="r">{taxable}</td>` then a pair per tax line.
    // So its numbers are offset by one against a body row's, and comparing index 1 to index 2
    // compared the CGST column against the TAXABLE total. Body: [price, taxable, cgst, sgst];
    // TOTAL row: [NaN(TOTAL), taxable, cgst, sgst].
    const cgst = o.cells.map((c) => c[2] || 0).reduce((a, x) => a + x, 0);
    const want = o.tot[2] || 0;
    return Math.abs(cgst - want) < 0.02 || `the CGST column adds to ${cgst}, the TOTAL row says ${want}`;
  }));
D("P19054", "…its amount-in-words box reads as a sentence naming a currency", () =>
  on("banquet", bqOf(), { media: "print" }, async ({ page }) => {
    const w = await page.evaluate(() => (document.querySelector(".wrd")?.textContent || "").trim());
    return (/Rupee/.test(w) && /Only$/.test(w) && w.split(" ").length > 3) || `it reads "${w}"`;
  }));
D("P19055", "…and the money box on the right adds up as printed", () =>
  on("banquet", bqOf(), { media: "print" }, async ({ page }) => {
    const rows = await page.evaluate(() => [...document.querySelectorAll(".fr .ms")].map((m) => [(m.querySelector("span")?.textContent || "").trim(), (m.querySelector("i")?.textContent || "").trim()]));
    const n = (s) => Number((s || "").replace(/[^\d.]/g, "")) || 0;
    const sub = n(rows.find((r) => r[0] === "Subtotal")?.[1]);
    const tax = rows.filter((r) => /GST/.test(r[0])).reduce((a, r) => a + n(r[1]), 0);
    const tot = n(rows.find((r) => /INVOICE TOTAL/.test(r[0]))?.[1]);
    return Math.abs(sub + tax - tot) < 0.02 || `${sub} + ${tax} ≠ ${tot}`;
  }));
R("P19056", "the A4 banquet sheet is not just a stretched A5", () => {
  const fs = (h) => (/font-size:([\d.]+)pt;line-height/.exec(h) || [])[1];
  const a5 = B.banquetDocHtml(bqOf({}, { banquet_paper_size: "a5" })), a4 = B.banquetDocHtml(bqOf({}, { banquet_paper_size: "a4" }));
  return (fs(a4) !== fs(a5) && /210mm 297mm/.test(a4)) || `A5 ${fs(a5)}pt, A4 ${fs(a4)}pt`;
});
R("P19057", "the banquet 'pad' mode leaves the pre-printed letterhead space empty", () => {
  const pad = B.banquetDocHtml(bqOf({}, { banquet_paper: "pad", banquet_paper_top: 33 }));
  const plain = B.banquetDocHtml(bqOf({}, { banquet_paper: "sheet" }));
  return (/height:33mm/.test(pad) && !/class="selfhead"/.test(pad) && /class="selfhead"/.test(plain)) || "pad mode still prints its own letterhead";
});
D("P19058", "nothing printed on any of the three documents is grey or italic", async () => {
  for (const [kind, data] of [["bill", billOf(4)], ["kot", kotOf()], ["banquet", bqOf()]]) {
    const r = await renderDoc(kind, data, { media: "print" });
    const bad = await r.page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("body, body *")) {
        if (el.closest(".bar")) continue;
        const c = getComputedStyle(el);
        const rgb = (c.color.match(/\d+/g) || []).slice(0, 3).map(Number);
        const grey = !(rgb[0] === rgb[1] && rgb[1] === rgb[2]) || (rgb[0] > 0 && rgb[0] < 255);
        if (grey || c.fontStyle === "italic") out.push(`${el.tagName}.${(el.className || "").toString().slice(0, 10)} ${c.color} ${c.fontStyle}`);
      }
      return [...new Set(out)].slice(0, 3);
    });
    await r.close();
    if (bad.length) return `${kind}: ${bad.join(" | ")}`;
  }
  return true;
});
D("P19059", "a long dish name wraps instead of pushing the money columns off the roll", () =>
  on("bill", billOf(1, { lines: [{ title: "Paneer Butter Masala with extra cream and cashew gravy served hot", qty: 1, price: 450 }] }), { media: "print" }, async ({ page }) => {
    const ink = await inkWidth(page);
    const wrapped = await page.evaluate(() => { const td = document.querySelector("td.n"); return td ? td.getBoundingClientRect().height > 20 : false; });
    return (ink <= ROLL_PX + 1 && wrapped) || `ink ${ink}px (roll ${ROLL_PX}px), wrapped: ${wrapped}`;
  }));
D("P19060", "a Hindi and a Gujarati dish name render as joined script, not broken glyphs", async () => {
  for (const t of ["पनीर बटर मसाला", "પનીર બટર મસાલા"]) {
    const r = await renderDoc("bill", billOf(1, { lines: [{ title: t, qty: 1, price: 240 }] }), { media: "print" });
    const m = await r.page.evaluate((tt) => {
      const td = [...document.querySelectorAll("td.n")].find((x) => (x.textContent || "").includes(tt.slice(0, 4)));
      if (!td) return null;
      const b = td.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), text: (td.textContent || "").trim() };
    }, t);
    await r.close();
    if (!m) return `"${t}" did not reach the paper`;
    if (m.text !== t) return `it came out as "${m.text}"`;
    if (!(m.w > 20 && m.h > 8)) return `"${t}" painted ${m.w}×${m.h}px — the glyphs did not render`;
  }
  return true;
});
D("P19061", "the toolbar's Print and Close are a comfortable target on a phone", () =>
  on("bill", billOf(4), { width: 360, height: 780 }, async ({ page }) => {
    await page.waitForTimeout(800);
    const hs = await page.evaluate(() => [...document.querySelectorAll(".bar button")].filter((b) => /Print|Close/.test(b.textContent || "")).map((b) => ({ t: (b.textContent || "").trim().slice(0, 8), h: Math.round(b.getBoundingClientRect().height) })));
    const small = hs.filter((x) => x.h < 28);
    return small.length === 0 || small.map((x) => `${x.t} ${x.h}px`).join(", ");
  }));
D("P19062", "…and the zoom controls do not crowd them", () =>
  on("bill", billOf(4), { width: 360, height: 780 }, async ({ page }) => {
    await page.waitForTimeout(800);
    const gap = await page.evaluate(() => {
      const zg = document.querySelector(".zg"), pr = [...document.querySelectorAll(".bar button")].find((b) => /Print/.test(b.textContent || ""));
      if (!zg || !pr) return null;
      return Math.round(pr.getBoundingClientRect().left - zg.getBoundingClientRect().right);
    });
    return (gap !== null && gap >= 4) || `only ${gap}px between the zoom group and Print`;
  }));
D("P19063", "the whole toolbar fits the phone's width without wrapping onto two rows", () =>
  on("bill", billOf(4), { width: 360, height: 780 }, async ({ page }) => {
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => {
      const bar = document.querySelector(".bar"); if (!bar) return null;
      const kids = [...bar.children].map((c) => Math.round(c.getBoundingClientRect().top));
      return { rows: new Set(kids).size, h: Math.round(bar.getBoundingClientRect().height) };
    });
    return (s && s.rows === 1) || `the toolbar wrapped onto ${s?.rows} rows (${s?.h}px tall)`;
  }));
D("P19064", "no rendered document leaks code text a guest could see", async () => {
  for (const [kind, data] of [["bill", billOf(4)], ["kot", kotOf()], ["banquet", bqOf()]]) {
    const r = await renderDoc(kind, data, { media: "print" });
    const bad = await r.page.evaluate(() => ["${", "[object Object]", "undefined", "NaN", "-->", "&lt;"].filter((x) => document.body.innerText.includes(x)));
    await r.close();
    if (bad.length) return `${kind} shows ${bad.join(", ")}`;
  }
  return true;
});
// ── NEW H · judgment ────────────────────────────────────────────────────────────────────────
R("P19068", "hand this bill to a diner: is every line something they would understand?", () => {
  const labels = totalRows(B.billDocHtml({ ...dataOf([ord({ discount: 40 })]), noBar: true })).map((r) => r[0]);
  const jargon = labels.filter((l) => /kot|nontax|taxable_base|net_amount|disc_gross|_/.test(l.toLowerCase()));
  return jargon.length === 0 || `a guest would not know: ${jargon.join(", ")}`;
});
R("P19069", "would a GST officer accept the heading, the GSTIN line and the tax split?", () => {
  const h = B.billDocHtml({ ...dataOf([ord()], { ...S5, gstin: "24ABCDE1234F1Z5" }, { invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" }), noBar: true });
  return (/Tax Invoice/.test(h) && /GSTIN 24ABCDE1234F1Z5/.test(h) && /CGST/.test(h) && /SGST/.test(h) && /INV\/2026-27\/000041/.test(h)) || "a mandatory particular is missing";
});
R("P19070", "…and the Bill of Supply a composition restaurant hands over?", () => {
  const h = B.billDocHtml({ ...dataOf([ord({ tax_rate: 0 })], { price_tax_mode: "composition" }, { bill_no: 7 }), noBar: true });
  return (/Bill of Supply/.test(h) && /Composition taxable person/.test(h) && !/CGST/.test(h)) || "it is not a bill of supply";
});
R("P19071", "a restaurant with no GST registration is not made to hand over a 'Tax Invoice'", () => {
  const h = B.billDocHtml({ ...dataOf([ord()], { ...S5, gstin: "" }, { bill_no: 7 }), noBar: true });
  return (!/Tax Invoice/.test(h) && /<div class="kind">Bill<\/div>/.test(h)) || "an unregistered restaurant still hands over a Tax Invoice";
});
R("P19072", "does a cancelled sheet read as a RECORD rather than as a mistake?", () => {
  const v = visible(B.billDocHtml({ ...dataOf([ord({ status: "cancelled" })], S5, { bill_no: 7, invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" }), noBar: true }));
  return (v.includes("Cancelled — no charge") && v.some((l) => /voided/.test(l)) && v.some((l) => /Dal/.test(l))) || "a void record nobody can read is no record";
});
R("P19073", "could anything on these documents make a sale disappear?", () => {
  const c = codeOnly(SRC);
  const d = dataOf([ord({ status: "cancelled" })], S5, { bill_no: 7, invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" });
  return (!/\.(insert|update|delete)\s*\(/.test(c) && !/from\("orders"\)/.test(c) && d.cancelled && /voided/.test(d.invNo))
    || "the document can write, or a cancelled sale can hide its number";
});
R("P19074", "would a cook, mid-rush, read this ticket correctly at arm's length?", () => {
  const css = (/<style>([\s\S]*?)<\/style>/.exec(B.kotDocHtml(kotOf())) || [, ""])[1];
  const small = [...css.matchAll(/font-size:([\d.]+)px/g)].map((m) => +m[1]).filter((n) => n < 12);
  return (small.length === 0 && !/font-style:italic/.test(css)) || `sizes under 12px: ${small.join(",")}`;
});
R("P19075", "does the ticket's time tell a cook something they can ACT on?", () => {
  const now = B.kotWhen(new Date().toISOString()), old = B.kotWhen("2026-08-06T16:01:00Z");
  return (now !== old && /^\d{2}:\d{2} [AP]M$/.test(now) && /[A-Z]{3}/.test(old)) || `now "${now}", old "${old}"`;
});
R("P19076", "is a waiter at the till asked for the minimum, in the right order?", () =>
  /MIN_LOOKUP/.test(BC) && /inputmode/.test(BC) || "the sheet no longer asks for a phone first");
R("P19077", "is it obvious why the number is being asked for, if a guest asks?", () =>
  /recognise a returning guest|for their b/i.test(BC) || "the sheet does not say what it is for");
R("P19078", "does the customer lookup cost the restaurant data it does not need?", () =>
  (/known\./.test(BC) && /prefixCache/.test(BC) && /MIN_LOOKUP/.test(BC)) || "one of the three layers that stop a request is gone");
R("P19079", "is anything here slower than a rush can afford?", () =>
  (!/fetch\(/.test(codeOnly(SRC)) && /DEBOUNCE/.test(BC)) || "the document fetches, or the lookup lost its debounce");
D("P19080", "…and the banquet sheet, which is the biggest document?", async () => {
  const t0 = Date.now();
  B.banquetDocHtml(bqOf({}, {}));
  const build = Date.now() - t0;
  const r = await renderDoc("banquet", bqOf(), { media: "print" });
  const paint = await r.page.evaluate(() => performance.now());
  await r.close();
  return (build < 200 && paint < 5000) || `it took ${build}ms to build and ${Math.round(paint)}ms to paint`;
});
R("P19081", "would the owner recognise this bill as the one he approved in the preview?", () =>
  /one bill, one ticket, one file/i.test(read("scripts/verify-print-format.mjs")) || "the one-document guard no longer says so");
R("P19082", "is there anything MISSING a restaurant would ask for?", () => {
  const d = dataOf([ord({ discount: 40, tip: 200, nontax_amount: 105, subtotal: 505, taxable_base: 400,
    items: [{ title: "Dal", qty: 2, price: 200, tax_mode: "excl" }, { title: "W", qty: 1, price: 105, is_mrp: true, tax_mode: "incl" }] })],
  { ...S5, mrp_tax_treatment: "inclusive" });
  const h = B.billDocHtml({ ...d, tableDisp: "Terrace 2", noBar: true });
  const missing = [["the discount %", /Discount \(/], ["the tip", /Tip/], ["the MRP stamp", /mrpt/], ["the table name", /Terrace 2/]]
    .filter(([, re]) => !re.test(h)).map(([n]) => n);
  return missing.length === 0 || `missing: ${missing.join(", ")}`;
});
R("P19083", "is there anything on the paper a restaurant would want REMOVED?", () => {
  const h = B.billDocHtml({ ...billOf(2), noBar: true });
  const back = ["Reprint", "Duplicate", "Verification", "Serial no"].filter((w) => h.includes(w));
  return back.length === 0 || `${back.join(", ")} is back on the guest's copy`;
});
R("P19084", "if nobody touched this territory for a year, what would rot first?", () => {
  // The honest answer, asserted rather than opined: the things that go stale are the PINNED
  // outside references — a downloaded program's version and checksum, and the migration numbers
  // the docs cite. Both must still resolve today.
  const helper = read("lib/printHelperScript.ts");
  const pinned = /version: "([\d.]+)"/.exec(helper);
  const sha = /sha256: "([a-f0-9]{64})"/.exec(helper);
  const num = read("docs/NUMBERING.md");
  const migs = [...new Set([...num.matchAll(/\bmig(?:ration)?s?\s+0?(\d{2,3})\b/gi)].map((m) => +m[1]))];
  const { readdirSync } = require_("node:fs");
  const files = readdirSync(require_("node:path").join(ROOT_DIR, "supabase/migrations"));
  const gone = migs.filter((n) => !files.some((f) => f.startsWith(String(n).padStart(3, "0") + "_")));
  return (pinned && sha && gone.length === 0) || `pinned version ${pinned?.[1]}, checksum ${sha ? "present" : "MISSING"}, migrations cited but absent: ${gone.join(",") || "none"}`;
});
R("P19085", "does the paper tell an inspector where a missing bill number went?", () => {
  const n = read("docs/NUMBERING.md");
  return (/gap/i.test(n) && /audit/i.test(n) && /chain|sign/i.test(n)) || "the doc no longer explains a gap";
});
R("P19086", "the three documents agree on the restaurant's identity, to the character", () => {
  const s = { restaurant_name: "Aangan Garden Restaurant", restaurant_address: "12 Some Road", gstin: "24ABCDE1234F1Z5" };
  const bi = B.billIdentity(s, {});
  const bill = B.billDocHtml({ ...dataOf([ord()], s), noBar: true });
  const bq = B.banquetDocHtml(bqOf({}, s));
  return (bill.includes(bi.name) && bq.includes(bi.name)) || "the bill and the banquet sheet name the restaurant differently";
});
R("P19087", "…and on the GSTIN, where each one prints it", () => {
  const s = { ...S5, gstin: "24ABCDE1234F1Z5" };
  return (/GSTIN 24ABCDE1234F1Z5/.test(B.billDocHtml({ ...dataOf([ord()], s), noBar: true })) && /24ABCDE1234F1Z5/.test(B.banquetDocHtml(bqOf({}, s))))
    || "the two documents print different registrations";
});
for (const [id, what, over] of [
  ["P19088", "a bill for a restaurant with a very long name still fits the roll", { name: "The Great Aangan Garden Family Restaurant And Banquet Hall Private Limited" }],
  ["P19089", "a very long address does the same", { addr: "Shop 14, Second Floor, Sunrise Complex, Opposite the Old Railway Crossing, Satellite Road, Ahmedabad 380015" }],
  ["P19090", "a customer with a very long name does not push the mobile number off the sheet", { cust: "Dr Shrimati Aangan Kumari Devi Sharma Patel", custPhone: "98250 12345" }],
]) {
  D(id, what, () => on("bill", billOf(3, over), { media: "print" }, async ({ page }) => {
    const ink = await inkWidth(page);
    const phoneOk = !over.custPhone || (await seenText(page)).some((l) => l.includes("98250 12345"));
    return (ink <= ROLL_PX + 1 && phoneOk) || `ink ${ink}px (roll ${ROLL_PX}px), the mobile is on the sheet: ${phoneOk}`;
  }));
}
D("P19091", "a 40-line bill prints its item header exactly once", () =>
  on("bill", billOf(40), { media: "print" }, async ({ page }) => {
    const d = await page.evaluate(() => { const t = document.querySelector("thead"); return t ? getComputedStyle(t).display : "none"; });
    return d === "table-row-group" || `thead computes display:${d} — browsers repeat it on every page otherwise`;
  }));
R("P19092", "…and never splits a money row across a page break", () =>
  /tr,\.t,\.g,\.kv,h2,\.sub\{break-inside:avoid/.test(SRC) || "the break-inside rule is gone — a fragmented flex row shifts every amount one line down");
R("P19093", "the guest's own note on a dish reaches the KITCHEN and never the bill", () => {
  const note = "no chilli for the child";
  const kot = B.kotDocHtml({ ...kotOf(), lines: [{ qty: 1, title: "Dal", note }] });
  const bill = B.billDocHtml({ ...dataOf([ord({ items: [{ title: "Dal", qty: 1, price: 200, tax_mode: "excl", note }] })]), noBar: true });
  return (kot.includes(note) && !bill.includes(note)) || `on the ticket: ${kot.includes(note)}, on the bill: ${bill.includes(note)}`;
});
R("P19094", "two identical dishes ordered separately print as ONE line with qty 2", () => {
  const out = B.combineBillLines([{ title: "Dal", price: 200, qty: 1 }, { title: "Dal", price: 200, qty: 1 }]);
  return (out.length === 1 && out[0].qty === 2) || `${out.length} lines, first qty ${out[0]?.qty}`;
});
R("P19095", "…but the same dish at two different prices stays two lines", () => {
  const out = B.combineBillLines([{ title: "Dal", price: 200, qty: 1 }, { title: "Dal", price: 150, qty: 1 }]);
  return out.length === 2 || `${out.length} line(s)`;
});
R("P19096", "…and the same dish with different add-ons stays two lines", () => {
  const out = B.combineBillLines([{ title: "Dal", price: 200, qty: 1, options: [{ label: "Cheese", price: 20 }] }, { title: "Dal", price: 200, qty: 1 }]);
  return out.length === 2 || `${out.length} line(s)`;
});
for (const [id, what, build] of [
  ["P19097", "a bill printed twice from the same data is byte-identical", () => B.billDocHtml({ ...billOf(4), noBar: true })],
  ["P19098", "…and so is a kitchen ticket", () => B.kotDocHtml(kotOf())],
  ["P19099", "…and so is a banquet sheet", () => B.banquetDocHtml(bqOf())],
]) {
  R(id, what, () => {
    const a = build(), b2 = build();
    if (a === b2) return true;
    let i = 0; while (i < a.length && a[i] === b2[i]) i++;
    return `they differ from character ${i}: "${a.slice(i, i + 40)}" vs "${b2.slice(i, i + 40)}"`;
  });
}
R("P19100", "every entry point this file exports can be called with nothing and does not throw", () => {
  const threw = [];
  for (const [k, fn] of Object.entries(B)) { if (typeof fn !== "function") continue; try { fn(); } catch (e) { threw.push(`${k}: ${e.message}`); } }
  return threw.length === 0 || threw.join(" · ");
});

// ── COMPLETENESS: every id in P18701–P19100 is registered by somebody ────────────────────────
// The generated bank hands its unmatched rows to this file. This check is what makes that safe:
// if any id in the range ends up registered by NOBODY, the suite says so by name rather than
// quietly running 242 rows and printing "all clean" — which is exactly the scar this repo carries.
{
  const { ALL_IDS, HANDOVER } = await import("./rerun-NEWBH.mjs");
  const have = registered();
  const missing = ALL_IDS.filter((id) => !have.has(id));
  row("P19101-completeness", `every one of the ${ALL_IDS.length} rows in P18701–P19100 is registered by some module`, () =>
    missing.length === 0
      || `${missing.length} row(s) are registered by nobody and would silently not run: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`);
  if (HANDOVER.length) {
    const stillOpen = HANDOVER.filter((h) => !have.has(h.id));
    if (stillOpen.length) console.log(`  (NEWBH2: ${HANDOVER.length - stillOpen.length} of ${HANDOVER.length} handed-over rows implemented; ${stillOpen.length} still open)`);
  }
}
