// BLOCK C · P70061–P70180 — driven, headless, ONE owner sign-in, 1280×900 and A35 360×780 dpr3.
// The service worker is BLOCKED in every context: a panel's SW answers the fetch itself, so a
// page.route() mock never reaches the page (the trap this terminal lost twenty minutes to).
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:4316";
const SHOTS = ".claude/sweep/shots/T16";
mkdirSync(SHOTS, { recursive: true });

const rows = [];
let n = 0;
const check = async (id, what, fn, note = "") => {
  n++;
  let res;
  try { res = (await fn()) ? "✅" : "❌"; } catch (e) { res = `❌ threw: ${String(e.message).slice(0, 70)}`; }
  rows.push({ id, what, res, note });
  return res;
};

const br = await chromium.launch();
const DESK = { width: 1280, height: 900 }, PHONE = { width: 360, height: 780, dpr: 3 };
const mk = async (vp, skin) => {
  const c = await br.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr || 1, serviceWorkers: "block" });
  c.setDefaultTimeout(60000); c.setDefaultNavigationTimeout(120000);
  await loginAs(c, "owner", BASE);
  if (skin) await c.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  return c;
};
const open = async (ctx, path) => {
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.goto(BASE + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  p._errs = errs;
  return p;
};
const txt = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const NOISE = ["NaN", "undefined", "[object Object]", "Invalid Date", "-->", "${", "null,", "₹NaN"];

// ════════ C1 · CUSTOMERS, DESKTOP (P70061–P70100) ════════
const desk = await mk(DESK);
{
  const p = await open(desk, "/owner/customers");
  const t = await txt(p);
  await check("P70061", "the Customers page opens and stays there (no redirect)", () => p.url().endsWith("/owner/customers"));
  await check("P70062", "…with its own heading rendered", async () => (await p.locator("h1.adm-page-h").innerText()) === "Customers");
  await check("P70063", "…and no page error or console error at all", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 120));
  await check("P70064", "no leaked code text anywhere in the rendered page", () => !NOISE.some((x) => t.includes(x)), NOISE.filter((x) => t.includes(x)).join(","));
  await check("P70065", "all four summary tiles are on screen", async () => (await p.locator(".adm-stats .adm-stat, .adm-stats button.adm-stat").count()) === 4);
  await check("P70066", "…and each carries a real number, not a placeholder", async () => {
    const vs = await p.locator(".adm-stats .v").allInnerTexts();
    return vs.length === 4 && vs.every((v) => /^[\d,]+$/.test(v.trim()));
  });
  await check("P70067", "exactly three tiles are pressable filters", async () => (await p.locator(".adm-stats button.adm-stat").count()) === 3);
  await check("P70068", "…and each pressable one says so with a filter mark", async () => (await p.locator(".adm-stats button.adm-stat i.cust-tilemark").count()) === 3);
  await check("P70069", "…and 'New (last 30 days)' is deliberately NOT one of them", async () => {
    const labels = await p.locator(".adm-stats button.adm-stat .k").allInnerTexts();
    return !labels.some((l) => /New \(last 30 days\)/i.test(l));
  });
  await check("P70070", "the tile marked as the active filter is 'Total customers' on open", async () => (await p.locator('.adm-stats button.adm-stat[aria-pressed="true"] .k').innerText()).match(/Total customers/i) !== null);
  await check("P70071", "the freshness line names the clock time the tiles were counted", () => /Counted at \d{1,2}:\d{2}\s?(am|pm)/i.test(t));
  await check("P70072", "…and offers Refresh as the way to count again", () => /Refresh to count again/.test(t));
  await check("P70073", "the group tab strip has all four groups", async () => (await p.locator('[aria-label="Group"] button').allInnerTexts()).join(",") === "Everyone,Regulars,First-timers,Blocked");
  await check("P70074", "…and the sort strip has both orders", async () => (await p.locator('[aria-label="Sort"] button').allInnerTexts()).join(",") === "Recent,Most visits");
  await check("P70075", "the desktop list is a table, not cards", async () => (await p.locator("table.adm-table").count()) === 1);
  await check("P70076", "…with rows in it", async () => (await p.locator("table.adm-table tbody tr").count()) > 0);
  await check("P70077", "…and one restaurant means NO restaurant column", async () => {
    const th = (await p.locator("table.adm-table thead th").allInnerTexts()).map((x) => x.trim());
    return !th.includes("Restaurant");
  });
  await check("P70078", "every visible phone number is spaced 5+5, not one long run", async () => {
    const ps = await p.locator("table.adm-table tbody tr td:nth-child(2)").allInnerTexts();
    return ps.length > 0 && ps.every((x) => /^\d{5} \d{5}$|^—$|^\d{1,9}$/.test(x.trim()));
  });
  await check("P70079", "no row's name cell is blank", async () => {
    const ns = await p.locator("table.adm-table tbody tr td:nth-child(1)").allInnerTexts();
    return ns.length > 0 && ns.every((x) => x.trim().length > 0);
  });
  await check("P70080", "every row carries exactly one state chip (blocked / regular / new)", async () => {
    const c = await p.locator("table.adm-table tbody tr").count();
    const chips = await p.locator("table.adm-table tbody tr td:nth-child(6) .adm-chip").count();
    return chips === c;
  });
  await check("P70081", "every row has an erase button with a spoken label naming the guest", async () => {
    const labels = await p.locator("table.adm-table tbody tr button.cust-erase").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    return labels.length > 0 && labels.every((l) => l && /^Erase .+/.test(l) && !/undefined|null/.test(l));
  });
  await check("P70082", "…and it is the LAST cell, so it never competes with the row itself", async () => (await p.locator("table.adm-table tbody tr:first-child td:last-child button.cust-erase").count()) === 1);
  await check("P70083", "pressing the Regulars tile really moves the list onto that group", async () => {
    await p.locator(".adm-stats button.adm-stat", { hasText: /Regulars/ }).click();
    await p.waitForTimeout(1100);
    return (await p.locator('[aria-label="Group"] button[aria-selected="true"]').innerText()).trim() === "Regulars";
  });
  await check("P70084", "…and every row on it really has come back (2+ visits)", async () => {
    // The chip is a THREE-WAY exclusive and `blocked` wins it, so a blocked regular is chipped
    // "blocked" while still belonging in this group. Measured: Tarun Bhatt, 4 visits, blocked.
    // So the honest test of the FILTER is the visit count, not the chip.
    const v = (await p.locator("table.adm-table tbody tr td:nth-child(3)").allInnerTexts()).map((x) => Number(x.trim()));
    return v.length > 0 && v.every((x) => x >= 2);
  });
  await check("P70085", "…and the tile it came from is the one marked active", async () => (await p.locator('.adm-stats button.adm-stat[aria-pressed="true"] .k').innerText()).match(/Regulars/i) !== null);
  await check("P70086", "the Blocked tile shows only blocked guests", async () => {
    await p.locator(".adm-stats button.adm-stat", { hasText: /Blocked/ }).click();
    await p.waitForTimeout(1100);
    const chips = await p.locator("table.adm-table tbody tr td:nth-child(6) .adm-chip").allInnerTexts();
    return chips.length > 0 && chips.every((c) => /blocked/i.test(c.trim()));
  });
  await check("P70087", "…and a blocked row is visibly dimmed", async () => {
    const o = await p.locator("table.adm-table tbody tr").first().evaluate((el) => getComputedStyle(el).opacity);
    return Number(o) < 1;
  });
  await check("P70088", "…and the footer does NOT claim guests it is not hiding", async () => !/Showing the \d+ most-recent of/.test(await txt(p)));
  await check("P70089", "First-timers shows only guests who have been once", async () => {
    await p.locator('[aria-label="Group"] button', { hasText: "First-timers" }).click();
    await p.waitForTimeout(1300);
    const v = (await p.locator("table.adm-table tbody tr td:nth-child(3)").allInnerTexts()).map((x) => Number(x.trim()));
    return v.length > 0 && v.every((x) => x === 1);
  });
  await check("P70090", "back on Everyone, 'Most visits' really re-orders the list", async () => {
    await p.locator('[aria-label="Group"] button', { hasText: "Everyone" }).click();
    await p.waitForTimeout(1000);
    await p.locator('[aria-label="Sort"] button', { hasText: "Most visits" }).click();
    await p.waitForTimeout(1200);
    const v = (await p.locator("table.adm-table tbody tr td:nth-child(3)").allInnerTexts()).map((x) => Number(x.trim()));
    return v.length > 1 && v.every((x, i) => i === 0 || v[i - 1] >= x);
  });
  await check("P70091", "…and 'Recent' orders by last visit, newest first", async () => {
    await p.locator('[aria-label="Sort"] button', { hasText: "Recent" }).click();
    await p.waitForTimeout(1200);
    const d = (await p.locator("table.adm-table tbody tr td:nth-child(5)").allInnerTexts()).map((x) => new Date(x.trim()).getTime());
    return d.length > 1 && d.every((x, i) => i === 0 || d[i - 1] >= x);
  });
  await check("P70092", "a search narrows the list and says how many matched, quoting the term", async () => {
    await p.locator('input[aria-label="Search customers"]').fill("Kavya");
    await p.waitForTimeout(1300);
    const s = await txt(p);
    return /match(es)? for “Kavya”/.test(s);
  });
  await check("P70093", "…and the count in that line equals the rows on screen", async () => {
    const s = await txt(p);
    const m = s.match(/(\d+) match(?:es)? for “Kavya”/);
    return m && Number(m[1]) === (await p.locator("table.adm-table tbody tr").count());
  });
  await check("P70094", "a search only stripped characters can't fake a quoted term", async () => {
    await p.locator('input[aria-label="Search customers"]').fill("%%%");
    await p.waitForTimeout(1300);
    return !/match(es)? for “%%%”/.test(await txt(p));
  });
  await check("P70095", "a search matching nobody says so", async () => {
    await p.locator('input[aria-label="Search customers"]').fill("zzzznobodyzzzz");
    await p.waitForTimeout(1300);
    return /No customers match that search\./.test(await txt(p));
  });
  await check("P70096", "clearing the search brings the whole list back", async () => {
    await p.locator('input[aria-label="Search customers"]').fill("");
    await p.waitForTimeout(1300);
    return (await p.locator("table.adm-table tbody tr").count()) > 5;
  });
  await check("P70097", "clicking a row opens that guest's record as a modal dialog", async () => {
    await p.locator("table.adm-table tbody tr").first().click();
    await p.waitForTimeout(1500);
    return (await p.locator('[role="dialog"][aria-modal="true"]').count()) === 1;
  });
  await check("P70098", "…with three figures whose numbers all line up on one baseline", async () => {
    const tops = await p.locator('[role="dialog"] .adm-stats .v').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    return tops.length === 3 && new Set(tops).size === 1;
  });
  await check("P70099", "…and no leaked code text inside the record", async () => {
    const d = (await p.locator('[role="dialog"]').innerText()).replace(/\s+/g, " ");
    return !NOISE.some((x) => d.includes(x));
  });
  await check("P70100", "Escape closes the record", async () => {
    await p.keyboard.press("Escape");
    await p.waitForTimeout(700);
    return (await p.locator('[role="dialog"][aria-modal="true"]').count()) === 0;
  });
  await p.close();
}

