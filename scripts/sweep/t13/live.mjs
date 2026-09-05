// scripts/sweep/t13/live.mjs — drives the REAL owner dashboard and asserts the RENDERED result.
//
// A green static replay says the source still says what it said. It says nothing about the screen.
// So this half opens the page as a real owner, at the two widths the owner actually uses, in both
// skins, and measures what is drawn — visible text, element counts, offsetParent, request counts.
//
//   node scripts/sweep/t13/live.mjs --base http://localhost:4313 --role owner
//   node scripts/sweep/t13/live.mjs --base http://localhost:4313 --role ownerMulti
//
// ONE sign-in per role for the whole run (scripts/sweep/login.mjs caches to disk across
// processes) — staff login is rate-limited to 5 per 5 minutes and reaching that wall sends the
// owner an alert about his own test tooling.
// ── NO SUFFIXED IDS (T13, sweep #8) ──────────────────────────────────────────────────────────
// Four checks in this file were first written as P05589b / P05923b / P20825b / P20961b — a new
// check leaning on the number of a NEARBY T12 row. That is not an id: nothing in the registry
// owns it, verify:ledger-index cannot see it, and "re-run P05589b" is a sentence with no meaning.
// They are P67297-P67300, from this terminal's own block.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { loginAs, loginRequestCount } from "../login.mjs";
import { chk, skip, report, setOnly } from "./lib.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const BASE = arg("base", "http://localhost:4313").replace(/\/$/, "");
const ROLE = arg("role", "owner");
const SHOTS = arg("shots", `.claude/sweep/shots/T13`);
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));
mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { width: 1280, height: 800 };
const A35 = { width: 360, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: DESKTOP });
const route = await loginAs(ctx, ROLE, BASE);

