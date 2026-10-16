// scripts/sweep/t12r3/dash-charts.mjs — item 25 (sweep #10, raised by T16, done by T12 on 2026-10-16):
// "let the Dashboard charts be checked with real numbers".
//
// WHY THIS EXISTS. Every earlier look at the manager Dashboard met empty cards, because French House's
// manager reaches TODAY only and the business day (05:00 IST) had no paid bills yet. An empty card
// proves the empty path; it says nothing about a chart that has numbers to draw. So this widens French
// House's reach the way the admin does it (Access → Manager → Dashboard → "How far back it reaches",
// the same POST the Access screen sends), walks every rung the manager is then given, and for each one:
//
//   · the server's /stats answer is compared with the bills in the database (same window, same rule);
//   · every one of the seven charts is read back from Chart.js — the numbers it DREW must be the
//     numbers /stats sent, and a chart with data must have painted pixels;
//   · the KPI cards, the legend toggles, the theme redraw and the phone width are driven;
//   · nothing on the page may log an error.
//
// It writes ONE thing — French House's dashboard reach — and puts it back to what it found, in a
// finally block and on Ctrl-C. Aangan is never touched.
//
//   T12_BASE=https://3-d-backup.vercel.app node scripts/sweep/t12r3/dash-charts.mjs
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";
import { loginAs, adminHeaders } from "../login.mjs";

const BASE = process.env.T12_BASE || "https://3-d-backup.vercel.app";
const FH = "00000000-0000-0000-0000-000000000001";
const env = Object.fromEntries(readFileSync(new URL("../../../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const SHOTS = process.env.T12_SHOTS || "";

// A network blip on this Mac must never be what decides whether French House gets its setting back
// (the first run lost its undo to one "fetch failed", and the same error hid what had gone wrong).
async function retry(what, fn, tries = 6) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * i)); }
  }
  throw new Error(`${what} failed ${tries} times: ${last && (last.cause?.code || last.message)}`);
}
const rows = [];
let n = 0;
const check = (label, pass, detail = "") => { n++; rows.push({ n, label, pass: !!pass, detail }); console.log(`  ${pass ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`); };

