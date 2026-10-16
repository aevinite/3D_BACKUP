// Family N — THIRD PASS, AIMED BY THE SECOND COVERAGE REPORT (owner: "do it again … maybe some error
// will be left"). What coverage pass 2 still showed as never run, where a person can reach it: a
// voice note recorded and sent (Chromium's FAKE microphone — no real device opens), signing out from
// INSIDE the panel's frame, the undo card that ran out while its tab slept, the crash reporter on a
// browser with no sendBeacon, the bar's words for changes that were not made offline, and the names
// the stock-room screens give a waiting change.
import { C, ok } from "./lib.mjs";
import { page, open, setApi, log, sleep, until } from "./server.mjs";
import vm from "node:vm";
import { panelFile } from "./lib.mjs";

const ONLINE = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";

// ── Report an issue: the voice note ───────────────────────────────────────────────────────────
const IP = page("n-issue", { pre: ONLINE, scripts: ["backstack.js", "issue-raise.js"] });
C("N", "issue-raise.js", "a voice note: Record starts a running timer ('Stop · 0:01'), Stop leaves a playable preview and 'Remove voice note', Send uploads it as audio ONCE and the ticket carries it; Remove takes it off", async () => {
  setApi((r) => (r.path.startsWith("/api/issue-media") ? { status: 200, body: { url: "https://x/media/v.webm" } } : { status: 200, body: { ok: true } }));
  const h = await open(IP, { media: true }); const p = h.page;
  await p.evaluate(() => { window.__t = []; window.LFH_ISSUE.open({ api: async (m, path, body) => { window.__t.push(body); return { ok: true }; } }); }); await sleep(200);
  await p.fill(".lfhir-ov input", "Tap is leaking");
  const rec = () => p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /voice note|Stop/.test(b.textContent)));
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /Record voice note/.test(b.textContent)).click());
  await sleep(1600);
  const running = await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].map((b) => b.textContent.trim()).find((t) => /^Stop · \d:\d\d$/.test(t)));
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /Stop/.test(b.textContent)).click()); await sleep(600);
  const after = await p.evaluate(() => ({ audio: !!document.querySelector(".lfhir-prev audio"), btn: [...document.querySelectorAll(".lfhir-ov button")].map((b) => b.textContent.trim()).find((t) => /voice note/.test(t)), rm: (document.querySelector('.lfhir-prev [aria-label="Remove voice note"]') || {}).tagName }));
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /^Send/.test(b.textContent.trim())).click()); await sleep(900);
  const ups = log.filter((x) => x.path.startsWith("/api/issue-media")), t = await p.evaluate(() => window.__t);
  void rec; await h.close();
  return ok(running && after.audio && /Remove voice note/.test(after.btn) && after.rm === "BUTTON" && ups.length === 1 && /name="kind"\r?\n\r?\naudio/.test(ups[0].body) && t.length === 1 && t[0].audio_url === "https://x/media/v.webm", JSON.stringify({ running, after, uploads: ups.length, t }));
});
C("N", "issue-raise.js", "a voice note the server will not take, or never answers, stops the ticket with a sentence naming the VOICE NOTE", async () => {
  setApi((r) => (r.path.startsWith("/api/issue-media") ? { status: 413, body: { error: "That voice note is too long." } } : { status: 200, body: { ok: true } }));
  const h = await open(IP, { media: true }); const p = h.page;
  await p.evaluate(() => { window.__t = []; window.LFH_ISSUE.open({ api: async (m, path, body) => { window.__t.push(body); return { ok: true }; } }); }); await sleep(200);
  await p.fill(".lfhir-ov input", "Freezer noise");
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /Record voice note/.test(b.textContent)).click()); await sleep(900);
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /Stop/.test(b.textContent)).click()); await sleep(500);
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /^Send/.test(b.textContent.trim())).click()); await sleep(900);
  const st = await p.evaluate(() => (document.querySelector(".lfhir-status") || {}).textContent || ""), t = await p.evaluate(() => window.__t.length);
  await h.close();
  return ok(/voice note/i.test(st) && /too long/.test(st) && t === 0, JSON.stringify({ st, t }));
});