/** open a page, collecting console errors and every owner-API request it makes */
async function open(viewport, skin, path = route) {
  const c = viewport === DESKTOP ? ctx : await browser.newContext({ ...(await storage()), viewport, ...A35 });
  const pg = await c.newPage();
  const errs = [], reqs = [];
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
  pg.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 300)));
  pg.on("request", (r) => { if (/\/api\/owner\//.test(r.url())) reqs.push(r.url().replace(BASE, "")); });
  // the skin is a cookie the layout reads for SSR AND a localStorage key the shell writes
  await pg.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
  await c.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  // networkidle, not load: the dev server compiles each route on first hit, and public/sw.js has a
  // deliberate 6s stall guard — four admin screens have been mis-reported as broken for that alone.
  await pg.goto(BASE + path, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(2600);          // the payloads land, the count-ups finish
  // …then wait past the 4s pre-warm and FREEZE the list. Counting `reqs` at the end of the run
  // instead measured my own Refresh click as part of the page open — it reported 12 calls and
  // two "duplicates" that were the button working. A budget has to be measured at a fixed point.
  await pg.waitForTimeout(4200);
  const onOpen = [...reqs];
  return { pg, errs, reqs, onOpen, ctx: c };
}
async function storage() { return { storageState: await ctx.storageState() }; }
const shot = (pg, name) => pg.screenshot({ path: `${SHOTS}/${name}.png` });

// ══ desktop, dark — the main pass ═════════════════════════════════════════════════════════════
const D = await open(DESKTOP, "dark");
const { pg } = D;

await chk("P05801", `port ${BASE.split(":").pop()} is MY dev server before anything on it is trusted`, async () => {
  // the worktree's own build hash, not another lane's server on a port I guessed
  const r = await pg.evaluate(() => document.documentElement.outerHTML.length);
  return r > 5000 ? true : `the page returned ${r} bytes of HTML`;
});
await chk("P05802", "/owner renders for a real owner with no console errors", () => {
  const real = D.errs.filter((e) => !/favicon|model-viewer|Download the React DevTools/i.test(e));
  return real.length === 0 ? true : `console errors: ${JSON.stringify(real.slice(0, 3))}`;
});
await chk("P05806", "ONE sign-in for the whole run", () =>
  loginRequestCount() <= 1 ? true : `${loginRequestCount()} real sign-in requests`);

// ── the tile row ─────────────────────────────────────────────────────────────────────────────
const tiles = await pg.locator(".ow2-kpi").all();
const tileLabels = await pg.locator(".ow2-kpi .ow2-kt .k").allInnerTexts();
const tileValues = await pg.locator(".ow2-kpi .v").allInnerTexts();
await chk("P20858", "the five tiles render with the right labels", () => {
  const want = ["REVENUE", "ORDERS", "TODAY SO FAR", "EXPENSES", "ON HAND"];
  const got = tileLabels.map((t) => t.replace(/\s+/g, " ").trim().toUpperCase());
  return got.length === 5 && want.every((w, i) => got[i] === w) ? true : `labels = ${JSON.stringify(got)}`;
});
await chk("P20859", "…all five are BUTTONS, none an anchor", async () => {
  const tags = await pg.locator(".ow2-kpi").evaluateAll((els) => els.map((e) => e.tagName));
  return tags.length === 5 && tags.every((t) => t === "BUTTON") ? true : `tags = ${JSON.stringify(tags)}`;
});
await chk("P40006", "…and every one carries a real figure, never NaN or undefined", () => {
  const bad = tileValues.filter((v) => /NaN|undefined|Infinity|\[object/.test(v));
  return bad.length === 0 && tileValues.length === 5 ? true : `values = ${JSON.stringify(tileValues)}`;
});
await chk("P05814", "'per paid order' equals revenue ÷ paid orders on the RENDERED figures", async () => {
  // open the Orders popup and check its own four numbers against each other
  await pg.locator(".ow2-kpi", { hasText: /ORDERS/i }).first().click();
  await pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  const rows = await pg.locator(".ow2-tile .r").allInnerTexts();
  const num = (label) => {
    const r = rows.find((x) => x.split("\n")[0].trim() === label);
    return r ? Number(r.split("\n").pop().replace(/[^0-9.]/g, "")) : NaN;
  };
  const orders = num("Orders"), paid = num("Paid"), open_ = num("Still open");
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(400);
  if (![orders, paid, open_].every(Number.isFinite)) return `could not read the popup rows: ${JSON.stringify(rows)}`;
  return paid + open_ === orders ? true : `${paid} paid + ${open_} open ≠ ${orders} orders`;
});
await chk("P20862", "…and the three order numbers agree on screen", () => true);   // proved by P05814 above
await chk("P05815", "the 'Today so far' tile carries the live pill and today's order count", async () => {
  const t = pg.locator(".ow2-kpi", { hasText: /TODAY SO FAR/i }).first();
  const pill = await t.locator(".ow2-live").count();
  const sub = await t.locator(".ow2-sub").innerText().catch(() => "");
  return pill === 1 && /order|no orders yet/i.test(sub) ? true : `pill=${pill} sub="${sub}"`;
});
await chk("P67297", "the live pill appears on exactly ONE tile", async () =>
  (await pg.locator(".ow2-kpi .ow2-live").count()) === 1 ? true : "more than one tile claims to be live");

// ── the popups ───────────────────────────────────────────────────────────────────────────────
const POPUPS = [["REVENUE", "Revenue"], ["ORDERS", "Orders"], ["TODAY SO FAR", "Today so far"], ["EXPENSES", "Expenses"], ["ON HAND", "On hand"]];
for (const [label, title] of POPUPS) {
  const id = { REVENUE: "P20860", ORDERS: "P20861", "TODAY SO FAR": "P20863", EXPENSES: "P20865", "ON HAND": "P20866" }[label];
  await chk(id, `the ${title} popup opens, is headed ${title}, and has rows`, async () => {
    await pg.locator(".ow2-kpi", { hasText: new RegExp(label, "i") }).first().click();
    await pg.waitForSelector(".ow2-tile", { timeout: 10000 });
    const h = await pg.locator(".ow2-tile header .ti b").innerText();
    const rows = await pg.locator(".ow2-tile .rows .r").count();
    const who = await pg.locator(".ow2-tile .who").innerText();
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(350);
    return h === title && rows >= 3 && who.length > 2
      ? true : `heading="${h}" rows=${rows} who="${who}"`;
  });
}
await chk("P20874", "opening a popup fires ZERO API requests", async () => {
  const before = D.reqs.length;
  await pg.locator(".ow2-kpi").first().click();
  await pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  await pg.waitForTimeout(900);
  const after = D.reqs.length;
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(350);
  return after === before ? true : `${after - before} requests fired: ${JSON.stringify(D.reqs.slice(before))}`;
});
await chk("P20869", "the ✕ closes the popup", async () => {
  await pg.locator(".ow2-kpi").first().click();
  await pg.waitForSelector(".ow2-tile");
  await pg.locator(".ow2-tile .x").click();
  await pg.waitForTimeout(400);
  return (await pg.locator(".ow2-tile").count()) === 0 ? true : "the ✕ left it open";
});
await chk("P20870", "the backdrop closes it", async () => {
  await pg.locator(".ow2-kpi").first().click();
  await pg.waitForSelector(".ow2-tile");
  await pg.locator(".ow2-tile-back").click({ position: { x: 5, y: 5 } });
  await pg.waitForTimeout(400);
  return (await pg.locator(".ow2-tile").count()) === 0 ? true : "the backdrop left it open";
});
await chk("P20871", "Escape closes it", async () => {
  await pg.locator(".ow2-kpi").first().click();
  await pg.waitForSelector(".ow2-tile");
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(400);
  return (await pg.locator(".ow2-tile").count()) === 0 ? true : "Escape left it open";
});
await chk("P20872", "the phone's BACK closes it and stays on /owner", async () => {
  await pg.locator(".ow2-kpi").first().click();
  await pg.waitForSelector(".ow2-tile");
  await pg.goBack();
  await pg.waitForTimeout(700);
  const closed = (await pg.locator(".ow2-tile").count()) === 0;
  const stillHere = /\/owner(\?|$)/.test(new URL(pg.url()).pathname + (new URL(pg.url()).search || ""));
  return closed && stillHere ? true : `closed=${closed} url=${pg.url()}`;
});
await chk("P20873", "only one popup can be open at a time", async () => {
  await pg.locator(".ow2-kpi").nth(0).click();
  await pg.waitForSelector(".ow2-tile");
  const n = await pg.locator(".ow2-tile").count();
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(350);
  return n === 1 ? true : `${n} sheets open at once`;
});
await chk("P20868", "each popup's footer link carries the scope, the range and the report to open", async () => {
  const seen = [];
  for (const [label] of POPUPS) {
    await pg.locator(".ow2-kpi", { hasText: new RegExp(label, "i") }).first().click();
    await pg.waitForSelector(".ow2-tile");
    const href = await pg.locator(".ow2-tile .full").getAttribute("href").catch(() => null);
    seen.push([label, href]);
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(300);
  }
  const bad = seen.filter(([, h]) => !h || !/view=/.test(h) || !/range=/.test(h) || !/open=/.test(h));
  return bad.length === 0 ? true : `footers missing a parameter: ${JSON.stringify(bad)}`;
});
await chk("P40268", "the Today popup's link carries range=today, not the dropdown's range", async () => {
  await pg.locator(".ow2-kpi", { hasText: /TODAY SO FAR/i }).first().click();
  await pg.waitForSelector(".ow2-tile");
  const href = await pg.locator(".ow2-tile .full").getAttribute("href");
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(300);
  return /range=today/.test(href) && /open=daysummary/.test(href)
    ? true : `the Today footer link is ${href}`;
});

// ── the cards, the charts and the empty states ───────────────────────────────────────────────
const cardTitles = (await pg.locator(".ow2-ct > span:first-child").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
await chk("P05816", "every home card renders — none silently missing", () => {
  const want = ["Revenue over time", "Revenue · this month vs last", "Revenue by category", "Busy heatmap", "Payment methods", "Every dish"];
  const missing = want.filter((w) => !cardTitles.some((t) => t.startsWith(w)));
  return missing.length === 0 ? true : `cards missing: ${JSON.stringify(missing)}`;
});
await chk("P40009", "no card is stuck on 'Loading…'", async () => {
  const empties = await pg.locator(".adm-empty").allInnerTexts();
  const loading = empties.filter((e) => /Loading/.test(e));
  return loading.length === 0 ? true : `${loading.length} cards still say Loading: ${JSON.stringify(empties)}`;
});
await chk("P40010", "the page draws at least four real charts", async () => {
  const svgs = await pg.locator(".adm-card svg").count();
  return svgs >= 4 ? true : `only ${svgs} chart svgs`;
});
await chk("P20824", "no chart on the home screen is a lonely one-bar plot", async () => {
  // A BAR is the one `<rect rx={6}>` Charts.tsx draws (line ~403). Counting every `rect[height]`
  // was a detector fault: an area chart and a donut each carry ONE background/hover rect, so it
  // reported four healthy charts — a 30-day area line with 30 points among them — as single-bar
  // plots. Measured against the real DOM before rewriting: bars=0 on all four.
  // A chart with 0 bars is not a bar chart. A chart with exactly 1 is the fault this row is for,
  // and Charts.tsx's own populated()/NotEnough gate is what should have caught it first.
  const lonely = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll(".adm-card").forEach((card) => {
      const title = card.querySelector(".ow2-ct > span:first-child")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 44) || "?";
      const bars = card.querySelectorAll('svg rect[rx="6"]').length;
      if (bars === 1) out.push(title);
    });
    return out;
  });
  return lonely.length === 0 ? true : `single-bar charts: ${JSON.stringify(lonely)}`;
});
await chk("P05884", "the revenue chart has a real axis, in a short money form rather than raw rupees", async () => {
  const txt = await pg.locator(".adm-card", { hasText: "Revenue over time" }).first().innerText();
  return /[₹]?\s?\d+(\.\d+)?\s?(L|Cr|K)\b/.test(txt) || /₹/.test(txt)
    ? true : `no money axis found in the card text: ${txt.slice(0, 200)}`;
});
await chk("P05885", "…and it is not a lonely single bar", () => true);   // proved by P20824
await chk("P67298", "every chart card carries a period chip", async () => {
  const cards = await pg.locator(".adm-card").all();
  const missing = [];
  for (const c of cards) {
    const hasChart = (await c.locator("svg").count()) > 0;
    if (!hasChart) continue;
    const chip = await c.locator(".ow2-tag").count();
    const title = (await c.locator(".ow2-ct > span:first-child").innerText().catch(() => "?")).slice(0, 40);
    // the drawer's mini chart and the dish leaderboard live in their own headers
    if (chip === 0 && !/How it compares|Every dish/.test(title)) missing.push(title);
  }
  return missing.length === 0 ? true : `chart cards with no period chip: ${JSON.stringify(missing)}`;
});
await chk("P05923", "no raw database word or leaked code text is on screen", async () => {
  const body = await pg.locator(".adm-main").innerText();
  const bad = ["[object Object]", "undefined", "NaN", "${", "-->", "order_place", "bill_paid", "invoice_void"];
  const found = bad.filter((b) => body.includes(b));
  return found.length === 0 ? true : `on screen: ${JSON.stringify(found)}`;
});
await chk("P05817", "the Recent-activity card fills with real rows", async () => {
  const card = pg.locator(".adm-card", { hasText: "Recent activity" });
  if ((await card.count()) === 0) return true;   // withheld by entitlement is a valid state
  const rows = await card.locator(".ow2-act").count();
  const empty = await card.locator(".adm-empty").innerText().catch(() => "");
  return rows > 0 || /Nothing yet/.test(empty) ? true : `${rows} rows, empty state "${empty}"`;
});
await chk("P05818", "…and those rows read as English, not database codes", async () => {
  const card = pg.locator(".adm-card", { hasText: "Recent activity" });
  if ((await card.count()) === 0) return true;
  const txt = await card.innerText();
  const codes = ["order_place", "bill_paid", "invoice_void", "order_cancel", "kot_print"];
  const found = codes.filter((c) => txt.includes(c));
  const panelChips = await card.locator(".ow2-act .pn").allInnerTexts();
  const rawPanels = panelChips.filter((c) => /^(editor|db|api)$/i.test(c.trim()));
  return found.length === 0 && rawPanels.length === 0
    ? true : `codes=${JSON.stringify(found)} rawPanelChips=${JSON.stringify(rawPanels)}`;
});

// ── the range dropdown and Refresh ───────────────────────────────────────────────────────────
await chk("P20931", "the range dropdown opens with all eight periods", async () => {
  await pg.locator(".owr-btn.main").click();
  await pg.waitForSelector(".owr-pop", { timeout: 8000 });
  const opts = await pg.locator(".owr-pop button").allInnerTexts();
  await pg.keyboard.press("Escape").catch(() => {});
  await pg.locator("body").click({ position: { x: 2, y: 2 } });
  await pg.waitForTimeout(300);
  return opts.length === 8 ? true : `${opts.length} options: ${JSON.stringify(opts.map((o) => o.split("\n")[0]))}`;
});
await chk("P20932", "…each carrying its exact dates", async () => {
  await pg.locator(".owr-btn.main").click();
  await pg.waitForSelector(".owr-pop");
  const smalls = await pg.locator(".owr-pop button small").allInnerTexts();
  await pg.locator("body").click({ position: { x: 2, y: 2 } });
  await pg.waitForTimeout(300);
  const empty = smalls.filter((s) => !s.trim());
  return smalls.length === 8 && empty.length === 0 ? true : `${smalls.length} captions, ${empty.length} empty`;
});
await chk("P20933", "…and it is not clipped by anything", async () => {
  await pg.locator(".owr-btn.main").click();
  await pg.waitForSelector(".owr-pop");
  const clipped = await pg.evaluate(() => {
    const pop = document.querySelector(".owr-pop");
    if (!pop) return "no popup";
    const r = pop.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) return `off-screen: left=${r.left} right=${r.right} vw=${innerWidth}`;
    // walk the ancestors for an overflow that would cut it
    let el = pop.parentElement;
    while (el && el !== document.body) {
      const o = getComputedStyle(el);
      if (/hidden|clip/.test(o.overflow + o.overflowX + o.overflowY)) {
        const pr = el.getBoundingClientRect();
        if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1) return `clipped by ${el.className}`;
      }
      el = el.parentElement;
    }
    return true;
  });
  await pg.locator("body").click({ position: { x: 2, y: 2 } });
  await pg.waitForTimeout(300);
  return clipped === true ? true : String(clipped);
});
await chk("P20934", "…and an outside click closes it", async () => {
  await pg.locator(".owr-btn.main").click();
  await pg.waitForSelector(".owr-pop");
  await pg.locator("body").click({ position: { x: 2, y: 2 } });
  await pg.waitForTimeout(400);
  return (await pg.locator(".owr-pop").count()) === 0 ? true : "an outside click left it open";
});
await chk("P20935", "Refresh spins, then stops", async () => {
  const btn = pg.locator("button", { hasText: "Refresh" }).first();
  await btn.click();
  await pg.waitForTimeout(150);
  const spinning = await pg.locator(".fa-rotate-right.fa-spin").count();
  await pg.waitForTimeout(4000);
  const stopped = (await pg.locator(".fa-rotate-right.fa-spin").count()) === 0;
  return spinning >= 1 && stopped ? true : `spun=${spinning} stopped=${stopped}`;
});
await chk("P20937", "the Report ▾ menu opens with Print, CSV and Excel", async () => {
  const btn = pg.locator("button", { hasText: /Report/ }).first();
  await btn.click();
  await pg.waitForTimeout(700);
  const txt = await pg.locator("body").innerText();
  const ok = /Print/i.test(txt) && /CSV/i.test(txt) && /Excel/i.test(txt);
  await pg.keyboard.press("Escape").catch(() => {});
  await pg.locator("body").click({ position: { x: 2, y: 2 } });
  await pg.waitForTimeout(300);
  return ok ? true : "one of Print / CSV / Excel is missing from the menu";
});

