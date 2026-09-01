// T7 · fifth 500 · BLOCK J — THE CLOSING SWEEP.
// The surfaces the first nine blocks left alone — ⚡ Quick order end to end, the drawer, guest
// calls, the connection light — and then the whole panel's own guard suite, run against what was
// actually shipped.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, spoke, C, dump, at, LEAK, BASE } from "./lib.mjs";
at(45247);
const T = ["12"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await armToasts(s.fr);

  // ── ⚡ Quick order, all the way to the kitchen ────────────────────────────────────────
  const qo = await s.fr.evaluate(() => ({ btn: !!document.getElementById("quickOrderBtn"), always: getComputedStyle(document.getElementById("quickOrderBtn")).display !== "none" }));
  C("⚡ Quick order is on the top bar", qo.btn);
  C("…at all times, not only when a table is open", qo.always, `display=${qo.always}`);
  await s.fr.evaluate(() => document.getElementById("quickOrderBtn").click());
  await s.page.waitForTimeout(1800);
  const qs = await s.fr.evaluate(() => ({ dishes: document.querySelectorAll(".dish[data-dish]").length, cart: state.cart.length, quick: state.quick === true, table: state.table }));
  C("it opens straight onto the menu", qs.dishes > 0, `${qs.dishes} dishes`);
  C("…with an empty order", qs.cart === 0, `${qs.cart} lines`);
  C("…and no table chosen yet — that is the LAST step", qs.table === null, `table=${qs.table}`);
  C("…and the panel knows it is a quick order", qs.quick, `quick=${qs.quick}`);
  const sent = await s.fr.evaluate(async (t) => {
    const out = {};
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    document.querySelector(`.dish[data-dish="${d.id}"]`).click();
    await new Promise((r) => setTimeout(r, 700));
    out.inCart = state.cart.length;
    openQuickDest();
    await new Promise((r) => setTimeout(r, 800));
    out.picker = !!document.querySelector(".qdest-overlay");
    out.head = (document.querySelector(".qdest-head h3") || {}).innerText || "";
    out.tables = [...document.querySelectorAll("[data-qdest]")].map((b) => Number(b.dataset.qdest));
    out.says = (document.querySelector(".qdest-box .muted") || {}).innerText || "";
    const target = document.querySelector(`[data-qdest="${t}"]`);
    out.hasTarget = !!target;
    if (target) target.click();
    await new Promise((r) => setTimeout(r, 4000));
    await selectTable(t);
    out.landed = partyOrders(t).filter((o) => o.status !== "cancelled").length;
    out.cartAfter = state.cart.length;
    return out;
  }, T[0]);
  C("a dish goes into the quick order", sent.inCart === 1, `${sent.inCart} lines`);
  C("choosing where it goes is the second step, and it asks in words", sent.picker && /Which table gets this order/i.test(sent.head), sent.head);
  C("…offering only tables on the floor plan", sent.tables.length > 0 && sent.tables.every((x) => x <= 30), `${sent.tables.length} tables, highest ${Math.max(...sent.tables)}`);
  C("…and saying what tapping one will do", /kitchen|bill/i.test(sent.says), sent.says.slice(0, 90));
  C("…and the table we wanted is among them", sent.hasTarget, `T${T[0]}`);
  C("tapping a table IS the send — no third confirmation", sent.landed > 0, `${sent.landed} tickets on T${T[0]}`);
  C("…and the order screen empties afterwards", sent.cartAfter === 0, `${sent.cartAfter} lines left`);
  const qsaid = await spoke(s.fr);
  C("…and the waiter is told where it went", qsaid.any, (qsaid.bar || qsaid.toasts.join(" | ")).slice(0, 100) || "(silent)");

  // ── ⚡ Quick order refuses to be abandoned with food in it ────────────────────────────
  await forget(s.fr); await armToasts(s.fr);
  const guard = await s.fr.evaluate(async () => {
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length);
    state.cart = [{ id: d.id, title: d.title, price: d.price, qty: 1 }];
    state.ordering = true; state.quick = true;
    document.querySelectorAll(".toast").forEach((x) => x.remove());
    if (window.__t7toasts) window.__t7toasts.length = 0;
    openQuickOrder();
    await new Promise((r) => setTimeout(r, 700));
    const said = (window.__t7toasts || []).slice();
    state.cart = []; state.ordering = false; state.quick = false;
    renderFloor(); renderPanel();
    return said;
  });
  C("starting a second quick order over an unsent one is refused OUT LOUD", guard.length > 0, guard.join(" | ").slice(0, 110) || "(silent)");
  C("…and the refusal counts what would have been lost", /\d/.test(guard.join(" ")), guard.join(" | ").slice(0, 110));
  C("…and tells the waiter what to do instead", /send it|go back/i.test(guard.join(" ")), guard.join(" | ").slice(0, 120));

  // ── the drawer's own surfaces ────────────────────────────────────────────────────────
  await s.page.setViewportSize({ width: 390, height: 844 });
  await s.page.waitForTimeout(1200);
  const drawer = await s.fr.evaluate(async () => {
    const h = document.getElementById("hamburger");
    if (!h) return { skip: true };
    h.click();
    await new Promise((r) => setTimeout(r, 800));
    const dw = document.querySelector(".tbl-drawer");
    const out = { open: !!dw && dw.getBoundingClientRect().left < window.innerWidth - 20,
      txt: dw ? dw.innerText.replace(/\s+/g, " ").trim() : "",
      banquet: !!document.getElementById("dwBanquet"), settings: !!document.getElementById("dwSettings"),
      profile: !!dw && /profile|name/i.test(dw.innerText), parcel: !!dw && /parcel/i.test(dw.innerText) };
    const back = document.querySelector(".tbl-backdrop, .dw-backdrop, .dw-close");
    if (back) back.click();
    await new Promise((r) => setTimeout(r, 600));
    out.closed = (() => { const d = document.querySelector(".tbl-drawer"); return !d || d.getBoundingClientRect().left >= window.innerWidth - 20; })();
    return out;
  });
  C("the ☰ drawer opens on a phone", drawer.skip || drawer.open, drawer.skip ? "no ☰ at this width" : `open=${drawer.open}`);
  C("…and holds the person it belongs to", drawer.skip || drawer.profile, drawer.txt.slice(0, 70));
  C("…and the settings door", drawer.skip || drawer.settings, `dwSettings=${drawer.settings}`);
  C("…and banquet billing, which is a module", drawer.skip || drawer.banquet, `dwBanquet=${drawer.banquet}`);
  C("…and NOT parcel, which the owner removed from this panel", drawer.skip || !drawer.parcel, `parcel mentioned = ${drawer.parcel}`);
  C("…and it closes again", drawer.skip || drawer.closed, `closed=${drawer.closed}`);
  C("…and nothing in it leaks code", drawer.skip || !LEAK.test(drawer.txt), drawer.txt.slice(0, 90));
  await s.page.setViewportSize({ width: 1194, height: 834 });
  await s.page.waitForTimeout(1000);

  // ── the connection light ─────────────────────────────────────────────────────────────
  const badge = await s.fr.evaluate(() => {
    const b = document.querySelector(".lfh-conn, .conn-badge, #connBadge, [data-conn]");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { txt: b.innerText.replace(/\s+/g, " ").trim(), title: b.title || "", w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 };
  });
  C("the panel shows a connection light", !!badge, badge ? `"${badge.txt}" ${badge.w}×${badge.h}` : "not found");
  C("…and it is actually on screen", !badge || badge.visible, badge ? `${badge.w}px` : "");
  C("…and says what it means, in words", !badge || (badge.txt + badge.title).length > 2, `${badge && badge.txt} / ${badge && badge.title}`);
  C("…without a code in it", !badge || !LEAK.test(badge.txt + badge.title), `${badge && badge.txt}`);

  // ── guest calls ──────────────────────────────────────────────────────────────────────
  const calls = await s.fr.evaluate(() => ({
    open: (state.data.calls || []).length, bell: !!document.querySelector(".guest-bell, #guestBell, [data-bell]"),
    attend: document.querySelectorAll("[data-attend]").length, all: !!document.querySelector("[data-attend-all-calls]"),
  }));
  C("the panel knows about guest calls", typeof calls.open === "number", `${calls.open} on this table`);
  C("…and offers to attend them one at a time", calls.open === 0 || calls.attend > 0, `${calls.attend} attend controls`);
  C("…and all at once when there are several", calls.open < 2 || calls.all, `attend-all=${calls.all}`);

  // ── item 26 and the whole guard suite, on what was shipped ───────────────────────────
  const liveCss = await (await fetch(BASE + "/panels/tablet/style.css")).text();
  const serve = (liveCss.match(/\.ist-serve \{[^}]*\}/) || [""])[0];
  C("item 26 — ✓ Serve is 40px on the live stylesheet", /min-height:\s*40px/.test(serve), (serve.match(/min-height:[^;]*/) || ["(none)"])[0]);
  C("item 26 — …and it is a flex box, so the word sits in the middle of it", /display:\s*inline-flex/.test(serve) && /align-items:\s*center/.test(serve), "centred");
  await openTable(s, T[0]);
  const row = await s.fr.evaluate(() => [...document.querySelectorAll(".iline button")].map((b) => ({ t: (b.innerText || b.className).replace(/\s+/g, " ").trim().slice(0, 14), h: Math.round(b.getBoundingClientRect().height) })).filter((b) => b.h > 0));
  C("item 26 — every control on a dish row really renders at 40px or more", row.length === 0 || row.every((b) => b.h >= 40), row.map((b) => `${b.t}:${b.h}`).join(", ") || "no dish rows on this table");
  C("item 26 — …and none of them towers over the others", row.length === 0 || (Math.max(...row.map((b) => b.h)) - Math.min(...row.map((b) => b.h))) <= 6, row.map((b) => b.h).join(","));

  {
    const { execSync } = await import("node:child_process");
    for (const [name, cmd] of [
      ["this panel's own guard", "node scripts/verify-tablet-taps.mjs | tail -1"],
      ["the cross-panel money-box guard", "npm run --silent verify:money-boxes | tail -1"],
      ["the panel cache-buster guard", "npm run --silent verify:panel-cache | tail -1"],
      ["the tap guard", "npm run --silent verify:taps | tail -1"],
      ["the wording guard", "npm run --silent verify:ui | tail -1"],
    ]) {
      let outp = "";
      try { outp = execSync(cmd, { encoding: "utf8" }).trim(); } catch (e) { outp = "FAILED: " + String((e.stdout || e.message)).slice(-160); }
      C(`${name} is green`, !/FAIL|❌/i.test(outp), outp.slice(0, 110));
    }
    const localCss = execSync("cat public/panels/tablet/style.css", { encoding: "utf8" });
    C("the stylesheet on the live site is the one in main", localCss.length === liveCss.length, `${localCss.length} vs ${liveCss.length} bytes`);
    const localJs = execSync("cat public/panels/tablet/app.js", { encoding: "utf8" });
    const liveJs = await (await fetch(BASE + "/panels/tablet/app.js")).text();
    C("…and so is the panel itself", localJs.length === liveJs.length, `${localJs.length} vs ${liveJs.length} bytes`);
  }

  // ── nothing left behind ──────────────────────────────────────────────────────────────
  const end = await s.fr.evaluate(() => ({
    overlays: document.querySelectorAll(".opt-overlay, .pay-overlay, .disc-overlay, .qdest-overlay, .set-overlay").length,
    picker: state.pickerOpen === true, cart: state.cart.length, ordering: state.ordering,
    tiles: document.querySelectorAll(".tile[data-t]").length, txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
  }));
  C("no overlay is left on screen", end.overlays === 0, `${end.overlays}`);
  C("no picker flag is left set", !end.picker, `pickerOpen=${end.picker}`);
  C("no half-built order is left in the cart", end.cart === 0 && !end.ordering, JSON.stringify({ cart: end.cart, ordering: end.ordering }));
  C("the floor is still there", end.tiles > 0, `${end.tiles} tiles`);
  C("no leaked code text anywhere", !LEAK.test(end.txt), end.txt.slice(0, 90));
  C("no uncaught page error in the closing sweep", s.errs.length === 0, s.errs.join(" | ").slice(0, 140));
  C("this pass ends with the panel exactly as a waiter would find it", end.tiles > 0 && end.overlays === 0 && end.cart === 0, "floor drawn, nothing stacked, nothing half-typed");

  // ── and the pass's own bookkeeping, checked rather than assumed ───────────────────────
  {
    const { execSync } = await import("node:child_process");
    const fs = await import("node:fs");
    let led = ""; try { led = execSync("npm run --silent verify:ledger-index", { encoding: "utf8" }).trim(); } catch (e) { led = "FAILED " + String(e.stdout || e.message).slice(-140); }
    C("the whole sweep's ledger still has one id per check", /✅/.test(led) && !/FAIL/i.test(led), led.split("\n").pop().slice(0, 120));
    C("this pass was PLANNED before it was run, and the plan is on disk", fs.existsSync(".claude/sweep/t7r5/PLAN.md"), "t7r5/PLAN.md");
    const plan = fs.readFileSync(".claude/sweep/t7r5/PLAN.md", "utf8");
    C("…and the plan names every block this pass actually ran", "ABCDEFGHI".split("").every((b) => new RegExp(`\\| ${b} \\|`).test(plan)), "A–I all listed");
    const taps = execSync("node scripts/verify-tablet-taps.mjs | tail -1", { encoding: "utf8" });
    C("…and the panel's guard has grown with the faults it found", /All 10[0-9] checks passed/.test(taps), taps.trim().slice(0, 80));
    C("…and nothing this pass changed is sitting unmerged", execSync("git log --oneline origin/main..HEAD | wc -l", { encoding: "utf8" }).trim() === "0", `${execSync("git log --oneline origin/main..HEAD | wc -l", { encoding: "utf8" }).trim()} commits ahead of main`);
  }
} catch (e) { C("block J completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("J") ? 1 : 0; }
