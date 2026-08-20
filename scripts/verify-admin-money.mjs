// verify-admin-money — the ADMIN's money view: Platform analytics, Platform revenue, Customers and
// the Bill ledger. Eight faults found by the T18 sweep (2026-08-20) live here; each section below is
// the one that goes red if that fault comes back.
//
//   node scripts/verify-admin-money.mjs [--base http://localhost:4000]
//
// Sections A-B and the source half of D/F/G run WITHOUT a server. Everything else drives the real
// console signed in with the admin cookie (never a password POST — that is how a guard once raised a
// rate-limit alert about the owner's own panel). It writes nothing, to any restaurant, ever.
//
//   A  Bills: BOTH ends of the date window are pinned to IST     (F1 — "From 19 Aug, To 19 Aug"
//                                                                 found 30 bills of 181)
//   B  Analytics: only the newest reply may land                 (F2 — the 30-day label over the
//                                                                 7-day number)
//   C  Analytics: drilling into a day renames every label        (F3)
//   D  Bills: every column of a row is on screen at 360px        (F4 — the amount was cut off)
//   E  Customers: the drawer answers Back / Escape / focus       (F5)
//   F  Change log: no raw database word in the Change column     (F6 — 29 rows read "order_cancel")
//   G  Revenue: no stray divider once the KPI cells stack        (F7)
//   H  Revenue: the chart's labels are >= 9.5px at any width     (F8 — 3.9px on a phone)
//
// Exit 1 = a fault is back. Exit 2 = could not run (no server), never confused with a failure.
import { readFileSync } from "node:fs";
import { requireAppUp } from "./sweep/appUp.mjs";
import { adminCookie, adminHeaders } from "./sweep/login.mjs";

const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
let bad = 0;
const ok = (s, m) => { console.log(`${s ? "✓" : "✗"} ${m}`); if (!s) bad++; };
const head = (t) => console.log(`\n── ${t}`);

// ── A · the Bills date window (source) ───────────────────────────────────────────────────────
head("A · Bills: both ends of the date window name an IST midnight");
{
  const src = R("app/aevinite/bill-audit/page.tsx");
  ok(/p\.set\("from",\s*from \+ "T00:00:00\.000\+05:30"\)/.test(src),
    'the FROM date is sent pinned to +05:30 (a bare date is UTC midnight = 05:30 IST, and hid 151 of 181 bills)');
  ok(/p\.set\("to",\s*to \+ "T23:59:59\.999\+05:30"\)/.test(src),
    "the TO date still covers the whole of that day");
  ok(!/p\.set\("from",\s*from\)/.test(src), "no bare `from` remains anywhere in the query builder");
  ok(/T18 sweep, 2026-08-20/.test(src), "the reason is written beside it, so nobody 'simplifies' it back");
}

// ── B · the analytics request guard (source) ─────────────────────────────────────────────────
head("B · Analytics: a reply that is no longer the one being waited for is dropped");
{
  const src = R("app/aevinite/analytics/page.tsx");
  ok(/const reqSeq = useRef\(0\)/.test(src), "load() carries a monotonic request token");
  ok(/const mine = \+\+reqSeq\.current/.test(src), "each attempt stamps itself");
  ok((src.match(/mine !== reqSeq\.current/g) || []).length >= 2,
    "both the success path and the failure path refuse a stale reply");
  ok(/if \(mine === reqSeq\.current\) setLoading\(false\)/.test(src),
    "a slow loser cannot clear `loading` under a request that is still running");
}

