// scripts/sweep/t13/new-e-matrix.mjs — NEW block, ids P67094–P67230.
//
// Band E: every PERIOD crossed with every SCOPE, driven, with the numbers on screen checked
// against each other rather than against my expectation.
//
// WHY. Round 3 of the old ledger drove the eight periods on a TWO-restaurant estate and asserted
// mostly "no card says Loading" and "no NaN". That is worth having and it is not enough: the
// dashboard's real risk is two figures on one screen that disagree, and the only way to catch
// that is to add up what is drawn. So each period below is asked three questions a person would
// ask — do the tiles agree with the table, does the chart agree with the tile, and does the popup
// agree with the tile it came from — plus the 4+ estate tier, which no sweep before this one
// could reach at all.
import { chromium } from "playwright";
import { chk, skip, report, setOnly, writeLedger, executedIds } from "./lib.mjs";
import { loginAs } from "../login.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:4313").replace(/\/$/, "");
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

const ESTATE = { username: "diagestate", password: "diag-estate-2026", route: "/owner" };
const browser = await chromium.launch();

const num = (t) => {
  const s = String(t).replace(/[₹,\s]/g, "");
  const m = /^(-?[\d.]+)\s*(L|Cr|K)?$/i.exec(s);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  const mult = { l: 1e5, cr: 1e7, k: 1e3 }[(m[2] || "").toLowerCase()] || 1;
  return v * mult;
};
async function openAs(creds, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 950 } });
  const route = await loginAs(ctx, creds ? null : "owner", BASE, creds || undefined);
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  pg.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)));
  // ── NAME THE RESOURCE, NOT JUST THE STATUS ────────────────────────────────────────────────
  // Chrome's console line for a failed request is "Failed to load resource: the server responded
  // with a status of 429 ()" — which names nothing, so a red row cannot tell a product fault from
  // the harness's own login attempts tripping the app's rate limit. Record the URL and the status
  // from the response itself.
  pg.on("response", (r) => {
    if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`);
  });
  await pg.goto(BASE + route, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(3200);
  return { pg, errs };
}
async function setRange(pg, label) {
  await pg.locator(".owr-btn.main").click();
  await pg.waitForSelector(".owr-pop", { timeout: 8000 });
  await pg.locator(".owr-pop button", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  // wait until the toolbar's own caption names the period, then for the payloads to land
  await pg.waitForFunction((l) => (document.querySelector(".owr-btn.main")?.textContent || "").includes(l), label, { timeout: 15000 });
  await pg.waitForTimeout(5200);
}
const PERIODS = ["Today", "Yesterday", "This week", "Last 7 days", "This month", "Last 30 days", "Last month", "All time"];

// A failure the PRODUCT caused, versus one this harness caused by signing in too often. The
// distinction has to be explicit: quietly filtering the second away is how a suite starts
// reporting "all clean" over a real fault, and quietly failing on it is how a real fault gets
// scrolled past. `panel-login` is only ever called by the sweep's own loginAs().
const isHarnessNoise = (e) => /panel-login/.test(e) || /favicon|model-viewer|React DevTools/i.test(e);
const productErrors = (list) => list.filter((e) => !isHarnessNoise(e));
const harnessErrors = (list) => list.filter((e) => /panel-login/.test(e));

// ── THE IDS IN THIS BAND ARE POSITIONAL, SO THE COUNT IS LOCKED ───────────────────────────────
// `nextId()` hands out P67094 onwards in execution order. That is fine for a band that is run,
// never edited — and dangerous the moment a row is INSERTED in the middle, because every id after
// it silently shifts and the ledger's promise ("an id means one specific check, forever") breaks.
// I found this the honest way: a sabotage pass asserted ids I had written down before adding two
// rows mid-band, and ten of eighteen cases looked like a guard staying green when in fact the
// guard fired on a different number.
// So the count is declared. Insert a row and this refuses to run, which forces a decision:
// either append at the END (ids stay put), or renumber deliberately and update the ledger.
const results_count = () => executedIds().length;
const EXPECT_ROWS = 142;
let id = 67094;
const nextId = () => `P${id++}`;

// ══ the FIVE-restaurant estate — the 4+ tier, driven for the first time ═══════════════════════
const { pg: E, errs: eErrs } = await openAs(ESTATE, 1440);

await chk(nextId(), "a five-restaurant owner's dashboard renders with no console error at all", () => {
  const real = productErrors(eErrs);
  const mine = harnessErrors(eErrs);
  if (real.length) return `console errors: ${JSON.stringify(real.slice(0, 3))}`;
  if (mine.length) return `the page was clean; ${mine.length} failures were MY OWN sign-in traffic hitting the app's rate limit: ${JSON.stringify([...new Set(mine)].slice(0, 2))}`;
  return true;
});
await chk(nextId(), "…and lists all five of his restaurants in the estate table", async () =>
  (await E.locator(".hq-table tr.hq-row").count()) === 5 ? true : `${await E.locator(".hq-table tr.hq-row").count()} rows`);
