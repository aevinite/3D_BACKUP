// Band A — THE DOCKET, driven. Every one of the five tile sheets, in four real setups.
// ids P189001–P189180 (4 setups × 5 tiles × 9 checks — a FIXED shape; the band refuses to run if it
// changes, so an id always means the same check).
//
//   node scripts/sweep/t20s10/band-a-docket.mjs --base http://localhost:4420 [--json=<file>]
//
// components/owner/TileDocket.tsx landed on 2026-10-04 and NO ledger row anywhere names it (measured
// at the start of this run: 0 rows by subject). It is the newest code in this territory and the sheet
// the owner opens every time he presses a figure, so it gets the first and biggest band.
//
// The four setups: desktop 1280 dark and light (the one-restaurant diag owner), an A35-sized phone
// 360x780 dpr3 with touch (same owner), and an iPad 1194x834 light as the two-restaurant owner on the
// all-restaurants view. Each tile is closed a DIFFERENT way in turn (Escape, ✕, the backdrop, the
// phone's BACK), so every setup proves all four ways out.
import { openWith, closeBrowser } from "../t13/r2lib.mjs";
import { chk, report, junk } from "./lib.mjs";

const TD = "components/owner/TileDocket.tsx", PG = "app/owner/page.tsx";
const SETUPS = [
  { name: "desktop 1280 dark", width: 1280, height: 800, skin: "dark" },
  { name: "desktop 1280 light", width: 1280, height: 800, skin: "light" },
  { name: "A35 phone 360 dark", width: 360, height: 780, skin: "dark", mobile: true },
  { name: "iPad 1194 light, two restaurants", width: 1194, height: 834, skin: "light", creds: { username: "diagmulti", password: "diag-multi-2026", route: "/owner" } },
];
const TILES = ["Revenue", "Orders", "Today so far", "Expenses", "On hand"];
const CLOSERS = ["Escape", "✕", "backdrop", "BACK"];
const EXPECT = SETUPS.length * TILES.length * 9;

// "₹34k" / "₹1.4L" / "98" / "₹0" → [value, half a display unit]
function face(t) {
  const s = t.replace(/[,\s]/g, "").replace("−", "-");
  const m = /^(-?)₹?(\d+(?:\.\d+)?)(k|L|Cr)?$/.exec(s);
  if (!m) return null;
  const unit = { k: 1e3, L: 1e5, Cr: 1e7 }[m[3]] || 1;
  return [Number(m[1] + m[2]) * unit, m[3] ? unit * 0.05 + 1 : 0.5];
}
const num = (t) => { const s = String(t).replace(/[^\d.−-]/g, "").replace("−", "-"); return s ? Number(s) : NaN; };

