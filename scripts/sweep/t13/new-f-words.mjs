// scripts/sweep/t13/new-f-words.mjs — NEW block, ids P67236–P67300.
//
// Band F: the WORDS on these screens, and the project rules that govern this territory.
//
// WHY. The gap measurement found 36 sentences in this territory that no ledger row anywhere
// mentions — including every line of both Coming-soon pages, the two refusal sentences the
// analytics route sends, and the failure message the overview sends. A sentence nothing checks is
// a sentence that drifts, and this owner reads every one of them.
import { chromium } from "playwright";
import { chk, skip, code, src, report, setOnly, writeLedger, count, executedIds } from "./lib.mjs";
import { loginAs } from "../login.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:4313").replace(/\/$/, "");
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

const PAGE = "app/owner/page.tsx";
const p = code(PAGE), praw = src(PAGE);
const a = code("app/api/owner/analytics/route.ts");
const ov = code("app/api/owner/overview/route.ts");
const mkt = src("app/owner/marketing/page.tsx"), onl = src("app/owner/online/page.tsx");

// ── THE IDS IN THIS BAND ARE POSITIONAL, SO THE COUNT IS LOCKED ───────────────────────────────
// `nextId()` hands out P67236 onwards in execution order. That is fine for a band that is run,
// never edited — and dangerous the moment a row is INSERTED in the middle, because every id after
// it silently shifts and the ledger's promise ("an id means one specific check, forever") breaks.
// I found this the honest way: a sabotage pass asserted ids I had written down before adding two
// rows mid-band, and ten of eighteen cases looked like a guard staying green when in fact the
// guard fired on a different number.
// So the count is declared. Insert a row and this refuses to run, which forces a decision:
// either append at the END (ids stay put), or renumber deliberately and update the ledger.
const results_count = () => executedIds().length;
const EXPECT_ROWS = 59;
let id = 67236;
const nextId = () => `P${id++}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const route = await loginAs(ctx, "owner", BASE);

// ── the two Coming-soon pages, rendered ──────────────────────────────────────────────────────
for (const [path, title, lines] of [
  ["/owner/marketing", "Marketing & offers", ["Coupons & happy-hour pricing", "SMS / WhatsApp campaigns", "Campaign ROI tracking"]],
  ["/owner/online", "Online & aggregators", ["Unified Zomato / Swiggy inbox", "Toggle items online instantly", "Your own online-ordering link"]],
]) {
  const pg = await ctx.newPage();
  await pg.goto(BASE + path, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(1600);
  const body = await pg.locator("body").innerText();
  await chk(nextId(), `${path} renders its own heading, not the dashboard's`, () =>
    body.includes(title) ? true : `the page does not print "${title}"`);
  await chk(nextId(), `${path} says plainly that it is not built yet`, () =>
    /not built|coming soon|on the way|isn.t here yet|we are building|being built/i.test(body)
      ? true : "nothing on the page says it is unbuilt");
  await chk(nextId(), `${path} lists what it will do, in the owner's own words`, () => {
    const missing = lines.filter((l) => !body.includes(l));
    return missing.length === 0 ? true : `missing: ${JSON.stringify(missing)}`;
  });
  await chk(nextId(), `${path} leaks no code text and no raw database word`, () => {
    const bad = ["[object Object]", "undefined", "NaN", "${", "-->", "null"].filter((b) => body.includes(b));
    return bad.length === 0 ? true : `${JSON.stringify(bad)}`;
  });
  await chk(nextId(), `${path} offers no control that does nothing`, async () => {
    const btns = await pg.locator("main button, .adm-main button").count();
    return btns === 0 ? true : `${btns} buttons on a page that is not built`;
  });
  await chk(nextId(), `${path} fetches nothing of its own`, async () => {
    const reqs = [];
    // BASE-scoped on purpose: Sentry's envelope endpoint is itself ".../api/<id>/envelope/", so a
    // bare /\/api\// match reported both static pages as fetching their own data. The question is
    // whether THIS page asks OUR server for anything.
    pg.on("request", (r) => { const u = r.url(); if (u.startsWith(BASE) && /\/api\//.test(u)) reqs.push(u.replace(BASE, "")); });
    await pg.reload({ waitUntil: "networkidle", timeout: 120000 });
    await pg.waitForTimeout(2200);
    // the SHELL still loads the overview; the page itself must add nothing
    const own = reqs.filter((u) => !/owner\/overview/.test(u));
    return own.length === 0 ? true : `the page requested: ${JSON.stringify(own)}`;
  });
  await chk(nextId(), `${path} still renders inside the owner shell, so he can navigate away`, async () => {
    const nav = await pg.locator(".adm-side, aside, nav").count();
    return nav > 0 ? true : "the page renders with no navigation around it";
  });
  await pg.close();
}
await chk(nextId(), "both Coming-soon pages are marked SOON in the navigation, so nothing is a surprise", async () => {
  const pg = await ctx.newPage();
  await pg.goto(BASE + route, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(2600);
  const soon = await pg.locator("text=SOON").count();
  await pg.close();
  return soon >= 2 ? true : `${soon} SOON markers in the nav`;
});

// ── the sentences the ROUTES send, which the screen then prints ───────────────────────────────
await chk(nextId(), "the refusal for ONE restaurant tells him who to ask", () =>
  /Reports aren't enabled for this restaurant — contact Aevidine\./.test(a)
    ? true : "the per-restaurant refusal sentence changed");
await chk(nextId(), "…and so does the refusal for his whole account", () =>
  /Reports aren't enabled for your restaurant — contact Aevidine\./.test(a)
    ? true : "the account-level refusal sentence changed");
await chk(nextId(), "…and both are sent as a PERMISSION, flagged disabled, never as a breakage", () =>
  count(a, /disabled: true \}, \{ status: 403 \}/g) === 2
    ? true : "one of the two refusals is no longer a flagged 403");
await chk(nextId(), "a failed dashboard read says what to do, not what the database said", () =>
  /message: "Couldn't load your dashboard just now — please try again\."/.test(a)
    ? true : "the analytics failure message changed");
await chk(nextId(), "…and the overview's failure message reads the same way", () =>
  /message: "Couldn't load your restaurants just now — please try again\."/.test(ov)
    ? true : "the overview failure message changed");
await chk(nextId(), "neither route puts a database message in front of the owner", () => {
  // dbFail keeps the detail in OUR log; the owner gets the sentence above
  const leaks = [...a.matchAll(/error:\s*(?:e|error)\.message/g)].length
              + [...ov.matchAll(/error:\s*(?:e|error)\.message/g)].length;
  return leaks === 0 ? true : `${leaks} places hand the database's own words to the owner`;
});
await chk(nextId(), "…and both log the real detail for us", () => {
  const logs = count(a, /console\.error\(/g) + count(ov, /console\.error\(/g);
  return logs >= 3 ? true : `only ${logs} places log the detail`;
});
await chk(nextId(), "a partial read is NAMED, so the screen can say which part is short", () => {
  const keys = [...a.matchAll(/partial\.push\("(\w+)"\)/g)].map((m) => m[1]);
  return keys.length >= 2 ? true : `only ${JSON.stringify(keys)} can be reported as partial`;
});
await chk(nextId(), "…and a payload carrying `partial` is never FROZEN into the cache", () => {
  const cacheLib = code("lib/ownerCache.ts");
  return /isPartial\(payload\)/.test(cacheLib) ? true : "a half answer could outlive the blip that caused it";
});

// ── the words on the dashboard itself ────────────────────────────────────────────────────────
await chk(nextId(), "the switched-off note tells him it is switched off, not broken", () =>
  /Figures aren&rsquo;t shown here\./.test(praw) ? true : "the switched-off heading changed");
await chk(nextId(), "…and every card in that state says the same short thing", () =>
  /const loadNote = offNote \? "Not shown — Reports are switched off\." : "Loading…";/.test(p)
    ? true : "the per-card off note changed");
await chk(nextId(), "…and the estate row for a hidden restaurant says its takings are hidden", () =>
  /figures hidden<\/span>/.test(p) ? true : "the hidden-row wording changed");
await chk(nextId(), "…and the drawer for one says it is still open and trading", () =>
  /it is still open and trading/.test(praw) ? true : "the drawer's hidden note changed");
await chk(nextId(), "the Expenses popup explains that this is a COST, not money that left the bank", () =>
  /This is what the period COST you, not what left your bank\./.test(p)
    ? true : "the expenses note changed");
await chk(nextId(), "the On hand popup says plainly it is not a bank balance", () =>
  /It is not a bank balance/.test(p) ? true : "the on-hand note changed");
await chk(nextId(), "the Revenue popup explains why a cancellation is not money he lost", () =>
  /A cancelled bill is not money you lost — nothing was ever charged for it/.test(p)
    ? true : "the cancellation sentence changed");
await chk(nextId(), "…and points him at the record instead of quoting a figure", () =>
  /Cancellations are kept as a record, with the reason and the person, in Audit & logs\./.test(p)
    ? true : "the pointer to the record changed");
await chk(nextId(), "the Today popup admits it does not follow the period dropdown", () =>
  /This one does not follow the period above — it is always today\./.test(p)
    ? true : "the Today popup's note changed");
await chk(nextId(), "the month chart says why its line stops before today", () =>
  count(p, /Today is still in progress, so it joins the line tomorrow\./g) === 2
    ? true : "the part-day caption is not on both month cards");
await chk(nextId(), "the records strip names its own rolling window rather than borrowing the dropdown's", () =>
  count(p, /LAST 30 DAYS \(ROLLING\)/g) === 2 ? true : "the rolling-window wording changed");
await chk(nextId(), "no sentence on the dashboard is written for a developer", () => {
  const jargon = ["payload", "fetch", "cache key", "endpoint", "RPC", "fingerprint", "entitlement",
    "snapshot cache", "idempotent", "hydrate", "memo", "props", "state", "null", "undefined"];
  // only the STRINGS a person reads, never the comments — code() has already dropped those
  const shown = [...p.matchAll(/"([A-Z][^"\\]{14,120})"/g)].map((m) => m[1]);
  const bad = shown.filter((s) => jargon.some((j) => new RegExp(`\\b${j}\\b`, "i").test(s)));
  return bad.length === 0 ? true : `developer words in copy: ${JSON.stringify(bad.slice(0, 4))}`;
});
await chk(nextId(), "every empty state on the page says what would fill it, or offers a way on", () => {
  const empties = [...p.matchAll(/adm-empty">\{?([^<{]{6,120})/g)].map((m) => m[1].trim());
  const dead = empties.filter((e) => /^(No data|None|Empty|-|—)\.?$/i.test(e));
  return dead.length === 0 ? true : `dead-end empty states: ${JSON.stringify(dead)}`;
});
await chk(nextId(), "every figure on the page is captioned with the period it covers", async () => {
  const pg = await ctx.newPage();
  await pg.goto(BASE + route, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(3000);
  const uncaptioned = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll(".adm-card").forEach((c) => {
      if (!c.querySelector("svg") && !c.querySelector(".rv-dish")) return;
      const title = c.querySelector(".ow2-ct > span:first-child")?.textContent?.trim().slice(0, 34) || "?";
      const chip = c.querySelector(".ow2-tag");
      const saysPeriod = /month|day|week|time|hour/i.test(c.querySelector(".ow2-ct")?.textContent || "");
      if (!chip && !saysPeriod) out.push(title);
    });
    return out;
  });
  await pg.close();
  // NO EXCEPTIONS LEFT. "Every dish" used to be the one card showing period-scoped figures with
  // no period on its face; the owner picked that as his item 9 on 2026-09-05 and it now carries
  // the same chip as its neighbours. This row is the reason the exception could not be quietly
  // forgotten — it named the card rather than skipping the check.
  return uncaptioned.length === 0
    ? true : `cards with no period named: ${JSON.stringify(uncaptioned)}`;
});
chk("P67294", "…and the 'Every dish' card is one of them, with a chip that FOLLOWS the dropdown", () => {
  const m = /<span>Every dish <span className="mut">· tap one for detail<\/span><\/span>([\s\S]*?)<\/div>/.exec(praw);
  if (!m) return "the Every dish card header is gone";
  const chip = /<span className="ow2-tag" title=\{\[rangeSpanText\(globalRange\), mainAge\(\)\][\s\S]{0,60}?\{RANGES\.find\(\(r\) => r\.k === globalRange\)!\.label\}<\/span>/.test(m[1]);
  return chip ? true : "the dish card's period chip is gone, or no longer reads the main range";
});
// ── the project's own rules, for THIS territory ───────────────────────────────────────────────
await chk(nextId(), "no new column is added to `settings` by anything in this territory", () => {
  const files = [p, a, ov, code("app/owner/layout.tsx")];
  const bad = files.filter((f) => /alter table settings|settings.*add column/i.test(f));
  return bad.length === 0 ? true : "a settings column change appeared";
});
await chk(nextId(), "no new module, permission or screen is introduced", () => {
  const keys = [...new Set([...p.matchAll(/entitlements\?\.(\w+)/g)].map((m) => m[1]))];
  const known = new Set(["reports", "staff", "issues", "logs"]);
  const unknown = keys.filter((k) => !known.has(k));
  return unknown.length === 0 ? true : `new entitlement keys: ${JSON.stringify(unknown)}`;
});
await chk(nextId(), "every overlay on the dashboard registers with the back-button manager", () => {
  const layers = [...p.matchAll(/useBackClose\(/g)].length;
  const dialogs = count(praw, /role="dialog"/g);
  return layers >= dialogs + 2 ? true : `${layers} back layers for ${dialogs} dialogs plus the two drill levels`;
});
await chk(nextId(), "…and nothing here hand-rolls browser history", () =>
  !/pushState|replaceState|popstate/.test(p) ? true : "history is hand-rolled");
await chk(nextId(), "the dashboard performs no write, so there is nothing for the clash guard to cover", () => {
  const methods = [...praw.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]);
  return methods.length === 0 ? true : `writes: ${JSON.stringify(methods)}`;
});
await chk(nextId(), "…and it therefore needs no idempotency key and no outbox", () =>
  !/idempotenc|outbox/i.test(p) ? true : "a write-path helper appeared on a read-only screen");
await chk(nextId(), "the owner API family is covered by the offline layer", () => {
  const sw = src("public/sw.js");
  return /\/api\/owner\//.test(sw) ? true : "the owner API family is not in the service worker's data paths";
});
await chk(nextId(), "every read this page makes is scoped and capped", () => {
  const urls = [...praw.matchAll(/fetch\(`([^`]*(?:`[^`]*`[^`]*)*)`/g)].map((m) => m[0]);
  const oplog = urls.find((u) => /oplog/.test(u));
  const bad = [];
  if (!oplog || !/limit=6/.test(oplog)) bad.push("the activity feed has no limit");
  if (!oplog || !/rid=/.test(oplog)) bad.push("the activity feed is not scoped");
  return bad.length === 0 ? true : bad.join(" · ");
});
await chk(nextId(), "no poll on this page beats the 60-second backstop", () => {
  const ms = [...p.matchAll(/useActiveAutoRefresh\([^,]*,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  return ms.length >= 1 && ms.every((v) => v >= 60000) ? true : `intervals: ${JSON.stringify(ms)}`;
});
await chk(nextId(), "…and the poll stops when the tab is not being looked at", () =>
  /useActiveAutoRefresh/.test(p) && !/setInterval/.test(p)
    ? true : "a raw interval would keep asking while nobody is watching");
await chk(nextId(), "nothing in this territory names an AV-live key, folder, repo or database", () => {
  const all = praw + src("app/api/owner/analytics/route.ts") + src("app/api/owner/overview/route.ts") + src("app/owner/layout.tsx");
  return !/kclqkmdxnwlhtyrducku|3D_Menu_Av|env\.AV\.live|aevinite\.shop/.test(all)
    ? true : "a live-stack reference appeared";
});
await chk(nextId(), "nothing here re-suggests anything the owner has already refused", () => {
  const rejected = src("docs/REJECTED-IDEAS.md");
  // the three that touch this screen: a kitchen profile, a bill-delete route, a chart-shape toggle
  const bad = [];
  if (/kitchen[\s\S]{0,30}profile/i.test(p)) bad.push("a kitchen profile (R7)");
  if (/delete[A-Za-z]*Bill/i.test(p)) bad.push("a bill-delete route (R27)");
  if (/chartType|chartShape|toggleChart/i.test(p)) bad.push("a chart-shape toggle");
  return bad.length === 0 && rejected.length > 0 ? true : `re-suggested: ${JSON.stringify(bad)}`;
});
await chk(nextId(), "the owner's revenue still INCLUDES binned bills, which compliance requires", () => {
  // the dashboard must not quietly exclude a soft-deleted bill from what was COLLECTED
  return !/deleted_at IS NULL|is\("deleted_at", null\)/.test(a)
    ? true : "the analytics route filters out deleted bills — the Z-report rule forbids it";
});
await chk(nextId(), "…and nothing on this screen can hide, edit or erase a sale", () => {
  const bad = /void|erase|hide[A-Z]|suppress/i.test(p) && /method:\s*"(POST|PATCH|DELETE)"/.test(praw);
  return !bad ? true : "a write that could hide a sale appeared on the dashboard";
});
await chk(nextId(), "the dish drill's way out is labelled for the scope it actually returns to", () => {
  const m = /No sales for <b>\{view\.dish\}<\/b>[\s\S]*?<\/div>/.exec(p);
  if (!m) return "the missing-dish state is gone";
  return /\{single \? "Back to the dashboard" : "Back to the restaurant"\}/.test(m[0])
    && /viewTo\(single \? \{ level: "home" \} : \{ level: "restaurant", rid: view\.rid \}\)/.test(m[0])
    ? true : "the label and the destination can disagree again";
});
await chk(nextId(), "…and the dish header's ✕ agrees with it", () =>
  count(p, /single \? "Back to the dashboard" : "Back to the restaurant"/g) >= 3
    ? true : "the ✕ and the empty-state button word the same journey differently");
await chk(nextId(), "the trophy cannot be awarded to a restaurant that took nothing", () =>
  /const bestEarned = !!best && best\.revenue > 0 && total > 0;/.test(p)
    ? true : "the zero-revenue guard on the top-performer banner is gone");
await chk(nextId(), "the Orders caption cannot state an average when nothing has been paid", () =>
  /kMain\.paidOrders \? `\$\{inr\(kMain\.avg\)\} per paid order` : "none paid yet"/.test(p)
    ? true : "the Orders tile can print a ₹0 average as fact again");
await chk(nextId(), "the estate row is a positioned box, so nothing in it escapes to the document", () => {
  const phone = /@media \(max-width: 760px\) \{([\s\S]*?)\n        \}/.exec(src(PAGE).match(/<style jsx>\{`([\s\S]*?)`\}<\/style>/g).join("\n"));
  const sheet = src(PAGE);
  return /\.hq-table :global\(tr\.hq-row\) \{ position: relative;/.test(sheet)
    ? true : "the estate row lost its containing block — the rank cell would stretch the page again";
});
await chk(nextId(), "a custom period's saved figures can be found again, rather than recomputed each open", () =>
  /\? `custom:\$\{from\.slice\(0, 10\)\}:\$\{to\.slice\(0, 10\)\}`/.test(a)
    ? true : "the custom cache key carries a timestamp again");

if (results_count() !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: this band executed ${results_count()} rows but declares EXPECT_ROWS = ${EXPECT_ROWS}.\nEvery id after the inserted row has shifted. Append at the end, or renumber deliberately and update the ledger.`);
  process.exit(2);
}
const n = report(`T13 NEW band F · the words on these screens, and the rules (P67236–P${id - 1})`, { minChecks: 40 });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: "read every string a person sees, and drove both Coming-soon pages; checked this territory against the project rules",
  section: `NEW · Band F — the words on these screens, and the rules — P67236–P${id - 1}`,
});
await browser.close();
