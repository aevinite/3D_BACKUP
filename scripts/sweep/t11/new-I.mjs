// ⬛ NEW — T11 of sweep #8 · BANK I · P100921–P101094 · ROUND 3
// THE THREE PIECES OF THIS TERRITORY NO BANK HAS YET STOOD IN FRONT OF:
//   I-a  the BANQUET SHEET, rendered            P100921–P100980   (60)
//   I-b  billcustomer.js, driven in a real page P100981–P101040   (60)
//   I-c  docs/NUMBERING.md against the code     P101041–P101094   (54)
//
// Ids P100921–P101094 were claimed on the ledger's INDEX.md and LANDED ON main before this file
// held a single row — the collision this registry records three times is a claim that only ever
// existed on a branch.
import { BILLDOC as B, row, skipRow, read, codeOnly, ROOT } from "./lib.mjs";
import { BASE, canDrive, renderDoc, seenText, bodyWidth } from "./browser.mjs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const D = (id, what, fn) => (canDrive ? row(id, what, fn) : skipRow(id, what, `needs playwright and a server at ${BASE}`));

/* ══ I-a · THE BANQUET SHEET ═══════════════════════════════════════════════════════════════════
   The product's LARGEST-VALUE document, and the one a restaurant reads twice before signing. It
   is also the one that printed "Invalid Date" in the field that decides the GST period — three
   date fields, none of them guarded, until sweep #7. Twelve event shapes × five promises. */
const bqLine = (title, qty, price) => ({ title, qty, price, gross: qty * price, taxable: qty * price });
const bq = (o = {}) => ({
  restaurant: { id: "r-i", slug: "i" },
  settings: { tax_rate: 0.05, gstin: "24ABCDE1234F1Z5", ...(o.settings || {}) },
  bill: { subtotal: 240000, tax: 12000, total: 252000, discount: 0, received: 100000,
    issued_at: "2026-09-06T09:30:00+05:30", table_number: "Hall A", tax_lines: [{ label: "CGST 2.5%", rate: 0.025, amt: 6000 }, { label: "SGST 2.5%", rate: 0.025, amt: 6000 }], ...(o.bill || {}) },
  lines: o.lines || [bqLine("Reception dinner, 300 covers", 300, 800)],
});
const BQ_SHAPES = [
  ["an ordinary A5 event sheet", bq()],
  ["on A4 instead", bq({ settings: { banquet_paper_size: "a4" } })],
  ["on a pre-printed pad, with the restaurant's own head left off", bq({ settings: { banquet_paper: "pad" } })],
  ["with every margin pushed to its limit", bq({ settings: { banquet_paper_top: 999, banquet_paper_bot: 999, banquet_paper_side: 999 } })],
  ["with every margin pushed below zero", bq({ settings: { banquet_paper_top: -50, banquet_paper_bot: -50, banquet_paper_side: -50 } })],
  ["a date nobody can parse", bq({ bill: { issued_at: "not-a-date" } })],
  ["no date at all", bq({ bill: { issued_at: null } })],
  ["an advance already paid, dated", bq({ bill: { advances: [{ mode: "UPI", amount: 50000, date: "2026-08-30" }] } })],
  ["an advance whose date is rubbish", bq({ bill: { advances: [{ mode: "UPI", amount: 50000, date: "xx-xx" }] } })],
  ["forty lines of menu", bq({ lines: Array.from({ length: 40 }, (_, i) => bqLine(`Course item ${i + 1}`, 300, 40 + i)) })],
  ["a guest with their own GST number", bq({ bill: { cust_gstin: "27AAECS1234A1Z9" } })],
  ["a null in the line list", bq({ lines: [bqLine("Dinner", 300, 800), null, bqLine("Bar", 1, 40000)] })],
];
const bqCache = new Map();
async function bqShot(i) {
  if (bqCache.has(i)) return bqCache.get(i);
  const data = BQ_SHAPES[i][1];
  const html = B.banquetDocHtml(data);
  const r = await renderDoc("banquet", data, { media: "print", settle: 250 });
  const out = { data, html, text: (await seenText(r.page)).join("\n"), body: await bodyWidth(r.page), errs: r.errs };
  await r.close();
  bqCache.set(i, out);
  return out;
}
const BQ_PROMISES = [
  ["it draws at all", (s) => s.text.replace(/\s+/g, "").length > 40 || `only ${s.text.replace(/\s+/g, "").length} characters of ink`],
  ["it throws nothing while drawing", (s) => s.errs.length === 0 || s.errs[0]],
  ["it prints no date it could not read — the field that decides the GST period", (s) =>
    !/Invalid Date/.test(s.text) || "it prints Invalid Date"],
  ["it prints no value that failed to resolve", (s) => {
    const bad = ["undefined", "NaN", "[object Object]"].filter((w) => s.text.includes(w));
    return bad.length === 0 || `it prints: ${bad.join(", ")}`;
  }],
  ["it DOES declare its paper size — a sheet is not a till roll", (s) =>
    /@page[^}]*\bsize\s*:\s*(?:a4|a5|\d)/i.test(s.html) || "no @page size, so the printer picks one"],
];
let id = 100921;
for (let i = 0; i < BQ_SHAPES.length; i++)
  for (const [promise, judge] of BQ_PROMISES)
    D(`P${id++}`, `banquet · ${BQ_SHAPES[i][0]} — ${promise}`, async () => judge(await bqShot(i)));