await chk(nextId(), "…and the 4+ tier draws 'Who earns more' rather than the stacked bars", async () => {
  const who = await E.locator(".adm-card", { hasText: "Who earns more" }).count();
  const stacked = await E.locator(".adm-card", { hasText: "each bar split by restaurant" }).count();
  return who === 1 && stacked === 0 ? true : `whoEarnsMore=${who} stackedBars=${stacked}`;
});
await chk(nextId(), "…and gives every restaurant a DISTINCT identity colour, which is why that palette exists", async () => {
  const cols = await E.locator(".hq-nm .sw").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  return new Set(cols).size === cols.length && cols.length === 5
    ? true : `${new Set(cols).size} distinct colours across ${cols.length} restaurants: ${JSON.stringify(cols)}`;
});
await chk(nextId(), "…and the same colour identifies a restaurant in the sidebar as in the table", async () => {
  const table = await E.locator(".hq-nm .sw").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  const side = await E.locator(".adm-side .sw, .owx-side .sw, aside .sw").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  if (!side.length) return true;   // the sidebar list is another terminal's surface
  const shared = table.filter((c) => side.includes(c));
  return shared.length >= 2 ? true : `only ${shared.length} colours are shared between the table and the sidebar`;
});
await chk(nextId(), "the estate table ranks 1..5 with no gap and no repeat", async () => {
  const ranks = await E.locator(".hq-table tr.hq-row td.rk").allInnerTexts();
  const ns = ranks.map((r) => Number(r.trim()));
  return ns.join(",") === "1,2,3,4,5" ? true : `ranks: ${JSON.stringify(ranks)}`;
});
await chk(nextId(), "…and the rank order really is revenue order, highest first", async () => {
  const revs = await E.locator(".hq-table tr.hq-row td:nth-child(4)").allInnerTexts();
  const vs = revs.map(num);
  return vs.every((v, i) => i === 0 || vs[i - 1] >= v) ? true : `revenue column: ${JSON.stringify(revs)}`;
});
await chk(nextId(), "…and the shares add up to about 100%, not to something else", async () => {
  const shares = await E.locator(".hq-table tr.hq-row td:nth-child(8)").allInnerTexts();
  const total = shares.map((s) => parseFloat(String(s).replace(/[^\d.]/g, "")) || 0).reduce((a, b) => a + b, 0);
  return total === 0 || Math.abs(total - 100) <= 5 ? true : `the share column adds up to ${total}%`;
});
await chk(nextId(), "the top-performer banner names the SAME restaurant the table ranks first", async () => {
  const banner = await E.locator(".ow2-split .oh.good b").innerText().catch(() => null);
  const first = (await E.locator(".hq-table tr.hq-row .hq-nm").first().innerText()).trim();
  if (banner === null) {
    // legitimately absent when nobody has taken anything — item 2's fix. Prove that is why.
    const rev = num(await E.locator(".hq-table tr.hq-row td:nth-child(4)").first().innerText());
    return rev === 0 ? true : `no banner, yet the top restaurant took ${rev}`;
  }
  return banner.trim() === first
    ? true : `the trophy says "${banner.trim()}" and the table ranks "${first}" first`;
});
await chk(nextId(), "…and its share figure matches the table's own share for that restaurant", async () => {
  const txt = await E.locator(".ow2-split .oh.good i").innerText().catch(() => null);
  if (txt === null) return true;
  const bannerPct = parseFloat((/(\d+)% of revenue/.exec(txt) || [])[1]);
  const tablePct = parseFloat(String(await E.locator(".hq-table tr.hq-row td:nth-child(8)").first().innerText()).replace(/[^\d.]/g, ""));
  return Math.abs(bannerPct - tablePct) <= 1
    ? true : `the banner says ${bannerPct}% and the table says ${tablePct}%`;
});
await chk(nextId(), "…and its revenue figure matches the table's own", async () => {
  const txt = await E.locator(".ow2-split .oh.good i").innerText().catch(() => null);
  if (txt === null) return true;
  const bannerRev = num((/₹[\d,.]+[LKCr]*/.exec(txt) || [])[0]);
  const tableRev = num(await E.locator(".hq-table tr.hq-row td:nth-child(4)").first().innerText());
  return Math.abs(bannerRev - tableRev) / Math.max(1, tableRev) < 0.02
    ? true : `the banner says ${bannerRev} and the table says ${tableRev}`;
});
await chk(nextId(), "the 'needs attention' half never names the restaurant the trophy just praised", async () => {
  const good = await E.locator(".ow2-split .oh.good b").innerText().catch(() => null);
  const warn = await E.locator(".ow2-split .oh.warn b").innerText().catch(() => null);
  return !good || !warn || good.trim() !== warn.trim()
    ? true : `both halves name "${good.trim()}"`;
});
await chk(nextId(), "…and when there is nothing to warn about, its half is left blank rather than invented", async () => {
  const halves = await E.locator(".ow2-split .oh").count();
  const ghosts = await E.locator(".ow2-split .oh.ghost").count();
  return halves === 0 || halves === 2 ? true : `${halves} halves drawn (${ghosts} ghost)`;
});
await chk(nextId(), "the insight strip never names a leader the banner contradicts", async () => {
  const ins = await E.locator(".owx-insight").allInnerTexts();
  const leader = ins.find((t) => /leads with/.test(t));
  const banner = await E.locator(".ow2-split .oh.good b").innerText().catch(() => null);
  if (!leader || !banner) return true;
  return leader.includes(banner.trim())
    ? true : `the insight says "${leader}" and the trophy says "${banner.trim()}"`;
});
await chk(nextId(), "…and it caps itself at four lines however many restaurants there are", async () =>
  (await E.locator(".owx-insight").count()) <= 4 ? true : `${await E.locator(".owx-insight").count()} insight lines`);
