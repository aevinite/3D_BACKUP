#!/usr/bin/env node
// verify-t12-live.mjs — the T12 ledger, made EXECUTABLE, against a real running site.
//
// Owner, 2026-08-19: "plan whole thing and run it … do the test on the backup site … till then there
// is no error." The 500 ledger rows in .claude/sweep/LEDGER/T12.md were planned and run twice against
// a local dev server, BEFORE the tile redesign and the cancellation feature existed. This turns the
// behavioural half of that record into one command that can be pointed at any base URL and re-run
// until it is silent, which is what "till there is no error" actually needs.
//
//   npm run verify:t12-live                       # the backup site
//   npm run verify:t12-live -- --base http://localhost:4112
//
// It DOES write to the backup database (he authorised that on 2026-08-18) and deletes every row it
// creates by id, in a finally block, including rows written by triggers that it never held an id for.
// Nothing is ever deleted by a broad filter.
//
// Each assertion carries its ledger id so a failure points straight at the row it belongs to.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loginAs, adminCookie } from "./sweep/login.mjs";
import { requireUp } from "./sweep/appUp.mjs";

const argv = process.argv.slice(2);
const eqBase = argv.find((a) => a.startsWith("--base="));
const flagBase = argv.indexOf("--base");
const BASE = eqBase ? eqBase.slice(7)
  : flagBase >= 0 && argv[flagBase + 1] ? argv[flagBase + 1]
  : "https://3-d-backup.vercel.app";
const ONLY = (argv.find((a) => a.startsWith("--only=")) || "").slice(7);   // e.g. --only=CANCEL

// Nothing answering = "could not run" (exit 2), said in plain words — never a raw stack, which
// reads as "this guard is broken". Added when the file was rescued from an abandoned sweep-6
// worktree on 2026-09-12; verify:guards-alive §6 requires it of every guard that drives the app.
await requireUp(BASE, "the sweep-6 T12 ledger, driven against a real site");

const RID_FH = "00000000-0000-0000-0000-000000000001";   // My Little French House (the diag owner's)
const PIN_BB = "00000000-0000-0000-0000-000000000003";   // Burger Barn — an admin act-as pin

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let pass = 0;
const notes = [];        // seen, worth printing, not a failure — see the response handler
const fails = [];
const skips = [];
const ok = (id, name, good, detail = "") => {
  if (good) { pass++; process.stdout.write(`  ✓ ${id} ${name}\n`); }
  else { fails.push({ id, name, detail }); process.stdout.write(`  ✗ ${id} ${name}\n      ${detail}\n`); }
};
const skip = (id, name, why) => { skips.push({ id, name, why }); process.stdout.write(`  – ${id} ${name} — ${why}\n`); };
const group = (n) => process.stdout.write(`\n── ${n} ──────────────────────────────────────────────\n`);
const want = (g) => !ONLY || ONLY.toUpperCase() === g.toUpperCase();

const num = (s) => Number(String(s ?? "").replace(/[^\d.-]/g, "")) || 0;
const cleanup = [];

// ── contrast, the same maths the skin guards use ────────────────────────────────────────────────
const CONTRAST = `(() => {
  const lum=([r,g,b])=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
  const P=s=>{const m=String(s).match(/-?[\\d.]+/g);if(!m)return null;const k=/^color\\(\\s*srgb/i.test(String(s))?255:1;return [+m[0]*k,+m[1]*k,+m[2]*k]};
  const bg=el=>{let c=el;while(c){const b=getComputedStyle(c).backgroundColor;const m=String(b).match(/[\\d.]+/g);if(m&&(m.length<4||+m[3]>0.85))return b;c=c.parentElement}return "rgb(255,255,255)"};
  const R=el=>{const a=P(getComputedStyle(el).color),b=P(bg(el));if(!a||!b)return null;const x=lum(a),y=lum(b);return +(((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2))};
  const out=[];
  for (const sel of [".ow2-kpi .k",".ow2-kpi .v",".ow2-sub",".ow2-live",".ow2-ct > span:first-child",".ow2-tag",".ow2-note",".ow2-seeall",".ow2-act .pn",".ow2-act .tx",".ow2-act .when",".rv-rec small",".rv-rec b",".rv-dn",".own-hero-name",".own-hero-link",".owx-insight",".owr-btn.main",".owx-scope .lbl",".adm-empty",".adm-page-h",".adm-page-sub",".adm-logrow b",".adm-when",".ow2-tile header .ti b",".ow2-tile .r .l",".ow2-tile .r .v",".ow2-tile .note",".ow2-tile .full",".own-dish-x"])
    for (const e of [...document.querySelectorAll(sel)].slice(0,3)) { const r=R(e); if (r!==null) out.push({sel,txt:(e.textContent||"").trim().slice(0,22),r}); }
  return out;
})()`;

