// verify-manager-hidden.mjs — guards the "admin-only surfaces never appear in the manager
// panel" rule (owner 2026-07-28 + 2026-07-29). Runs against the REAL running app.
//
//   node scripts/verify-manager-hidden.mjs            (defaults to http://localhost:4000)
//   VERIFY_BASE=http://localhost:4010 node scripts/verify-manager-hidden.mjs
//
// Three views of the SAME manager panel, driven headlessly:
//
//   1. REAL MANAGER (diag manager login) — the Billing / Kitchen / Dining-sessions settings
//      rows, the table COUNT card and the Guest-QR card must be GONE. Not greyed, not
//      present-but-unclickable: absent from the layout. (This is the bug that shipped:
//      .list-item has an explicit display:flex, so the browser's [hidden] rule lost and every
//      "hidden" sidebar row stayed on screen and merely snapped back when tapped.)
//   2. ADMIN VIEW (?rid=…) — the SAME rows are absent for the admin too, and the ribbon +
//      its zones dropdown work. (This used to expect them shown-greyed. That stopped being
//      true on 2026-07-31, when the owner looked at the tinted Billing / Kitchen / Dining-
//      sessions rows and said "there shouldn't be grayed out option also": nobody can ever
//      grant an admin-owned setting to a manager, so a tinted row is a dead end — the admin
//      edits them in the admin panel. The checks kept asserting the old rule and had been
//      failing ever since; a stale check is a lie with a delay on it.)
//   3. ADMIN ACTUAL VIEW (?rid=…&view=real) — identical to view 1 (nothing greyed left behind),
//      while the ribbon keeps the way back.
//
// Plus the DASHBOARD RANGE rule (owner, 2026-08-03), checked in all three views: the rail
// offers Today, and Yesterday only when this restaurant's Access setting reaches that far —
// the 30-day and 12-month rows are gone from the MARKUP for everyone, manager, owner and admin
// alike, so there is nothing left to grey out. (They used to be hidden-for-the-manager and
// tinted for a higher role; the owner saw the tinted pair through owner → manager mode on
// Aangan and said they should not exist.) And the server clamps to the same two words: asking
// /api/editor/stats?range=year returns today, for a manager AND for the admin.
// Never prints the admin secret (the cookie is sha256 of it, computed locally).
//
// Replaces scripts/verify-table-qr.mjs, which asserted the OPPOSITE (that the manager panel
// shows the per-table QR card) — that rule was reversed by the owner on 2026-07-29, so the old
// guard could only ever fail. The QR links now live only in the admin restaurant detail.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { requireUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) =>
  Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const BASE = process.env.VERIFY_BASE || "http://localhost:4000";
const MGR = { user: process.env.VERIFY_MGR || "diagm1", pass: process.env.VERIFY_MGR_PW || "diag-mgr-2026" };
// Nothing answering = "could not run" (exit 2), said in plain words — never a raw ECONNREFUSED
// stack, which reads as "this guard is broken". (sweep #6 / T28, 2026-08-22)
await requireUp(BASE, "the manager-hidden walk");
// Width to test at: the owner checks on a phone too (VERIFY_WIDTH=390), desktop by default.
const VIEW = { width: Number(process.env.VERIFY_WIDTH || 1280), height: Number(process.env.VERIFY_HEIGHT || 900) };
if (!env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD missing from .env.local");
const adminCookieValue = createHash("sha256").update(env.ADMIN_PASSWORD).digest("hex");

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
};

// The things a real manager must never see, as CSS selectors inside the panel iframe.
const ADMIN_ONLY = [
  ['.list-item[data-settings-section="billing"]', "Billing settings row", "general"],
  ['.list-item[data-settings-section="kitchen"]', "Kitchen settings row", "general"],
  ['.list-item[data-settings-section="sessions"]', "Dining-sessions row", "general"],
  ['[data-mgr-hide="table_count"]', "Number-of-tables card", "tables"],
  ['[data-mgr-hide="table_qr"]', "Guest-QR-links card", "tables"],
];