// ── signing out from inside the panel's frame ─────────────────────────────────────────────────
C("N", "maint.js + outbox.js", "inside the panel's frame (how every panel really runs), Sign out — and a live change answered 'signed out' — send the WHOLE window to the sign-in page, not just the frame", async () => {
  setApi((r) => (r.path.startsWith("/api/panel-profile") && r.method === "GET" ? { status: 200, body: { staff: true, id: "u1", name: "Asha", username: "asha", phone: "1", role: "manager", hasPin: true } } : r.path.startsWith("/api/editor") ? { status: 401, body: {} } : { status: 200, body: { ok: true } }));
  const inner = page("n-inner", { pre: ONLINE + "window.LFH_TEST_PACING={first:60,base:80,max:240,wake:0,stuck:60000};", body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["backstack.js", "outbox.js", "maint.js"] });
  const outer = page("n-outer", { body: `<iframe id="f" src="${inner}" style="width:900px;height:700px"></iframe>` });
  let h = await open(outer); let p = h.page;
  let fr = null; await until(async () => { fr = p.frames().find((f) => f.url().includes("/p/n-inner")); return fr && await fr.evaluate(() => !!document.getElementById("staffSettingsBtn")); }, 6000);
  await fr.click("#staffSettingsBtn"); await sleep(300);
  await fr.evaluate(() => [...document.querySelectorAll(".lfh-ov button")].find((b) => /Sign out|Log out/.test(b.textContent)).click());
  await p.waitForURL(/\/login$/, { timeout: 6000 }).catch(() => {}); const a = p.url(); await h.close();
  h = await open(outer); p = h.page;
  await until(async () => { fr = p.frames().find((f) => f.url().includes("/p/n-inner")); return fr && await fr.evaluate(() => !!window.LFH_OUTBOX); }, 6000);
  fr.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/2/tag", body: {}, table: "2" }).catch(() => {})).catch(() => {});
  await p.waitForURL(/\/login$/, { timeout: 6000 }).catch(() => {}); const b = p.url(); await h.close();
  return ok(/\/login$/.test(a) && /\/login$/.test(b), JSON.stringify({ signOut: a, signedOutAnswer: b }));
});
C("N", "maint.js", "during first-login setup the drawer cannot be closed by tapping outside it — it says, in the panel, what is still needed", async () => {
  setApi((r) => (r.path.startsWith("/api/panel-profile") && r.method === "GET" ? { status: 200, body: { staff: true, id: "u1", name: "Asha", username: "asha", phone: "", role: "tablet", needsProfile: true } } : { status: 200, body: { ok: true } }));
  const P2 = page("n-setup", { pre: ONLINE, body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["backstack.js", "maint.js"] });
  const h = await open(P2); const p = h.page;
  await until(() => p.evaluate(() => !!document.querySelector(".lfh-ov")), 5000);
  const intro = await p.evaluate(() => (document.querySelector(".lfh-ov .lfh-d") || {}).textContent);
  await p.mouse.click(5, 5); await sleep(300);
  const said = await p.evaluate(() => { const d = [...document.querySelectorAll('.lfh-ov [role=dialog]')].pop(); return d && d.innerText.replace(/\s+/g, " "); });
  const still = await p.evaluate(() => document.querySelectorAll(".lfh-ov").length >= 1);
  await h.close();
  return ok(/Add your details below/.test(intro || "") && /Please confirm your username and phone to continue/.test(said || "") && still, JSON.stringify({ intro, said, still }));
});
C("N", "maint.js", "a password change whose request never reaches the server says 'Network error.' and the button works again", async () => {
  setApi((r) => (r.path.startsWith("/api/panel-profile") && r.method === "GET" ? { status: 200, body: { staff: true, id: "u1", name: "Asha", username: "asha", phone: "1", role: "manager", hasPin: true, canSelfReset: true } } : r.path.startsWith("/api/panel-profile") ? "drop" : { status: 200, body: { ok: true } }));
  const P2 = page("n-pw", { pre: ONLINE, body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["backstack.js", "maint.js"] });
  const h = await open(P2); const p = h.page;
  await until(() => p.evaluate(() => !!document.getElementById("staffSettingsBtn")), 5000); await p.click("#staffSettingsBtn"); await sleep(300);
  await p.fill('.lfh-ov input[placeholder="Current password"]', "a"); await p.fill('.lfh-ov input[placeholder="New password (min 6)"]', "bbbbbbb");
  await p.evaluate(() => [...document.querySelectorAll(".lfh-ov button")].find((b) => b.textContent === "Change password").click()); await sleep(700);
  const r = await p.evaluate(() => ({ msg: [...document.querySelectorAll(".lfh-ov .lfh-msg")].map((m) => m.textContent).filter(Boolean), disabled: [...document.querySelectorAll(".lfh-ov button")].find((b) => b.textContent === "Change password").disabled }));
  await h.close();
  return ok(r.msg.includes("Network error.") && r.disabled === false, JSON.stringify(r));
});
C("N", "maint.js", "a panel that opened with NO signal (no profile read at all) builds its Profile button the moment the signal returns", async () => {
  let up = false; setApi((r) => (r.path.startsWith("/api/panel-profile") && r.method === "GET" ? (up ? { status: 200, body: { staff: true, id: "u1", name: "Asha", username: "asha", phone: "1", role: "manager" } } : "drop") : { status: 200, body: { ok: true } }));
  const P2 = page("n-boot-off", { pre: ONLINE + "window.LFH_TEST_PACING={boot:600000};", body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["backstack.js", "maint.js"] });
  const h = await open(P2); const p = h.page; await sleep(800);
  const before = await p.evaluate(() => !!document.getElementById("staffSettingsBtn"));
  up = true; await p.evaluate(() => window.dispatchEvent(new Event("online")));
  const after = await until(() => p.evaluate(() => !!document.getElementById("staffSettingsBtn")), 4000);
  await h.close();
  return ok(!before && after, JSON.stringify({ before, after }));
});