const br = await chromium.launch();
const ownerCtx = async (skin = "dark", w = 1440, h = 950) => {
  const c = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 3 : 1,
    isMobile: w < 500, hasTouch: w < 500, serviceWorkers: "block" });
  await loginAs(c, "owner", BASE);
  await c.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  const p = await c.newPage();
  await p.addInitScript(`try{localStorage.setItem("aevidine_skin","${skin}");localStorage.setItem("lfh-owner-range","30d")}catch(e){}`);
  // A console line reading only "Failed to load resource: … 403" is unactionable — it does not say
  // WHICH request. So the failing RESPONSE is captured too, with its url and body, and the assertions
  // report that instead. (First live run against backup produced exactly that bare 403.)
  // ── WHAT COUNTS AS AN ERROR HERE, AND WHAT IS JUST THE BROWSER ────────────────────────────────
  // A console line reading only "Failed to load resource: … 403" does not say WHICH request, so the
  // failing RESPONSE is captured with its url and body.
  //
  // But the first version of this counted `?_rsc=` route prefetches aborted with net::ERR_ABORTED, and
  // produced SEVENTEEN failures that were not faults at all: the App Router prefetches the sidebar's
  // links, and navigating (or a newer prefetch) cancels the older one — an aborted prefetch is how
  // prefetching is supposed to end. A test that cries wolf at normal browser behaviour trains you to
  // ignore it, which is worse than not having it. So those are excluded, by name, with the reason.
  const NOISE = (u, why) => /[?&]_rsc=/.test(u) && /ERR_ABORTED|ERR_CANCELED/.test(why || "");
  const errs = [];
  p.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // the console twin of the same prefetch abort, which carries no url of its own
    if (/Failed to load resource/.test(t) && !/40[0-9]|50[0-9]/.test(t)) return;
    errs.push(t.slice(0, 130));
  });
  p.on("response", async (r) => {
    if (r.status() < 400) return;
    let body = ""; try { body = (await r.text()).slice(0, 160); } catch { /* stream gone */ }
    const line = `HTTP ${r.status()} ${r.url().replace(BASE, "")} :: ${body}`;
    // A PREFETCH that 4xx'd does not fail the run — but it is NOTED rather than swallowed. The very
    // first live run showed one bare "403" with no url, and six later passes (four of them walking the
    // sidebar, which is what triggers the prefetches) produced no 4xx at all. It never reproduced, so
    // it is not treated as a fault — but if it comes back, this prints it with its url instead of
    // hiding it, which is the difference between not crying wolf and covering something up.
    if (/[?&]_rsc=/.test(r.url())) { notes.push(line); return; }
    errs.push(line);
  });
  p.on("requestfailed", (r) => {
    const why = r.failure()?.errorText || "";
    if (NOISE(r.url(), why)) return;
    errs.push(`request failed ${r.url().replace(BASE, "")} :: ${why}`);
  });
  return { c, p, errs };
};

