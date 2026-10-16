// Family P — FIFTH PASS, the rest of what the mutation run said no check would notice (111 of 180 breaks
// caught by families A–N; the survivors that a person could feel are pinned here, one check each; the
// ones that cannot matter are listed in the round-3 findings with the reason).
import { C, ok } from "./lib.mjs";
import { page, open, setApi, file, log, sleep, until } from "./server.mjs";
import { call, world, g, FH } from "../sweep/t16s10/routes.mjs";

const ONLINE = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";
const PACE = "window.LFH_TEST_PACING={first:60,base:80,max:240,wake:0,stuck:60000,boot:200};";
const quiet = async (fn) => { const k = [console.warn, console.error]; console.warn = console.error = () => {}; try { return await fn(); } finally { [console.warn, console.error] = k; } };

// ── the crash reporter: WHERE survives ────────────────────────────────────────────────────────
file("/t/boom.js", "application/javascript", "function deep() {\n  null.x;\n}\nfunction outer() {\n  deep();\n}\nsetTimeout(outer, 50);\nsetTimeout(function () { Promise.reject(new Error('later failure')); }, 120);\n");
C("P", "errlog.js", "a real crash in a script file names THAT file and line, with its caller ('boom.js:2 <- boom.js:5'); a rejected Error is named by its stack too; a report kept offline keeps its place when sent later", async () => {
  setApi(() => ({ status: 204, body: "" }));
  const P = page("p-err", { pre: ONLINE, scripts: ["errlog.js"], head: "", after: "" });
  const h = await open(P); const p = h.page;
  await p.evaluate(() => { const s = document.createElement("script"); s.src = "/t/boom.js"; document.body.appendChild(s); }); await sleep(700);
  const rows = log.filter((x) => x.path === "/api/log/client-error").map((x) => JSON.parse(x.body)).filter((x) => x.kind === "error");
  await p.evaluate(() => { localStorage.removeItem("lfh_errlog_pending"); window.__on = false; window.LFH_ERRLOG.report("menu render failed", "app.js@1a2b:77"); window.__on = true; window.dispatchEvent(new Event("online")); });
  await until(() => log.some((x) => x.path === "/api/log/client-error" && /menu render failed/.test(x.body)), 4000);
  const kept = log.filter((x) => /menu render failed/.test(x.body)).map((x) => JSON.parse(x.body).where);
  await h.close();
  const thrown = rows.find((x) => /null/.test(x.message)), rej = rows.find((x) => /later failure/.test(x.message));
  return ok(thrown && /^boom\.js:2 <- boom\.js:5$/.test(thrown.where) && rej && /^boom\.js:8/.test(rej.where) && kept.length === 1 && /^app\.js@1a2b:77 · offline, under a minute earlier$/.test(kept[0]), JSON.stringify({ thrown, rej, kept }));
});

// ── the theme waits for a finger ──────────────────────────────────────────────────────────────
C("P", "theme.js", "a theme change from another tab while a finger is DOWN waits for it to lift (a real touch, not a script event); a page with no theme button loads without an error", async () => {
  const P = page("p-theme", { scripts: ["theme.js"], body: '<button id="themeToggle" style="width:200px;height:120px">t</button>' });
  const h = await open(P); const p = h.page;
  await p.evaluate(() => window.LFH_THEME.set("light"));
  const box = await p.locator("#themeToggle").boundingBox();
  await p.mouse.move(box.x + 10, box.y + 10); await p.mouse.down();
  await p.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "lfh_panel_theme", newValue: "dark" })));
  const during = await p.evaluate(() => window.LFH_THEME.get());
  await p.mouse.move(box.x + 300, box.y + 300); await p.mouse.up();
  const after = await p.evaluate(() => window.LFH_THEME.get());
  await h.close();
  const P2 = page("p-theme-nobtn", { scripts: ["theme.js"] }); const h2 = await open(P2); await sleep(200); const errs = h2.errors.slice(); await h2.close();
  return ok(during === "light" && after === "dark" && !errs.length, JSON.stringify({ during, after, errs }));
});

// ── the figure shortener shrinks only as much as it must ──────────────────────────────────────
C("P", "fitnums.js", "a figure that overflows is shrunk JUST enough — a size or so bigger would overflow again — never crushed to the 11 px floor when it did not need to be; a block figure stays a block", async () => {
  const P = page("p-fit", { scripts: ["fitnums.js"], body: '<div id="host"></div>' });
  const h = await open(P); const p = h.page;
  const r = await p.evaluate(() => {
    const out = [], host = document.getElementById("host");
    for (const [w, txt] of [[140, "₹12,34,567"], [180, "₹9,87,65,432"], [100, "1,234 covers"], [220, "₹45,67,890"]]) {
      host.innerHTML = `<div style="width:${w}px;overflow:hidden"><span class="fit-num" style="display:block;font-size:40px">${txt}</span></div>`;
      const el = host.querySelector("span"); window.LFH_FITNUM.fit(el);
      const px = parseFloat(getComputedStyle(el).fontSize), disp = getComputedStyle(el).display;
      el.style.fontSize = Math.min(40, px * 1.15) + "px"; const bigger = el.scrollWidth - el.clientWidth;
      out.push({ w, txt: el.textContent, px, disp, overflowsIfBigger: bigger > 1 || px >= 39.5 });
    }
    return out;
  });
  await h.close();
  return ok(r.every((x) => x.px > 11 && x.overflowsIfBigger && x.disp === "block"), JSON.stringify(r));
});

