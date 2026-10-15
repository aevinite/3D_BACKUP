// scripts/sweep/t16s10/new-f.mjs — NEW checks, sweep #10 T16 ROUND 2, ids from P185609.
// maint.js — the ⚙ drawer every staff panel loads, driven where the round-2 coverage run found it had
// NEVER been run: the guest-menu tap itself (ask / cancel / refusal / no answer), Sign out (normal,
// hung, failed, from inside a frame), Change password, Set PIN, the first-login PIN, the profile save
// with no queue on the page, the boot conditions, and the in-panel ask / say / reason boxes.
// Every request is answered by the test (browser.mjs harness); /login is answered by the test too, so
// "it left for the sign-in page" is observed without loading anything real. Nothing reaches a server.
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { R, ok, eq, tag } from "./lib.mjs";
import { harness, sleep, until, PACE } from "./browser.mjs";

const done = tag("new-f");
let id = 185609;
const N = (what, fn) => R(`P${id++}`, "maint.js", what, fn, "headless: the real maint.js (+ backstack.js, outbox.js where named), every request answered by the test");
const TOP = `<div class="topbar"><div class="top-actions"></div></div>`;
const MGR = { staff: true, id: "u1", username: "diagm1", role: "manager", name: "Diag", phone: "9876543210", needsProfile: false, hasPin: true, canSelfReset: true, canSelfSetPin: true, profileModule: true };
const FAST = "window.LFH_PANEL_DEADLINE = function (ms) { return AbortSignal.timeout(Math.min(ms || 8000, 600)); };";

// One drawer world. `answers(rec)` may return { status, body }, "hang", or "fail" (a dropped connection).
async function drawer(o = {}) {
  const prof = o.profile || MGR;
  const h = await harness({
    pre: PACE + FAST + (o.pre || ""), body: TOP, path: o.path,
    scripts: o.scripts || ["backstack.js", "maint.js"],
    pages: { "/login": "<!doctype html><title>login</title>the sign-in page", ...(o.pages || {}) },
    api: async (rec, route) => {
      const a = o.answers ? await o.answers(rec, route) : null;
      if (a === "hang") return "handled";
      if (a === "fail") { await route.abort("internetdisconnected"); return "handled"; }
      if (a) return a;
      if (/\/api\/panel-profile/.test(rec.path) && rec.method === "GET") return { status: 200, body: prof };
      if (/\/api\/maintenance/.test(rec.path) && rec.method === "GET") return { status: 200, body: o.maint || { maintenance: false, canChange: true } };
      return { status: 200, body: { ok: true } };
    },
  });
  return h;
}
const openIt = async (p) => { await until(() => p.evaluate(() => !!document.getElementById("staffSettingsBtn")), 8000); await p.click("#staffSettingsBtn"); await p.waitForSelector(".lfh-ov .lfh-dw, .lfh-ov", { timeout: 5000 }); await sleep(250); };
const sec = (p, h3) => p.evaluate((h3) => { const s = [...document.querySelectorAll(".lfh-sec")].find((x) => (x.querySelector("h3") || {}).textContent === h3); return s ? { text: s.innerText, msg: (s.querySelector(".lfh-msg") || {}).textContent || "" } : null; }, h3);
const askOpen = (p) => p.evaluate(() => { const d = [...document.querySelectorAll(".lfh-ov")].pop(); const y = d && d.querySelector(".lfh-ask-yes"); return y ? { title: d.querySelector(".lfh-h1").textContent, text: d.querySelector(".lfh-d").textContent, yes: y.textContent, no: (d.querySelector(".lfh-ask-no") || {}).textContent || null } : null; });
const sent = (h, re, m) => h.sent.filter((r) => re.test(r.path) && (!m || r.method === m));
const guestBtn = (p) => p.evaluate(() => { const s = [...document.querySelectorAll(".lfh-sec")].find((x) => /Guest menu/.test(x.textContent)); return s ? s.querySelector("button").textContent : null; });
const clickGuest = (p) => p.evaluate(() => { const s = [...document.querySelectorAll(".lfh-sec")].find((x) => /Guest menu/.test(x.textContent)); s.querySelector("button").click(); });
const clickAsk = (p, which) => p.evaluate((w) => { const d = [...document.querySelectorAll(".lfh-ov")].pop(); d.querySelector(w === "yes" ? ".lfh-ask-yes" : ".lfh-ask-no").click(); }, which);