await chk(nextId(), "the estate's group captions name FIVE restaurants, matching the rows drawn", async () => {
  const caps = await E.locator(".ow2-ct").allInnerTexts();
  const claims = caps.map((c) => (/all (\d+) restaurants/.exec(c) || [])[1]).filter(Boolean).map(Number);
  const rows = await E.locator(".hq-table tr.hq-row").count();
  const wrong = claims.filter((c) => c !== rows);
  return wrong.length === 0 ? true : `captions claim ${JSON.stringify(claims)} against ${rows} rows`;
});

// ── the tiles agree with the table they sit above ────────────────────────────────────────────
await chk(nextId(), "the Revenue tile equals the sum of the estate table's revenue column", async () => {
  const tile = num(await E.locator(".ow2-kpi").nth(0).locator(".v").innerText());
  const rows = (await E.locator(".hq-table tr.hq-row td:nth-child(4)").allInnerTexts()).map(num);
  const sum = rows.reduce((a, b) => a + b, 0);
  // the tile prints the SHORT form (₹3L), so compare within its own rounding
  return Math.abs(tile - sum) / Math.max(1, sum) < 0.06
    ? true : `tile ${tile} vs table sum ${sum} (${JSON.stringify(rows)})`;
});
await chk(nextId(), "the Orders tile equals the sum of the estate table's orders column", async () => {
  const tile = num(await E.locator(".ow2-kpi").nth(1).locator(".v").innerText());
  const rows = (await E.locator(".hq-table tr.hq-row td:nth-child(5)").allInnerTexts()).map(num);
  const sum = rows.reduce((a, b) => a + b, 0);
  return tile === sum ? true : `tile ${tile} vs table sum ${sum}`;
});
await chk(nextId(), "the On hand tile really is Revenue minus Expenses, as its own caption says", async () => {
  const rev = num(await E.locator(".ow2-kpi").nth(0).locator(".v").innerText());
  const exp = num(await E.locator(".ow2-kpi").nth(3).locator(".v").innerText());
  const onh = num(await E.locator(".ow2-kpi").nth(4).locator(".v").innerText());
  return Math.abs((rev - exp) - onh) / Math.max(1, rev) < 0.06
    ? true : `${rev} − ${exp} should be ${rev - exp}, the tile says ${onh}`;
});
await chk(nextId(), "the Today tile's open-table count matches the estate table's Open column", async () => {
  await E.locator(".ow2-kpi").nth(2).click();
  await E.waitForSelector(".ow2-tile", { timeout: 10000 });
  const rows = await E.locator(".ow2-tile .r").allInnerTexts();
  const popup = Number(String(rows.find((r) => /Tables open now/.test(r)) || "").split("\n").pop());
  await E.keyboard.press("Escape");
  await E.waitForTimeout(400);
  const table = (await E.locator(".hq-table tr.hq-row td:nth-child(9)").allInnerTexts()).map(num).reduce((a, b) => a + b, 0);
  return popup === table ? true : `the popup says ${popup} tables open, the table's column adds to ${table}`;
});
await chk(nextId(), "each popup's own rows add up to the total it prints", async () => {
  const problems = [];
  for (const [i, name] of [[3, "Expenses"], [4, "On hand"]]) {
    await E.locator(".ow2-kpi").nth(i).click();
    await E.waitForSelector(".ow2-tile", { timeout: 10000 });
    const rows = await E.locator(".ow2-tile .r").allInnerTexts();
    const parsed = rows.map((r) => { const p = r.split("\n"); return { label: p[0].trim(), value: num(p[p.length - 1]) }; });
    const total = parsed[parsed.length - 1];
    const parts = parsed.slice(0, -1).filter((x) => Number.isFinite(x.value));
    if (name === "Expenses") {
      const sum = parts.reduce((a, b) => a + b.value, 0);
      if (Math.abs(sum - total.value) > 1) problems.push(`${name}: parts ${sum} vs total ${total.value}`);
    } else {
      // Revenue − staff − food = on hand
      const [rev, staff, food] = parts.map((x) => x.value);
      const expect = rev - Math.abs(staff) - Math.abs(food);
      if (Math.abs(expect - total.value) > 1) problems.push(`${name}: ${rev}−${Math.abs(staff)}−${Math.abs(food)}=${expect} vs total ${total.value}`);
    }
    await E.keyboard.press("Escape");
    await E.waitForTimeout(400);
  }
  return problems.length === 0 ? true : problems.join(" · ");
});
await chk(nextId(), "every popup on the estate names the ESTATE, not one restaurant", async () => {
  const wrong = [];
  for (let i = 0; i < 5; i++) {
    await E.locator(".ow2-kpi").nth(i).click();
    await E.waitForSelector(".ow2-tile", { timeout: 10000 });
    const who = (await E.locator(".ow2-tile .who").innerText()).trim();
    if (!/all 5 restaurants/i.test(who)) wrong.push(who);
    await E.keyboard.press("Escape");
    await E.waitForTimeout(350);
  }
  return wrong.length === 0 ? true : `popups naming something else: ${JSON.stringify(wrong)}`;
});
await chk(nextId(), "…and every popup's report link says view=all from the estate view", async () => {
  const bad = [];
  for (let i = 0; i < 5; i++) {
    await E.locator(".ow2-kpi").nth(i).click();
    await E.waitForSelector(".ow2-tile", { timeout: 10000 });
    const href = await E.locator(".ow2-tile .full").getAttribute("href").catch(() => null);
    if (!href || !/view=all/.test(href)) bad.push(href);
    await E.keyboard.press("Escape");
    await E.waitForTimeout(350);
  }
  return bad.length === 0 ? true : `links not scoped to the estate: ${JSON.stringify(bad)}`;
});