// ── the Back manager's recovery, measured properly ────────────────────────────────────────────
C("P", "backstack.js", "if a rewind the Back manager asked for never lands, the NEXT drawer still gets a new Back entry of its own (within about 1.5 s)", async () => {
  const P = page("p-back", { scripts: ["backstack.js"] });
  const h = await open(P); const p = h.page;
  const r = await p.evaluate(async () => {
    const sl = (ms) => new Promise((x) => setTimeout(x, ms));
    const go0 = history.go.bind(history); history.go = () => {};
    const un = window.LFH_BACK.layer("a", () => {}); await sl(80); un(); await sl(80);
    history.go = go0; await sl(1700);
    // The recovery is armed by the next thing the manager does, so b's entry arrives within ~1.5 s of b.
    const before = history.length; window.LFH_BACK.layer("b", () => {}); await sl(2000);
    return { before, after: history.length };
  });
  await h.close();
  return ok(r.after === r.before + 1, JSON.stringify(r));
});

// ── the undo card gives its space back ────────────────────────────────────────────────────────
C("P", "undobar.js", "while the undo card is up the page reserves room for it (so it never covers the last row), and gives that room back the moment it goes", async () => {
  const P = page("p-undo", { scripts: ["undobar.js"] });
  const h = await open(P); const p = h.page;
  const r = await p.evaluate(async () => {
    const sl = (ms) => new Promise((x) => setTimeout(x, ms));
    window.LFH_UNDO.show({ message: "Served", seconds: 5 }); await sl(600);
    const up = { cls: document.body.classList.contains("lfh-undobar-up"), h: document.body.style.getPropertyValue("--lfh-undobar-h") };
    window.LFH_UNDO.dismiss(); await sl(400);
    return { up, down: { cls: document.body.classList.contains("lfh-undobar-up"), h: document.body.style.getPropertyValue("--lfh-undobar-h") } };
  });
  await h.close();
  return ok(r.up.cls && /\d+px/.test(r.up.h) && !r.down.cls && !r.down.h, JSON.stringify(r));
});

// ── the guest bell ────────────────────────────────────────────────────────────────────────────
C("P", "guestbell.js", "the bell's spoken name counts right ('1 new thing' / '3 new things'); a self-titled row with no detail shows no stray word; tapping the dimmed background closes the sheet, tapping inside it does not", async () => {
  const P = page("p-bell", { body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["backstack.js", "guestbell.js"] });
  const h = await open(P); const p = h.page;
  const r = await p.evaluate(async () => {
    const sl = (ms) => new Promise((x) => setTimeout(x, ms)); const now = Date.now();
    const btn = () => [...document.querySelectorAll(".topbar button")].find((b) => /guest/i.test(b.getAttribute("aria-label") || ""));
    window.LFH_BELL.sync({ menuOn: true, rows: [{ id: "a", kind: "call", table: "1", at: now }] }); await sl(50); const one = btn().getAttribute("aria-label");
    window.LFH_BELL.sync({ menuOn: true, rows: [{ id: "a", kind: "call", table: "1", at: now }, { id: "b", kind: "order", table: "2", at: now }, { id: "c", kind: "stock", title: "Paneer is low", at: now }] }); await sl(50); const three = btn().getAttribute("aria-label");
    window.LFH_BELL.open(); await sl(150);
    const rowText = [...document.querySelectorAll(".lfh-bell-row")].map((x) => x.innerText).join(" | ");
    document.querySelector(".lfh-bell-sheet").click(); await sl(100); const afterInside = !!document.querySelector(".lfh-bell-sheet");
    const back = document.querySelector(".lfh-bell-sheet").parentElement; back.dispatchEvent(new MouseEvent("click", { bubbles: true })); await sl(100);
    return { one, three, rowText, afterInside, afterBackdrop: !!document.querySelector(".lfh-bell-sheet") };
  });
  await h.close();
  return ok(r.one === "1 new thing from the guest menu" && /^\d+ new things from the guest menu$/.test(r.three) && !/undefined|null/.test(r.rowText) && r.afterInside && !r.afterBackdrop, JSON.stringify(r));
});