let base = 189001;
for (const [si, S] of SETUPS.entries()) {
  const { pg, errs } = await openWith({ creds: S.creds || null, width: S.width, height: S.height, skin: S.skin, mobile: !!S.mobile, settle: 7000 });
  await pg.waitForSelector(".ow2-stats5 .ow2-kpi", { timeout: 60000 });
  // wait until every tile has a real figure (not the loading skeleton)
  await pg.waitForFunction(() => document.querySelectorAll(".ow2-stats5 .anim-skel").length === 0, null, { timeout: 90000 }).catch(() => {});
  for (const [ti, T] of TILES.entries()) {
    const id = (k) => `P${base + si * 45 + ti * 9 + k}`;
    const how = `${S.name}: press the ${T} tile on /owner`;
    const tile = pg.locator(".ow2-stats5 .ow2-kpi").nth(ti);
    const faceText = (await tile.locator(".v").innerText()).trim();
    // A phone is touch ONLY. Mixing a mouse click with a touch tap leaves a phantom mouse cursor that
    // Chrome then "moves away", firing mouseleave and wiping the readout — measured, and not what a
    // real phone does (no cursor exists). So on the phone setup every press is a tap.
    if (S.mobile) await tile.tap(); else await tile.click();
    const opened = await pg.waitForSelector(".tdk-wrap[role=dialog]", { timeout: 10000 }).then(() => true, () => false);
    await pg.waitForTimeout(450);
    const sheet = opened ? await pg.locator(".tdk").innerText() : "";
    const bigText = opened ? (await pg.locator(".tdk .big").innerText()).trim() : "";

    await chk(id(0), TD, `${T}: pressing the tile opens a dialog sheet headed with the tile's own name`, how, async () =>
      (opened && (await pg.locator(".tdk header b").innerText()).trim().toUpperCase() === T.toUpperCase()) || `opened=${opened} sheet head=${opened ? await pg.locator(".tdk header b").innerText() : "-"}`);
    await chk(id(1), PG, `${T}: the sheet's headline figure is the tile's own figure (${faceText} on the tile)`, how + ", compare the sheet's big figure with the tile face", () => {
      const f = face(faceText), b = num(bigText);
      if (!f) return `tile face "${faceText}" is not a figure`;
      return Math.abs(b - f[0]) <= f[1] || `sheet ${bigText} vs tile ${faceText}`;
    });
    await chk(id(2), TD, `${T}: no code text (undefined / NaN / [object Object] / \${) anywhere on the sheet`, how, () => junk(sheet).length === 0 || junk(sheet).join(", "));
    const geo = opened ? await pg.evaluate(() => {
      const r = document.querySelector(".tdk").getBoundingClientRect();
      const f = document.querySelector(".tdk footer .full");
      const fr = f ? f.getBoundingClientRect() : null; const fs = f ? getComputedStyle(f) : null;
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth,
        fH: fr ? fr.height : 0, fBg: fs ? fs.backgroundColor : "", fOff: f ? f.classList.contains("off") : null, fText: f ? f.textContent : "" };
    }) : null;
    await chk(id(3), TD, `${T}: the sheet sits fully inside the screen and the page does not scroll sideways`, how, () =>
      (geo && geo.l >= -0.5 && geo.r <= geo.vw + 0.5 && geo.t >= -0.5 && geo.b <= geo.vh + 0.5 && geo.docW <= geo.vw) || JSON.stringify(geo));
    await chk(id(4), TD, `${T}: the "See the full detail" button is a real 44px button with its own fill (not bare text)`, how, () =>
      (geo && geo.fH >= 44 && (geo.fOff || (geo.fBg !== "rgba(0, 0, 0, 0)" && geo.fBg !== "transparent")) && /full detail|switched off/i.test(geo.fText)) || JSON.stringify(geo && { h: geo.fH, bg: geo.fBg, off: geo.fOff, text: geo.fText }));

    // the readout line answers a hover (desktop) or a tap (touch) at once
    await chk(id(5), TD, `${T}: every chart on the sheet either draws and answers a ${S.mobile ? "tap" : "hover"} on its readout line, or says plainly there is not enough to draw`, how, async () => {
      const blocks = await pg.locator(".tdk .rcol > div").count();
      const empties = await pg.locator(".tdk .rcol .empty").count();
      const targets = pg.locator(".tdk .rcol svg.chart g, .tdk .rcol svg.chart rect[fill=transparent], .tdk .rcol .shb i");
      const nT = await targets.count();
      if (!blocks) return true;                                 // a tile that draws no chart by design (Expenses has only a share bar)
      if (!nT) return empties > 0 || "a chart block with neither a chart nor the empty sentence";
      const before = (await pg.locator(".tdk .rd").first().innerText()).trim();
      const target = targets.nth(Math.floor(nT / 2));
      if (S.mobile) await target.tap({ force: true }); else await target.hover({ force: true });
      await pg.waitForTimeout(150);
      const lines = await pg.locator(".tdk .rd").allInnerTexts();
      const live = await pg.locator(".tdk .rd.live").count();
      return (live >= 1 && lines.some((l) => l.trim() !== before && l.trim().length > 0)) || `readout stayed "${before}" (${lines.join(" / ")})`;
    });
    await chk(id(6), TD, `${T}: a share bar, when drawn, is biggest-first and its slices add up to the whole`, how, async () => {
      const pcts = await pg.locator(".tdk .shl .shr .p").allInnerTexts();
      if (!pcts.length) return true;
      const v = pcts.map((p) => parseFloat(p));
      const sum = v.reduce((a, b) => a + b, 0);
      const sorted = v.every((x, i) => !i || x <= v[i - 1] + 0.05);
      return (sorted && Math.abs(sum - 100) <= 1.5) || `shares ${pcts.join(" ")} (sum ${sum})`;
    });
    await chk(id(7), TD, `${T}: every row has a label, a dotted leader and a value, and the rows are evenly spaced`, how, async () => {
      // The owner's rule (2026-10-04): when ANY row explains itself, a row WITHOUT an explanation still
      // keeps that line, so the gaps match. A long explanation that wraps to two lines is content, not
      // a ragged gap — so the test is that no unexplained row is shorter than the shortest explained one.
      const rows = await pg.$$eval(".tdk .rows .r", (rs) => rs.map((r) => ({ l: r.querySelector(".l")?.textContent?.trim(), v: r.querySelector(".v")?.textContent?.trim(), d: !!r.querySelector(".dots"), h: r.getBoundingClientRect().height, hint: !!(r.querySelector("small")?.textContent || "").trim(), total: r.classList.contains("total") })));
      const plain = rows.filter((r) => !r.total);
      const hinted = plain.filter((r) => r.hint), bare = plain.filter((r) => !r.hint);
      const floor = hinted.length ? Math.min(...hinted.map((r) => r.h)) : null;
      const even = floor == null ? bare.every((r) => Math.abs(r.h - bare[0].h) <= 1.5) : bare.every((r) => Math.abs(r.h - floor) <= 1.5);
      return (rows.length >= 2 && rows.every((r) => r.l && r.v && r.d) && even) || JSON.stringify(rows);
    });
    // close — a different way per tile
    const way = CLOSERS[(ti + si) % 4];
    const urlBefore = pg.url();
    if (way === "Escape") await pg.keyboard.press("Escape");
    else if (way === "✕") { if (S.mobile) await pg.locator(".tdk .x").tap(); else await pg.locator(".tdk .x").click(); }
    else if (way === "backdrop") {
      const x = 4, y = Math.max(4, Math.floor(S.height * (S.width <= 860 ? 0.03 : 0.5)));
      if (S.mobile) await pg.touchscreen.tap(x, y); else await pg.mouse.click(x, y);
    }
    else await pg.evaluate(() => history.back());
    const closed = await pg.waitForSelector(".tdk-wrap", { state: "detached", timeout: 6000 }).then(() => true, () => false);
    await pg.waitForTimeout(400);
    await chk(id(8), TD, `${T}: closing with ${way} removes the sheet and leaves him on the same dashboard`, how + `, then close it with ${way}`, async () =>
      (closed && new URL(pg.url()).pathname === new URL(urlBefore).pathname && (await pg.locator(".ow2-stats5").count()) === 1) || `closed=${closed} url=${pg.url()}`);
    if (!closed) { await pg.keyboard.press("Escape"); await pg.waitForTimeout(300); }
  }
  const pageErrs = errs.filter((e) => !/panel-login|favicon|model-viewer|React DevTools|inventory\?only=counts|status of 403/i.test(e));
  if (pageErrs.length) console.log(`  (console, ${S.name}): ${pageErrs.slice(0, 5).join(" | ")}`);
  await pg.context().close();
}
await closeBrowser();
report("T20 band A · the docket, driven (P189001–P189180)", { expect: EXPECT });
process.exit(process.exitCode || 0);