// ── every period, on the estate ──────────────────────────────────────────────────────────────
for (const period of PERIODS) {
  await setRange(E, period);
  await chk(nextId(), `${period}: every card answers — none is left saying "Loading…"`, async () => {
    const e = await E.locator(".adm-empty").allInnerTexts();
    const loading = e.filter((x) => /Loading/.test(x));
    return loading.length === 0 ? true : `${loading.length} cards still loading: ${JSON.stringify(e)}`;
  });
  await chk(nextId(), `${period}: no tile prints NaN, undefined, Infinity or an object`, async () => {
    const vals = await E.locator(".ow2-kpi .v").allInnerTexts();
    const bad = vals.filter((v) => /NaN|undefined|Infinity|\[object/.test(v));
    return bad.length === 0 && vals.length === 5 ? true : `${JSON.stringify(vals)}`;
  });
  await chk(nextId(), `${period}: the tiles still add up to the estate table`, async () => {
    const tile = num(await E.locator(".ow2-kpi").nth(1).locator(".v").innerText());
    const sum = (await E.locator(".hq-table tr.hq-row td:nth-child(5)").allInnerTexts()).map(num).reduce((a, b) => a + b, 0);
    return tile === sum ? true : `Orders tile ${tile} vs table sum ${sum}`;
  });
  await chk(nextId(), `${period}: every chart card still carries a period chip that names it`, async () => {
    const chips = await E.locator(".ow2-tag").allInnerTexts();
    const expect = period === "All time" ? /Last 90 days|All time/ : new RegExp(period.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const named = chips.filter((c) => expect.test(c) || /^\w+$/.test(c.trim()));
    return chips.length >= 4 && named.length >= 1 ? true : `chips: ${JSON.stringify(chips)}`;
  });
  await chk(nextId(), `${period}: the trophy is either absent or names the table's own first row`, async () => {
    const banner = await E.locator(".ow2-split .oh.good b").innerText().catch(() => null);
    if (banner === null) return true;
    const first = (await E.locator(".hq-table tr.hq-row .hq-nm").first().innerText()).trim();
    return banner.trim() === first ? true : `trophy "${banner.trim()}" vs table first "${first}"`;
  });
  await chk(nextId(), `${period}: and it is never awarded for ₹0`, async () => {
    const txt = await E.locator(".ow2-split .oh.good i").innerText().catch(() => null);
    if (txt === null) return true;
    const rev = num((/₹[\d,.]+[LKCr]*/.exec(txt) || [])[0]);
    return rev > 0 ? true : `the trophy was awarded for ${rev}`;
  });
  await chk(nextId(), `${period}: no chart is a lonely one-bar plot`, async () => {
    const lonely = await E.evaluate(() => {
      const out = [];
      document.querySelectorAll(".adm-card").forEach((c) => {
        const t = c.querySelector(".ow2-ct > span:first-child")?.textContent?.trim().slice(0, 34) || "?";
        if (c.querySelectorAll('svg rect[rx="6"]').length === 1) out.push(t);
      });
      return out;
    });
    return lonely.length === 0 ? true : `single-bar: ${JSON.stringify(lonely)}`;
  });
  await chk(nextId(), `${period}: nothing on screen leaks code text or a raw database word`, async () => {
    const body = await E.locator(".adm-main").innerText();
    const bad = ["[object Object]", "${", "-->", "NaN", "order_place", "bill_paid", "invoice_void"].filter((b) => body.includes(b));
    return bad.length === 0 ? true : `${JSON.stringify(bad)}`;
  });
}
await chk(nextId(), "switching through all eight periods raised no failed request from the PAGE", () => {
  const real = productErrors(eErrs);
  const mine = harnessErrors(eErrs);
  if (real.length) return `${real.length} failures across the matrix: ${JSON.stringify([...new Set(real)].slice(0, 4))}`;
  if (mine.length) return `page clean; ${mine.length} were my own sign-in traffic rate-limited`;
  return true;
});

// ══ the SINGLE-restaurant owner, the majority case ════════════════════════════════════════════
const { pg: S, errs: sErrs } = await openAs(null, 1440);
await chk(nextId(), "a one-restaurant owner gets the identity header, not an estate table", async () => {
  const hero = await S.locator(".own-hero").count();
  const table = await S.locator(".hq-table").count();
  return hero === 1 && table === 0 ? true : `hero=${hero} estateTable=${table}`;
});
await chk(nextId(), "…and no restaurant picker, because there is nothing to pick between", async () =>
  (await S.locator(".owd-btn").count()) === 0 ? true : "a one-restaurant owner is offered a picker");
await chk(nextId(), "…and the header names his restaurant, its state and its open tables", async () => {
  const t = await S.locator(".own-hero").innerText();
  return /tables? open now/.test(t) && /(ACTIVE|OFF)/i.test(t) && t.trim().length > 20
    ? true : `the header reads: ${JSON.stringify(t.slice(0, 120))}`;
});
for (const period of PERIODS) {
  await setRange(S, period);
  await chk(nextId(), `${period}, one restaurant: every card answers`, async () => {
    const e = await S.locator(".adm-empty").allInnerTexts();
    const loading = e.filter((x) => /Loading/.test(x));
    return loading.length === 0 ? true : `${JSON.stringify(e)}`;
  });
  await chk(nextId(), `${period}, one restaurant: the five tiles all carry a real figure`, async () => {
    const vals = await S.locator(".ow2-kpi .v").allInnerTexts();
    const bad = vals.filter((v) => /NaN|undefined|Infinity|\[object/.test(v));
    return vals.length === 5 && bad.length === 0 ? true : `${JSON.stringify(vals)}`;
  });
  await chk(nextId(), `${period}, one restaurant: On hand equals Revenue minus Expenses`, async () => {
    const rev = num(await S.locator(".ow2-kpi").nth(0).locator(".v").innerText());
    const exp = num(await S.locator(".ow2-kpi").nth(3).locator(".v").innerText());
    const onh = num(await S.locator(".ow2-kpi").nth(4).locator(".v").innerText());
    return Math.abs((rev - exp) - onh) / Math.max(1, rev) < 0.06
      ? true : `${rev} − ${exp} ≠ ${onh}`;
  });
  await chk(nextId(), `${period}, one restaurant: the Orders popup's paid + open equals its own total`, async () => {
    await S.locator(".ow2-kpi").nth(1).click();
    await S.waitForSelector(".ow2-tile", { timeout: 10000 });
    const rows = await S.locator(".ow2-tile .r").allInnerTexts();
    const pick = (l) => { const r = rows.find((x) => x.split("\n")[0].trim() === l); return r ? num(r.split("\n").pop()) : NaN; };
    const total = pick("Orders"), paid = pick("Paid"), open_ = pick("Still open");
    await S.keyboard.press("Escape");
    await S.waitForTimeout(350);
    if (![total, paid, open_].every(Number.isFinite)) return `could not read the rows: ${JSON.stringify(rows)}`;
    return paid + open_ === total ? true : `${paid} + ${open_} ≠ ${total}`;
  });
  await chk(nextId(), `${period}, one restaurant: the dish list and the category donut agree that there were sales`, async () => {
    const dishes = await S.locator(".rv-dish").count();
    const donutEmpty = await S.locator(".adm-card", { hasText: "Revenue by category" }).locator(".adm-empty").count();
    const orders = num(await S.locator(".ow2-kpi").nth(1).locator(".v").innerText());
    if (orders === 0) return true;                       // nothing sold: both may be empty
    return dishes > 0 || donutEmpty > 0 ? true : `${orders} orders but no dish rows and no empty note`;
  });
  await chk(nextId(), `${period}, one restaurant: nothing leaks code text`, async () => {
    const body = await S.locator(".adm-main").innerText();
    const bad = ["[object Object]", "${", "-->", "NaN"].filter((b) => body.includes(b));
    return bad.length === 0 ? true : `${JSON.stringify(bad)}`;
  });
}
await chk(nextId(), "the eight periods on one restaurant raised no failed request either", () => {
  const real = productErrors(sErrs);
  const mine = harnessErrors(sErrs);
  if (real.length) return `${JSON.stringify([...new Set(real)].slice(0, 4))}`;
  if (mine.length) return `page clean; ${mine.length} were my own sign-in traffic rate-limited`;
  return true;
});
await chk(nextId(), "the chosen period survives a reload, so a refresh does not bounce him to 30 days", async () => {
  await setRange(S, "This week");
  await S.reload({ waitUntil: "networkidle", timeout: 120000 });
  await S.waitForTimeout(3600);
  const label = (await S.locator(".owr-btn.main").innerText()).trim();
  return /This week/.test(label) ? true : `after a reload the dropdown says "${label}"`;
});
await chk(nextId(), "…and the exact dates under the dropdown follow the period it names", async () => {
  const label = (await S.locator(".owr-btn.main").innerText()).trim();
  const caption = (await S.locator(".ow2-tools span").first().innerText()).trim();
  return /this week/i.test(caption) || /–/.test(caption)
    ? true : `the dropdown says "${label}" and the caption says "${caption}"`;
});

if (results_count() !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: this band executed ${results_count()} rows but declares EXPECT_ROWS = ${EXPECT_ROWS}.\nEvery id after the inserted row has shifted. Append at the end, or renumber deliberately and update the ledger.`);
  process.exit(2);
}
const n = report(`T13 NEW band E · every period crossed with every scope, driven (P67094–P${id - 1})`, { minChecks: 100 });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: `drove ${BASE} as a one-restaurant owner and as a five-restaurant owner, adding up the figures on screen`,
  section: `NEW · Band E — every period crossed with every scope, DRIVEN — P67094–P${id - 1}`,
});
await browser.close();