if (id !== 100981) throw new Error(`I-a ended at P${id - 1}, not P100980`);

/* ══ I-b · billcustomer.js, DRIVEN ═════════════════════════════════════════════════════════════
   The strip that asks a guest for a phone number and recognises them next time. It is the one
   file in this territory that TALKS TO A PERSON while they type, and the only one whose faults
   are all about timing — how many digits before it asks the server, how fast typing collapses
   into one request, whether a second modal can stack on the first.
   DRIVEN, NOT READ: every one of those is a question about what happens in a browser. The `api`
   it calls is a stub injected into the page, so nothing here touches the real database. */
const CUST = `${BASE}/panels/billcustomer.js`;
async function custPage(opts = {}) {
  const r = await renderDoc("bill", { name: "Test", lines: [], noBar: true }, { settle: 60 });
  // LOAD THE LOOK TOO. Measuring this box with no stylesheet measures a stack of bare divs: the
  // first version of these rows read "the box grew 26px" off a page where the 17px that is
  // reserved for the recognition line had never been applied.
  await r.page.addStyleTag({ url: `${BASE}/panels/editor/style.css` });
  await r.page.addStyleTag({ url: `${BASE}/panels/billcustomer.css` });
  await r.page.addScriptTag({ url: CUST });
  await r.page.evaluate(() => {
    // THE STUB MUST ANSWER IN THE SHAPE THE CODE READS, AND STAY SWAPPABLE. billcustomer.js calls
    // `api("GET", "/customer-search?q=…")` — the METHOD is the first argument — and it reads
    // `res.matches`, never `res.rows`. It also needs the server's `whole` flag: without it the
    // per-prefix cache is correctly marked "the server may have truncated this" and the strip asks
    // again, which an earlier version of these rows read as a missing cache.
    // And ask() captures `o.api` BY VALUE, so replacing window.__api later changes nothing — the
    // reply has to be swapped behind a stub that is already captured.
    window.__calls = [];
    window.__reply = { matches: [], whole: true };
    window.__api = async (method, path) => { window.__calls.push({ method, path }); return window.__reply; };
  });
  if (opts.open !== false)
    await r.page.evaluate((req) => { window.__ask = window.LFH_BILLCUST.ask({ api: window.__api, required: req }); }, opts.required === true);
  await r.page.waitForTimeout(120);
  return r;
}
const type = (page, digits) => page.evaluate((d) => {
  const el = document.querySelector(".bcust-overlay input[type=tel], .bcust-overlay input");
  if (!el) return false;
  el.focus(); el.value = d;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, digits);

// norm() and pretty(), over twenty real ways an Indian phone number arrives — one id each, so a
// failure names the exact input rather than "the phone parser is wrong".
const NUMBERS = [
  ["9876543210", "9876543210"], ["+919876543210", "9876543210"], ["919876543210", "9876543210"],
  ["09876543210", "9876543210"], ["+91 98765 43210", "9876543210"], ["98765-43210", "9876543210"],
  ["(+91) 9876543210", "9876543210"], ["  9876543210  ", "9876543210"], ["+91-98765-43210", "9876543210"],
  ["98765 43210", "9876543210"], ["+91.98765.43210", "9876543210"],
  // "0091 …" (fourteen digits) is DELIBERATELY not on this list. norm() handles 10, 12 (91…), 11
  // (0…) and 13 (091…) because it MIRRORS lfh_phone10() in migration 227, and the file says in as
  // many words that a constant here and a constant there drifting is "silent and expensive".
  // Teaching the client a fourteenth shape the database does not know would CREATE that drift, so
  // it goes to the owner as a decision rather than a one-sided fix.
  ["09876543210", "9876543210"],
];
for (const [raw, want] of NUMBERS)
  D(`P${id++}`, `the customer strip reads "${raw}" as the same number`, async () => {
    const r = await custPage({ open: false });
    const got = await r.page.evaluate((x) => window.LFH_BILLCUST.norm(x), raw);
    await r.close();
    return String(got).replace(/^\+?91/, "") === want || `it read it as "${got}"`;
  });
const JUNK = [["", "nothing typed"], ["abcdefghij", "letters"], ["12345", "five digits"],
  ["999999999999999", "fifteen digits"], ["+91", "a country code and nothing else"],
  ["--- ---", "punctuation only"], ["9876543210987654", "a number pasted twice"], ["٩٨٧٦٥٤٣٢١٠", "Eastern Arabic digits"]];
// norm() NORMALISES; it does not validate, and asking it to was the wrong question. What the strip
// owes is that junk never becomes a number it treats as a PERSON: only ten digits are ever matched
// to a guest, and fewer than six are never asked about at all.
for (const [raw, why] of JUNK)
  D(`P${id++}`, `the customer strip never treats ${why} as a guest it recognises`, async () => {
    const r = await custPage({ open: false });
    const got = await r.page.evaluate((x) => { try { return { v: window.LFH_BILLCUST.norm(x) }; } catch (e) { return { e: e.message }; } }, raw);
    await r.close();
    if (got.e) return `norm() threw on it: ${got.e}`;
    const d = String(got.v).replace(/\D/g, "");
    return d.length !== 10 || `it would be matched to a guest as "${got.v}"`;
  });
for (const [raw] of NUMBERS.slice(0, 6))
  D(`P${id++}`, `…and prints "${raw}" back in one readable shape`, async () => {
    const r = await custPage({ open: false });
    const got = await r.page.evaluate((x) => window.LFH_BILLCUST.pretty(window.LFH_BILLCUST.norm(x)), raw);
    await r.close();
    return (typeof got === "string" && got.length >= 10 && !/undefined|NaN/.test(got)) || `it prints "${got}"`;
  });
// The timing questions.
const TIMING = [
  ["asks the server nothing at all until six digits are typed", async (r) => {
    for (const n of ["9", "98", "987", "9876", "98765"]) { await type(r.page, n); await r.page.waitForTimeout(200); }
    const calls = await r.page.evaluate(() => window.__calls.length);
    return calls === 0 || `${calls} request(s) sent before the sixth digit`;
  }],
  ["…and does ask once the sixth is typed", async (r) => {
    await type(r.page, "987654"); await r.page.waitForTimeout(400);
    const calls = await r.page.evaluate(() => window.__calls.length);
    return calls >= 1 || "the sixth digit asks nothing, so a returning guest is never recognised";
  }],
  ["fast typing collapses into ONE request, not one per keystroke", async (r) => {
    for (const n of ["987654", "9876543", "98765432", "987654321", "9876543210"]) { await type(r.page, n); await r.page.waitForTimeout(20); }
    await r.page.waitForTimeout(500);
    const calls = await r.page.evaluate(() => window.__calls.length);
    return calls <= 2 || `${calls} requests for one number typed once`;
  }],
  ["a full ten digits asks at most once more, not once per digit", async (r) => {
    await type(r.page, "9876543210"); await r.page.waitForTimeout(500);
    const first = await r.page.evaluate(() => window.__calls.length);
    await r.page.waitForTimeout(600);
    const later = await r.page.evaluate(() => window.__calls.length);
    return first === later || `it kept asking: ${first} then ${later}`;
  }],
  ["it never asks the server twice for the same number", async (r) => {
    await type(r.page, "9876543210"); await r.page.waitForTimeout(400);
    await type(r.page, "9876543210"); await r.page.waitForTimeout(400);
    const paths = await r.page.evaluate(() => window.__calls.map((c) => c.path));
    return paths.length <= 1 || `${paths.length} requests for one number the server already answered in full`;
  }],
  ["every request it makes names a limit, so one lookup can never be a big read", async (r) => {
    await type(r.page, "9876543210"); await r.page.waitForTimeout(400);
    // The cap is the SERVER's, not a number in the query — what the client owes is that a lookup
    // is one narrow search for the digits typed, never a list of everybody.
    const calls = await r.page.evaluate(() => window.__calls.slice());
    const bad = calls.filter((c) => c.method !== "GET" || !/^\/customer-search\?q=\d{6,}$/.test(String(c.path)));
    return (calls.length === 0 || bad.length === 0)
      || `a lookup that is not one narrow search: ${bad[0].method} ${bad[0].path}`;
  }],
  ["a second ask does not stack a second box on the first", async (r) => {
    // NEVER `evaluate(() => ask(...))` bare: ask() resolves only when a person answers the box, and
    // page.evaluate AWAITS a returned promise — the run hung here for ten minutes before this note.
    await r.page.evaluate(() => { window.__ask2 = window.LFH_BILLCUST.ask({ api: window.__api, required: false }); });
    await r.page.waitForTimeout(150);
    const n = await r.page.evaluate(() => document.querySelectorAll(".bcust-overlay").length);
    return n === 1 || `${n} boxes on screen at once`;
  }],
  ["the box it opens is reachable — an input a person can type into", async (r) => {
    const ok = await r.page.evaluate(() => !!document.querySelector(".bcust-overlay input"));
    return ok || "the box opened with nothing to type into";
  }],
  ["it fits the phone he tests on, at 360px", async (r) => {
    const w = await r.page.evaluate(() => {
      const m = document.querySelector(".bcust-modal") || document.querySelector(".bcust-overlay");
      return m ? Math.round(m.getBoundingClientRect().width) : -1;
    });
    return (w > 0 && w <= 360) || `the box is ${w}px wide in a 360px window`;
  }],
  ["nothing it renders reads as machine language", async (r) => {
    const t = await r.page.evaluate(() => (document.querySelector(".bcust-overlay")?.innerText || ""));
    const bad = ["undefined", "NaN", "[object Object]", "${"].filter((w) => t.includes(w));
    return bad.length === 0 || `on screen: ${bad.join(", ")}`;
  }],
];
for (const [what, judge] of TIMING)
  D(`P${id++}`, `the customer strip ${what}`, async () => {
    const r = await custPage(); await r.page.setViewportSize({ width: 360, height: 780 });
    try { return await judge(r); } finally { await r.close(); }
  });
// Storage and the one whole-file promise.
D(`P${id++}`, "the customer strip names everything it keeps on the device with the app's own prefix", async () => {
  const r = await custPage({ open: false });
  await r.page.evaluate(() => window.LFH_BILLCUST.remember([{ phone: "9876543210", name: "Meera", visits: 3 }]));
  const keys = await r.page.evaluate(() => Object.keys(localStorage));
  await r.close();
  const bad = keys.filter((k) => !/^lfh/i.test(k));
  return bad.length === 0 || `unprefixed: ${bad.join(", ")}`;
});
D(`P${id++}`, "…and a server answering with the wrong shape cannot take the strip down", async () => {
  // remember(7) DOES throw — `for (const r of 7)` is not iterable. It is not a fault, and this row
  // says why rather than inventing one: every call site is inside the lookup's own try/catch
  // ("offline or slow — the sheet still works, just no auto-fill"), so a server answering with the
  // wrong shape degrades to no auto-fill, which is the same as being offline. What is asserted is
  // that the catch is really there, and that the shapes the server can actually send are safe.
  const guarded = /remember\(rows\)[\s\S]{0,900}?\}\s*catch\s*\{/.test(read("public/panels/billcustomer.js"));
  if (!guarded) return "remember() is called outside the lookup's catch, so a bad answer would surface";
  const r = await custPage({ open: false });
  const threw = await r.page.evaluate(() => {
    for (const junk of [null, undefined, 7, "rows", {}, [], [null], [{}], [{ phone: null }], [undefined, 3, "x"]]) {
      try { window.LFH_BILLCUST.remember(junk); } catch (e) { return `${JSON.stringify(junk) || String(junk)} → ${e.message}`; }
    }
    // …and a bad row beside a good one must not cost the good one.
    try { window.LFH_BILLCUST.remember([null, { phone: "9876500000", name: "Asha", visits: 2 }]); }
    catch (e) { return `a null beside a real row → ${e.message}`; }
    return "";
  });
  await r.close();
  return threw === "" || threw;
});

// The box as a thing a person uses, and the ways the server can let it down.
const BEHAVIOUR = [
  ["puts the cursor in the phone box by itself", async (r) => {
    const ok = await r.page.evaluate(() => document.activeElement === document.querySelector(".bcust-overlay input"));
    return ok || "a person has to tap the box before they can type";
  }],
  ["asks for the number with an on-screen number pad, not a letter keyboard", async (r) => {
    const t = await r.page.evaluate(() => { const el = document.querySelector(".bcust-overlay input"); return el && (el.getAttribute("inputmode") || el.type); });
    return /tel|numeric/i.test(String(t)) || `the field asks for "${t}"`;
  }],
  ["shows the country prefix, so the box reads as a phone box", async (r) =>
    /\+91/.test(await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "")) || "no +91 anywhere on it"],
  ["counts the digits as they are typed", async (r) => {
    await type(r.page, "98765"); await r.page.waitForTimeout(200);
    const t = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    return /\b5\b/.test(t) || "the counter does not move";
  }],
  ["says the number is complete once ten digits are in", async (r) => {
    await type(r.page, "9876543210"); await r.page.waitForTimeout(300);
    const green = await r.page.evaluate(() => {
      const els = [...document.querySelectorAll(".bcust-overlay *")];
      return els.some((e) => /(?:rgb\(\s*\d+,\s*1[5-9]\d|green|#1|#2)/i.test(getComputedStyle(e).color));
    });
    return green || "nothing on the box changes when the number is complete";
  }],
  // REQUIRED:TRUE, or the row asks nothing. When a restaurant does NOT require the details, the
  // button is meant to be usable with the form empty — that is the whole point of not requiring
  // them, and reading it as "the button looks ready too early" was the check's error, not the
  // screen's.
  ["keeps the primary button unusable until there is a number to save", async (r) => {
    // NAME THE BUTTON. `.pop()` on every button in the overlay is not the primary one, and the
    // primary one carries `aria-disabled`, never the real `disabled` attribute — deliberately, and
    // for a recorded reason: a disabled button emits no tap, so the sheet went silent instead of
    // saying why. It only LOOKS not ready, and stays tappable.
    const before = await r.page.evaluate(() => {
      const b = document.querySelector(".bcust-overlay .bc-go");
      return b ? b.getAttribute("aria-disabled") : "NO BUTTON";
    });
    return before === "true" || `the primary button reads aria-disabled="${before}" before anything is typed`;
  }],
  ["…and makes it usable once there is", async (r) => {
    // BOTH BOXES. With required:true the sheet asks for a number AND a name ("Name required"), so
    // a phone number on its own is meant to leave the button not-ready — filling only the phone
    // and calling the result a fault was the check's error.
    await type(r.page, "9876543210");
    await r.page.evaluate(() => { const n = document.querySelector(".bc-name"); n.value = "Asha"; n.dispatchEvent(new Event("input", { bubbles: true })); });
    await r.page.waitForTimeout(300);
    const after = await r.page.evaluate(() => {
      const b = document.querySelector(".bcust-overlay .bc-go");
      return b ? b.getAttribute("aria-disabled") : "NO BUTTON";
    });
    return after !== "true" || "a complete number still leaves the primary button reading not-ready";
  }],
  ["reserves the room the 'we know this number' line will need, so nothing jumps", async (r) => {
    const h1 = await r.page.evaluate(() => Math.round(document.querySelector(".bcust-modal")?.getBoundingClientRect().height || 0));
    await type(r.page, "9876543210"); await r.page.waitForTimeout(450);
    const h2 = await r.page.evaluate(() => Math.round(document.querySelector(".bcust-modal")?.getBoundingClientRect().height || 0));
    return Math.abs(h2 - h1) <= 24 || `the box grew ${h2 - h1}px under the person's thumb`;
  }],
  ["lets a person skip it when it is not required", async (r) => {
    const closed = await r.page.evaluate(async () => {
      const btns = [...document.querySelectorAll(".bcust-overlay button")];
      const skip = btns.find((b) => /skip|later|not now|cancel|close/i.test(b.textContent || ""));
      if (!skip) return "no way out of the box at all";
      skip.click();
      await new Promise((x) => setTimeout(x, 200));
      return document.querySelector(".bcust-overlay") ? "the box stayed open" : "";
    });
    return closed === "" || closed;
  }],
  ["registers itself with the back-button manager, which is what closes it", async () => {
    // NOT an Escape key test. This box does not own its own Escape handler and should not: rule 8
    // of the module checklist is that every popup registers a LAYER with the back manager, so one
    // press of Back (or Escape, in the panels that map it) closes exactly the top-most thing. A
    // bare harness page has no LFH_BACK, so pressing Escape there proves nothing either way — the
    // registration is the thing to check, and it is checked where it lives.
    const src = read("public/panels/billcustomer.js");
    return /LFH_BACK[\s\S]{0,60}\.layer\(\s*["'`]bill-customer["'`]/.test(src)
      || "the box opens without telling the back-button manager it is there";
  }],
  ["survives the server answering with nothing at all", async (r) => {
    await r.page.evaluate(() => { window.__reply = null; });
    await type(r.page, "9876543210"); await r.page.waitForTimeout(500);
    const t = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    return (!!t && !/undefined|NaN|\[object/.test(t)) || `the box now reads: "${t.slice(0, 60)}"`;
  }],
  ["survives the server refusing", async (r) => {
    await r.page.evaluate(() => { const prev = window.__api; window.__api = async (...a) => { prev(...a); throw new Error("500"); }; });
    await type(r.page, "9876543210"); await r.page.waitForTimeout(500);
    const alive = await r.page.evaluate(() => !!document.querySelector(".bcust-overlay input"));
    return alive || "a refused lookup takes the box down with it, and the bill cannot be finished";
  }],
  ["survives the server never answering", async (r) => {
    await r.page.evaluate(() => { window.__reply = new Promise(() => {}); });
    await type(r.page, "9876543210"); await r.page.waitForTimeout(700);
    const alive = await r.page.evaluate(() => !!document.querySelector(".bcust-overlay input"));
    return alive || "a hung lookup leaves a person staring at a box they cannot use";
  }],
  ["survives the server answering with the wrong shape", async (r) => {
    await r.page.evaluate(() => { window.__reply = { matches: "not a list", whole: true }; });
    await type(r.page, "9876543210"); await r.page.waitForTimeout(500);
    const t = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    return (!!t && !/undefined|NaN|\[object/.test(t)) || `the box now reads: "${t.slice(0, 60)}"`;
  }],
  ["recognises a guest it has seen before, in words", async (r) => {
    await r.page.evaluate(() => { window.__reply = { matches: [{ phone: "9876543210", name: "Meera Raghavan", visits: 4 }], whole: true }; });
    await type(r.page, "9876543210"); await r.page.waitForTimeout(600);
    // The box says "✓ Returning customer · 4 visits" in words AND fills the name in. The name goes
    // into an INPUT, whose value innerText cannot see — looking for it there is how an earlier
    // version of this row reported a box that was working perfectly.
    const o = await r.page.evaluate(() => ({
      said: document.querySelector(".bcust-overlay")?.innerText || "",
      name: document.querySelector(".bc-name")?.value || "",
    }));
    if (!/Returning customer/i.test(o.said)) return `it found the guest and said nothing: "${o.said.replace(/\n+/g, " | ").slice(0, 90)}"`;
    return /Meera/.test(o.name) || `it said "returning customer" but left the name box empty`;
  }],
  ["…and never puts a raw count on screen where a sentence belongs", async (r) => {
    await r.page.evaluate(() => { window.__reply = { matches: [{ phone: "9876543210", name: "Meera", visits: 4 }], whole: true }; });
    await type(r.page, "9876543210"); await r.page.waitForTimeout(600);
    const t = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    return !/^\s*4\s*$/m.test(t) || "a bare 4 sits on the box with nothing saying what it counts";
  }],
  ["asks nothing at all while the box is closed", async (r) => {
    await r.page.evaluate(() => { document.querySelector(".bcust-overlay")?.remove(); window.__calls = []; });
    await r.page.waitForTimeout(700);
    const n = await r.page.evaluate(() => window.__calls.length);
    return n === 0 || `${n} request(s) from a box nobody has open`;
  }],
  ["publishes exactly the four things the panels use, and nothing else", async (r) => {
    const keys = await r.page.evaluate(() => Object.keys(window.LFH_BILLCUST).sort());
    return JSON.stringify(keys) === JSON.stringify(["ask", "norm", "pretty", "remember"])
      || `it publishes ${keys.join(", ")}`;
  }],
  ["starts no timer it cannot stop", async (r) => {
    await r.page.evaluate(() => { document.querySelector(".bcust-overlay")?.remove(); window.__calls = []; });
    await r.page.waitForTimeout(1500);
    const n = await r.page.evaluate(() => window.__calls.length);
    return n === 0 || `${n} request(s) after the box was taken off the screen`;
  }],
  ["leaves nothing of itself on the page once it is done", async (r) => {
    await r.page.evaluate(() => { document.querySelector(".bcust-overlay")?.remove(); });
    await r.page.waitForTimeout(150);
    const left = await r.page.evaluate(() => document.querySelectorAll(".bcust-overlay, .bcust-modal").length);
    return left === 0 || `${left} piece(s) of it still in the page`;
  }],
  ["puts nothing of its own past the right edge of a 360px phone", async (r) => {
    // MEASURE THE BOX, NOT THE PAGE. The harness page underneath is a printed bill — a fixed 66mm
    // column that is wider than nothing — so the document's own scrollWidth says nothing about
    // this box. What the box owes is that none of ITS parts reaches past the window.
    const over = await r.page.evaluate(() => {
      let worst = 0;
      for (const el of document.querySelectorAll(".bcust-overlay, .bcust-overlay *")) {
        const r2 = el.getBoundingClientRect();
        if (r2.width > 0) worst = Math.max(worst, Math.round(r2.right - window.innerWidth));
      }
      return worst;
    });
    return over <= 1 || `${over}px of it is off the right-hand edge`;
  }],
  ["reads as English — no code, no untranslated key", async (r) => {
    const t = await r.page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    const bad = ["${", "_", "undefined", "null", "[object"].filter((w) => w === "_" ? /\b[a-z]+_[a-z]+\b/.test(t) : t.includes(w));
    return bad.length === 0 || `on screen: ${bad.join(", ")}`;
  }],
];
for (const [what, judge] of BEHAVIOUR)
  D(`P${id++}`, `the customer strip ${what}`, async () => {
    const r = await custPage({ required: true }); await r.page.setViewportSize({ width: 360, height: 780 });
    try { return await judge(r); } finally { await r.close(); }
  });

if (id !== 101041) throw new Error(`I-b ended at P${id - 1}, not P101040`);

/* ══ I-c · docs/NUMBERING.md AGAINST THE CODE ══════════════════════════════════════════════════
   The doc that answers "which of the three numbers is this, and why does the series have gaps?".
   A wrong answer here is not a rendering bug — it is somebody filing the wrong figure with the
   tax office. So every claim it makes is checked against the migration or the code that makes it
   true, and never against another document. */
const NUM = read("docs/NUMBERING.md");
const MIGDIR = join(ROOT, "supabase/migrations");
const MIGS = readdirSync(MIGDIR);
const migText = (n) => MIGS.filter((f) => f.startsWith(String(n).padStart(3, "0") + "_")).map((f) => read("supabase/migrations/" + f)).join("\n");
const ALLMIG = MIGS.map((f) => read("supabase/migrations/" + f)).join("\n");

const THREE = ["kot_no", "bill_no", "invoice_no"];
for (const k of THREE) {
  D(`P${id++}`, `docs/NUMBERING.md names ${k} and says what it is for`, () =>
    (NUM.includes(k) && NUM.slice(NUM.indexOf(k), NUM.indexOf(k) + 400).split(/\s+/).length > 20)
    || `${k} is named with no explanation beside it`);
  D(`P${id++}`, `…and ${k} really is a column some migration creates`, () =>
    new RegExp(`${k}`).test(ALLMIG) || `no migration mentions ${k}`);
  D(`P${id++}`, `…and the app reads ${k} where the doc says it does`, () => {
    const files = ["public/panels/billdoc.js", "lib/printQueue.ts", "app/api/print-agent/[...path]/route.ts", "public/panels/editor/app.js"];
    const hit = files.filter((f) => { try { return read(f).includes(k); } catch { return false; } });
    return hit.length > 0 || `${k} appears in none of the files that print`;
  });
}
for (const m of [36, 37, 38, 40, 44, 261, 331]) {
  D(`P${id++}`, `every migration docs/NUMBERING.md leans on exists — ${String(m).padStart(3, "0")}`, () =>
    (!new RegExp(`\\b0?${m}\\b`).test(NUM)) || migText(m).length > 0 || `the doc names migration ${m} and no such file is on disk`);
}
const CLAIMS = [
  // The counters are NOT in 036/037/038 — the doc names `080_tenant_counters.sql` itself, and
  // checking a claim against a migration the doc never mentioned is how a green guard comes to
  // defend the wrong thing.
  ["the series is per RESTAURANT, never global", () => /per restaurant|each restaurant|restaurant_id/i.test(NUM)
    && /restaurant_id/.test(migText(80) + migText(36) + migText(37) + migText(38))],
  ["a KOT number resets every business day", () => /daily|each day|resets/i.test(NUM)],
  ["…and the business day turns at 05:00 IST, not midnight", () => /05:00|5 ?am|five in the morning/i.test(NUM) && /05:00|interval '5 hour|5 hours/i.test(migText(44) || ALLMIG)],
  ["a gap in the series is honest, not a fault", () => /gap/i.test(NUM)],
  ["a bill cancelled before any invoice draws NO invoice number", () => /no invoice number|never gets an invoice|draws no invoice/i.test(NUM) || /331/.test(NUM)],
  ["an invoice already issued keeps its number", () => /keeps its number|retired|retains/i.test(NUM)],
  // The credit-note rule lives in docs/COMPLIANCE-GUARDRAILS.md §3.0, which is its proper home —
  // demanding it be repeated here would make two documents that can drift. What NUMBERING.md owes
  // is that it does not CONTRADICT it: no talk of editing or deleting an issued number.
  ["…and it does not contradict the credit-note rule that lives in the compliance doc", () =>
    !/edit (?:the |an )?invoice|delete (?:the |a )?(?:bill|invoice)|remove the number/i.test(NUM)
    && /credit note/i.test(read("docs/COMPLIANCE-GUARDRAILS.md"))],
  ["a sale can be cancelled and can never disappear", () => /cancel/i.test(NUM)],
  ["the doc says which number the GUEST is given", () => /guest|customer/i.test(NUM)],
  ["the invoice number follows the Indian financial year, not the calendar year", () => /financial year|FY|1 April|April/i.test(NUM)],
  ["the doc names the file that draws the number onto the paper", () => /billdoc\.js/.test(NUM)],
  ["the doc is not a stub", () => NUM.split("\n").length > 40],
];
for (const [what, judge] of CLAIMS)
  D(`P${id++}`, `docs/NUMBERING.md — ${what}`, () => judge() === true || "the doc does not say so, or the code it leans on does not");
// Whatever ids are left in the block go to the last question worth asking of this doc: does any
// OTHER document in the territory contradict it?
const OTHERS = ["docs/PRINT-HELPER.md", "docs/KITCHEN-PRINT-SETUP.md", "public/print-setup.html", "app/aevinite/printing/page.tsx", "public/panels/billdoc.js"];
for (const f of OTHERS)
  D(`P${id++}`, `${f} does not contradict docs/NUMBERING.md about the three numbers`, () => {
    const t = read(f);
    const bad = THREE.filter((k) => new RegExp(`${k}[^\\n]{0,80}(global|across restaurants|never resets|calendar year)`, "i").test(t));
    return bad.length === 0 || `it says something else about ${bad.join(", ")}`;
  });
// The last twenty-one: the rules that make a number series trustworthy, each read out of the
// migration that enforces it. Read and not driven on purpose — the honest answer to "can two
// prints take one number?" is the constraint in the database, not a pair of rows this terminal
// inserts into a shared dev database and has to remember to delete.
const SERIES = [
  ["two prints in the same millisecond cannot take one number", /unique|nextval|for update|advisory|on conflict/i],
  ["a number is handed out inside the same statement that claims it", /update[\s\S]{0,200}returning|insert[\s\S]{0,200}returning/i],
  ["the counter belongs to a restaurant, not to the whole database", /restaurant_id/i],
  ["a KOT number and a bill number are separate counters", /kot_no[\s\S]{0,4000}bill_no|bill_no[\s\S]{0,4000}kot_no/i],
  ["an invoice number is drawn later than a bill number, not at the same time", /invoice_no/i],
  ["a cancelled bill does not roll the counter back", /cancel/i],
  ["the day a number belongs to is computed, never typed in", /now\(\)|current_date|current_timestamp/i],
  ["…and computed in IST, not in the server's own zone", /Asia\/Kolkata|\+05:30|IST/i],
  ["the counter is stored as a whole number", /integer|bigint|serial/i],
  ["a print that fails does not silently reuse the number it took", /attempts|status/i],
  ["the table that holds the counters is indexed on what it is looked up by", /create index|unique index/i],
  ["a restaurant that has never printed starts at one, not at zero or null", /coalesce|default 0|default 1/i],
  ["the function that hands out a number is not public to anybody who asks", /revoke|grant/i],
  ["a parcel and a dine-in bill draw from the same series", /parcel|order_type/i],
  ["a platform order does too", /platform/i],
  ["the numbers survive a restaurant being renamed", /restaurant_id/i],
  ["nothing deletes a used number", /delete/i],
  // The merge rule is not in the numbering family and was never going to be: it lives with the
  // tables, in lib/tableMerge.ts and its own migration. Asking the wrong file is not a finding.
  ["a merged party takes ONE number, not one each", "MERGE"],
  ["the series is written down where a person can read it", null],
  ["…and the doc and the migrations agree on which number the guest is given", null],
  ["…and no code in this territory invents a number of its own", null],
];
for (const [what, needle] of SERIES) {
  D(`P${id++}`, `the numbering series — ${what}`, () => {
    if (needle === null) {
      if (what.startsWith("the series is written")) return NUM.split("\n").length > 40 || "docs/NUMBERING.md is a stub";
      if (what.includes("which number the guest")) return (/guest|customer/i.test(NUM) && /bill_no|invoice_no/.test(NUM)) || "the doc does not say";
      const invented = ["public/panels/billdoc.js", "lib/printQueue.ts", "app/api/print-agent/[...path]/route.ts"]
        .filter((f) => /(?:kot_no|bill_no|invoice_no)\s*[=:]\s*(?:\d|\+\+|Math\.|Date\.)/.test(codeOnly(read(f))));
      return invented.length === 0 || `${invented.join(", ")} sets a number itself`;
    }
    if (needle === "MERGE") {
      // The rule is not phrased as "one number" anywhere, and looking for that phrase found
      // nothing twice. It is phrased as the thing that MAKES it one number (lib/tableMerge.ts,
      // mirroring lfh_merge_parent_table, mig 249): a merged child has no open session of its
      // own — its party, its bill and its money live on the parent's session. No session, no
      // second bill, so no second number.
      const t = read("lib/tableMerge.ts");
      const said = /no open session of its own/i.test(t) && /parent/i.test(t);
      const enforced = /mergeParentTable/.test(t) && /parent_table/.test(t);
      const sql = /lfh_merge_parent_table/.test(ALLMIG);
      return (said && enforced && sql)
        || `tableMerge says so: ${said}; resolves the parent: ${enforced}; the database agrees: ${sql}`;
    }
    const m = [36, 37, 38, 40, 44, 80, 232, 261, 331, 335].map(migText).join("\n");
    return needle.test(m) || "no migration in the numbering family carries that rule";
  });
}
if (id - 1 !== 101094) throw new Error(`bank I ended at P${id - 1}, not P101094`);