// ── My profile: the manager's own top-bar button ──────────────────────────────────────────────
C("N", "myprofile.js", "the manager's 'My profile' top-bar button stays hidden until profiles are known to be on; a busy first answer is asked again by itself, and then the button appears and opens the page", async () => {
  let n = 0; setApi((r) => (r.path.startsWith("/api/panel-profile") ? (++n === 1 ? { status: 503, body: {} } : { status: 200, body: { staff: true, id: "u1", name: "Asha & Co's", username: "asha", role: "manager", profileModule: true, job: {}, pay: null, completeness: { filled: 0, total: 9 } } }) : { status: 200, body: {} }));
  const P2 = page("n-mebtn", { pre: ONLINE + "window.LFH_TEST_PACING={boot:300};", body: '<button id="myProfileBtn" hidden style="display:none">My profile</button>', scripts: ["backstack.js", "myprofile.js"] });
  const h = await open(P2); const p = h.page;
  const first = await p.evaluate(() => document.getElementById("myProfileBtn").hidden); await sleep(200);
  const shown = await until(() => p.evaluate(() => !document.getElementById("myProfileBtn").hidden), 4000);
  await p.click("#myProfileBtn"); await sleep(600);
  const name = await p.evaluate(() => (document.querySelector(".me-wrap") || {}).innerText || "");
  await h.close();
  return ok(first && shown && n >= 2 && /Asha & Co's/.test(name) && !/&amp;|&#39;/.test(name), JSON.stringify({ first, shown, reads: n, name: name.slice(0, 120) }));
});

// ── the undo card that ran out while its tab slept ────────────────────────────────────────────
const UP = page("n-undo", { scripts: ["undobar.js"] });
C("N", "undobar.js", "a take-back asked for just before the tablet slept, whose window has passed by the time the screen paints, is NOT offered late — it quietly expires; a second one while a card is up swaps the words in place", async () => {
  const h = await open(UP, { clock: true }); const p = h.page;
  // EVER shown, not just shown at the end — a late card that flashes up and then expires is the fault.
  const r = await p.evaluate(() => { window.__exp = 0; window.__ever = false; window.LFH_UNDO.show({ message: "Served Dal", seconds: 2, onExpire: () => window.__exp++ });
    new MutationObserver(() => { if (document.getElementById("lfh-undobar").classList.contains("show")) window.__ever = true; }).observe(document.getElementById("lfh-undobar"), { attributes: true, attributeFilter: ["class"] }); return true; });
  await p.clock.setSystemTime(Date.now() + 10000); await p.clock.runFor(500);
  const late = await p.evaluate(() => ({ shown: window.__ever || document.getElementById("lfh-undobar").classList.contains("show"), exp: window.__exp }));
  await p.evaluate(() => window.LFH_UNDO.show({ message: "Served Naan", seconds: 4 })); await p.clock.runFor(500);
  await p.evaluate(() => window.LFH_UNDO.show({ message: "Settled table 9", seconds: 4 })); await p.clock.runFor(100);
  const swap = await p.evaluate(() => ({ shown: document.getElementById("lfh-undobar").classList.contains("show"), text: document.querySelector("#lfh-undobar .lfh-undo-title").textContent }));
  await h.close();
  return ok(r && !late.shown && late.exp === 1 && swap.shown && swap.text === "Settled table 9", JSON.stringify({ late, swap }));
});

// ── the crash reporter: no sendBeacon, a corrupt saved list, a crash after a tap ──────────────
C("N", "errlog.js", "a browser with no sendBeacon still sends the report (by fetch, kept alive); a corrupt saved list is ignored, not thrown; a stack-less crash names the LAST BUTTON TAPPED in words — hidden text never in the name", async () => {
  setApi(() => ({ status: 204, body: "" }));
  const P2 = page("n-err", { pre: ONLINE + "try{Object.defineProperty(navigator,'sendBeacon',{value:undefined});}catch(e){} localStorage.setItem('lfh_errlog_pending','{not json');", scripts: ["errlog.js"], body: '<button id="b">Settle <span hidden>SECRET</span><span style="display:none">ALSO</span><b>table 4</b></button>' });
  const h = await open(P2); const p = h.page; await sleep(200);
  await p.click("#b");
  await p.evaluate(() => { setTimeout(() => Promise.reject("plain string, no stack"), 10); }); await sleep(800);
  const rows = log.filter((x) => x.path === "/api/log/client-error").map((x) => JSON.parse(x.body));
  const errs = h.errors.filter((e) => !/plain string/.test(e)); await h.close();
  const e = rows.find((x) => x.kind === "error");
  return ok(e && /promise · after tap: Settle table 4/.test(e.where) && !/SECRET|ALSO/.test(e.where) && !errs.length, JSON.stringify({ rows, errs }));
});

// ── the saved-on-this-device bar: changes that were not made offline ──────────────────────────
const OP = page("n-off", { pre: ONLINE + "window.LFH_TEST_PACING={first:60,base:4000,max:4000,wake:0,stuck:60000};", body: "<main>no top bar on this page</main>", scripts: ["backstack.js", "outbox.js", "offline.js"] });
C("N", "offline.js", "a change waiting because the SERVER was busy (not because the device was offline) reads 'The system hasn't confirmed them yet', and the bar still appears on a page with no top bar", async () => {
  setApi(() => ({ status: 503, body: {} }));
  const h = await open(OP); const p = h.page; await p.waitForFunction(() => !!window.LFH_OUTBOX && !!window.LFH_OFF);
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/1/tag", body: {}, table: "1" })); await sleep(500);
  const b = await p.evaluate(() => { const x = document.getElementById("lfhOffBar"); return x && { text: x.innerText.replace(/\s+/g, " "), first: document.body.firstElementChild === x }; });
  await h.close();
  return ok(b && /Sending 1 saved change/.test(b.text) && /hasn't confirmed them yet/.test(b.text) && b.first, JSON.stringify(b));
});

// ── the names the stock room gives a waiting change ───────────────────────────────────────────
C("N", "outbox.js", "every stock-room change that can wait for a signal has its own plain name (Make a batch, Submit the stock count, Strike out an expense, Undo a waste entry …), and a table opened or closed is named with its table", () => {
  const OB = panelFile("outbox.js"), i0 = OB.indexOf("  function labelFor("), i1 = OB.indexOf("\n  }\n", i0) + 4;
  const labelFor = vm.runInNewContext("(function(){" + OB.slice(i0, i1) + "; return labelFor; })()");
  const I = "/api/inventory", cases = [["/production", "Make a batch"], ["/counts/abc/line", "Save a counted quantity"], ["/counts/abc/submit", "Submit the stock count"], ["/counts/abc/discard", "Discard the stock count"], ["/counts", "Start a stock count"],
    ["/expenses", "Record an expense"], ["/expenses/9/void", "Strike out an expense"], ["/purchases", "Record a purchase"], ["/purchases/9/void", "Void a purchase"], ["/waste", "Record waste"], ["/waste/9/void", "Undo a waste entry"],
    ["/vendors/3", "Save a supplier"], ["/recipes/7", "Save a recipe"], ["/items/5", "Save an ingredient"]];
  const bad = cases.filter(([path, want]) => labelFor("POST", path, I) !== want).map(([path, want]) => `${path} → "${labelFor("POST", path, I)}" (want "${want}")`);
  const close = labelFor("POST", "/tables/6/close", "/api/editor"), openT = labelFor("POST", "/tables/6/open", "/api/tablet");
  if (close !== "Close table · Table 6") bad.push(`close → ${close}`);
  if (openT !== "Open table · Table 6") bad.push(`open → ${openT}`);
  return ok(!bad.length, bad.join(" · ") || `${cases.length + 2} names`);
});
