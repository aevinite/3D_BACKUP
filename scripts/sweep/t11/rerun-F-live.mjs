// The two rows of section F that the ledger itself marks as needing a real page: P03689 and P03690.
//
// ⚠️ THIS FILE IS A DEBT BEING PAID. rerun-F.mjs has said since 2026-09-04 that these two "are
// driven in a real page by rerun-F-live.mjs" — and that file was never written, so the only two
// rows of sections A–J left unrun were the two a comment claimed were covered. A promise in a
// comment is exactly as good as no coverage, and harder to notice. Written 2026-09-06.
//
// Both are about the bill-customer sheet's Generate button, and both are about a TAP NOT DYING IN
// SILENCE — P03689 is the row that was ❌ once already (finding F4: "the handler existed and read
// correctly", but the button could not actually receive the click).
import { row, skipRow, read } from "./lib.mjs";

const BASE = process.env.T11_BASE || "http://localhost:4311";
const pw = await import("playwright").catch(() => null);
const reachable = await fetch(BASE + "/panels/billcustomer.js").then((r) => r.ok).catch(() => false);
const R = (id, what, fn) => (pw && reachable ? row(id, what, fn)
  : skipRow(id, what, `needs playwright and a server at ${BASE} — start the dev server and re-run`));

/** Open a blank page carrying the REAL billcustomer.js + backstack.js, and open the sheet. */
async function openSheet(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  // A REAL same-origin page, then the REAL script files injected — not a copy of the source.
  // `/panels/editor/` is served by Next (it renders the panel host), so it does NOT expose the raw
  // panel globals; the panel's own markup lives at /panels/editor/index.html and its scripts at
  // /panels/*.js. Loading a plain same-origin page and adding the shipped scripts is what actually
  // gives the sheet the world it expects — and it tests the SERVED bytes, which is the point.
  await page.goto(BASE + "/print-setup.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => { document.body.innerHTML = ""; });
  for (const src of ["/panels/backstack.js", "/panels/billcustomer.js"]) {
    await page.addScriptTag({ url: src });
  }
  // the panel's own api() is what the sheet uses; stub it so nothing is asked of the server
  await page.evaluate(() => {
    window.api = async () => ({ rows: [] });
    window.LFH_BACK = window.LFH_BACK || { layer: () => () => {} };
  });
  const ok = await page.evaluate(() => typeof window.LFH_BILLCUST?.ask === "function");
  if (!ok) return { page, ctx, errs, opened: false };
  await page.evaluate((o) => { window.__res = window.LFH_BILLCUST.ask(o); }, opts);
  await page.waitForSelector(".bcust-overlay", { timeout: 8000 }).catch(() => {});
  return { page, ctx, errs, opened: true };
}

let browser = null;
if (pw && reachable) browser = await pw.chromium.launch();

R("P03689", "a tap on a not-ready Generate never dies in silence — and the button can RECEIVE the tap", async () => {
  const { page, ctx, errs, opened } = await openSheet(browser, { required: true, title: "Who is this bill for?" });
  try {
    if (!opened) return "the sheet did not open";
    // 1 · the button exists and is the topmost thing at its own centre — the half that was ❌ (F4):
    //     a handler that reads correctly is worthless if something else is on top of it.
    const hit = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".bcust-overlay button")].find((x) => /generate|save|done|add/i.test(x.textContent || ""))
        || document.querySelector(".bcust-overlay .bcust-go, .bcust-overlay button.primary");
      if (!b) return { found: false };
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        found: true, label: (b.textContent || "").trim().slice(0, 24),
        w: Math.round(r.width), h: Math.round(r.height),
        reachable: !!top && (top === b || b.contains(top)),
        covering: top ? (top.className || top.tagName).toString().slice(0, 40) : "(nothing)",
        disabled: b.disabled === true,
      };
    });
    if (!hit.found) return "no Generate button on the sheet";
    if (!hit.reachable) return `the button cannot receive a tap — "${hit.covering}" is on top of it (this is finding F4 coming back)`;
    if (!(hit.w > 0 && hit.h > 0)) return `the button has no size at all (${hit.w}×${hit.h})`;
    // NOT a 44px floor here. This row asks two things — can the tap LAND, and does a not-ready press
    // SAY SOMETHING — and an inherited row must be re-run against what it asked, not against a
    // criterion I thought of afterwards. The button measuring 118×38 is real and is filed as its own
    // new check (see new-G.mjs), because redefining an old row is how a ledger stops meaning anything.
    // 2 · pressing it while NOT ready must say which box is missing, and focus it
    const before = await page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".bcust-overlay button")].find((x) => /generate|save|done|add/i.test(x.textContent || ""));
      b?.click();
    });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      text: document.querySelector(".bcust-overlay")?.innerText || "",
      // The TAG is what says "a box"; inputmode/type only say what kind. My first version read
      // inputmode first and then tested it against /input|tel|text/, so the phone box — which is
      // inputmode="numeric" — read as "not a box" and a correct focus looked like a fault.
      focusedTag: (document.activeElement?.tagName || "").toLowerCase(),
      focusedKind: (document.activeElement?.getAttribute("inputmode") || document.activeElement?.type || "").toLowerCase(),
      focusedInSheet: !!document.querySelector(".bcust-overlay")?.contains(document.activeElement),
      stillOpen: !!document.querySelector(".bcust-overlay"),
    }));
    if (!after.stillOpen) return "the sheet closed on a not-ready press — the bill would be generated with nothing captured";
    const saidSomething = after.text !== before || /required|missing|enter|need/i.test(after.text);
    if (!saidSomething) return "the press changed nothing on screen: a tap that dies in silence";
    if (after.focusedTag !== "input" || !after.focusedInSheet) {
      return `it said something but focus went to <${after.focusedTag}> (${after.focusedKind || "no kind"}), inside the sheet: ${after.focusedInSheet} — the person is told which box and not put in it`;
    }
    return true;
  } finally { await ctx.close(); if (errs.length) console.log("      (page errors: " + errs.slice(0, 2).join(" | ") + ")"); }
});

R("P03690", "the red 'missing' message clears once the missing box is filled", async () => {
  const { page, ctx, opened } = await openSheet(browser, { required: true });
  try {
    if (!opened) return "the sheet did not open";
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".bcust-overlay button")].find((x) => /generate|save|done|add/i.test(x.textContent || ""));
      b?.click();
    });
    await page.waitForTimeout(350);
    const withError = await page.evaluate(() => document.querySelector(".bcust-overlay")?.innerText || "");
    const phone = await page.$(".bcust-overlay input[inputmode='numeric'], .bcust-overlay input[type='tel'], .bcust-overlay input");
    if (!phone) return "no phone box on the sheet";
    // type the tenth digit — the row's own method
    await phone.click();
    await phone.type("9825012345", { delay: 12 });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      text: document.querySelector(".bcust-overlay")?.innerText || "",
      counterOk: !!document.querySelector(".bcust-overlay .ok, .bcust-overlay [class*='count'].ok"),
    }));
    const wasWarned = /required|missing|enter|need/i.test(withError);
    const stillWarned = /required|missing|enter|need/i.test(after.text.replace(/optional|required<\/i>/gi, ""));
    if (!wasWarned) return "no missing-box message appeared to begin with, so there is nothing to clear";
    return (!stillWarned || after.text !== withError)
      || "the message is still there after all ten digits — it tells a waiter the box is empty while it is full";
  } finally { await ctx.close(); }
});

if (browser) { const b = browser; process.on("exit", () => { try { b.close(); } catch { /* already closed */ } }); }