// ── C · the drill's labels (source) ──────────────────────────────────────────────────────────
head("C · Analytics: every label comes from one window word, and the grain from the server");
{
  const src = R("app/aevinite/analytics/page.tsx");
  ok(/const windowText = drillDay \? drillLabel : RANGE_LABEL\[range\]\.toLowerCase\(\)/.test(src),
    "`windowText` becomes the drilled day's own name while a drill is open");
  // THREE uses of RANGE_LABEL[range] are legitimate and no more: windowText's own definition, the
  // page subtitle's not-drilled half, and the chart's `windowLabel` (deliberately the whole window —
  // its sentence is "the rest of <the week> had almost nothing"). Any FOURTH is a label that has
  // gone back to re-deriving the window for itself, which is the fault. Comments are stripped first
  // so the explanation above the code cannot satisfy the check.
  const codeOnly = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const allowed = [
    /const windowText = drillDay \? drillLabel : RANGE_LABEL\[range\]\.toLowerCase\(\)/,
    /: `\$\{RANGE_LABEL\[range\]\}\.`/,
    /windowLabel=\{RANGE_LABEL\[range\]\.toLowerCase\(\)\}/,
  ];
  let rest = codeOnly;
  for (const re of allowed) rest = rest.replace(re, "");
  const stray = (rest.match(/RANGE_LABEL\[range\]/g) || []).length;
  ok(stray === 0, `no label re-derives the window for itself (${stray} unaccounted use(s) of RANGE_LABEL[range])`);
  for (const re of allowed) ok(re.test(codeOnly), `the one allowed use is still there: ${String(re).slice(0, 46)}…`);
  ok(/<h2>Orders per \{grainWord\}<\/h2>/.test(src), "the chart heading names the grain the SERVER sent");
  ok(/data\?\.bucket \|\|/.test(src), "`grainWord` reads data.bucket, not the range");
  for (const label of ["Orders · ${windowText}", "for {windowText}"]) {
    ok(src.includes(label), `the tile / card hints use windowText (${label})`);
  }
}

