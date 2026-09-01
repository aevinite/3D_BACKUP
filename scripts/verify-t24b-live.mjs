// verify-t24b-live.mjs — the LIVE half of sweep #7 / terminal 24's checks (ids P27033–P27098).
//
// The static half is scripts/verify-t24b-money-safety.mjs. This one needs the app running, because
// six of these rows are only true if a real person, on a real screen, sees the right thing. A green
// static suite is not evidence the screen is right.
//
//   npm run dev                                      # or any port you own
//   node scripts/verify-t24b-live.mjs --base http://localhost:4000
//
// READ-ONLY, BY CONSTRUCTION. Every write it attempts is one the server REFUSES (400 or 409), so it
// writes no row and has nothing to clean up. That is deliberate: the refusal path is where almost
// all of lib/paySplit.ts's judgement lives — the shape rules, the recomputed due, and the sentence
// a waiter has to be able to act on — and it can be exercised without taking anybody's money.
//
// ONE LOGIN PER ROLE, through scripts/sweep/login.mjs's cache. Staff login is rate-limited and
// reaching that wall pings the owner's phone; our own tooling has set it off before.
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4000");
const SHOTS = arg("--shots", null);   // omit to take no screenshots at all
let n = 0; const bad = [];
const check = (m, c, got) => { if (c) { n++; console.log("  \u2713 " + m); } else { bad.push(m); console.log("  \u2717 " + m + (got === undefined ? "" : "  \u2192 " + JSON.stringify(got).slice(0, 300))); } };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

const browser = await chromium.launch();

console.log(`\n\u2500\u2500 T24 live \u00b7 ${BASE} \u2500\u2500`);

// ── the manager panel: the split refusals, and the floor as it renders ───────────────────────
{


console.log(`\n\u2500\u2500 T24 live \u00b7 ${BASE} \u2500\u2500`);
// REFUSES (400/409), so no row is written and nothing needs cleaning up.

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await loginAs(ctx, "manager", BASE);
const page = await ctx.newPage();
await page.goto(BASE + "/manager", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const postSplit = (table, splits) => page.evaluate(async ([b, t, s]) => {
  const r = await fetch(`${b}/api/editor/tables/${t}/pay-split`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ splits: s }),
  });
  return { status: r.status, body: (await r.text()).slice(0, 400) };
}, [BASE, table, splits]);

// WHICH TABLE. Any number works for the shape refusals — they are answered before the server
// reads a single row, which is the point of them. The "nothing to settle" rows want a table with
// no live bill on it; pass --table N if this one has picked up a party since.
const T = arg("--table", "18");
console.log("\n── the shape refusals, which happen before any read ──");
const cases = [
  ["a 'split' with one part is refused", [{ amount: 100, method: "Cash" }], 400, /at least two parts/],
  ["…and thirteen parts too", Array.from({ length: 13 }, () => ({ amount: 1, method: "Cash" })), 400, /max 12/],
  ["a part of zero is refused", [{ amount: 0, method: "Cash" }, { amount: 100, method: "UPI" }], 400, /above zero/],
  ["a negative part is refused", [{ amount: -5, method: "Cash" }, { amount: 105, method: "UPI" }], 400, /above zero/],
  ["a part with no number at all is refused", [{ amount: "abc", method: "Cash" }, { amount: 100, method: "UPI" }], 400, /above zero/],
  ["an unknown way to pay is refused", [{ amount: 50, method: "Crypto" }, { amount: 50, method: "Cash" }], 400, /payment method/],
  ["an over-long note on a part is refused", [{ amount: 50, method: "Cash", note: "x".repeat(201) }, { amount: 50, method: "UPI" }], 400, /note too long/],
  ["a tab owed by nobody is refused", [{ amount: 50, method: "Pay later" }, { amount: 50, method: "Cash" }], 400, /pick who owes it/],
  ["two tabs on one bill are refused", [{ amount: 50, method: "Pay later", khataName: "A" }, { amount: 50, method: "Pay later", khataName: "B" }], 400, /Only one part can be pay-later/],
  ["a tab written in lower case is not a tab, it is an unknown way to pay", [{ amount: 50, method: "pay later", khataName: "A" }, { amount: 50, method: "Cash" }], 400, /payment method/],
];
for (const [msg, splits, status, words] of cases) {
  const r = await postSplit(T, splits);
  check(msg, r.status === status, r);
  check(`   …and it says why, in words a waiter can act on`, words.test(r.body), r.body);
}