// ── My profile & pay ──────────────────────────────────────────────────────────────────────────
C("P", "myprofile.js", "My profile shows the person's initial, and Save sends the phone number EXACTLY as typed (never blank, never the old one)", async () => {
  const sent = [];
  setApi((r) => { if (r.path.startsWith("/api/panel-profile") && r.method === "GET") return { status: 200, body: { staff: true, id: "u1", name: "Ravi", username: "ravi", phone: "9800000000", role: "tablet", profileModule: true, profile: {}, job: {}, completeness: { filled: 1, total: 9 } } }; if (r.path.startsWith("/api/panel-profile")) { sent.push(JSON.parse(r.body)); return { status: 200, body: { ok: true } }; } return { status: 200, body: {} }; });
  const P = page("p-me", { pre: ONLINE + PACE, scripts: ["backstack.js", "outbox.js", "maint.js", "myprofile.js"] });
  const h = await open(P); const p = h.page; await sleep(300);
  await p.evaluate(() => window.LFH_ME.open()); await sleep(600);
  const av = await p.evaluate(() => (document.querySelector(".me-av") || {}).textContent);
  await p.fill('#meForm input[name="phone"]', "9811122233"); await p.click("#meForm .me-save"); await sleep(800);
  await h.close();
  const ph = sent.find((b) => "phone" in b);
  return ok(av === "R" && ph && ph.phone === "9811122233", JSON.stringify({ av, sent }));
});

// ── the ⚙ Settings drawer ─────────────────────────────────────────────────────────────────────
C("P", "maint.js", "however many times the boot is retried (a busy start, then the signal returning), there is exactly ONE Profile button; Enter on an empty reason does nothing; tapping inside a question keeps it open, tapping outside answers No", async () => {
  let n = 0; setApi((r) => (r.path.startsWith("/api/panel-profile") && r.method === "GET" ? (++n <= 2 ? { status: 503, body: {} } : { status: 200, body: { staff: true, id: "u1", name: "Asha", username: "asha", phone: "1", role: "manager" } }) : { status: 200, body: { ok: true } }));
  const P = page("p-maint", { pre: ONLINE + PACE, body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["backstack.js", "maint.js"] });
  const h = await open(P); const p = h.page;
  await until(() => p.evaluate(() => !!document.getElementById("staffSettingsBtn")), 6000);
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.dispatchEvent(new Event("online"))); await sleep(300); }
  const buttons = await p.evaluate(() => document.querySelectorAll("#staffSettingsBtn").length);
  const r = await p.evaluate(async () => {
    const sl = (ms) => new Promise((x) => setTimeout(x, ms)); const out = {};
    let done = false; const t = window.LFH_ASK.text("Why?").then((v) => { done = true; out.text = v; }); await sl(100);
    document.querySelector(".lfh-ov input.lfh-in").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); await sl(100); out.emptyEnterClosed = done;
    [...document.querySelectorAll(".lfh-ov button")].reverse().find((b) => /Cancel/.test(b.textContent)).click(); await t;
    let ans = "pending"; const c = window.LFH_ASK.confirm("Close it?").then((v) => { ans = v; }); await sl(100);
    const ov = [...document.querySelectorAll(".lfh-ov")].pop();
    ov.querySelector("[role=dialog]").dispatchEvent(new MouseEvent("click", { bubbles: true })); await sl(100); out.insideKeepsOpen = ans === "pending" && !!ov.isConnected;
    ov.dispatchEvent(new MouseEvent("click", { bubbles: true })); await c; out.outside = ans;
    return out;
  });
  await h.close();
  return ok(buttons === 1 && r.emptyEnterClosed === false && r.text === null && r.insideKeepsOpen && r.outside === false, JSON.stringify({ buttons, r }));
});

// ── Report an issue ───────────────────────────────────────────────────────────────────────────
C("P", "issue-raise.js", "with a signal the Add photo button is ON; a voice note whose upload never reaches the server says the VOICE NOTE couldn't be uploaded", async () => {
  setApi((r) => (r.path.startsWith("/api/issue-media") ? "drop" : { status: 200, body: { ok: true } }));
  const P = page("p-issue", { pre: ONLINE, scripts: ["backstack.js", "issue-raise.js"] });
  const h = await open(P, { media: true }); const p = h.page;
  await p.evaluate(() => window.LFH_ISSUE.open({ api: async () => ({ ok: true }) })); await sleep(200);
  const photoOn = await p.evaluate(() => { const b = [...document.querySelectorAll(".lfhir-ov button")].find((x) => /Add photo/.test(x.textContent)); return b && !b.disabled; });
  await p.fill(".lfhir-ov input", "Leak");
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /Record voice note/.test(b.textContent)).click()); await sleep(900);
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /Stop/.test(b.textContent)).click()); await sleep(500);
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /^Send/.test(b.textContent.trim())).click()); await sleep(1200);
  const st = await p.evaluate(() => (document.querySelector(".lfhir-status") || {}).textContent || "");
  await h.close();
  return ok(photoOn && /voice note couldn't be uploaded/.test(st), JSON.stringify({ photoOn, st }));
});