const frameOf = (page) => page.frames().find((f) => /\/panels\/editor/.test(f.url()));

// The panel iframe re-mounts once on boot and whoami lands a moment later, so poll for a frame
// that has actually finished its first X-ray pass (the ribbon or the settings list is present).
async function readyFrame(page) {
  for (let i = 0; i < 60; i++) {
    const f = frameOf(page);
    if (f) {
      try {
        // Booted enough to drive: the top tabs exist AND whoami has resolved (XRAY_WHO set),
        // so the first X-ray pass has already decided what's hidden.
        const booted = await f.evaluate(() =>
          !!document.querySelector('.tabs .tab[data-tab="general"]') && typeof XRAY_WHO === "object" && XRAY_WHO !== null);
        if (booted) return f;
      } catch { /* frame swapped mid-eval — retry */ }
    }
    await page.waitForTimeout(750);
  }
  return frameOf(page);
}

// Click a tab/row only if it's actually on screen — a tab a role isn't allowed is hidden, and
// "can't reach it at all" is a PASS for that role, not a test failure.
async function clickIfShown(frame, selector) {
  const shown = await frame.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el || el.offsetParent === null) return false;
    el.click();
    return true;
  }, selector);
  if (shown) await frame.waitForTimeout(500);
  return shown;
}

// Walk to a screen, then report each selector as: absent | hidden-but-laid-out | visible(+greyed?)
async function surveyScreen(frame, screen) {
  if (screen === "general") {
    await clickIfShown(frame, '.tabs .tab[data-tab="general"]');
  } else if (screen === "tables") {
    await clickIfShown(frame, '.tabs .tab[data-tab="general"]');
    await clickIfShown(frame, '.list-item[data-settings-section="tables"]');
  } else if (screen === "dash") {
    await clickIfShown(frame, '.tabs .tab[data-tab="dash"]');
  }
  await frame.waitForTimeout(900); // let the repaint + the observer's X-ray pass settle
  return frame.evaluate((sels) => {
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) { out[s] = { present: false }; continue; }
      const r = el.getBoundingClientRect();
      out[s] = {
        present: true,
        // "shown" = actually occupies space on screen (the real test: the [hidden] attribute is
        // worthless if an author display rule overrides it).
        shown: !!(el.offsetParent !== null && r.width > 0 && r.height > 0),
        hiddenAttr: el.hidden === true,
        greyed: el.classList.contains("xray-off"),
      };
    }
    return out;
  }, sels_(screen));
}
function sels_(screen) { return ADMIN_ONLY.filter(([, , s]) => s === screen).map(([sel]) => sel); }

// The dashboard's range rail, as it really is in the DOM. Reads the KEYS present (not just
// "is it visible"): a 30-day row that exists but is hidden would still be a fail now — the
// owner's instruction was that it should not be in the panel at all.
async function dashRail(frame) {
  await clickIfShown(frame, '.tabs .tab[data-tab="dash"]');
  await frame.waitForTimeout(700);
  return frame.evaluate(() => ({
    keys: [...document.querySelectorAll("[data-dash-range]")].map((e) => e.getAttribute("data-dash-range")),
    shown: [...document.querySelectorAll("[data-dash-range]")].filter((e) => e.offsetParent !== null)
      .map((e) => e.getAttribute("data-dash-range")),
    reach: (typeof XRAY_WHO === "object" && XRAY_WHO && XRAY_WHO.dashReach) || null,
  }));
}