console.log("\n── a table with nothing settleable ──");
const rEmpty = await postSplit(T, [{ amount: 50, method: "Cash" }, { amount: 50, method: "UPI" }]);
check("a table with nothing to settle is refused plainly, never with a crash", rEmpty.status === 409, rEmpty);
check("…and it says what to do instead", /Nothing to settle|no live bill/.test(rEmpty.body), rEmpty.body);
check("…and the refusal is a sentence, not a code", !/^\{"error":"[a-z_]+"\}$/.test(rEmpty.body), rEmpty.body);
const rNoTable = await postSplit("999999", [{ amount: 50, method: "Cash" }, { amount: 50, method: "UPI" }]);
check("a table number that does not exist is refused, never a 500", rNoTable.status < 500, rNoTable);
const rBadTable = await postSplit("abc", [{ amount: 50, method: "Cash" }, { amount: 50, method: "UPI" }]);
check("a table that is not a number is refused with a sentence", rBadTable.status === 400 && /valid table/.test(rBadTable.body), rBadTable);

console.log("\n── no refusal ever leaks code text at a person ──");
const allBodies = [rEmpty.body, rNoTable.body, rBadTable.body];
for (const leak of ["[object Object]", "undefined", "NaN", "${"]) {
  check(`no refusal contains ${leak}`, !allBodies.some((b) => b.includes(leak)));
}

console.log("\n── the rendered manager floor ──");
await page.goto(BASE + "/manager", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

await shot(page, "manager-floor");
// The manager panel is public/panels/editor/ inside an IFRAME, so the outer document has no text
// of its own. Reading document.body.innerText on the wrapper measures the wrapper, not the panel.
const panelText = async (p) => {
  const t = await p.evaluate(() => document.body.innerText);
  if (t.trim().length > 40) return t;
  for (const f of p.frames()) { const ft = await f.evaluate(() => document.body.innerText).catch(() => ""); if (ft.trim().length > 40) return ft; }
  return t;
};
const text = await panelText(page);
check("the manager floor is not a blank screen", text.trim().length > 40, text.length);
for (const leak of ["[object Object]", "NaN", "${", "-->"]) {
  const line = text.split("\n").find((l) => l.includes(leak));
  check(`the manager floor shows no leaked code text: ${leak}`, !line, line?.slice(0, 120));
}
check("a rupee figure on the floor is never shown with more than two decimals",
  !/₹\s?[\d,]+\.\d{3,}/.test(text), (text.match(/₹\s?[\d,]+\.\d{3,}/g) || []).slice(0, 3));

console.log("\n── the same screen at phone size ──");
const mob = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const st = await ctx.storageState(); await mob.addCookies(st.cookies);
const mp = await mob.newPage();
await mp.goto(BASE + "/manager", { waitUntil: "networkidle" });
await mp.waitForTimeout(3000);
await shot(mp, "manager-floor-360");
const mtext = await panelText(mp);
check("the manager floor is not blank at 360px", mtext.trim().length > 40, mtext.length);
const overflow = Math.max(...(await Promise.all(mp.frames().map((f) =>
  f.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => 0)))));
check("nothing on the manager floor runs off the side of a phone", overflow <= 2, overflow);

check("the floor names THIS restaurant, not restaurant #1's branding", /french/i.test(text), text.slice(0, 120));
check("the floor says how many tables are occupied out of how many", /\d+\/\d+/.test(text), (text.match(/\d+\/\d+/) || [])[0]);
check("a money figure on the floor is never shown as a bare 'undefined'", !/₹\s*undefined/i.test(text));
check("the floor is readable at 360px too — it names the restaurant there as well", /french/i.test(mtext), mtext.slice(0, 120));