// ── 1. the guest-menu tap ────────────────────────────────────────────────────────────────────
const G = {};
async function guestWorld() {
  if (G.done) return G;
  const h = await drawer({ answers: (rec) => (rec.method === "POST" && /maintenance/.test(rec.path) ? { status: 200, body: { maintenance: JSON.parse(rec.body).on, canChange: true } } : null) });
  const p = h.page; await openIt(p);
  await until(async () => /Take guest menu offline/.test((await guestBtn(p)) || ""), 5000);
  G.before = await guestBtn(p);
  await clickGuest(p); await sleep(200);
  G.ask = await askOpen(p); G.postsAtAsk = sent(h, /maintenance/, "POST").length;
  await clickAsk(p, "no"); await sleep(200);
  G.afterCancel = { btn: await guestBtn(p), posts: sent(h, /maintenance/, "POST").length, askGone: !(await askOpen(p)) };
  await clickGuest(p); await sleep(200); await clickAsk(p, "yes");
  await until(async () => /Bring menu back online/.test((await guestBtn(p)) || ""), 4000);
  G.afterYes = { btn: await guestBtn(p), body: (sent(h, /maintenance/, "POST")[0] || {}).body, bg: await p.evaluate(() => { const s = [...document.querySelectorAll(".lfh-sec")].find((x) => /Guest menu/.test(x.textContent)); return s.querySelector("button").style.background; }) };
  await clickGuest(p); await sleep(200);
  G.backAsk = await askOpen(p);
  await clickAsk(p, "yes");
  await until(async () => /Take guest menu offline/.test((await guestBtn(p)) || ""), 4000);
  G.afterBack = { btn: await guestBtn(p), body: (sent(h, /maintenance/, "POST")[1] || {}).body };
  G.errors = h.errors; await h.close(); G.done = true; return G;
}
N("Guest menu: the first tap only ASKS — nothing is sent", async () => { const g = await guestWorld(); return ok(g.ask && g.ask.title === "Take the guest menu offline?" && g.ask.yes === "Take it offline" && g.postsAtAsk === 0, JSON.stringify(g.ask)); });
N("…the question says what guests will lose", async () => { const g = await guestWorld(); return ok(/Guests can’t browse or order until it’s back/.test(g.ask.text), g.ask.text); });
N("…Cancel changes nothing and sends nothing", async () => { const g = await guestWorld(); return ok(g.afterCancel.posts === 0 && g.afterCancel.askGone && /Take guest menu offline/.test(g.afterCancel.btn), JSON.stringify(g.afterCancel)); });
N("…Yes sends {on:true} once and the button turns to 'Bring menu back online'", async () => { const g = await guestWorld(); return ok(g.afterYes.body === '{"on":true}' && /🔴 Bring menu back online/.test(g.afterYes.btn), JSON.stringify(g.afterYes)); });
N("…and the button turns red while the menu is offline", async () => { const g = await guestWorld(); return ok(/127, 29, 29|#7f1d1d/.test(g.afterYes.bg), g.afterYes.bg); });
N("Bringing it back asks with its own words ('Bring the guest menu back?')", async () => { const g = await guestWorld(); return ok(g.backAsk && g.backAsk.title === "Bring the guest menu back?" && g.backAsk.yes === "Bring it back", JSON.stringify(g.backAsk)); });
N("…and Yes sends {on:false}; the button points the other way again", async () => { const g = await guestWorld(); return ok(g.afterBack.body === '{"on":false}' && /🟢 Take guest menu offline/.test(g.afterBack.btn), JSON.stringify(g.afterBack)); });
N("…and no page error was thrown anywhere along that walk", async () => { const g = await guestWorld(); return ok(!g.errors.length, g.errors.join(" | ")); });
async function guestFails(answer) {
  const h = await drawer({ answers: (rec) => (rec.method === "POST" && /maintenance/.test(rec.path) ? answer : null) });
  const p = h.page; await openIt(p); await until(async () => /Take guest menu offline/.test((await guestBtn(p)) || ""), 5000);
  await clickGuest(p); await sleep(150); await clickAsk(p, "yes");
  await until(async () => !!(await askOpen(p)), 3000);
  const said = await askOpen(p); const btn = await guestBtn(p); await h.close();
  return { said, btn };
}
N("A refusal says the server's own words and that the guest menu has NOT changed", async () => { const r = await guestFails({ status: 403, body: { error: "Taking the menu down isn't switched on for you — ask your admin." } }); return ok(r.said && r.said.title === "Nothing changed" && /Couldn't change it: Taking the menu down isn't switched on for you — ask your admin\. — the guest menu has NOT changed\./.test(r.said.text) && /Take guest menu offline/.test(r.btn), JSON.stringify(r)); });
N("…a 500 with no words says 'the server wouldn't change it' — never a blank", async () => { const r = await guestFails({ status: 500, body: "not json" }); return ok(r.said && /Couldn't change it: The server wouldn't change it\./.test(r.said.text), JSON.stringify(r.said)); });
N("…a server that never answers is 'didn't answer in time' (the browser's words never reach the screen)", async () => { const r = await guestFails("hang"); return ok(r.said && /the server didn't answer in time/.test(r.said.text) && !/signal|timed out|AbortError/i.test(r.said.text), JSON.stringify(r.said)); });
N("…a dropped connection still says nothing changed, and the button is unmoved", async () => { const r = await guestFails("fail"); return ok(r.said && /has NOT changed/.test(r.said.text) && /Take guest menu offline/.test(r.btn), JSON.stringify(r)); });
N("A read that could not tell, tapped, asks again and then shows the real state", async () => {
  let n = 0;
  const h = await drawer({ answers: (rec) => (rec.method === "GET" && /maintenance/.test(rec.path) ? (++n === 1 ? { status: 200, body: { maintenance: false, canChange: true } } : n === 2 ? { status: 503, body: {} } : { status: 200, body: { maintenance: true, canChange: true } }) : null) });
  const p = h.page; await openIt(p); await until(async () => /Take/.test((await guestBtn(p)) || ""), 4000);
  await p.evaluate(() => { const o = document.querySelector(".lfh-ov"); o && o.remove(); }); await p.click("#staffSettingsBtn"); await sleep(400);
  const unknown = await guestBtn(p); await clickGuest(p); await until(async () => /Bring/.test((await guestBtn(p)) || ""), 4000);
  const after = await guestBtn(p); const asked = await askOpen(p); await h.close();
  return ok(/Couldn't read the guest menu/.test(unknown) && /Bring menu back online/.test(after) && !asked, JSON.stringify({ unknown, after, asked }));
});

// ── 2. Sign out ──────────────────────────────────────────────────────────────────────────────
async function signOut(o = {}) {
  const h = await drawer({ ...o, answers: (rec) => (/panel-logout/.test(rec.path) ? (o.logout || { status: 200, body: { ok: true } }) : null) });
  const p = o.frame ? h.page.frames().find((f) => /h\.html/.test(f.url())) : h.page;
  await until(() => p.evaluate(() => !!document.getElementById("staffSettingsBtn")), 8000);
  await p.click("#staffSettingsBtn"); await sleep(300);
  const t0 = Date.now();
  await p.evaluate(() => { const b = [...document.querySelectorAll(".lfh-dw button")].find((x) => x.textContent.trim() === "Sign out"); b.click(); });
  const left = await until(() => /\/login$/.test(h.page.url()), 7000, 50);
  const r = { left, ms: Date.now() - t0, url: h.page.url(), posts: sent(h, /panel-logout/, "POST").length, frameUrl: o.frame ? (h.page.frames()[1] || { url: () => "" }).url() : null };
  await h.close(); return r;
}
N("Sign out sends ONE POST to /api/panel-logout and then the window is on /login", async () => { const r = await signOut(); return ok(r.left && r.posts === 1, JSON.stringify(r)); });
N("…a logout request that never answers still leaves, within its own ceiling", async () => { const r = await signOut({ logout: "hang" }); return ok(r.left && r.ms < 5000, JSON.stringify(r)); });
N("…a dropped connection still leaves (the person asked to go, so they go)", async () => { const r = await signOut({ logout: "fail" }); return ok(r.left, JSON.stringify(r)); });
N("…a 500 from the logout still leaves", async () => { const r = await signOut({ logout: { status: 500, body: {} } }); return ok(r.left, JSON.stringify(r)); });
N("…and from inside a frame it is the WHOLE window that leaves, not the frame", async () => {
  const r = await signOut({ path: "/__t16/outer.html", frame: true, pages: { "/__t16/outer.html": '<!doctype html><title>outer</title><iframe src="/__t16/h.html" style="width:600px;height:500px"></iframe>' } });
  return ok(r.left && /\/login$/.test(r.url), JSON.stringify(r));
});

// ── 3. Change password ───────────────────────────────────────────────────────────────────────
async function pw(o = {}) {
  const h = await drawer({ pre: o.offline ? "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});" : "", answers: (rec) => (rec.method === "POST" && /panel-profile/.test(rec.path) ? (o.answer || { status: 200, body: { ok: true } }) : null), profile: o.profile });
  const p = h.page; await openIt(p);
  const has = await sec(p, "Change password");
  if (has && o.cur !== undefined) await p.fill('input[placeholder="Current password"]', o.cur);
  if (has && o.next !== undefined) await p.fill('input[placeholder="New password (min 6)"]', o.next);
  if (o.offline) await p.evaluate(() => { window.__on = false; });
  if (has) { await p.evaluate(() => { const s = [...document.querySelectorAll(".lfh-sec")].find((x) => (x.querySelector("h3") || {}).textContent === "Change password"); [...s.querySelectorAll("button")].pop().click(); }); }
  await sleep(o.wait || 500);
  const r = { sec: await sec(p, "Change password"), note: await sec(p, "Password"), posts: sent(h, /panel-profile/, "POST"), url: h.page.url() };
  if (o.waitLeave) r.left = await until(() => /\/login$/.test(h.page.url()), 4000, 50);
  await h.close(); return r;
}
N("Change password with a box empty: 'Fill both fields.', nothing sent", async () => { const r = await pw({ cur: "", next: "abcdef" }); return ok(r.sec.msg === "Fill both fields." && !r.posts.length, JSON.stringify({ m: r.sec.msg, n: r.posts.length })); });
N("…with no signal it says a password change needs a connection — and sends nothing (never queued)", async () => { const r = await pw({ cur: "old", next: "abcdef", offline: true }); return ok(/You're offline — a password change needs a connection/.test(r.sec.msg) && !r.posts.length, r.sec.msg); });
N("…a wrong current password shows the server's own sentence", async () => { const r = await pw({ cur: "nope", next: "abcdef", answer: { status: 403, body: { error: "Your current password is wrong." } } }); return ok(r.sec.msg === "Your current password is wrong.", r.sec.msg); });
N("…a refusal with no words says 'Could not change.'", async () => { const r = await pw({ cur: "x", next: "abcdef", answer: { status: 500, body: "x" } }); return ok(r.sec.msg === "Could not change.", r.sec.msg); });
N("…a dropped connection says 'Network error.'", async () => { const r = await pw({ cur: "x", next: "abcdef", answer: "fail" }); return ok(r.sec.msg === "Network error.", r.sec.msg); });
N("…it sends the two passwords LIVE (never through the queue) as currentPassword/newPassword", async () => { const r = await pw({ cur: "old1", next: "new123", answer: { status: 200, body: { ok: true } } }); const b = JSON.parse((r.posts[0] || {}).body || "{}"); return ok(r.posts.length === 1 && b.currentPassword === "old1" && b.newPassword === "new123" && !(r.posts[0].headers || {})["x-lfh-action-id"], JSON.stringify(b)); });
N("…success says it is signing you out, and the window then leaves for /login", async () => { const r = await pw({ cur: "old1", next: "new123", waitLeave: true }); return ok(/Password changed — signing you out/.test(r.sec.msg) && r.left, JSON.stringify({ m: r.sec.msg, left: r.left })); });
N("A person not allowed to change it is told the admin manages it — no boxes", async () => { const r = await pw({ profile: { ...MGR, canSelfReset: false } }); return ok(!r.sec && r.note && /Your admin manages your password/.test(r.note.text), JSON.stringify(r.note)); });

// ── 4. Set PIN ───────────────────────────────────────────────────────────────────────────────
async function pin(value, o = {}) {
  const h = await drawer({ scripts: o.scripts || ["backstack.js", "maint.js", "outbox.js"], pre: o.offline ? "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});" : "", profile: o.profile, answers: (rec) => (rec.method === "POST" && /panel-profile/.test(rec.path) ? (o.answer || { status: 200, body: { ok: true } }) : null) });
  const p = h.page;
  await openIt(p);
  const title = o.profile && o.profile.hasPin === false ? "Set a PIN" : "Change your PIN";
  const s0 = await sec(p, title);
  if (s0 && value != null) { await p.fill('input[placeholder="4–8 digit PIN"]', value); await p.evaluate((t) => { const s = [...document.querySelectorAll(".lfh-sec")].find((x) => (x.querySelector("h3") || {}).textContent === t); [...s.querySelectorAll("button")].pop().click(); }, title); await sleep(700); }
  const r = { s0, s: await sec(p, title), other: await sec(p, "Your PIN"), posts: sent(h, /panel-profile/, "POST"), q: await p.evaluate(() => window.LFH_OUTBOX ? window.LFH_OUTBOX.getSnapshot().queued.length : -1) };
  await h.close(); return r;
}
N("Set PIN '12': 'PIN must be 4–8 digits.', nothing sent", async () => { const r = await pin("12"); return ok(r.s.msg === "PIN must be 4–8 digits." && !r.posts.length, r.s.msg); });
N("…'12a4' (not all digits) is refused the same way", async () => { const r = await pin("12a4"); return ok(r.s.msg === "PIN must be 4–8 digits." && !r.posts.length, r.s.msg); });
N("…'1234' is sent as {pin:'1234'} to /api/panel-profile, through the queue, and says 'PIN saved.'", async () => { const r = await pin("1234"); const b = JSON.parse((r.posts[0] || {}).body || "{}"); return ok(r.posts.length === 1 && b.pin === "1234" && !!r.posts[0].headers["x-lfh-action-id"] && r.s.msg === "PIN saved.", JSON.stringify({ b, m: r.s.msg })); });
N("…with no signal it is KEPT on the device and says it will sync", async () => { const r = await pin("123456", { offline: true }); return ok(/Saved on this device/.test(r.s.msg) && !r.posts.length && r.q === 1, JSON.stringify({ m: r.s.msg, q: r.q })); });
N("…a refusal shows the server's own sentence", async () => { const r = await pin("1234", { answer: { status: 400, body: { error: "That PIN is already used by another manager." } } }); return ok(/already used by another manager/.test(r.s.msg), r.s.msg); });
N("…a manager with no PIN yet sees 'Set a PIN', with 'Set PIN' on the button", async () => { const r = await pin(null, { profile: { ...MGR, hasPin: false } }); return ok(r.s0 && /Set PIN/.test(r.s0.text), JSON.stringify(r.s0)); });
N("…a manager not allowed to set one is told the admin manages it", async () => { const r = await pin(null, { profile: { ...MGR, canSelfSetPin: false } }); return ok(!r.s0 && r.other && /Your admin manages your PIN/.test(r.other.text), JSON.stringify(r.other)); });
N("…a waiter has no PIN section at all", async () => { const r = await pin(null, { profile: { ...MGR, role: "tablet" } }); return ok(!r.s0 && !r.other, JSON.stringify(r)); });

// ── 5. first-login card ──────────────────────────────────────────────────────────────────────
async function setup(o = {}) {
  const prof = { ...MGR, needsProfile: true, hasPin: false, name: o.name ?? "", phone: o.phone ?? "", ...(o.profile || {}) };
  const h = await drawer({ profile: prof, answers: (rec) => (rec.method === "POST" && /panel-profile/.test(rec.path) ? (o.answer || { status: 200, body: { ok: true } }) : null) });
  const p = h.page;
  await until(() => p.evaluate(() => /Welcome/.test(document.body.innerText)), 8000);
  const r = { text: await p.evaluate(() => document.body.innerText), pinBox: await p.evaluate(() => !!document.querySelector('input[placeholder="4–8 digit manager PIN"]')) };
  if (o.fill) {
    const ins = await p.$$(".lfh-sec input"); const vis = []; for (const i of ins) if (await i.isVisible()) vis.push(i);
    await vis[0].fill("diagm1"); await vis[1].fill("9876543210"); if (o.pin != null && vis[2]) await vis[2].fill(o.pin);
    await p.getByRole("button", { name: /Save & continue/ }).click(); await sleep(500);
    r.msg = await p.evaluate(() => [...document.querySelectorAll(".lfh-msg")].map((x) => x.textContent).filter(Boolean).join(" | "));
    r.posts = sent(h, /panel-profile/, "POST");
    await sleep(900); r.after = await p.evaluate(() => document.body.innerText);
  }
  if (o.back) { await p.goBack().catch(() => {}); await sleep(400); r.afterBack = { text: await p.evaluate(() => document.body.innerText), url: p.url() }; }
  if (o.x) { await p.evaluate(() => { const o = document.querySelector(".lfh-ov"); if (o) o.click(); }); await sleep(300); r.afterX = await p.evaluate(() => document.body.innerText); }
  await h.close(); return r;
}
N("First-login for a manager who must set a PIN shows the Manager PIN box", async () => { const r = await setup(); return ok(r.pinBox && /Manager PIN/.test(r.text), r.text.slice(0, 160)); });
N("…a bad PIN there stops the save with 'Set a 4–8 digit manager PIN to continue.'", async () => { const r = await setup({ fill: true, pin: "12" }); return ok(/Set a 4–8 digit manager PIN to continue\./.test(r.msg) && !r.posts.length, JSON.stringify({ m: r.msg, n: r.posts.length })); });
N("…a good PIN goes WITH the name and phone in one save", async () => { const r = await setup({ fill: true, pin: "4321" }); const b = JSON.parse((r.posts[0] || {}).body || "{}"); return ok(r.posts.length === 1 && b.pin === "4321" && b.name === "diagm1" && b.phone === "9876543210", JSON.stringify(b)); });
N("…and after it saves the card becomes the everyday drawer (no 'Welcome')", async () => { const r = await setup({ fill: true, pin: "4321" }); return ok(/All set — welcome aboard/.test(r.msg) && !/Welcome, /.test(r.after), JSON.stringify({ m: r.msg })); });
N("A person whose name and phone are already on file is asked to CONFIRM them, once", async () => { const r = await setup({ name: "Diag", phone: "9876543210" }); return ok(/Confirm your details to finish setting up your account\. You'll only do this once\./.test(r.text), r.text.slice(0, 220)); });
N("…a waiter's first-login has no PIN box", async () => { const r = await setup({ profile: { role: "tablet" } }); return ok(!r.pinBox, r.text.slice(0, 120)); });
N("…the backdrop cannot close the card during setup — it says 'One more step'", async () => { const r = await setup({ x: true }); return ok(/One more step/.test(r.afterX) && /Welcome/.test(r.afterX), r.afterX.slice(0, 200)); });
N("…and the phone's Back button cannot skip it either (the card stays, the page stays)", async () => { const r = await setup({ back: true }); return ok(/Welcome/.test(r.afterBack.text) && /h\.html/.test(r.afterBack.url), JSON.stringify({ url: r.afterBack.url })); });

// ── 6. a profile save with no queue on the page ──────────────────────────────────────────────
async function direct(answer, expect) {
  const h = await drawer({ profile: { staff: false }, answers: (rec) => (rec.method === "POST" && /panel-profile/.test(rec.path) ? answer : null) });
  const r = await h.page.evaluate(async (expect) => { try { const x = await window.LFH_PROFILE_SAVE({ name: "A" }, { expect }); return { ok: x.ok, queued: x.queued }; } catch (e) { return { err: e.message, status: e.status }; } }, expect || null);
  r.req = sent(h, /panel-profile/, "POST")[0]; await h.close(); return r;
}
N("With no queue on the page a profile save goes straight to /api/panel-profile and answers ok", async () => { const r = await direct({ status: 200, body: { ok: true } }); return ok(r.ok === true && r.queued === false && r.req && r.req.body === '{"name":"A"}', JSON.stringify(r)); });
N("…it carries what the form was editing FROM as X-LFH-Expect", async () => { const r = await direct({ status: 200, body: { ok: true } }, { table: "staff_users", id: "u1", fields: { phone: "1" } }); return ok(JSON.parse(r.req.headers["x-lfh-expect"] || "null")?.id === "u1", r.req.headers["x-lfh-expect"]); });
N("…and sends no X-LFH-Expect when there is nothing to protect", async () => { const r = await direct({ status: 200, body: { ok: true } }); return ok(!("x-lfh-expect" in r.req.headers), JSON.stringify(Object.keys(r.req.headers))); });
N("…a clash (409) throws with the server's sentence and status, so the screen can say who won", async () => { const r = await direct({ status: 409, body: { error: "Someone else changed this phone a moment ago." } }); return ok(r.status === 409 && /Someone else changed/.test(r.err), JSON.stringify(r)); });
N("…a refusal with no words throws 'Couldn't save.'", async () => { const r = await direct({ status: 500, body: "x" }); return ok(r.err === "Couldn't save." && r.status === 500, JSON.stringify(r)); });

// ── 7. when the drawer does not build at all ─────────────────────────────────────────────────
const noBtn = async (o) => { const h = await drawer(o); await sleep(900); const r = await h.page.evaluate(() => !!document.getElementById("staffSettingsBtn")); await h.close(); return r; };
N("An embedded owner view (?ownermode=1) builds no drawer button", async () => ok(!(await noBtn({ path: "/__t16/h.html?ownermode=1" }))));
N("…nor the menu-only (?menuonly=1) or stock-only (?invonly=1) embeds", async () => ok(!(await noBtn({ path: "/__t16/h.html?menuonly=1" })) && !(await noBtn({ path: "/__t16/h.html?invonly=1" }))));
N("A page that asks for no profile at all (LFH_NO_PROFILE_AT_ALL) builds no button", async () => ok(!(await noBtn({ pre: "window.LFH_NO_PROFILE_AT_ALL = true;" }))));
N("LFH_SUPPRESS_SETTINGS_BTN hides the everyday button…", async () => ok(!(await noBtn({ pre: "window.LFH_SUPPRESS_SETTINGS_BTN = true;" }))));
N("…but NOT the first-login one — setup is never suppressed", async () => ok(await noBtn({ pre: "window.LFH_SUPPRESS_SETTINGS_BTN = true;", profile: { ...MGR, needsProfile: true } })));
N("A visitor who is not staff gets no button", async () => ok(!(await noBtn({ profile: { staff: false } }))));
N("A read that answered an error object builds no button", async () => ok(!(await noBtn({ profile: { error: "nope" } }))));
N("A 401 (signed out) builds no button and does not keep asking", async () => { let n = 0; const h = await drawer({ answers: (rec) => (rec.method === "GET" && /panel-profile/.test(rec.path) ? (n++, { status: 401, body: { error: "login" } }) : null) }); await sleep(1500); const r = { btn: await h.page.evaluate(() => !!document.getElementById("staffSettingsBtn")), n }; await h.close(); return ok(!r.btn && r.n === 1, JSON.stringify(r)); });
N("After a failed boot, the 'online' event builds the button as soon as the server answers", async () => {
  let up = false; const h = await drawer({ pre: "window.LFH_TEST_PACING = Object.assign({}, window.LFH_TEST_PACING, { boot: 60000 });", answers: (rec) => (rec.method === "GET" && /panel-profile/.test(rec.path) && !up ? "fail" : null) });
  await sleep(400); const before = await h.page.evaluate(() => !!document.getElementById("staffSettingsBtn"));
  up = true; await h.page.evaluate(() => window.dispatchEvent(new Event("online")));
  const after = await until(() => h.page.evaluate(() => !!document.getElementById("staffSettingsBtn")), 4000); await h.close();
  return ok(!before && after, JSON.stringify({ before, after }));
});
N("…and so does coming back to the tab (visibilitychange), without waiting for the next try", async () => {
  let up = false; const h = await drawer({ pre: "window.LFH_TEST_PACING = Object.assign({}, window.LFH_TEST_PACING, { boot: 60000 });", answers: (rec) => (rec.method === "GET" && /panel-profile/.test(rec.path) && !up ? { status: 503, body: {} } : null) });
  await sleep(400); up = true; await h.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const after = await until(() => h.page.evaluate(() => !!document.getElementById("staffSettingsBtn")), 4000); await h.close();
  return ok(after);
});

// ── 8. the in-panel ask / say / reason boxes ─────────────────────────────────────────────────
async function boxes(fn) { const h = await drawer({ profile: { staff: false } }); const r = await fn(h.page); r.errors = h.errors; await h.close(); return r; }
N("Ask: tapping outside the card answers NO", async () => { const r = await boxes(async (p) => { const v = p.evaluate(() => window.LFH_ASK.confirm("x")); await sleep(200); await p.mouse.click(5, 5); return { v: await v }; }); return ok(r.v === false, JSON.stringify(r)); });
N("Say: tapping outside the card is an OK", async () => { const r = await boxes(async (p) => { const v = p.evaluate(() => window.LFH_ASK.say("x")); await sleep(200); await p.mouse.click(5, 5); return { v: await v }; }); return ok(r.v === true, JSON.stringify(r)); });
N("Ask: the phone's Back button answers NO and leaves the page where it was", async () => { const r = await boxes(async (p) => { const v = p.evaluate(() => window.LFH_ASK.confirm("x")); await sleep(200); await p.evaluate(() => history.back()); const ans = await v; await sleep(200); return { v: ans, url: p.url() }; }); return ok(r.v === false && /h\.html/.test(r.url), JSON.stringify(r)); });
N("Ask: a danger question paints its Yes red; an ordinary one does not", async () => { const r = await boxes(async (p) => { const a = p.evaluate(() => window.LFH_ASK.confirm("x", { danger: true })); await sleep(150); const red = await p.evaluate(() => document.querySelector(".lfh-ask-yes").style.background); await p.click(".lfh-ask-no"); await a; const b = p.evaluate(() => window.LFH_ASK.confirm("y")); await sleep(150); const plain = await p.evaluate(() => document.querySelector(".lfh-ask-yes").style.background); await p.click(".lfh-ask-no"); await b; return { red, plain }; }); return ok(/ef4444|239, 68, 68/.test(r.red) && !r.plain, JSON.stringify(r)); });
N("Ask: with no title it reads 'Are you sure?', with Yes / Cancel", async () => { const r = await boxes(async (p) => { const a = p.evaluate(() => window.LFH_ASK.confirm("Go?")); await sleep(150); const o = await askOpen(p); await p.click(".lfh-ask-no"); await a; return o; }); return ok(r.title === "Are you sure?" && r.yes === "Yes" && r.no === "Cancel", JSON.stringify(r)); });
N("Say: one button, 'OK', and no Cancel", async () => { const r = await boxes(async (p) => { const a = p.evaluate(() => window.LFH_ASK.say("Done")); await sleep(150); const o = await askOpen(p); await p.click(".lfh-ask-yes"); await a; return o; }); return ok(r.yes === "OK" && r.no === null, JSON.stringify(r)); });
N("Reason box: Save stays disabled until something is typed", async () => { const r = await boxes(async (p) => { const v = p.evaluate(() => window.LFH_ASK.text("Why?")); await sleep(150); const d0 = await p.evaluate(() => document.querySelector(".lfh-ask-yes").disabled); await p.fill(".lfh-dw input", "broken"); const d1 = await p.evaluate(() => document.querySelector(".lfh-ask-yes").disabled); await p.click(".lfh-ask-yes"); return { d0, d1, v: await v }; }); return ok(r.d0 === true && r.d1 === false && r.v === "broken", JSON.stringify(r)); });
N("…typing then rubbing it out to spaces disables Save again", async () => { const r = await boxes(async (p) => { const v = p.evaluate(() => window.LFH_ASK.text("Why?")); await sleep(150); await p.fill(".lfh-dw input", "x"); await p.fill(".lfh-dw input", "   "); const d = await p.evaluate(() => document.querySelector(".lfh-ask-yes").disabled); await p.click(".lfh-ask-no"); return { d, v: await v }; }); return ok(r.d === true && r.v === null, JSON.stringify(r)); });
N("…Enter submits the trimmed reason; Enter on an empty box does nothing", async () => { const r = await boxes(async (p) => { const v = p.evaluate(() => window.LFH_ASK.text("Why?")); await sleep(150); await p.focus(".lfh-dw input"); await p.keyboard.press("Enter"); await sleep(100); const still = await p.evaluate(() => !!document.querySelector(".lfh-dw input")); await p.fill(".lfh-dw input", "  wet floor  "); await p.keyboard.press("Enter"); return { still, v: await v }; }); return ok(r.still && r.v === "wet floor", JSON.stringify(r)); });
N("…Cancel answers null (the shape prompt() had, so callers keep their own guard)", async () => { const r = await boxes(async (p) => { const v = p.evaluate(() => window.LFH_ASK.text("Why?")); await sleep(150); await p.click(".lfh-ask-no"); return { v: await v }; }); return ok(r.v === null, JSON.stringify(r)); });

done();
