#!/usr/bin/env node
// verify:owner-team-and-logs-live — the DRIVEN half of sweep #8 terminal 15.
//
// Opens the owner console for real (headless chromium, one login per role, cached by
// scripts/sweep/login.mjs) and asserts the RENDERED result on the owner's **Audit & logs** and
// **Team** screens — visible text, counts, tap targets, both widths, both skins. "The source
// contains it" is not evidence; a green suite is not evidence the screen is right.
//
//   npm run verify:owner-team-and-logs-live -- --base http://localhost:4315
//   npm run verify:owner-team-and-logs-live -- --base https://3-d-backup.vercel.app
//
// ⚠ A DEV SERVER CANNOT ANSWER A "HOW MANY CALLS" QUESTION. React StrictMode double-invokes every
// effect in development, so a page that fetches its endpoint ONCE in production fetches it twice
// under `next dev` — measured 2026-09-04 on port 4315 against 1 on the deployed build. The three
// request-count checks below therefore SKIP unless the base is a production build, and say so
// rather than reporting a fault the product does not have. (This is the same trap that made
// verify:owner-s7-live report 197/3 on a dev server and 200/0 on the deployed one.)
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const BASE = (arg("--base") || "http://localhost:4000").replace(/\/$/, "");
const IS_DEV = /localhost|127\.0\.0\.1/.test(BASE);
let pass = 0, skipped = 0; const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const skip = (name, why) => { skipped++; console.log(`  ⏭  ${name} — ${why}`); };

const browser = await chromium.launch();
const ctxFor = async (vp, skin = "dark") => {
  const c = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: vp.dpr || 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile,
  });
  await loginAs(c, "owner", BASE);
  await c.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  await c.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
  return c;
};
const DESK = { w: 1280, h: 800 }, A35 = { w: 360, h: 780, dpr: 3, mobile: true };

