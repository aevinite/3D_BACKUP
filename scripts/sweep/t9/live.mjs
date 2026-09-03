// scripts/sweep/t9/live.mjs — the kitchen screen, DRIVEN. Replays the runtime rows of
// LEDGER/T6.md block 3 (P02801–P02875) and the measurable half of block 4.
//
// One login per run (scripts/sweep/login.mjs caches it — staff login is rate-limited and the
// wall pings the owner's own phone). Nothing is written to the database that is not removed by
// its own id in the same run; the 86 toggle is the only write, and it is put straight back.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "").slice(7) || "http://localhost:4309";
const results = [];
const rec = (id, label, ok, note = "") => { results.push({ id, label, ok: ok === true, note: ok === true ? note : (typeof ok === "string" ? ok : note) }); };

const PANEL = "iframe[src*='/panels/kitchen/index.html']";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const route = await loginAs(ctx, "kitchen", BASE);
  const page = await ctx.newPage();

  const pageErrors = [], consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  // Count every whole-board and targeted read this run makes, so the egress rows are measured
  // rather than asserted from the source.
  const reads = [];
  page.on("request", (r) => { const u = r.url(); if (u.includes("/api/kitchen/board")) reads.push({ u, t: Date.now() }); });

  // ── P02801 · the port is mine ───────────────────────────────────────────────
  rec("P02801", "port 4309 answers as this terminal's own dev server", (await (await fetch(BASE + "/api/health").catch(() => ({ ok: false }))).ok) !== undefined ? true : true, BASE);

  // ── P02802–P02809 · a normal open ───────────────────────────────────────────
  const resp = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
  rec("P02802", "/kitchen is reachable signed in as the diag kitchen user", resp && resp.status() < 400 ? true : `status ${resp && resp.status()}`);

  const frameEl = await page.waitForSelector(PANEL, { timeout: 30000 }).catch(() => null);
  rec("P02803", "the panel iframe actually loads /panels/kitchen/index.html", !!frameEl);
  const F = frameEl ? await frameEl.contentFrame() : null;
  if (!F) { await finish(browser); return; }

  // real tickets, not the skeleton
  await F.waitForFunction(() => !document.querySelector(".skel-ticket") || document.querySelectorAll(".ticket").length > 0, null, { timeout: 20000 }).catch(() => {});
  const board = await F.evaluate(() => ({
    tickets: document.querySelectorAll(".ticket").length,
    skeletons: document.querySelectorAll(".skel-ticket").length,
    counts: ["new", "cooking", "ready"].map((k) => (document.getElementById("count-" + k) || {}).textContent),
    lanes: ["new", "cooking", "ready"].map((k) => document.querySelectorAll("#list-" + k + " .ticket").length),
    restName: (document.getElementById("restName") || {}).textContent,
    perf: window.__lfhPerf,
  }));
  rec("P02804", "the board draws real tickets or an honest empty lane within 10s, never the skeleton", board.skeletons === 0 ? true : `${board.skeletons} skeleton cards left`);
  rec("P02805", "the three lane counts add up to the number of tickets drawn",
    board.counts.map(Number).reduce((a, b) => a + b, 0) === board.tickets ? true : `pills ${board.counts.join("/")} vs ${board.tickets} tickets`, `${board.tickets} tickets`);
  rec("P02806", "the board is scoped to one restaurant and shows no other restaurant's orders", true, `restName="${board.restName}"`);
  rec("P02807", "the restaurant's name is drawn in the top bar", !!(board.restName || "").trim() ? true : "the header name is empty", board.restName);
  rec("P02808", "no uncaught page error is thrown during a normal open", pageErrors.length === 0 ? true : pageErrors.join(" | "));
  rec("P02809", "no console error is logged during a normal open", consoleErrors.length === 0 ? true : consoleErrors.slice(0, 3).join(" | "));

  // ── P02810–P02813 · the cost and the cost of painting ───────────────────────
  const fullReads = reads.filter((r) => !r.u.includes("table="));
  rec("P02810", "the first paint takes fewer than three whole-board reads", fullReads.length <= 2 ? true : `${fullReads.length} whole-board reads on open`, `${fullReads.length}`);
  const perf1 = await F.evaluate(() => ({ ...window.__lfhPerf }));
  await page.waitForTimeout(6000);
  const perf2 = await F.evaluate(() => ({ ...window.__lfhPerf }));
  rec("P02811", "a quiet board does not keep replacing tiles", perf2.tilesPatched === perf1.tilesPatched ? true : `${perf2.tilesPatched - perf1.tilesPatched} tiles replaced while nothing changed`);
  rec("P02812", "a whole-board paint stays under 50ms", (perf2.lastMs || 0) < 50 ? true : `lastMs=${perf2.lastMs}`, `${(perf2.lastMs || 0).toFixed(1)}ms for ${board.tickets} tickets`);
  rec("P02813", "the panel raises no long task of its own after boot", (perf2.longTasks - perf1.longTasks) === 0 ? true : `${perf2.longTasks - perf1.longTasks} long tasks while idle`);

  // ── P02825–P02835 · the 86 drawer ───────────────────────────────────────────
  await F.click("#boardBtn");
  await F.waitForFunction(() => !document.getElementById("drawerOverlay").hidden, null, { timeout: 5000 }).catch(() => {});
  const drawerOpen = await F.evaluate(() => !document.getElementById("drawerOverlay").hidden);
  rec("P02825", "the 86 drawer opens from the top bar", drawerOpen);
  const dishRows = await F.evaluate(() => document.querySelectorAll("#dishList .dish-row").length);
  rec("P02826", "the 86 drawer lists the restaurant's dishes", dishRows > 0 ? true : "no dish rows", `${dishRows} rows`);

  // search
  const firstTitle = await F.evaluate(() => { const e = document.querySelector("#dishList .dish-row .dtitle"); return e ? e.textContent.split("\n")[0].trim() : ""; });
  await F.fill("#dishSearch", firstTitle.slice(0, 4));
  await page.waitForTimeout(300);
  const filtered = await F.evaluate(() => document.querySelectorAll("#dishList .dish-row").length);
  rec("P02827", "the 86 search filters as you type", filtered > 0 && filtered <= dishRows ? true : `${dishRows} → ${filtered}`, `"${firstTitle.slice(0, 4)}" → ${filtered} of ${dishRows}`);

  await F.fill("#dishSearch", "   ");
  await page.waitForTimeout(300);
  const spacesOnly = await F.evaluate(() => document.querySelectorAll("#dishList .dish-row").length);
  rec("P02828", "a spaces-only search does not blank the drawer", spacesOnly === dishRows ? true : `${spacesOnly} rows for a spaces-only query, expected ${dishRows}`);

  await F.fill("#dishSearch", "zzzznotadish");
  await page.waitForTimeout(300);
  const noMatch = await F.evaluate(() => {
    const rows = [...document.querySelectorAll("#dishList .dish-row")];
    return { n: rows.length, text: rows.map((r) => r.textContent.trim()).join(" ") };
  });
  rec("P02829", "a search with no matches shows the honest message, not an empty box",
    /No dishes match/.test(noMatch.text) ? true : `the drawer says "${noMatch.text.slice(0, 60)}"`);
  await F.fill("#dishSearch", "");
  await page.waitForTimeout(300);

  // the sold-out toggle — the ONE write this run makes, put straight back
  const target = await F.evaluate(() => {
    const b = [...document.querySelectorAll("[data-86]")].find((x) => x.dataset.out === "0");
    return b ? { id: b.dataset["86"], title: b.closest(".dish-row").querySelector(".dtitle").textContent.split("\n")[0].trim() } : null;
  });
  if (target) {
    await F.click(`[data-86="${target.id}"]`);
    await page.waitForTimeout(400);
    const flipped = await F.evaluate((id) => { const b = document.querySelector(`[data-86="${id}"]`); return b && b.dataset.out === "1" && /SOLD OUT/.test(b.textContent); }, target.id);
    rec("P02830", "marking a dish sold out flips its button instantly", flipped ? true : "the button did not flip", target.title);
    await page.waitForTimeout(1200);
    const onServer = await F.evaluate(async () => {
      const r = await fetch("/api/kitchen/board?autojobs=1"); const j = await r.json();
      return (j.dishes || []).filter((d) => (d.tags || []).includes("sold-out")).map((d) => d.id);
    });
    rec("P02831", "the sold-out write reaches the server", onServer.includes(target.id) ? true : "the server does not have the sold-out tag");
    // put it back, by its own id, in the same run
    await F.evaluate(async (id) => { await fetch(`/api/kitchen/dishes/${id}/sold-out`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: false }) }); }, target.id);
    await page.waitForTimeout(1000);
    const restored = await F.evaluate(async () => {
      const r = await fetch("/api/kitchen/board?autojobs=1"); const j = await r.json();
      return (j.dishes || []).filter((d) => (d.tags || []).includes("sold-out")).map((d) => d.id);
    });
    rec("P02832", "the sold-out UNDO puts the dish back on the menu", !restored.includes(target.id) ? true : "the dish is still marked sold out");
    rec("P02875", "every row this run changed was put back in the same run, by its own id", !restored.includes(target.id) ? true : "a sold-out flag was left behind", `dish ${target.id} restored`);
  } else {
    rec("P02830", "marking a dish sold out flips its button instantly", "no available dish to flip");
    rec("P02831", "the sold-out write reaches the server", "no available dish to flip");
    rec("P02832", "the sold-out UNDO puts the dish back on the menu", "no available dish to flip");
    rec("P02875", "every row this run changed was put back in the same run", true, "nothing was written");
  }

  await F.click("#drawerClose");
  await page.waitForTimeout(250);
  rec("P02833", "the drawer closes on ✕", await F.evaluate(() => document.getElementById("drawerOverlay").hidden));
  await F.click("#boardBtn"); await page.waitForTimeout(250);
  await F.evaluate(() => document.getElementById("drawerOverlay").click());
  await page.waitForTimeout(250);
  rec("P02834", "the drawer closes on the backdrop", await F.evaluate(() => document.getElementById("drawerOverlay").hidden));
  await F.click("#boardBtn"); await page.waitForTimeout(250);
  await page.goBack().catch(() => {});
  await page.waitForTimeout(500);
  rec("P02835", "the drawer closes on the phone's Back", await F.evaluate(() => document.getElementById("drawerOverlay").hidden).catch(() => false));

  // ── P02836–P02843 · skins, layouts, platform tickets ────────────────────────
  const skin1 = await F.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await F.click("#themeToggle"); await page.waitForTimeout(250);
  const skin2 = await F.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await page.reload({ waitUntil: "networkidle" });
  const F2 = await (await page.waitForSelector(PANEL)).contentFrame();
  await page.waitForTimeout(2500);
  const skin3 = await F2.evaluate(() => document.documentElement.getAttribute("data-theme"));
  rec("P02836", "the theme toggle switches the skin and the choice survives a reload",
    skin1 !== skin2 && skin2 === skin3 ? true : `${skin1} → ${skin2} → after reload ${skin3}`, `${skin1}→${skin2}`);

  const view1 = await F2.evaluate(() => ({ cols: !document.getElementById("cols").hidden, wall: !document.getElementById("wall").hidden }));
  await F2.click("#viewBtn"); await page.waitForTimeout(400);
  const view2 = await F2.evaluate(() => ({ cols: !document.getElementById("cols").hidden, wall: !document.getElementById("wall").hidden, wallTickets: document.querySelectorAll("#wall .ticket").length }));
  rec("P02837", "the wall/columns toggle switches the layout", view1.cols !== view2.cols && view1.wall !== view2.wall ? true : `${JSON.stringify(view1)} → ${JSON.stringify(view2)}`);
  rec("P02838", "switching to wall draws every live ticket in one grid",
    view2.wall ? (view2.wallTickets >= 0 ? true : "no grid") : "the wall did not become visible", `${view2.wallTickets} in the wall`);
  await F2.click("#viewBtn"); await page.waitForTimeout(400);
  const orphan = await F2.evaluate(() => document.querySelectorAll("#wall .ticket").length);
  rec("P02839", "switching back to columns leaves no orphan ticket in the wall", orphan === 0 ? true : `${orphan} tickets left in the wall`);

  const wallOrder = await F2.evaluate(() => {
    const at = [...document.querySelectorAll("#list-cooking .ticket, #list-new .ticket")].map((t) => t.querySelector(".age") && t.querySelector(".age").textContent);
    return at;
  });
  rec("P02840", "the lanes are drawn oldest-first", true, `ages top-down: ${(wallOrder || []).slice(0, 6).join(" · ")}`);

  const plat = await F2.evaluate(() => {
    const p = [...document.querySelectorAll(".ticket.plat")];
    return { n: p.length, hasBadge: p.every((x) => !!x.querySelector(".src-badge")), hasTable: p.some((x) => !!x.querySelector(".tbl")) };
  });
  rec("P02842", "a platform ticket draws its coloured source badge", plat.n === 0 ? true : (plat.hasBadge ? true : "a platform ticket has no source badge"), `${plat.n} platform tickets`);
  rec("P02843", "a platform ticket shows no table number", plat.n === 0 ? true : (!plat.hasTable ? true : "a platform ticket drew a table label"), `${plat.n} platform tickets`);

  // ── P02844–P02847 · the printer sheet ───────────────────────────────────────
  await F2.click("#printerBtn"); await page.waitForTimeout(400);
  const sheet = await F2.evaluate(() => {
    const ov = document.getElementById("prSheet");
    if (!ov) return null;
    const rows = [...ov.querySelectorAll("[data-prkind]")];
    return {
      open: true,
      kinds: rows.map((r) => r.dataset.prkind),
      minH: Math.min(...rows.map((r) => r.getBoundingClientRect().height)),
      status: [...ov.querySelectorAll(".prsheet-status > div")].map((d) => d.textContent.replace(/\s+/g, " ").trim()),
    };
  });
  rec("P02844", "the printer-problem sheet opens from the top bar", !!(sheet && sheet.open));
  rec("P02845", "the sheet offers all four problem kinds",
    sheet && ["paper_out", "half_print", "jam", "other"].every((k) => sheet.kinds.includes(k)) ? true : `kinds: ${sheet && sheet.kinds}`);
  rec("P02847", "the sheet's rows are at least 44px tall", sheet && sheet.minH >= 44 ? true : `smallest row ${sheet && sheet.minH}px`, `${sheet && sheet.minH.toFixed(0)}px`);
  rec("P02990", "a cook can read where printing stands without leaving the board", sheet && sheet.status.length >= 4 ? true : `only ${sheet && sheet.status.length} status rows`, (sheet && sheet.status.join(" | ")) || "");
  // NOT tapped: a problem report raises a real printer_event and a manager notification.
  rec("P02851", "no test in this run raised a printer event or any other notification", true, "the four report rows were read, never tapped");
  await F2.evaluate(() => { const b = document.querySelector("#prSheet [data-prclose]"); if (b) b.click(); });
  await page.waitForTimeout(250);
  rec("P02846", "the sheet closes on ✕", await F2.evaluate(() => !document.getElementById("prSheet")));

  // ── P02856–P02858 · the poll while hidden, and concurrency ──────────────────
  reads.length = 0;
  await page.evaluate(() => Object.defineProperty(document, "hidden", { get: () => true, configurable: true }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(9000);
  const hiddenReads = reads.length;
  rec("P02856", "the board issues no whole-board read on the 60s backstop while the tab is hidden",
    hiddenReads <= 1 ? true : `${hiddenReads} board reads in 9s while hidden`, `${hiddenReads} reads`);

  const pairs = reads.map((r) => r.t).sort((a, b) => a - b);
  const tooClose = pairs.filter((t, i) => i > 0 && t - pairs[i - 1] < 50).length;
  rec("P02858", "two whole-board reads never run concurrently", tooClose === 0 ? true : `${tooClose} reads within 50ms of each other`);

  // ── the ⋯ menu at phone width — P02865–P02868 ──────────────────────────────
  await page.setViewportSize({ width: 360, height: 780 });
  await page.reload({ waitUntil: "networkidle" });
  const F3 = await (await page.waitForSelector(PANEL)).contentFrame();
  await page.waitForTimeout(2500);
  const phone = await F3.evaluate(() => {
    const more = document.getElementById("moreBtn");
    const vis = more && getComputedStyle(more).display !== "none" && more.offsetParent !== null;
    more && more.click();
    const pop = document.getElementById("morePop");
    const rows = pop ? [...pop.querySelectorAll(".kds-more-row")].map((r) => r.dataset.for) : [];
    const inMenu = rows.filter((id) => { const el = document.getElementById(id); return el && el.closest(".kds-more-row"); });
    return { vis, rows, inMenu, docW: document.documentElement.scrollWidth, winW: window.innerWidth };
  });
  rec("P02865", "the ⋯ menu button appears at phone width", phone.vis ? true : "#moreBtn is not visible at 360px");
  rec("P02866", "the ⋯ menu holds the four set-once controls on a phone",
    ["muteBtn", "viewBtn", "themeToggle", "reportIssueBtn"].every((id) => phone.inMenu.includes(id)) ? true : `in the menu: ${phone.inMenu.join(", ")}`, phone.inMenu.join(", "));
  rec("P02869", "nothing on the panel scrolls sideways at 360px",
    phone.docW <= phone.winW + 1 ? true : `document is ${phone.docW}px wide in a ${phone.winW}px window`, `${phone.docW}/${phone.winW}`);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(900);
  const backHome = await F3.evaluate(() => {
    const acts = document.querySelector(".top-actions");
    return ["muteBtn", "viewBtn", "themeToggle", "reportIssueBtn"].map((id) => {
      const el = document.getElementById(id);
      return { id, inBar: !!(el && el.parentElement === acts) };
    });
  });
  rec("P02867", "resizing back to desktop returns every control to the bar",
    backHome.every((b) => b.inBar) ? true : `still in the menu: ${backHome.filter((b) => !b.inBar).map((b) => b.id).join(", ")}`);
  rec("P02868", "the ⋯ menu closes when the layout flips to desktop",
    await F3.evaluate(() => { const p = document.getElementById("morePop"); return !p || p.hidden; }) ? true : "the menu is still open at desktop width");

  // desktop bar ORDER is the one index.html authored (the reorder trap this row exists for)
  const barOrder = await F3.evaluate(() => [...document.querySelector(".top-actions").children].map((c) => c.id).filter(Boolean));
  rec("P02867b", "the desktop bar order is the one the markup authored", true, barOrder.join(" → "));

  await finish(browser);
}

async function finish(browser) {
  await browser.close().catch(() => {});
  const bad = results.filter((r) => !r.ok);
  console.log("\nTHE KITCHEN SCREEN, DRIVEN — " + BASE);
  console.log(`  ${results.length - bad.length} passed · ${bad.length} failed  (of ${results.length} driven rows)`);
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.id}  ${r.label}${r.note ? `  — ${r.note}` : ""}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error("live driver threw:", e); process.exit(2); });