// ── the source half of D, F, G, H ────────────────────────────────────────────────────────────
head("D-H · the four screens' source rules");
{
  const bills = R("app/aevinite/bill-audit/page.tsx");
  ok(/\.blz-rowgrid\{/.test(bills), "the bill row's grid lives in CSS, so it can reflow");
  ok(/@media \(max-width:760px\)\{[\s\S]*?grid-template-areas/.test(bills),
    "below 760px the row folds onto short lines instead of being clipped");
  ok(!/gridTemplateColumns: "148px 1\.3fr 60px 116px 92px 24px"/.test(bills),
    "the 6-column grid is no longer hard-wired inline with a 640px floor");

  const changes = R("app/aevinite/bill-audit/changes/page.tsx");
  ok(/order_cancel:\s*\{ t: "Bill cancelled"/.test(changes), "`order_cancel` has an English name");
  ok(/order_uncancel:\s*\{ t: "Cancel undone"/.test(changes), "`order_uncancel` has an English name");
  ok(/ACT\[r\.action\] \|\| \{ t: actLabel\(r\.action\)/.test(changes),
    "an unmapped action falls through to the shared plain-words map, never the raw code");
  // Every action the endpoint can send must be nameable.
  // Read the codes out of BILL_ACTIONS itself, not the whole file — a loose scan picked up table and
  // column names (`staff_actions`, `deleted_at`) and reported them as unnamed actions.
  const route = R("app/api/admin/bill-audit/route.ts");
  const list = route.slice(route.indexOf("const BILL_ACTIONS"), route.indexOf("const RISK"));
  const codes = [...list.matchAll(/"([a-z][a-z0-9_]+)"/g)].map((m) => m[1]);
  ok(codes.length >= 15, `read ${codes.length} bill action codes out of the endpoint's own BILL_ACTIONS list`);
  const named = new Set([...changes.matchAll(/^\s{2}([a-z][a-z0-9_]+):\s*\{ t:/gm)].map((m) => m[1]));
  const shared = R("components/admin/shared.tsx");
  const sharedNamed = new Set([...shared.matchAll(/^\s{2}([a-z][a-z0-9_]+):\s*"/gm)].map((m) => m[1]));
  const orphans = [...new Set(codes)].filter((c) => !named.has(c) && !sharedNamed.has(c));
  ok(orphans.length === 0, `every bill action the endpoint can send has a plain-words name${orphans.length ? ` — missing: ${orphans.join(", ")}` : ""}`);

  const rev = R("app/aevinite/revenue/page.tsx");
  ok(/@media \(max-width: 720px\) \{[\s\S]*?\.rev-strip \.cell \{ border-right: 0; border-bottom/.test(rev),
    "the KPI strip's divider goes BETWEEN stacked cells, not down their right edge");
  ok(/const \[w, setW\] = useState\(760\)/.test(rev) && /ResizeObserver/.test(rev),
    "the collected chart measures its own container instead of scaling its text with a fixed viewBox");
  ok(/viewBox=\{`0 0 \$\{W\} \$\{H\}`\}/.test(rev) && /const W = w,/.test(rev),
    "the viewBox width IS the rendered width, so 10px is 10px");
  ok(/LABEL_MIN_GAP/.test(rev), "month labels thin out rather than overprint when they will not fit");

  const cust = R("app/aevinite/customers/page.tsx");
  ok(/useAdminModal\(cardRef, "admin-customer-detail"/.test(cust),
    "the guest drawer is registered with the back-button manager");
  ok(!/if \(e\.key === "Escape"\) setDetail\(null\)/.test(cust),
    "the hand-rolled Escape listener is gone (the hook owns it)");
}

// ── everything below needs the real console ──────────────────────────────────────────────────
const BASE = await requireAppUp(process.argv, "the admin money-view checks");
const { chromium } = await import("playwright");
const H = adminHeaders(BASE);
const api = async (p) => (await fetch(BASE + p, { headers: H, cache: "no-store" })).json();
const br = await chromium.launch();
const ctx = async (w = 1280, h = 900, dpr = 1, skin = "dark") => {
  const c = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, serviceWorkers: "block" });
  await c.addCookies([adminCookie(BASE), { name: "aevidine_skin", value: skin, url: BASE }]);
  return c;
};
const settle = async (p) => { await p.waitForTimeout(6500); };

try {
  // ── A(live) · the window really reaches the whole IST day ──────────────────────────────────
  head("A(live) · a one-day window reaches bills taken before 05:30 IST");
  {
    const recent = await api("/api/admin/bills?limit=500");
    const byDay = {};
    for (const b of recent.bills) {
      const d = new Date(new Date(b.at || b.openedAt).getTime() + 330 * 60000).toISOString().slice(0, 10);
      byDay[d] = (byDay[d] || 0) + 1;
    }
    const day = Object.keys(byDay).sort().reverse().find((d) => byDay[d] >= 5);
    if (!day) {
      console.log("⏭ no day on the newest page has 5+ bills — nothing to measure on this database");
    } else {
      const pinned = await api(`/api/admin/bills?from=${day}T00:00:00.000%2B05:30&to=${day}T23:59:59.999%2B05:30&limit=500`);
      const early = pinned.bills.filter((b) => {
        const m = new Date(new Date(b.at).getTime() + 330 * 60000);
        return m.getUTCHours() * 60 + m.getUTCMinutes() < 330;
      }).length;
      const c = await ctx();
      const p = await c.newPage();
      await p.goto(BASE + "/aevinite/bill-audit", { waitUntil: "domcontentloaded" });
      await settle(p);
      const set = async (i, v) => p.evaluate(({ i, v }) => {
        const el = [...document.querySelectorAll('input[type="date"]')][i];
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      }, { i, v });
      await set(0, day); await p.waitForTimeout(1200); await set(1, day); await p.waitForTimeout(5000);
      const shown = await p.evaluate(() => document.querySelectorAll(".blz-row").length);
      // The first page is capped by the endpoint's own limit; what must hold is that the screen is
      // not stopping at the 05:30 boundary — before the fix this returned 30 of 181.
      ok(shown >= Math.min(pinned.bills.length, 100),
        `From=To=${day} shows ${shown} rows; that IST day holds ${pinned.bills.length}, ${early} of them before 05:30 IST`);
      await c.close();
    }
  }

  // ── B(live) · the label and the number describe the same window ────────────────────────────
  head("B(live) · ?range= shows that range's own number");
  {
    const truth = {};
    for (const r of ["today", "30d"]) truth[r] = (await api(`/api/admin/analytics?range=${r}`)).totals.totalOrders.toLocaleString("en-IN");
    const c = await ctx();
    let mismatches = 0;
    for (const r of ["30d", "today", "30d", "today"]) {
      const p = await c.newPage();
      await p.goto(`${BASE}/aevinite/analytics?range=${r}`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(8500);
      const v = await p.evaluate(() => document.querySelector(".adm-stat .v")?.textContent);
      if (v !== truth[r]) mismatches++;
      await p.close();
    }
    ok(mismatches === 0, `four opens alternating ?range=30d / ?range=today — ${mismatches} showed another window's figure`);
    await c.close();
  }

  // ── C(live) · the drill renames the page ───────────────────────────────────────────────────
  head("C(live) · drilling into a day renames every label on the page");
  {
    const c = await ctx();
    const p = await c.newPage();
    // The reply is stubbed to the shape the drill exists for (one day holding the window). Display
    // check only — no restaurant, row or setting is touched.
    await p.route("**/api/admin/analytics*", (route) => {
      const day = new URL(route.request().url()).searchParams.get("day");
      const mk = (n, hourly) => ({ totals: { totalOrders: n, activeTablesNow: 3, activeRestaurants: 9, totalRestaurants: 9, totalStaff: 49, totalTables: 1850 }, bucket: hourly ? "hour" : "day", cachedAt: new Date().toISOString(), busiest: [{ id: "a", slug: "s", name: "A Restaurant", orders: n, activeTablesNow: 1 }], bySource: [{ source: "dine_in", orders: n }] });
      if (day) {
        const b = mk(73, true);
        b.trend = Array.from({ length: 24 }, (_, i) => ({ day: new Date(Date.parse(day + "T00:00:00+05:30") + i * 3600000).toISOString(), orders: i === 13 ? 60 : (i === 14 ? 13 : 0) }));
        return route.fulfill({ json: b });
      }
      const b = mk(291, false);
      b.trend = Array.from({ length: 7 }, (_, i) => ({ day: `2026-08-${13 + i}`, orders: i === 5 ? 291 : 0 }));
      return route.fulfill({ json: b });
    });
    await p.goto(BASE + "/aevinite/analytics", { waitUntil: "domcontentloaded" });
    await settle(p);
    const read = () => p.evaluate(() => ({
      tile: document.querySelector(".adm-stat .k")?.textContent || "",
      val: document.querySelector(".adm-stat .v")?.textContent || "",
      sub: document.querySelector(".adm-page-sub")?.textContent || "",
      h2: document.querySelector(".adm-card h2")?.textContent || "",
      hints: [...document.querySelectorAll(".hint")].map((h) => h.textContent || ""),
    }));
    const offered = await p.evaluate(() => !![...document.querySelectorAll("button")].find((b) => /hour by hour/.test(b.textContent)));
    ok(offered, "a window whose orders pile into one day offers that day hour by hour");
    await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => /hour by hour/.test(x.textContent))?.click());
    await p.waitForTimeout(4000);
    const after = await read();
    const stale = [after.tile, after.sub, after.h2, ...after.hints].filter((t) => /7 days/i.test(t) || /per day/i.test(t));
    ok(stale.length === 0, `after the drill no label still says the whole window${stale.length ? ` — ${JSON.stringify(stale)}` : ` (tile reads "${after.tile}", heading "${after.h2}")`}`);
    ok(after.val === "73", `the tile shows the drilled day's own count (${after.val})`);
    await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => /Back to the whole range/.test(x.textContent))?.click());
    await p.waitForTimeout(3500);
    const back = await read();
    ok(/7 days/i.test(back.tile) && back.val === "291" && /per day/i.test(back.h2),
      `Back puts the window's words and figures back together (tile "${back.tile}" ${back.val}, heading "${back.h2}")`);
    await p.close(); await c.close();
  }

  // ── D(live) · every column of a bill row is on screen ──────────────────────────────────────
  head("D(live) · a bill row's amount is on screen at every width, both skins");
  for (const skin of ["dark", "light"]) for (const [w, tag] of [[360, "phone"], [768, "tablet"], [1280, "desktop"]]) {
    const c = await ctx(w, w === 360 ? 780 : 900, w === 360 ? 3 : 1, skin);
    const p = await c.newPage();
    await p.goto(BASE + "/aevinite/bill-audit", { waitUntil: "domcontentloaded" });
    await settle(p);
    const r = await p.evaluate(() => {
      const row = document.querySelector(".blz-row");
      if (!row) return { none: true };
      const card = row.closest(".adm-card");
      return {
        cells: [...row.children].map((s) => { const b = s.getBoundingClientRect(); return { t: s.textContent.trim().slice(0, 14) || "arrow", in: b.right <= window.innerWidth + 1 && b.left >= -1 }; }),
        clipped: card ? card.scrollWidth > card.clientWidth + 1 : false,
        pageWide: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    if (r.none) { console.log(`⏭ ${tag} ${skin}: no bills on this database to measure`); continue; }
    const outside = r.cells.filter((x) => !x.in).map((x) => x.t);
    ok(outside.length === 0 && !r.clipped && !r.pageWide,
      `${tag} ${w}px ${skin}: ${outside.length ? `off screen — ${outside.join(", ")}` : "every column on screen"}${r.clipped ? " · the card CLIPS" : ""}${r.pageWide ? " · the page scrolls sideways" : ""}`);
    await p.close(); await c.close();
  }

  // ── E(live) · the guest drawer ─────────────────────────────────────────────────────────────
  head("E(live) · the Customers drawer answers Back, Escape, focus and the scroll lock");
  {
    const c = await ctx(360, 780, 3);
    const p = await c.newPage();
    await p.goto(BASE + "/aevinite/customers", { waitUntil: "domcontentloaded" });
    await settle(p);
    const before = p.url();
    const any = await p.evaluate(() => !!document.querySelector("table.adm-table tbody tr"));
    if (!any) { console.log("⏭ no guests on this database to open"); }
    else {
      await p.evaluate(() => document.querySelector("table.adm-table tbody tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      await p.waitForTimeout(2200);
      const st = await p.evaluate(() => {
        const d = document.querySelector('[aria-label="Customer record"]');
        return { open: !!d, focusIn: !!d && d.contains(document.activeElement), frozen: [...document.querySelectorAll(".adm-main, .adm")].some((e) => e.style.overflow === "hidden") };
      });
      ok(st.open, "tapping a guest opens their record");
      ok(st.focusIn, "focus moves into the drawer (a keyboard user is not left in the table behind it)");
      ok(st.frozen, "the page behind the drawer is frozen");
      await p.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      await p.waitForTimeout(1500);
      const stayed = p.url() === before;
      const closed = await p.evaluate(() => !document.querySelector('[aria-label="Customer record"]')).catch(() => true);
      ok(stayed && closed, `the phone Back button closes the drawer and stays on Customers${stayed ? "" : ` — it left for ${p.url()}`}`);
      await p.evaluate(() => document.querySelector("table.adm-table tbody tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      await p.waitForTimeout(1800);
      await p.keyboard.press("Escape"); await p.waitForTimeout(900);
      ok(await p.evaluate(() => !document.querySelector('[aria-label="Customer record"]')), "Escape still closes it");
    }
    await p.close(); await c.close();
  }

  // ── F(live) · the Change log reads as English ──────────────────────────────────────────────
  head("F(live) · no raw database word in the Change column");
  {
    const c = await ctx();
    const p = await c.newPage();
    await p.goto(BASE + "/aevinite/bill-audit/changes", { waitUntil: "domcontentloaded" });
    await settle(p);
    for (const view of ["all", "at-risk"]) {
      if (view === "at-risk") {
        await p.evaluate(() => [...document.querySelectorAll(".adm-chip")].find((b) => /At-risk/.test(b.textContent))?.click());
        await p.waitForTimeout(4000);
      }
      const r = await p.evaluate(() => {
        const names = [...document.querySelectorAll(".adm-logrow:not(.head)")].map((row) => row.firstElementChild?.textContent?.trim() || "");
        return { total: names.length, raw: [...new Set(names.filter((t) => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(t)))] };
      });
      ok(r.raw.length === 0, `${view}: ${r.total} rows, ${r.raw.length ? `database words on screen — ${r.raw.join(", ")}` : "every change written in English"}`);
    }
    await p.close(); await c.close();
  }

  // ── G+H(live) · the revenue strip and its chart ────────────────────────────────────────────
  head("G+H(live) · Platform revenue: the divider and the chart's labels");
  for (const skin of ["dark", "light"]) for (const [w, tag] of [[360, "phone"], [1280, "desktop"]]) {
    const c = await ctx(w, w === 360 ? 780 : 900, w === 360 ? 3 : 1, skin);
    const p = await c.newPage();
    // The payments ledger can legitimately be empty, and then there is no chart to measure. Stub the
    // reply so the CHART's geometry is always checked. Display only — nothing is written.
    await p.route("**/api/admin/revenue*", (route) => {
      const monthly = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"]
        .map((label, i) => ({ month: `m${i}`, label, collected: [12000, 9000, 15000, 11000, 18000, 14000, 21000, 17000, 24000, 19000, 26000, 23000][i] }));
      route.fulfill({ json: { currency: "INR", mrr: 26000, arr: 312000, nonInrActive: 0, activeSubs: 9, byStatus: { active: 9, trial: 2, paused: 0, cancelled: 0 }, mrrByPlan: [{ plan: "Pro", mrr: 18000, count: 6 }], collectedThisYear: 184000, collectedAllTime: 209000, monthly, paying: [{ name: "A Restaurant", plan: "Pro", cycle: "monthly", monthly: 4000, nextDue: "2026-09-01" }], generatedAt: new Date().toISOString() } });
    });
    await p.goto(BASE + "/aevinite/revenue", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(5500);
    const m = await p.evaluate(() => {
      const svg = document.querySelector('svg[role="img"]');
      if (!svg) return { none: true };
      const bw = svg.getBoundingClientRect().width, vb = svg.viewBox.baseVal.width;
      const texts = [...svg.querySelectorAll("text")];
      const eff = texts.map((t) => parseFloat(getComputedStyle(t).fontSize) * (bw / vb));
      const boxes = texts.slice(0, -1).map((t) => t.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      let overlap = 0;
      for (let i = 1; i < boxes.length; i++) if (boxes[i].left < boxes[i - 1].right - 0.5) overlap++;
      const cells = [...document.querySelectorAll(".rev-strip .cell")];
      const stacked = cells.length > 1 && Math.abs(cells[0].getBoundingClientRect().top - cells[1].getBoundingClientRect().top) > 4;
      const strayRight = stacked ? cells.slice(0, -1).filter((c) => parseFloat(getComputedStyle(c).borderRightWidth) > 0).length : 0;
      return { minEff: Math.round(Math.min(...eff) * 10) / 10, overlap, stacked, strayRight };
    });
    if (m.none) { console.log(`⏭ ${tag} ${skin}: no chart rendered`); continue; }
    ok(m.minEff >= 9.5, `${tag} ${w}px ${skin}: smallest chart label ${m.minEff}px (needs >= 9.5px to be readable)`);
    ok(m.overlap === 0, `${tag} ${w}px ${skin}: ${m.overlap} overlapping month labels`);
    ok(m.strayRight === 0, `${tag} ${w}px ${skin}: ${m.stacked ? `${m.strayRight} stacked KPI cells still carry a right-hand divider` : "KPI cells sit side by side, dividers correct"}`);
    await p.close(); await c.close();
  }
} finally {
  await br.close();
}

console.log(bad
  ? `\n${bad} check(s) failed — a fault the T18 sweep fixed has come back. See scripts/verify-admin-money.mjs.`
  : "\nOK — the admin's money view: the date window, the range guard, the drill's labels, the bill row, the guest drawer, the change names, the divider and the chart all hold.");
process.exit(bad ? 1 : 0);