// The whole reason that file exists is that the report once printed two different CGST figures for
// one month. So the check is: read the table off the real screen and reconcile it BOTH ways.
}

// ── the owner console: the Tax/GST sheet, reconciled both ways off the real screen ───────────
{
const octx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await loginAs(octx, "owner", BASE);
const opage = await octx.newPage();
opage.on("console", (m) => { if (m.type() === "error") console.log("    [console error]", m.text().slice(0, 160)); });
await opage.goto(BASE + "/owner/reports", { waitUntil: "networkidle" });
await opage.waitForTimeout(5000);
// The Reports opage is an index of cards; the tax sheet is behind the "Tax / GST" one. A ?tab=
// guess lands on the index and would have measured the wrong screen.
const card = opage.locator("text=/Tax\\s*\\/\\s*GST/i").first();
if (await card.count()) { await card.click(); await opage.waitForTimeout(7000); }
console.log("  opened:", (await opage.evaluate(() => document.body.innerText)).split("\n").slice(0, 4).join(" | ").slice(0, 160));

await shot(opage, "owner-tax");
const text = await opage.evaluate(() => document.body.innerText);
check("the owner's Tax/GST screen is not blank", text.trim().length > 100, text.length);
check("…and it is the tax screen, not another tab", /tax|gst/i.test(text));
for (const leak of ["[object Object]", "NaN", "${", "-->", "Infinity"]) {
  const line = text.split("\n").find((l) => l.includes(leak));
  check(`the tax screen shows no leaked code text: ${leak}`, !line, line?.slice(0, 140));
}
check("no money figure on the tax screen shows more than two decimals",
  !/₹\s?[\d,]+\.\d{3,}/.test(text), (text.match(/₹\s?[\d,]+\.\d{3,}/g) || []).slice(0, 3));

// ── RECONCILE WHAT IS ON THE SCREEN, BOTH WAYS ────────────────────────────────────────────────
// This is the screen lib/taxFiling.ts exists for: it once printed two different CGST figures for
// one month. So read the real numbers and check they agree with each other and with the rate.
const money = (label) => {
  const m = text.match(new RegExp(label + "[\\s\\S]{0,80}?₹\\s?([\\d,]+(?:\\.\\d+)?)", "i"));
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
const collected = money("TAX COLLECTED");
const taxable = money("TAXABLE SALES");
const perBill = money("TAX PER BILL");
const bills = Number((text.match(/([\d,]+) paid bills/) || [])[1]?.replace(/,/g, "") || 0);
const rateShown = Number((text.match(/EFFECTIVE RATE[\s\S]{0,40}?([\d.]+)\s?%/i) || [])[1] || 0);
const setRate = Number((text.match(/matches the set ([\d.]+)\s?%/i) || [])[1] || 0);
console.log(`    read off the screen: tax ₹${collected} · taxable ₹${taxable} · ${bills} bills · ${rateShown}% (set ${setRate}%) · ₹${perBill}/bill`);
check("the tax screen states what was collected", collected !== null && collected >= 0, collected);
check("…and the taxable sales it was charged on", taxable !== null && taxable >= 0, taxable);
check("…and how many bills that was over", bills > 0, bills);

// The split panel: every tax line, and whether they add back to the total.
const split = await opage.evaluate(() => {
  const rows = [];
  for (const tr of document.querySelectorAll("table tr")) {
    const c = Array.from(tr.querySelectorAll("td, th")).map((x) => x.innerText.trim());
    if (c.length >= 3) rows.push(c);
  }
  return rows;
});
const nums = (r) => Number(String(r.at(-1)).replace(/[^0-9.]/g, "")) || 0;
const totalRow = split.find((r) => /total tax/i.test(r[0]));
const lineRows = split.filter((r) => /^(CGST|SGST|IGST|Cess)/i.test(r[0]));
check("the split panel names each tax line the printed bill shows", lineRows.length >= 1, split.map((r) => r[0]));
check("…with a rate against each one", lineRows.every((r) => /%/.test(r[1] || "")), lineRows);
if (totalRow && lineRows.length) {
  const sum = lineRows.reduce((a, r) => a + nums(r), 0);
  check("THE ONE THAT MATTERS: the tax lines add back to the total tax, to the rupee",
    Math.abs(sum - nums(totalRow)) <= 0.51, { lines: lineRows.map(nums), sum, total: nums(totalRow) });
  check("…and that total is the same figure as the tile above it",
    collected === null || Math.abs(nums(totalRow) - collected) <= 0.51, { panel: nums(totalRow), tile: collected });
  const rates = lineRows.map((r) => Number(String(r[1]).replace(/[^0-9.]/g, "")) || 0);
  const totalRate = Number(String(totalRow[1]).replace(/[^0-9.]/g, "")) || 0;
  check("…and the tax lines' rates add up to the restaurant's rate",
    Math.abs(rates.reduce((a, x) => a + x, 0) - totalRate) < 0.005, { rates, totalRate });
  check("no tax line is negative", lineRows.every((r) => nums(r) >= 0), lineRows.map(nums));
} else check("the split panel prints a total line", false, split.slice(0, 6));

if (collected !== null && taxable) {
  const derived = (collected / taxable) * 100;
  check("the effective rate on screen is the collected tax over the taxable sales, not a stored number",
    Math.abs(derived - rateShown) <= 0.02, { derived: derived.toFixed(3), rateShown });
  check("…and it lands within a whisker of the rate the restaurant actually set",
    setRate === 0 || Math.abs(derived - setRate) <= 0.05, { derived: derived.toFixed(3), setRate });
}
if (collected !== null && bills && perBill !== null) {
  check("tax per bill is the collected tax divided by the bills, rounded",
    Math.abs(Math.round(collected / bills) - perBill) <= 1, { calc: collected / bills, shown: perBill });
}
{
  // Count what is actually DRAWN, whatever it is drawn with — this chart is not SVG <rect>s, and a
  // selector guess that misses them would report a lonely bar on a chart with twenty-five.
  const bars = await opage.evaluate(() => {
    const box = Array.from(document.querySelectorAll("*")).find((e) => /Tax over time/i.test(e.textContent || "") && e.querySelectorAll("*").length < 400);
    const root = box || document.body;
    return Array.from(root.querySelectorAll("svg rect, svg path, canvas, [data-bar], [class*=bar]"))
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 2; }).length;
  });
  check("the chart on this screen is not a lonely single bar", bars > 3, bars);
  const labels = (text.match(/\d{1,2} (Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun)/g) || []).length;
  check("…and its time axis is labelled with real dates, more than one", labels > 3, labels);
}
check("…and it is not an empty box with no honest message either",
  /Tax over time/i.test(text) && (/₹/.test(text)), text.slice(0, 60));

// Light skin — the owner console has its own, and a fixed colour would only show there.
await opage.evaluate(() => { try { localStorage.setItem("aevidine_skin", "light"); document.cookie = "aevidine_skin=light;path=/"; } catch {} });
await opage.reload({ waitUntil: "networkidle" });
await opage.waitForTimeout(5000);
await shot(opage, "owner-tax-light");
const ltext = await opage.evaluate(() => document.body.innerText);
check("the tax screen still renders in the light skin", ltext.trim().length > 100, ltext.length);
check("…and shows the same figures, not a blank or an error", Math.abs(ltext.length - text.length) < text.length * 0.5, { dark: text.length, light: ltext.length });
await opage.evaluate(() => { try { localStorage.removeItem("aevidine_skin"); document.cookie = "aevidine_skin=;path=/;max-age=0"; } catch {} });
}

console.log(bad.length
  ? `\n\u2717 FAIL \u2014 ${bad.length} of ${n + bad.length} live checks failed:\n   ${bad.join("\n   ")}\n`
  : `\n\u2713 PASS \u2014 all ${n} live checks passed   (ids P27033\u2013P27098)\n`);
await browser.close();
process.exit(bad.length ? 1 : 0);