// The one rule, checked identically for every viewer, and it depends on the REACH:
//
//   reach "today"            → there is NO rail at all. A picker with one option is a control
//                              with nothing to choose, which is the dead control this model
//                              removes — dashRangeToggleHtml() returns "" and that is CORRECT.
//   reach "today_yesterday"  → BOTH rows, and nothing wider than yesterday, ever.
//
// THIS CHECK USED TO DEMAND "Today is there" UNCONDITIONALLY (fixed 2026-08-06). Every restaurant
// starts on today-only, so the guard failed three times on a panel that was behaving exactly as
// designed — on main, on the deployed backup, for who knows how long. A red line that is not a
// real fault is how a real one gets skimmed past, which is the same lesson verify-access-search
// learned the same day. The wider-than-yesterday rule is unchanged and still absolute: the owner
// deleted the 30-day and Year rows on 2026-08-03 ("there is literally no need for it").
function checkRail(who, rail) {
  const wide = rail.keys.filter((k) => k !== "today" && k !== "yesterday");
  check(`${who}: no wider-than-yesterday range row exists at all`, wide.length === 0, JSON.stringify(rail.keys));
  const wantY = rail.reach === "today_yesterday";
  if (!wantY) {
    check(`${who}: no day-picker at all when the reach is today-only`, rail.keys.length === 0,
      `rail keys: ${JSON.stringify(rail.keys)} — a one-option picker is a control with nothing to choose`);
    return;
  }
  check(`${who}: Today row is there`, rail.shown.includes("today"), JSON.stringify(rail.shown));
  check(`${who}: Yesterday row IS offered (setting says ${rail.reach})`,
    rail.shown.includes("yesterday"), JSON.stringify(rail.shown));
}
const SCREENS = ["general", "tables", "dash"];

async function surveyAll(frame) {
  const all = {};
  for (const s of SCREENS) Object.assign(all, await surveyScreen(frame, s));
  return all;
}
const labelOf = (sel) => (ADMIN_ONLY.find(([s]) => s === sel) || [, sel])[1];

console.log(`→ manager-panel hidden-surface check · ${BASE}\n`);
const browser = await chromium.launch({ headless: true });

// ── 1. REAL MANAGER ─────────────────────────────────────────────────────────────
console.log("1. Real manager login — admin-only surfaces must be ABSENT");
const mgrCtx = await browser.newContext({ viewport: VIEW });
const login = await mgrCtx.request.post(`${BASE}/api/panel-login`, { data: { username: MGR.user, password: MGR.pass } });
check(`logged in as ${MGR.user}`, login.status() === 200, `HTTP ${login.status()}`);
let mgrSurvey = {};
if (login.status() === 200) {
  const page = await mgrCtx.newPage();
  await page.goto(`${BASE}/manager`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await readyFrame(page);
  check("manager panel iframe booted", !!frame);
  if (frame) {
    mgrSurvey = await surveyAll(frame);
    for (const [sel] of ADMIN_ONLY) {
      const r = mgrSurvey[sel] || { present: false };
      check(`${labelOf(sel)} not on screen`, !r.present || !r.shown,
        r.present && r.shown ? `still laid out (hidden attr = ${r.hiddenAttr}) — the [hidden] rule is being overridden` : "");
    }
    // The range rail: Today, Yesterday only if the setting allows, nothing wider in the markup.
    checkRail("real manager", await dashRail(frame));
    // Print the tabs they really have so the run is readable (which screens were reachable at
    // all for this diag manager).
    const keeps = await frame.evaluate(() => ({
      tabs: [...document.querySelectorAll(".tabs .tab")].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()),
    }));
    console.log(`    tabs this manager sees: ${keeps.tabs.join(" · ")}`);
  }
  // Server rule: a wide range is clamped to today for a real manager.
  const wide = await mgrCtx.request.get(`${BASE}/api/editor/stats?range=year`);
  const body = wide.status() === 200 ? await wide.json() : null;
  check("server clamps /stats?range=year to today for a manager", body?.range === "today",
    `got range=${body?.range ?? `HTTP ${wide.status()}`}`);
  // …and the staff-watch card on the same screen follows the same two words, so it can't
  // summarise a year of activity under a "today" heading.
  const riskWide = await mgrCtx.request.get(`${BASE}/api/editor/staff-risk?range=year`);
  const riskBody = riskWide.status() === 200 ? await riskWide.json() : null;
  check("server clamps /staff-risk?range=year to today for a manager", riskBody?.range === "today",
    `got range=${riskBody?.range ?? `HTTP ${riskWide.status()}`}`);
}
await mgrCtx.close();

