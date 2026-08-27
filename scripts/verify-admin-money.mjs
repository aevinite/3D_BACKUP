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

// ── I-M · the five things he asked for on 2026-08-20 (source) ────────────────────────────────
// These are the FOLLOW-UPS to the eight above: the handoffs he told me to take on, plus the two
// decisions he answered. Same rule as sections A-H — one section per numbered item, so a single
// regression names itself.
head("I-M · the ledger's net, the platform count, the guest filter, the loss split, the pager");
{
  // I · 12 — the ledger reads the database's own net. The deep version of this check lives in
  // `verify:one-number` (which owns the "one revenue number" rule and now scans app code too);
  // this is the shallow one, so a person running only the admin guard still sees it break.
  const led = R("lib/billLedger.ts");
  ok(/if \(o\.net_amount != null[\s\S]{0,120}return Number\(o\.net_amount\)/.test(led),
    "12 · netOf() answers from orders.net_amount before it computes anything (₹475.00 vs the paper's ₹472.50)");
  const bills = R("app/api/admin/bills/route.ts");
  ok(/const ORDER_COLS = "[^"]*\bnet_amount\b/.test(bills), "12 · the ledger list selects net_amount");
  ok(/const MONEY_COLS = "[^"]*\bnet_amount\b/.test(bills),
    "12 · so does the read behind `deletion_audit.amount` — the permanent record of what was removed");

  // J · 13 — the platform's order count and the list under it are one population.
  const an = R("app/api/admin/analytics/route.ts");
  ok(/sb\.rpc\("lfh_admin_orders_count"/.test(an), "13 · the ORDERS tile counts through lfh_admin_orders_count (mig 348)");
  ok(!/from\("orders"\)\.select\("id", \{ count: "exact", head: true \}\)/.test(an),
    "13 · no bare head count of `orders` is left on the analytics route");
  const dash = R("app/api/admin/dashboard/route.ts");
  ok(/sb\.rpc\("lfh_admin_orders_count"/.test(dash), "13 · so does the Dashboard's Orders-today card");
  const mig = R("supabase/migrations/348_the_platform_count_ignores_a_binned_restaurant.sql");
  for (const fn of ["lfh_admin_orders_count", "lfh_admin_orders_by_source", "lfh_admin_orders_timeseries"])
    ok(new RegExp(`FUNCTION public\\.${fn}`).test(mig), `13 · mig 348 guards ${fn}`);
  ok((mig.match(/deleted_at IS NULL/g) || []).length >= 5,
    "13 · every leg of all four function bodies tests deleted_at (the tile, the chart and both source legs)");
  ok(/REVOKE EXECUTE ON FUNCTION public\.lfh_admin_orders_count[\s\S]{0,120}FROM PUBLIC, anon, authenticated/.test(mig),
    "13 · the new function is not public-executable (the mig 038/267 lesson)");

  // K · 14 — the guest filter offers restaurants that exist, and the names still resolve.
  const cust = R("app/api/admin/customers/route.ts");
  ok(/select\("id, name, slug, accent_color, deleted_at"\)/.test(cust), "14 · the restaurants read carries deleted_at");
  ok(/const liveRests = rests\.filter\(\(r\) => r\.deleted_at == null\)/.test(cust), "14 · a live-only list is derived from it");
  ok(/restaurants: liveRests\.map/.test(cust), "14 · the DROPDOWN is built from the live list");
  ok(/liveIds\.has\(s2\.restaurant_id\)/.test(cust), "14 · so are the per-restaurant guest bars");
  ok(/const nameOf = \(id: string\) => \{[\s\S]{0,200}rests\.find/.test(cust),
    "14 · but the NAME map still holds every restaurant, so a binned restaurant's guest row is not left reading '—'");

  // L · 15 — the Closed-unpaid tile splits its value, and never guesses.
  ok(/export function lossOfClosedUnpaid/.test(led), "15 · one function decides whether a closed-unpaid bill was a loss");
  ok(/if \(!cancelled\.length\) return "no"/.test(led), "15 · a bill that ordered nothing is stated, not left to `[].every()`");
  ok(/return "unknown"/.test(led), "15 · an unanswered cancellation stays unanswered — nothing is guessed");
  ok(/FIRED = new Set\(\["preparing", "ready", "served"\]\)/.test(led),
    "15 · the boundary is the kitchen fire, the same one mig 224's stock movement uses");
  ok(/kind", "order_cancelled"\)[\s\S]{0,200}\.in\("session_id"/.test(bills) || /\.eq\("kind", "order_cancelled"\)/.test(bills),
    "15 · the answers are read scoped to the page's sessions, not per bill");
  const ledger = R("app/aevinite/bill-audit/page.tsx");
  ok(/food was made/.test(ledger) && /never made/.test(ledger), "15 · the tile names both halves");
  ok(/not answered/.test(ledger), "15 · and says so when nobody has answered");
  ok(/Was the food made\?/.test(ledger), "15 · each closed-unpaid bill states its own answer when opened");
  // R10 is the manager floor's rule and it did NOT change. This is here because the two are one
  // decision away from each other and the doc row says so.
  ok(/REJECTED \(owner, 2026-08-11\)[\s\S]{0,600}Do not read the admin change as permission for this one/.test(R("public/panels/editor/app.js")),
    "15 · the manager floor's count still carries R10, with the boundary written on it");

  // M · 10 — the Change log is paged, and every page is reachable.
  const api = R("app/api/admin/bill-audit/route.ts");
  ok(/\.range\(offset, offset \+ per - 1\)/.test(api), "10 · the log is read one page at a time");
  ok(/\.order\("id", \{ ascending: false \}\)/.test(api),
    "10 · with a stable tiebreak, so no row can appear on two pages (bill actions land in the same millisecond)");
  ok(/wantCount = url\.searchParams\.get\("count"\) === "1"/.test(api), "10 · the exact total is only counted when asked");
  ok(/count: "exact", head: true/.test(api), "10 · and counted without pulling rows");
  ok(/riskCount = riskQ && !riskQ\.error \? \(riskQ\.count \?\? null\) : null/.test(api),
    "10 · the risk banner counts the WHOLE log, and says null rather than 0 when it could not");
  ok(/MAX_RETENTION_DAYS = 30/.test(api), "10 · the reply states how long a change survives (mig 158)");
  const chg = R("app/aevinite/bill-audit/changes/page.tsx");
  ok(/function Pager\(/.test(chg) && /function pageWindow\(/.test(chg), "10 · numbered pages with a window");
  ok(/id="chg-jump"/.test(chg), "10 · and a box to type a page number into");
  ok(/aria-current=\{p === page \? "page" : undefined\}/.test(chg), "10 · the current page is announced, not just coloured");
  ok(/older changes are removed automatically/.test(chg), "10 · the foot says the log ends because of retention, not because the list stopped");
  ok(!/Showing the most recent \{d\.rows\.length\} changes/.test(chg), "10 · the old 500-row dead end is gone");
  const migIdx = R("supabase/migrations/349_two_new_reads_get_their_index.sql");
  ok(/idx_staff_actions_action_created/.test(migIdx), "10 · the paged read has an index that leads with `action`");
  ok(/idx_deletion_audit_session_kind/.test(migIdx), "15 · so does the cancellation-answer lookup");
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
    // THE TRUTH IS READ FROM THE PAGE'S OWN REPLY, NOT FETCHED ONCE UP FRONT (fixed 2026-08-20).
    // It used to GET each range once, keep the figure, and then compare four page-opens against it
    // over the next forty seconds. On a quiet database that works. On this one it cried wolf: other
    // sessions place orders while a sweep runs, so "today" climbed 68 → 87 → 94 → 102 during a
    // single run and three of four opens were marked as showing "another window's figure" when
    // every one of them was correct. A guard that fails because the data moved teaches you to
    // ignore it.
    //
    // What this fault was ever about is whether the NUMBER ON SCREEN belongs to the window the page
    // says it is showing — so the comparison is now against the reply that page actually received
    // for that range. Immune to the data changing, and a strictly tighter test: a stale reply
    // landing under the wrong label is exactly what it now catches.
    const c = await ctx();
    let mismatches = 0;
    const notes = [];
    for (const r of ["30d", "today", "30d", "today"]) {
      const p = await c.newPage();
      const replies = [];
      p.on("response", (res) => {
        const u = res.url();
        if (!u.includes("/api/admin/analytics")) return;
        const q = new URL(u).searchParams.get("range") || "7d";
        replies.push({ q, body: res.json().catch(() => null) });
      });
      await p.goto(`${BASE}/aevinite/analytics?range=${r}`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(8500);
      const v = await p.evaluate(() => document.querySelector(".adm-stat .v")?.textContent);
      const label = await p.evaluate(() => document.querySelector(".adm-stat")?.textContent || "");
      // The LAST reply for the range that was asked for — the one whose figure must be on screen.
      const mine = [...replies].reverse().find((x) => x.q === r);
      const want = mine ? (await mine.body)?.totals?.totalOrders : null;
      const wantText = want == null ? null : want.toLocaleString("en-IN");
      const rangeWord = r === "30d" ? "last 30 days" : "today";
      if (wantText == null || v !== wantText || !label.toLowerCase().includes(rangeWord)) {
        mismatches++;
        notes.push(`?range=${r}: tile ${JSON.stringify(v)}, its own reply said ${JSON.stringify(wantText)}, label ${JSON.stringify(label.slice(0, 40))}`);
      }
      await p.close();
    }
    ok(mismatches === 0, `four opens alternating ?range=30d / ?range=today — ${mismatches} showed a figure that was not its own reply's${notes.length ? ` (${notes.join(" | ")})` : ""}`);
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
    // ↻ REFRESH, STILL DRILLED (sweep #7 item 1). The drill fix above never covered the Refresh
    // button, which called load(range, true) with no day — so the reply was the whole window while
    // every label went on naming the drilled day: "Orders · 24 Aug  1,047" over a day that had 0.
    await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => /hour by hour/.test(x.textContent))?.click());
    await p.waitForTimeout(4000);
    await p.evaluate(() => [...document.querySelectorAll("button.adm-btn")].find((x) => /Refresh/.test(x.textContent))?.click());
    await p.waitForTimeout(4500);
    const refreshed = await read();
    const mixed = [refreshed.tile, refreshed.sub, refreshed.h2, ...refreshed.hints].filter((t) => /7 days/i.test(t) || /per day/i.test(t));
    ok(mixed.length === 0 && refreshed.val === "73",
      `pressing Refresh while drilled re-asks for the DAY, not the window (tile "${refreshed.tile}" ${refreshed.val}, heading "${refreshed.h2}")${mixed.length ? ` — window words left behind: ${JSON.stringify(mixed)}` : ""}`);
    await p.close(); await c.close();
  }

  // ── C2(live) · a rounded percentage never says "none" while the count says some ─────────────
  head('C2(live) · the occupancy tile never prints "(0%)" above a non-zero count');
  {
    const c = await ctx();
    const p = await c.newPage();
    await p.goto(BASE + "/aevinite/analytics", { waitUntil: "domcontentloaded" });
    await settle(p);
    const t = await p.evaluate(() => {
      const e = [...document.querySelectorAll(".adm-stat")].find((x) => /Tables occupied/i.test(x.textContent));
      return e ? { v: e.querySelector(".v")?.textContent?.trim(), sub: e.textContent } : null;
    });
    if (!t) console.log("⏭ the Tables-occupied tile did not render");
    else ok(!(Number(String(t.v).replace(/\D/g, "")) > 0 && /\(0%\)/.test(t.sub)),
      `"${t.v}" occupied and the words read ${(t.sub.match(/\([^)]*%\)/) || ["—"])[0]}`);
    await p.close(); await c.close();
  }

  // ── C3 · every money screen's freshness stamp can express MINUTES ──────────────────────────
  head("C3 · a \"how old are these numbers\" stamp is minutes, never days");
  {
    // `ago()` in customers/page.tsx answers in days ("today" for anything under 24h) — it is for a
    // guest's last visit. The shared timeAgo answers in minutes. A cache stamp must use the latter,
    // or a five-minute snapshot and a five-hour one read identically (sweep #7 item 4).
    for (const [f, label] of [["app/aevinite/customers/page.tsx", "Customers"], ["app/aevinite/analytics/page.tsx", "Platform analytics"], ["app/aevinite/revenue/page.tsx", "Platform revenue"]]) {
      const src = R(f);
      const stamp = src.match(/(?:counted|updated) \{(\w+)\(/);
      ok(!!stamp && stamp[1] === "timeAgo", `${label}: the stamp reads ${stamp ? stamp[1] + "()" : "NO STAMP FOUND"}`);
    }
  }

  // ── C4 · a heading beside an exact count must not be a capped list's length ─────────────────
  head("C4 · the Dashboard's headings count everyone, like the cards above them");
  {
    // /api/admin/dashboard caps the online list at 200 and the issues list at 50 and sends the exact
    // totals alongside, saying so in its own comment. A heading built from `list.length` states a
    // second, smaller number for the same fact on the same screen (sweep #7 item 5).
    const home = R("app/aevinite/page.tsx");
    ok(/Working now <span>· \{onlineCount \?\? online\.length\} active<\/span>/.test(home),
      "\"Working now\" uses the server's exact onlineCount");
    ok(/Open issues <span>· \{openIssuesCount \?\? openIssues\.length\} open<\/span>/.test(home),
      "\"Open issues\" uses the server's exact openIssuesCount");
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

  // ── C5 · one way of writing a date, and a year label that is the SERVER's ─────────────────
  head("C5 · the money screens write a date one way, and take the year from the server");
  {
    // `next_due_on` is a bare YYYY-MM-DD and Platform revenue printed it raw, so the Paying table
    // read "2027-07-04" beside a console that writes "4 Jul 27" everywhere else. And the "payments
    // in <year>" label came from the BROWSER's clock while the figure is counted against the IST
    // calendar year — on 31 December west of IST the heading names one year over another year's
    // money (sweep #7 item 6).
    // COMMENTS STRIPPED FIRST. The fix's own comment QUOTES the `new Date().getFullYear()` it
    // replaced, and a raw scan reads that as the fault still being there — the same trap that made
    // one of this sweep's own new checks red on a green file.
    const rev = R("app/aevinite/revenue/page.tsx").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    ok(!/\{r\.nextDue \|\| "—"\}/.test(rev) && /dfmt\(r\.nextDue\)/.test(rev),
      "the next-due date goes through a formatter, not straight to the screen");
    ok(/T00:00:00\+05:30/.test(rev), "…and a bare date is pinned to IST before it is formatted");
    ok(!/new Date\(\)\.getFullYear\(\)/.test(rev) && /d\?\.generatedAt \? new Date\(d\.generatedAt\)/.test(rev),
      "the \"payments in <year>\" label reads the server's own stamp, not the device's clock");
  }

  // ── D2(live) · an empty state bucket still offers the way further back ─────────────────────
  head("D2(live) · a state chip that comes back empty is not a dead end");
  {
    // Five of the six buckets are narrowed AFTER a page of sessions is read, so a newest page can
    // hold none of the chosen state while older pages hold plenty. The footer used to be gated on
    // there being at least one row, so exactly then the way onward was withheld — and a settled
    // bill (#644, ₹441) sat three pages back, unreachable by pressing anything (sweep #7 item 2).
    const c = await ctx();
    const p = await c.newPage();
    await p.goto(BASE + "/aevinite/bill-audit", { waitUntil: "domcontentloaded" });
    await settle(p);
    let measured = 0;
    for (const chip of ["Running", "Settled", "Pay-later", "On the house"]) {
      const clicked = await p.evaluate((label) => {
        const b = [...document.querySelectorAll("button.blz-chip")].find((x) => x.textContent.includes(label));
        if (!b) return false; b.click(); return true;
      }, chip);
      if (!clicked) continue;
      await p.waitForTimeout(3000);
      const st = await p.evaluate(() => ({
        rows: document.querySelectorAll(".blz-row").length,
        empty: document.querySelector(".adm-empty")?.textContent?.trim() || "",
        older: !![...document.querySelectorAll("button.adm-btn")].find((b) => /Load older bills/.test(b.textContent)),
      }));
      if (st.rows > 0) continue;                       // this bucket has rows here — nothing to prove
      measured++;
      const cursor = await api(`/api/admin/bills?state=${chip === "Pay-later" ? "khata" : chip === "On the house" ? "onhouse" : chip.toLowerCase()}`);
      if (!cursor.nextBefore) { console.log(`⏭ ${chip}: empty and the server says there is nothing older — correctly final`); continue; }
      ok(st.older && /there are older ones/.test(st.empty),
        `${chip}: empty page + an older page exists → ${st.older ? "the way back is offered" : "NO Load-older button"}, and the line reads ${JSON.stringify(st.empty)}`);
    }
    if (measured === 0) console.log("⏭ every state bucket has rows on the newest page — nothing to measure on this database");
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
  // ── N · the same five, against the RUNNING server ──────────────────────────────────────────
  // The source checks above prove the code says the right thing. These prove the DATABASE agrees —
  // a migration that never reached this database, or was replaced from an older copy, is exactly the
  // failure a source-only guard cannot see (mig 310's own "a later CREATE OR REPLACE from a stale
  // copy silently reverts a fix"). Read-only: four GETs.
  head("N · the live numbers");
  {
    const H = adminHeaders(BASE);
    // A 500 from these routes comes back with an EMPTY body, so a bare .json() threw and killed the
    // whole run with "Unexpected end of JSON input" — a guard that crashes tells you nothing. The
    // status and the first of the body come back instead, and the checks below name what is wrong.
    const get = async (p) => {
      const r = await fetch(BASE + p, { headers: H, cache: "no-store" });
      const t = await r.text();
      try { return { ...JSON.parse(t || "{}"), _status: r.status }; }
      catch { return { _status: r.status, _body: t.slice(0, 200) }; }
    };

    // 13 · the tile must equal the sum of the list printed under it.
    const a = await get("/api/admin/analytics?range=30d&refresh=1");
    // MIGRATION 348 MUST BE ON THIS DATABASE, and this is checked before the numbers because
    // without it the route throws and every count below reads `undefined` for no stated reason.
    // It happened once for real on the shared dev database: the function went missing between two
    // runs of this guard and the only symptom was an empty 500.
    ok(a._status === 200,
      a._status === 200 ? "13 · Platform analytics answers" :
        `13 · Platform analytics returned ${a._status} — if this says the function lfh_admin_orders_count is not in the schema cache, migration 348 has not been applied to this database (node scripts/run-migration.mjs 348_the_platform_count_ignores_a_binned_restaurant.sql)`);
    const tile = a?.totals?.totalOrders ?? -1;
    const busiest = (a?.busiest || []).reduce((s, r) => s + (Number(r.orders) || 0), 0);
    const trend = (a?.trend || []).reduce((s, r) => s + (Number(r.orders) || 0), 0);
    ok(tile === busiest, `13 · ORDERS (30d) ${tile} === the busiest table's sum ${busiest}`);
    ok(tile === trend, `13 · and === the trend chart's sum ${trend} (all three exclude binned restaurants)`);
    const dineIn = (a?.bySource || []).find((s) => s.source === "dine_in")?.orders ?? -1;
    ok(dineIn === tile, `13 · and === the by-source dine-in leg ${dineIn}`);
    const dash = await get("/api/admin/dashboard");
    const today = await get("/api/admin/analytics?range=today&refresh=1");
    ok(dash?.ordersToday === today?.totals?.totalOrders,
      `13 · the Dashboard's Orders today (${dash?.ordersToday}) === the analytics tile for today (${today?.totals?.totalOrders})`);

    // 14 · the guest filter offers only restaurants that exist.
    const cu = await get("/api/admin/customers");
    const binned = (cu?.restaurants || []).length;
    ok(binned > 0 && binned === (a?.totals?.totalRestaurants ?? -1),
      `14 · the Customers dropdown lists ${binned} restaurants, the same number analytics calls live (${a?.totals?.totalRestaurants})`);

    // 10 · the log is paged, the last page is real, and no row sits on two pages.
    const p1 = await get("/api/admin/bill-audit?page=1&count=1");
    ok(Number.isInteger(p1?.total) && Number.isInteger(p1?.pages) && p1.pages >= 1,
      `10 · the log reports an exact total (${p1?.total}) and a last page (${p1?.pages})`);
    ok((p1?.rows || []).length <= p1?.per, `10 · a page holds at most ${p1?.per} rows`);
    const noCount = await get("/api/admin/bill-audit?page=2");
    ok(noCount?.total === null, "10 · a page hop does NOT re-count (the total comes back null)");
    const ids = new Set((p1?.rows || []).map((r) => r.id));
    const dupes = (noCount?.rows || []).filter((r) => ids.has(r.id)).length;
    ok(dupes === 0, `10 · page 2 shares ${dupes} rows with page 1`);
    const last = await get(`/api/admin/bill-audit?page=${p1?.pages}`);
    ok((last?.rows || []).length > 0, `10 · the last page (${p1?.pages}) has rows on it`);
    const past = await get(`/api/admin/bill-audit?page=${(p1?.pages || 1) + 3}`);
    ok((past?.rows || []).length === 0 && !past?.error, "10 · a page past the end is empty, not an error");
    ok(p1?.riskCount === null || p1.riskCount >= (p1?.rows || []).filter((r) => r.risk).length,
      "10 · the risk count is the whole log's, not this page's");

    // 15 · every closed-unpaid bill carries an answer; nothing else does.
    const bl = await get("/api/admin/bills?limit=200");
    const bills = bl?.bills || [];
    const unpaid = bills.filter((b) => b.state === "cancelled");
    ok(unpaid.length === 0 || unpaid.every((b) => ["yes", "no", "unknown"].includes(b.loss)),
      `15 · all ${unpaid.length} closed-unpaid bills carry a loss answer`);
    ok(bills.filter((b) => b.state !== "cancelled").every((b) => b.loss == null),
      "15 · and no other state carries one — the question does not apply to a bill that was paid");

    // 12 · no bill's amount can exceed the sum of its orders' stored net. The ledger used to read
    // HIGH, so this is the direction that matters.
    ok(bills.every((b) => Number.isFinite(b.amount) && b.amount >= 0 && b.amount >= b.paid - 0.01),
      "12 · every bill's total is a real number and at least what was collected on it");
  }

} finally {
  await br.close();
}

console.log(bad
  ? `\n${bad} check(s) failed — a fault the T18 sweep fixed has come back. See scripts/verify-admin-money.mjs.`
  : "\nOK — the admin's money view: the date window, the range guard, the drill's labels, the bill row, the guest drawer, the change names, the divider and the chart all hold.");
process.exit(bad ? 1 : 0);