// ── the swipe hint and the offline-layer installer, loaded late or on a clipped row ───────────
// (The stand-in offline worker at /sw.js is the shared one in server.mjs.)
C("P", "swipehint.js + swreg.js", "a row that clips its overflow (cannot scroll) promises nothing even when content is cut; both helpers still start when loaded after the page finished loading", async () => {
  const P = page("p-late", { body: '<div id="clip" data-swipe-hint style="width:200px;overflow:hidden;white-space:nowrap">' + "<span style='display:inline-block;width:90px'>x</span>".repeat(6) + "</div>", after: "window.addEventListener('load',()=>setTimeout(()=>{for(const f of ['swipehint.js','swreg.js']){const s=document.createElement('script');s.src='/panels/'+f;document.body.appendChild(s);}},200));" });
  const h = await open(P); const p = h.page;
  await until(() => p.evaluate(() => !!window.LFH_SWIPE && !!window.LFH_WARM), 4000);
  await until(() => p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), 5000); await sleep(300);
  const r = await p.evaluate(async () => ({ more: document.getElementById("clip").getAttribute("data-more"), sw: !!(await navigator.serviceWorker.getRegistration()) }));
  await h.close();
  return ok(!r.more && r.sw, JSON.stringify(r));
});

// ── the Activity log's sorts and groups ───────────────────────────────────────────────────────
const AP = page("p-audit", { scripts: ["auditsort.js"] });
C("P", "auditsort.js", "the Activity log's 'Oldest first' really is oldest first and 'Person (A–Z)' A–Z; a row logged at error level files under Problems", async () => {
  const h = await open(AP); const p = h.page;
  const r = await p.evaluate(() => {
    const A = window.LFH_AUDITSORT;
    const rows = [{ id: 1, actor: "Zed", created_at: "2026-10-03T10:00:00Z", action: "kot_printed" }, { id: 2, actor: "Asha", created_at: "2026-10-01T10:00:00Z", action: "kot_printed" }, { id: 3, actor: "Mo", created_at: "2026-10-02T10:00:00Z", action: "made_up", level: "error" }];
    const groups = A.ACTIVITY_GROUPS.map((x) => x.id);
    return { old: A.activityView(rows, { sort: "old" }).map((x) => x.id), person: A.activityView(rows, { sort: "person" }).map((x) => x.id), errGroup: A.activityGroupOfRow(rows[2]), groups };
  });
  await h.close();
  return ok(r.old.join() === "2,3,1" && r.person.join() === "2,3,1" && r.errGroup === "problem", JSON.stringify(r));
});

// ── the routes: the small words in their answers ──────────────────────────────────────────────
C("P", "app/api/health + log/client-error + maintenance routes", "health says db:false when the database is down; a rate-limited report still answers ok:true; a filed crash keeps its message and the owner's alert names the SCREEN; a switch change answers canChange:true and logs the person's NAME", () => quiet(async () => {
  const out = {};
  await world({}); g().FAIL = { restaurants: "error" }; const hl = await call("health", "GET"); out.health = hl.json;
  const now = new Date().toISOString();
  await world({ actions: Array.from({ length: 40 }, (_, i) => ({ id: "t" + i, device_id: "d1", action: "ui_taps", created_at: now })) });
  out.taps = (await call("clientError", "POST", { body: { panel: "tablet", kind: "taps", detail: "[1]" }, headers: { cookie: "lfh_panel_device=d1" } })).json;
  await world({}); await call("clientError", "POST", { body: { panel: "owner", message: "Cannot read x", where: "/owner/feedback" } });
  const ins = (g().WRITES || []).find((w) => w.table === "staff_actions"); out.detail = ins && (Array.isArray(ins.patch) ? ins.patch[0] : ins.patch).detail;
  await new Promise((r) => setTimeout(r, 50)); out.alert = (g().ALERTS || [])[0] && g().ALERTS[0].text;
  await world({ who: "manager", access: { maintenance: { on: true, manager_opts: { who: "owner_manager" } } } });
  out.post = (await call("maintenance", "POST", { body: { on: true } })).json; out.log = (g().LOGS || [])[0];
  return ok(out.health && out.health.db === false && out.taps.ok === true && /^Cannot read x @ \/owner\/feedback/.test(out.detail || "") && /Screen: (?!\/owner\/feedback(\n|$))\S/.test(out.alert || "") && out.post.canChange === true && out.log && out.log.actor === "Diag Manager", JSON.stringify(out));
}));