// ── 2 + 3. ADMIN VIEW and ADMIN ACTUAL VIEW ─────────────────────────────────────
const admCtx = await browser.newContext({ viewport: VIEW });
await admCtx.addCookies([{ name: "lfh_staff_auth", value: adminCookieValue, url: BASE }]);
// Which restaurant to look into: the same one the diag manager belongs to.
const listR = await admCtx.request.get(`${BASE}/api/admin/restaurants`);
const listJ = listR.status() === 200 ? await listR.json() : null;
const rows = Array.isArray(listJ) ? listJ : listJ?.restaurants || [];
// Which restaurant the admin looks into — VERIFY_SLUG so a NON-#1 tenant can be checked too
// (tenant-specific bugs hide there): VERIFY_MGR=diagm2 VERIFY_SLUG=pizza-palace.
const wantSlug = process.env.VERIFY_SLUG || "french-house";
const rid = (rows.find((r) => r.slug === wantSlug) || rows[0] || {}).id;

console.log("\n2. Admin view (?rid=…) — the same admin-owned rows are absent here too");
check("found a restaurant id to look into", !!rid, `admin restaurants → HTTP ${listR.status()}`);
// The ONLY way an admin may enter a panel is the console's act-as hop (panelGate): it sets the
// act-as cookie and redirects to /manager?rid=…. Landing on /manager by hand bounces to /aevinite.
const adminPanelUrl = `${BASE}/api/admin/act-as/go?rid=${rid}&to=%2Fmanager`;
let admPage = null;
if (rid) {
  const page = await admCtx.newPage();
  admPage = page;
  await page.goto(adminPanelUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await readyFrame(page);
  check("admin-view panel booted", !!frame, `landed on ${page.url()}`);
  if (frame) {
    const survey = await surveyAll(frame);
    for (const [sel] of ADMIN_ONLY) {
      const r = survey[sel] || { present: false };
      // Absent, not greyed: an admin-owned setting can never be given to a manager, so it is
      // gone from THIS panel for everyone and lives in the admin panel instead.
      check(`${labelOf(sel)} not on screen for the admin either`, !r.present || !r.shown,
        `present=${r.present} shown=${r.shown} greyed=${r.greyed}`);
    }
    // The admin gets the SAME two rows as the manager — the whole point of 2026-08-03: an
    // admin/owner looking in is not offered a range the manager's screen doesn't have.
    checkRail("admin view", await dashRail(frame));
    // The zones dropdown is asked on the SETTINGS screen: since the dashboard rows left the
    // panel there is nothing dashboard-shaped to list any more, and the settings rows are the
    // admin-only items that remain.
    await surveyScreen(frame, "general");
    const ribbon = await frame.evaluate(() => {
      const rb = document.getElementById("xrayRibbon");
      const btn = document.getElementById("xrayZonesBtn");
      if (btn) btn.click();
      const zp = document.getElementById("xrayZones");
      return {
        ribbon: !!rb,
        zonesLabel: btn ? btn.textContent.trim() : null,
        zoneRows: zp ? [...zp.querySelectorAll(".zrow")].map((z) => z.textContent.trim()) : [],
        simRow: !!(zp && zp.querySelector("#xraySimRow")),
      };
    });
    check("admin ribbon present with a zones dropdown", ribbon.ribbon && !!ribbon.zonesLabel, JSON.stringify(ribbon.zonesLabel));
    // The dropdown lists the real manager POWERS this restaurant switched off. With every power
    // granted (the diag restaurant's normal state) the honest answer is "Nothing is off here."
    // What it must never do is stay EMPTY, or list something nobody can grant.
    check("zones dropdown answers something honest", ribbon.zoneRows.length > 0, JSON.stringify(ribbon.zoneRows));
    check("zones dropdown never lists an admin-owned setting as grantable",
      !ribbon.zoneRows.some((t) => /billing settings|kitchen settings|dining session|number-of-tables|guest-qr/i.test(t)),
      JSON.stringify(ribbon.zoneRows));
    check("no dashboard range is listed as 'not in the manager's panel' any more",
      !ribbon.zoneRows.some((t) => /30-day|12-month|dashboard/i.test(t)), JSON.stringify(ribbon.zoneRows));
    check("zones dropdown offers 'See the actual manager panel'", ribbon.simRow);
  }
}

// ── 3. ACTUAL VIEW — reached the way the owner reaches it: the ribbon's own toggle. ──
console.log("\n3. Admin ACTUAL view (the ribbon's “See the actual manager panel”)");
if (admPage) {
  const page = admPage;
  // The toggle lives on the iframe's own URL (the outer /manager page never carries ?view),
  // so drive the real control: zones dropdown → the 👁 row → the iframe reloads simulated.
  const frame0 = frameOf(page);
  if (frame0) {
    // Open the dropdown only if it isn't already open — clicking the button again CLOSES it
    // (that's the toggle), and then the 👁 row wouldn't exist to click.
    await frame0.evaluate(() => {
      let zp = document.getElementById("xrayZones");
      if (!zp) { const b = document.getElementById("xrayZonesBtn"); if (b) b.click(); zp = document.getElementById("xrayZones"); }
      const s = zp && zp.querySelector("#xraySimRow");
      if (s) s.click();
    }).catch(() => {});
  }
  // The iframe re-mounts once and then navigates to …&view=real, so poll until the NEW load's
  // whoami has landed instead of guessing a delay (a fixed wait read the pre-reload state).
  let frame = null, simOn = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(750);
    const f = frameOf(page);
    if (!f || !/view=real/.test(f.url())) continue;
    try {
      simOn = await f.evaluate(() => !!(XRAY_WHO && XRAY_WHO.simulated && XRAY_WHO.higherView === false));
      if (simOn) { frame = f; break; }
    } catch { /* mid-navigation — retry */ }
  }
  if (!frame) frame = frameOf(page);
  check("actual-view panel booted", !!frame);
  check("the toggle switched this tab to the real-manager answer", simOn);
  if (frame) {
    const survey = await surveyAll(frame);
    for (const [sel] of ADMIN_ONLY) {
      const r = survey[sel] || { present: false };
      check(`${labelOf(sel)} gone in the actual view`, !r.present || !r.shown,
        r.present && r.shown ? `still laid out (greyed=${r.greyed}, hidden attr=${r.hiddenAttr})` : "");
    }
    const back = await frame.evaluate(() => ({
      ribbon: !!document.getElementById("xrayRibbon"),
      full: !!document.getElementById("xrayFullBtn"),
      tag: (document.querySelector("#xrayRibbon .rb-tag") || {}).textContent || "",
      // Anything still wearing the grey "off for staff" tint in the actual view is exactly what
      // the owner reported seeing — list it so a failure names the offenders.
      leftoverGreyed: [...document.querySelectorAll(".xray-off")].filter((e) => e.offsetParent !== null)
        .map((e) => (e.textContent || e.id || e.className).trim().slice(0, 40)),
      tabs: [...document.querySelectorAll(".tabs .tab")].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()),
    }));
    check("nothing is left greyed-out in the actual view", back.leftoverGreyed.length === 0, JSON.stringify(back.leftoverGreyed));
    checkRail("admin actual view", await dashRail(frame));
    console.log(`    tabs shown in the actual view: ${back.tabs.join(" · ")}`);
    check("slim ribbon keeps the way back to the full admin view", back.ribbon && back.full, JSON.stringify(back.tag.trim()));
  }
  await page.close();
}
await admCtx.close();
await browser.close();

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
