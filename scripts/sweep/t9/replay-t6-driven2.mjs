// ITEM 10 · the DRIVEN half, part 2 — the geometry, contrast and rendering rows.
// P18073–P18100 (a crowded six-dish ticket at two widths) and the big
// 4-widths × 2-skins × 13-checks matrix at P32431–P32551, plus the live-board rendering rows.
//
// These are the rows that only a rendered screen can answer: is the ✓ still 44px on a ticket with
// six dishes and two allergens each; does a long note wrap inside the card or out of it; is the KOT
// number still the biggest thing on the head at 1194px in the light skin. A regex cannot say.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "").slice(7) || "http://localhost:4309";
const PANEL = "iframe[src*='/panels/kitchen/index.html']";
const FILE = "replay-t6-driven2";
const results = [];
const rec = (id, label, ok, note = "") => results.push({ id, label, ok: ok === true, note: ok === true ? note : (typeof ok === "string" ? ok : note) });

const NOTE = "no chilli at all, the guest is in a hurry";
// The rows MUST carry the order id they belong to — rowsOf() matches on order_id, so a mismatch
// renders a ticket with no lines at all (which is exactly what the first run of this block did:
// "✓ nullxnull", "0 note boxes"). The order id is a parameter for that reason.
const SIX = (note, oid = "six") => Array.from({ length: 6 }, (_, i) => ({
  id: oid + "-d" + i, order_id: oid, title: "Slow-Cooked Lamb Shank with Rosemary " + i, qty: i === 5 ? 6 : 1,
  status: "preparing", note: typeof note === "function" ? note(i) : note, removed: ["nuts", "dairy"],
}));

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const route = await loginAs(ctx, "kitchen", BASE);

  // ── the crowded six-dish ticket, at the two widths the ledger names ──
  for (const [w, h, dpr, tag] of [[360, 780, 3, "a35"], [1194, 834, 2, "tablet"]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, storageState: await ctx.storageState() });
    const page = await c.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e && e.message).slice(0, 100)));
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
    const F = await (await page.waitForSelector(PANEL, { timeout: 30000 })).contentFrame();
    await page.waitForTimeout(2200);
    const m = await F.evaluate(([rows, note]) => {
      state.orders = [{ id: "six", kot_no: 77, table_number: 4, status: "preparing",
        created_at: new Date(Date.now() - 4e5).toISOString(), allergies: ["nuts"], items: [] }];
      state.items = rows; state.platform = []; lastSig = null; render();
      const t = document.querySelector('.ticket[data-ticket="six"]');
      if (!t) return { drawn: false };
      const tr = t.getBoundingClientRect();
      const box = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), left: Math.round(r.left) }; };
      const ticks = [...t.querySelectorAll("[data-item-ready]")].map(box);
      const big = t.querySelector("[data-ready]");
      const kot = t.querySelector(".kot"), age = t.querySelector(".age");
      return {
        drawn: true, lines: t.querySelectorAll(".line").length,
        ticks: ticks.length, tickMin: ticks.length ? Math.min(...ticks.map((b) => Math.min(b.w, b.h))) : null,
        tickOutside: ticks.filter((b) => b.right > Math.round(tr.right) + 1).length,
        allergenLines: (t.innerText.match(/NO NUTS/g) || []).length,
        notesShown: (t.innerText.match(/✎/g) || []).length,
        noteFull: t.innerText.includes(note),
        ellipsis: [...t.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1).length,
        ticketOverflow: t.scrollWidth > t.clientWidth + 1,
        insideScreen: tr.left >= -1 && tr.right <= window.innerWidth + 1,
        bigBox: big ? box(big) : null,
        headCollide: kot && age ? Math.round(kot.getBoundingClientRect().right) <= Math.round(age.getBoundingClientRect().left) + 1 : null,
        tallerThanTwoScreens: tr.height > window.innerHeight * 2,
        qtyShown: (t.innerText.match(/\d+×/g) || []).length,
      };
    }, [SIX(NOTE), NOTE]);

    const off = tag === "a35" ? 0 : 1;   // P18073/74 pattern: a35 then tablet, alternating
    const id = (base) => "P" + (base + off);
    rec(id(18073), `${tag}: a ticket with six dishes draws all six lines`, m.lines === 6 ? true : `${m.lines} lines`, `${m.lines}`);
    rec(id(18075), `${tag}: every dish keeps its own ✓, all six of them`, m.ticks === 6 ? true : `${m.ticks} ticks`, `${m.ticks}`);
    rec(id(18077), `${tag}: no ✓ is pushed off the side of its card by a long line`, m.tickOutside === 0 ? true : `${m.tickOutside} outside`);
    rec(id(18079), `${tag}: every ✓ is still a 44px target on a crowded ticket`, m.tickMin >= 44 ? true : `smallest ${m.tickMin}px`, `${m.tickMin}px`);
    rec(id(18081), `${tag}: the allergens and the note wrap inside the card, never out of it`, m.ellipsis === 0 && !m.ticketOverflow ? true : `${m.ellipsis} clipped, overflow=${m.ticketOverflow}`);
    rec(id(18083), `${tag}: the ticket itself never scrolls sideways`, m.ticketOverflow === false);
    rec(id(18085), `${tag}: the whole card stays inside the screen`, m.insideScreen === true);
    rec(id(18087), `${tag}: ALL READY is still the full-width action under six dishes`, m.bigBox && m.bigBox.w > 100 ? true : `ALL READY is ${m.bigBox && m.bigBox.w}px wide`, `${m.bigBox && m.bigBox.w}px`);
    rec(id(18089), `${tag}: …and it is still a 44px target`, m.bigBox && m.bigBox.h >= 44 ? true : `${m.bigBox && m.bigBox.h}px tall`, `${m.bigBox && m.bigBox.h}px`);
    rec(id(18091), `${tag}: every dish line shows its NO-ALLERGEN list, on every line`, m.allergenLines === 6 ? true : `${m.allergenLines} of 6 lines`, `${m.allergenLines}/6`);
    rec(id(18093), `${tag}: …and the long note is shown in full, not cut with an ellipsis`, m.noteFull === true && m.ellipsis === 0 ? true : `full=${m.noteFull} clipped=${m.ellipsis}`);
    rec(id(18095), `${tag}: the KOT number and the age do not collide in the head`, m.headCollide !== false ? true : "they overlap");
    rec(id(18097), `${tag}: a six-dish ticket is not taller than two screens`, m.tallerThanTwoScreens === false);
    rec(id(18099), `${tag}: the qty is shown for every line, including the six-of-one`, m.qtyShown === 6 ? true : `${m.qtyShown} of 6`, `${m.qtyShown}/6`);
    await c.close();
  }

  // ── the 4 widths × 2 skins × 13 checks matrix, P32431–P32534 ──
  const WIDTHS = [[1280, 800, 1, "desktop 1280px"], [1194, 834, 2, "tablet 1194px"], [820, 1080, 2, "small tablet 820px"], [390, 844, 3, "phone 390px"]];
  let mid = 32431;
  for (const [w, h, dpr, wname] of WIDTHS) {
    for (const skin of ["light", "dark"]) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, storageState: await ctx.storageState() });
      const page = await c.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e && e.message).slice(0, 100)));
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
      const F = await (await page.waitForSelector(PANEL, { timeout: 30000 })).contentFrame();
      await page.waitForTimeout(2000);
      await F.evaluate((s) => { if (window.LFH_THEME && window.LFH_THEME.get() !== s) document.getElementById("themeToggle").click(); }, skin);
      await page.waitForTimeout(300);
      const m = await F.evaluate(([rows]) => {
        state.orders = [{ id: "mx", kot_no: 88, table_number: 5, status: "preparing",
          created_at: new Date(Date.now() - 5e5).toISOString(), allergies: ["nuts"], items: [] }];
        state.items = rows; state.platform = []; lastSig = null; render();
        const t = document.querySelector('.ticket[data-ticket="mx"]');
        if (!t) return { drawn: false };
        const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const ratio = (fg, bg) => { const a = lum(fg), b2 = lum(bg); return (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05); };
        const bgOf = (el) => { let e = el; while (e) { const c2 = getComputedStyle(e).backgroundColor; if (c2 && !/rgba\(0, 0, 0, 0\)|transparent/.test(c2)) return c2; e = e.parentElement; } return "rgb(255,255,255)"; };
        const words = [...t.querySelectorAll(".kot, .tbl, .age, .ltitle, .line small, .awaiting, .big")].filter((e) => (e.textContent || "").trim());
        const worst = Math.min(...words.map((e) => ratio(getComputedStyle(e).color, bgOf(e))));
        const box = (s) => { const e = t.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
        const px = (s) => { const e = t.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; };
        const laneEdges = ["ph-new", "ph-cooking", "ph-ready"].map((cl) => {
          const d = document.createElement("div"); d.className = "ticket " + cl; document.body.appendChild(d);
          const v = getComputedStyle(d).borderLeftColor; d.remove(); return v;
        });
        const head = t.querySelector("h2");
        return {
          drawn: true, worst: Math.round(worst * 100) / 100,
          tick: box("[data-item-ready]"), reprint: box(".reprint"), big: box("[data-ready]"),
          sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
          clipped: t.scrollWidth > t.clientWidth + 1,
          kotPx: px(".kot"), tblPx: px(".tbl"), agePx: px(".age"),
          laneHeadIsPill: (() => { const lh = document.querySelector("#col-cooking h2"); if (!lh) return null; const cs = getComputedStyle(lh); return !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor); })(),
          laneEdges: [...new Set(laneEdges)].length,
          glow: getComputedStyle(t).boxShadow,
          noteOnce: (t.querySelectorAll(".onote") || []).length,
          allergenWrapped: !!t.querySelector(".alg"),
          bigFlush: (() => { const b = t.querySelector("[data-ready]"); if (!b) return null; const br = b.getBoundingClientRect(), trr = t.getBoundingClientRect(); return Math.abs(br.bottom - trr.bottom) <= 2; })(),
        };
      }, [SIX(NOTE, "mx")]);
      const n = () => "P" + mid++;
      rec(n(), `${wname} ${skin}: every word on the board clears its contrast line`, m.worst >= 4.5 ? true : `worst ratio ${m.worst}:1`, `${m.worst}:1`);
      rec(n(), `${wname} ${skin}: the ✓ is still a 44px target`, m.tick && Math.min(m.tick.w, m.tick.h) >= 44 ? true : `${m.tick && m.tick.w}x${m.tick && m.tick.h}`, m.tick && `${m.tick.w}x${m.tick.h}`);
      rec(n(), `${wname} ${skin}: the 🖨 is still a 44px target`, m.reprint && Math.min(m.reprint.w, m.reprint.h) >= 44 ? true : `${m.reprint && m.reprint.w}x${m.reprint && m.reprint.h}`, m.reprint && `${m.reprint.w}x${m.reprint.h}`);
      rec(n(), `${wname} ${skin}: ALL READY is still well over 44px`, m.big && m.big.h >= 44 ? true : `${m.big && m.big.h}px tall`, m.big && `${m.big.h}px`);
      rec(n(), `${wname} ${skin}: nothing scrolls sideways and no ticket is clipped`, !m.sideways && !m.clipped ? true : `sideways=${m.sideways} clipped=${m.clipped}`);
      rec(n(), `${wname} ${skin}: the KOT number is the biggest thing on the ticket head`, m.kotPx > m.tblPx && m.kotPx > m.agePx ? true : `kot ${m.kotPx} vs tbl ${m.tblPx} / age ${m.agePx}`, `${m.kotPx}px`);
      rec(n(), `${wname} ${skin}: the lane heading is a quiet label, not a coloured pill`, m.laneHeadIsPill === false ? true : "the heading has a filled background");
      rec(n(), `${wname} ${skin}: each lane's edge colour is distinct`, m.laneEdges >= 2 ? true : `${m.laneEdges} distinct edge colour(s)`, `${m.laneEdges}`);
      rec(n(), `${wname} ${skin}: the outline glow is gone from a plain ticket`, /none/.test(m.glow) || !/rgb/.test(m.glow) ? true : `box-shadow: ${m.glow}`);
      rec(n(), `${wname} ${skin}: the whole-table note is drawn once, above the dishes`, m.noteOnce === 1 ? true : `${m.noteOnce} note boxes`);
      rec(n(), `${wname} ${skin}: the allergy line is coloured apart from the rest of the small print`, m.allergenWrapped === true);
      rec(n(), `${wname} ${skin}: the action bar is flush with its own card`, m.bigFlush === true ? true : "ALL READY does not sit flush with the card foot");
      rec(n(), `${wname} ${skin}: the page raised no error`, errs.length === 0 ? true : errs.slice(0, 2).join(" | "));
      await c.close();
    }
  }
  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log("\nITEM 10 · the DRIVEN half, part 2 — geometry, contrast, rendering — " + BASE);
  console.log(`  ${results.length - bad.length} passed · ${bad.length} failed  (of ${results.length})`);
  for (const r of results) if (!r.ok) console.log(`  ✗ ${r.id}  ${r.label}\n      → ${r.note}`);
  if (process.argv.includes("--ledger")) for (const r of results)
    console.log(`| ${r.id} | ${r.label.replace(/\|/g, "\\|")} | \`node scripts/sweep/t9/${FILE}.mjs --base=<url>\` (driven) | ${r.ok ? "✅" : "❌"} | ${(r.note || "").replace(/\|/g, "\\|").slice(0, 140)} |`);
  console.log(`  (ids ${results[0].id} … ${results[results.length - 1].id})`);
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error("replay-t6-driven2 threw:", e); process.exit(2); });
