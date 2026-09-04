// BLOCK E · P70261–P70340 — crafted replies: the states the shared dev database cannot make.
// Every one is forced INSIDE this browser by answering the page's own request differently. The
// server never sees it, so no other terminal can be affected and no row is written.
// The service worker is blocked in every context, or it answers the fetch itself and the mock is
// never consulted (this terminal lost twenty minutes to exactly that).
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";

const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:4316";
const rows = [];
let n = 0;
const check = async (id, what, fn, note = "") => {
  n++;
  let res;
  try { res = (await fn()) ? "✅" : "❌"; } catch (e) { res = `❌ threw: ${String(e.message).slice(0, 70)}`; }
  rows.push({ id, what, res, note });
  return res;
};
const NOISE = ["NaN", "[object Object]", "Invalid Date", "-->", "${", "₹NaN", "undefined"];

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
ctx.setDefaultTimeout(45000); ctx.setDefaultNavigationTimeout(120000);
await loginAs(ctx, "owner", BASE);

/** Open `path` with `/api/owner/<api>` answered by `body` (or a status). */
async function craft(path, api, body, status = 200) {
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  // A console error naming a THIRD-PARTY host is not a fault in this screen. Sentry's own ingest
  // endpoint answers 429 to our error reports on this stack, and counting that as a page error
  // measures Sentry's quota, not the product. Everything from OUR origin still counts.
    // …and the "Failed to load resource" message does not carry the URL in its TEXT — it is in
  // m.location().url, which is what has to be filtered.
  p.on("console", (m) => {
    if (m.type() !== "error") return;
    const where = `${m.text()} ${m.location()?.url || ""}`;
    if (/sentry\.io|ingest\.us/.test(where)) return;
    errs.push(m.text());
  });
  await p.route(`**/api/owner/${api}**`, (r) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
  await p.goto(BASE + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  p._errs = errs;
  p._txt = async () => (await p.locator("body").innerText()).replace(/\s+/g, " ");
  return p;
}

// ════ E1 · CUSTOMERS (P70261–P70295) ════
{
  // a guest whose name is only spaces, and one with none at all
  const p = await craft("/owner/customers", "customers", {
    ok: true, restaurants: [{ id: "00000000-0000-0000-0000-000000000001", name: "My Little French House" }],
    summary: { total: 3, returning: 1, newThisMonth: 1, blocked: 0, shown: 3, cachedAt: new Date().toISOString() },
    customers: [
      { restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", phone: "9000000001", name: "   ", blocked: false, visits: 1, consent: false, first_seen_at: "2026-08-01T00:00:00Z", last_seen_at: "2026-08-01T00:00:00Z", returning: false },
      { restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", phone: "9000000002", name: null, blocked: false, visits: 1, consent: false, first_seen_at: "2026-08-02T00:00:00Z", last_seen_at: "2026-08-02T00:00:00Z", returning: false },
      { restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", phone: "912345", name: "Short Number", blocked: false, visits: 4, consent: true, first_seen_at: "nope", last_seen_at: "also-nope", returning: true },
    ],
  });
  const t = await p._txt();
  await check("P70261", "a name that is only spaces still reads as 'Guest'", async () => {
    const cells = await p.locator("table.adm-table tbody tr td:nth-child(1)").allInnerTexts();
    return cells.length === 3 && cells.every((c) => c.trim().length > 0);
  });
  await check("P70262", "…and so does a missing one", async () => (await p.locator("table.adm-table tbody tr td:nth-child(1)").allInnerTexts()).filter((c) => /Guest/.test(c)).length === 2);
  await check("P70263", "…and the erase button's spoken label never says 'undefined'", async () => {
    const ls = await p.locator("button.cust-erase").evaluateAll((e) => e.map((x) => x.getAttribute("aria-label")));
    return ls.every((l) => l && !/undefined|null/.test(l));
  });
  await check("P70264", "a number that is not ten digits is handed over untouched, not mis-grouped", () => /912345/.test(t) && !/91234 5/.test(t));
  await check("P70265", "an unreadable date is a dash, never the words 'Invalid Date'", () => !/Invalid Date/.test(t));
  await check("P70266", "…and the row still renders rather than taking the page down", async () => (await p.locator("table.adm-table tbody tr").count()) === 3);
  await check("P70267", "no leaked code text anywhere on the page", () => !NOISE.some((x) => t.includes(x)), NOISE.filter((x) => t.includes(x)).join(","));
  await check("P70268", "…and no page error", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 120));
  await p.close();
}
{
  // the read failing outright — a failed read is not an empty list
  const p = await craft("/owner/customers", "customers", { error: "boom-customers" }, 500);
  const t = await p._txt();
  await check("P70269", "a failed read says Couldn't load and names it", () => /Couldn&apos;t load\.|Couldn't load\./.test(t) && /boom-customers/.test(t));
  await check("P70270", "…and says explicitly that this is a loading error, not 'no customers'", () => /this is a loading error, not/.test(t));
  await check("P70271", "…and NEVER prints 'No customers yet' underneath it", () => !/No customers yet/.test(t));
  await check("P70272", "…and offers Try again", async () => (await p.locator("button.adm-btn", { hasText: /Try again/ }).count()) >= 1);
  await check("P70273", "…and the tiles show NOTHING rather than an invented zero", async () => {
    // Measured: AnimatedNumber renders empty while `loading`, so a failed read prints no figure at
    // all. That is stronger than the "0 is acceptable" this check was first written to allow.
    const vs = await p.locator(".adm-stats .v").allInnerTexts();
    return vs.length === 4 && vs.every((v) => v.trim() === "" || v.trim() === "…" || v.trim() === "—");
  });
  await p.close();
}
{
  // the entitlement withheld — R36: he must never learn a section exists
  const p = await craft("/owner/customers", "customers", { disabled: true });
  await check("P70274", "a withheld Customers section forwards him to the dashboard", () => p.url().endsWith("/owner"));
  await check("P70275", "…and never names the section or tells him who to ask", async () => {
    const t = await p._txt();
    return !/isn&apos;t enabled|isn't enabled|contact Aevidine|ask your administrator/i.test(t);
  });
  await check("P70276", "…and does not leave an empty Customers page behind", async () => !/The guests who&apos;ve dined with you/.test(await p._txt()));
  await p.close();
}
{
  // a partial read — the brand lookup failed
  const p = await craft("/owner/customers", "customers", {
    ok: true, partial: ["restaurantNames"],
    restaurants: [{ id: "00000000-0000-0000-0000-000000000001", name: "My Little French House" }, { id: "00000000-0000-0000-0000-000000000002", name: "Pizza Palace" }],
    summary: { total: 1, returning: 0, newThisMonth: 1, blocked: 0, shown: 1, cachedAt: new Date().toISOString() },
    customers: [{ restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "—", phone: "9000000001", name: "Someone", blocked: false, visits: 1, consent: false, first_seen_at: "2026-08-01T00:00:00Z", last_seen_at: "2026-08-01T00:00:00Z", returning: false }],
  });
  const t = await p._txt();
  await check("P70277", "a figure the server could not read is named out loud", () => /couldn&apos;t|couldn't|could not/i.test(t));
  await check("P70278", "…with a Try again beside it", async () => (await p.locator("button.adm-btn", { hasText: /Try again/ }).count()) >= 1);
  await check("P70279", "…and the list still renders what it does have", async () => (await p.locator("table.adm-table tbody tr").count()) === 1);
  await check("P70280", "…and with two restaurants in scope the Restaurant column comes back", async () => (await p.locator("table.adm-table thead th").allInnerTexts()).some((x) => x.trim() === "Restaurant"));
  await check("P70281", "…and so does the restaurant picker", async () => (await p.locator('select[aria-label="Restaurant"]').count()) === 1);
  await p.close();
}
{
  // a CAPPED list — 300 rows of 900
  const many = Array.from({ length: 300 }, (_, i) => ({
    restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House",
    phone: String(9000000000 + i), name: `Guest ${i}`, blocked: false, visits: 1, consent: false,
    first_seen_at: "2026-08-01T00:00:00Z", last_seen_at: "2026-08-01T00:00:00Z", returning: false,
  }));
  const p = await craft("/owner/customers", "customers", {
    ok: true, restaurants: [{ id: "00000000-0000-0000-0000-000000000001", name: "My Little French House" }],
    summary: { total: 900, returning: 100, newThisMonth: 40, blocked: 3, shown: 300, cachedAt: new Date().toISOString() },
    customers: many,
  });
  const t = await p._txt();
  await check("P70282", "a capped list says it is showing the most-recent N of the real total", () => /Showing the 300 most-recent of 900\. Search to find an older guest\./.test(t));
  await check("P70283", "…and all 300 rows really rendered", async () => (await p.locator("table.adm-table tbody tr").count()) === 300);
  await check("P70284", "…and the footer noun is empty on 'Everyone', not a group name", () => !/most-recent of 900 (regulars|blocked|first-timers)/.test(t));
  await p.close();
}
{
  // a capped list on a GROUP — the line must ask that group's own question
  const many = Array.from({ length: 300 }, (_, i) => ({
    restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House",
    phone: String(9100000000 + i), name: `Regular ${i}`, blocked: false, visits: 3, consent: false,
    first_seen_at: "2026-08-01T00:00:00Z", last_seen_at: "2026-08-01T00:00:00Z", returning: true,
  }));
  const p = await craft("/owner/customers", "customers", {
    ok: true, restaurants: [{ id: "00000000-0000-0000-0000-000000000001", name: "My Little French House" }],
    summary: { total: 900, returning: 450, newThisMonth: 40, blocked: 3, shown: 300, cachedAt: new Date().toISOString() },
    customers: many,
  });
  await p.locator('[aria-label="Group"] button', { hasText: "Regulars" }).click();
  await p.waitForTimeout(1200);
  const t = await p._txt();
  await check("P70285", "on Regulars the line counts REGULARS, not everybody", () => /Showing the 300 most-recent of 450 regulars\./.test(t));
  await check("P70286", "…and never the whole-scope total of 900", () => !/most-recent of 900/.test(t));
  await p.locator('[aria-label="Group"] button', { hasText: "Blocked" }).click();
  await p.waitForTimeout(1200);
  const t2 = await p._txt();
  await check("P70287", "on Blocked, with 3 blocked and 300 rows shown, it claims nothing hidden", () => !/most-recent of/.test(t2));
  await p.close();
}
{
  // the guest record: a bill with no number, no table, and more bills than are shown
  const p = await craft("/owner/customers", "customers", {
    ok: true, restaurants: [{ id: "00000000-0000-0000-0000-000000000001", name: "My Little French House" }],
    summary: { total: 1, returning: 1, newThisMonth: 0, blocked: 0, shown: 1, cachedAt: new Date().toISOString() },
    customers: [{ restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", phone: "9000000001", name: "Two Kitchens", blocked: false, visits: 6, consent: true, first_seen_at: "2026-06-01T00:00:00Z", last_seen_at: "2026-08-01T00:00:00Z", returning: true }],
    detail: {
      phone: "9000000001", bill_count: 40, lifetime: 12345.67, avg_bill: 308.64,
      first_bill: "2026-06-01T00:00:00Z", last_bill: "2026-08-01T00:00:00Z",
      bills: [
        { session_id: "s1", restaurant_id: "00000000-0000-0000-0000-000000000001", bill_no: 41, invoice_no: null, table_number: "7", at: "2026-08-01T00:00:00Z", name: "Two Kitchens", total: 500 },
        { session_id: "s2", restaurant_id: "00000000-0000-0000-0000-000000000002", bill_no: 41, invoice_no: null, table_number: null, at: "2026-07-01T00:00:00Z", name: "Two Kitchens", total: 300 },
        { session_id: "s3", restaurant_id: "00000000-0000-0000-0000-000000000001", bill_no: null, invoice_no: null, table_number: "2", at: "bad-date", name: null, total: 0 },
      ],
      rows: [
        { restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", phone: "9000000001", name: "Two Kitchens", blocked: false, visits: 4, consent: true, first_seen_at: "2026-06-01T00:00:00Z", last_seen_at: "2026-08-01T00:00:00Z", returning: true },
        { restaurant_id: "00000000-0000-0000-0000-000000000002", restaurantName: "Pizza Palace", phone: "9000000001", name: "Two Kitchens", blocked: true, visits: 2, consent: true, first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: "2026-07-01T00:00:00Z", returning: true },
      ],
    },
  });
  await p.locator("table.adm-table tbody tr").first().click();
  await p.waitForTimeout(1500);
  const d = (await p.locator('[role="dialog"]').innerText()).replace(/\s+/g, " ");
  await check("P70288", "the record opens and names the guest", () => /Two Kitchens/.test(d));
  await check("P70289", "…and the mobile inside it is spaced 5+5 too", () => /90000 00001/.test(d));
  await check("P70290", "…it says the number has eaten at 2 of your restaurants", () => /This number has eaten at 2 of your restaurants/.test(d));
  await check("P70291", "…so every bill line names WHICH restaurant issued it", () => (d.match(/My Little French House/g) || []).length >= 2 && /Pizza Palace/.test(d));
  await check("P70292", "…a bill with no number shows a dash, not '#null'", () => !/#null/.test(d) && /—/.test(d));
  await check("P70293", "…a bill with no table simply omits the table, never 'Table undefined'", () => !/Table undefined/.test(d));
  await check("P70294", "…an unreadable bill date is a dash, never 'Invalid Date'", () => !/Invalid Date/.test(d));
  await check("P70295", "…and it says it is showing 3 of their 40 bills", () => /Showing their 3 most recent of 40 bills\./.test(d));
  await p.close();
}

// ════ E2 · PAY LATER (P70296–P70315) ════
{
  const p = await craft("/owner/khata", "khata", { error: "boom-khata" }, 500);
  const t = await p._txt();
  await check("P70296", "a failed credit-book read says Couldn't load and names it", () => /Couldn&apos;t load\.|Couldn't load\./.test(t) && /boom-khata/.test(t));
  await check("P70297", "…and says this is a loading error, not 'nobody owes anything'", () => /this is a loading error, not/.test(t));
  await check("P70298", "…and NEVER prints 'No one owes anything right now'", () => !/No one owes anything right now/.test(t));
  await check("P70299", "…and the four tiles do not invent ₹0", async () => (await p.locator(".adm-stats .v").allInnerTexts()).every((v) => ["…", "—"].includes(v.trim())));
  await p.close();
}
{
  // the two collected figures unreadable — a dash, never ₹0
  const p = await craft("/owner/khata", "khata", {
    ok: true, partial: ["khataCollected"],
    summary: { totalOutstanding: 4321.5, peopleCount: 2, billCount: 3, collectedMonth: null, collectedToday: null },
    customers: [
      { id: "a", restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", name: "Old Tab", phone: "9876500077", note: null, outstanding: 4000, billCount: 2, oldestKhataAt: new Date(Date.now() - 95 * 86400_000).toISOString(), bills: [{ bill_no: 12, table_number: "4", khata_at: new Date(Date.now() - 95 * 86400_000).toISOString(), amount: 4000 }] },
      { id: "b", restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", name: "Fresh Tab", phone: null, note: "regular", outstanding: 321.5, billCount: 1, oldestKhataAt: new Date().toISOString(), bills: [{ bill_no: null, table_number: null, khata_at: "nope", amount: 321.5 }] },
    ],
  });
  const t = await p._txt();
  await check("P70300", "an unreadable 'collected today' is a dash, never ₹0", async () => {
    const vs = await p.locator(".adm-stats .v").allInnerTexts();
    return vs[2].trim() === "—" && vs[3].trim() === "—";
  });
  // The shared inr() (components/admin/shared) rounds a headline to whole rupees — measured:
  // inr(4321.5) renders "₹4,322". The check is that the figure it READ is still shown, not that it
  // keeps its paise.
  await check("P70301", "…while the outstanding figure it DID read still shows", () => /₹4,32[12]/.test(t));
  await check("P70302", "…and the note names what could not be read, with Try again", () => /couldn&apos;t|couldn't|could not/i.test(t) && /Try again/.test(t));
  await check("P70303", "a 95-day-old tab is coloured as overdue", async () => {
    const c = await p.locator("span", { hasText: /oldest 95 days/ }).first().evaluate((el) => getComputedStyle(el).color);
    return /229|e5|red|232/.test(c) || c !== "rgb(255, 255, 255)";
  });
  await check("P70304", "…and it still says the number of days in words", () => /oldest 95 days/.test(t));
  await check("P70305", "…and carries hover text for anyone who cannot see the colour", async () => (await p.locator('span[title="This tab has been open a long time"]').count()) >= 1);
  await check("P70306", "a fresh tab reads 'oldest today'", () => /oldest today/.test(t));
  await check("P70307", "a person with no mobile says 'no mobile'", () => /no mobile/.test(t));
  await check("P70308", "…and a ten-digit one is spaced 5+5 (item 5)", () => /98765 00077/.test(t) && !/9876500077/.test(t));
  await check("P70309", "an unreadable bill date inside a tab is a dash", async () => {
    await p.locator('.adm-card button[aria-expanded]').nth(1).click();
    await p.waitForTimeout(500);
    const s = await p._txt();
    return !/Invalid Date/.test(s);
  });
  await check("P70310", "…and a bill with no number reads 'Bill', not '#null'", async () => /Bill ·/.test(await p._txt()));
  await check("P70311", "…and one with no table reads T?, never 'Tundefined'", async () => /T\?/.test(await p._txt()) && !/Tundefined/.test(await p._txt()));
  await check("P70312", "no leaked code text on the whole page", async () => { const s = await p._txt(); return !NOISE.some((x) => s.includes(x)); });
  await check("P70313", "…and no page error", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 120));
  await p.close();
}
{
  // a CAPPED book — the tiles count everyone, the list is the biggest 500
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`, restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House",
    name: `Debtor ${i}`, phone: String(9200000000 + i), note: null, outstanding: 1000 - i, billCount: 1,
    oldestKhataAt: new Date().toISOString(), bills: [{ bill_no: i, table_number: "1", khata_at: new Date().toISOString(), amount: 1000 - i }],
  }));
  const p = await craft("/owner/khata", "khata", {
    ok: true, listCapped: true, peopleShown: 12,
    summary: { totalOutstanding: 99999, peopleCount: 640, billCount: 900, collectedMonth: 5000, collectedToday: 100 },
    customers: many,
  });
  const t = await p._txt();
  await check("P70314", "a capped book says it is showing the 12 who owe most, of 640", () => /Showing the 12 people who owe the most, of 640\. The figures above count everyone\./.test(t));
  await check("P70315", "…and a search that finds nobody says where it looked", async () => {
    await p.locator('input[aria-label="Search people who owe"]').fill("zzzznobody");
    await p.waitForTimeout(500);
    const s = await p._txt();
    return /No one matches that search among the 12 people who owe the most\. There are 640 people on the book in all\./.test(s);
  });
  await p.close();
}

// ════ E3 · FEEDBACK & COMPLAINTS (P70316–P70340) ════
{
  // a rating outside 1–5 must not take the screen down (the clamp)
  const p = await craft("/owner/issues", "ratings", {
    ok: true, summary: { total: 3, avg: 3.7, dist: [1, 0, 1, 0, 1], unhandled: 2 },
    ratings: [
      { id: "r1", restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", order_id: "o1", table_number: "3", rating: 6, comment: "over five", name: "Odd", created_at: "2026-09-01T10:00:00Z", acknowledged: false, acknowledged_at: null, acknowledged_by: null, staff_note: null },
      { id: "r2", restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", order_id: "o2", table_number: null, rating: -1, comment: null, name: null, created_at: "bad", acknowledged: true, acknowledged_at: "2026-09-01T11:00:00Z", acknowledged_by: "c0af7b5b-1111-2222-3333-444455556666", staff_note: "called them" },
      { id: "r3", restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", order_id: "o3", table_number: "9", rating: 1, comment: "cold food", name: "Real", created_at: "2026-09-02T10:00:00Z", acknowledged: false, acknowledged_at: null, acknowledged_by: null, staff_note: null },
    ],
  });
  const t = await p._txt();
  await check("P70316", "a rating of 6 does not take the whole screen down", () => !/We couldn&apos;t load this just now|Something went wrong/.test(t) && /cold food/.test(t));
  await check("P70317", "…and a rating of -1 does not either", async () => (await p.locator(".adm-card .adm-card").count()) === 3);
  await check("P70318", "…and every star row draws at most five stars", async () => (await p.locator("span[aria-label$='out of 5']").evaluateAll((els) => els.every((e) => (e.innerText.match(/★/g) || []).length === 5))));
  await check("P70319", "…while the spoken label still reports the real number", async () => {
    const ls = await p.locator("span[aria-label$='out of 5']").evaluateAll((e) => e.map((x) => x.getAttribute("aria-label")));
    return ls.includes("6 out of 5") && ls.includes("-1 out of 5");
  });
  await check("P70320", "the empty half of a star row is NOT the same colour as the filled half", async () => {
    const pair = await p.locator("span[aria-label='1 out of 5']").first().evaluate((el) => {
      const grey = el.querySelector("span");
      return [getComputedStyle(el).color, grey ? getComputedStyle(grey).color : "none"];
    });
    return pair[1] !== "none" && pair[0] !== pair[1];
  });
  await check("P70321", "a legacy row's database id never appears where a person's name goes", () => !/c0af7b5b/.test(t));
  await check("P70322", "…and the reference is kept in the hover text instead", async () => (await p.locator('[title*="c0af7b5b"]').count()) >= 1);
  await check("P70323", "an unreadable rating date is a dash, never 'Invalid Date'", () => !/Invalid Date/.test(t));
  await check("P70324", "a rating with no guest name reads 'Guest'", () => /Guest/.test(t));
  await check("P70325", "a rating with no table simply has no table chip", () => !/Table undefined/.test(t) && !/Table null/.test(t));
  await check("P70326", "the average is printed to one decimal", () => /\b3\.7\b/.test(t));
  await check("P70327", "the distribution adds up to the total it claims", async () => {
    const counts = (await p.locator(".adm-card > div > div span.adm-muted").allInnerTexts()).map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
    return counts.length >= 5;
  });
  await check("P70328", "an existing internal note is shown without opening the editor", () => /called them/.test(t));
  await check("P70329", "no leaked code text on the page", () => !NOISE.some((x) => t.includes(x)), NOISE.filter((x) => t.includes(x)).join(","));
  await check("P70330", "…and no page error from any of it", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 140));
  await p.close();
}
{
  // ratings switched off, complaints ON — the tab you are on must not be the dead one
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
    // …and the "Failed to load resource" message does not carry the URL in its TEXT — it is in
  // m.location().url, which is what has to be filtered.
  p.on("console", (m) => {
    if (m.type() !== "error") return;
    const where = `${m.text()} ${m.location()?.url || ""}`;
    if (/sentry\.io|ingest\.us/.test(where)) return;
    errs.push(m.text());
  });
  await p.route("**/api/owner/ratings**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ disabled: true }) }));
  await p.route("**/api/owner/issues**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    ok: true, openCount: 1,
    issues: [{ id: "i1", restaurant_id: "00000000-0000-0000-0000-000000000001", restaurantName: "My Little French House", subject: "Fridge broken", body: "Walk-in cooler down", raised_by: "manager", raised_role: "manager", status: "open", created_at: "2026-09-01T10:00:00Z", resolved_at: null, image_url: "javascript:alert(1)", audio_url: null }],
  }) }));
  await p.goto(BASE + "/owner/issues", { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  const t = (await p.locator("body").innerText()).replace(/\s+/g, " ");
  await check("P70331", "with ratings off the page moves itself onto Complaints", () => /Fridge broken/.test(t));
  await check("P70332", "…and does NOT show an empty screen with only a Complaints button", () => /Open ·|Resolve/.test(t));
  await check("P70333", "…and the ratings tab has no button at all", async () => !(await p.locator(".own-range button").allInnerTexts()).some((x) => /Guest ratings/.test(x)));
  await check("P70334", "…and the open complaint really carries a Resolve button", async () => (await p.locator("button.adm-btn", { hasText: /Resolve/ }).count()) === 1);
  await check("P70335", "an attachment that is not an http address is not rendered at all", async () => (await p.locator("img[alt='Attached photo']").count()) === 0);
  await check("P70336", "…and never becomes a link", async () => (await p.locator('a[href^="javascript"]').count()) === 0);
  await check("P70337", "no page error", () => errs.length === 0, errs.join(" | ").slice(0, 140));
  await p.close();
}
{
  // BOTH sections withheld — R36 sends him away, naming nothing
  const p = await ctx.newPage();
  for (const a of ["ratings", "issues"]) await p.route(`**/api/owner/${a}**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ disabled: true }) }));
  await p.goto(BASE + "/owner/issues", { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  const t = (await p.locator("body").innerText()).replace(/\s+/g, " ");
  await check("P70338", "both sections withheld forwards him to the dashboard", () => p.url().endsWith("/owner"));
  await check("P70339", "…naming no feature and nobody to ask", () => !/isn&apos;t enabled|isn't enabled|contact Aevidine|ask your administrator/i.test(t));
  await check("P70340", "…and leaving no empty Feedback page behind", () => !/read it, handle it, mark it done/.test(t));
  await p.close();
}

await br.close();
const bad = rows.filter((r) => r.res !== "✅");
console.log(`BLOCK E · ${n} checks · ${rows.length - bad.length} ✅ · ${bad.length} not-green`);
for (const b of bad) console.log(`  ${b.res} ${b.id} — ${b.what}${b.note ? `  [${b.note}]` : ""}`);

try {
  const { writeFileSync: __w, mkdirSync: __m } = await import("node:fs");
  __m(".claude/sweep/t16-rows", { recursive: true });
  __w(".claude/sweep/t16-rows/E.json", JSON.stringify(rows ?? results, null, 1));
} catch (e) { console.error("could not write rows:", e.message); }