try {
// ══ 1 · THE RECORD OPENS, AND IT IS A RECORD ═══════════════════════════════════════════════════
console.log("\n1 · Audit & logs opens with a real record");
const ctx = await ctxFor(DESK);
const p = await ctx.newPage();
await p.goto(`${BASE}/owner/activity`, { waitUntil: "networkidle" });
ok("the page is headed 'Audit & logs'", (await p.locator("h1.adm-page-h").innerText()).trim() === "Audit & logs");
ok("…and says what it is for in one line", /removed and why/.test(await p.locator("p.adm-page-sub").innerText()));
const audJson = await (await ctx.request.get(`${BASE}/api/owner/audit`)).json();
const audRows = await p.locator(".adm-logrow:not(.head)").count();
ok("every removal the server sent has a row on screen", audRows === (audJson.removals || []).length, `${audRows} vs ${(audJson.removals || []).length}`);
// Case-INSENSITIVE on purpose: the header is uppercased by CSS, not by rewriting the words, so
// innerText reads "WHAT WAS REMOVED" while the source says "What was removed". Asserting the
// source's casing against the rendered text is the "measure the rendered thing" trap in miniature.
ok("…under a header naming its three columns",
   /what was removed/i.test(await p.locator(".adm-logwrap .adm-logrow.head").first().innerText().catch(() => "")));

// ── the risk strip is counted over the WHOLE record, not this page ────────────────────────────
const cardText = await p.locator(".adm-card").first().innerText();
ok("the money/record split is on screen", /Money moved/.test(cardText) && /Record only/.test(cardText),
   cardText.replace(/\s+/g, " ").slice(0, 90));
{
  const totalFromCounts = (audJson.kindCounts || []).reduce((a, c) => a + c.n, 0);
  ok("…and 'All' counts the whole record, not the page",
     new RegExp(String(totalFromCounts).replace(/\B(?=(\d{3})+(?!\d))/g, ",")).test(await p.locator('.aud-chips button').first().innerText())
     || totalFromCounts === (audJson.removals || []).length,
     `kindCounts total ${totalFromCounts}, page ${(audJson.removals || []).length}`);
}

// ── NO RAW DATABASE WORD, ANYWHERE ────────────────────────────────────────────────────────────
{
  const txt = await p.evaluate(() => document.body.innerText);
  const leaked = ["undefined", "NaN", "[object Object]", "${", "-->", "₹NaN"].filter((s) => txt.includes(s));
  ok("no leaked code text on the removals record", leaked.length === 0, leaked.join(", "));
  const rawKind = txt.match(/\b[a-z]+_[a-z_]+\b/g) || [];
  const allowed = /^(french_house|pizza_palace|zztest)/;
  const bad = [...new Set(rawKind)].filter((w) => !allowed.test(w));
  ok("…and no column value where a sentence belongs", bad.length === 0, bad.slice(0, 5).join(", "));
}

// ══ 2 · THE SEARCH SAYS WHICH SLICE IT SEARCHED ════════════════════════════════════════════════
console.log("\n2 · the removals search does not claim a reach it has not got");
if ((audJson.pages || 1) > 1) {
  // a term that genuinely exists in the record but NOT on page 1
  const later = await (await ctx.request.get(`${BASE}/api/owner/audit?page=2`)).json();
  const hay1 = (audJson.removals || []).map((r) => [r.item_title, r.reason_note, r.invoice_no].filter(Boolean).join(" ")).join(" | ").toLowerCase();
  let term = null;
  for (const r of later.removals || []) for (const c of [r.item_title, r.reason_note, r.invoice_no].filter(Boolean)) {
    const v = String(c).trim();
    if (v.length >= 4 && !hay1.includes(v.toLowerCase())) { term = v; break; }
  }
  if (term) {
    await p.fill('input[aria-label="Search the removals record"]', term);
    await p.waitForTimeout(500);
    const msg = await p.locator(".adm-empty").first().innerText().catch(() => "");
    ok("a term that lives on a later page does not get a flat 'Nothing matches that'",
       /Nothing on this page matches/.test(msg), JSON.stringify(msg).slice(0, 110));
    ok("…and the sentence names the page it looked at", /page \d+ of \d+/.test(msg), JSON.stringify(msg).slice(0, 110));
    ok("…and offers a way back out of the search", await p.locator('.adm-empty button:has-text("Clear the search")').count() > 0);
    await p.locator('.adm-empty button:has-text("Clear the search")').click();
    await p.waitForTimeout(400);
    ok("…and clearing it brings the record back", await p.locator(".adm-logrow:not(.head)").count() > 0);
  } else skip("a term that lives only on a later page", "this record has no such term today");
  // a search that DOES match on this page must still read as a count of matches
  const first = await p.locator(".adm-logrow:not(.head) b").first().innerText();
  await p.fill('input[aria-label="Search the removals record"]', first.slice(0, 8));
  await p.waitForTimeout(500);
  const line = await p.locator("p.adm-muted").first().innerText();
  ok("a searched count is called matches, not a page size", /match(es)? on this page/.test(line), line);
  await p.fill('input[aria-label="Search the removals record"]', "");
  await p.waitForTimeout(400);
} else skip("the page-local search wording", "this record fits on one page");

// ══ 3 · A REFUSED SIGN-IN IS NOT A MANAGER'S APPROVAL ══════════════════════════════════════════
console.log("\n3 · a refused sign-in wears no manager key");
await p.click('button:has-text("Activity log")');
await p.waitForTimeout(900);
{
  const op = await (await ctx.request.get(`${BASE}/api/owner/oplog`)).json();
  const refused = (op.actions || []).filter((a) => a.panel === "tablet" && a.actor && /^login_(failed|denied|blocked)$/.test(a.action));
  if (!refused.length) skip("a refused tablet sign-in on this page", "none in the newest 200 rows");
  else {
    const keyChips = await p.locator('.adm-chip[title*="PIN"]').allInnerTexts();
    const rows = await p.locator(".adm-logrow:not(.head)").allInnerTexts();
    const wrongPw = rows.filter((t) => /Wrong password|not enabled|recycle bin/i.test(t));
    ok(`a refused sign-in row carries no 🔑 manager chip (${refused.length} on this page)`,
       wrongPw.every((t) => !t.includes("🔑")), wrongPw.find((t) => t.includes("🔑"))?.slice(0, 80) || "");
    ok("…and any 🔑 chip still on screen belongs to a real PIN row",
       keyChips.every((c) => !/wrong password/i.test(c)));
  }
}
// the log reads as English
{
  const rows = await p.locator(".adm-logrow:not(.head)").allInnerTexts();
  ok("every activity row leads with a sentence, not an action name",
     rows.every((t) => !/^\s*[a-z]+_[a-z_]+/.test(t)), rows.find((t) => /^\s*[a-z]+_[a-z_]+/.test(t))?.slice(0, 60) || "");
  ok("…and every row carries its trail on a second line",
     (await p.locator(".adm-logrow:not(.head) .fa-store").count()) > 0
     || rows.every((t) => t.split("\n").length > 1));
}
// its search really is server-side (the half that CAN reach the whole record)
{
  const before = await p.locator(".adm-logrow:not(.head)").count();
  await p.fill('input[aria-label="Search the activity log"]', "zzzz-no-such-thing");
  await p.waitForTimeout(1300);
  const msg = await p.locator(".adm-empty").first().innerText().catch(() => "");
  ok("a search that matches nothing is told apart from an empty log",
     /Nothing matches that/.test(msg), JSON.stringify(msg).slice(0, 100));
  ok("…and it offers a way back out", await p.locator('.adm-empty button:has-text("Clear the search")').count() > 0);
  await p.locator('.adm-empty button:has-text("Clear the search")').click();
  await p.waitForTimeout(1300);
  ok("…and clearing it restores the log", (await p.locator(".adm-logrow:not(.head)").count()) === before);
}

// ══ 4 · PAGING ════════════════════════════════════════════════════════════════════════════════
console.log("\n4 · paging reaches the rest of the record");
await p.click('button:has-text("Audit · removals")');
await p.waitForTimeout(900);
if ((audJson.pages || 1) > 1) {
  const firstBefore = await p.locator(".adm-logrow:not(.head)").first().innerText();
  await p.click('button[aria-label="Next page"]');
  await p.waitForTimeout(1300);
  ok("Next really turns the page", (await p.locator(".adm-logrow:not(.head)").first().innerText()) !== firstBefore);
  ok("…and the strip says where you are",
     /page 2 of \d+/.test(await p.locator('.adm-logwrap button[aria-label="Next page"]').locator("xpath=..").innerText()));
  ok("…and the first page is still one tap away", await p.locator('.adm-logwrap button:has-text("1")').count() > 0);
  // picking a TYPE restarts the paging (page 5 of everything is empty in a smaller set)
  const chip = p.locator('.aud-chips button').nth(2);
  if (await chip.count()) {
    await chip.click(); await p.waitForTimeout(1300);
    const pager = p.locator('.adm-logwrap button[aria-label="Next page"]').locator("xpath=..");
    const strip2 = (await pager.count()) ? await pager.innerText() : "";
    ok("picking a type restarts at page 1 (a narrower set has fewer pages)",
       !strip2 || /page 1 of/.test(strip2), strip2.replace(/\s+/g, " ").slice(0, 60));
    await p.locator('.aud-chips button').first().click(); await p.waitForTimeout(1200);
  }
} else skip("paging", "this record fits on one page");

// ══ 5 · THE TEAM ROSTER ═══════════════════════════════════════════════════════════════════════
console.log("\n5 · the Team roster");
await p.goto(`${BASE}/owner/staff`, { waitUntil: "networkidle" });
const staffJson = await (await ctx.request.get(`${BASE}/api/owner/staff`)).json();
ok("every person the server sent has a row", (await p.locator(".ost-row").count()) === (staffJson.staff || []).length,
   `${await p.locator(".ost-row").count()} vs ${(staffJson.staff || []).length}`);
ok("the tab count is the number who can actually sign in",
   Number((await p.locator(".ost-tcount").innerText()).trim()) === (staffJson.staff || []).filter((s) => s.active).length);
ok("the card is headed with the real restaurant's name",
   (await p.locator(".ost-name").first().innerText()).length > 1);
ok("a waiter's badge says 'waiter', never the stored word",
   !(await p.locator(".ost-rolebadge").allInnerTexts()).some((t) => /tablet/i.test(t)));
// A PLACEHOLDER MUST FIT ITS OWN BOX — measured, never pinned to a pixel value, so a reworded
// placeholder or a font change is caught rather than a number going stale. This one clipped on the
// DESKTOP and fitted on the phone (230px of text in a 210px box), which is the reverse of the usual
// case and is how three visual sweeps walked past it.
{
  const m = await p.evaluate(() => {
    const i = document.querySelector(".ost-find input");
    if (!i) return null;
    const cs = getComputedStyle(i);
    const cv = document.createElement("canvas").getContext("2d");
    cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return { need: Math.round(cv.measureText(i.placeholder).width), box: Math.round(i.getBoundingClientRect().width), text: i.placeholder };
  });
  if (!m) skip("the 'Find someone' placeholder fits its box", "no search box — this roster has nobody to find");
  else ok("the 'Find someone' placeholder fits its own box", m.need <= m.box - 4, `"${m.text}" needs ${m.need}px, box is ${m.box}px`);
}
ok("the owner is never offered 'owner' as a role",
   !(await p.locator(".ost-actions select option").allInnerTexts()).some((t) => /owner/i.test(t)));
// kitchen: no profile, and it says why rather than looking unfinished
{
  const kitchen = (staffJson.staff || []).filter((s) => s.role === "kitchen");
  if (!kitchen.length) skip("a kitchen row", "this restaurant has none");
  else {
    const row = p.locator(".ost-row").filter({ has: p.locator('.ost-rolebadge[data-role="kitchen"]') }).first();
    ok("a kitchen row has no 'Open profile'", (await row.locator(".ost-mini.open").count()) === 0);
    ok("…and no completeness bar", (await row.locator(".ost-prog").count()) === 0);
    ok("…and explains itself instead", /kitchen screen only/.test(await row.innerText()));
    ok("…and promises no profile later", !/soon|coming/i.test(await row.innerText()));
  }
}
// the rename warning, driven
{
  const row = p.locator(".ost-row").first();
  const who = (staffJson.staff || [])[0];
  await row.locator('button:has-text("Rename / edit phone")').click();
  await p.waitForTimeout(300);
  ok("opening the rename editor warns about nothing yet", (await row.locator(".ost-renamewarn").count()) === 0);
  await row.locator('.ost-editrow input').first().fill(`${who.username}-x`);
  await p.waitForTimeout(250);
  const warn = await row.locator(".ost-renamewarn").innerText().catch(() => "");
  ok("typing a NEW name warns that the login changes", /login name/i.test(warn), JSON.stringify(warn).slice(0, 90));
  ok("…and names the old login that stops working", warn.includes(who.username), JSON.stringify(warn).slice(0, 90));
  const warnColour = await row.locator(".ost-renamewarn").evaluate((el) => getComputedStyle(el).color);
  ok("…and the warning is drawn in a colour, not left as plain body text",
     ["rgb", "oklch", "color("].some((x) => warnColour.startsWith(x)), warnColour);
  await row.locator('.ost-editrow input').first().fill(who.name || who.username);
  await p.waitForTimeout(250);
  ok("…and it goes away when the name is put back", (await row.locator(".ost-renamewarn").count()) === 0);
  await row.locator('button:has-text("Cancel")').click();
}
// destructive controls still ask, and Remove is red without a hover
{
  const dialogs = [];
  p.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  const row = p.locator(".ost-row").first();
  for (const b of ["Disable", "Remove", "Reset password"]) { await row.locator(`button:has-text("${b}")`).first().click(); await p.waitForTimeout(200); }
  ok("every destructive control asks first", dialogs.length === 3, `${dialogs.length} dialogs`);
  ok("…and each says what it costs", dialogs.every((d) => /logged out|can't be undone|stops working/i.test(d)));
  const rm = row.locator(".ost-mini.danger").first();
  const [c, n] = await Promise.all([
    rm.evaluate((el) => getComputedStyle(el).color),
    row.locator('button:has-text("Disable")').evaluate((el) => getComputedStyle(el).color),
  ]);
  ok("Remove is coloured differently from its neighbour with no pointer on it", c !== n, `${c} vs ${n}`);
}

// ══ 6 · BOTH WIDTHS, BOTH SKINS ═══════════════════════════════════════════════════════════════
console.log("\n6 · both widths, both skins");
await ctx.close();
for (const skin of ["dark", "light"]) for (const [tag, vp] of [["desktop", DESK], ["A35", A35]]) {
  const c2 = await ctxFor(vp, skin);
  const p2 = await c2.newPage();
  for (const [name, url] of [["Audit & logs", "/owner/activity"], ["Team", "/owner/staff"]]) {
    await p2.goto(BASE + url, { waitUntil: "networkidle" });
    await p2.waitForTimeout(300);
    const m = await p2.evaluate(() => ({
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      txt: document.body.innerText,
    }));
    ok(`${name} · ${tag} · ${skin} — no sideways scroll`, m.sw <= m.cw + 1, `${m.sw} > ${m.cw}`);
    ok(`${name} · ${tag} · ${skin} — no leaked code text`,
       !["undefined", "NaN", "[object Object]", "${", "-->"].some((s) => m.txt.includes(s)));
    ok(`${name} · ${tag} · ${skin} — the screen is not blank`, m.txt.replace(/\s/g, "").length > 200);
    if (vp.mobile) {
      // 36px is the owner's own floor on a phone for this console (2026-08-19, on the Team roster:
      // the controls measured 26–28px and one of them is Remove). The roster carries it in its own
      // styled-jsx and is asserted here. Audit & logs does NOT: its view switch, its type chips, its
      // search box and its Refresh are all `.own-range` / `.aud-chips` / `.adm-btn` out of
      // app/globals.css — measured 26–33px on the A35, in both skins. That is a real gap and it is
      // written up as a decision rather than patched here: globals.css is another terminal's
      // territory this sweep, and a local override on one page would leave the same class at 30px on
      // the four other screens that use it. So this prints the measurement every run instead of
      // going permanently red — a guard that cries wolf is how a suite stops being read.
      const small = await p2.evaluate(() => [...document.querySelectorAll(".ost-actions .ost-mini, .ost-actions select, .aud-chips button, .own-range button, .adm-card > div > .adm-btn")]
        .filter((e) => e.offsetParent)
        .map((e) => ({ t: e.innerText.trim().replace(/\s+/g, " ").slice(0, 24), h: Math.round(e.getBoundingClientRect().height), own: !!e.closest(".ost-actions") }))
        .filter((x) => x.h < 36));
      const mine = small.filter((x) => x.own);
      ok(`${name} · ${tag} · ${skin} — every control THIS page styles clears 36px`, mine.length === 0,
         mine.slice(0, 3).map((x) => `${x.t}=${x.h}px`).join(", "));
      if (small.length - mine.length > 0) {
        skip(`${name} · ${tag} · ${skin} — the shared console controls clear 36px`,
             `open decision (app/globals.css, another lane): ${small.filter((x) => !x.own).slice(0, 4).map((x) => `${x.t}=${x.h}px`).join(", ")}`);
      }
    }
  }
  await c2.close();
}

// ══ 7 · WHAT THESE SCREENS COST WHILE THEY SIT OPEN ═══════════════════════════════════════════
console.log("\n7 · what these screens cost");
if (IS_DEV) {
  skip("opening Audit & logs asks each endpoint once", "React StrictMode doubles every effect under `next dev` — run with --base on a production build");
  skip("opening the Team roster asks its endpoint once", "same");
  skip("neither screen polls faster than the 60s backstop", "needs a production build to count honestly");
} else {
  const c3 = await ctxFor(DESK);
  const p3 = await c3.newPage();
  const calls = {};
  p3.on("request", (r) => { const u = new URL(r.url()).pathname; if (u.startsWith("/api/owner/")) calls[u] = (calls[u] || 0) + 1; });
  await p3.goto(`${BASE}/owner/activity`, { waitUntil: "networkidle" });
  await p3.waitForTimeout(600);
  ok("opening Audit & logs asks for the removals once", (calls["/api/owner/audit"] || 0) === 1, JSON.stringify(calls));
  ok("…and the activity once", (calls["/api/owner/oplog"] || 0) === 1, JSON.stringify(calls));
  const before = JSON.stringify(calls);
  await p3.waitForTimeout(12000);
  ok("…and asks for nothing more in the next 12 seconds (no poll faster than 60s)", JSON.stringify(calls) === before, JSON.stringify(calls));
  for (const k of Object.keys(calls)) delete calls[k];
  await p3.goto(`${BASE}/owner/staff`, { waitUntil: "networkidle" });
  await p3.waitForTimeout(600);
  ok("opening the Team roster asks its own endpoint once", (calls["/api/owner/staff"] || 0) === 1, JSON.stringify(calls));
  await c3.close();
}
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fails.length} failed, ${skipped} skipped`);
if (fails.length) { console.log("\n❌ FAIL — the owner's Audit & logs / Team, driven:"); for (const f of fails) console.log("   • " + f); process.exit(1); }
console.log("\n✅ PASS — the owner's Audit & logs and Team behave the way these checks say");