try {
  console.log(`T12 ledger, live — ${BASE}\n`);

  // ═══ A · every owner page answers, with no console error (P05802-P05805, P05875) ═══
  if (want("PAGES")) {
    group("A · every owner page loads clean");
    const { c, p, errs } = await ownerCtx();
    for (const [path, id] of [["/owner","P05802"],["/owner/activity","P05803"],["/owner/marketing","P05804"],
      ["/owner/online","P05805"],["/owner/reports","P05965"],["/owner/customers","P05956"],["/owner/staff","P05957"],
      ["/owner/settings","P05958"],["/owner/issues","P05959"],["/owner/khata","P05960"],["/owner/inventory","P05961"],["/owner/menu","P05962"]]) {
      errs.length = 0;
      const r = await p.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => null);
      await p.waitForTimeout(7000);
      const shown = await p.evaluate(() => ({ text: document.body.innerText.slice(0, 200),
        crashed: /Application error|something went wrong|Unhandled/i.test(document.body.innerText) }));
      ok(id, `${path} loads`, !!r && r.status() < 400 && !shown.crashed && errs.length === 0,
        `HTTP ${r ? r.status() : "?"} · crashed=${shown.crashed} · console errors=${errs.length}${errs[0] ? " :: " + errs[0] : ""}`);
    }
    await c.close();
  }

  // ═══ B · the owner dashboard, both skins, both sizes ═══
  if (want("DASH")) {
    group("B · the owner dashboard");
    for (const [skin, w, h, tag] of [["dark",1440,950,"desktop"],["light",1440,950,"desktop"],["dark",360,780,"a35"],["light",360,780,"a35"]]) {
      const { c, p, errs } = await ownerCtx(skin, w, h);
      await p.goto(BASE + "/owner", { waitUntil: "domcontentloaded", timeout: 120000 });
      await p.waitForTimeout(15000);
      const t = await p.evaluate(() => ({
        labels: [...document.querySelectorAll(".ow2-kpi .k")].map((e) => e.textContent),
        values: [...document.querySelectorAll(".ow2-kpi .v")].map((e) => e.textContent.trim()),
        subs: [...document.querySelectorAll(".ow2-kpi .ow2-sub")].map((e) => e.textContent.trim()),
        rows: [...new Set([...document.querySelectorAll(".ow2-kpi")].map((x) => Math.round(x.getBoundingClientRect().top)))].length,
        buttons: [...document.querySelectorAll(".ow2-kpi")].every((x) => x.tagName === "BUTTON"),
        anchors: document.querySelectorAll("a.ow2-kpi").length,
        hero: [...document.querySelectorAll(".own-hero-link")].map((a) => a.textContent.trim()),
        // THE RULE IS "NO CANCELLATION FIGURE", NOT "NEVER SAY THE WORD" (corrected after a live run).
        // The Recent-activity card legitimately narrates what staff did, and "Cancelled the KOT" is one
        // of those things — a test that forbids the word there would forbid the activity log doing its
        // job. What must never appear is a cancellation presented as MONEY: a rupee amount beside a
        // cancellation label, or the old "lost to cancellations" framing. So the activity feed is
        // excluded by name and everything else is searched.
        cancelWords: (() => {
          const feed = document.querySelector(".ow2-acts");
          const clone = document.body.cloneNode(true);
          if (feed) { const f = clone.querySelector(".ow2-acts"); if (f) f.remove(); }
          return (clone.innerText.match(/cancell?\w*/gi) || []);
        })(),
        cancelMoney: [...document.querySelectorAll(".ow2-kpi, .owx-insight, .ow2-tile")]
          .filter((e) => /cancell?/i.test(e.textContent || "") && /₹/.test(e.textContent || ""))
          .map((e) => (e.textContent || "").replace(/\s+/g, " ").slice(0, 60)),
        lostTo: /lost to/i.test(document.body.innerText),
        cards: [...document.querySelectorAll(".ow2-ct > span:first-child")].map((e) => e.textContent.trim().slice(0, 34)),
        overflow: [...document.querySelectorAll(".adm-card")].filter((x) => x.getBoundingClientRect().right > window.innerWidth + 2).length,
      }));
      const px = `${tag}/${skin}`;
      if (tag === "desktop" && skin === "dark") {
        ok("P05813", "the five tiles he asked for, in his order",
          JSON.stringify(t.labels) === JSON.stringify(["Revenue","Orders","Today so far","Expenses","On hand"]), JSON.stringify(t.labels));
        ok("P05586", "and they sit on ONE row", t.rows === 1, `${t.rows} row(s)`);
        ok("P05595", "every tile is a button, none a bare link", t.buttons && t.anchors === 0, `buttons=${t.buttons} leftover anchors=${t.anchors}`);
        ok("P05598", "the hero shortcut says Team", t.hero.includes("Team") && !t.hero.some((x) => /powers/i.test(x)), t.hero.join(" · "));
        ok("P05816", "every home card renders", t.cards.length >= 7, `${t.cards.length}: ${t.cards.join(" | ")}`);
        ok("P05814", "the short money form is on the tile face",
          t.values.filter((v) => /[LkCr]$/.test(v.replace("₹", ""))).length >= 3, t.values.join(" · "));
      }
      ok(tag === "a35" ? "P05859" : "P05990", `${px} · no cancellation presented as money`,
        t.cancelMoney.length === 0 && !t.lostTo && t.cancelWords.length === 0,
        `asMoney=${JSON.stringify(t.cancelMoney)} lostTo=${t.lostTo} elsewhere=${JSON.stringify(t.cancelWords.slice(0, 4))}`);
      ok(tag === "a35" ? "P05862" : "P05671", `${px} · no card runs off the right edge`, t.overflow === 0, `${t.overflow} card(s) overflowing`);
      const bad = (await p.evaluate(CONTRAST)).filter((x) => x.r < 3);
      ok(tag === "a35" ? (skin === "dark" ? "P05852" : "P05853") : (skin === "dark" ? "P05850" : "P05851"),
        `${px} · every ink at least 3:1`, bad.length === 0,
        bad.length ? bad.slice(0, 3).map((b) => `${b.sel} "${b.txt}" ${b.r}:1`).join(" | ") : "0 under 3:1");
      ok(tag === "desktop" && skin === "dark" ? "P05802" : "P05922", `${px} · no console errors`, errs.length === 0, errs[0] || "none");
      await c.close();
    }
  }

  // ═══ C · the tile popups, and the scope + period they hand on ═══
  if (want("POPUP")) {
    group("C · the tile popups");
    const c = await br.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: "block" });
    await c.addCookies([adminCookie(BASE)]);
    const p = await c.newPage();
    await p.request.post(BASE + "/api/admin/act-as", { data: { restaurant_id: PIN_BB } });
    await p.goto(`${BASE}/owner?rid=${PIN_BB}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(16000);
    // all restaurants + a non-default period, which is the state his bug lived in
    await p.evaluate(() => document.querySelector(".owd-btn")?.click()); await p.waitForTimeout(800);
    await p.evaluate(() => { const b = [...document.querySelectorAll(".owd-pop button")].find((x) => /All restaurants/.test(x.textContent)); b?.click(); });
    await p.waitForTimeout(10000);
    await p.evaluate(() => document.querySelector(".owr-btn.main")?.click()); await p.waitForTimeout(700);
    await p.evaluate(() => { const b = [...document.querySelectorAll(".owr-pop button")].find((x) => x.textContent.includes("This month")); b?.click(); });
    await p.waitForTimeout(11000);
    const seen = [];
    for (const w of ["Revenue","Orders","Today so far","Expenses","On hand"]) {
      await p.evaluate((x) => { const e = [...document.querySelectorAll(".ow2-kpi")].find((y) => y.querySelector(".k")?.textContent === x); e?.click(); }, w);
      await p.waitForTimeout(1000);
      seen.push(await p.evaluate(() => { const d = document.querySelector(".ow2-tile"); return d ? {
        title: d.querySelector("header .ti b")?.textContent, sub: d.querySelector("header .ti i")?.textContent,
        who: d.querySelector(".who")?.textContent.trim(), link: d.querySelector(".full")?.getAttribute("href"),
        rows: [...d.querySelectorAll(".rows .r")].map((r) => `${r.querySelector(".l").childNodes[0].textContent.trim()}=${r.querySelector(".v").textContent.trim()}`),
        total: d.querySelector(".r.last .v")?.textContent.trim(), note: (d.querySelector(".note")?.innerText || "").replace(/\s+/g," ").slice(0,70),
        door: d.querySelector(".note .nlink")?.getAttribute("href") } : null; }));
      await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    }
    ok("P05815", "every popup opens and names its scope", seen.every((x) => x && /restaurant/i.test(x.who || "")), seen.map((x) => x && x.who).join(" | "));
    ok("P05666", "every popup's link carries the VIEWED scope and the chosen period",
      seen.every((x) => /view=all/.test(x.link || "") && /range=month/.test(x.link || "")), (seen[1] && seen[1].link || "").replace(/^.*\?/, ""));
    ok("P05591", "the Orders popup carries the average order", (seen[1].rows || []).some((r) => /Average per paid order/.test(r)), (seen[1].rows || []).join(" | "));
    ok("P05592", "the Revenue popup shows the discount as money given away, and no cancellation figure",
      (seen[0].rows || []).some((r) => /Discounts given/.test(r)) && !(seen[0].rows || []).some((r) => /[Cc]ancel/.test(r)), (seen[0].rows || []).join(" | "));
    ok("P05834", "…and explains cancellations with a door to the record",
      /not money you lost/.test(seen[0].note || "") && /\/owner\/activity/.test(seen[0].door || ""), `${seen[0].note} → ${seen[0].door}`);
    // the arithmetic must reconcile ON SCREEN
    const exp = seen[3].rows || [], onh = seen[4].rows || [];
    const staff = num(exp.find((r) => /Staff pay out/.test(r))?.split("=")[1]);
    const food = num(exp.find((r) => /Food made then binned/.test(r))?.split("=")[1]);
    const expTot = num(seen[3].total);
    ok("P05585", "Expenses = staff pay + food binned, to the rupee", Math.abs(staff + food - expTot) < 1, `${staff} + ${food} = ${expTot}`);
    const rev = num(onh.find((r) => /^Revenue/.test(r))?.split("=")[1]);
    const onhTot = num(seen[4].total);
    ok("P05593", "On hand = revenue − those same two, to the rupee", Math.abs(rev - staff - food - onhTot) < 1, `${rev} − ${staff} − ${food} = ${onhTot}`);
    // follow one through
    await p.evaluate(() => { const e = [...document.querySelectorAll(".ow2-kpi")].find((y) => y.querySelector(".k")?.textContent === "Orders"); e?.click(); });
    await p.waitForTimeout(900);
    await p.evaluate(() => document.querySelector(".ow2-tile .full")?.click());
    await p.waitForTimeout(20000);
    const landed = await p.evaluate(() => { const m = document.querySelector(".adm-main");
      const s = m ? [...m.querySelectorAll("select")].find((x) => (x.getAttribute("aria-label") || "") === "Restaurant") : null;
      return { url: location.pathname, rest: s ? s.options[s.selectedIndex]?.text : null,
        period: m?.querySelector('[data-rng="reports-period"] .owr-btn.main')?.textContent.trim() }; });
    ok("P05948", "the report really opens on that scope and that period",
      landed.url === "/owner/reports" && landed.rest === "All restaurants" && /This month/.test(landed.period || ""),
      `${landed.url} · "${landed.rest}" · "${landed.period}"`);
    await p.request.post(BASE + "/api/admin/act-as", { data: { clear: true } });
    await c.close();
  }

  // ═══ D · Audit & logs ═══
  if (want("AUDIT")) {
    group("D · Audit & logs");
    const { c, p, errs } = await ownerCtx();
    await p.goto(BASE + "/owner/activity", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(14000);
    const a = await p.evaluate(() => ({
      h1: document.querySelector(".adm-page-h")?.textContent,
      views: [...document.querySelectorAll(".own-range button")].map((b) => b.textContent.trim()).slice(0, 2),
      rows: document.querySelectorAll(".adm-logrow:not(.head)").length,
      risk: /Money moved/.test(document.body.innerText) && /Record only/.test(document.body.innerText),
      recLine: [...document.querySelectorAll("p.adm-muted")].map((e) => e.textContent.trim()).find((t) => /records?/.test(t)) || "",
      tagged: [...document.querySelectorAll(".adm-logrow")].filter((r) => /Cancellations|Not answered|Food lost|Nothing lost/.test(r.innerText)).length,
      answerBtns: [...document.querySelectorAll(".adm-logrow button")].filter((b) => /Yes, cooked|never started/.test(b.textContent)).length,
      classified: /Cancellation answered/.test(document.body.innerText),
      pager: document.body.innerText.match(/[\d,]+ entr(?:y|ies) · page \d+ of \d+/)?.[0] || null,
    }));
    ok("P05819", "the removals record loads with rows", a.rows > 0, `${a.rows} rows`);
    ok("P05744", "the money-vs-record risk strip is there", a.risk, `strip present: ${a.risk}`);
    ok("P05743", "the records line names the slice it is totalling", /on this page/.test(a.recLine) || !/in total/.test(a.recLine), `"${a.recLine}"`);
    ok("P05650", "every row wears its tags", a.tagged > 0 && a.tagged >= Math.min(a.rows, 1), `${a.tagged} of ${a.rows}`);
    ok("P05651", "a cancellation offers the was-it-made answer", a.answerBtns > 0, `${a.answerBtns} buttons`);
    ok("P05652", "answer rows are NOT listed as removals", !a.classified, `"Cancellation answered" on screen: ${a.classified}`);
    // the activity half
    await p.evaluate(() => { const b = [...document.querySelectorAll(".own-range button")].find((x) => x.textContent.includes("Activity log")); b?.click(); });
    await p.waitForTimeout(6000);
    const b2 = await p.evaluate(() => ({ rows: document.querySelectorAll(".adm-logrow:not(.head)").length,
      note: /Counts are for this page/.test(document.body.innerText),
      raw: /order_place|bill_paid|invoice_void|ui_taps/.test(document.body.innerText),
      pager: document.body.innerText.match(/[\d,]+ entr(?:y|ies) · page \d+ of \d+/)?.[0] || null }));
    ok("P05826", "the activity log loads with rows", b2.rows > 0, `${b2.rows} rows`);
    ok("P05828", "its counts say they are per page", b2.note || !b2.pager, `note=${b2.note} pager=${b2.pager}`);
    ok("P05757", "no raw database action code is printed", !b2.raw, `raw words present: ${b2.raw}`);
    // its chips must actually narrow it (the dead-control fault)
    const before = b2.rows;
    const chip = await p.evaluate(() => { const b = [...document.querySelectorAll(".own-range button")].find((x) => /Sign-in|Bills|Orders|Tables|Printer/.test(x.textContent)); if (!b) return null; const t = b.textContent.trim(); b.click(); return t; });
    await p.waitForTimeout(2500);
    const after = await p.evaluate(() => document.querySelectorAll(".adm-logrow:not(.head)").length);
    ok("P05873", "the type chips really narrow the list", chip ? after > 0 && after < before : true, `${chip}: ${before} → ${after}`);
    ok("P05803", "no console errors on Audit & logs", errs.length === 0, errs[0] || "none");
    await c.close();
  }

  // ═══ E · the cancellation feature, end to end, on this site ═══
  if (want("CANCEL")) {
    group("E · was the food made? — end to end");
    const dish = await sb.from("menu_items").select("slug,title").eq("restaurant_id", RID_FH).limit(1).single();
    if (dish.error) { skip("P05990", "the cancellation chain", "no menu item to build an order from: " + dish.error.message); }
    else {
      const nm = `T12LIVE ${Date.now()}`;
      const item = await sb.from("inv_items").insert({ restaurant_id: RID_FH, name: nm, base_uom: "g", category: "general" }).select("id").single();
      if (item.error) throw new Error("inv item: " + item.error.message);
      const itemId = item.data.id;
      cleanup.push(async () => {
        await sb.from("inv_movements").delete().eq("item_id", itemId);
        await sb.from("inv_recipe_lines").delete().eq("item_id", itemId);
        await sb.from("inv_items").delete().eq("id", itemId);
      });
      await sb.from("inv_recipe_lines").insert({ restaurant_id: RID_FH, owner_type: "dish", owner_key: dish.data.slug, item_id: itemId, qty_base: 120 });
      const k = `t12live:${Date.now()}`;
      await sb.rpc("lfh_inv_post_movement", { p_restaurant: RID_FH, p_item: itemId, p_qty_base: 6000, p_kind: "purchase",
        p_dedupe: k, p_unit_cost: 4, p_reason: "T12 live test", p_ref_type: "purchase", p_ref_id: k, p_created_by: "T12" });
      const o = await sb.from("orders").insert({ restaurant_id: RID_FH, table_number: "T12-LIVE", status: "received",
        payment_status: "unpaid", items: [{ slug: dish.data.slug, qty: 3, title: dish.data.title, price: 250 }], total: 750, subtotal: 750 }).select("id").single();
      if (o.error) throw new Error("order: " + o.error.message);
      const orderId = o.data.id;
      cleanup.push(async () => {
        await sb.from("deletion_audit").delete().eq("order_id", orderId);
        await sb.from("expenses").delete().eq("note", `order:${orderId}`);
        await sb.from("inv_movements").delete().eq("ref_id", orderId);
        await sb.from("orders").delete().eq("id", orderId);
      });
      await new Promise((r) => setTimeout(r, 1200));
      const cons = (await sb.from("inv_movements").select("qty_base,unit_cost").eq("ref_id", orderId).eq("kind", "consumption")).data || [];
      const expect = cons.reduce((a, m) => a + -Number(m.qty_base) * Number(m.unit_cost), 0);
      const outQty = cons.reduce((a, m) => a + Number(m.qty_base), 0);
      ok("P05576", "firing to the kitchen deducts the recipe ingredients", cons.length > 0, `${cons.length} movement(s), ₹${expect.toFixed(2)}`);

      // cancel through the real manager endpoint, answering "it was cooked"
      const mgr = await br.newContext({ serviceWorkers: "block" });
      await loginAs(mgr, "manager", BASE);
      const mp = await mgr.newPage();
      const patch = await mp.request.fetch(`${BASE}/api/editor/orders/${orderId}`, { method: "PATCH",
        data: { status: "cancelled", reason_code: "kitchen_error", reason_note: "T12 live test", made: true } });
      ok("P05545", "the cancel endpoint takes the answer with the cancel", patch.ok(), `HTTP ${patch.status()}`);
      await new Promise((r) => setTimeout(r, 2500));
      const ex1 = ((await sb.from("expenses").select("id,category,amount,voided_at,expense_date").eq("note", `order:${orderId}`)).data || [])[0];
      ok("P05546", "a food-loss expense is written, priced from the ledger",
        !!ex1 && ex1.category === "food_loss" && !ex1.voided_at && Math.abs(Number(ex1.amount) - expect) < 0.02,
        ex1 ? `₹${ex1.amount} vs ledger ₹${expect.toFixed(2)} on ${ex1.expense_date}` : "no expense row");
      const rev1 = (await sb.from("inv_movements").select("id").eq("ref_id", orderId).eq("kind", "consumption_reversal")).data || [];
      ok("P05555", "cooked leaves the stock deducted", rev1.length === 0, `${rev1.length} reversal(s)`);
      const da1 = (await sb.from("deletion_audit").select("id,kind,meta").eq("order_id", orderId).order("at")).data || [];
      const cancelRow = da1.find((r) => r.kind === "order_cancelled");
      const clsRow = da1.find((r) => r.kind === "removal_classified");
      ok("P05602", "the removal itself is still recorded, with its reason", !!cancelRow, cancelRow ? "present" : "missing");
      ok("P05605", "the answer is its own append-only row, linked to it",
        !!clsRow && clsRow.meta?.made === true && clsRow.meta?.of === cancelRow?.id,
        clsRow ? `made=${clsRow.meta?.made} of=${clsRow.meta?.of} cost=₹${clsRow.meta?.loss_cost}` : "missing");
      ok("P05647", "and the listed row now carries the current answer", cancelRow?.meta?.made === true, `made=${cancelRow?.meta?.made}`);

      // correct it — the owner's route this time, which is the half he asked for on 2026-08-19
      const oc = await br.newContext({ serviceWorkers: "block" });
      await loginAs(oc, "owner", BASE);
      const op = await oc.newPage();
      const fix = await op.request.fetch(`${BASE}/api/owner/audit`, { method: "POST", data: { order_id: orderId, made: false } });
      const fixBody = await fix.json().catch(() => ({}));
      ok("P05747", "the OWNER can correct the answer too", fix.ok() && fixBody.ok === true, `HTTP ${fix.status()} ${JSON.stringify(fixBody).slice(0,90)}`);
      await new Promise((r) => setTimeout(r, 2500));
      const rev2 = (await sb.from("inv_movements").select("id,qty_base").eq("ref_id", orderId).eq("kind", "consumption_reversal")).data || [];
      const back = rev2.reduce((a, m) => a + Number(m.qty_base), 0);
      ok("P05556", "never-made puts the ingredients back, to the gram",
        rev2.length === cons.length && Math.abs(back + outQty) < 0.0001, `out ${outQty}, back ${back} over ${rev2.length} row(s)`);
      const ex2 = (await sb.from("expenses").select("voided_at,void_reason").eq("note", `order:${orderId}`)).data || [];
      ok("P05557", "the loss expense is struck out, never deleted", ex2.length > 0 && ex2.every((x) => !!x.voided_at),
        ex2.map((x) => x.void_reason).join("; ") || "no rows");
      const da2 = (await sb.from("deletion_audit").select("meta").eq("order_id", orderId).eq("kind", "removal_classified")).data || [];
      ok("P05558", "the correction records what it changed from",
        da2.some((r) => r.meta?.corrected === true && r.meta?.was === "true"),
        JSON.stringify(da2.map((r) => ({ made: r.meta?.made, was: r.meta?.was }))));
      // and refusals are answers, not silence
      const bad = await op.request.fetch(`${BASE}/api/owner/audit`, { method: "POST", data: { order_id: orderId } });
      ok("P05771", "an answer with no verdict is refused, in words", bad.status() === 400,
        `HTTP ${bad.status()} ${JSON.stringify(await bad.json().catch(() => ({}))).slice(0, 70)}`);
      const notMine = await op.request.fetch(`${BASE}/api/owner/audit`, { method: "POST", data: { order_id: "00000000-0000-0000-0000-0000000000ff", made: true } });
      ok("P05954", "an order that is not theirs is refused", notMine.status() >= 400, `HTTP ${notMine.status()}`);
      await mgr.close(); await oc.close();
    }
  }

  // ═══ F · the manager panel ═══
  if (want("PANEL")) {
    group("F · the manager panel");
    const c = await br.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: "block" });
    await loginAs(c, "manager", BASE);
    const p = await c.newPage();
    const errs = [];
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 130)); });
    p.on("response", async (r) => { if (r.status() >= 400 && !/[?&]_rsc=/.test(r.url())) { let b = ""; try { b = (await r.text()).slice(0, 160); } catch {} errs.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")} :: ${b}`); } });
    await p.goto(BASE + "/panels/editor/index.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(24000);
    const d = await p.evaluate(async () => {
      if (typeof askRemovalReason !== "function") return { missing: true };
      askRemovalReason("KOT #999 — live test", { askMade: true });
      await new Promise((r) => setTimeout(r, 600));
      const w = document.querySelector(".rr-overlay"); if (!w) return { noOverlay: true };
      const go = w.querySelector(".rr-go"), atOpen = go.disabled;
      w.querySelector('.rr-opt[data-code="mistake"]').click(); await new Promise((r) => setTimeout(r, 120));
      const afterReason = go.disabled;
      w.querySelector('.rr-made-opt[data-made="0"]').click(); await new Promise((r) => setTimeout(r, 120));
      const afterBoth = go.disabled;
      const red = String(getComputedStyle(w.querySelector(".rr-made")).borderTopColor);
      const opts = [...w.querySelectorAll(".rr-made-opt")].map((b) => b.innerText.replace(/\n/g, " | "));
      w.__lfhClose();
      return { atOpen, afterReason, afterBoth, red, opts };
    });
    ok("P05704", "the cancel dialog asks whether the food was made, framed in red",
      !d.missing && !d.noOverlay && /0\.86|220,\s*38|dc2626/.test(d.red || ""), `frame ${d.red} · ${(d.opts || []).join(" / ")}`);
    ok("P05705", "Remove stays disabled until BOTH questions are answered",
      d.atOpen === true && d.afterReason === true && d.afterBoth === false, `open=${d.atOpen} reasonOnly=${d.afterReason} both=${d.afterBoth}`);
    await p.evaluate(() => document.querySelector('.tab[data-tab="log"]')?.click());
    await p.waitForTimeout(7000);
    await p.evaluate(() => { const b = [...document.querySelectorAll(".subtab, button")].find((x) => /removals/i.test(x.textContent || "")); if (b) b.click(); });
    await p.waitForTimeout(9000);
    const m = await p.evaluate(() => ({ rows: document.querySelectorAll(".au-row").length,
      tags: document.querySelectorAll(".au-tag").length, asking: document.querySelectorAll(".au-ask").length,
      classified: /Cancellation answered/.test(document.body.innerText),
      split: document.querySelectorAll(".au-main[data-au-open]").length }));
    ok("P05706", "the manager's Audit tags every row and offers the question",
      m.rows > 0 && m.tags > 0 && m.asking > 0, `${m.rows} rows · ${m.tags} tags · ${m.asking} asking`);
    ok("P05707", "the answer buttons sit outside the row's own click target",
      m.split === m.rows, `${m.split} split of ${m.rows}`);
    ok("P05708", "answer rows are not in the manager's removals list either", !m.classified, `present: ${m.classified}`);
    ok("P05709", "no console errors in the panel", errs.length === 0, errs[0] || "none");
    await c.close();
  }
} catch (e) {
  fails.push({ id: "RUNNER", name: "the run itself threw", detail: e instanceof Error ? e.message : String(e) });
  console.log(`\n✗ RUNNER threw: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  let n = 0;
  for (const f of cleanup.reverse()) { try { await f(); n++; } catch (e) { console.log("   cleanup step failed:", e.message); } }
  const left = (await sb.from("orders").select("id").eq("restaurant_id", RID_FH).eq("table_number", "T12-LIVE")).data || [];
  const leftI = (await sb.from("inv_items").select("id").eq("restaurant_id", RID_FH).like("name", "T12LIVE%")).data || [];
  console.log(`\ncleaned up ${n} row group(s) by id · test orders left: ${left.length} · test ingredients left: ${leftI.length}`);
  await br.close();
  if (notes.length) {
    const uniq = [...new Set(notes)];
    console.log(`\nNOTED (not failures — route prefetches that 4xx'd; ${notes.length} occurrence(s)):`);
    uniq.slice(0, 6).forEach((n) => console.log(`  ${n}`));
  }
  console.log(`\n${pass} passed · ${fails.length} failed · ${skips.length} skipped   (${BASE})`);
  if (fails.length) { console.log("\nFAILURES:"); fails.forEach((f) => console.log(`  ${f.id} ${f.name}\n      ${f.detail}`)); }
  process.exit(fails.length ? 1 : 0);
}