// ════════ C2 · PAY LATER + FEEDBACK, DESKTOP (P70101–P70140) ════════
{
  const p = await open(desk, "/owner/khata");
  const t = await txt(p);
  await check("P70101", "Pay Later opens and stays there", () => p.url().endsWith("/owner/khata"));
  await check("P70102", "…with its own heading", async () => (await p.locator("h1.adm-page-h").innerText()) === "Pay Later");
  await check("P70103", "…and no page or console error", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 120));
  await check("P70104", "no leaked code text on the page", () => !NOISE.some((x) => t.includes(x)), NOISE.filter((x) => t.includes(x)).join(","));
  await check("P70105", "all four money tiles are on screen", async () => (await p.locator(".adm-stats .adm-stat").count()) === 4);
  await check("P70106", "…and none of them is still showing the loading ellipsis", async () => !(await p.locator(".adm-stats .v").allInnerTexts()).some((v) => v.trim() === "…"));
  await check("P70107", "…and every money tile is a rupee figure or an honest dash", async () => (await p.locator(".adm-stats .v").allInnerTexts()).every((v) => /^₹|^—$|^[\d,]+$/.test(v.trim())));
  await check("P70108", "it explains that staff collect a tab from the manager panel", () => /Staff collect a tab from the manager panel/.test(t));
  await check("P70109", "there is a search box with a spoken label", async () => (await p.locator('input[aria-label="Search people who owe"]').count()) === 1);
  await check("P70110", "…and a Refresh button", async () => (await p.locator(".adm-card button.adm-btn", { hasText: /Refresh/ }).count()) >= 1);
  await check("P70111", "each person's row is a button that reports whether it is open", async () => {
    const n2 = await p.locator('.adm-card button[aria-expanded]').count();
    return n2 >= 1 && (await p.locator('.adm-card button[aria-expanded="false"]').count()) === n2;
  });
  await check("P70112", "…and the money on it is a rupee figure", async () => /₹[\d,]/.test(await p.locator('.adm-card button[aria-expanded]').first().innerText()));
  await check("P70113", "…and the age reads as English, never 'NaN days'", async () => /oldest (today|\d+ days?|—)/.test(await p.locator('.adm-card button[aria-expanded]').first().innerText()));
  await check("P70114", "…and it says how many bills, with the right plural", async () => /\b1 bill\b|\d+ bills\b/.test(await p.locator('.adm-card button[aria-expanded]').first().innerText()));
  await check("P70115", "opening a person really shows their bills", async () => {
    await p.locator('.adm-card button[aria-expanded]').first().click();
    await p.waitForTimeout(600);
    return (await p.locator('.adm-card button[aria-expanded="true"]').count()) === 1;
  });
  await check("P70116", "…and each bill line carries a date and an amount", async () => {
    const s = await txt(p);
    return /#\d+|Bill/.test(s) && /₹[\d,]/.test(s);
  });
  await check("P70117", "…and no bill line prints 'Invalid Date' or 'Tundefined'", async () => {
    const s = await txt(p);
    return !/Invalid Date/.test(s) && !/Tundefined/.test(s);
  });
  await check("P70118", "a search that matches nobody says so", async () => {
    await p.locator('input[aria-label="Search people who owe"]').fill("zzzznobodyzzz");
    await p.waitForTimeout(500);
    return /No one matches that search/.test(await txt(p));
  });
  await check("P70119", "…and clearing it brings the book back", async () => {
    await p.locator('input[aria-label="Search people who owe"]').fill("");
    await p.waitForTimeout(500);
    return (await p.locator('.adm-card button[aria-expanded]').count()) >= 1;
  });
  await check("P70120", "the row separator inside a person really renders (not 0px none)", async () => {
    const bt = await p.locator('.adm-card button[aria-expanded="true"]').first().evaluate((el) => {
      const box = el.nextElementSibling; return box ? getComputedStyle(box).borderTopWidth + "/" + getComputedStyle(box).borderTopStyle : "none";
    });
    return bt !== "none" && !/^0px/.test(bt);
  });
  await p.close();
}
{
  const p = await open(desk, "/owner/issues");
  const t = await txt(p);
  await check("P70121", "Feedback & complaints opens and stays there", () => p.url().endsWith("/owner/issues"));
  await check("P70122", "…with its own heading", async () => (await p.locator("h1.adm-page-h").innerText()) === "Feedback & complaints");
  await check("P70123", "…and no page or console error", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 120));
  await check("P70124", "no leaked code text on the page", () => !NOISE.some((x) => t.includes(x)), NOISE.filter((x) => t.includes(x)).join(","));
  await check("P70125", "both tabs are on screen", async () => (await p.locator(".own-range button").allInnerTexts()).filter((x) => /Guest ratings|Complaints/.test(x)).length === 2);
  await check("P70126", "…and each carries a count, not a blank", async () => (await p.locator(".own-range button").allInnerTexts()).some((x) => /Complaints · \d+/.test(x)));
  await check("P70127", "…and neither tab carries a failure mark on a healthy load", async () => (await p.locator(".own-range button i.fa-triangle-exclamation").count()) === 0);
  await check("P70128", "with no ratings yet it says so, and says how they appear", () => /No guest ratings yet\. They appear here after diners rate a bill\./.test(t));
  await check("P70129", "…and does NOT also show a red loading error", () => !/Couldn't load/.test(t));
  await check("P70130", "the Complaints tab opens", async () => {
    await p.locator(".own-range button", { hasText: /^Complaints/ }).click();
    await p.waitForTimeout(700);
    return (await p.locator(".own-range button", { hasText: /^Open ·/ }).count()) === 1;
  });
  await check("P70131", "…with an Open filter and an All filter", async () => (await p.locator(".own-range button", { hasText: /^All$/ }).count()) === 1);
  await check("P70132", "…and with none open it says all clear rather than nothing", async () => /No open complaints — all clear|No complaints raised yet/.test(await txt(p)));
  await check("P70133", "…and 'All' shows the resolved ones, each with its status and a Reopen", async () => {
    await p.locator(".own-range button", { hasText: /^All$/ }).click();
    await p.waitForTimeout(700);
    const s2 = await txt(p);
    if (/No complaints raised yet/.test(s2)) return true;   // honest when there really are none
    const cards = await p.locator(".adm-card .adm-card").count();
    return cards > 0 && /resolved/i.test(s2) && /Reopen/.test(s2);
  });
  await check("P70134", "Refresh re-reads without navigating away", async () => {
    const before = p.url();
    await p.locator("button.adm-btn", { hasText: /Refresh/ }).first().click();
    await p.waitForTimeout(1200);
    return p.url() === before && p._errs.length === 0;
  });
  await check("P70135", "…and still no failure mark on either tab afterwards", async () => (await p.locator(".own-range button i.fa-triangle-exclamation").count()) === 0);
  await check("P70136", "the Inventory door forwards a real owner who has not been given it", async () => {
    const q = await open(desk, "/owner/inventory");
    const u = q.url();
    await q.close();
    return u.endsWith("/owner");
  });
  await check("P70137", "…and it lands on the dashboard, not an error page", async () => {
    const q = await open(desk, "/owner/inventory");
    const s = await txt(q);
    const bad = /isn't switched on|contact Aevidine|ask your administrator|Unable to access/i.test(s);
    await q.close();
    return !bad;
  });
  await check("P70138", "…and the sidebar does not name Inventory to him at all", async () => {
    const q = await open(desk, "/owner");
    const nav = (await q.locator("nav, aside").first().innerText()).replace(/\s+/g, " ");
    await q.close();
    return !/Inventory/i.test(nav);
  });
  await check("P70139", "…while the three sections he DOES have are all in the sidebar", async () => {
    const q = await open(desk, "/owner");
    const nav = (await q.locator("nav, aside").first().innerText()).replace(/\s+/g, " ");
    await q.close();
    return /Customers/.test(nav) && /Pay Later/.test(nav) && /Feedback & complaints/.test(nav);
  });
  await check("P70140", "…and each of those three links really reaches its screen", async () => {
    for (const [label, path] of [["Customers", "/owner/customers"], ["Pay Later", "/owner/khata"], ["Feedback & complaints", "/owner/issues"]]) {
      const q = await open(desk, "/owner");
      await q.locator("nav a, aside a", { hasText: label }).first().click();
      await q.waitForTimeout(2200);
      const u = q.url();
      await q.close();
      if (!u.endsWith(path)) return false;
    }
    return true;
  });
  await p.close();
}