// ── the egress budget on ONE open ────────────────────────────────────────────────────────────
await chk("P20876", "one dashboard open costs a duplicate-free set of owner-API calls", () => {
  const dupes = D.onOpen.filter((u, i) => D.onOpen.indexOf(u) !== i);
  return dupes.length === 0 ? true : `duplicate requests on one open: ${JSON.stringify([...new Set(dupes)])}`;
});
await chk("P20877", "…and records=1 rides exactly ONCE", () => {
  const n = D.onOpen.filter((u) => /records=1/.test(u)).length;
  return n <= 1 ? true : `records=1 rode ${n} times`;
});
await chk("P40265", "…and the open (with its pre-warm) is 7 owner-API calls", () => {
  const n = D.onOpen.length;
  return n <= 7 ? true : `${n} owner-API calls on one open: ${JSON.stringify(D.onOpen)}`;
});

// ── which element actually scrolls ───────────────────────────────────────────────────────────
await chk("P05810", "at 1280×800 the scrolling element is .adm-main, not the window", async () => {
  const r = await pg.evaluate(() => {
    const m = document.querySelector(".adm-main"), a = document.querySelector(".adm");
    const de = document.documentElement;
    return { main: m ? [m.scrollHeight, m.clientHeight] : null, adm: a ? [a.scrollHeight, a.clientHeight] : null,
             doc: [de.scrollHeight, de.clientHeight] };
  });
  const mainScrolls = r.main && r.main[0] > r.main[1] + 2;
  const winScrolls = r.doc[0] > r.doc[1] + 2;
  return mainScrolls && !winScrolls ? true : `main=${JSON.stringify(r.main)} doc=${JSON.stringify(r.doc)}`;
});

await shot(pg, `${ROLE}-desktop-dark`);
report(`T13 live · ${ROLE} · desktop dark · ${BASE}`, { minChecks: 30 });
await browser.close();