// ── the one write, and its undo ─────────────────────────────────────────────────────────────
async function reachNow() { return retry("reading French House's reach", reachOnce); }
async function reachOnce() {
  const { data, error } = await db.from("restaurants").select("access_config").eq("id", FH).single();
  if (error) throw new Error("could not read French House's reach: " + error.message);
  return data.access_config?.view_dashboard?.manager_opts?.range || "today";
}
async function setReach(range) { return retry(`saving reach ${range}`, () => setReachOnce(range)); }
async function setReachOnce(range) {
  const r = await fetch(`${BASE}/api/admin/restaurants/access-tree`, {
    method: "POST", headers: { ...adminHeaders(BASE), "Content-Type": "application/json" },
    body: JSON.stringify({ restaurant_id: FH, patch: { config: { view_dashboard: { manager_opts: { range } } } } }),
  });
  if (!r.ok) throw new Error(`the Access save answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  for (let i = 0; i < 10 && (await reachNow()) !== range; i++) await new Promise((res) => setTimeout(res, 500));
  return reachNow();
}

// ── the database's own answer, the same window and rule as the /stats route ──────────────────
function dayStart(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60000);
  const b = new Date(ist); b.setUTCHours(5, 0, 0, 0);
  if (ist < b) b.setUTCDate(b.getUTCDate() - 1);
  return new Date(b.getTime() - 330 * 60000);
}
function windowOf(range, now = new Date()) {
  const d = dayStart(now);
  const span = range === "last7" ? 7 : range === "last30" ? 30 : 1;
  const since = range === "yesterday" ? new Date(d - 864e5) : span > 1 ? new Date(d - (span - 1) * 864e5) : d;
  const until = range === "yesterday" ? d : now;
  return { since, until };
}
async function dbTruth(range) { return retry(`reading the ${range} bills`, () => dbTruthOnce(range)); }
async function dbTruthOnce(range) {
  const { since, until } = windowOf(range);
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("orders").select("id,session_id,total,status,payment_status,payment_method,deleted_at")
      .eq("restaurant_id", FH).is("deleted_at", null).gte("created_at", since.toISOString()).lt("created_at", until.toISOString())
      .order("id").range(from, from + 999);
    if (error) throw new Error("orders read failed: " + error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  const live = out.filter((o) => o.status !== "cancelled");
  const paid = live.filter((o) => o.payment_status === "paid");
  const bills = new Set(paid.map((o) => o.session_id || "solo:" + o.id));
  return { orders: live.length, paid: paid.length, unpaid: live.length - paid.length, bills: bills.size, total: paid.reduce((a, o) => a + (Number(o.total) || 0), 0) };
}

// ── what the page drew ──────────────────────────────────────────────────────────────────────
const readDash = (page) => page.evaluate(() => {
  const ids = ["chSales", "chDay", "chChan", "chTop", "chHours", "chCats", "chPay"];
  const charts = {};
  for (const id of ids) {
    const cv = document.getElementById(id);
    const ch = cv && window.Chart && Chart.getChart(cv);
    let painted = 0;
    if (cv && cv.width && cv.height) {
      const px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < px.length; i += 16) if (px[i] > 0) painted++;
    }
    charts[id] = ch ? { type: ch.config.type, labels: ch.data.labels.slice(), data: ch.data.datasets.map((d) => d.data.slice()), painted } : null;
  }
  const empties = [...document.querySelectorAll("#dashBody .dash-chart .empty")].map((e) => e.closest(".dash-chart").querySelector("h4")?.innerText.trim().split("\n")[0] + ": " + e.innerText.trim());
  // The number only — the .kval also holds the change chip ("new", "13×", "100%") beside it.
  const kpis = Object.fromEntries([...document.querySelectorAll("#dashBody [data-kpi]")].map((b) => [b.dataset.kpi, (b.querySelector(".kval [data-cu]") || b.querySelector(".kval"))?.textContent.trim()]));
  const btns = [...document.querySelectorAll(".dash-range-btn")].map((b) => ({ key: b.dataset.dashRange, on: b.classList.contains("active") }));
  return { charts, empties, kpis, btns, narrate: document.querySelector("#dashBody .narrate")?.innerText.trim() || "", body: document.getElementById("dashBody")?.innerText.slice(0, 4000) || "" };
});
const statsOf = (page, range) => page.evaluate((r) => api("GET", "/stats?range=" + r), range);
const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
const near = (a, b) => Math.abs(a - b) <= 1;   // rupees, rounded per point on the chart

async function waitDrawn(page, range) {
  // SETTLED = the screen is showing the answer it loaded FOR THIS RANGE. The button lights up the instant
  // it is tapped and the previous range's cards are still on screen while the new /stats is in flight,
  // so "button active + cards present" passed at once and read the OLD numbers (the 30-day scan is the
  // slow one — found on the first run). The panel's own memo of what it last loaded is the signal.
  await page.waitForFunction((r) => {
    const b = document.querySelector(`.dash-range-btn[data-dash-range="${r}"]`);
    const memo = typeof loadDashboard !== "undefined" && loadDashboard._last && loadDashboard._lastRange === r;
    const shown = document.querySelector('#dashBody [data-kpi="orders"] [data-cu]');
    return (!b || b.classList.contains("active")) && memo && shown && shown.dataset.cu === String(loadDashboard._last.orderCount)
      && (window.Chart || document.querySelector("#dashBody .empty"));
  }, range, { timeout: 60000 });
  await page.waitForTimeout(1500);   // count-up + Chart.js animation
}

async function main() {
  const found = await reachNow();
  console.log(`\n  ITEM 25 · manager Dashboard charts with real numbers · ${BASE}\n  French House reach before: ${found}`);
  let restored = false;
  const restore = async () => {
    if (restored) return; restored = true;
    try { const back = await setReach(found); console.log(`  French House reach put back: ${back}`); check("French House's reach is back to what it was", back === found, back); }
    catch (e) { check("French House's reach is back to what it was", false, "COULD NOT PUT IT BACK — " + e.message); }
  };
  process.on("SIGINT", async () => { await restore(); process.exit(130); });
  const browser = await chromium.launch();
  try {
    const now = await setReach("last30");
    check("the admin's Access save widened French House to 30 days", now === "last30", now);

    for (const vp of [{ name: "desktop", viewport: { width: 1440, height: 900 } }, { name: "phone", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]) {
      const ctx = await browser.newContext({ viewport: vp.viewport, hasTouch: !!vp.hasTouch, isMobile: !!vp.isMobile, deviceScaleFactor: vp.deviceScaleFactor || 1 });
      await loginAs(ctx, "manager", BASE);
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
      page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });
      await page.goto(`${BASE}/panels/editor/index.html?cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => typeof setTab === "function" && typeof XRAY_WHO !== "undefined" && XRAY_WHO && XRAY_WHO.dashReach, null, { timeout: 60000 });
      const who = await page.evaluate(() => ({ rid: (typeof PANEL_RID !== "undefined" && PANEL_RID) || "", reach: XRAY_WHO.dashReach }));
      check(`${vp.name}: the manager signed in is French House's, and the panel was told 30 days`, who.reach === "last30", `reach ${who.reach}`);
      await page.evaluate(() => setTab("dash"));
      await waitDrawn(page, "today");
      const first = await readDash(page);
      check(`${vp.name}: the range toggle offers exactly the four rungs, nothing greyed`, JSON.stringify(first.btns.map((b) => b.key)) === JSON.stringify(["today", "yesterday", "last7", "last30"]), first.btns.map((b) => b.key).join(","));

      for (const range of ["today", "yesterday", "last7", "last30"]) {
        const tag = `${vp.name} · ${range}`;
        await page.click(`.dash-range-btn[data-dash-range="${range}"]`);
        await waitDrawn(page, range);
        const d = await readDash(page);
        const s = await statsOf(page, range);
        const t = await dbTruth(range);
        check(`${tag}: the toggle shows ${range} as the active rung`, d.btns.find((b) => b.key === range)?.on, "");
        check(`${tag}: paid orders on the server = paid orders in the database`, s.paid === t.paid, `server ${s.paid} · database ${t.paid}`);
        check(`${tag}: unpaid orders on the server = the database`, s.unpaid === t.unpaid, `server ${s.unpaid} · database ${t.unpaid}`);
        check(`${tag}: orders on the server = the database (cancelled left out)`, s.orderCount === t.orders, `server ${s.orderCount} · database ${t.orders}`);
        check(`${tag}: revenue on the server = the stored totals of the paid bills`, near(s.revenue, t.total), `server ${s.revenue} · database ${t.total.toFixed(2)}`);
        check(`${tag}: the Orders card shows the server's order count`, d.kpis.orders === String(s.orderCount), `${d.kpis.orders} vs ${s.orderCount}`);
        const hasMoney = s.revenue > 0;
        // Sales line
        const sales = d.charts.chSales;
        if (hasMoney && (s.series || []).some((p) => p.revenue > 0)) {
          check(`${tag}: Sales line drew`, sales && sales.type === "line" && sales.painted > 0, sales ? `${sales.painted} painted samples` : "no chart");
          check(`${tag}: Sales line's points are the server's series, point for point`, sales && JSON.stringify(sales.data[0]) === JSON.stringify(s.series.map((p) => Math.round(p.revenue || 0))), "");
          check(`${tag}: Sales line adds up to the revenue`, sales && near(sum(sales.data[0]), sum(s.series.map((p) => Math.round(p.revenue || 0)))) && Math.abs(sum(s.series.map((p) => p.revenue || 0)) - s.revenue) <= 1, `line ${sales ? sum(sales.data[0]) : "-"} · revenue ${s.revenue}`);
          check(`${tag}: no "No sales in this range yet" while there are sales`, !d.empties.some((e) => /No sales in this range yet/.test(e)), d.empties.join(" | "));
          check(`${tag}: the sentence under Sales names the revenue`, /you've made/.test(d.narrate), d.narrate.slice(0, 120));
        } else {
          check(`${tag}: no money in this range, so Sales says so instead of drawing`, !sales && d.empties.some((e) => /^Sales/.test(e)), d.empties.join(" | "));
        }
        // Channels donut
        const chan = Object.entries(s.channels || {}).filter(([, v]) => (v.rev || 0) > 0);
        if (chan.length) check(`${tag}: Channels donut = the server's channel money`, d.charts.chChan && near(sum(d.charts.chChan.data[0]), sum(chan.map(([, v]) => Math.round(v.rev)))) && d.charts.chChan.painted > 0, d.charts.chChan ? `${sum(d.charts.chChan.data[0])} vs ${sum(chan.map(([, v]) => Math.round(v.rev)))}` : "no chart");
        else check(`${tag}: no channel money, Channels card says so`, !d.charts.chChan, "");
        // Top dishes
        if ((s.topDishes || []).length) check(`${tag}: Top dishes bars are the server's dishes and plates`, d.charts.chTop && JSON.stringify(d.charts.chTop.labels) === JSON.stringify(s.topDishes.map(([x]) => x)) && JSON.stringify(d.charts.chTop.data[0]) === JSON.stringify(s.topDishes.map(([, q]) => q)) && d.charts.chTop.painted > 0, d.charts.chTop ? d.charts.chTop.labels.slice(0, 3).join(", ") : "no chart");
        else check(`${tag}: no dishes, Top dishes says so`, !d.charts.chTop, "");
        // Busy hours: drawn only with two or more busy hours; the bars are a window of s.hours
        const live = (s.hours || []).filter((v) => v > 0).length;
        if (live >= 2) check(`${tag}: Busy hours shows every order the server counted by hour`, d.charts.chHours && sum(d.charts.chHours.data[0]) === sum(s.hours) && d.charts.chHours.painted > 0, d.charts.chHours ? `${sum(d.charts.chHours.data[0])} vs ${sum(s.hours)}` : "no chart");
        else check(`${tag}: under two busy hours, Busy hours writes a sentence instead of a lonely bar`, !d.charts.chHours, `${live} busy hour(s)`);
        // Day parts: drawn only with two or more populated parts
        const dpLive = (s.dayParts || []).filter((p) => p.revenue > 0 || p.orders > 0).length;
        if (dpLive >= 2) check(`${tag}: Day parts bars add up to the day-part money`, d.charts.chDay && near(sum(d.charts.chDay.data[0]), sum((s.dayParts || []).filter((p, i) => i < 4 || p.orders > 0 || p.revenue > 0).map((p) => Math.round(p.revenue)))) && d.charts.chDay.painted > 0, "");
        else check(`${tag}: under two busy day parts, Day parts writes a sentence`, !d.charts.chDay, `${dpLive} part(s)`);
        // Category share: plates per category (the top six, the rest folded into one)
        const catTotal = sum(Object.values(s.cats || {}));
        if (catTotal > 0) check(`${tag}: Category donut counts every plate the server counted`, d.charts.chCats && sum(d.charts.chCats.data[0]) === catTotal && d.charts.chCats.painted > 0, d.charts.chCats ? `${sum(d.charts.chCats.data[0])} vs ${catTotal}` : "no chart");
        else check(`${tag}: no plates, Category share says so`, !d.charts.chCats, "");
        // Payment methods: money per method; the donut's total is the collected money
        const pay = (s.paymentMethods || []).filter(([, r]) => r > 0);
        if (pay.length) {
          check(`${tag}: Payment donut = the server's money per method`, d.charts.chPay && near(sum(d.charts.chPay.data[0]), sum(pay.map(([, r]) => r))) && d.charts.chPay.painted > 0, d.charts.chPay ? `${sum(d.charts.chPay.data[0]).toFixed(2)} vs ${sum(pay.map(([, r]) => r)).toFixed(2)}` : "no chart");
          check(`${tag}: money by payment method adds up to the revenue`, near(sum(pay.map(([, r]) => r)), s.revenue), `${sum(pay.map(([, r]) => r)).toFixed(2)} vs ${s.revenue}`);
        } else check(`${tag}: no paid bills, Payment methods says so`, !d.charts.chPay, "");
        // Every chart that drew is honest about what it drew: no NaN, no negative
        const bad = Object.entries(d.charts).filter(([, c]) => c && c.data.flat().some((v) => !Number.isFinite(Number(v)) || Number(v) < 0)).map(([k]) => k);
        check(`${tag}: no chart holds a NaN or a negative number`, !bad.length, bad.join(","));
        check(`${tag}: no "undefined", "NaN" or "null" anywhere in the words`, !/\bundefined\b|\bNaN\b|\bnull\b/.test(d.body), "");
        if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/dash-${vp.name}-${range}.png`, fullPage: true }); }
      }

      // Legend rows hide a slice and bring it back (on whichever donut has 2+ slices on the widest rung).
      const leg = await page.evaluate(() => {
        for (const [legId, cvId] of [["payLegend", "chPay"], ["catLegend", "chCats"], ["chanLegend", "chChan"]]) {
          const rows = document.querySelectorAll(`#${legId} .pay-row`);
          const ch = Chart.getChart(document.getElementById(cvId));
          if (rows.length >= 2 && ch) {
            rows[0].click(); const hid = ch.getDataVisibility(0) === false && rows[0].classList.contains("off");
            rows[0].click(); const back = ch.getDataVisibility(0) === true && !rows[0].classList.contains("off");
            return { legId, hid, back };
          }
        }
        return null;
      });
      check(`${vp.name}: tapping a legend row hides that slice, tapping again brings it back`, leg && leg.hid && leg.back, leg ? leg.legId : "no donut with two slices");

      // Theme flip redraws from the cached numbers — no second /stats scan.
      const asked = await page.evaluate(async () => {
        const before = performance.getEntriesByType("resource").filter((e) => /\/stats\?/.test(e.name)).length;
        const cur = document.documentElement.getAttribute("data-theme") || "light";
        document.documentElement.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
        await new Promise((r) => setTimeout(r, 2500));
        const after = performance.getEntriesByType("resource").filter((e) => /\/stats\?/.test(e.name)).length;
        const drawn = ["chSales", "chPay"].map((id) => document.getElementById(id)).filter((c) => c && Chart.getChart(c)).length;
        document.documentElement.setAttribute("data-theme", cur);
        return { before, after, drawn };
      });
      check(`${vp.name}: a light/dark flip redraws the charts without asking the server again`, asked.after === asked.before && asked.drawn > 0, `stats calls ${asked.before}→${asked.after}, ${asked.drawn} charts redrawn`);

      // The Revenue card opens the bills it counts.
      await page.click('#dashBody [data-kpi="revenue"]');
      await page.waitForFunction(() => state.tab === "orders", null, { timeout: 15000 }).catch(() => {});
      check(`${vp.name}: the Revenue card opens Previous bills`, await page.evaluate(() => state.tab === "orders" && state.ordersView === "previous"), "");
      if (vp.name === "phone") {
        await page.evaluate(() => setTab("dash")); await waitDrawn(page, "last30");
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check("phone: the Dashboard never scrolls sideways at 390px", wide <= 0, `${wide}px wider`);
      }
      const realErrs = errs.filter((e) => !/favicon|ERR_ABORTED|Failed to load resource: the server responded with a status of 40[14]/.test(e));
      check(`${vp.name}: nothing on the page logged an error`, !realErrs.length, realErrs.slice(0, 3).join(" | "));
      await ctx.close();
    }
  } catch (e) {
    check("the run finished without a crash", false, e.message.split("\n")[0]);
  } finally {
    await restore();
    await browser.close();
  }
  const bad = rows.filter((r) => !r.pass);
  console.log(`\n  ${rows.length} checks · ✅ ${rows.length - bad.length} · ❌ ${bad.length}`);
  if (process.env.T12_JSON) { const { writeFileSync } = await import("node:fs"); writeFileSync(process.env.T12_JSON, JSON.stringify(rows, null, 1)); }
  process.stdout.write("", () => process.exit(bad.length ? 1 : 0));
}
main().catch(async (e) => { console.error("  ✗ " + e.message); process.stdout.write("", () => process.exit(2)); });