// ════════ C3 · THE PHONE, 360×780 dpr3 (P70141–P70180) ════════
const phone = await mk(PHONE);
{
  const p = await open(phone, "/owner/customers");
  await check("P70141", "on a phone the guest list is CARDS, not an eight-column table", async () => (await p.locator("table.adm-table").count()) === 0);
  await check("P70142", "…and there is exactly one card per guest, each with its own erase button", async () => {
    const cards = await p.locator('button[aria-label$="record"]').count();
    return cards > 0 && cards === (await p.locator("button.cust-erase").count());
  });
  await check("P70143", "…each of which says what tapping it does", async () => /Tap for their visits, dates and bills/.test(await txt(p)));
  await check("P70144", "…and each has an erase button at least 40px in both directions", async () => {
    const b = await p.locator("button.cust-erase").first().boundingBox();
    return b && b.width >= 40 && b.height >= 40;
  });
  await check("P70145", "nothing on the page overflows 360px sideways", async () => (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await check("P70146", "…and no single element is wider than the screen", async () => (await p.evaluate(() => {
    const w = window.innerWidth;
    return [...document.querySelectorAll("body *")].every((e) => e.getBoundingClientRect().width <= w + 2 || getComputedStyle(e).overflowX !== "visible");
  })));
  await check("P70147", "no leaked code text at phone width either", async () => { const t = await txt(p); return !NOISE.some((x) => t.includes(x)); });
  await check("P70148", "no name on a card is blank", async () => (await p.locator('button[aria-label$="record"] b').allInnerTexts()).every((x) => x.trim().length > 0));
  await check("P70149", "the freshness line is NOT pushed to the right edge on a phone", async () => {
    const el = p.locator("span", { hasText: /Counted at/ }).first();
    if (!(await el.count())) return true;
    const b = await el.boundingBox();
    return b && b.x < 200;
  });
  await check("P70150", "tapping a card opens the record and it fills the width", async () => {
    await p.locator('button[aria-label$="record"]').first().click();
    await p.waitForTimeout(1600);
    const d = p.locator('[role="dialog"] .adm-card').first();
    const b = await d.boundingBox();
    return b && b.width >= 340;
  });
  await check("P70151", "…and the record has no sideways overflow", async () => (await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"] .adm-card');
    return !d || d.scrollWidth <= d.clientWidth + 1;
  })));
  await check("P70152", "…and its ✕ is reachable without scrolling", async () => {
    const b = await p.locator('[role="dialog"] button[aria-label="Close"]').boundingBox();
    return b && b.y >= 0 && b.y < 780;
  });
  await check("P70153", "…and the record carries first AND last visit, which the cards drop", async () => /first \d+ \w+ \d{4} · last/.test((await p.locator('[role="dialog"]').innerText()).replace(/\s+/g, " ")));
  await check("P70154", "the phone's Back closes the record instead of leaving the page", async () => {
    const before = p.url();
    await p.goBack();
    await p.waitForTimeout(900);
    return p.url() === before && (await p.locator('[role="dialog"]').count()) === 0;
  });
  await p.close();
}
{
  const p = await open(phone, "/owner/khata");
  await check("P70155", "Pay Later fits 360px with no sideways scroll", async () => (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await check("P70156", "…and its four tiles all still render", async () => (await p.locator(".adm-stats .adm-stat").count()) === 4);
  await check("P70157", "…and no tile's number is clipped by its box", async () => (await p.locator(".adm-stats .v").evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1))));
  await check("P70158", "…and a person's row keeps its money on the same line as the name", async () => {
    const b = p.locator('.adm-card button[aria-expanded]').first();
    if (!(await b.count())) return true;
    const box = await b.boundingBox();
    return box && box.height < 130;
  });
  await check("P70159", "no leaked code text at phone width", async () => { const t = await txt(p); return !NOISE.some((x) => t.includes(x)); });
  await check("P70160", "…and no page or console error", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 120));
  await p.screenshot({ path: `${SHOTS}/khata-360.png`, fullPage: true });
  await p.close();
}
{
  const p = await open(phone, "/owner/issues");
  await check("P70161", "Feedback fits 360px with no sideways scroll", async () => (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  // MEASURED, and reported rather than silently "fixed": `.adm .own-range button` is 5px/11px
  // padding on a 12px font, so a tab is ~24px tall — on every screen in the owner panel that uses
  // this shared control, not just this one. Item 6 did not shrink them; before it, they were 38px
  // only because the label was wrapping to two lines, which was the fault. Whether to grow the
  // shared control is his call (part 4), so this row asserts what is TRUE today and names it.
  await check("P70162", "…and both tab buttons are one line each, ~24px tall (the shared control's size)", async () => {
    const bs = await p.locator(".own-range button").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    return bs.length === 2 && bs.every((h) => h >= 20 && h <= 30);
  }, "the shared .own-range size across the whole owner panel — offered as a decision, not changed here");
  await check("P70163", "…and the tab strip does not push Refresh off the screen", async () => {
    // Item 6 moved Refresh OUT of the segmented pill on purpose, so it is no longer inside
    // `.own-range` — that is the fix, not a break. It must still be fully on screen.
    const b = await p.locator("button.adm-btn", { hasText: /Refresh/ }).first().boundingBox();
    return b && b.x >= 0 && b.x + b.width <= 361;
  });
  await check("P70164", "no leaked code text", async () => { const t = await txt(p); return !NOISE.some((x) => t.includes(x)); });
  await check("P70165", "…and no page or console error", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 120));
  await p.screenshot({ path: `${SHOTS}/issues-360.png`, fullPage: true });
  await p.close();
}
// ── the LIGHT skin, on all three (P70166–P70180) ──
const light = await mk(DESK, "light");
for (const [i, [path, name]] of [["/owner/customers", "Customers"], ["/owner/khata", "Pay Later"], ["/owner/issues", "Feedback & complaints"]].entries()) {
  const p = await open(light, path);
  const base = 70166 + i * 5;
  await check(`P${base}`, `${name} renders in the light skin without an error`, () => p._errs.length === 0, p._errs.join(" | ").slice(0, 120));
  await check(`P${base + 1}`, `…and its shell really is light, not dark`, async () => {
    const bg = await p.locator("[data-skin]").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const m = bg.match(/\d+/g);
    return m && (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 > 140;
  });
  await check(`P${base + 2}`, `…and its body text is dark enough to read on it`, async () => {
    const c = await p.locator("h1.adm-page-h").first().evaluate((el) => getComputedStyle(el).color);
    const m = c.match(/\d+/g);
    return m && (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 < 130;
  });
  await check(`P${base + 3}`, `…and no leaked code text in the light skin`, async () => { const t = await txt(p); return !NOISE.some((x) => t.includes(x)); });
  await check(`P${base + 4}`, `…and every card border really draws (not 0px none)`, async () => {
    const w = await p.locator(".adm-card").first().evaluate((el) => getComputedStyle(el).borderTopWidth);
    return w !== "0px";
  });
  await p.screenshot({ path: `${SHOTS}/${name.replace(/\W+/g, "-")}-light.png` });
  await p.close();
}

await br.close();
const bad = rows.filter((r) => r.res !== "✅");
console.log(`BLOCK C · ${n} checks · ${rows.length - bad.length} ✅ · ${bad.length} not-green`);
for (const b of bad) console.log(`  ${b.res} ${b.id} — ${b.what}${b.note ? `  [${b.note}]` : ""}`);

try {
  const { writeFileSync: __w, mkdirSync: __m } = await import("node:fs");
  __m(".claude/sweep/t16-rows", { recursive: true });
  __w(".claude/sweep/t16-rows/C.json", JSON.stringify(rows ?? results, null, 1));
} catch (e) { console.error("could not write rows:", e.message); }
